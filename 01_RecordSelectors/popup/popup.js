document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');
    const downloadBtn = document.getElementById('download-btn');
    const recordedClicksTextarea = document.getElementById('recorded-clicks');
    const statusIndicator = document.getElementById('status-indicator');

    // Function to update UI elements based on state and activeTabId
    function updateUI(isRecording, recordedData, activeTabId) {
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

        if (isRecording) {
            statusIndicator.classList.remove('stopped');
            statusIndicator.classList.add('recording');
        } else {
            statusIndicator.classList.remove('recording');
            statusIndicator.classList.add('stopped');
        }

        startBtn.disabled = isRecording;
        resumeBtn.disabled = isRecording || activeTabId === null;
        stopBtn.disabled = !isRecording;
        clearBtn.disabled = dataArray.length === 0 && activeTabId === null;
        downloadBtn.disabled = dataArray.length === 0;

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
            updateUI(message.isRecording, message.recordedData, message.activeTabId);
        }
    });

    // --- Initial request for state when popup opens ---
    chrome.runtime.sendMessage({ action: 'getInitialState' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting initial state:", chrome.runtime.lastError.message);
            updateUI(false, [], null);
            return;
        }
        if (response) {
            updateUI(response.isRecording, response.recordedData, response.activeTabId);
        } else {
            console.warn("No initial state received from background script.");
            updateUI(false, [], null);
        }
    });
}); 