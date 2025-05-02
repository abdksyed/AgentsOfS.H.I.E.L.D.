/** @type {boolean} - Whether click/input recording is active */
let isRecording: boolean = false;
/** @type {Array<Object>} - Array storing recorded click and input change events */
let recordedData: Array<any> = []; // Use 'any' for now, can define an interface later
/** @type {number | null} - ID of the tab currently being recorded for clicks/inputs */
let activeTabId: number | null = null;

// State for screen recording
/** @type {boolean} - Whether screen recording is active */
let isScreenRecording: boolean = false;
/** @type {number | null} - ID of the tab targeted for screen recording (may differ from active media stream tab) */
let screenRecordingTabId: number | null = null;
/** @type {string | null} - Blob URL for the latest completed screen recording */
let recordedVideoUrl: string | null = null;
/** @type {number | null} - Timer ID for revoking the recordedVideoUrl if unused */
let screenRecordingCleanupTimer: number | null = null; // setTimeout returns a number in Node/browsers
/** @type {Blob | null} - The actual Blob data for the latest completed screen recording */
let recordedVideoBlob: Blob | null = null;

// State for screen recording start timeout
/** @type {number | null} - Timer ID for the screen recording start timeout */
let screenRecordingStartTimeout: number | null = null;

// Promise to track API key loading
let geminiKeyLoaded: Promise<void>;
// Variable to store the loaded API key
let GEMINI_API_KEY: string | null = null;

// Helper function to get the API key from the most appropriate storage
async function getGeminiApiKey(): Promise<string | null> {
    // First try session storage (more secure, where we save it)
    const sessionResult = await chrome.storage.session.get('geminiApiKey');
    if (sessionResult.geminiApiKey) {
        return sessionResult.geminiApiKey;
    }
    
    // Fall back to local storage (legacy support)
    const localResult = await chrome.storage.local.get('geminiApiKey');
    if (localResult.geminiApiKey) {
        // Optionally migrate to session storage (fire and forget)
        chrome.storage.session.set({ geminiApiKey: localResult.geminiApiKey }).then(() => {
            console.log("Migrated API key from local to session storage");
        }).catch(error => {
            console.error("Error migrating API key:", error);
        });
        return localResult.geminiApiKey;
    }
    
    return null;
}

// Use an IIFE to handle top-level await for storage access
geminiKeyLoaded = (async () => {
    try {
        GEMINI_API_KEY = await getGeminiApiKey();
        if (GEMINI_API_KEY) {
            console.log("Gemini API Key loaded from session storage.");
        } else {
            console.warn("Gemini API Key not found in chrome.storage.session. Please set it via popup or manually.");
        }
    } catch (error) {
        console.error("Error loading Gemini API Key from session storage:", error);
    }
})();

// Add state for AI generation
let isAiGenerating: boolean = false;
let lastAiResults: string | null = null;

// --- Constants ---
const OFFSCREEN_DOCUMENT_PATH: string = 'offscreen/offscreen.html';
const VIDEO_CLEANUP_DELAY_MS: number = 5 * 60 * 1000; // 5 minutes

// --- Storage Functions ---
/**
 * Loads the extension state (recording status, data, active tab) from local storage.
 */
async function loadState(): Promise<void> {
    // Also load AI state
    const result = await chrome.storage.local.get(['isRecording', 'recordedData', 'activeTabId', 'isAiGenerating', 'lastAiResults']);
    isRecording = result.isRecording || false;
    recordedData = result.recordedData || [];
    activeTabId = result.activeTabId || null;
    isAiGenerating = result.isAiGenerating || false;
    lastAiResults = result.lastAiResults || null;
    console.log('Initial state loaded:', { isRecording, recordedData, activeTabId, isAiGenerating, lastAiResults });
    // If recording was active, ensure the listener is attached in the content script for that tab
    if (isRecording && activeTabId) {
        sendMessageToContentScript(activeTabId, { action: 'startListening' });
    }
}

/**
 * Saves the current extension state to local storage.
 * Does not save Blob URLs or Blob data.
 */
async function saveState(): Promise<void> { // Add screen recording state
    // Don't save blob URL/data, but save AI state
    await chrome.storage.local.set({
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording, // Keep track if screen recording *should* be active
        screenRecordingTabId, // Keep track of the target tab
        isAiGenerating,      // Save AI generation status
        lastAiResults        // Save last AI results (or error, or "Generating...")
    });
    console.log('State saved:', { isRecording, recordedData, activeTabId, isScreenRecording, screenRecordingTabId, isAiGenerating, lastAiResults });
}

// --- Initialization ---
chrome.runtime.onStartup.addListener(loadState);
chrome.runtime.onInstalled.addListener(() => {
    // Initialize state on first install or update
    loadState(); 
    console.log('Extension installed/updated. Initializing state.');
});

// Load state immediately in case the service worker was inactive
loadState();

// --- Offscreen Document Management ---
/** @type {Promise<void> | null} - Tracks the creation process to prevent races */
let creatingOffscreenDocument: Promise<void> | null = null;

/**
 * Checks if an offscreen document with the specified path already exists.
 * @param {string} path - The path of the offscreen document HTML file.
 * @returns {Promise<boolean>} True if the document exists, false otherwise.
 */
async function hasOffscreenDocument(path: string): Promise<boolean> {
    // Check all existing contexts for a match.
    const offscreenUrl: string = chrome.runtime.getURL(path);
    // Use chrome.runtime.getContexts() to check for the offscreen document.
    // This is the recommended approach in Manifest V3.
    const contexts = await chrome.runtime.getContexts({ 
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], // Use the enum value
        documentUrls: [offscreenUrl] 
    });
    return contexts && contexts.length > 0; // Check if the array exists and has items
}

/**
 * Creates an offscreen document if it doesn't already exist.
 * Required for accessing navigator.mediaDevices.getDisplayMedia.
 * @param {string} path - The path to the offscreen document HTML file.
 */
async function setupOffscreenDocument(path: string): Promise<void> {
    // If we do not have an offscreen document, create one.
    if (!(await hasOffscreenDocument(path))) {
        // Create the offscreen document, handling potential race conditions.
        if (creatingOffscreenDocument) {
            await creatingOffscreenDocument;
        } else {
            // Use chrome.offscreen.Reason type
            const reasons: chrome.offscreen.Reason[] = [chrome.offscreen.Reason.USER_MEDIA];
            creatingOffscreenDocument = chrome.offscreen.createDocument({
                url: path,
                reasons: reasons,
                justification: 'Recording tab media stream',
            });
            await creatingOffscreenDocument;
            creatingOffscreenDocument = null;
            console.log("Offscreen document created.");
        }
    } else {
         console.log("Offscreen document already exists.");
    }
}

// --- Communication Functions ---
/**
 * Sends a message to the popup window, if it's open.
 * @param {Object} message - The message object to send.
 */
async function sendMessageToPopup(message: any): Promise<void> { // Use 'any' for message type for now
    try {
        await chrome.runtime.sendMessage(message);
        console.log("Sent message to popup:", message);
    } catch (error: any) { // Type the error as any
        // Handle error (e.g., popup is not open)
        if (error.message.includes("Could not establish connection") || 
            error.message.includes("Receiving end does not exist")) {
            console.log("Popup not open or not listening.");
        } else {
            console.error("Error sending message to popup:", error);
        }
    }
}

