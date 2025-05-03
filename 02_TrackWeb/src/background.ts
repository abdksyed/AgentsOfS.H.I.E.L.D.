import { openDatabase, getEntry, putEntry, WebsiteTimeEntry, getAllEntries, clearAllEntries } from './db';
import { normalizeUrl, getPageTitle } from './utils';

// Interval for total time updates (in milliseconds)
const TOTAL_TIME_INTERVAL = 5000; // 5 seconds
// Interval for active time updates (in milliseconds)
const ACTIVE_TIME_INTERVAL = 1000; // 1 second

let activeTabId: number | null = null;
let lastActiveTabNormalizedUrl: string | null = null;
let activeTabTimer: number | null = null;
let totalTimeTimer: number | null = null;

// Set of URLs to ignore for tracking
const IGNORED_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^chrome:\/\/newtab\//, // Specific pattern for New Tab Page
];

function isUrlIgnored(url: string): boolean {
  return IGNORED_URL_PATTERNS.some(pattern => pattern.test(url));
}

// Function to update time in the database
async function updateTime(normalizedUrl: string, domain: string, timeInSeconds: { active?: number; total?: number }) {
  if (isUrlIgnored(normalizedUrl)) {
    return; // Do not track ignored URLs
  }

  try {
    const db = await openDatabase();
    const entry = await getEntry(normalizedUrl);

    if (entry) {
      // Update existing entry
      entry.activeSeconds += timeInSeconds.active || 0;
      entry.totalSeconds += timeInSeconds.total || 0;
      await putEntry(entry);
    } else if (timeInSeconds.active || timeInSeconds.total) {
      // Create new entry only if there's time to add
      // Fetch title when a new entry is created
      let titles = '';
      // We might not have the tabId here directly, so we'll need to fetch title on first update after tab activation/update
      // For now, let's create the entry and handle title fetching separately on first update.

      const newEntry: WebsiteTimeEntry = {
        normalizedUrl,
        domain,
        titles: '', // Title will be fetched and updated later
        activeSeconds: timeInSeconds.active || 0,
        totalSeconds: timeInSeconds.total || 0,
      };
      await putEntry(newEntry);
      console.log(`Created new entry for ${normalizedUrl}`);

      // TODO: Trigger title fetching for this new entry
      // This needs to be done when we have the tabId, likely in onActivated or onUpdated.
    }
  } catch (error) {
    console.error(`Error updating time for ${normalizedUrl}:`, error);
    // TODO: Implement persistent error notification for the stats page
  }
}

// Timer function for active time tracking
function startActiveTimeTimer(tabId: number, normalizedUrl: string, domain: string) {
  if (activeTabTimer !== null) {
    clearInterval(activeTabTimer);
  }
  activeTabTimer = setInterval(() => {
    // Only increment if the tab is still active and the window is focused
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id === tabId) {
        updateTime(normalizedUrl, domain, { active: 1 });
      }
    });
  }, ACTIVE_TIME_INTERVAL) as unknown as number; // setInterval returns a number in extension service workers
}

// Timer function for total time tracking
function startTotalTimeTimer() {
  if (totalTimeTimer !== null) {
    clearInterval(totalTimeTimer);
  }
  totalTimeTimer = setInterval(async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const window of windows) {
      if (window.tabs) {
        for (const tab of window.tabs) {
          if (tab.url && !isUrlIgnored(tab.url)) {
            const normalizedUrl = normalizeUrl(tab.url);
            // Simple domain extraction (can be improved)
            const domainMatch = normalizedUrl.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?#]+)/i);
            const domain = domainMatch ? domainMatch[1] : 'Unknown Domain';
            await updateTime(normalizedUrl, domain, { total: TOTAL_TIME_INTERVAL / 1000 });

            // TODO: Implement title fetching logic here for existing tabs on startup/first run
            // This could be done by checking if the title field is empty when retrieving the entry.
          }
        }
      }
    }
  }, TOTAL_TIME_INTERVAL) as unknown as number; // setInterval returns a number in extension service workers
}

// Initialize timers when the service worker starts
startTotalTimeTimer();

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && !isUrlIgnored(tab.url)) {
      const normalizedUrl = normalizeUrl(tab.url);
       const domainMatch = normalizedUrl.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?#]+)/i);
       const domain = domainMatch ? domainMatch[1] : 'Unknown Domain';
      lastActiveTabNormalizedUrl = normalizedUrl;
      startActiveTimeTimer(activeInfo.tabId, normalizedUrl, domain);

      // Fetch and update title if it's a new entry or title is missing
       const entry = await getEntry(normalizedUrl);
       if (entry && entry.titles === '') {
         const title = await getPageTitle(activeInfo.tabId);
         if (title && title !== 'Unknown Title') {
           entry.titles = title;
           await putEntry(entry);
         }
       }

    } else {
      lastActiveTabNormalizedUrl = null;
      if (activeTabTimer !== null) {
        clearInterval(activeTabTimer);
        activeTabTimer = null;
      }
    }
  } catch (error) {
    console.error('Error handling tab activation:', error);
  }
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // No window is focused, stop active timer
    if (activeTabTimer !== null) {
      clearInterval(activeTabTimer);
      activeTabTimer = null;
    }
  } else if (activeTabId !== null) {
    // A window is focused, check if the previously active tab is still active in a focused window
     chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
       if (tabs && tabs[0] && tabs[0].id === activeTabId && tabs[0].url && !isUrlIgnored(tabs[0].url)) {
          const normalizedUrl = normalizeUrl(tabs[0].url);
          const domainMatch = normalizedUrl.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?#]+)/i);
          const domain = domainMatch ? domainMatch[1] : 'Unknown Domain';
         startActiveTimeTimer(activeTabId, normalizedUrl, domain);
       } else {
         if (activeTabTimer !== null) {
           clearInterval(activeTabTimer);
           activeTabTimer = null;
         }
       }
     });
  }
});

