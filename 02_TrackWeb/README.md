# Web Time Tracker Chrome Extension

## Overview

A simple Chrome extension designed to track the time spent on websites. It focuses on simplicity and long-term aggregation of time data rather than detailed date-based analysis.

**Core Functionality:**
- Tracks the total time tabs are open, and the active time spent viewing them.
- Normalizes URLs to aggregate time against base paths.
- Captures and aggregates page titles for tracked URLs.
- Stores data locally using IndexedDB.
- Provides a dedicated stats page (`stats.html`) to view aggregated data.
- Allows exporting tracked data to a CSV file.

## Getting Started

To use or develop this extension, you will need:
- Node.js and npm installed.
- A modern web browser (like Google Chrome, Edge, or Brave) that supports Chrome Extension Manifest V3.

Clone the repository (or use the provided files) to your local machine.

## Installation (Developer Mode)

This extension is not available on the Chrome Web Store. To install it, you need to load it in developer mode:

1.  Open your Chrome browser.
2.  Go to the extensions page by typing `chrome://extensions/` in the address bar or by clicking the three vertical dots (⋮) > "Extensions" > "Manage Extensions".
3.  Toggle on the **Developer mode** switch, usually located in the top right corner.
4.  Click the **Load unpacked** button that appears on the top left.
5.  Navigate to the `02_TrackWeb` directory that contains the `manifest.json` file.
6.  Select the `02_TrackWeb` folder.

The extension "Web Time Tracker" should now appear in your list of installed extensions. It will also add an icon to your browser toolbar.

## How to Use

Once installed, the extension starts tracking time automatically for websites you visit, excluding `chrome://` and `chrome-extension://` pages.

### Viewing Stats

Click the extension icon in the Chrome toolbar. This will open the page `stats.html` as a popup.

### Stats Page Features

- **Aggregated View:** By default, the data is aggregated by domain.
- **Expandable Details:** Click on a domain row to expand it and see the time spent on individual normalized URLs within that domain.
- **Copy URL:** In the expanded view, click on a truncated title/URL cell to copy the full normalized URL to your clipboard.

### Data Display Columns

**Domain View:**

- **Domain:** The main domain of the website (e.g., "example.com").
- **Active Time:** The total accumulated time (DD:HH:MM:SS) when a tab with this domain was the active tab in a focused browser window.
- **Total Time:** The total accumulated time (DD:HH:MM:SS) when a tab with this domain was open in any browser window (active or background).

**Expanded (URL) View:**

- **Titles:** A string containing all unique page titles encountered for this normalized URL, separated by " | ". This is truncated visually in the table but shown in full on hover.
- **Active Time:** The total accumulated active time (DD:HH:MM:SS) for this specific normalized URL.
- **Total Time:** The total accumulated total time (DD:HH:MM:SS) for this specific normalized URL.

### Exporting Data

On the stats page, click the **Export CSV** button. This will generate a `web_time_tracker_export.csv` file and download it to your computer. The CSV contains the raw, non-aggregated data for each normalized URL.

**CSV Columns:** `Domain`, `Normalized URL`, `Titles`, `Active Seconds` (integer), `Total Seconds` (integer).

### Clearing Data

On the stats page, click the **Clear All Data** button. You will be prompted to confirm. Confirming will permanently delete all tracked data from IndexedDB.

## Features Overview (Based on PRD and Code)

- **URL Normalization:** Query parameters and fragments are removed (e.g., `https://example.com/page?q=1#section` becomes `https://example.com/page`).
- **Time Tracking:** Separate tracking for `activeSeconds` (when tab is active and window focused) and `totalSeconds` (when tab is open, any window).
- **Title Aggregation:** Unique page titles are collected and stored for each normalized URL.
- **Ignored URLs:** Excludes `chrome://` and `chrome-extension://` pages from tracking.
- **Local Storage:** Uses IndexedDB for persistent storage directly in the user's browser.
- **Stats Page:** Provides a user interface to view and manage tracked data.
- **CSV Export:** Allows users to export their data for analysis.
- **Data Clearing:** Option to remove all stored tracking data.
- **Error Handling:** Basic logging and notification for IndexedDB errors.

## Development

- The project uses **TypeScript** for type safety.
- **Webpack** is used to bundle the TypeScript files and copy static assets (`.html`, `.css`, `icons`) to the `dist` directory.

To set up the development environment:

1.  Navigate to the `02_TrackWeb` directory in your terminal.
2.  Install dependencies: `npm install`
3.  Build the project: `npm run build` (or `npx webpack` if you don't have a build script configured).

After building, the necessary files will be in the `dist` directory, which is what you load as an unpacked extension.

## Potential Future Enhancements (From PRD)

- Performance optimizations for the background timer.
- More granular data clearing options.
- Basic filtering or search on the stats page.
- Revisit date-based analysis if needed (requires schema changes). 