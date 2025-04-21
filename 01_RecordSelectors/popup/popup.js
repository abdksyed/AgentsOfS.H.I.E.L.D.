document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');
    const downloadBtn = document.getElementById('download-btn');
    const recordedClicksTextarea = document.getElementById('recorded-clicks');
    const statusIndicator = document.getElementById('status-indicator');
    // const statusMessageDiv = document.getElementById('statusMessage'); // Unused variable

    // AI Magic elements
    const aiPromptInput = document.getElementById('ai-prompt');
    const aiGenerateBtn = document.getElementById('ai-generate-btn');
    const aiResultsTextarea = document.getElementById('ai-results');
    const aiCopyBtn = document.getElementById('ai-copy-btn');

    // Screen recording elements
    const screenStatusIndicator = document.getElementById('screen-status-indicator');
    const startScreenBtn = document.getElementById('start-screen-btn');
    const stopScreenBtn = document.getElementById('stop-screen-btn');
    const downloadVideoBtn = document.getElementById('download-video-btn');

    // Combined control
    const startBothBtn = document.getElementById('start-both-btn');
    const stopBothBtn = document.getElementById('stop-both-btn');

    // Settings elements
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');

    /**
     * Updates the enabled/disabled state of all control buttons based on the current
     * recording and data state.
     * @param {boolean} clickRecordingActive - Is click/action recording currently active?
     * @param {boolean} screenRecordingActive - Is screen recording currently active?
     * @param {boolean} hasClickData - Is there any recorded click/action data?
     * @param {boolean} hasVideoData - Is there recorded video data available (blob or URL)?
     * @param {number|null} activeTabId - The ID of the tab being recorded, or null.
     * @param {boolean} hasAiResults - Are there results currently displayed in the AI textarea?
     */
    function updateButtonStates(clickRecordingActive, screenRecordingActive, hasClickData, hasVideoData, activeTabId, hasAiResults) {
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

        // AI Magic UI
        // Enable AI Generate button only if stopped, has video, and has click data
        aiGenerateBtn.disabled = isAnythingRecording || !hasVideoData || !hasClickData;
        // Enable AI Copy button only if there are AI results in the textarea
        aiCopyBtn.disabled = !hasAiResults;
    }

    /**
     * Updates the entire popup UI based on the state received from the background script.
     * This includes the recorded clicks textarea, status indicators, and button states.
     * @param {boolean} isRecording - Whether click/action recording is active.
     * @param {Array<Object>} recordedData - The array of recorded click/input events.
     * @param {number|null} activeTabId - The ID of the tab being recorded, or null.
     * @param {boolean} isScreenRecording - Whether screen recording is active.
     * @param {boolean} hasVideo - Whether video data (blob or URL) is available.
     */
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
            } else if (item.type === 'click') {
                // Just indicate a click occurred, as DOM structure is too large for display
                return `Clicked (DOM captured)\n---`; 
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

        // Check if AI results exist for button state
        const hasAiResults = aiResultsTextarea.value.trim().length > 0;

        // --- Use the new button state management function ---
        updateButtonStates(isRecording, isScreenRecording, hasClickData, hasVideo, activeTabId, hasAiResults);

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
        console.log("[Popup] Download Events button clicked. Requesting download from background.");
        // Disable button temporarily?
        downloadBtn.disabled = true; 
        chrome.runtime.sendMessage({ action: 'downloadEventsAction' }, response => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending download events request:", chrome.runtime.lastError.message);
                displayStatusMessage(`Error initiating download: ${chrome.runtime.lastError.message}`, 'error');
                // Re-enable button on error
                chrome.runtime.sendMessage({ action: 'getInitialState' }, (state) => {
                    if (state) downloadBtn.disabled = !state.recordedData?.length > 0 || state.isScreenRecording || state.isRecording;
                });
                return;
            }
            // Check if response is successful AND contains the text content
            if (response && response.success && typeof response.textContent === 'string') {
                console.log("[Popup] Received events content from background. Creating blob and initiating download.");
                try {
                    const blob = new Blob([response.textContent], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'recorded_events.txt';
                    document.body.appendChild(a); // Required for Firefox trigger
                    a.click();
                    document.body.removeChild(a); // Clean up the element
                    URL.revokeObjectURL(url); // Clean up the blob URL
                    displayStatusMessage("Download started... Check your browser downloads.", 'success');
                 } catch (e) {
                     console.error("[Popup] Error creating blob or initiating download:", e);
                     displayStatusMessage(`Error creating download file: ${e.message}`, 'error');
                 }
            } else {
                const errorMsg = response?.error || (typeof response.textContent !== 'string' ? 'Invalid content received' : 'Unknown error');
                console.error("[Popup] Background reported error or invalid content for events download:", errorMsg);
                displayStatusMessage(`Download failed: ${errorMsg}`, 'error');
                  // Re-enable button on error
                  chrome.runtime.sendMessage({ action: 'getInitialState' }, (state) => {
                     if (state) downloadBtn.disabled = !state.recordedData?.length > 0 || state.isScreenRecording || state.isRecording;
                 });
            }
            // Re-enable button after response, actual state handled by background via updatePopup
            // downloadBtn.disabled = false; // Removed redundant re-enable logic
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
            // State will be updated by background via 'updatePopup'
            // No need to manually re-enable here.
        });
    });

    // --- NEW: AI Magic Event Listeners ---
    aiGenerateBtn.addEventListener('click', () => {
        const userPrompt = aiPromptInput.value.trim(); // Get user prompt
        console.log('[Popup] AI Generate button clicked. User Prompt:', userPrompt);

        // Disable button and show status
        aiGenerateBtn.disabled = true;
        aiCopyBtn.disabled = true; // Disable copy while generating
        aiResultsTextarea.value = 'Generating with AI...';
        displayStatusMessage('Generating with AI...', 'info');

        // Send message to background to start AI generation
        chrome.runtime.sendMessage({ action: 'generateWithAiMagic', userPrompt: userPrompt }, response => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error sending generateWithAiMagic message:", chrome.runtime.lastError.message);
                displayStatusMessage(`Error starting AI generation: ${chrome.runtime.lastError.message}`, 'error');
                aiResultsTextarea.value = 'Error starting generation.';
                // Re-enable button on error - might need state check
                // For simplicity, we rely on the next state update or manual trigger
                // aiGenerateBtn.disabled = false; // Consider re-enabling based on state check
            } else if (response && !response.success) {
                console.error("[Popup] Background reported error during AI generation:", response.error);
                displayStatusMessage(`Error generating AI results: ${response.error}`, 'error');
                aiResultsTextarea.value = `Error: ${response.error}`;
                 // Re-enable button on error
                 // aiGenerateBtn.disabled = false; // Consider re-enabling based on state check
            } else {
                console.log('[Popup] generateWithAiMagic message sent successfully.');
                // Background will send 'showAiMagicResults' or 'showNotification' on completion/error
            }
            // Note: Buttons will be re-enabled properly when results arrive or via state updates.
        });
    });

    aiCopyBtn.addEventListener('click', () => {
        if (aiResultsTextarea.value) {
            navigator.clipboard.writeText(aiResultsTextarea.value)
                .then(() => {
                    const originalText = aiCopyBtn.textContent;
                    aiCopyBtn.textContent = 'Copied!';
                    displayStatusMessage('AI Results copied to clipboard.', 'success');
                    setTimeout(() => {
                        aiCopyBtn.textContent = originalText;
                    }, 2000); // Revert text after 2 seconds
                })
                .catch(err => {
                    console.error('Failed to copy AI results:', err);
                    displayStatusMessage('Failed to copy AI results.', 'error');
                });
        }
    });
    // --- END NEW AI Magic Event Listeners ---

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

    // --- Settings Event Listeners --- //
    saveApiKeyBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            console.log("[Popup] Save API Key button clicked.");
            chrome.runtime.sendMessage({ action: 'saveApiKey', apiKey: apiKey }, response => {
                if (chrome.runtime.lastError) {
                    console.error("[Popup] Error sending saveApiKey message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error saving API key: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response && response.success) {
                    console.log("[Popup] API Key saved successfully acknowledged by background.");
                    displayStatusMessage('API Key saved successfully.', 'success');
                    apiKeyInput.value = ''; // Clear the input field after successful save
                } else {
                    console.error("[Popup] Background reported error saving API key:", response?.error);
                    displayStatusMessage(`Failed to save API key: ${response?.error || 'Unknown error'}`, 'error');
                }
            });
        } else {
            displayStatusMessage('Please enter an API key before saving.', 'warning');
        }
    });

    /**
     * Listener for messages from the background script.
     * Handles UI updates, displays AI results, and shows notifications.
     * @param {Object} message - The message object received.
     * @param {chrome.runtime.MessageSender} sender - Information about the message sender.
     * @param {function} sendResponse - Function to call to send a response (optional).
     */
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
        } else if (message.action === 'showGeneratedSteps') {
            // This message is no longer used for the primary display
            console.log('[Popup] Received deprecated showGeneratedSteps message.');
        } else if (message.action === 'showAiMagicResults') { // NEW: Handle AI Magic results
            console.log('[Popup] Received AI Magic results');
            const results = message.results || 'No results generated.';
            aiResultsTextarea.value = results;
            aiResultsTextarea.scrollTop = aiResultsTextarea.scrollHeight;
            displayStatusMessage('AI generation complete.', 'success');
            // Update button states after receiving results - get fresh state
            chrome.runtime.sendMessage({ action: 'getInitialState' }, (response) => {
                 if (response) {
                     const hasClickData = Array.isArray(response.recordedData) && response.recordedData.length > 0;
                     updateButtonStates(response.isRecording, response.isScreenRecording, hasClickData, response.hasVideo, response.activeTabId, results.trim().length > 0);
                 } else {
                      // Fallback if state fetch fails
                      aiCopyBtn.disabled = results.trim().length === 0;
                      // Keep generate button disabled until next successful state check?
                 }
            });
        } else if (message.action === 'showNotification') {
            console.log('[Popup] Received notification:', message.message);
            displayStatusMessage(message.message, message.type || 'info');
        }
    });

    /**
     * Requests the initial state from the background script when the popup opens
     * and updates the UI accordingly.
     */
    chrome.runtime.sendMessage({ action: 'getInitialState' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting initial state:", chrome.runtime.lastError.message);
             updateUI(false, [], null, false, false); // Update with default empty state
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
            // Update buttons after getting initial state
            const hasClickData = Array.isArray(response.recordedData) && response.recordedData.length > 0;
            const hasAiResults = aiResultsTextarea.value.trim().length > 0; // Check existing results on load
            updateButtonStates(response.isRecording, response.isScreenRecording, hasClickData, response.hasVideo, response.activeTabId, hasAiResults);
        } else {
            console.warn("No initial state received from background script.");
            updateUI(false, [], null, false, false);
        }
    });

    // --- Get reference to status message div --- 
    const statusMessageDiv = document.getElementById('statusMessage');

    /**
     * Displays a status message to the user in the dedicated status div.
     * @param {string} message - The message text to display.
     * @param {'info'|'error'|'success'} [type='info'] - The type of message, used for styling.
     */
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