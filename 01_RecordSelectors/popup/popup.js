document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');
    const downloadBtn = document.getElementById('download-btn');
    const recordedClicksTextarea = document.getElementById('recorded-clicks');
    const statusIndicator = document.getElementById('status-indicator');

    // Screen recording elements
    const screenStatusIndicator = document.getElementById('screen-status-indicator');
    const startScreenBtn = document.getElementById('start-screen-btn');
    const stopScreenBtn = document.getElementById('stop-screen-btn');
    const downloadVideoBtn = document.getElementById('download-video-btn');

    // Combined control
    const startBothBtn = document.getElementById('start-both-btn');
    const stopBothBtn = document.getElementById('stop-both-btn'); // Added Stop Both

    // Function to update UI elements based on state
    // Now includes screen recording state
    function updateUI(isRecording, recordedData, activeTabId, isScreenRecording, videoUrl) {
        // Add log to check received videoUrl
        console.log('[Popup] updateUI called. isScreenRecording:', isScreenRecording, 'videoUrl:', videoUrl);

        const dataArray = Array.isArray(recordedData) ? recordedData : [];

        recordedClicksTextarea.value = dataArray.map(item => {
            if (item.type === 'inputChange') {
                 // Handle empty strings explicitly for display
                 const before = item.beforeValue === '' ? '[Empty]' : item.beforeValue;
                 const after = item.afterValue === '' ? '[Empty]' : item.afterValue;
                return `Input Change: ${item.selector}\n  Before: ${before || 'N/A'}\n  After: ${after || 'N/A'}\n---`;
            } else {
                 // Default to click type if type is missing or different
                 const text = item.text === '' ? '[Empty]' : item.text;
                 return `Clicked: ${item.selector}\n  Text: ${text || 'N/A'}\n---`;
            }
        }).join('\n');

        // Update click recording status indicator
        statusIndicator.className = `indicator ${isRecording ? 'recording' : 'stopped'}`;
        // Update screen recording status indicator
        screenStatusIndicator.className = `indicator ${isScreenRecording ? 'recording' : 'stopped'}`;

        // --- Update Button States ---
        const clickRecordingActive = isRecording;
        const screenRecordingActive = isScreenRecording;
        const canStartSomething = !clickRecordingActive && !screenRecordingActive;
        const isAnythingRecording = clickRecordingActive || screenRecordingActive;

        startBothBtn.disabled = !canStartSomething;
        stopBothBtn.disabled = !isAnythingRecording; // Enabled if either is recording
        
        startBtn.disabled = !canStartSomething || screenRecordingActive; // Also disable if screen rec active
        resumeBtn.disabled = clickRecordingActive || activeTabId === null || screenRecordingActive; 
        stopBtn.disabled = !clickRecordingActive;
        clearBtn.disabled = (dataArray.length === 0 && activeTabId === null) || isAnythingRecording; // Disable clear if anything is recording
        downloadBtn.disabled = dataArray.length === 0;

        startScreenBtn.disabled = !canStartSomething || clickRecordingActive; // Also disable if click rec active
        stopScreenBtn.disabled = !screenRecordingActive;
        downloadVideoBtn.disabled = !videoUrl; 

        recordedClicksTextarea.scrollTop = recordedClicksTextarea.scrollHeight;
    }

    // --- Event Listeners for Buttons ---

    startBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startRecording' }, response => {
            if (chrome.runtime.lastError) {
                console.error("Error sending start message:", chrome.runtime.lastError.message);
                // Handle error appropriately, maybe show a message to the user
                return;
            }
            // Assume background script handles state update and sends back new state
            // The listener below will handle the update
        });
    });

    resumeBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'resumeRecording' }, response => {
            if (chrome.runtime.lastError) {
                console.error("Error sending resume message:", chrome.runtime.lastError.message);
                return;
            }
        });
    });

    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopRecording' }, response => {
             if (chrome.runtime.lastError) {
                console.error("Error sending stop message:", chrome.runtime.lastError.message);
                return;
            }
            // Assume background script handles state update and sends back new state
        });
    });

    clearBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'clearRecording' }, response => {
             if (chrome.runtime.lastError) {
                console.error("Error sending clear message:", chrome.runtime.lastError.message);
                return;
            }
            // Assume background script handles state update and sends back new state
        });
    });

    downloadBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'getRecordedData' }, response => {
            if (chrome.runtime.lastError) {
                console.error("Error getting data for download:", chrome.runtime.lastError.message);
                return;
            }
            if (response && response.data) {
                downloadData(response.data);
            } else {
                console.error("No data received for download.");
            }
        });
    });

    // --- Event Listeners for Screen Recording Buttons ---
    startScreenBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startScreenRecording' }, response => {
             if (chrome.runtime.lastError) {
                console.error("Error sending start screen recording message:", chrome.runtime.lastError.message);
             }
             // UI update will be triggered by background script via 'updatePopup' message
        });
    });

    stopScreenBtn.addEventListener('click', () => {
        console.log("[Popup] Stop Screen Rec button clicked.");
        chrome.runtime.sendMessage({ action: 'stopScreenRecording' }, response => {
             if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending stop screen recording message:", chrome.runtime.lastError.message);
             }
        });
    });

     downloadVideoBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'getRecordedVideoUrl' }, response => {
            if (chrome.runtime.lastError) {
                console.error("Error getting video URL:", chrome.runtime.lastError.message);
                return;
            }
            if (response && response.url) {
                const videoUrl = response.url;
                // Use the background-provided Blob URL to trigger download
                const a = document.createElement('a');
                a.href = videoUrl;
                a.download = 'recorded_screen.webm'; // Set filename
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                // Revoke the Blob URL after the download link is clicked
                console.log("[Popup] Revoking Blob URL:", videoUrl);
                try {
                     URL.revokeObjectURL(videoUrl);
                } catch (e) {
                    console.error("[Popup] Error revoking Blob URL:", e);
                }
                
                // Send message to background to clear its reference (optional but good practice)
                chrome.runtime.sendMessage({ action: 'clearRecordedVideoUrl' }); 

            } else {
                console.error("No video URL received for download.");
            }
        });
    });

    // Added Start Both Listener
    startBothBtn.addEventListener('click', () => {
        console.log("[Popup] Start Both button clicked.");
         chrome.runtime.sendMessage({ action: 'startBothRecordings' }, response => {
             if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending start both message:", chrome.runtime.lastError.message);
             }
             // UI update handled by background
        });
    });

    // Added Stop Both Listener
    stopBothBtn.addEventListener('click', () => {
        console.log("[Popup] Stop Both button clicked.");
        chrome.runtime.sendMessage({ action: 'stopBothRecordings' }, response => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending stop both message:", chrome.runtime.lastError.message);
            }
            // UI update handled by background
        });
    });

    // --- Helper function for Download ---
    function downloadData(data) {
        const dataArray = Array.isArray(data) ? data : [];
        
        if (dataArray.length === 0) {
            console.log("No data to download.");
            return;
        }

        const formattedData = dataArray.map(item => {
            if (item.type === 'inputChange') {
                 const before = item.beforeValue === '' ? '[Empty]' : item.beforeValue;
                 const after = item.afterValue === '' ? '[Empty]' : item.afterValue;
                return `Type: Input Change\nSelector: ${item.selector}\nBefore Value: ${before || 'N/A'}\nAfter Value: ${after || 'N/A'}`; 
            } else {
                 const text = item.text === '' ? '[Empty]' : item.text;
                 // Assume click type if not inputChange
                 return `Type: Click\nSelector: ${item.selector}\nText: ${text || 'N/A'}`; 
            }
        }).join('\n---\n'); // Separate entries clearly in the file
        
        const blob = new Blob([formattedData], { type: 'text/plain;charset=utf-8' }); // Specify charset
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recorded_events.txt'; // Changed filename to reflect different event types
        document.body.appendChild(a); // Required for Firefox
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- Listener for updates from Background Script ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'updatePopup') {
            // Pass all relevant state info to updateUI
            updateUI(
                message.isRecording, 
                message.recordedData, 
                message.activeTabId, 
                message.isScreenRecording, // Added
                message.recordedVideoBlobUrl // Corrected property name
            ); 
        }
    });

    // --- Initial request for state when popup opens ---
    chrome.runtime.sendMessage({ action: 'getInitialState' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting initial state:", chrome.runtime.lastError.message);
             // Update with default empty state, including new screen recording state
             updateUI(false, [], null, false, null); 
             return;
        }
        if (response) {
            // Pass all relevant state info to updateUI
            updateUI(
                response.isRecording, 
                response.recordedData, 
                response.activeTabId, 
                response.isScreenRecording, // Added
                response.recordedVideoUrl // Added
            );
        } else {
            console.warn("No initial state received from background script.");
            updateUI(false, [], null, false, null);
        }
    });
});