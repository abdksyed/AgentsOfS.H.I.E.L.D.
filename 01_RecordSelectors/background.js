let isRecording = false;
let recordedData = [];
let activeTabId = null;

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
    sendMessageToPopup({ 
        action: 'updatePopup', 
        isRecording,
        recordedData,
        activeTabId
    });
}

// --- Event Handlers ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in background:", message, "from sender:", sender);
    let needsAsyncResponse = false;

    if (message.action === 'startRecording') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                 console.error("No active tab found to start recording.");
                 sendResponse({ success: false, error: "No active tab"});
                 return;
            }
            activeTabId = tabs[0].id;
            isRecording = true;
            recordedData = []; // Start always clears previous data
            saveState();
            sendMessageToContentScript(activeTabId, { action: 'startListening' });
            updatePopupUI();
            sendResponse({ success: true });
        });
        needsAsyncResponse = true; // Indicate that sendResponse will be called asynchronously
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
        // Send the current state including activeTabId
        sendResponse({ isRecording, recordedData, activeTabId });
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

    // Return true to indicate you wish to send a response asynchronously
    // This is crucial for handlers that use asynchronous operations like chrome.tabs.query
    return needsAsyncResponse;
});

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