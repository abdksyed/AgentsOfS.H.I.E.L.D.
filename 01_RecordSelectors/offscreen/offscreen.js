// Offscreen document logic for media recording

let recorder;
let data = [];
let mediaStream = null; // Keep track of the stream
let inactiveHandler = null; // To store the event handler function

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'offscreen') {
    return; // Ignore messages not intended for the offscreen document
  }

  switch (message.type) {
    case 'start-recording':
      startRecording();
      break;
    case 'stop-recording':
      stopRecording();
      break;
    case 'revoke-blob-url':
      console.log('[Offscreen] Received request to revoke Blob URL:', message.url);
      try {
        URL.revokeObjectURL(message.url);
        console.log('[Offscreen] Blob URL revoked successfully:', message.url);
        // Optionally, close the offscreen document after revoking
        // window.close(); // Consider if this is the right place
      } catch (e) {
        console.error('[Offscreen] Error revoking Blob URL:', e);
      }
      break;
    default:
      console.warn(`Unexpected message type received: ${message.type}`);
  }
});

async function startRecording() {
  if (recorder?.state === 'recording') {
    console.warn('[Offscreen] Recording already in progress.');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true, 
      video: true  
    });

    // Define the inactive handler
    inactiveHandler = () => {
      console.log('[Offscreen] Media stream became inactive.');
      // If the recorder is still in the 'recording' state when the stream becomes inactive,
      // attempt to stop it gracefully to finalize the recording.
      if (recorder?.state === 'recording') {
          console.log('[Offscreen] Stream inactive while recorder was active. Attempting to stop recorder.');
          // Call stopRecording and handle potential errors during the stop process.
          stopRecording().catch(e => console.error("[Offscreen] Error stopping recording after stream inactive:", e));
      } else {
          // Log if the stream became inactive but the recorder wasn't in a recording state.
          console.log(`[Offscreen] Stream inactive, recorder state is already '${recorder?.state}'. No stop action needed.`);
      }
    };
    // Add the listener
    mediaStream.addEventListener('inactive', inactiveHandler);

    // --- Codec Selection --- 
    let options;
    const preferredType = 'video/webm;codecs=vp9,opus';
    const fallbackTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4' // Note: MP4 support via MediaRecorder is less common
    ];

    if (MediaRecorder.isTypeSupported(preferredType)) {
        options = { mimeType: preferredType };
    } else {
        const supportedType = fallbackTypes.find(type => MediaRecorder.isTypeSupported(type));
        if (supportedType) {
            options = { mimeType: supportedType };
            console.log(`[Offscreen] Preferred format not supported, using ${supportedType}`);
        } else {
            console.warn('[Offscreen] None of the specified formats are supported, using default');
            options = {}; // Let browser choose default
        }
    }
    // --- End Codec Selection ---

    recorder = new MediaRecorder(mediaStream, options);

    data = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        data.push(event.data);
      }
    };

    recorder.onstop = async () => {
      console.log('[Offscreen] recorder.onstop event fired.');

      // Remove the inactive listener *before* processing data
      if (mediaStream && inactiveHandler) {
        console.log('[Offscreen] Removing inactive event listener.');
        mediaStream.removeEventListener('inactive', inactiveHandler);
      } else {
         console.log('[Offscreen] Could not remove inactive listener: media or handler missing.');
      }

      if (data.length === 0) {
        console.error('[Offscreen] No data recorded.');
        chrome.runtime.sendMessage({ type: 'recordingError', message: 'No data recorded.' });
        cleanup(); // Still perform cleanup
        return; 
      }
      
      const blob = new Blob(data, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      console.log(`[Offscreen] Blob created: ${url}, Size: ${blob.size}`);

      // Send the Blob URL back to the background script
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'recording-stopped',
          target: 'background',
          url: url
        });
        if (chrome.runtime.lastError) {
            console.error('[Offscreen] Error sending recording-stopped: ', chrome.runtime.lastError.message);
            URL.revokeObjectURL(url); // Clean up if sending failed
        } else {
            console.log('[Offscreen] Sent recording-stopped message, response:', response);
        }
      } catch (error) {
        console.error('[Offscreen] Failed to send recording-stopped message:', error);
        URL.revokeObjectURL(url); // Ensure cleanup on error
      }
    };

    recorder.start();
    console.log('[Offscreen] Recording started via getDisplayMedia.');

  } catch (err) {
      console.error("[Offscreen] Error starting getDisplayMedia or MediaRecorder:", err);
      // Send error to background if getDisplayMedia fails
      try {
          await chrome.runtime.sendMessage({ 
              type: 'recording-error',
              target: 'background',
              error: err.message || 'Failed to start screen capture' 
          });
      } catch (sendError) {
          console.error('[Offscreen] Failed to send start error message to background:', sendError);
      }
       // Clean up potentially partially started stream
       if (mediaStream) {
           mediaStream.getTracks().forEach(track => track.stop());
           mediaStream = null; 
       }
  }
}

async function stopRecording() {
  if (!recorder) {
    console.warn('[Offscreen] stopRecording called but recorder is not initialized.');
    return;
  }

  console.log('[Offscreen] Stopping recorder...');
  recorder.stop(); // This will trigger the 'onstop' event handler where the blob is processed

  // Ensure cleanup even if 'onstop' doesn't fire or fails
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    console.log('[Offscreen] Media stream tracks stopped in stopRecording.');
  }
  mediaStream = null;
  inactiveHandler = null; // Clear handler reference

  // Although 'onstop' handles sending the URL, we send a final confirmation
  // This helps signal the end explicitly, especially if 'onstop' might have issues
  try {
    await chrome.runtime.sendMessage({ type: 'recording-stopped', target: 'background' });
    console.log('[Offscreen] Sent recording-stopped message.');
  } catch (error) {
    console.error('[Offscreen] Failed to send recording-stopped message:', error);
  }
}