/**
 * Sends a message to the content script of a specific tab.
 * @param {number} tabId - The ID of the target tab.
 * @param {Object} message - The message object to send.
 */
async function sendMessageToContentScript(tabId: number, message: any): Promise<void> { // Use 'any' for message type for now
    try {
        await chrome.tabs.sendMessage(tabId, message);
        console.log(`Sent message to content script in tab ${tabId}:`, message);
    } catch (error: any) { // Type the error as any
         if (error.message.includes("Could not establish connection") || 
            error.message.includes("Receiving end does not exist")) {
            console.warn(`Content script in tab ${tabId} not ready or not listening. Message:`, message, "Error:", error.message);
            // Attempt to inject script if it seems missing? Might be too aggressive.
        } else {
            console.error(`Error sending message to content script in tab ${tabId}:`, error);
        }
    }
}

/**
 * Sends the current state to the popup to update its UI.
 * Includes recording status, data, active tab, and video availability.
 */
async function updatePopupUI(): Promise<void> { // Make function async
    const hasVideo: boolean = !!recordedVideoUrl || !!recordedVideoBlob; // Check if we have a URL or blob ready
    console.log("[Background] Updating Popup UI with state:", { isRecording, activeTabId, isScreenRecording, hasVideo, isAiGenerating, lastAiResults });

    // Define a more specific type for the message if possible, or keep as any
    sendMessageToPopup({
        action: 'updatePopup',
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording,
        hasVideo, // Send boolean flag instead of URL
        isAiGenerating, // Send AI generating status
        lastAiResults   // Send last AI results/status
    });
}

