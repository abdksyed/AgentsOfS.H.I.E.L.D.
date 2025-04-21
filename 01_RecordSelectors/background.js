let isRecording = false;
let recordedData = [];
let activeTabId = null;

// State for screen recording
let isScreenRecording = false;
let screenRecordingTabId = null; // Tab being screen recorded
let recordedVideoUrl = null; // Standardized name
let screenRecordingCleanupTimer = null; // Timer ID for cleanup

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

async function saveState() {
    await chrome.storage.local.set({
        isRecording,
        recordedData,
        activeTabId
    });
    console.log('State saved:', { isRecording, recordedData, activeTabId });
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

async function closeOffscreenDocument() {
    const path = 'offscreen/offscreen.html'; // Match the path used in setup
    if (!(await hasOffscreenDocument(path))) {
        return;
    }
    await chrome.offscreen.closeDocument();
     console.log("Offscreen document closed.");
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

function updatePopupUI() {
    // Add log to see what state is being sent
    console.log("[Background] Updating Popup UI with state:", { isRecording, activeTabId, isScreenRecording, recordedVideoUrl });
    sendMessageToPopup({ 
        action: 'updatePopup', 
        isRecording,
        recordedData,
        activeTabId,
        isScreenRecording,
        recordedVideoUrl
    });
}

// --- Event Handlers ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Background] Message received:", message, "from sender:", sender);
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
                if (isScreenRecording) stopScreenRecording(); 
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
        stopScreenRecording()
            .then(() => {
                console.log("[Background] Both recordings stopped.");
                sendResponse({ success: true });
            })
            .catch(err => {
                console.error("[Background] Error stopping both recordings:", err);
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
        if (activeTabId) {
            sendMessageToContentScript(activeTabId, { action: 'stopListening' });
        }
        isRecording = false;
        // Keep activeTabId to allow resuming
        saveState();
        updatePopupUI();
        sendResponse({ success: true });
    } else if (message.action === 'clearRecording') {
        if (activeTabId) {
            sendMessageToContentScript(activeTabId, { action: 'stopListening' });
        }
        isRecording = false;
        recordedData = [];
        activeTabId = null; // Reset activeTabId fully
        saveState();
        updatePopupUI();
        sendResponse({ success: true });
    } else if (message.action === 'getInitialState') {
        // Send the current state including screen recording status
        sendResponse({ 
            isRecording, 
            recordedData, 
            activeTabId, 
            isScreenRecording, 
            recordedVideoUrl
        });
    } else if (message.action === 'getRecordedData') {
        // Send the recorded data for download
        sendResponse({ data: recordedData });
    } else if (message.action === 'recordClick') {
        // Message from content script (standard click)
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
         // Message from content script (input field changed after blur)
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
         startScreenRecording().then(() => {
             sendResponse({success: true});
         }).catch(err => {
             console.error("Error starting screen recording:", err);
             sendResponse({success: false, error: err.message});
         });
    } else if (message.action === 'stopScreenRecording') {
        console.log("[Background] Received 'stopScreenRecording' action message.");
        needsAsyncResponse = true; // Indicate async response
         stopScreenRecording().then(() => {
             sendResponse({success: true});
         }).catch(err => {
             console.error("[Background] Error stopping screen recording:", err);
             sendResponse({success: false, error: err.message});
         });
    } else if (message.action === 'getRecordedVideoUrl') {
        console.log("[Background] Received 'getRecordedVideoUrl' action message.");
        sendResponse({ url: recordedVideoUrl });
        // Revocation is now handled by the popup.
    } else if (message.action === 'clearRecordedVideoUrl') {
         console.log("[Background] Received 'clearRecordedVideoUrl' message from popup.");
         // Clear any pending cleanup timer first
         if (screenRecordingCleanupTimer) {
             console.log("[Background] Clearing cleanup timer:", screenRecordingCleanupTimer);
             clearTimeout(screenRecordingCleanupTimer);
             screenRecordingCleanupTimer = null;
         }
         if (recordedVideoUrl) {
             // Popup should have revoked, just clearing reference
             console.log("[Background] Clearing recordedVideoUrl reference.");
             recordedVideoUrl = null;
             closeOffscreenDocument();
             updatePopupUI(); 
         } 
    }
    // --- Message from Offscreen Document --- 
    else if (message.target === 'background' && message.type === 'recording-stopped') {
        console.log("[Background] Received 'recording-stopped' message from offscreen with URL:", message.url);
        recordedVideoUrl = message.url;
        isScreenRecording = false; 
        screenRecordingTabId = null;
        updatePopupUI(); 

        // Set a timeout to eventually clean up if download doesn't happen
        // Clear any existing timer first (e.g., if stop was called rapidly)
        if (screenRecordingCleanupTimer) {
            clearTimeout(screenRecordingCleanupTimer);
        }
        const CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
        console.log(`[Background] Setting cleanup timer for ${CLEANUP_TIMEOUT_MS}ms`);
        screenRecordingCleanupTimer = setTimeout(() => {
            console.log("[Background] Cleanup timeout reached.");
            if (recordedVideoUrl) {
                console.warn("[Background] Video URL still exists after timeout. Revoking and cleaning up.");
                 try {
                     self.URL.revokeObjectURL(recordedVideoUrl);
                 } catch(e) { console.error("[Background] Error revoking URL on cleanup:", e); }
                 recordedVideoUrl = null;
                 updatePopupUI();
            }
            closeOffscreenDocument();
            screenRecordingCleanupTimer = null; // Clear timer ID
        }, CLEANUP_TIMEOUT_MS);

    } else if (message.target === 'background' && message.type === 'recording-error') {
        console.error("[Background] Received recording error from offscreen:", message.error);
        isScreenRecording = false; 
        screenRecordingTabId = null;
        recordedVideoUrl = null;
        updatePopupUI();
        // Ensure timer is cleared on error too
        if (screenRecordingCleanupTimer) {
            clearTimeout(screenRecordingCleanupTimer);
            screenRecordingCleanupTimer = null;
        }
        closeOffscreenDocument();
    }

    return needsAsyncResponse;
});

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
     }
     isRecording = false;
     // Keep activeTabId for potential resume
     saveState();
     updatePopupUI();
     console.log("[Background] Click recording stopped for tab:", activeTabId);
}

