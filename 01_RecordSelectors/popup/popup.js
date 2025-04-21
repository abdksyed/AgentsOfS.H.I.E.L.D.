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

    // --- NEW: Button State Management Function ---
    function updateButtonStates(clickRecordingActive, screenRecordingActive, hasData, videoUrl, activeTabId) {
        const canStartSomething = !clickRecordingActive && !screenRecordingActive;
        const isAnythingRecording = clickRecordingActive || screenRecordingActive;

        startBothBtn.disabled = !canStartSomething;
        stopBothBtn.disabled = !isAnythingRecording;

        startBtn.disabled = !canStartSomething || screenRecordingActive; 
        resumeBtn.disabled = clickRecordingActive || screenRecordingActive; // Can't resume if anything is recording
        stopBtn.disabled = !clickRecordingActive;
        
        // CORRECTED Clear button logic: Disable if (no data AND no tab) OR (recording active)
        clearBtn.disabled = (!hasData && activeTabId === null) || isAnythingRecording; 
        
        downloadBtn.disabled = !hasData || isAnythingRecording; // Enable only if has data and not recording

        startScreenBtn.disabled = !canStartSomething || clickRecordingActive; 
        stopScreenBtn.disabled = !screenRecordingActive;
        downloadVideoBtn.disabled = !videoUrl || isAnythingRecording; // Enable only if videoUrl exists and not recording
    }

    // Function to update UI elements based on state
    // Now includes screen recording state
    function updateUI(isRecording, recordedData, activeTabId, isScreenRecording, videoUrl) {
        // Add log to check received videoUrl
        console.log('[Popup] updateUI called. isScreenRecording:', isScreenRecording, 'videoUrl:', videoUrl);

        const dataArray = Array.isArray(recordedData) ? recordedData : [];
        const hasData = dataArray.length > 0;

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
        const clickState = isRecording ? 'recording' : 'stopped';
        statusIndicator.className = `indicator ${clickState}`;
        statusIndicator.setAttribute('aria-label', `Clicks recording ${clickState}`);

        // Update screen recording status indicator
        const screenState = isScreenRecording ? 'recording' : 'stopped';
        screenStatusIndicator.className = `indicator ${screenState}`;
        screenStatusIndicator.setAttribute('aria-label', `Screen recording ${screenState}`);

        // --- Use the new button state management function ---
        updateButtonStates(isRecording, isScreenRecording, hasData, videoUrl, activeTabId);
        
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
            // Use optional chaining for safer access
            if (response?.url) {
                const videoUrl = response.url;

                // Use the downloads API for more robust download and revocation
                chrome.downloads.download({
                    url: videoUrl,
                    filename: 'recorded_screen.webm', // Suggest a filename
                    saveAs: true // Prompt user for save location
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error("[Popup] Download initiation failed:", chrome.runtime.lastError.message);
                        // Attempt to revoke URL even if download fails to start, as we have the URL
                        try {
                            console.log("[Popup] Attempting to revoke Blob URL after download initiation failure:", videoUrl);
                            URL.revokeObjectURL(videoUrl);
                            chrome.runtime.sendMessage({ action: 'clearRecordedVideoUrl' }); // Also clear background reference
                        } catch (e) {
                            console.error("[Popup] Error revoking Blob URL after download failure:", e);
                        }
                        return;
                    }

                    // Listener to revoke URL *after* download completes or fails
                    const listener = (delta) => {
                        if (delta.id === downloadId) {
                            if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
                                console.log(`[Popup] Download ${delta.state.current}. Revoking Blob URL:`, videoUrl);
                                try {
                                    URL.revokeObjectURL(videoUrl);
                                } catch (e) {
                                    console.error("[Popup] Error revoking Blob URL:", e);
                                }
                                // Send message to background to clear its reference
                                chrome.runtime.sendMessage({ action: 'clearRecordedVideoUrl' });
                                // Remove the listener
                                chrome.downloads.onChanged.removeListener(listener);
                            }
                        }
                    };
                    chrome.downloads.onChanged.addListener(listener);
                });
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
            updateUI(
                message.isRecording, 
                message.recordedData, 
                message.activeTabId, 
                message.isScreenRecording,
                message.recordedVideoUrl // Use consistent name 'recordedVideoUrl'
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
            updateUI(
                response.isRecording, 
                response.recordedData, 
                response.activeTabId, 
                response.isScreenRecording,
                response.recordedVideoUrl // Use consistent name 'recordedVideoUrl'
            );
        } else {
            console.warn("No initial state received from background script.");
            updateUI(false, [], null, false, null);
        }
    });
});