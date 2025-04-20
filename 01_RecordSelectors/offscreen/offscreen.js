// Offscreen document logic for media recording

let recorder;
let data = [];
let mediaStream = null; // Keep track of the stream
let inactiveHandler = null; // Keep track of the handler

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
        console.log('[Offscreen] Media stream became inactive event fired.');
        if (recorder?.state === 'recording') {
            console.warn('[Offscreen] Stream inactive - stopping recorder.');
            stopRecording()?.catch(e => console.error("[Offscreen] Error stopping recording after stream inactive:", e));
        } else {
            console.log(`[Offscreen] Stream inactive, but recorder is not in recording state (${recorder?.state}). Not stopping again.`);
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
      
      // Clean up the inactive listener first
      if (mediaStream && inactiveHandler) {
        mediaStream.removeEventListener('inactive', inactiveHandler);
        inactiveHandler = null;
        console.log('[Offscreen] Inactive event listener removed.');
      }

      if (data.length === 0) {
          console.warn('[Offscreen] recorder.onstop: No data chunks recorded.');
          try {
              await chrome.runtime.sendMessage({ 
                  type: 'recording-error',
                  target: 'background',
                  error: 'No data recorded' 
              });
          } catch (error) {
              console.error('[Offscreen] Failed to send error message to background:', error);
          }
      } else {
          const blob = new Blob(data, { type: options.mimeType });
          const url = URL.createObjectURL(blob);
          console.log(`[Offscreen] Created Blob URL: ${url}`);
          try {
              await chrome.runtime.sendMessage({ 
                  type: 'recording-stopped', 
                  target: 'background', 
                  url: url 
              });
              console.log('[Offscreen] Recording URL sent to background.');
          } catch (error) {
              console.error('[Offscreen] Failed to send recording URL to background:', error);
              // If sending fails, revoke the URL here as background won't know about it
              URL.revokeObjectURL(url);
          }
      }
      
      // General cleanup
      if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop());
          mediaStream = null; 
      }
      recorder = null; 
      data = []; 
      console.log('[Offscreen] Cleanup finished after onstop.');
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
  console.log(`[Offscreen] stopRecording() called. Current state: ${recorder?.state}`);
  if (recorder?.state === 'recording') {
    recorder.stop(); // This will trigger the onstop event handler
    console.log('[Offscreen] recorder.stop() invoked.');
  } else {
     console.warn(`[Offscreen] No active recording to stop. State: ${recorder?.state}`);
  }
}