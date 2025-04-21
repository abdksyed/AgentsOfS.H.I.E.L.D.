let isRecording = false;
let recordedData = [];
let activeTabId = null;

// State for screen recording
let isScreenRecording = false;
let screenRecordingTabId = null; // Tab being screen recorded
let recordedVideoUrl = null; // Stores the Blob URL temporarily
let screenRecordingCleanupTimer = null; // Timer ID for cleanup
let recordedVideoBlob = null; // Store the blob itself after fetch for potential reuse

// --- Storage Functions ---
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

async function saveState() { // Add screen recording state
    // Don't save the blob URL or blob itself to storage, only keep in memory
    await chrome.storage.local.set({
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording, // Keep track if screen recording *should* be active
        screenRecordingTabId // Keep track of the target tab
    });
    // console.log('State saved:', { isRecording, recordedData, activeTabId, isScreenRecording, screenRecordingTabId });
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
let creatingOffscreenDocument = null; // Promise to prevent race conditions

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

async function updatePopupUI() { // Make function async
    const hasVideo = !!recordedVideoUrl || !!recordedVideoBlob; // Check if we have a URL or blob ready
    console.log("[Background] Updating Popup UI with state:", { isRecording, activeTabId, isScreenRecording, hasVideo }); // Log hasVideo

    const stepsResult = await chrome.storage.local.get(['generatedSteps']);

    sendMessageToPopup({
        action: 'updatePopup',
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording,
        hasVideo, // Send boolean flag instead of URL
        generatedSteps: stepsResult.generatedSteps || null
    });
}

// --- Event Handlers ---
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
    } else if (message.action === 'getRecordedData') {
        sendResponse({ data: recordedData });
    } else if (message.action === 'recordClick') {
        if (isRecording && sender.tab && sender.tab.id === activeTabId) {
            // Add standard click event, mark with type for clarity
            recordedData.push({
                type: 'click', // Explicitly mark type
                selector: message.selector,
                text: message.text,
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

            // Set a timer to revoke the URL if it's not used (e.g., by Gemini) within a reasonable time
            const CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes
            screenRecordingCleanupTimer = setTimeout(() => {
                if (recordedVideoUrl) {
                    console.warn(`[Background] Cleaning up unused video Blob URL after ${CLEANUP_DELAY_MS / 1000}s:`, recordedVideoUrl);
                    try { self.URL.revokeObjectURL(recordedVideoUrl); } catch(e) {}
                    recordedVideoUrl = null;
                    recordedVideoBlob = null; // Also clear blob if URL times out
                    saveState(); // Save state after cleanup
                    updatePopupUI(); // Reflect timeout in UI
                }
                screenRecordingCleanupTimer = null;
            }, CLEANUP_DELAY_MS);
            console.log(`[Background] Set cleanup timer ${screenRecordingCleanupTimer} for video URL.`);

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

    // --- Fallback for unhandled actions ---
    else {
        console.warn("Unhandled message action:", message.action);
        // Optionally send a response for unhandled actions
        // sendResponse({ success: false, error: `Unhandled action: ${message.action}` });
    }

    return needsAsyncResponse; // Required for async responses
});

// --- Gemini API Integration ---
const GEMINI_API_KEY = 'CHANGE THIS TO GEMINI API'; // IMPORTANT: Replace with your actual API key or use a secure method to obtain it.
// Use the new model name in the URL
const GEMINI_MODEL_NAME = 'gemini-2.5-flash-preview-04-17';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

// Helper function to convert Blob to Base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]); // Get only the Base64 part
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function callGeminiApi(videoBlob, transcriptData) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_API_KEY') {
        console.warn('Gemini API Key not configured. Skipping analysis.');
        sendMessageToPopup({ action: 'showNotification', message: 'Gemini API Key needed for analysis.', type: 'error' });
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

        // 3. Prepare transcript data string
        const transcriptString = transcriptData.map(item => {
             if (item.type === 'inputChange') {
                 const before = item.beforeValue === '' ? '[Empty]' : item.beforeValue;
                 const after = item.afterValue === '' ? '[Empty]' : item.afterValue;
                 return `Input Change: ${item.selector} (Before: ${before}, After: ${after})`;
             } else { // Assume click
                 const text = item.text === '' ? '[Empty]' : item.text;
                 return `Clicked: ${item.selector} (Text: ${text})`;
             }
        }).join('\n');
        const userPromptText = `Here is the transcript of user actions:\n${transcriptString}\n\nBased *only* on the provided video and the transcript, generate the detailed step-by-step description of the user flow according to the initial instructions. Focus on what is visible and interacted with.`;
        console.log('Transcript formatted into user prompt.');

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
                            // Include the system prompt as the first text part for context
                            text: systemPromptText 
                        }, 
                        {
                            // Video part
                            inline_data: {
                                mime_type: videoMimeType, 
                                data: videoBase64
                            }
                        },
                        { 
                            // User prompt part (transcript + instruction)
                            text: userPromptText 
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
        // 5. Make the API call
        const response = await fetch(GEMINI_API_URL, {
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
                console.log('Generated Steps extracted:', generatedSteps);
                sendMessageToPopup({ action: 'showGeneratedSteps', steps: generatedSteps });
                chrome.storage.local.set({ generatedSteps: generatedSteps });
                return generatedSteps;
            } else {
                 console.warn('Could not extract generated steps text from Gemini response candidate.', candidate);
                 sendMessageToPopup({ action: 'showNotification', message: 'Failed to extract steps from AI analysis response.', type: 'warning' });
                 return null;
            }
        } else if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
             console.warn(`Prompt blocked by Gemini API. Reason: ${responseData.promptFeedback.blockReason}`);
             sendMessageToPopup({ action: 'showNotification', message: `AI analysis blocked due to prompt content (Reason: ${responseData.promptFeedback.blockReason}).`, type: 'error' });
             return null;
         } else {
            console.warn('Gemini response received, but no valid candidates or prompt feedback found.', responseData);
            sendMessageToPopup({ action: 'showNotification', message: 'Received an unexpected response from AI analysis.', type: 'warning' });
            return null;
        }

    } catch (error) {
        console.error('Error calling Gemini API or processing its response:', error);
        sendMessageToPopup({ action: 'showNotification', message: `Error during AI analysis: ${error.message}`, type: 'error' });
        return null;
    }
}