// --- Screen Recording Logic ---
async function startScreenRecording() {
    if (isScreenRecording) {
        console.warn("Screen recording is already active.");
        return;
    }

    // Setup and create the offscreen document if it doesn't exist
    // No need to get tabId or streamId beforehand when using getDisplayMedia
    await setupOffscreenDocument('offscreen/offscreen.html');

    // Send message to the offscreen document to start recording
    // Offscreen document will now handle the getDisplayMedia prompt
    await chrome.runtime.sendMessage({
        type: 'start-recording',
        target: 'offscreen'
        // No streamId needed
    });

    // Update state (immediately assume recording is starting, 
    // actual stream depends on user interaction in offscreen)
    isScreenRecording = true;
    screenRecordingTabId = null; // We don't know which tab/window/screen user will choose yet
    recordedVideoUrl = null; // Use standardized name & Clear previous video URL
    updatePopupUI();
    console.log("Sent start command to offscreen document (will use getDisplayMedia).");
}

async function stopScreenRecording() {
    if (!isScreenRecording) {
        console.warn("[Background] No active screen recording to stop.");
        return;
    }
    console.log("[Background] Sending 'stop-recording' message to offscreen.");
    // Update state immediately for better UI feedback (disable stop button)
    isScreenRecording = false;
    updatePopupUI();

    // Send message to the offscreen document to stop recording
    await chrome.runtime.sendMessage({
        type: 'stop-recording',
        target: 'offscreen'
    });
    // Final state (including video URL) is updated when 'recording-stopped' message is received back
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