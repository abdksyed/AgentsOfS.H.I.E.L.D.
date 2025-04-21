/** @type {boolean} - Whether click/input recording is active */
let isRecording = false;
/** @type {Array<Object>} - Array storing recorded click and input change events */
let recordedData = [];
/** @type {number | null} - ID of the tab currently being recorded for clicks/inputs */
let activeTabId = null;

// State for screen recording
/** @type {boolean} - Whether screen recording is active */
let isScreenRecording = false;
/** @type {number | null} - ID of the tab targeted for screen recording (may differ from active media stream tab) */
let screenRecordingTabId = null;
/** @type {string | null} - Blob URL for the latest completed screen recording */
let recordedVideoUrl = null;
/** @type {number | null} - Timer ID for revoking the recordedVideoUrl if unused */
let screenRecordingCleanupTimer = null;
/** @type {Blob | null} - The actual Blob data for the latest completed screen recording */
let recordedVideoBlob = null;

// --- Constants ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';
const VIDEO_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// --- Storage Functions ---
/**
 * Loads the extension state (recording status, data, active tab) from local storage.
 */
async function loadState() {
    const result = await chrome.storage.local.get(['isRecording', 'recordedData', 'activeTabId']);
    isRecording = result.isRecording || false;
    recordedData = result.recordedData || [];
    activeTabId = result.activeTabId || null;
    console.log('Initial state loaded:', { isRecording, recordedData, activeTabId });
    // If recording was active, ensure the listener is attached in the content script for that tab
    if (isRecording && activeTabId) {
        sendMessageToContentScript(activeTabId, { action: 'startListening' });
    }
}

/**
 * Saves the current extension state to local storage.
 * Does not save Blob URLs or Blob data.
 */