// --- Internal Helper Functions ---

// Refactored click recording start logic into an async function
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

// Helper for stopping click recording (internal use)
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

// --- Screen Recording Logic ---
async function startScreenRecording() { // Renamed - this just INITIATES the process
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
    await setupOffscreenDocument('offscreen/offscreen.html');

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
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    recordedVideoUrl = null;
    recordedVideoBlob = null;

    // Don't save state or update UI here yet
}

async function stopScreenRecording() {
    console.log("[Background] Attempting to stop screen recording...");
    if (!isScreenRecording && !await hasOffscreenDocument('offscreen/offscreen.html')) {
        console.warn("Stop screen recording called, but not active or offscreen doc missing.");
        // Ensure state is consistent even if called erroneously
        isScreenRecording = false;
        screenRecordingTabId = null;
        // Don't clear recordedVideoUrl here, might be needed
        await saveState();
        updatePopupUI();
        return; // Exit if not recording
    }

    // Check if offscreen document exists before sending message
    if (await hasOffscreenDocument('offscreen/offscreen.html')) {
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
         if (recordedVideoUrl) {
             try{self.URL.revokeObjectURL(recordedVideoUrl);} catch(e){}
             recordedVideoUrl = null;
         }
         recordedVideoBlob = null;
         await saveState();
         updatePopupUI();
    }
     // The actual state update (isScreenRecording=false, video URL) happens
     // when the 'recording-stopped' message is received from offscreen.
}

// --- Tab Management for Persistence ---

// Listen for tab activation changes
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

// Listen for tab updates (navigation, refresh)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Check if the update is for the tab we are recording and the tab has finished loading
    if (tabId === activeTabId && isRecording && changeInfo.status === 'complete') {
        console.log(`Tab ${tabId} updated (complete), re-applying listener.`);
        // Re-apply the listener in the content script after navigation/refresh
        sendMessageToContentScript(tabId, { action: 'startListening' });
    }
});

// Handle potential removal of the active tab
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === activeTabId) {
        console.log(`Recorded tab ${tabId} was closed. Stopping recording.`);
        isRecording = false;
        recordedData = []; // Or keep data? User decision. Let's clear for now.
        activeTabId = null;
        saveState();
        updatePopupUI(); // Update popup if it's open
    }
});