// Offscreen document logic for media recording

/** @type {MediaRecorder | undefined} */
let recorder;
/** @type {Blob[]} */
let data = [];
/** @type {MediaStream | null} */
let displayStream = null; // Keep track of the display stream
/** @type {MediaStream | null} */
let audioStream = null; // Keep track of the user audio stream
/** @type {MediaStream | null} */
let finalStream = null; // Combined stream for the recorder

/**
 * Handles messages sent from other extension contexts (background, popup).
 * Primarily listens for 'start-recording' and 'stop-recording' commands.
 * @param {any} message - The message received.
 * @param {chrome.runtime.MessageSender} sender - Information about the sender.
 * @param {function} sendResponse - Function to send a response.
 */
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

/**
 * Starts the screen and potentially audio recording process.
 * 1. Requests microphone access (optional).
 * 2. Requests display media (screen capture) access.
 * 3. Combines streams if audio is available.
 * 4. Sets up a MediaRecorder with appropriate codecs.
 * 5. Attaches event listeners for data and stop events.
 * 6. Starts the recorder.
 * 7. Sends confirmation or error messages back to the background script.
 */
async function startRecording() {
  if (recorder?.state === 'recording') {
    console.warn('[Offscreen] Recording already in progress.');
    return;
  }

  // Clear previous streams if any exist from a failed attempt
  stopMediaStreams(); // Helper function to stop tracks

  try {
    // 1. Get microphone audio (optional)
    try {
      console.log('[Offscreen] Requesting microphone access...');
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[Offscreen] Microphone access granted.');
    } catch (audioErr) {
      audioStream = null; // Ensure it's null if failed
      console.warn('[Offscreen] Microphone access denied or failed:', audioErr.name, audioErr.message);
      // Allow continuing without audio unless it's an unexpected error
      if (audioErr.name !== 'NotAllowedError' && audioErr.name !== 'NotFoundError' && audioErr.name !== 'AbortError') {
        throw audioErr; // Rethrow unexpected errors
      }
    }

    // 2. Get display media (screen share)
    console.log('[Offscreen] Requesting screen capture access...');
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      // Do not request audio here, we handle mic separately
    });
    console.log('[Offscreen] Screen capture access granted.');

    // 3. Combine streams
    if (audioStream) {
      console.log('[Offscreen] Combining display and audio streams.');
      const audioTracks = audioStream.getAudioTracks();
      const videoTracks = displayStream.getVideoTracks();
      finalStream = new MediaStream([...videoTracks, ...audioTracks]);
    } else {
      console.log('[Offscreen] Using display stream only.');
      finalStream = displayStream;
    }

    // Define the inactive handler - attach to video track 'onended'
    const videoTrack = finalStream.getVideoTracks()[0];
    /**
     * Handles the 'onended' event for the video track.
     * This usually occurs when the user stops sharing their screen via the browser UI.
     * If the recorder is still active, it attempts to stop it gracefully.
     */
    videoTrack.onended = () => {
      console.log('[Offscreen] Video track ended (likely user stopped sharing).');
      // If the recorder is still in the 'recording' state when the stream becomes inactive,
      // attempt to stop it gracefully to finalize the recording.
      if (recorder?.state === 'recording') {
          console.log('[Offscreen] Stream inactive while recorder was active. Attempting to stop recorder.');
          // Call stopRecording and handle potential errors during the stop process.
          stopRecording().catch(e => console.error("[Offscreen] Error stopping recording after stream inactive:", e));
      } else {
          // Log if the stream became inactive but the recorder wasn't in a recording state.
          console.log(`[Offscreen] Video track ended, recorder state is already '${recorder?.state}'. No stop action needed.`);
      }
    };

    // --- Codec Selection --- 
    let options;
    // Select codecs based on audio availability
    const preferredVideoType = audioStream ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9';
    const fallbackVideoTypes = audioStream
        ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        : ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']; // Fallbacks without audio

    if (MediaRecorder.isTypeSupported(preferredVideoType)) {
        options = { mimeType: preferredVideoType };
    } else {
        const supportedType = fallbackVideoTypes.find(type => MediaRecorder.isTypeSupported(type));
        if (supportedType) {
            options = { mimeType: supportedType };
            console.log(`[Offscreen] Preferred format not supported, using ${supportedType}`);
        } else {
            console.warn('[Offscreen] None of the specified formats are supported, using default');
            options = {}; // Let browser choose default
        }
    }
    // --- End Codec Selection ---

    recorder = new MediaRecorder(finalStream, options);

    data = [];
    /**
     * Handles the 'ondataavailable' event from the MediaRecorder.
     * Pushes the received data chunk (Blob) into the `data` array.
     * @param {BlobEvent} event - The event containing the data chunk.
     */
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        data.push(event.data);
      }
    };

    /**
     * Handles the 'onstop' event from the MediaRecorder.
     * 1. Stops all media stream tracks.
     * 2. Creates a Blob from the recorded data chunks.
     * 3. Creates a Blob URL for the video.
     * 4. Sends a message to the background script containing the Blob URL
     *    or an error message if something went wrong.
     * 5. Cleans up the data array.
     */
    recorder.onstop = async () => {
      console.log('[Offscreen] recorder.onstop event fired. Recorder state:', recorder?.state);
      console.log('[Offscreen] Data chunks received:', data.length);

      // Video track 'onended' listener cleans itself up, no need to remove here

      // Stop all media tracks now that recording is stopped
      stopMediaStreams();

      let blob = null;
      let url = null;
      let errorMessage = null;

      try {
          if (data.length === 0) {
            console.error('[Offscreen] No data recorded.');
            // Don't send error message here, handle below after cleanup attempt
            errorMessage = 'No data recorded.';
            // Skip blob/URL creation if no data
          } else {
             console.log(`[Offscreen] Creating blob with ${data.length} chunks, MIME type: ${recorder.mimeType}`);
             blob = new Blob(data, { type: recorder.mimeType });
             if (blob.size === 0) {
                console.warn('[Offscreen] Created blob, but size is 0.');
                errorMessage = 'Recorded video is empty.'; 
             } else {
                 url = URL.createObjectURL(blob);
                 console.log(`[Offscreen] Blob created: ${url}, Size: ${blob.size}`);
             }
          }
      } catch (error) {
           console.error('[Offscreen] Error creating Blob or Blob URL:', error);
           errorMessage = `Error processing recording: ${error.message}`;
           url = null; // Ensure url is null on error
           if (blob && url) { // If URL was created before error, revoke
                try { URL.revokeObjectURL(url); } catch(e) {}
           }
      }

      // Send the result (URL or error) back to the background script
      const messagePayload = {
          // Ensure type is 'recording-error' if URL is null, even if no specific error message
          type: (errorMessage || !url) ? 'recording-error' : 'recording-stopped',
          target: 'background',
          url: url, // Will be null if error occurred or no data
          error: errorMessage // Include specific error message
      };

      try {
          console.log('[Offscreen] Sending message to background:', messagePayload);
          await chrome.runtime.sendMessage(messagePayload);
          if (chrome.runtime.lastError) {
              console.error('[Offscreen] Error sending message to background: ', chrome.runtime.lastError.message);
              if (url) { // Clean up URL if sending failed
                  try { URL.revokeObjectURL(url); } catch(e) {}
              }
          }
      } catch (error) {
          console.error('[Offscreen] Exception sending message to background:', error);
          if (url) { // Ensure cleanup on error
              try { URL.revokeObjectURL(url); } catch(e) {}
          }
      }
      
      // Cleanup data array regardless of success/error
      data = [];
    };

    recorder.start();

    // Send confirmation back to background script
    await chrome.runtime.sendMessage({
        type: 'recording-started',
        target: 'background'
    });
    console.log('[Offscreen] Recording started successfully and background notified.');

  } catch (err) {
      console.error("[Offscreen] Error during media stream acquisition or recorder start:", err);
      // Send error to background if getDisplayMedia fails
      try {
          await chrome.runtime.sendMessage({ 
              type: 'recording-error',
              target: 'background',
              error: err.message || 'Failed to start recording in offscreen document.' 
          });
      } catch (sendError) {
          console.error('[Offscreen] Failed to send start error message to background:', sendError);
      }
       // Clean up any streams that might have been partially acquired
       stopMediaStreams();
  }
}

