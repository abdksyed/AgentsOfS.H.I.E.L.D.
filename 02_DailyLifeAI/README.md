# DailyLifeAI - Chrome Extension

Tracks time spent on websites, distinguishing between active (focused window, non-idle) and inactive time.

## Features

- **Time Tracking:** Records total time a tab is open, active focused time, active unfocused time, and idle time.
- **Daily Stats:** Aggregates data per day.
- **Stats Page:** View aggregated statistics by hostname and individual pages within a selected date range.
- **CSV Export:** Export the displayed statistics to a CSV file.
- **Background Sync:** Uses `chrome.storage.local` for persistence.

## How Time is Tracked

The extension monitors several browser events to determine the state of each tab:

- **Tab Open/Close:** Basic tracking of when a tab exists.
- **Tab Activation:** When a user switches between tabs.
- **Window Focus:** When the user switches focus between Chrome windows or other applications.
- **System Idle State:** Uses `chrome.idle` to detect if the user is away from the keyboard (idle threshold defined by Chrome, typically 1 minute).

The time spent in each state is calculated:

- **Active Focused:** Tab is active in its window, the window is focused by the OS, and the system is *not* idle.
- **Active Unfocused:** Tab is active in its window, but the window is *not* focused by the OS (e.g., user is in another app).
- **Idle:** Tab is active, window is focused, but the system *is* idle.
- **Inactive/Background:** Tab is not the active tab in its window.
- **Total Open:** The total duration from when a page (URL) was first seen today until it was last seen today.

This provides a more granular view than just tracking total time open, helping understand how much time you spend actively using different websites versus just having them open, **Time Calculation:** is based on state transitions. When a tab's state changes (e.g., from active/focused to idle), the duration of the previous state is calculated and saved.

## Setup & Build

1.  **Clone/Download:** Get the code.
2.  **Install Dependencies:**
    ```bash
    cd 02_DailyLifeAI
    npm install
    ```
3.  **Build:**
    ```bash
    npm run build
    ```
    This compiles the TypeScript files into the `dist/` directory.

## Installation (Chrome/Edge)

1.  Open Chrome/Edge and go to `chrome://extensions` or `edge://extensions`.
2.  Enable **Developer mode** (usually a toggle in the top-right corner).
3.  Click **Load unpacked**.
4.  Select the `02_DailyLifeAI/dist` directory (the one created by the build step).
5.  The extension icon should appear in your toolbar.

## Usage

- The extension runs in the background, automatically tracking time.
- **Popup:** Clicking the extension icon shows a basic status (this could be enhanced).
- **Stats Page:**
  - Right-click the extension icon and select "View Statistics".
  - Or find the "DailyLifeAI Stats" entry on the `chrome://extensions` page and click "Details" -> "Extension options".
  - Select a date range and click "Load Stats".
  - Click on hostname rows to expand/collapse individual page details.
  - Click table headers to sort.
  - Click "Export CSV" to download the current view.

## Technical Details

- **Manifest V3:** Uses the current Chrome extension manifest version.
- **Service Worker:** Background logic runs in a service worker (`background/index.ts`).
- **TypeScript:** Codebase is written in TypeScript for better type safety and maintainability.
- **Modules:** Code is organized into modules (background, common, popup, stats).
- **Storage:** Uses `chrome.storage.local` to store daily aggregated data.
- **State Management:** In-memory state (`background/stateManager.ts`) tracks the current status of each tab (URL, focus, idle state, etc.) to calculate time spent in each state accurately between events.
- **Error Handling:** Basic error handling for storage and API calls.

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
