# Click & Screen Recorder Chrome Extension with AI Analysis

This Chrome extension records clicks, inputs, and screen activity on a webpage, capturing the CSS selector, relevant text of clicked elements, input changes, and a video recording. It can then use AI (Gemini) to generate step-by-step instructions based on the recording.

## Features

*   **Click/Input Recording:** Records clicks and text input changes, capturing context like selectors and values.
*   **Screen Recording:** Records video of the tab being interacted with.
*   **Combined Recording:** Start and stop both click/input and screen recording simultaneously.
*   **AI Step Generation:** Uses the recorded video and interaction data to generate step-by-step instructions via the Gemini API (requires API key).
*   **View Recorded Events:** See the captured clicks and input changes in the extension popup.
*   **Download Data:** Download recorded click/input events as a text file and the screen recording as a `.webm` video file.
*   **Clear Data:** Clear all recorded data (clicks, video, AI results) and stop recordings.
*   **Status Indicators:** Shows whether click/action recording and screen recording are active.
*   **Persistence:** Recording state and click/input data persist across page refreshes and navigations within the same tab (video is session-based).
*   **API Key Configuration:** Set your Gemini API key via the popup settings.

## File Structure

*   `manifest.json`: Extension configuration file.
*   `tsconfig.json`: TypeScript configuration file.
*   `package.json`: Project dependencies and build scripts.
*   `background.ts`: Service worker managing state, storage, communication, and API calls.
*   `popup/popup.html`: HTML structure for the extension popup.
*   `popup/popup.css`: CSS styles for the popup.
*   `popup/popup.ts`: TypeScript logic for the popup UI and interaction.
*   `content/content.ts`: Content script injected into web pages to capture clicks and inputs.
*   `offscreen/offscreen.html`: Offscreen document for screen recording.
*   `offscreen/offscreen.ts`: TypeScript logic for the offscreen document (MediaRecorder).
*   `dist/`: Directory containing the compiled JavaScript output.
*   `step_gen_prompt.md`: System prompt used for the Gemini API call.

## Getting Started

1.  **Clone or Download:** Get the extension files.
2.  **Install Dependencies:** Open a terminal in the `01_RecordSelectors` directory and run `npm install`.
3.  **Build the Extension:** Run `npm run build` in the terminal. This will compile the TypeScript files into the `dist/` directory.
4.  **Open Chrome Extensions:** Navigate to `chrome://extensions/` in your Chrome browser.
5.  **Enable Developer Mode:** Ensure the "Developer mode" toggle (usually in the top-right corner) is enabled.
6.  **Load Unpacked:** Click the "Load unpacked" button.
7.  **Select Directory:** Browse to and select the `01_RecordSelectors` folder containing the `manifest.json` file (the root folder, not the `dist` folder).
8.  **Pin Extension (Optional):** Click the puzzle piece icon in the Chrome toolbar and pin the "Recorder" extension for easy access.

## How to Use

1.  **Configure API Key (Optional but Required for AI):** Open the popup, click the settings icon (if available or implied), enter your Gemini API Key in the input field, and click "Save Key".
2.  Navigate to the webpage where you want to record.
3.  Click the extension icon in your toolbar to open the popup.
4.  **Choose Recording Type:**
    *   Click **Start Clicks** to record only clicks and input changes.
    *   Click **Start Screen** to record only the screen.
    *   Click **Start Both** to record clicks, inputs, and the screen simultaneously.
5.  Interact with the webpage (click elements, type in inputs).
6.  Open the popup to see recorded click/input events.
7.  **Stop Recording:** Click the corresponding **Stop** button (Stop Clicks, Stop Screen, or Stop Both).
8.  **Download:**
    *   Click **Download Events** to save the recorded clicks/inputs to a `.txt` file.
    *   Click **Download Video** to save the screen recording to a `.webm` file (available only after stopping screen recording).
9.  **Generate AI Steps (After stopping both recordings):**
    *   Optionally, enter a specific prompt or context in the "AI Prompt (Optional)" box.
    *   Click **Generate Steps with AI**.
    *   Wait for the results to appear in the "AI Generated Steps" area.
    *   Click **Copy AI Results** to copy the generated steps.
10. **Clear Data:** Click **Clear** to erase all recorded data (clicks, inputs, video, AI results) and reset the state. 