/**
 * Stops the MediaRecorder if it's currently recording or paused.
 * This triggers the `onstop` event handler.
 * Also calls `stopMediaStreams` as a safeguard.
 */
async function stopRecording() {
  if (!recorder) {
    console.warn('[Offscreen] stopRecording called but recorder is not initialized.');
    return;
  }

  console.log('[Offscreen] Stopping recorder (will trigger onstop). State:', recorder.state);
  if (recorder.state === 'recording' || recorder.state === 'paused') {
      recorder.stop(); // This will trigger the 'onstop' event handler
  } else {
       console.warn('[Offscreen] stopRecording called, but recorder state is already', recorder.state, '. Not calling stop() again.');
  }

  // Tracks are stopped in recorder.onstop or in stopMediaStreams, 
  // but call stopMediaStreams here too for safety, especially if onstop isn't reached.
  stopMediaStreams();
}

/**
 * Helper function to stop all tracks on all active media streams
 * (display, audio, combined) and reset the stream variables to null.
 */
function stopMediaStreams() {
  console.log('[Offscreen] Stopping media stream tracks...');
  finalStream?.getTracks().forEach(track => track.stop());
  displayStream?.getTracks().forEach(track => track.stop());
  audioStream?.getTracks().forEach(track => track.stop());
  finalStream = null;
  displayStream = null;
  audioStream = null;
  console.log('[Offscreen] Media stream tracks stopped.');
}