// --- Event Handlers ---
/**
 * Main message listener for actions from the popup and content scripts.
 * Handles starting/stopping recordings, clearing data, state requests, data recording,
 * downloads, and AI generation requests.
 * @param {Object} message - The received message object.
 * @param {chrome.runtime.MessageSender} sender - Information about the sender.
 * @param {function} sendResponse - Function to send a response.
 * @returns {boolean} True if the response will be sent asynchronously.
 */
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean | undefined => { // Type parameters and return value
    console.log("[Background] Message received:", message, "from sender:", sender?.tab?.id ? `tab ${sender.tab.id}` : sender?.id ? `extension ${sender.id}` : 'unknown');
    let needsAsyncResponse: boolean = false;

    // Combined Action
    if (message.action === 'startBothRecordings') {
        needsAsyncResponse = true; // Needs async for both start actions
        
        // Use Promise.all to attempt starting both recordings concurrently
        Promise.all([
            startClickRecordingInternal(sender.tab?.id), // Start click recording
            startScreenRecording() // Start screen recording
        ])
        .then(() => {
            console.log("[Background] Both recordings initiated successfully.");
            // State and UI updates are handled by individual start functions on success
            // For the combined action, we can explicitly save state and update UI once both are confirmed to start
            // (Or rely on the individual start functions to eventually trigger updates)
            // Let's rely on individual start functions and subsequent state updates for now.
            sendResponse({ success: true });
        })
        .catch(async (err: any) => { // Make catch async to await stopScreenRecording
            console.error("[Background] Error starting one or both recordings:", err);
            // Use a more structured approach with Promise.all for cleanup
            const cleanupPromises = [];
            
            // Stop screen recording if it started
            if (isScreenRecording) {
                cleanupPromises.push(stopScreenRecording());
            }
            
            // Stop click recording if it started
            if (isRecording) {
                stopClickRecordingInternal();
                // Note: stopClickRecordingInternal is sync, but saveState() is async
                // We should ensure state is saved after cleanup if necessary, but for simplicity
                // and relying on subsequent updates, we won't explicitly add saveState here now
                // unless it's deemed critical for immediate state consistency after *failed* start.
                // Let's add saveState for robustness after any recording stops.
                cleanupPromises.push(saveState()); // Ensure state is saved after stopping
            }
            
            // Wait for all cleanup to complete
            await Promise.all(cleanupPromises);
            
            // Ensure state flags are consistent after attempted cleanup
            isRecording = false; // Click recording should be off
            isScreenRecording = false; // Screen recording should be off
            screenRecordingTabId = null; // Clear target tab ID
            // Also potentially clear AI state if a start failure should reset it?
            // Let's keep AI state as is unless it's directly related.

            sendResponse({ success: false, error: err.message || 'Failed to start recordings' });
        });
    }
    // --- Stop Both Action ---
    else if (message.action === 'stopBothRecordings') {
        needsAsyncResponse = true; // Needs async for screen recording stop
        console.log("[Background] Received 'stopBothRecordings' action message.");
        // Stop click recording first (synchronous parts) - Use internal helper
        stopClickRecordingInternal();
        // Then stop screen recording (asynchronous)
        stopScreenRecording() // This now just stops recording and saves URL
            .then(async () => {
                console.log("[Background] Both recordings stopped. Video URL should be available if successful.");
                // State is saved within stopScreenRecording's callback or stopClickRecordingInternal
                await saveState(); // Save combined state
                updatePopupUI(); // Update UI reflecting stopped state & video availability
                sendResponse({ success: true });
            })
            .catch((err: any) => { // Type the error as any
                console.error("[Background] Error stopping both recordings:", err);
                // Attempt to clean up state even on error
                isRecording = false;
                isScreenRecording = false;
                screenRecordingTabId = null;
                saveState();
                updatePopupUI();
                sendResponse({ success: false, error: err.message });
            });
    }
    // --- Individual Click Recording Actions ---
    else if (message.action === 'startRecording') {
        needsAsyncResponse = true;
        startClickRecordingInternal(sender.tab?.id)
             .then(() => sendResponse({ success: true }))
             .catch((err: any) => { // Type the error as any
                 console.error("[Background] Error starting click recording:", err);
                 sendResponse({ success: false, error: err.message });
             });
    } else if (message.action === 'stopRecording') {
        stopClickRecordingInternal(); // Use internal helper
        saveState(); // Save state after stopping
        updatePopupUI();
        sendResponse({ success: true });
    }
    // --- Clear Recording Action ---
    else if (message.action === 'clearRecording') {
        // Clear existing data
        recordedData = [];
        activeTabId = null;

        // Clean up video resources if they exist
        console.log(`[clearRecording] Checking video URL before revoke: ${recordedVideoUrl}`);
        if (recordedVideoUrl && typeof recordedVideoUrl === 'string' && recordedVideoUrl.startsWith('blob:')) {
            try {
                console.log("[Background] Attempting to revoke video URL on clear:", recordedVideoUrl);
                // First check if URL and revokeObjectURL exist before calling
                if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                    URL.revokeObjectURL(recordedVideoUrl);
                    console.log("[Background] Successfully revoked video URL on clear.");
                } else {
                    console.warn("[Background] URL.revokeObjectURL function not available. Skipping revocation.");
                }
            } catch (e) { 
                console.error("Error revoking video URL on clear:", e); 
            }
            recordedVideoUrl = null;
        }
        recordedVideoBlob = null; // Also clear any stored blob

        isRecording = false;
        isScreenRecording = false;
        screenRecordingTabId = null;

        // Clear generated steps as well
        chrome.storage.local.remove('generatedSteps');

        lastAiResults = null; // <-- Clear AI results state
        saveState(); // Save the cleared state
        updatePopupUI();
        console.log("Cleared recording data, state, video resources, and steps.");
        sendResponse({ success: true });
    } else if (message.action === 'getInitialState') {
        // Load the latest state from storage first
        loadState().then(() => {
             // Send initial state including video availability and AI state
            const hasVideo = !!recordedVideoUrl || !!recordedVideoBlob;
            const responsePayload = {
                isRecording,
                recordedData,
                activeTabId,
                isScreenRecording,
                hasVideo: !!recordedVideoUrl || !!recordedVideoBlob, // Calculate hasVideo here
                isAiGenerating, // Include AI generating status
                lastAiResults   // Include last AI results/status
            };
            console.log("[Background] Sending initial state:", responsePayload);
            sendResponse(responsePayload);
        }).catch(err => {
             console.error("Error loading state for getInitialState:", err);
             // Send default state on error
             sendResponse({
                 isRecording: false,
                 recordedData: [],
                 activeTabId: null,
                 isScreenRecording: false,
                 hasVideo: false,
                 isAiGenerating: false,
                 lastAiResults: null
             });
         });
        needsAsyncResponse = true; // Indicate async response because of loadState
    } else if (message.action === 'recordClick') {
        if (isRecording && sender.tab && sender.tab.id === activeTabId) {
            // Add click event with DOM structure
            if (!message.domStructure || !Array.isArray(message.domStructure)) {
                console.error("Received recordClick message without valid domStructure.");
                sendResponse({ success: false, error: "Invalid click data" });
                return; // Exit early
            }
            recordedData.push({
                type: 'click',
                domStructure: message.domStructure, // Store the array of HTML strings
                timestamp: Date.now()
            });
            saveState();
            updatePopupUI();
            sendResponse({ success: true });
        } else {
            console.warn("Received click data when not recording or from wrong tab.");
            sendResponse({ success: false, error: "Not recording or wrong tab" });
        }
    } else if (message.action === 'recordInputChange') {
        if (isRecording && sender.tab && sender.tab.id === activeTabId) {
            // Add input change event
             recordedData.push({
                type: 'inputChange', // Mark type
                selector: message.selector,
                beforeValue: message.beforeValue,
                afterValue: message.afterValue,
                timestamp: Date.now()
            });
            saveState();
            updatePopupUI();
            sendResponse({ success: true });
        } else {
             console.warn("Received input change data when not recording or from wrong tab.");
            sendResponse({ success: false, error: "Not recording or wrong tab" });
        }
    }
    // --- NEW: Download Video Action ---
    else if (message.action === 'downloadVideoAction') {
         console.log("[Background] Received 'downloadVideoAction'.");
         // Re-create a Blob URL if it was revoked or lost but the Blob is still cached
         if (!recordedVideoUrl && recordedVideoBlob) {
             console.log("[Background] Recreating Blob URL from cached Blob for download.");
             try {
                 recordedVideoUrl = URL.createObjectURL(recordedVideoBlob);
                 console.log(`[Background] Re-created video URL: ${recordedVideoUrl}`);
             } catch (error: any) {
                 console.error("[Background] Error recreating Blob URL for download:", error);
                 sendMessageToPopup({ action: 'showNotification', message: `Error preparing video for download: ${error.message}`, type: 'error' });
                 sendResponse({ success: false, error: 'Failed to recreate video URL' });
                 needsAsyncResponse = true; // Set true as we are sending response
                 return needsAsyncResponse; // Exit if URL recreation fails
             }
         }

         if (recordedVideoUrl) {
             console.log("[Background] Initiating download via chrome.downloads for URL:", recordedVideoUrl);
             chrome.downloads.download({
                 url: recordedVideoUrl,
                 filename: 'recorded_screen.webm',
                 saveAs: true
             }, (downloadId) => {
                 if (chrome.runtime.lastError) {
                     console.error("[Background] Download initiation failed:", chrome.runtime.lastError.message);
                     sendMessageToPopup({ action: 'showNotification', message: `Download failed: ${chrome.runtime.lastError.message}`, type: 'error' });
                     sendResponse({ success: false, error: chrome.runtime.lastError.message });
                 } else {
                     console.log("[Background] Download initiated with ID:", downloadId);
                     // IMPORTANT: Do NOT revoke the URL here. Revocation happens only on Clear All.
                     sendResponse({ success: true });
                 }
             });
             needsAsyncResponse = true; // Because chrome.downloads is async
         } else {
             console.warn("[Background] Download requested but no video URL available.");
             sendMessageToPopup({ action: 'showNotification', message: 'No video available for download.', type: 'error' });
             sendResponse({ success: false, error: 'No video URL' });
         }
    }
    // --- NEW: Generate with AI Magic + User Prompt ---
    else if (message.action === 'generateWithAiMagic') {
        console.log("[Background] Received 'generateWithAiMagic' action with user prompt:", message.userPrompt);
        const selectedPromptFile = message.selectedPromptFile || 'step_gen_prompt.md'; // Get selected prompt, default
        console.log("[Background] Using prompt file:", selectedPromptFile);
        needsAsyncResponse = true;

        const userProvidedPrompt = message.userPrompt || ""; // Get the user's prompt

        // Check prerequisites - ensure at least one data type is available
        const hasVideoData = !!recordedVideoBlob || !!recordedVideoUrl;
        const hasClickData = recordedData && recordedData.length > 0;

        if (!hasVideoData && !hasClickData) {
            const errorMsg = "Cannot generate steps: No video or click/input data available.";
            console.error(errorMsg); // Keep error log
            isAiGenerating = false;
            lastAiResults = `Error: ${errorMsg}`;
            saveState(); // Save state with error
            // Send error result back to popup
            sendMessageToPopup({ action: 'showAiMagicResults', results: lastAiResults });
            sendResponse({ success: false, error: errorMsg });
            return needsAsyncResponse; // Exit early
        }

        (async () => {
            let videoBlobToProcess: Blob | null = recordedVideoBlob;
            isAiGenerating = true;
            lastAiResults = "Generating...";
            await saveState(); // Save generating state
            // Notify popup immediately that generation has started
            sendMessageToPopup({ action: 'showAiMagicResults', results: lastAiResults });

            try {
                // Re-create Blob URL if it was revoked or lost but the Blob is still cached
                // This helps if the service worker restarted but the blob reference survived.
                if (!recordedVideoUrl && recordedVideoBlob) {
                    console.log("[Background] Recreating Blob URL from cached Blob for AI use.");
                    try {
                        recordedVideoUrl = URL.createObjectURL(recordedVideoBlob);
                        console.log("[Background] Re-created Blob URL:", recordedVideoUrl);
                        // No cleanup timer needed here
                    } catch (error: any) {
                        console.error("[Background] Error recreating Blob URL for AI:", error);
                        // Proceed without URL, maybe still use blob directly if possible
                        recordedVideoUrl = null;
                    }
                }

                // Fetch blob from URL ONLY IF we don't have the blob directly and the URL exists
                if (!videoBlobToProcess && recordedVideoUrl) {
                    console.log("Fetching video blob from URL for AI Magic Gemini:", recordedVideoUrl);
                    try {
                        const response = await fetch(recordedVideoUrl!); 
                        if (!response.ok) {
                            throw new Error(`Failed to fetch video blob: ${response.statusText}`);
                        }
                        videoBlobToProcess = await response.blob();
                        recordedVideoBlob = videoBlobToProcess; // Store fetched blob
                        console.log("Video blob fetched successfully for AI Magic Gemini.");
                    } catch (fetchError: any) {
                         console.error("Error fetching video blob from URL:", fetchError);
                         // Set to null if fetch fails, proceed without video
                         videoBlobToProcess = null;
                         // Optionally notify user?
                         sendMessageToPopup({ action: 'showNotification', message: `Warning: Could not fetch video data for AI. Proceeding with transcript only. Error: ${fetchError.message}`, type: 'warning' });
                    }
                }

                // If after all attempts, we still don't have a blob, warn and proceed without video
                if (!videoBlobToProcess) {
                    console.warn("Cannot provide video blob for Gemini. Proceeding without video.");
                }

                console.log("Calling Gemini API (AI Magic) with video, transcript, and user prompt...");
                sendMessageToPopup({ action: 'showNotification', message: 'Analyzing recording with AI Magic...', type: 'info' });

                // Call Gemini, passing the selected prompt file and user's prompt
                // callGeminiApi handles updating state (isAiGenerating, lastAiResults) and sending results to popup
                await callGeminiApi(videoBlobToProcess, recordedData, selectedPromptFile, userProvidedPrompt);

                console.log("AI Magic Gemini API call completed.");

                // DO NOT Cleanup URL here anymore
                // if (recordedVideoUrl) {
                //     console.log("Revoking video Blob URL after AI Magic processing attempt:", recordedVideoUrl);
                //     try { URL.revokeObjectURL(recordedVideoUrl); } catch (e) { console.warn("Error revoking URL post-AI Magic:", e); }
                //     recordedVideoUrl = null; // Clear the URL state variable
                // }
                // State (isAiGenerating, lastAiResults) is already saved within callGeminiApi
                // await saveState(); // Save state reflecting URL cleanup
                updatePopupUI(); // Update UI based on the result saved by callGeminiApi
                sendResponse({ success: true }); // Indicate the process was initiated and completed (successfully or with handled error)

            } catch (error: any) {
                 // This outer catch handles errors *before* calling callGeminiApi (e.g., blob fetch issues not caught internally)
                 // or issues *after* callGeminiApi returns (though most processing is now inside callGeminiApi)
                console.error("Error during AI Magic orchestration:", error);
                isAiGenerating = false;
                lastAiResults = `Error: ${error.message}`;
                await saveState();
                // Send error result to popup
                sendMessageToPopup({ action: 'showAiMagicResults', results: lastAiResults });
                // DO NOT Cleanup video URL on error anymore
                // if (recordedVideoUrl) {
                //     console.log("Revoking video Blob URL after AI Magic error:", recordedVideoUrl);
                //     try { URL.revokeObjectURL(recordedVideoUrl); } catch(e: any) { console.warn("Error revoking URL on AI Magic error:", e); }
                //     recordedVideoUrl = null;
                // }
                await saveState(); // Save error state
                updatePopupUI();
                sendResponse({ success: false, error: error.message });
            }
        })();

    }
    // --- Message from Offscreen Document ---
    else if (message.target === 'background' && (message.type === 'recording-stopped' || message.type === 'recording-error')) {

        // Always reset recording state regardless of success/error
        isScreenRecording = false;
        // Don't reset screenRecordingTabId here, might be useful for context
        // screenRecordingTabId = null;

        // No cleanup timer to clear anymore
        // if (screenRecordingCleanupTimer) {
        //     console.log("[Background] Clearing cleanup timer:", screenRecordingCleanupTimer);
        //     if (screenRecordingCleanupTimer !== null) clearTimeout(screenRecordingCleanupTimer);
        //     screenRecordingCleanupTimer = null;
        // }

        if (message.type === 'recording-stopped' && message.url) {
            console.log("[Background] Received 'recording-stopped' message from offscreen with URL:", message.url);
            recordedVideoUrl = message.url; // Store the Blob URL
            // Fetch the blob immediately and store it to make it less reliant on the temporary offscreen document URL
            // This increases memory usage but improves chances of survival if the offscreen doc closes quickly.
            (async () => {
                try {
                    console.log("Fetching Blob data from URL immediately:", recordedVideoUrl);
                    if (!recordedVideoUrl) throw new Error("No URL to fetch");
                    const response = await fetch(recordedVideoUrl!);
                    if (!response.ok) throw new Error(`Failed to fetch blob: ${response.statusText}`);
                    recordedVideoBlob = await response.blob();
                    console.log("Stored Blob data directly in background script.");
                    // Save state after successfully getting the blob
                    await saveState();
                    updatePopupUI(); // Update UI now that blob is likely available
                } catch (error) {
                    console.error("Error fetching blob from offscreen URL:", error);
                    recordedVideoBlob = null; // Ensure blob is null if fetch fails
                    // Still save state and update UI, but video might not work later
                    await saveState();
                    updatePopupUI();
                }
            })();
             console.log("[Background] Stored new video Blob URL. Attempting to fetch and store Blob data.");

            // REMOVED Timeout for cleanup
            // if (screenRecordingCleanupTimer !== null) clearTimeout(screenRecordingCleanupTimer); // Clear any existing timer
            // screenRecordingCleanupTimer = setTimeout(() => {
            //     console.warn(`[Background] Cleaning up unused video Blob URL and Blob after ${VIDEO_CLEANUP_DELAY_MS / 1000}s timeout.`);
            //     clearVideoResources(); // Use helper to clear URL and Blob
            //     saveState(); // Save state after cleanup
            //     updatePopupUI(); // Reflect timeout in UI
            //     screenRecordingCleanupTimer = null;
            // }, VIDEO_CLEANUP_DELAY_MS);
            // console.log(`[Background] Set cleanup timer ${screenRecordingCleanupTimer} for video URL and Blob.`);

        } else {
            // Handle cases: recording-stopped without URL, or recording-error
            const reason = message.error || "Offscreen document did not provide video URL.";
            console.error(`[Background] Recording failed or video unavailable. Reason: ${reason}`);
            recordedVideoUrl = null; // Ensure URL is null
            recordedVideoBlob = null; // Ensure blob is null

            // Notify the user via popup
            sendMessageToPopup({
                action: 'showNotification',
                message: `Video recording failed: ${reason}`,
                type: 'error'
            });
        }

        // Update state and UI after handling message (blob fetching might update again later)
        saveState();
        updatePopupUI();

    }

    // --- NEW: Message from Offscreen confirming start ---
    else if (message.target === 'background' && message.type === 'recording-started') {
        console.log("[Background] Received 'recording-started' confirmation from offscreen.");
        isScreenRecording = true; // Now we can officially set the state
        // screenRecordingTabId should have been set in startScreenRecording
        saveState();
        updatePopupUI();
    }

    // --- NEW: Download Events Action ---
    else if (message.action === 'downloadEventsAction') {
        console.log("[Background] Received 'downloadEventsAction'.");
        if (!recordedData || recordedData.length === 0) {
            console.warn("[Background] Download events requested but no data available.");
            sendMessageToPopup({ action: 'showNotification', message: 'No events recorded to download.', type: 'warning' });
            sendResponse({ success: false, error: 'No recorded data' });
            return needsAsyncResponse; // Added return
        } else {
            try {
                // Use the helper function (defined below) to format data
                const fileContent = formatRecordedDataForDownload(recordedData); // Corrected function name
                if (fileContent === null) {
                    throw new Error("Failed to generate file content.");
                }
                console.log("[Background] Sending events file content back to popup.");
                // Send the text content back to the popup
                sendResponse({ success: true, textContent: fileContent }); 
            } catch (error: any) {
                 console.error("[Background] Error preparing events data for download:", error);
                 sendMessageToPopup({ action: 'showNotification', message: `Error preparing download: ${error.message}`, type: 'error' });
                 sendResponse({ success: false, error: (error as Error).message }); // Cast to Error to access message
            }
        }
    }

    // --- Individual Screen Recording Actions ---
    else if (message.action === 'startScreenRecording') {
        needsAsyncResponse = true; // Indicate async response
        startScreenRecording() // This now just sends a message to offscreen
         .then(() => {
            // Successfully sent message to offscreen, but recording hasn't started yet
            // State will be updated when 'recording-started' message is received
            // Send immediate response to popup to indicate initiation attempt
            sendResponse({success: true});
         }).catch(err => {
            console.error("[Background] Error initiating screen recording via offscreen:", err);
            // Send error back to popup if setupOffscreen or sendMessage failed
            sendResponse({success: false, error: err.message});
         });
    } else if (message.action === 'stopScreenRecording') {
        console.log("[Background] Received 'stopScreenRecording' action message (standalone).");
        needsAsyncResponse = true; // Indicate async response
         stopScreenRecording() // Just stops and saves URL
            .then(async () => {
                console.log("[Background] Standalone screen recording stopped.");
                await saveState(); // Save state
                updatePopupUI();
                sendResponse({success: true});
            }).catch(err => {
                console.error("[Background] Error stopping screen recording:", err);
                 isScreenRecording = false; // Ensure state is updated on error
                 screenRecordingTabId = null;
                 saveState();
                 updatePopupUI();
                sendResponse({success: false, error: err.message});
            });
    }

    // --- Fallback for unhandled actions ---
    else if (message.action === 'saveApiKey') {
        needsAsyncResponse = true;
        console.log("[Background] Received 'saveApiKey' action with API key length:", message.apiKey?.length || 0);
        
        // Store the API key in chrome.storage.local
        chrome.storage.local.set({ geminiApiKey: message.apiKey })
            .then(() => {
                // Update the in-memory API key
                GEMINI_API_KEY = message.apiKey;
                console.log("[Background] API key saved successfully in storage and memory");
                // Send notification to popup for visibility
                sendMessageToPopup({ action: 'showNotification', message: 'API Key saved successfully!', type: 'success' });
                sendResponse({ success: true });
            })
            .catch((error) => {
                console.error("[Background] Error saving API key:", error);
                // Send notification to popup for visibility
                sendMessageToPopup({ action: 'showNotification', message: `Error saving API key: ${error.message}`, type: 'error' });
                sendResponse({ success: false, error: error.message });
            });
    }
    else {
        console.warn("Unhandled message action:", message.action);
        // Optionally send a response for unhandled actions
        // sendResponse({ success: false, error: `Unhandled action: ${message.action}` });
    }

    return needsAsyncResponse; // Required for async responses
});

