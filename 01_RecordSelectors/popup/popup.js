document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');
    const downloadBtn = document.getElementById('download-btn');
    const recordedClicksTextarea = document.getElementById('recorded-clicks');
    const statusIndicator = document.getElementById('status-indicator');
    const generatedStepsTextarea = document.getElementById('generated-steps');
    const generateStepsBtn = document.getElementById('generate-steps-btn'); // New button
    const copyStepsBtn = document.getElementById('copy-steps-btn');
    // const statusMessageDiv = document.getElementById('statusMessage'); // Get status message div

    // Screen recording elements
    const screenStatusIndicator = document.getElementById('screen-status-indicator');
    const startScreenBtn = document.getElementById('start-screen-btn');
    const stopScreenBtn = document.getElementById('stop-screen-btn');
    const downloadVideoBtn = document.getElementById('download-video-btn');

    // Combined control
    const startBothBtn = document.getElementById('start-both-btn');
    const stopBothBtn = document.getElementById('stop-both-btn'); // Added Stop Both

    // --- NEW: Button State Management Function ---
    function updateButtonStates(clickRecordingActive, screenRecordingActive, hasClickData, hasVideoData, activeTabId, hasGeneratedSteps) {
        const canStartSomething = !clickRecordingActive && !screenRecordingActive;
        const isAnythingRecording = clickRecordingActive || screenRecordingActive;

        startBothBtn.disabled = !canStartSomething;
        stopBothBtn.disabled = !isAnythingRecording;

        startBtn.disabled = !canStartSomething || screenRecordingActive;
        resumeBtn.disabled = clickRecordingActive || screenRecordingActive; // Can't resume if anything is recording
        stopBtn.disabled = !clickRecordingActive;

        // CORRECTED Clear button logic: Disable if (no data AND no tab) OR (recording active)
        clearBtn.disabled = (!hasClickData && activeTabId === null) || isAnythingRecording;

        downloadBtn.disabled = !hasClickData || isAnythingRecording; // Enable only if has click data and not recording

        startScreenBtn.disabled = !canStartSomething || clickRecordingActive;
        stopScreenBtn.disabled = !screenRecordingActive;
        // Update based on hasVideoData flag
        downloadVideoBtn.disabled = !hasVideoData || isAnythingRecording; // Enable only if video exists (flag) and not recording

        // Generated Steps UI
        // Enable Generate button only if stopped, has video, and has click data
        generateStepsBtn.disabled = isAnythingRecording || !hasVideoData || !hasClickData;
        // Enable Copy button only if there are steps in the textarea
        copyStepsBtn.disabled = !hasGeneratedSteps;
    }

    // Function to update UI elements based on state
    function updateUI(isRecording, recordedData, activeTabId, isScreenRecording, hasVideo) {
        // Add log to check received video state
        console.log('[Popup] updateUI called. isScreenRecording:', isScreenRecording, 'hasVideo:', hasVideo);

        const dataArray = Array.isArray(recordedData) ? recordedData : [];
        const hasClickData = dataArray.length > 0;

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

        // Check if generated steps exist for button state
        const hasGeneratedSteps = generatedStepsTextarea.value.trim().length > 0;

        // --- Use the new button state management function ---
        updateButtonStates(isRecording, isScreenRecording, hasClickData, hasVideo, activeTabId, hasGeneratedSteps);

        // Load stored steps if available (and not currently recording)
        if (!isRecording && !isScreenRecording) {
            chrome.storage.local.get(['generatedSteps'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error("Error getting stored steps:", chrome.runtime.lastError);
                    generatedStepsTextarea.value = '';
                    copyStepsBtn.disabled = true;
                    // Re-run button state update even on error, with empty steps
                    updateButtonStates(isRecording, isScreenRecording, hasClickData, hasVideo, activeTabId, false);
                    return;
                }
                const steps = result.generatedSteps || '';
                generatedStepsTextarea.value = steps;
                // Update button states again after potentially loading steps
                updateButtonStates(isRecording, isScreenRecording, hasClickData, hasVideo, activeTabId, steps.trim().length > 0);
            });
        } else {
             // Disable buttons while recording is active
             const hasGeneratedStepsWhileRecording = generatedStepsTextarea.value.trim().length > 0;
             updateButtonStates(isRecording, isScreenRecording, hasClickData, hasVideo, activeTabId, hasGeneratedStepsWhileRecording);
         }

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

    // --- Event Listener for Download Video Button (Modified) ---
    downloadVideoBtn.addEventListener('click', () => {
        console.log("[Popup] Download Video button clicked. Requesting from background.");
        // Disable button temporarily to prevent multiple requests
        downloadVideoBtn.disabled = true;
        chrome.runtime.sendMessage({ action: 'downloadVideoAction' }, response => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending download video request:", chrome.runtime.lastError.message);
                displayStatusMessage(`Error initiating download: ${chrome.runtime.lastError.message}`, 'error');
                // Re-enable button on error - state will be updated properly by next 'updatePopup' if needed
                // Check current state to re-enable correctly
                chrome.runtime.sendMessage({ action: 'getInitialState' }, (state) => {
                    if (state) downloadVideoBtn.disabled = !state.hasVideo || state.isScreenRecording || state.isRecording;
                });
                return;
            }
            if (response && response.success) {
                console.log("[Popup] Background acknowledged download request.");
                displayStatusMessage("Download initiated... Check your browser downloads.", 'info');
                // Button state will be updated by background via 'updatePopup'
            } else {
                console.error("[Popup] Background reported error initiating download:", response?.error);
                displayStatusMessage(`Download failed: ${response?.error || 'Unknown error'}`, 'error');
                 // Re-enable button on error
                 chrome.runtime.sendMessage({ action: 'getInitialState' }, (state) => {
                    if (state) downloadVideoBtn.disabled = !state.hasVideo || state.isScreenRecording || state.isRecording;
                });
            }
            // REMOVED: All logic related to receiving URL, creating blob URL, download, and revocation
        });
    });

    // --- Listener for Generate Steps Button ---
    generateStepsBtn.addEventListener('click', () => {
        console.log('[Popup] Generate Steps button clicked.');
        // Disable button immediately to prevent multiple clicks
        generateStepsBtn.disabled = true;
        displayStatusMessage('Generating steps with AI...', 'info'); // Show feedback
        chrome.runtime.sendMessage({ action: 'generateStepsWithAI' }, response => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending generate steps message:", chrome.runtime.lastError.message);
                displayStatusMessage(`Error starting generation: ${chrome.runtime.lastError.message}`, 'error');
                // Re-enable button on error if appropriate (depends on background state)
                // We rely on the next 'updatePopup' message to set the correct state.
            } else if (response && !response.success) {
                console.error("[Popup] Background reported error during generation:", response.error);
                displayStatusMessage(`Error generating steps: ${response.error}`, 'error');
            } else {
                console.log('[Popup] Generate steps message sent successfully.');
                // Background will send 'showGeneratedSteps' or 'showNotification' on completion/error
            }
        });
    });

    copyStepsBtn.addEventListener('click', () => {
        if (generatedStepsTextarea.value) {
            navigator.clipboard.writeText(generatedStepsTextarea.value)
                .then(() => {
                    // Optional: Show a temporary confirmation message
                    const originalText = copyStepsBtn.textContent;
                    copyStepsBtn.textContent = 'Copied!';
                    setTimeout(() => { copyStepsBtn.textContent = originalText; }, 1500);
                    console.log('Generated steps copied to clipboard.');
                })
                .catch(err => {
                    console.error('Failed to copy steps: ', err);
                    // Optional: Show an error message to the user
                    displayStatusMessage('Error copying steps.', 'error');
                });
        }
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

    // --- Listener for updates from Background Script (Modified) ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'updatePopup') {
            console.log('[Popup] Received updatePopup message:', message);
            updateUI(
                message.isRecording,
                message.recordedData,
                message.activeTabId,
                message.isScreenRecording,
                message.hasVideo // Pass the boolean flag
            );
            // Also update steps if they are included in the update message
            if (message.generatedSteps !== undefined) {
                 const steps = message.generatedSteps || '';
                 generatedStepsTextarea.value = steps;
                 // Get current state to update buttons correctly (already done by updateUI call above)
                 // updateButtonStates(... using message data ...);
            }
        } else if (message.action === 'showGeneratedSteps') {
            console.log('[Popup] Received generated steps');
            const steps = message.steps || 'No steps generated.';
            generatedStepsTextarea.value = steps;
            // Update button states after receiving steps - get fresh state
            chrome.runtime.sendMessage({ action: 'getInitialState' }, (response) => {
                 if (response) {
                     // Use the hasVideo flag from the fresh state
                     const hasClickData = Array.isArray(response.recordedData) && response.recordedData.length > 0;
                     updateButtonStates(response.isRecording, response.isScreenRecording, hasClickData, response.hasVideo, response.activeTabId, steps.trim().length > 0);
                 } else {
                      // Fallback if state fetch fails
                      copyStepsBtn.disabled = steps.trim().length === 0;
                 }
            });
            generatedStepsTextarea.scrollTop = generatedStepsTextarea.scrollHeight;
            displayStatusMessage('Analysis complete. Steps generated.', 'success');
        } else if (message.action === 'showNotification') {
            console.log('[Popup] Received notification:', message.message);
            displayStatusMessage(message.message, message.type || 'info');
        }
    });

    // --- Initial request for state when popup opens (Modified) ---
    chrome.runtime.sendMessage({ action: 'getInitialState' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting initial state:", chrome.runtime.lastError.message);
             updateUI(false, [], null, false, false); // Update with default empty state
             // Check for stored steps on initial load error
             chrome.storage.local.get(['generatedSteps'], (result) => {
                 const steps = result.generatedSteps || '';
                 generatedStepsTextarea.value = steps;
                 updateButtonStates(false, false, false, false, null, steps.trim().length > 0);
             });
             return;
        }
        if (response) {
            console.log("[Popup] Received initial state:", response);
            updateUI(
                response.isRecording,
                response.recordedData,
                response.activeTabId,
                response.isScreenRecording,
                response.hasVideo // Use the boolean flag
            );
            // Also load initial steps
            chrome.storage.local.get(['generatedSteps'], (result) => {
                 const steps = result.generatedSteps || '';
                 generatedStepsTextarea.value = steps;
                 // Update buttons after getting initial state AND steps
                 const hasClickData = Array.isArray(response.recordedData) && response.recordedData.length > 0;
                 updateButtonStates(response.isRecording, response.isScreenRecording, hasClickData, response.hasVideo, response.activeTabId, steps.trim().length > 0);
            });
        } else {
            console.warn("No initial state received from background script.");
            updateUI(false, [], null, false, false);
             // Check for stored steps on initial load warning
             chrome.storage.local.get(['generatedSteps'], (result) => {
                 const steps = result.generatedSteps || '';
                 generatedStepsTextarea.value = steps;
                 updateButtonStates(false, false, false, false, null, steps.trim().length > 0);
             });
        }
    });

    // --- Get reference to status message div --- 
    const statusMessageDiv = document.getElementById('statusMessage');

    // Function to display status messages
    function displayStatusMessage(message, type = 'info') { // type can be 'info', 'error', 'success'
        const statusDiv = document.getElementById('statusMessage'); // Get fresh reference inside function
        if (!statusDiv) {
            console.warn("Status message div not found!");
            return; 
        }
        // Clear previous message/type
        statusDiv.textContent = ''; 
        statusDiv.className = 'status-message';

        // Set new message and type
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
    }
});