async function saveState() { // Add screen recording state
    // Don't save the blob URL or blob itself to storage, only keep in memory
    await chrome.storage.local.set({
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording, // Keep track if screen recording *should* be active
        screenRecordingTabId // Keep track of the target tab
    });
    console.log('State saved:', { isRecording, recordedData, activeTabId, isScreenRecording, screenRecordingTabId });
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
let creatingOffscreenDocument = null;

/**
 * Checks if an offscreen document with the specified path already exists.
 * @param {string} path - The path of the offscreen document HTML file.
 * @returns {Promise<boolean>} True if the document exists, false otherwise.
 */
async function hasOffscreenDocument(path) {
    // Check all existing contexts for a match.
    const offscreenUrl = chrome.runtime.getURL(path);
    // Use chrome.runtime.getContexts() to check for the offscreen document.
    // This is the recommended approach in Manifest V3.
    const contexts = await chrome.runtime.getContexts({ 
        contextTypes: ['OFFSCREEN_DOCUMENT'], 
        documentUrls: [offscreenUrl] 
    });
    return contexts && contexts.length > 0;
}

/**
 * Creates an offscreen document if it doesn't already exist.
 * Required for accessing navigator.mediaDevices.getDisplayMedia.
 * @param {string} path - The path to the offscreen document HTML file.
 */
async function setupOffscreenDocument(path) {
    // If we do not have an offscreen document, create one.
    if (!(await hasOffscreenDocument(path))) {
        // Create the offscreen document, handling potential race conditions.
        if (creatingOffscreenDocument) {
            await creatingOffscreenDocument;
        } else {
            creatingOffscreenDocument = chrome.offscreen.createDocument({
                url: path,
                reasons: ['USER_MEDIA'],
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
async function sendMessageToPopup(message) {
    try {
        await chrome.runtime.sendMessage(message);
        console.log("Sent message to popup:", message);
    } catch (error) {
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
async function sendMessageToContentScript(tabId, message) {
    try {
        await chrome.tabs.sendMessage(tabId, message);
        console.log(`Sent message to content script in tab ${tabId}:`, message);
    } catch (error) {
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
async function updatePopupUI() { // Make function async
    const hasVideo = !!recordedVideoUrl || !!recordedVideoBlob; // Check if we have a URL or blob ready
    console.log("[Background] Updating Popup UI with state:", { isRecording, activeTabId, isScreenRecording, hasVideo }); // Log hasVideo

    sendMessageToPopup({
        action: 'updatePopup',
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording,
        hasVideo, // Send boolean flag instead of URL
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Background] Message received:", message, "from sender:", sender?.tab?.id ? `tab ${sender.tab.id}` : sender?.id ? `extension ${sender.id}` : 'unknown');
    let needsAsyncResponse = false;

    // Combined Action
    if (message.action === 'startBothRecordings') {
        needsAsyncResponse = true; // Needs async for both start actions
        // Start click recording first (synchronous part of setup)
        startClickRecordingInternal(sender.tab?.id) // Use internal helper
            .then(() => {
                // Then start screen recording (which involves async user prompt)
                return startScreenRecording();
            })
            .then(() => {
                console.log("[Background] Both recordings initiated.");
                sendResponse({ success: true });
            })
            .catch(err => {
                console.error("[Background] Error starting both recordings:", err);
                // Attempt to stop anything that might have started
                if (isRecording) stopClickRecordingInternal();
                if (isScreenRecording) stopScreenRecording(); // Call async stop
                sendResponse({ success: false, error: err.message });
            });
    }
    // --- Stop Both Action ---
    else if (message.action === 'stopBothRecordings') {
        needsAsyncResponse = true; // Needs async for screen recording stop
        console.log("[Background] Received 'stopBothRecordings' action message.");
        // Stop click recording first (synchronous parts)
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
            .catch(err => {
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
    // --- Click Recording Actions ---
    else if (message.action === 'startRecording') {
        needsAsyncResponse = true;
        startClickRecordingInternal(sender.tab?.id)
             .then(() => sendResponse({ success: true }))
             .catch(err => {
                 console.error("[Background] Error starting click recording:", err);
                 sendResponse({ success: false, error: err.message });
             });
    } else if (message.action === 'resumeRecording') {
        if (activeTabId && !isRecording) { // Can only resume if paused (activeTabId exists and not recording)
            isRecording = true;
            // DO NOT clear recordedData
            saveState();
            sendMessageToContentScript(activeTabId, { action: 'startListening' });
            updatePopupUI();
            sendResponse({ success: true });
            console.log("Recording resumed for tab:", activeTabId);
        } else {
            console.warn("Cannot resume recording. Condition not met:", {activeTabId, isRecording});
             sendResponse({ success: false, error: "Cannot resume" });
        }
    } else if (message.action === 'stopRecording') {
        stopClickRecordingInternal(); // Use internal helper
        saveState(); // Save state after stopping
        updatePopupUI();
        sendResponse({ success: true });
    } else if (message.action === 'clearRecording') {
        // Clear existing data
        recordedData = [];
        activeTabId = null;

        // Clean up video resources if they exist
        if (recordedVideoUrl) {
            try {
                self.URL.revokeObjectURL(recordedVideoUrl);
                console.log("Revoked existing video URL on clear.");
            } catch (e) { console.error("Error revoking video URL on clear:", e); }
            recordedVideoUrl = null;
        }
        recordedVideoBlob = null; // Also clear any stored blob

        isRecording = false;
        isScreenRecording = false;
        screenRecordingTabId = null;

        // Clear generated steps as well
        chrome.storage.local.remove('generatedSteps');

        saveState(); // Save the cleared state
        updatePopupUI();
        console.log("Cleared recording data, state, video resources, and steps.");
        sendResponse({ success: true });
    } else if (message.action === 'getInitialState') {
        // Load the latest state from storage first
        loadState().then(() => {
             // Send initial state including video availability
            const hasVideo = !!recordedVideoUrl || !!recordedVideoBlob;
            const responsePayload = {
                isRecording,
                recordedData,
                activeTabId,
                isScreenRecording,
                hasVideo // Send boolean
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
                 hasVideo: false
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
    // --- Screen Recording Actions ---
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
    // --- NEW: Download Video Action ---
    else if (message.action === 'downloadVideoAction') {
         console.log("[Background] Received 'downloadVideoAction'.");
         // Re-create a Blob URL if it was revoked but the Blob is still cached
         if (!recordedVideoUrl && recordedVideoBlob) {
             console.log("[Background] Recreating Blob URL from cached Blob for download.");
             try {
                 recordedVideoUrl = URL.createObjectURL(recordedVideoBlob);
                 // Re-set the cleanup timer for the new URL
                 clearTimeout(screenRecordingCleanupTimer);
                 screenRecordingCleanupTimer = setTimeout(() => {
                    console.warn(`[Background] Cleaning up re-created video Blob URL and Blob after ${VIDEO_CLEANUP_DELAY_MS / 1000}s timeout.`);
                    clearVideoResources();
                    saveState();
                    updatePopupUI();
                    screenRecordingCleanupTimer = null;
                 }, VIDEO_CLEANUP_DELAY_MS);
                 console.log(`[Background] Set cleanup timer ${screenRecordingCleanupTimer} for re-created video URL.`);
             } catch (error) {
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
                     // IMPORTANT: Do NOT revoke the URL here. Revocation happens after Gemini call.
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
    // --- NEW: Generate Steps with AI Action ---
    else if (message.action === 'generateStepsWithAI') {
        console.log("[Background] Received 'generateStepsWithAI' action.");
        needsAsyncResponse = true;

        // Check prerequisites
        if (!recordedVideoUrl && !recordedVideoBlob) {
            console.error("Cannot generate steps: No video data available.");
            sendMessageToPopup({ action: 'showNotification', message: 'Error: No video data found for analysis.', type: 'error' });
            sendResponse({ success: false, error: 'No video data' });
            return needsAsyncResponse; // Exit early
        }
        if (!recordedData || recordedData.length === 0) {
            console.error("Cannot generate steps: No click/input data available.");
            sendMessageToPopup({ action: 'showNotification', message: 'Error: No recorded actions found for analysis.', type: 'error' });
            sendResponse({ success: false, error: 'No click data' });
             // Clean up video if no clicks? Maybe not, user might want to download video still.
            return needsAsyncResponse; // Exit early
        }

        (async () => { // Wrap in async IIFE to handle await
            let videoBlobToProcess = recordedVideoBlob; // Use stored blob if available

            try {
                 // --- Fetch Blob if only URL exists ---
                if (!videoBlobToProcess && recordedVideoUrl) {
                    console.log("Fetching video blob from URL for Gemini:", recordedVideoUrl);
                    const response = await fetch(recordedVideoUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch video blob: ${response.statusText} (URL: ${recordedVideoUrl})`);
                    }
                    videoBlobToProcess = await response.blob();
                    recordedVideoBlob = videoBlobToProcess; // Store the fetched blob
                    console.log("Video blob fetched successfully for Gemini.");
                }

                if (!videoBlobToProcess) {
                     throw new Error("Video blob could not be obtained.");
                }

                // --- Call Gemini API ---
                console.log("Calling Gemini API with video blob and transcript data...");
                sendMessageToPopup({ action: 'showNotification', message: 'Analyzing recording with AI...', type: 'info' });
                await callGeminiApi(videoBlobToProcess, recordedData); // Assumes callGeminiApi handles sending results/errors to popup
                console.log("Gemini API call completed (or backgrounded).");

                // --- Cleanup ---
                console.log("Revoking video Blob URL (if exists) after Gemini processing:", recordedVideoUrl);
                if (recordedVideoUrl) {
                    try { self.URL.revokeObjectURL(recordedVideoUrl); } catch (e) { console.warn("Error revoking URL post-Gemini:", e); }
                    recordedVideoUrl = null; // Clear the URL state variable
                }
                // Keep recordedVideoBlob in memory? Or clear it? Let's clear it for now.
                // recordedVideoBlob = null;
                // If we clear the blob, subsequent Generate clicks or downloads would fail.
                // Let's keep the blob but clear the URL. The blob can be reused.

                await saveState(); // Save state reflecting URL cleanup
                updatePopupUI(); // Update UI (e.g., disable Generate button if needed, though callGeminiApi might do this)
                sendResponse({ success: true }); // Respond that the process was initiated

            } catch (error) {
                console.error("Error during Gemini API call or video fetch for generation:", error);
                sendMessageToPopup({ action: 'showNotification', message: `Error processing video for AI: ${error.message}`, type: 'error' });

                // Attempt cleanup even on error
                if (recordedVideoUrl) {
                    try { self.URL.revokeObjectURL(recordedVideoUrl); } catch(e) { console.warn("Error revoking URL on Gemini error:", e); }
                    recordedVideoUrl = null;
                }
                // Don't clear blob on error? Maybe keep it for download attempt.
                // recordedVideoBlob = null;

                await saveState(); // Save cleaned-up state
                updatePopupUI(); // Update UI
                sendResponse({ success: false, error: error.message });
            }
        })(); // End async IIFE

    }
    // --- NEW: Save API Key Action ---
    else if (message.action === 'saveApiKey') {
        const newApiKey = message.apiKey;
        if (newApiKey && typeof newApiKey === 'string') {
            needsAsyncResponse = true;
            chrome.storage.local.set({ geminiApiKey: newApiKey }, () => {
                if (chrome.runtime.lastError) {
                    console.error("[Background] Error saving Gemini API Key to storage:", chrome.runtime.lastError.message);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    GEMINI_API_KEY = newApiKey; // Update the global variable immediately
                    console.log("[Background] Gemini API Key saved to storage and updated globally.");
                    sendResponse({ success: true });
                }
            });
        } else {
            console.error("[Background] Invalid API key received for saving.");
            sendResponse({ success: false, error: "Invalid API key provided" });
        }
    }
    // --- Generate with AI Magic + User Prompt ---
    else if (message.action === 'generateWithAiMagic') {
        console.log("[Background] Received 'generateWithAiMagic' action with user prompt:", message.userPrompt);
        needsAsyncResponse = true;

        const userProvidedPrompt = message.userPrompt || ""; // Get the user's prompt

        // Check prerequisites (same as generateStepsWithAI)
        if (!recordedVideoUrl && !recordedVideoBlob) {
            console.error("Cannot generate steps: No video data available.");
            sendMessageToPopup({ action: 'showNotification', message: 'Error: No video data found for analysis.', type: 'error' });
            sendResponse({ success: false, error: 'No video data' });
            return needsAsyncResponse;
        }
        if (!recordedData || recordedData.length === 0) {
            console.error("Cannot generate steps: No click/input data available.");
            sendMessageToPopup({ action: 'showNotification', message: 'Error: No recorded actions found for analysis.', type: 'error' });
            sendResponse({ success: false, error: 'No click data' });
            return needsAsyncResponse;
        }

        (async () => {
            let videoBlobToProcess = recordedVideoBlob;

            try {
                if (!videoBlobToProcess && recordedVideoUrl) {
                    console.log("Fetching video blob from URL for AI Magic Gemini:", recordedVideoUrl);
                    const response = await fetch(recordedVideoUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch video blob: ${response.statusText}`);
                    }
                    videoBlobToProcess = await response.blob();
                    recordedVideoBlob = videoBlobToProcess; // Store fetched blob
                    console.log("Video blob fetched successfully for AI Magic Gemini.");
                }

                if (!videoBlobToProcess) {
                     throw new Error("Video blob could not be obtained.");
                }

                console.log("Calling Gemini API (AI Magic) with video, transcript, and user prompt...");
                sendMessageToPopup({ action: 'showNotification', message: 'Analyzing recording with AI Magic...', type: 'info' });
                
                // Call Gemini, passing the user's prompt
                await callGeminiApi(videoBlobToProcess, recordedData, userProvidedPrompt); 
                
                console.log("AI Magic Gemini API call completed (or backgrounded).");

                // Cleanup URL (keep blob for potential reuse/download)
                if (recordedVideoUrl) {
                    console.log("Revoking video Blob URL after AI Magic processing attempt:", recordedVideoUrl);
                    try { URL.revokeObjectURL(recordedVideoUrl); } catch (e) { console.warn("Error revoking URL post-AI Magic:", e); }
                    recordedVideoUrl = null; // Clear the URL state variable
                }
                await saveState(); // Save state reflecting URL cleanup
                updatePopupUI();
                sendResponse({ success: true }); // Respond that process was initiated

            } catch (error) {
                console.error("Error during AI Magic Gemini call or video fetch:", error);
                sendMessageToPopup({ action: 'showNotification', message: `Error processing video for AI Magic: ${error.message}`, type: 'error' });

                if (recordedVideoUrl) {
                    console.log("Revoking video Blob URL after AI Magic error:", recordedVideoUrl);
                    try { URL.revokeObjectURL(recordedVideoUrl); } catch(e) { console.warn("Error revoking URL on AI Magic error:", e); }
                    recordedVideoUrl = null;
                }
                await saveState();
                updatePopupUI();
                sendResponse({ success: false, error: error.message });
            }
        })();

    }
    // --- Message from Offscreen Document ---
    else if (message.target === 'background' && (message.type === 'recording-stopped' || message.type === 'recording-error')) {
        
        // Always reset recording state regardless of success/error
        isScreenRecording = false;
        screenRecordingTabId = null;
        
        // Clear any pending cleanup timer first
        if (screenRecordingCleanupTimer) {
            console.log("[Background] Clearing cleanup timer:", screenRecordingCleanupTimer);
            clearTimeout(screenRecordingCleanupTimer);
            screenRecordingCleanupTimer = null;
        }

        if (message.type === 'recording-stopped' && message.url) {
            console.log("[Background] Received 'recording-stopped' message from offscreen with URL:", message.url);
            recordedVideoUrl = message.url; // Store the Blob URL
            recordedVideoBlob = null; // Clear any previously stored blob
            console.log("[Background] Stored new video Blob URL.");

            // Set a timer to revoke the URL and clear the blob if it's not used (e.g., by Gemini or download) within a reasonable time
            clearTimeout(screenRecordingCleanupTimer); // Clear any existing timer
            screenRecordingCleanupTimer = setTimeout(() => {
                console.warn(`[Background] Cleaning up unused video Blob URL and Blob after ${VIDEO_CLEANUP_DELAY_MS / 1000}s timeout.`);
                clearVideoResources(); // Use helper to clear URL and Blob
                saveState(); // Save state after cleanup
                updatePopupUI(); // Reflect timeout in UI
                screenRecordingCleanupTimer = null;
            }, VIDEO_CLEANUP_DELAY_MS);
            console.log(`[Background] Set cleanup timer ${screenRecordingCleanupTimer} for video URL and Blob.`);

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
        
        // Update state and UI after handling message
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
            } catch (error) {
                 console.error("[Background] Error preparing events data for download:", error);
                 sendMessageToPopup({ action: 'showNotification', message: `Error preparing download: ${error.message}`, type: 'error' });
                 sendResponse({ success: false, error: error.message });
            }
        }
    }

    // --- Fallback for unhandled actions ---
    else {
        console.warn("Unhandled message action:", message.action);
        // Optionally send a response for unhandled actions
        // sendResponse({ success: false, error: `Unhandled action: ${message.action}` });
    }

    return needsAsyncResponse; // Required for async responses
});

// --- Gemini API Integration ---
// Retrieve API key at runtime - never store the plain key in source control
// Use an IIFE to handle top-level await for storage access
let GEMINI_API_KEY = null;
+(async () => {
    try {
        const result = await chrome.storage.local.get('geminiApiKey');
        if (result.geminiApiKey) {
            GEMINI_API_KEY = result.geminiApiKey;
            console.log("Gemini API Key loaded from storage.");
        } else {
            console.warn("Gemini API Key not found in chrome.storage.local. Please set it via options page or manually.");
            // Consider providing a way for the user to set this key
        }
    } catch (error) {
        console.error("Error loading Gemini API Key from storage:", error);
    }
})();

// Use the new model name in the URL
const GEMINI_MODEL_NAME = 'gemini-2.5-flash-preview-04-17';
// Base URL - Key will be appended in callGeminiApi if available
const GEMINI_API_BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent`;

/**
 * Helper function to convert Blob to Base64 string.
 * @param {Blob} blob - The Blob to convert.
 * @returns {Promise<string>} A promise that resolves with the Base64 encoded string (without the data: prefix).
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]); // Get only the Base64 part
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Calls the Gemini API to generate step-by-step instructions based on video and recorded actions.
 * @param {Blob} videoBlob - The recorded video as a Blob.
 * @param {Array<Object>} transcriptData - Array of recorded click/input events.
 * @param {string} [userPrompt=""] - Optional additional user-provided prompt/context.
 * @returns {Promise<string|null>} A promise that resolves with the generated steps text, or null on error.
 */
async function callGeminiApi(videoBlob, transcriptData, userPrompt = "") {
    if (!GEMINI_API_KEY) {
        const errorMsg = 'Gemini API Key not configured. Please set it in extension settings/storage.';
        console.warn(errorMsg);
        // Send result back to the correct popup handler
        sendMessageToPopup({ action: 'showAiMagicResults', results: `Error: ${errorMsg}` }); 
        // Also send a notification for clarity
        sendMessageToPopup({ action: 'showNotification', message: errorMsg, type: 'error' });
        return null;
    }

    console.log('Preparing data for Gemini API (', GEMINI_MODEL_NAME, ')...');
    try {
        // 1. Fetch the system prompt
        const promptResponse = await fetch(chrome.runtime.getURL('step_gen_prompt.md'));
        if (!promptResponse.ok) {
            throw new Error(`Failed to fetch prompt: ${promptResponse.statusText}`);
        }
        const systemPromptText = await promptResponse.text();
        console.log('System prompt fetched successfully.');

        // 2. Prepare video data
        const videoBase64 = await blobToBase64(videoBlob);
        const videoMimeType = videoBlob.type || 'video/webm'; // Use blob type or default
        console.log(`Video converted to Base64 (MIME type: ${videoMimeType}).`);

        // 3. Prepare transcript data string using the formatter
        const transcriptString = formatRecordedDataForDownload(transcriptData, false); // Get simple format for API
        if (!transcriptString) {
            throw new Error("Failed to format transcript data for Gemini API.");
        }

        // Construct the text part for the user, including the transcript and the optional user prompt
        let combinedUserText = `Here is the transcript of user actions:\n${transcriptString}`;
        if (userPrompt && userPrompt.trim() !== "") {
            combinedUserText += `\n\nUser provided context/prompt: ${userPrompt}`;
        }
        combinedUserText += `\n\nBased *only* on the provided video and the transcript (and user context if provided), generate the detailed step-by-step description of the user flow according to the initial instructions. Focus on what is visible and interacted with.`;

        console.log('Transcript and user prompt formatted into user prompt text.');

        // 4. Construct the API request payload following documentation structure
        const requestBody = {
            // System instruction should be set if the model supports it directly
            // For older models or direct REST, include it as the first part if needed
            // systemInstruction: { parts: [{ text: systemPromptText }] }, // Use if API supports it
            contents: [
                {
                    // Combine video and user prompt in one content object
                    parts: [
                        {
                            // Video part
                            inline_data: {
                                mime_type: videoMimeType, 
                                data: videoBase64
                            }
                        },
                        { 
                            // Include the system prompt as the first text part for context
                            text: systemPromptText 
                        }, 
                        { 
                            // User prompt part (transcript + optional user prompt + instruction)
                            text: combinedUserText 
                        }
                    ]
                }
            ],
            generationConfig: { // Optional: Add generation config if needed
                 "maxOutputTokens": 16384, // Increased for potentially long steps
                 "temperature": 0.2, // Slightly creative but mostly factual
                 "topP": 0.95,
                 "topK": 40
            }
        };

        console.log('Sending request to Gemini API (', GEMINI_MODEL_NAME, ')...');
        // 5. Make the API call - Construct URL with key here
        const fullApiUrl = `${GEMINI_API_BASE_URL}?key=${GEMINI_API_KEY}`;
        const response = await fetch(fullApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        const responseText = await response.text(); // Get raw text for detailed error logging
        if (!response.ok) {
             console.error(`Gemini API request failed: ${response.status} ${response.statusText}\nResponse body: ${responseText}`);
            throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} - See background logs for details.`);
        }

        const responseData = JSON.parse(responseText); // Parse JSON only if response is ok
        console.log('Gemini API response received successfully:', responseData);

        // 6. Process the response
        if (responseData.candidates && responseData.candidates.length > 0) {
            const candidate = responseData.candidates[0];
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                 console.warn(`Gemini generation finished with reason: ${candidate.finishReason}`);
                 if (candidate.finishReason === 'SAFETY') {
                      sendMessageToPopup({ action: 'showNotification', message: 'AI response blocked due to safety settings.', type: 'error' });
                      return null;
                 } else {
                      sendMessageToPopup({ action: 'showNotification', message: `AI generation stopped unexpectedly (${candidate.finishReason}).`, type: 'warning' });
                 }
            }
            
            const generatedSteps = candidate?.content?.parts?.[0]?.text;
            if (generatedSteps) {
                console.log('Generated Steps extracted successfully.'); // Less verbose log
                // Send result back to the correct popup handler
                sendMessageToPopup({ action: 'showAiMagicResults', results: generatedSteps });
                // Storing these results separately might be good, or just display them
                // chrome.storage.local.set({ generatedSteps: generatedSteps }); // Decide if you want to store this
                return generatedSteps;
            } else {
                 console.warn('Could not extract generated steps text from Gemini response candidate.', candidate);
                 // Send error back to the correct popup handler
                 sendMessageToPopup({ action: 'showAiMagicResults', results: 'Error: Failed to extract steps from AI analysis response.' });
                 sendMessageToPopup({ action: 'showNotification', message: 'Failed to extract steps from AI analysis response.', type: 'warning' });
                 return null;
            }
        } else if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
             console.warn(`Prompt blocked by Gemini API. Reason: ${responseData.promptFeedback.blockReason}`);
             // Send error back to the correct popup handler
             sendMessageToPopup({ action: 'showAiMagicResults', results: `Error: AI analysis blocked due to prompt content (Reason: ${responseData.promptFeedback.blockReason}).` });
             sendMessageToPopup({ action: 'showNotification', message: `AI analysis blocked due to prompt content (Reason: ${responseData.promptFeedback.blockReason}).`, type: 'error' });
             return null;
         } else {
            console.warn('Gemini response received, but no valid candidates or prompt feedback found.', responseData);
            // Send error back to the correct popup handler
            sendMessageToPopup({ action: 'showAiMagicResults', results: 'Error: Received an unexpected response from AI analysis.' });
            sendMessageToPopup({ action: 'showNotification', message: 'Received an unexpected response from AI analysis.', type: 'warning' });
            return null;
        }

    } catch (error) {
        console.error('Error calling Gemini API or processing its response:', error);
        // Send error back to the correct popup handler
        sendMessageToPopup({ action: 'showAiMagicResults', results: `Error during AI analysis: ${error.message}` }); 
        sendMessageToPopup({ action: 'showNotification', message: `Error during AI analysis: ${error.message}`, type: 'error' });
        return null;
    }
}

// --- Internal Helper Functions ---

/**
 * Refactored logic to start click/input recording.
 * Finds the active tab, sends 'startListening' to content script, updates state.
 * @param {number} [requestingTabId] - The ID of the tab initiating the request (e.g., from popup).
 * @throws {Error} If no suitable active tab is found or if screen recording is active.
 */
async function startClickRecordingInternal(requestingTabId) {
     console.log("[Background] Attempting to start click recording.");
     let tabs = await chrome.tabs.query({ active: true, currentWindow: true });

     if (tabs.length === 0 && requestingTabId) {
         // Fallback if no active tab in current window, but request came from a specific tab (e.g., popup)
          try {
             const requestingTab = await chrome.tabs.get(requestingTabId);
             if (requestingTab) {
                 tabs = [requestingTab];
                 console.log("[Background] Using requesting tab ID for click recording.")
             }
          } catch (e) {
             console.warn("[Background] Could not get requesting tab info:", e);
          }
     }

    if (tabs.length === 0) {
        console.error("[Background] No suitable active tab found to start click recording.");
        throw new Error("No active tab for click recording");
    }
    
    const targetTabId = tabs[0].id;
    
    // Check if screen recording is already active.
    // We simplified this check as screenRecordingTabId is null with getDisplayMedia.
    if (isScreenRecording) {
         console.warn(`[Background] Cannot start click recording on tab ${targetTabId} because screen recording is active.`);
         throw new Error("Screen recording already active");
    }

    // Proceed if no screen recording.
    console.log(`[Background] Proceeding with click recording start for tab ${targetTabId}.`);
    activeTabId = targetTabId;
    isRecording = true;
    recordedData = []; // Start always clears previous data
    await saveState();
    await sendMessageToContentScript(activeTabId, { action: 'startListening' });
    updatePopupUI();
    console.log("[Background] Click recording started for tab:", activeTabId);
}

/**
 * Helper to stop click recording.
 * Sends 'stopListening' message to the content script.
 * Sets `isRecording` state to false.
 */
function stopClickRecordingInternal() {
    if (activeTabId) {
        sendMessageToContentScript(activeTabId, { action: 'stopListening' });
        console.log("Sent stopListening to tab:", activeTabId);
    } else {
         console.log("stopClickRecordingInternal called but no activeTabId.");
    }
    isRecording = false;
    // Don't nullify activeTabId here if we want to allow resume/clear later
    // activeTabId = null; // Clearing this prevents resuming the same session
    console.log("Click recording stopped internally.");
    // State saving is handled by the caller (e.g., stopBothRecordings or the 'stopRecording' action)
}

/**
 * Clears any stored video resources (Blob URL and Blob data).
 * Also clears the cleanup timer associated with the video URL.
 */
function clearVideoResources() {
    if (screenRecordingCleanupTimer) {
        clearTimeout(screenRecordingCleanupTimer);
        screenRecordingCleanupTimer = null;
        console.log("Cleared video cleanup timer.");
    }
    if (recordedVideoUrl) {
        try {
            URL.revokeObjectURL(recordedVideoUrl);
            console.log("Revoked video Blob URL.");
        } catch (e) {
            console.warn("Error revoking video Blob URL during clear:", e);
        }
        recordedVideoUrl = null;
    }
    if (recordedVideoBlob) {
        recordedVideoBlob = null;
        console.log("Cleared video Blob data.");
    }
}

/**
 * Initiates the screen recording process by setting up and messaging the offscreen document.
 * @throws {Error} If screen recording is already active or no active tab found.
 */
async function startScreenRecording() {
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
    screenRecordingTabId = currentTab.id;

    // 1. Ensure the offscreen document is ready.
    await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

    // 2. Send message to offscreen document to start the actual recording process
    await chrome.runtime.sendMessage({ // Send to specific extension ID if necessary
        target: 'offscreen',
        type: 'start-recording',
        // No streamId needed - offscreen handles acquisition
        tabId: screenRecordingTabId // Send tab ID for context
    });

    console.log("[Background] 'start-recording' message sent to offscreen document.");
    // IMPORTANT: Do NOT set isScreenRecording = true here.
    // State is updated only when 'recording-started' message is received back.

    // Clear previous video data optimistically
    clearVideoResources(); // Use helper

    // Don't save state or update UI here yet
}

/**
 * Stops the screen recording by sending a message to the offscreen document.
 * The actual state update happens when the 'recording-stopped' message is received back.
 */
async function stopScreenRecording() {
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
        console.log("[Background] stop-recording message sent. Waiting for 'recording-stopped' response.");
        // State (isScreenRecording=false, URL set) will be updated in the 'recording-stopped' handler
    } else {
        console.warn("[Background] stopScreenRecording called, but offscreen document no longer exists. Resetting state.");
        // If offscreen is gone, manually reset state
         isScreenRecording = false;
         screenRecordingTabId = null;
         // Cannot retrieve video URL if offscreen is gone
         clearVideoResources(); // Use helper
         await saveState();
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
    // Check if the update is for the tab we are recording and the tab has finished loading
    if (tabId === activeTabId && isRecording && changeInfo.status === 'complete') {
        console.log(`Tab ${tabId} updated (complete), re-applying listener.`);
        // Re-apply the listener in the content script after navigation/refresh
        sendMessageToContentScript(tabId, { action: 'startListening' });
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
function formatRecordedDataForDownload(data, includeDom = true) {
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