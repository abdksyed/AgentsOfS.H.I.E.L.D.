// Offscreen document logic for media recording

let recorder: MediaRecorder | undefined;
let data: Blob[] = [];
let displayStream: MediaStream | null = null; // Keep track of the display stream
let audioStream: MediaStream | null = null; // Keep track of the user audio stream
let finalStream: MediaStream | null = null; // Combined stream for the recorder

/**
 * Handles messages sent from other extension contexts (background, popup).
 * Primarily listens for 'start-recording' and 'stop-recording' commands.
 * @param {any} message - The message received.
 * @param {chrome.runtime.MessageSender} sender - Information about the sender.
 * @param {function} sendResponse - Function to send a response.
 */
chrome.runtime.onMessage.addListener(async (message: any) => {
  console.log("[Offscreen] Message received:", message);
  if (message.target !== 'offscreen') {
    return; // Ignore messages not intended for the offscreen document
  }

  switch (message.type) {
    case 'start-recording':
      console.log("[Offscreen] Received 'start-recording' message type.");
      await startRecording();
      break;
    case 'stop-recording':
      await stopRecording();
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
async function startRecording(): Promise<void> {
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
    } catch (audioErr: any) {
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
    if (audioStream && displayStream) {
      console.log('[Offscreen] Combining display and audio streams.');
      const audioTracks: MediaStreamTrack[] = audioStream.getAudioTracks();
      const videoTracks: MediaStreamTrack[] = displayStream.getVideoTracks();
      if (videoTracks.length > 0) {
        finalStream = new MediaStream([...videoTracks, ...audioTracks]);
      } else {
        console.warn("[Offscreen] Display stream acquired but has no video tracks.");
        finalStream = displayStream; // Fallback or handle error
      }
    } else if (displayStream) {
      console.log('[Offscreen] Using display stream only.');
      finalStream = displayStream;
    } else {
      console.error("[Offscreen] Could not acquire display stream.");
      throw new Error("Failed to acquire display stream.");
    }

    // Define the inactive handler - attach to video track 'onended'
    const videoTrack = finalStream.getVideoTracks()[0];
    if (!videoTrack) {
      console.error("[Offscreen] Final stream has no video track.");
      throw new Error("Failed to get video track from final stream.");
    }
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
        stopRecording().catch((e: any) => console.error("[Offscreen] Error stopping recording after stream inactive:", e));
      } else {
        // Log if the stream became inactive but the recorder wasn't in a recording state.
        console.log(`[Offscreen] Video track ended, recorder state is already '${recorder?.state}'. No stop action needed.`);
      }
    };

    // --- Codec Selection --- 
    let options: MediaRecorderOptions;
    // Select codecs based on audio availability
    const preferredVideoType: string = audioStream ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9';
    const fallbackVideoTypes: string[] = audioStream
        ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        : ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']; // Fallbacks without audio

    if (MediaRecorder.isTypeSupported(preferredVideoType)) {
        options = { mimeType: preferredVideoType };
    } else {
        const supportedType: string | undefined = fallbackVideoTypes.find(type => MediaRecorder.isTypeSupported(type));
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
    recorder.ondataavailable = (event: BlobEvent) => {
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
    recorder.onstop = async (): Promise<void> => {
      console.log('[Offscreen] recorder.onstop event fired. Recorder state:', recorder?.state);
      console.log('[Offscreen] Data chunks received:', data.length);

      // Video track 'onended' listener cleans itself up, no need to remove here

      // Stop all media tracks now that recording is stopped
      stopMediaStreams();

      let blob: Blob | null = null;
      let url: string | null = null;
      let errorMessage: string | null = null;

      try {
          if (data.length === 0) {
            console.error('[Offscreen] No data recorded.');
            // Don't send error message here, handle below after cleanup attempt
            errorMessage = 'No data recorded.';
            // Skip blob/URL creation if no data
          } else {
             const mimeType = recorder?.mimeType || 'video/webm';
             console.log(`[Offscreen] Creating blob with ${data.length} chunks, MIME type: ${mimeType}`);
             blob = new Blob(data, { type: mimeType });
             if (blob.size === 0) {
                console.warn('[Offscreen] Created blob, but size is 0.');
                errorMessage = 'Recorded video is empty.'; 
             } else {
                 url = URL.createObjectURL(blob);
                 console.log(`[Offscreen] Blob created: ${url}, Size: ${blob.size}`);
             }
          }
      } catch (error: any) {
           console.error('[Offscreen] Error creating Blob or Blob URL:', error);
           errorMessage = `Error processing recording: ${error.message}`;
           url = null; // Ensure url is null on error
           if (url) { 
                try { URL.revokeObjectURL(url); } catch(e) {}
           }
      }

      // Send the result (URL or error) back to the background script
      interface RecordingResultMessage {
          type: 'recording-stopped' | 'recording-error';
          target: 'background';
          url: string | null;
          error: string | null;
      }

      const messagePayload: RecordingResultMessage = {
          type: (errorMessage || !url) ? 'recording-error' : 'recording-stopped',
          target: 'background',
          url: url,
          error: errorMessage
      };

      try {
          console.log('[Offscreen] Sending message to background:', messagePayload);
          await chrome.runtime.sendMessage(messagePayload);
          if (chrome.runtime.lastError) {
              console.error('[Offscreen] Error sending message to background: ', chrome.runtime.lastError.message);
              if (url) {
                  try { URL.revokeObjectURL(url); } catch(e: any) {}
              }
          }
      } catch (error: any) {
          console.error('[Offscreen] Exception sending message to background:', error);
          if (url) {
              try { URL.revokeObjectURL(url); } catch(e: any) {}
          }
      }
      
      // Cleanup data array regardless of success/error
      data = [];
      finalStream = null;
      displayStream = null;
      audioStream = null;
      recorder = undefined;
    };

    recorder.start();

    // Send confirmation back to background script
    await chrome.runtime.sendMessage({
        type: 'recording-started',
        target: 'background'
    });
    console.log('[Offscreen] Recording started successfully and background notified.');

  } catch (err: any) {
      console.error("[Offscreen] Error during media stream acquisition or recorder start:", err);
      // Send error to background if getDisplayMedia fails
      try {
          await chrome.runtime.sendMessage({ 
              type: 'recording-error',
              target: 'background',
              error: err.message || 'Failed to start recording in offscreen document.' 
          });
      } catch (sendError: any) {
          console.error('[Offscreen] Failed to send start error message to background:', sendError);
      }
       // Clean up any streams that might have been partially acquired
       stopMediaStreams();
       recorder = undefined;
       finalStream = null;
       displayStream = null;
       audioStream = null;
       data = [];
  }
}

/**
 * Stops the recording process.
 * If the recorder is active, calls its `stop()` method, which will trigger
 * the `onstop` event handler where the blob is processed and sent.
 */
async function stopRecording(): Promise<void> {
  console.log('[Offscreen] Attempting to stop recorder. Current state:', recorder?.state);

  if (recorder && (recorder.state === 'recording' || recorder.state === 'paused')) {
    recorder.stop(); // This will trigger the 'onstop' event handler
  } else {
    console.warn(`[Offscreen] Stop requested, but recorder not active (state: ${recorder?.state}). Cleaning up streams if necessary.`);
    // If recorder wasn't active, the 'onstop' event won't fire naturally.
    // We should manually clean up streams and potentially notify background
    // that no recording was produced or it was already stopped.
    stopMediaStreams();
    data = [];
    finalStream = null;
    displayStream = null;
    audioStream = null;
    recorder = undefined;
    // Send a specific message indicating no recording was generated or stopped early?
    // For now, relying on the fact that no 'recording-stopped' message with a URL will be sent.
  }
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