// Listen for tab updates (e.g., URL change within the same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active && tab.windowId && !isUrlIgnored(changeInfo.url)) {
    // URL changed for the active tab in a window
    activeTabId = tabId;
    const normalizedUrl = normalizeUrl(changeInfo.url);
    const domainMatch = normalizedUrl.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?#]+)/i);
    const domain = domainMatch ? domainMatch[1] : 'Unknown Domain';
    lastActiveTabNormalizedUrl = normalizedUrl;
    startActiveTimeTimer(tabId, normalizedUrl, domain);

     // Fetch and update title if it's a new entry or title is missing
     const entry = await getEntry(normalizedUrl);
     if (entry && entry.titles === '') {
       const title = await getPageTitle(tabId);
       if (title && title !== 'Unknown Title') {
         entry.titles = title;
         await putEntry(entry);
       }
     } else if (!entry) { // Newly tracked URL, fetch title after a short delay
        setTimeout(async () => {
            const updatedTab = await chrome.tabs.get(tabId);
            if (updatedTab.url && updatedTab.url === changeInfo.url) { // Ensure tab hasn't navigated again
                const title = await getPageTitle(tabId);
                 if (title && title !== 'Unknown Title') {
                   const currentEntry = await getEntry(normalizedUrl);
                   if (currentEntry) { // Entry might have been created by the total time timer
                     currentEntry.titles = title;
                     await putEntry(currentEntry);
                   }
                 }
            }
        }, 2000); // Wait ~2 seconds as per PRD
     }

  } else if (changeInfo.url && !tab.active && tab.url && !isUrlIgnored(tab.url)) {
      // URL changed for a background tab
      // The total time timer will pick this up on its next interval
      // Need to handle title fetching for background tabs too if they are newly tracked
       const normalizedUrl = normalizeUrl(tab.url);
       const entry = await getEntry(normalizedUrl);
       if (!entry) { // Newly tracked URL in background, fetch title after a short delay
         setTimeout(async () => {
             const updatedTab = await chrome.tabs.get(tabId);
             if (updatedTab.url && updatedTab.url === tab.url) { // Ensure tab hasn't navigated again
                 const title = await getPageTitle(tabId);
                 if (title && title !== 'Unknown Title') {
                    const currentEntry = await getEntry(normalizedUrl);
                    if (currentEntry) { // Entry might have been created by the total time timer
                      currentEntry.titles = title;
                      await putEntry(currentEntry);
                    }
                 }
             }
         }, 2000); // Wait ~2 seconds as per PRD
       }
  } else if (changeInfo.title && tab.url && !isUrlIgnored(tab.url)) {
    // Title changed for a tab (active or background) with a tracked URL
     const normalizedUrl = normalizeUrl(tab.url);
     const newTitle = changeInfo.title;
     if (newTitle && newTitle.trim() !== '') {
        const entry = await getEntry(normalizedUrl);
        if (entry) {
          // Append new title if not already present
          const existingTitles = entry.titles.split(' | ').map((t: string) => t.trim());
          if (!existingTitles.includes(newTitle.trim())) {
            entry.titles = entry.titles ? `${entry.titles} | ${newTitle.trim()}` : newTitle.trim();
            await putEntry(entry);
          }
        } // If entry doesn't exist, it will be created on next time update, and title will be fetched then.
     }
  }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (activeTabId === tabId) {
    activeTabId = null;
    lastActiveTabNormalizedUrl = null;
    if (activeTabTimer !== null) {
      clearInterval(activeTabTimer);
      activeTabTimer = null;
    }
  }
  // The total time timer handles stopping tracking for removed tabs implicitly
});

// Listen for messages from the stats page or popup
chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    if (request.action === 'getAllEntries') {
      getAllEntries().then(sendResponse);
      return true; // Indicate that the response will be sent asynchronously
    } else if (request.action === 'clearAllEntries') {
       clearAllEntries().then(() => sendResponse({ success: true })).catch((error: Error) => sendResponse({ success: false, error: error.message }));
       return true;
    }
    // Add other message handlers here (e.g., for specific data queries)
  }
);
