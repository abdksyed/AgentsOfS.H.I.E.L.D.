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

  // Continue stream if recording stops unexpectedly.
  media.addEventListener('inactive', () => {
    console.log('[Offscreen] Media stream became inactive event fired.');
    // Check if the recorder is still recording before trying to stop
    if (recorder?.state === 'recording') {
        console.warn('[Offscreen] Stream inactive - stopping recorder.');
        stopRecording()?.catch(e => console.error("[Offscreen] Error stopping recording after stream inactive:", e));
    } else {
        console.log('[Offscreen] Stream inactive, but recorder is not in recording state (' + recorder?.state + '). Not stopping again.');
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