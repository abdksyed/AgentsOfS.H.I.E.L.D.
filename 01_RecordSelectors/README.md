# Click Recorder Chrome Extension

This Chrome extension records clicks on a webpage, capturing the CSS selector and relevant text of the clicked element.

## Features

*   **Start/Stop Recording:** Control when clicks are recorded.
*   **View Recorded Clicks:** See the captured selectors and text in the extension popup.
*   **Clear Data:** Clear the recorded data and stop recording.
*   **Download Data:** Download the recorded clicks as a text file.
*   **Status Indicator:** Shows whether recording is active (green) or stopped (red).
*   **Persistence:** Recording state and data persist across page refreshes and navigations within the same tab.

## File Structure

*   `manifest.json`: Extension configuration file.
*   `background.js`: Service worker managing state, storage, and communication.
*   `popup/popup.html`: HTML structure for the extension popup.
*   `popup/popup.css`: CSS styles for the popup.
*   `popup/popup.js`: JavaScript logic for the popup UI and interaction.
*   `content/content.js`: Content script injected into web pages to capture clicks.

## Getting Started

1.  **Clone or Download:** Get the extension files.
2.  **Open Chrome Extensions:** Navigate to `chrome://extensions/` in your Chrome browser.
3.  **Enable Developer Mode:** Ensure the "Developer mode" toggle (usually in the top-right corner) is enabled.
4.  **Load Unpacked:** Click the "Load unpacked" button.
5.  **Select Directory:** Browse to and select the `01_RecordSelectors` folder containing the `manifest.json` file.
6.  **Pin Extension (Optional):** Click the puzzle piece icon in the Chrome toolbar and pin the "Click Recorder" extension for easy access.

## How to Use

1.  Navigate to the webpage where you want to record clicks.
2.  Click the extension icon in your toolbar to open the popup.
3.  Click the **Start** button. The status indicator will turn green.
4.  Click on elements (buttons, links, inputs, etc.) on the webpage.
5.  Open the popup again to see the recorded CSS selectors and text appear in the text area.
6.  Click the **Stop** button to pause recording. The indicator will turn red.
7.  Click **Clear** to erase all recorded data (this also stops recording).
8.  Click **Download** to save the currently displayed recorded data to a `recorded_clicks.txt` file. 