// --- Gemini API Integration ---
// Use the new model name in the URL
const GEMINI_MODEL_NAME = 'gemini-2.5-flash-preview-04-17';
// Base URL - Key will be appended in callGeminiApi if available
const GEMINI_API_BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent`;
// Maximum retries for transient server errors
const MAX_API_RETRIES = 3;
// Retry delay in milliseconds (with exponential backoff)
const RETRY_DELAY_MS = 1000;

/**
 * Helper function to convert Blob to Base64 string.
 * @param {Blob} blob - The Blob to convert.
 * @returns {Promise<string>} A promise that resolves with the Base64 encoded string (without the data: prefix).
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result.split(',')[1]); // Get only the Base64 part
            } else {
                reject(new Error('FileReader result is not a string'));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Makes a fetch request to the Gemini API with retry logic for server errors
 * @param {string} apiUrl - Full API URL with API key
 * @param {Object} requestBody - Request payload
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<Response>} The fetch response
 */
async function fetchWithRetry(apiUrl: string, requestBody: any, retries = MAX_API_RETRIES): Promise<Response> {
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Chrome-Extension',
                'Accept': 'application/json',
                'Origin': chrome.runtime.getURL(''),
            },
            body: JSON.stringify(requestBody),
        });
        
        // If we get a 500 error and have retries left, try again with exponential backoff
        if (response.status === 500 && retries > 0) {
            const delay = RETRY_DELAY_MS * (MAX_API_RETRIES - retries + 1);
            console.log(`Gemini API returned 500 error. Retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(apiUrl, requestBody, retries - 1);
        }
        
        return response;
    } catch (error) {
        // For network errors, also retry if we have retries left
        if (retries > 0) {
            const delay = RETRY_DELAY_MS * (MAX_API_RETRIES - retries + 1);
            console.log(`Network error calling Gemini API. Retrying in ${delay}ms... (${retries} retries left)`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(apiUrl, requestBody, retries - 1);
        }
        throw error;
    }
}

