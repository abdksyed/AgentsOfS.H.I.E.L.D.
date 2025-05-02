document.addEventListener('DOMContentLoaded', () => {
    // Define ExtensionState interface at a higher scope
    interface ExtensionState {
        isRecording: boolean;
        recordedData?: Array<RecordedItem>; // Use the defined RecordedItem
        activeTabId?: number | null;
        isScreenRecording: boolean;
        hasVideo?: boolean;
        isAiGenerating?: boolean;
        lastAiResults?: string | null;
    }

    // Define RecordedItem interface used in ExtensionState and updateUI
    interface RecordedItem {
        type: 'click' | 'inputChange';
        selector?: string;
        beforeValue?: string;
        afterValue?: string;
        domStructure?: [string | null, string | null]; // Example structure
        // Add other potential fields like timestamp if needed
    }

    // Type DOM Elements
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
    const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement | null;
    const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement | null;
    const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement | null;
    const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement | null;
    const recordedClicksTextarea = document.getElementById('recorded-clicks') as HTMLTextAreaElement | null;
    const statusIndicator = document.getElementById('status-indicator') as HTMLSpanElement | null;

    // AI Magic elements
    const aiPromptInput = document.getElementById('ai-prompt') as HTMLTextAreaElement | null;
    const aiGenerateBtn = document.getElementById('ai-generate-btn') as HTMLButtonElement | null;
    const aiResultsTextarea = document.getElementById('ai-results') as HTMLTextAreaElement | null;
    const aiCopyBtn = document.getElementById('ai-copy-btn') as HTMLButtonElement | null;
    const aiPromptSelect = document.getElementById('ai-prompt-select') as HTMLSelectElement | null;

    // Screen recording elements
    const screenStatusIndicator = document.getElementById('screen-status-indicator') as HTMLSpanElement | null;
    const startScreenBtn = document.getElementById('start-screen-btn') as HTMLButtonElement | null;
    const stopScreenBtn = document.getElementById('stop-screen-btn') as HTMLButtonElement | null;
    const downloadVideoBtn = document.getElementById('download-video-btn') as HTMLButtonElement | null;

    // Combined control
    const startBothBtn = document.getElementById('start-both-btn') as HTMLButtonElement | null;
    const stopBothBtn = document.getElementById('stop-both-btn') as HTMLButtonElement | null;

    // Settings elements
    const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement | null;
    const saveApiKeyBtn = document.getElementById('save-api-key-btn') as HTMLButtonElement | null;
    const statusMessageDiv = document.getElementById('statusMessage') as HTMLDivElement | null; // Corrected ID 'statusMessage'

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
    function updateButtonStates(
        clickRecordingActive: boolean, 
        screenRecordingActive: boolean, 
        hasClickData: boolean, 
        hasVideoData: boolean, 
        activeTabId: number | null, 
        hasAiResults: boolean
    ): void {
        const canStartSomething: boolean = !clickRecordingActive && !screenRecordingActive;
        const isAnythingRecording: boolean = clickRecordingActive || screenRecordingActive;

        // Null check elements before accessing properties
        if (startBothBtn) startBothBtn.disabled = !canStartSomething;
        if (stopBothBtn) stopBothBtn.disabled = !isAnythingRecording;

        if (startBtn) startBtn.disabled = !canStartSomething || screenRecordingActive;
        if (resumeBtn) resumeBtn.disabled = clickRecordingActive || screenRecordingActive; // Can't resume if anything is recording
        if (stopBtn) stopBtn.disabled = !clickRecordingActive;

        // Enable Clear All if not recording AND (has clicks OR has video OR has AI results)
        if (clearBtn) {
            clearBtn.disabled = isAnythingRecording || (!hasClickData && !hasVideoData && !hasAiResults);
        }
        if (downloadBtn) downloadBtn.disabled = !hasClickData || isAnythingRecording; // Enable only if has click data and not recording

        if (startScreenBtn) startScreenBtn.disabled = !canStartSomething || clickRecordingActive;
        if (stopScreenBtn) stopScreenBtn.disabled = !screenRecordingActive;
        if (downloadVideoBtn) downloadVideoBtn.disabled = !hasVideoData || isAnythingRecording; // Enable only if video exists (flag) and not recording

        // AI Magic UI
        if (aiGenerateBtn) {
            aiGenerateBtn.disabled = isAnythingRecording || (!hasVideoData && !hasClickData);
        }
        if (aiCopyBtn) aiCopyBtn.disabled = !hasAiResults;
    }

    /**
     * Updates the entire popup UI based on the state received from the background script.
     * This includes the recorded clicks textarea, status indicators, and button states.
     * @param {boolean} isRecording - Whether click/action recording is active.
     * @param {Array<Object>} recordedData - The array of recorded click/input events.
     * @param {number|null} activeTabId - The ID of the tab being recorded, or null.
     * @param {boolean} isScreenRecording - Whether screen recording is active.
     * @param {boolean} hasVideo - Whether video data (blob or URL) is available.
     * @param {boolean} isAiGenerating - Whether AI generation is currently in progress.
     * @param {string|null} lastAiResults - The last results generated by AI, if any.
     */
    function updateUI(
        isRecording: boolean, 
        recordedData: Array<RecordedItem>, // Use the interface or Array<any>
        activeTabId: number | null, 
        isScreenRecording: boolean, 
        hasVideo: boolean,
        isAiGenerating: boolean, // New state
        lastAiResults: string | null // New state
    ): void {
        console.log('[Popup] updateUI called:', { isRecording, isScreenRecording, hasVideo, isAiGenerating, lastAiResults });

        const dataArray = Array.isArray(recordedData) ? recordedData : [];
        const hasClickData: boolean = dataArray.length > 0;

        if (recordedClicksTextarea) {
            recordedClicksTextarea.value = dataArray.map((item: RecordedItem) => { // Type item
                if (item.type === 'inputChange') {
                    const before = item.beforeValue === '' ? '[Empty]' : item.beforeValue;
                    const after = item.afterValue === '' ? '[Empty]' : item.afterValue;
                    return `Input Change: ${item.selector || '[No Selector]'}\n  Before: ${before || 'N/A'}\n  After: ${after || 'N/A'}\n---`;
                } else if (item.type === 'click') {
                    return `Clicked (DOM captured)\n---`; 
                }
                 return `Unknown event type\n---`; // Fallback for unknown types
            }).join('\n');
             recordedClicksTextarea.scrollTop = recordedClicksTextarea.scrollHeight;
        }

        // Update click recording status indicator
        if (statusIndicator) {
            const clickState: string = isRecording ? 'recording' : 'stopped';
            statusIndicator.className = `indicator ${clickState}`;
            statusIndicator.setAttribute('aria-label', `Clicks recording ${clickState}`);
        }

        // Update screen recording status indicator
        if (screenStatusIndicator) {
            const screenState: string = isScreenRecording ? 'recording' : 'stopped';
            screenStatusIndicator.className = `indicator ${screenState}`;
            screenStatusIndicator.setAttribute('aria-label', `Screen recording ${screenState}`);
        }

        // Update AI section based on new state
        if (aiResultsTextarea) {
            aiResultsTextarea.value = lastAiResults || ""; // Display last results or empty
        }
        const hasValidAiResults: boolean = !!lastAiResults && lastAiResults !== "Generating..." && !lastAiResults.startsWith("Error:");

        // Update AI button states based on isAiGenerating and results
        if (aiGenerateBtn) {
            // Debug logging for Generate button state
            console.log('[Popup] updateUI - Generate Button State Check:',
                {
                    isRecording,
                    isScreenRecording,
                    isAiGenerating,
                    hasVideo,
                    hasClickData,
                    shouldBeDisabled: isRecording || isScreenRecording || isAiGenerating || (!hasVideo && !hasClickData)
                }
            );
            // Disable if anything is recording OR AI is generating OR BOTH video AND clicks are missing
            aiGenerateBtn.disabled = isRecording || isScreenRecording || isAiGenerating || (!hasVideo && !hasClickData);
        }
        if (aiCopyBtn) aiCopyBtn.disabled = !hasValidAiResults;

        // Update main button states (pass hasValidAiResults)
        updateButtonStates(isRecording, isScreenRecording, hasClickData, hasVideo, activeTabId, hasValidAiResults);

        // Optional: Show "Generating..." text more prominently if needed
        if (isAiGenerating && statusMessageDiv && !statusMessageDiv.textContent?.startsWith("Error")) {
             displayStatusMessage("AI generation in progress...", "info");
        }
    }

     // --- Helper Function for Status Messages ---
    function displayStatusMessage(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
        if (!statusMessageDiv) {
            console.error("[Popup] Status message div not found, message was:", message);
            return;
        }
        console.log(`[Popup] Displaying status message: "${message}" (${type})`);
        statusMessageDiv.textContent = message;
        statusMessageDiv.className = `status-message ${type}`; // Apply class for styling
        statusMessageDiv.style.display = 'block'; // Make it visible
        
        // Ensure message is visible by scrolling to it
        statusMessageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        
        // Optional: Hide after a delay
        setTimeout(() => {
            if (statusMessageDiv) {
                statusMessageDiv.style.display = 'none';
                console.log("[Popup] Status message hidden:", message);
            }
        }, 5000); // Hide after 5 seconds
    }

    // Add null checks for all button event listeners
    // --- Event Listeners for Buttons ---

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'startRecording' }, (response?: { success: boolean; error?: string }) => { // Type response
                if (chrome.runtime.lastError) {
                    console.error("Error sending start message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error starting: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                 if (response && !response.success) {
                     displayStatusMessage(`Could not start: ${response.error || 'Unknown reason'}`, 'error');
                 }
            });
        });
    }

    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'resumeRecording' }, (response?: { success: boolean; error?: string }) => { // Type response
                if (chrome.runtime.lastError) {
                    console.error("Error sending resume message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error resuming: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                 if (response && !response.success) {
                    displayStatusMessage(`Could not resume: ${response.error || 'Unknown reason'}`, 'error');
                 }
            });
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'stopRecording' }, (response?: { success: boolean }) => { // Type response
                if (chrome.runtime.lastError) {
                    console.error("Error sending stop message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error stopping: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
            });
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            // Clear AI results textarea locally when clearing data
            if (aiResultsTextarea) aiResultsTextarea.value = '';
            // Also clear the user prompt input
            if (aiPromptInput) aiPromptInput.value = '';
            chrome.runtime.sendMessage({ action: 'clearRecording' }, (response?: { success: boolean }) => { // Type response
                if (chrome.runtime.lastError) {
                    console.error("Error sending clear message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error clearing: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                 displayStatusMessage('Recording cleared.', 'success');
            });
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            console.log("[Popup] Download Events button clicked. Requesting download from background.");
            downloadBtn.disabled = true; 
            // Define expected response type
            interface DownloadEventsResponse {
                success: boolean;
                textContent?: string;
                error?: string;
            }
            chrome.runtime.sendMessage({ action: 'downloadEventsAction' }, (response?: DownloadEventsResponse) => {
                const reEnableButton = () => {
                     if (!downloadBtn) return;
                     chrome.runtime.sendMessage({ action: 'getInitialState' }, (state?: ExtensionState) => {
                         if (!downloadBtn) return;
                         downloadBtn.disabled = !(state?.recordedData?.length)
                             || state?.isScreenRecording
                             || (state?.isRecording ?? true); // Default to disabled if state is incomplete
                     });
                 };

                if (chrome.runtime.lastError) {
                    console.error("[Popup] Error sending download events request:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error initiating download: ${chrome.runtime.lastError.message}`, 'error');
                    reEnableButton();
                    return;
                }
                if (response?.success && typeof response?.textContent === 'string') {
                    console.log("[Popup] Received events content from background. Creating blob and initiating download.");
                    try {
                        const blob = new Blob([response.textContent], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'recorded_events.txt';
                        document.body.appendChild(a); 
                        a.click();
                        document.body.removeChild(a); 
                        URL.revokeObjectURL(url); 
                        displayStatusMessage("Download started... Check your browser downloads.", 'success');
                     } catch (e: any) {
                         console.error("[Popup] Error creating blob or initiating download:", e);
                         displayStatusMessage(`Error creating download file: ${e.message}`, 'error');
                     } finally {
                         reEnableButton(); // Re-enable button after success or error in blob creation
                     }
                } else {
                    const errorMsg = response?.error || (typeof response?.textContent !== 'string' ? 'Invalid content received' : 'Unknown error');
                    console.error("[Popup] Background reported error or invalid content for events download:", errorMsg);
                    displayStatusMessage(`Download failed: ${errorMsg}`, 'error');
                    reEnableButton();
                }
            });
        });
    }

    // --- Event Listeners for Screen Recording Buttons ---
    if (startScreenBtn) {
        startScreenBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'startScreenRecording' }, (response?: { success: boolean; error?: string }) => { // Type response
                if (chrome.runtime.lastError) {
                    console.error("Error sending start screen recording message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error starting screen recording: ${chrome.runtime.lastError.message}`, 'error');
                 } else if (response && !response.success) {
                    displayStatusMessage(`Could not start screen recording: ${response.error || 'Unknown reason'}`, 'error');
                 }
            });
        });
    }

    if (stopScreenBtn) {
        stopScreenBtn.addEventListener('click', () => {
            console.log("[Popup] Stop Screen Rec button clicked.");
            chrome.runtime.sendMessage({ action: 'stopScreenRecording' }, (response?: { success: boolean; error?: string }) => { // Type response
                if (chrome.runtime.lastError) {
                    console.error("[Popup] Error sending stop screen recording message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error stopping screen recording: ${chrome.runtime.lastError.message}`, 'error');
                 } else if (response && !response.success) {
                    displayStatusMessage(`Could not stop screen recording: ${response.error || 'Unknown reason'}`, 'error');
                 }
            });
        });
    }

    // --- Event Listener for Download Video Button (Modified) ---
    if (downloadVideoBtn) {
        downloadVideoBtn.addEventListener('click', () => {
            console.log("[Popup] Download Video button clicked. Requesting download from background.");
            if (downloadVideoBtn) downloadVideoBtn.disabled = true;

            // Define expected response type
            interface DownloadVideoResponse {
                success: boolean;
                error?: string;
            }
            chrome.runtime.sendMessage({ action: 'downloadVideoAction' }, (response?: DownloadVideoResponse) => {
                const reEnableButton = () => {
                    chrome.runtime.sendMessage({ action: 'getInitialState' }, (state?: ExtensionState) => {
                        if (chrome.runtime.lastError) {
                            console.error("[Popup] Error getting state to re-enable download video button:", chrome.runtime.lastError.message);
                            // Keep button disabled as a fallback if state fails?
                            if (downloadVideoBtn) {
                                downloadVideoBtn.disabled = true; // Ensure button stays disabled on error
                            }
                        } else if (downloadVideoBtn) {
                            // Refactor using optional chaining and nullish coalescing as per review
                            // Adding parentheses to clarify precedence for linter
                            downloadVideoBtn.disabled = !state?.hasVideo
                                || state?.isScreenRecording
                                || (state?.isRecording ?? true); // Default to disabled if state incomplete
                        }
                    });
                };

                if (chrome.runtime.lastError) {
                    console.error("[Popup] Error sending download video request:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error initiating download: ${chrome.runtime.lastError.message}`, 'error');
                    reEnableButton();
                    return;
                }
                if (response && response.success) {
                    console.log("[Popup] Background acknowledged download request.");
                    displayStatusMessage("Download initiated... Check your browser downloads.", 'info');
                    // Don't re-enable here, background update will handle it
                } else {
                    console.error("[Popup] Background reported error initiating download:", response?.error);
                    displayStatusMessage(`Download failed: ${response?.error || 'Unknown error'}`, 'error');
                    reEnableButton();
                }
            });
        });
    }
    
    // --- Combined Controls ---
    if(startBothBtn) {
        startBothBtn.addEventListener('click', () => {
             chrome.runtime.sendMessage({ action: 'startBothRecordings' }, (response?: { success: boolean; error?: string }) => { // Type response
                 if (chrome.runtime.lastError) {
                    console.error("Error sending start both message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error starting both: ${chrome.runtime.lastError.message}`, 'error');
                 } else if (response && !response.success) {
                     displayStatusMessage(`Could not start both: ${response.error || 'Unknown reason'}`, 'error');
                 }
            });
        });
    }

    if(stopBothBtn) {
        stopBothBtn.addEventListener('click', () => {
             chrome.runtime.sendMessage({ action: 'stopBothRecordings' }, (response?: { success: boolean; error?: string }) => { // Type response
                 if (chrome.runtime.lastError) {
                    console.error("Error sending stop both message:", chrome.runtime.lastError.message);
                    displayStatusMessage(`Error stopping both: ${chrome.runtime.lastError.message}`, 'error');
                 } else if (response && !response.success) {
                     displayStatusMessage(`Could not stop both: ${response.error || 'Unknown reason'}`, 'error');
                 }
            });
        });
    }

    // --- AI Magic Listeners ---
    if (aiGenerateBtn) {
        aiGenerateBtn.addEventListener('click', () => {
            const userPrompt = aiPromptInput?.value || ""; // Get prompt, default to empty string if null
            const selectedPromptFile = aiPromptSelect?.value || "step_gen_prompt.md"; // <-- Get selected prompt file, default to steps
            console.log("[Popup] AI Generate button clicked. Sending prompt:", userPrompt, "using prompt file:", selectedPromptFile);
            aiGenerateBtn.disabled = true; // Disable while processing
            if(aiResultsTextarea) aiResultsTextarea.value = "Generating..."; // Indicate processing
            
            // Define expected response type
            interface GenerateMagicResponse {
                success: boolean;
                error?: string;
                // Background script will send results via 'showAiMagicResults' message
            }

            chrome.runtime.sendMessage({ 
                action: 'generateWithAiMagic', 
                userPrompt: userPrompt,
                selectedPromptFile: selectedPromptFile // <-- Add selected prompt file to message
            }, (response?: GenerateMagicResponse) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending AI generate request:", chrome.runtime.lastError.message);
                    if(aiResultsTextarea) aiResultsTextarea.value = `Error: ${chrome.runtime.lastError.message}`;
                    displayStatusMessage(`Error generating steps: ${chrome.runtime.lastError.message}`, 'error');
                    // Re-enable button on error? State should update from background eventually.
                } else if (response?.success === false) {
                     console.error("Background reported error initiating AI generation:", response?.error);
                     if(aiResultsTextarea) aiResultsTextarea.value = `Error: ${response?.error || 'Unknown error'}`;
                     displayStatusMessage(`Failed to start AI generation: ${response?.error || 'Unknown error'}`, 'error');
                    // Re-enable button on error? State should update from background eventually.
                } else {
                     console.log("AI generation request sent successfully.");
                     // Keep button disabled, results will arrive via 'showAiMagicResults' message
                }
            });
        });
    }

    if (aiCopyBtn && aiResultsTextarea) {
        aiCopyBtn.addEventListener('click', () => {
            const textToCopy = aiResultsTextarea.value;
            if (!textToCopy || textToCopy === "Generating..." || textToCopy.startsWith("Error:")) {
                displayStatusMessage('Nothing valid to copy.', 'info');
                return;
            }

            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalText = aiCopyBtn.textContent;
                aiCopyBtn.textContent = 'Copied!';
                displayStatusMessage('AI results copied to clipboard!', 'success');
                setTimeout(() => {
                     if (aiCopyBtn.textContent === 'Copied!') { // Avoid changing if it changed due to other state updates
                        aiCopyBtn.textContent = originalText;
                     }
                }, 2000); // Revert text after 2 seconds
            }).catch(err => {
                console.error('Failed to copy AI results:', err);
                displayStatusMessage('Failed to copy results. Check console.', 'error');
            });
            // Deselect text after attempting copy
            window.getSelection()?.removeAllRanges();
        });
    }

    // Add listener to AI Results Textarea to update button state on manual clear/edit
    if (aiResultsTextarea) {
        aiResultsTextarea.addEventListener('input', () => {
            // Request current state to re-evaluate buttons, especially aiCopyBtn and potentially aiGenerateBtn
            chrome.runtime.sendMessage({ action: 'getInitialState' }, (state?: ExtensionState) => {
                if (chrome.runtime.lastError) {
                    console.error("[Popup] Error getting state on AI results input:", chrome.runtime.lastError.message);
                } else if (state) {
                    // Re-call updateUI to refresh all button states based on current data AND the textarea content
                    updateUI(
                        state.isRecording,
                        state.recordedData || [],
                        state.activeTabId || null,
                        state.isScreenRecording,
                        state.hasVideo || false,
                        state.isAiGenerating || false,
                        aiResultsTextarea.value // Pass the current textarea content as lastAiResults
                    );
                }
            });
        });
    }

    // --- Settings Listeners ---
    if (saveApiKeyBtn && apiKeyInput) {
        saveApiKeyBtn.addEventListener('click', () => {
            const apiKey = apiKeyInput.value.trim();
            console.log("[Popup] Save API key button clicked. API key length:", apiKey.length);
            if (apiKey) {
                saveApiKeyBtn.disabled = true;
                saveApiKeyBtn.textContent = 'Saving...';
                console.log("[Popup] Sending saveApiKey message to background");
                chrome.storage.session.set({ geminiApiKey: apiKey }, () => { // Changed from chrome.storage.local.set
                     console.log("[Popup] API key saved directly in popup session storage.");
                     if (saveApiKeyBtn) { // Check if button still exists
                         saveApiKeyBtn.disabled = false;
                         saveApiKeyBtn.textContent = 'Save Key';
                     }
                    if (chrome.runtime.lastError) {
                        console.error("[Popup] Error saving API key to session storage:", chrome.runtime.lastError);
                        displayStatusMessage(`Error saving key: ${chrome.runtime.lastError.message}`, 'error');
                    } else {
                        console.log("[Popup] API key saved successfully in session storage.");
                        displayStatusMessage('API Key saved successfully!', 'success');
                         if (apiKeyInput) apiKeyInput.value = ''; // Clear input after successful save
                    }
                });
            } else {
                displayStatusMessage('Please enter an API key.', 'info');
            }
        });
    }

    // --- Listener for Updates from Background Script ---
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        console.log("[Popup] Message received:", message);
        if (message.action === 'updatePopup') {
            // Directly call updateUI with all the necessary state components
            updateUI(message.isRecording, message.recordedData, message.activeTabId, message.isScreenRecording, message.hasVideo, message.isAiGenerating, message.lastAiResults);
        } else if (message.action === 'showAiMagicResults') {
            // Update the AI results textarea
            if (aiResultsTextarea) {
                aiResultsTextarea.value = message.results || "No results generated.";
            }
            // Re-enable generate button and update copy button state after results arrive (or error)
            if (aiGenerateBtn) aiGenerateBtn.disabled = false; 
            if (aiCopyBtn) aiCopyBtn.disabled = !message.results || (typeof message.results === 'string' && message.results.startsWith("Error:"));
        } else if (message.action === 'showNotification') {
             // Display notifications sent from the background script
             displayStatusMessage(message.message, message.type || 'info');
         }
    });

    // --- Initial State Request ---
    // Request the current state from the background script when the popup opens
    chrome.runtime.sendMessage({ action: 'getInitialState' }, (response: any) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting initial state:", chrome.runtime.lastError.message);
            // Initialize with default state if background is unreachable
            updateUI(false, [], null, false, false, false, null);
            displayStatusMessage('Could not connect to background script.', 'error');
        } else if (response) {
            console.log("[Popup] Initial state received:", response);
            // Update UI with the received state, including AI state
            updateUI(
                response.isRecording,
                response.recordedData,
                response.activeTabId,
                response.isScreenRecording,
                response.hasVideo,
                response.isAiGenerating, // Pass AI state
                response.lastAiResults    // Pass AI state
            );
        } else {
             // Handle case where response is null/undefined but no error occurred
             console.warn("Received empty initial state response from background.");
             updateUI(false, [], null, false, false, false, null); // Default state
        }
    });

    // Load API key from storage to potentially display it (optional)
    // Or just check if it exists to adjust UI accordingly (e.g., show prompt to enter key)
    chrome.storage.local.get('geminiApiKey', (result) => {
        if (result.geminiApiKey) {
            // Optionally display part of the key or just indicate it's set
            console.log("API Key is set.");
             if (apiKeyInput) apiKeyInput.placeholder = "API Key is set (Enter to replace)";
        } else {
             console.log("API Key not set.");
             if (apiKeyInput) apiKeyInput.placeholder = "Enter your Gemini API Key";
        }
    });

}); // End DOMContentLoaded