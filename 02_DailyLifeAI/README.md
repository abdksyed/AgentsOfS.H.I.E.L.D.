# DailyLifeAI Time Tracker Chrome Extension

This Chrome extension monitors the websites you visit and tracks the time spent on each page.

## Features

*   Tracks time spent on websites (HTTP/HTTPS).
*   Distinguishes between:
    *   Active & Focused time
    *   Active & Unfocused time
    *   Idle time (when active & focused)
*   Stores data locally using `chrome.storage.local`.
*   Provides a statistics page accessible via the extension popup.
*   Allows viewing statistics by date range (Today, Yesterday, Last 7/30 Days, This Month, All Time, Custom).
*   Allows exporting statistics to CSV.

## Development

1.  **Prerequisites:** Node.js and npm installed.
2.  **Install Dependencies:** `npm install`
3.  **Build:** `npm run build` (compiles TypeScript and copies files to `dist/`)
4.  **Watch for Changes:**
    *   `npm run watch:ts` (in one terminal for TypeScript compilation)
    *   Manually run `npm run copy-static` after HTML/CSS changes, or use a more advanced setup with concurrent watching.

## Installation (Development)

1.  Build the extension using `npm run build`.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable "Developer mode" (usually a toggle in the top right).
4.  Click "Load unpacked".
5.  Select the `dist` directory within the `02_DailyLifeAI` project folder.
6.  The extension icon should appear in your toolbar.

## Usage

*   The extension runs in the background, automatically tracking time.
*   Click the extension icon in the toolbar.
*   Click "View Statistics" to open the statistics page.
*   Use the dropdown or custom date pickers to select a time range.
*   Click "Export as CSV" to download the currently displayed data.
*   Right-click the extension icon and select "Clear DailyLifeAI Tracking Data" to clear all stored history (for debugging).

## Nerdy Details (How Time Tracking Works)

<details>
<summary>Click to expand/collapse</summary>

This extension tries to figure out how much time you spend actively using different websites versus just having them open.

**Time Categories Explained:**

*   **Active & Focused:** This counts time when:
    *   A specific tab (like `docs.google.com`) is the **selected tab** in its Chrome window.
    *   AND that **Chrome window is the main window** you're currently using on your computer (it's "in focus").
    *   AND you are **actively using your computer** (moving the mouse, typing, etc., so the system isn't "idle").
    *   *Example:* You are typing notes in a Google Doc in your main Chrome window.

*   **Active & Unfocused:** This counts time when:
    *   A specific tab is the **selected tab** in its Chrome window.
    *   BUT that Chrome window is **not the main window** you're using (maybe it's visible on another monitor, or you've switched to a different application like Word or Slack).
    *   *Example:* You have a YouTube video playing in a Chrome window, but you switch to answer an email in Outlook. The time YouTube was the selected tab while Outlook was the main application counts here.

*   **Idle Time:** This counts time when:
    *   A specific tab is the **selected tab**.
    *   AND the Chrome window **is the main window** you are using.
    *   BUT you **haven't used your mouse or keyboard** for a while (based on your operating system's idle detection, usually a minute or more). The extension checks this every 15 seconds.
    *   *Example:* You are reading a long article on a webpage in your main Chrome window, but you stop scrolling or typing for a few minutes to think. That paused time gets counted here.

*   **Total Open Time (in Stats Table):** This isn't a directly tracked time bucket like the others. Instead, it shows the *total duration between the first time and the last time the extension recorded any activity* for that specific webpage URL within the selected date range. It helps show the overall time span the page was present in your tracked data, but doesn't necessarily mean the tab was physically open the entire time.

**Why do the `.ts` files import `.js` files?**

This project is written in TypeScript (`.ts` files), which is great for development. However, the browser runs JavaScript (`.js` files). We use a tool (the TypeScript Compiler, `tsc`) to convert the `.ts` code into `.js` code that Chrome can understand.

When Chrome loads the extension's background code as a modern "module", it's very strict about file paths. It needs the *exact* filename, including the `.js` extension, to find and load the different parts of the code. The TypeScript compiler, by default, doesn't automatically add the `.js` extension to the import paths it creates in the output JavaScript.

So, we write `import ... from './someFile.js';` in our TypeScript (`.ts`) source code. This looks a bit strange, but it tells the compiler: "When you create the final JavaScript (`.js`) file, make sure you include the `.js` in this import path." This ensures the compiled JavaScript has the exact paths Chrome needs, allowing the extension to load correctly.

</details>
