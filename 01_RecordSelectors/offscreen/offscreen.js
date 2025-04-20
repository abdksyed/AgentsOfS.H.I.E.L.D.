// Offscreen document logic for media recording

let recorder;
let data = [];

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
    console.warn('Recording already in progress.');
    return;
  }

  // Prompt user to select screen, window, or tab
  const media = await navigator.mediaDevices.getDisplayMedia({
    audio: true, // Request audio along with video
    video: true  // Request video
  });

  // Handle the stream becoming inactive (e.g., user stops sharing)
  media.addEventListener('inactive', () => {
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
  });

  // Set recorder options. Adjust mimeType for different formats if supported.
  const options = { mimeType: 'video/webm;codecs=vp9,opus' }; // Common WebM options
  recorder = new MediaRecorder(media, options);

  // Collect data chunks
  data = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      data.push(event.data);
    }
  };

  // Handle stop event
  recorder.onstop = async () => {
    console.log('[Offscreen] recorder.onstop event fired.');
    if (data.length === 0) {
        console.warn('[Offscreen] recorder.onstop: No data chunks recorded.');
        // Send a message indicating failure or no data?
         await chrome.runtime.sendMessage({ 
            type: 'recording-error', // Use a specific type for errors
            target: 'background',
            error: 'No data recorded' 
        });
        // Clean up tracks even if no data
        media.getTracks().forEach(track => track.stop());
        recorder = null;
        return; 
    }
    const blob = new Blob(data, { type: options.mimeType });
    const url = URL.createObjectURL(blob);
    console.log(`[Offscreen] Created Blob URL: ${url}`);

    // Send the Blob URL back to the background script
    await chrome.runtime.sendMessage({ 
        type: 'recording-stopped', 
        target: 'background', 
        url: url 
    });

    // Clean up the media stream tracks
    media.getTracks().forEach(track => track.stop());
    recorder = null; // Reset recorder
    data = []; // Clear chunks
    console.log('Offscreen recording stopped and data sent.');
  };

  // Start recording
  recorder.start();
  console.log('Offscreen recording started via getDisplayMedia.');
}

async function stopRecording() {
  console.log(`[Offscreen] stopRecording() called. Current state: ${recorder?.state}`);
  if (recorder?.state === 'recording') {
    recorder.stop(); // This will trigger the onstop event handler
    console.log('[Offscreen] recorder.stop() invoked.');
  } else {
     console.warn(`[Offscreen] No active recording to stop. State: ${recorder?.state}`);
  }
}