/**
 * Calls the Gemini API to generate step-by-step instructions based on video and recorded actions.
 * @param {Blob} videoBlob - The recorded video as a Blob.
 * @param {Array<Object>} transcriptData - Array of recorded click/input events.
 * @param {string} promptFileName - The name of the prompt file to use (e.g., 'step_gen_prompt.md').
 * @param {string} [userPrompt=""] - Optional additional user-provided prompt/context.
 * @returns {Promise<string|null>} A promise that resolves with the generated steps text, or null on error.
 */
async function callGeminiApi(videoBlob: Blob | null, transcriptData: Array<any>, promptFileName: string, userPrompt = ""): Promise<string | null> {
    // Ensure the key has loaded before proceeding
    await geminiKeyLoaded;

    // Define size limits
    const MAX_BLOB_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB absolute maximum
    const IDEAL_BLOB_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB ideal maximum for reliability
    
    // Only check size if videoBlob is not null
    if (videoBlob) {
        console.log(`Original video size: ${(videoBlob.size / (1024 * 1024)).toFixed(1)} MB`);
        
        if (videoBlob.size > MAX_BLOB_SIZE_BYTES) {
            const errorMsg = `Video file size (${(videoBlob.size / (1024 * 1024)).toFixed(1)} MB) exceeds the limit of ${MAX_BLOB_SIZE_BYTES / (1024 * 1024)} MB for AI analysis. Video will not be included.`; // Updated message
            console.error(errorMsg);
            sendMessageToPopup({ action: 'showAiMagicResults', results: `Error: ${errorMsg}` });
            sendMessageToPopup({ action: 'showNotification', message: errorMsg, type: 'error' });
            // Update state to reflect the error
            isAiGenerating = false;
            lastAiResults = `Error: ${errorMsg}`;
            await saveState();
            // Do NOT return null yet, proceed with transcript only if available
            videoBlob = null; // Set videoBlob to null so it's not sent
        } else if (videoBlob.size > IDEAL_BLOB_SIZE_BYTES) {
             const warningMsg = `Video file size (${(videoBlob.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ideal size of ${IDEAL_BLOB_SIZE_BYTES / (1024 * 1024)} MB. Processing may take longer or fail.`; // New warning
             console.warn(warningMsg);
             sendMessageToPopup({ action: 'showNotification', message: warningMsg, type: 'warning' });
            // Original videoBlob is kept, will be sent as is
        }
    }

    if (!GEMINI_API_KEY) {
        const errorMsg = 'Gemini API Key not configured. Please set it in extension settings/storage.';
        console.warn(errorMsg);
        // Update state to reflect the error
        isAiGenerating = false;
        lastAiResults = `Error: ${errorMsg}`;
        await saveState(); // Save state with error
        // Send result back to the correct popup handler
        sendMessageToPopup({ action: 'showAiMagicResults', results: lastAiResults });
        // Also send a notification for clarity
        sendMessageToPopup({ action: 'showNotification', message: errorMsg, type: 'error' });
        return null;
    }

    console.log('Preparing data for Gemini API (', GEMINI_MODEL_NAME, ')...');
    try {
        // 1. Fetch the system prompt
        const promptUrl = chrome.runtime.getURL(promptFileName); // Use the passed filename
        console.log('Fetching system prompt from:', promptUrl);
        const promptResponse = await fetch(promptUrl);
        if (!promptResponse.ok) {
            throw new Error(`Failed to fetch prompt '${promptFileName}': ${promptResponse.statusText}`);
        }
        const systemPromptText = await promptResponse.text();
        console.log('System prompt fetched successfully.');

        // 2. Prepare video data
        let videoBase64: string | null = null;
        let videoMimeType: string | null = null;
        if (videoBlob) {
            try {
                videoBase64 = await blobToBase64(videoBlob);
                videoMimeType = videoBlob.type || 'video/webm'; // Use blob type or default
                console.log(`Video converted to Base64 (MIME type: ${videoMimeType}).`);
            } catch (error) {
                console.error("Error converting video blob to Base64:", error);
                // Handle error? Maybe send a notification? For now, proceed without video.
                videoBase64 = null;
            }
        } else {
            console.log("No video blob provided for Gemini API call.");
        }

        // 3. Prepare transcript data string using the formatter
        const transcriptString = formatRecordedDataForDownload(transcriptData, false); // Get simple format for API
        // Allow empty or null transcript string if no data was recorded
        const transcriptText = transcriptString ? `Here is the transcript of user actions, extract the main selector classes/id from each click event and also corresponding text input after each click:\n${transcriptString}` : "";

        // Construct the text part for the user, including the transcript and the optional user prompt
        let combinedUserText = transcriptText; // Start with transcript (or message saying none)
        if (userPrompt && userPrompt.trim() !== "") {
            combinedUserText += `\n\nUSER FLOW (or) TASK: ${userPrompt}`;
        }

        console.log('Transcript/user prompt formatted into user prompt text.');

        // 4. Construct the API request payload following documentation structure
        // Build parts array conditionally
        const requestParts: any[] = [];

        // Add video part only if available
        if (videoBase64 && videoMimeType) {
            requestParts.push({
                inline_data: {
                    mime_type: videoMimeType,
                    data: videoBase64
                }
            });
        }

        // Add system prompt text part
        requestParts.push({ text: systemPromptText });

        // Add combined user text part
        requestParts.push({ text: combinedUserText });

        const requestBody = {
            // System instruction should be set if the model supports it directly
            // For older models or direct REST, include it as the first part if needed
            // systemInstruction: { parts: [{ text: systemPromptText }] }, // Use if API supports it
            contents: [
                {
                    // Dynamically built parts array
                    parts: requestParts
                }
            ],
            generationConfig: { // Optional: Add generation config if needed
                // Gemini 2.5 Models support upto 65,536 output tokens.
                "maxOutputTokens": 64000,
                "thinkingConfig": {
                    "thinkingBudget": 24576,
                }
            }
        };

        console.log('Sending request to Gemini API (', GEMINI_MODEL_NAME, ')...');
        // 5. Make the API call - Construct URL with key here
        const apiUrlWithKey = `${GEMINI_API_BASE_URL}?key=${GEMINI_API_KEY}`;
        const response = await fetchWithRetry(apiUrlWithKey, requestBody);

        const responseText = await response.text(); // Get raw text for detailed error logging
        if (!response.ok) {
             console.error(`Gemini API request failed: ${response.status} ${response.statusText}\nResponse body: ${responseText}`);
            throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} - See background logs for details.`);
        }

        const responseData = JSON.parse(responseText); // Parse JSON only if response is ok
        console.log('Gemini API response received successfully:', responseData);

        // 6. Process the response
        let finalResult: string | null = null;
        if (responseData?.candidates && responseData.candidates.length > 0) {
            const candidate = responseData.candidates[0];
            if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
                 console.warn(`Gemini generation finished with reason: ${candidate.finishReason}`);
                 if (candidate.finishReason === 'SAFETY') {
                      sendMessageToPopup({ action: 'showNotification', message: 'AI response blocked due to safety settings.', type: 'error' });
                      // Keep AI generating false, set results to null or error
                      isAiGenerating = false;
                      lastAiResults = 'Error: AI response blocked due to safety settings.';
                      await saveState();
                      sendMessageToPopup({ action: 'showAiMagicResults', results: lastAiResults });
                      return null; // Return null as generation failed
                 } else {
                      sendMessageToPopup({ action: 'showNotification', message: `AI generation stopped unexpectedly (${candidate.finishReason}).`, type: 'warning' });
                 }
            }

            const generatedSteps = candidate?.content?.parts?.[0]?.text;
            finalResult = generatedSteps || null;
            if (generatedSteps) {
                console.log('Generated Steps extracted successfully.'); // Less verbose log
                // Send result back to the correct popup handler
                sendMessageToPopup({ action: 'showAiMagicResults', results: finalResult });
                // Storing these results separately might be good, or just display them
                // chrome.storage.local.set({ generatedSteps: generatedSteps }); // Decide if you want to store this
            } else {
                 console.warn('Could not extract generated steps text from Gemini response candidate.', candidate);
                 finalResult = 'Error: Failed to extract steps from AI analysis response.';
                 sendMessageToPopup({ action: 'showAiMagicResults', results: finalResult }); // Send error to popup
            }
        } else if (responseData.promptFeedback?.blockReason) {
             console.warn(`Prompt blocked by Gemini API. Reason: ${responseData.promptFeedback.blockReason}`);
             // Send error back to the correct popup handler
             finalResult = `Error: AI analysis blocked due to prompt content (Reason: ${responseData.promptFeedback.blockReason}).`;
             sendMessageToPopup({ action: 'showAiMagicResults', results: finalResult });
             sendMessageToPopup({ action: 'showNotification', message: finalResult, type: 'error' });
         } else {
            console.warn('Gemini response received, but no valid candidates or prompt feedback found.', responseData);
            // Send error back to the correct popup handler
            finalResult = 'Error: Received an unexpected response from AI analysis.';
            sendMessageToPopup({ action: 'showAiMagicResults', results: finalResult });
            sendMessageToPopup({ action: 'showNotification', message: finalResult, type: 'warning' });
        }

        // Update state with final result (success or error message)
        isAiGenerating = false;
        lastAiResults = finalResult;
        await saveState();
        // The message to showAiMagicResults was sent earlier inside the if/else blocks
        return finalResult; // Return the result string or null/error string

    } catch (error: any) {
        console.error('Error calling Gemini API or processing its response:', error);
        isAiGenerating = false;
        lastAiResults = `Error during AI analysis: ${error.message}`;
        await saveState();
        sendMessageToPopup({ action: 'showAiMagicResults', results: lastAiResults });
        // Do NOT revoke URL on error anymore
        // if (recordedVideoUrl) {
        //     console.log("Revoking video Blob URL after AI Magic error:", recordedVideoUrl);
        //     try { URL.revokeObjectURL(recordedVideoUrl); } catch(e: any) { console.warn("Error revoking URL on AI Magic error:", e); }
        //     recordedVideoUrl = null;
        // }
        // await saveState(); // State already saved above
        // updatePopupUI(); // UI will be updated by state save if needed
        return null;
    }
}

// --- Internal Helper Functions ---

/**
 * Starts the click recording process in the content script of the active tab.
 * Sets `isRecording` state to true and stores the active tab ID.
 * @param {number | undefined} requestingTabId - The ID of the tab requesting the start (e.g., popup tab).
 * @throws {Error} If recording is already active or no active tab found.
 */
async function startClickRecordingInternal(requestingTabId: number | undefined): Promise<void> {
    // Clear video resources when starting a new click recording (as per plan)
    await clearVideoResources(); // <-- Added this line

    console.log("[Background] Initiating click recording...");
    if (isRecording) {
        throw new Error('Recording is already active.');
    }

    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    // Prioritize the tab that initiated the request if provided
    let targetTab = requestingTabId ? tabs.find(t => t.id === requestingTabId) : tabs[0];

    // If the requesting tab wasn't active/current, fall back to the first active tab
    if (!targetTab && tabs.length > 0) {
        targetTab = tabs[0];
    }

    if (!targetTab?.id || targetTab.url?.startsWith('chrome://')) {
        throw new Error('Cannot record on this page. Please select a valid webpage tab.');
    }
    if (isScreenRecording && screenRecordingTabId !== targetTab.id) {
         // Allow starting click recording if screen recording is already active *on the same tab*
        console.warn("Screen recording is active on a different tab. Click recording will start on the target tab, but this might be confusing.");
        // Consider disallowing this? For now, proceed but warn.
        // throw new Error('Screen recording is active on another tab. Stop it first.');
    }
    if (isRecording && activeTabId === targetTab.id) {
        console.log("Already recording this tab.");
        return; // Already recording this tab
    }
    if (isRecording && activeTabId !== targetTab.id) {
         console.log(`Switching recording from tab ${activeTabId} to ${targetTab.id}`);
         // Stop listening on the old tab
        if(activeTabId !== null) { // add null check
             sendMessageToContentScript(activeTabId, { action: 'stopListening' });
        }
    }

    activeTabId = targetTab.id;
    isRecording = true;
    recordedData = []; // Clear previous data on new recording start
    // DO NOT clear video resources when starting a new click recording
    console.log(`Recording started for tab: ${activeTabId}, URL: ${targetTab.url}`);
    await saveState(); // Save state immediately

    // Inject content script if necessary and start listening
    try {
        await chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            files: ['dist/content/content.js'], // Adjust path if using dist
        });
        console.log("Content script injected/ensured.");
    } catch (err: any) {
        console.error(`Failed to inject content script: ${err.message}`);
        // If injection fails, stop recording
        isRecording = false;
        activeTabId = null;
        await saveState();
        throw new Error(`Failed to prepare tab for recording: ${err.message}`);
    }

    // Send message to start listening after ensuring script is there
    await sendMessageToContentScript(activeTabId, { action: 'startListening' });
    updatePopupUI(); // Update UI after starting
}

/**
 * Helper to stop click recording.
 * Sends 'stopListening' message to the content script.
 * Sets `isRecording` state to false.
 */
function stopClickRecordingInternal(): void {
    if (activeTabId !== null) { // Add null check
        sendMessageToContentScript(activeTabId, { action: 'stopListening' });
    }
    // Don't clear activeTabId here, keep it to know which tab was last recorded
    // activeTabId = null; 
    if (isRecording) {
        isRecording = false;
        console.log("Click recording stopped.");
        // Save state? Let combined actions handle saving.
        // saveState();
        // updatePopupUI(); // Let combined actions handle UI updates.
    } else {
         console.log("Click recording was already stopped.");
    }
}

/**
 * Clears any stored video resources (Blob URL and Blob data).
 * This should ONLY be called when the user explicitly clears data.
 */
// Make function async to allow awaiting saveState
async function clearVideoResources(): Promise<void> {
    if (recordedVideoUrl && typeof recordedVideoUrl === 'string' && recordedVideoUrl.startsWith('blob:')) {
        try {
            console.log("[clearVideoResources] Attempting to revoke URL:", recordedVideoUrl);
            // First check if URL and revokeObjectURL exist before calling
            if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(recordedVideoUrl);
                console.log("[clearVideoResources] Successfully revoked URL.");
            } else {
                console.warn("[clearVideoResources] URL.revokeObjectURL function not available. Skipping revocation.");
            }
        } catch (error) {
            // This catch might still catch other errors during the process
            console.error("[clearVideoResources] Error during URL revocation attempt:", error);
        }
        recordedVideoUrl = null;
    }
    recordedVideoBlob = null; // Clear the blob data too
    console.log("Cleared video resources (URL, Blob).");
    await saveState();
}

/**
 * Initiates the screen recording process by setting up and messaging the offscreen document.
 * @throws {Error} If screen recording is already active or no active tab found.
 */
async function startScreenRecording(): Promise<void> {
    console.log("[Background] Initiating screen recording via offscreen document...");
    if (isScreenRecording) {
        console.warn("[Background] Screen recording is already in progress.");
        throw new Error("Screen recording is already active."); // Throw error to notify caller
    }

    // Get target tab ID for context (though offscreen handles the prompt)
    // Let's try getting the current active tab
    let [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab) {
        console.error("[Background] Could not get active tab to start screen recording.");
        throw new Error("No active tab found for screen recording.");
    }
    screenRecordingTabId = currentTab.id as number; // No assertion needed after check

    // 1. Ensure the offscreen document is ready.
    await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

    // 2. Send message to offscreen document to start the actual recording process
    console.log("[Background] Sending 'start-recording' message to offscreen document...");
    await chrome.runtime.sendMessage({ // Send to specific extension ID if necessary
        target: 'offscreen',
        type: 'start-recording',
        // No streamId needed - offscreen handles acquisition
        tabId: screenRecordingTabId // Send tab ID for context
    });

    console.log("[Background] 'start-recording' message sent to offscreen document.");
    // IMPORTANT: Do NOT set isScreenRecording = true here.
    // State is updated only when 'recording-started' message is received back.

    // Set a timeout to handle the case where 'recording-started' message is not received
    // Define a reasonable timeout duration (e.g., 15 seconds)
    const SCREEN_RECORDING_START_TIMEOUT_MS = 15000; // 15 seconds
    screenRecordingStartTimeout = setTimeout(async () => {
        console.error("[Background] Timeout waiting for 'recording-started' message. Resetting screen recording state.");
        isScreenRecording = false;
        screenRecordingTabId = null;
        // Optionally clear video resources if timeout occurs? Maybe leave for stopRecording to handle.
        await saveState();
        updatePopupUI();
        // Notify user via popup?
        sendMessageToPopup({ action: 'showNotification', message: 'Screen recording failed to start (timeout). Please try again.', type: 'error' });
    }, SCREEN_RECORDING_START_TIMEOUT_MS);

    // Clear previous video data optimistically when starting a *new* screen recording.
    // This assumes the user wants a fresh video if they explicitly press "Start Screen Recording".
    // If they press "Start Both", click recording might have already started, but this ensures
    // any *old* video from a previous session is gone before the *new* screen recording begins.
    await clearVideoResources(); // Use helper - make sure it's async

    // Don't save state or update UI here yet
}

/**
 * Stops the screen recording by sending a message to the offscreen document.
 * The actual state update happens when the 'recording-stopped' message is received back.
 */
async function stopScreenRecording(): Promise<void> {
    console.log("[Background] Attempting to stop screen recording...");
    // Check if offscreen document exists before attempting to stop
    const offscreenExists = await hasOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

    if (!isScreenRecording && !offscreenExists) {
        console.warn("Stop screen recording called, but not active or offscreen doc missing.");
        // Ensure state is consistent even if called erroneously
        isScreenRecording = false;
        screenRecordingTabId = null;
        // Don't clear recordedVideoUrl here, might be needed
        await saveState();
        updatePopupUI();
        return; // Exit if not recording or no offscreen doc
    }

    if (offscreenExists) {
        console.log("[Background] Sending stop-recording message to offscreen document.");
        // Send message to offscreen document to stop recording
        // The offscreen document will send back 'recording-stopped' with the blob URL
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'stop-recording'
        });
        console.log("[Background] stop-recording message sent. Background state will update on 'recording-stopped' response.");
        // State (isScreenRecording=false, URL set) will be updated in the 'recording-stopped' handler
    } else {
        console.warn("[Background] stopScreenRecording called, but offscreen document not found. Attempting to reset state, but browser recording might still be active.");
        // If offscreen is gone, manually reset state
         isScreenRecording = false;
         screenRecordingTabId = null;
         // Cannot retrieve video URL if offscreen is gone. Attempt to clear any stale resources.
         clearVideoResources(); // Use helper
         await saveState();
         updatePopupUI(); // Update UI to reflect the reset state
    }
     // The actual state update (isScreenRecording=false, video URL) happens
     // when the 'recording-stopped' message is received from offscreen.
}

// --- Tab Management for Persistence ---

/**
 * Listener for tab activation changes.
 * Ensures the content script listener is active on the correct tab if recording.
 * @param {chrome.tabs.TabActiveInfo} activeInfo - Information about the activated tab.
 */
chrome.tabs.onActivated.addListener(activeInfo => {
    console.log("Tab activated:", activeInfo);
    // If recording is active but the new tab is different, stop the listener in the old tab
    if (isRecording && activeTabId && activeInfo.tabId !== activeTabId) {
       // No need to stop recording state, just ensure listener is correct
       // sendMessageToContentScript(activeTabId, { action: 'stopListening' }); // Might cause issues if user switches back fast
    } 
    // If recording should continue on the *newly activated* tab and it matches the recording tab
    if (isRecording && activeInfo.tabId === activeTabId) {
        sendMessageToContentScript(activeTabId, { action: 'startListening' });
    }
});

/**
 * Listener for tab updates (e.g., navigation, refresh).
 * Re-attaches the content script listener if the recorded tab is updated.
 * @param {number} tabId - ID of the updated tab.
 * @param {chrome.tabs.TabChangeInfo} changeInfo - Details about the change.
 * @param {chrome.tabs.Tab} tab - The updated tab object.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log(`[onUpdated] Fired for tab ${tabId}. ChangeInfo:`, changeInfo, `Current recording state: {isRecording: ${isRecording}, activeTabId: ${activeTabId}}`);

    if (tabId === activeTabId && isRecording && changeInfo.status === 'complete') {
        console.log(`[onUpdated] Recorded tab ${tabId} finished loading (complete). Attempting to re-apply listener...`);

        // Use an async IIFE to handle script injection and message sending
        (async () => {
            try {
                console.log(`[onUpdated] Injecting content script into tab ${tabId}...`);
                // Ensure the content script is present before sending the message
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['dist/content/content.js'],
                });
                console.log(`[onUpdated] Content script injected/ensured for tab ${tabId}. Sending 'startListening'...`);

                // Now attempt to send the message
                // Note: sendMessageToContentScript already has its own internal try/catch
                await sendMessageToContentScript(tabId, { action: 'startListening' });
                // Log success *if* sendMessageToContentScript resolves without internal error
                // The internal function logs the actual success/failure details.
                console.log(`[onUpdated] Attempted to send 'startListening' to tab ${tabId} (check internal logs for specifics).`);

            } catch (err: any) { // Catch errors specifically from executeScript
                console.error(`[onUpdated] Error during executeScript for tab ${tabId}:`, err);
                // If injection fails, we probably can't send the message anyway.
            }
        })(); // Immediately invoke the async function
    }
});

/**
 * Listener for tab removal.
 * Stops click recording if the recorded tab is closed.
 * @param {number} tabId - ID of the removed tab.
 * @param {chrome.tabs.TabRemoveInfo} removeInfo - Information about the removal.
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === activeTabId) {
        console.log(`Recorded tab ${tabId} was closed. Stopping recording.`);
        isRecording = false;
        recordedData = []; // Or keep data? User decision. Let's clear for now.
        activeTabId = null;
        saveState();
        updatePopupUI(); // Update popup if it's open
    }
    // Consider stopping screen recording if screenRecordingTabId is closed?
    // Current implementation relies on user stopping via button or offscreen handling stream end.
});

// --- Data Formatting Helper ---

/**
 * Formats the recorded event data into a string suitable for download or API usage.
 * @param {Array<Object>} data - The array of recorded event objects.
 * @param {boolean} [includeDom=true] - Whether to include the detailed DOM structure for clicks.
 *                                      Set to false for a simpler format (e.g., for API). 
 * @returns {string|null} A formatted string representation of the data, or null if input is empty/invalid.
 */
function formatRecordedDataForDownload(data: Array<any>, includeDom = true): string | null {
    const dataArray = Array.isArray(data) ? data : [];

    if (dataArray.length === 0) {
        console.warn("No data to format.");
        return null;
    }

    const formattedData = dataArray.map(item => {
        if (item.type === 'click') {
            let output = `Type: Click`;
            if (includeDom) {
                 // Format the DOM structure for the download file
                const ancestorHTML = item.domStructure?.[0]; // Might be null
                const clickedHTML = item.domStructure?.[1] || '[Clicked Element Not Available]';
                 output += `\n`; // Newline before details
                if (ancestorHTML) {
                   output += `Clicked Elements + Ancestors:\n${ancestorHTML}\n---\n`;
                }
                output += `Clicked Element:\n${clickedHTML}`;
            } else {
                // Simple format: try to get a selector if possible (best effort)
                // Note: This requires getCssSelector logic, which isn't directly available here.
                // For simplicity, just indicate a click occurred if not including DOM.
                 output += ` (DOM structure omitted)`;
            }
            return output;
        } else if (item.type === 'inputChange') {
            const before = item.beforeValue === '' ? '[Empty]' : item.beforeValue;
            const after = item.afterValue === '' ? '[Empty]' : item.afterValue;
            return `Type: Input Change\nSelector: ${item.selector}\nBefore Value: ${before || 'N/A'}\nAfter Value: ${after || 'N/A'}`;
        } else {
            console.warn("Unknown item type in formatRecordedDataForDownload:", item);
            return `Type: Unknown\nTimestamp: ${item.timestamp || 'N/A'}`;
        }
    }).join('\n---\n'); // Separate entries clearly in the file

    return formattedData; // Return the formatted string
}