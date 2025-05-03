import { openDatabase, getEntry, putEntry, WebsiteTimeEntry, getAllEntries, clearAllEntries } from './db';
import { normalizeUrl, getPageTitle, extractDomainFromUrl } from './utils';

// Constants for timer intervals (in milliseconds)
const ACTIVE_TIME_INTERVAL = 1000; // 1 second
const TOTAL_TIME_INTERVAL = 5000;  // 5 seconds

// Variables to keep track of the currently active tab and its normalized URL
let activeTabId: number | null = null;
let lastActiveTabNormalizedUrl: string | null = null;

// Set of URLs to ignore for tracking
const IGNORED_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^chrome:\/\/newtab\//, // Specific pattern for New Tab Page
];

function isUrlIgnored(url: string): boolean {
  return IGNORED_URL_PATTERNS.some(pattern => pattern.test(url));
}

// Alarm names
const ACTIVE_TIME_ALARM_NAME = 'activeTimeAlarm';
const TOTAL_TIME_ALARM_NAME = 'totalTimeAlarm';

// Create alarms on service worker startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(TOTAL_TIME_ALARM_NAME, { periodInMinutes: TOTAL_TIME_INTERVAL / 60000 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TOTAL_TIME_ALARM_NAME, { periodInMinutes: TOTAL_TIME_INTERVAL / 60000 });
});

// Listener for chrome.alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ACTIVE_TIME_ALARM_NAME) {
    // Logic for active time tracking (originally in startActiveTimeTimer)
    if (activeTabId !== null) {
       chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        try {
          if (tabs?.[0]?.id === activeTabId && tabs?.[0]?.url && !isUrlIgnored(tabs[0].url)) {
            const normalizedUrl = normalizeUrl(tabs[0].url);
            const domain = extractDomainFromUrl(normalizedUrl);
            await updateTime(normalizedUrl, domain, { active: ACTIVE_TIME_INTERVAL / 1000 });
          } else {
            // If the tab is no longer active/focused, clear the active time alarm
             chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
          }
        } catch (error) {
          console.error('Error in active time alarm callback:', error);
          // Optionally clear the alarm on error if needed
          chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
        }
      });
    } else {
       // If activeTabId is null, clear the active time alarm
      chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
    }

  } else if (alarm.name === TOTAL_TIME_ALARM_NAME) {
    // Logic for total time tracking (originally in startTotalTimeTimer)
    const windows = await chrome.windows.getAll({ populate: true });
    for (const window of windows) {
      if (window.tabs) {
        for (const tab of window.tabs) {
          if (tab.url && !isUrlIgnored(tab.url)) {
            const normalizedUrl = normalizeUrl(tab.url);
            const domain = extractDomainFromUrl(normalizedUrl);
            await updateTime(normalizedUrl, domain, { total: TOTAL_TIME_INTERVAL / 1000 });

            // TODO: Implement title fetching logic here for existing tabs on startup/first run
            // This could be done by checking if the title field is empty when retrieving the entry.
          }
        }
      }
    }
  }
});

// Helper function to update time in IndexedDB
async function updateTime(normalizedUrl: string, domain: string, timeInSeconds: { active?: number; total?: number }) {
  try {
    const db = await openDatabase(); // Assuming openDatabase is available from db.ts
    const tx = db.transaction('website_times', 'readwrite');
    const store = tx.objectStore('website_times');

    // Use get and put within the same transaction for atomicity
    // This addresses Issue 2: Race condition
    const entry = await store.get(normalizedUrl);

    if (entry) {
      if (timeInSeconds.active) {
        entry.activeSeconds = (entry.activeSeconds || 0) + timeInSeconds.active;
      }
      if (timeInSeconds.total) {
        entry.totalSeconds = (entry.totalSeconds || 0) + timeInSeconds.total;
      }
      // Ensure titles is initialized if it's a new entry from total time timer before title fetching
      if (entry.titles === undefined) {
          entry.titles = '';
      }
      await store.put(entry);
    } else {
      // Create a new entry if it doesn't exist
      const newEntry: WebsiteTimeEntry = {
        normalizedUrl: normalizedUrl,
        domain: domain,
        titles: '', // Initialize titles to empty, will be fetched later by onUpdated/onActivated
        activeSeconds: timeInSeconds.active || 0,
        totalSeconds: timeInSeconds.total || 0,
      };
      await store.add(newEntry);
    }

    await tx.done; // Wait for the transaction to complete with promised IndexedDB
  } catch (error) {
    console.error(`Error updating time for ${normalizedUrl}:`, error);
    // TODO: Implement a mechanism to notify the user about storage errors
  }
}

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && !isUrlIgnored(tab.url)) {
      const normalizedUrl = normalizeUrl(tab.url);
       const domain = extractDomainFromUrl(normalizedUrl);
      lastActiveTabNormalizedUrl = normalizedUrl;
      // Start or restart the active time alarm
      chrome.alarms.create(ACTIVE_TIME_ALARM_NAME, { periodInMinutes: ACTIVE_TIME_INTERVAL / 60000 });

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
      // Clear the active time alarm if the tab is ignored
       chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
    }
  } catch (error) {
    console.error('Error handling tab activation:', error);
     // Clear the active time alarm on error
     chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
  }
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // No window is focused, stop active timer
    // Clear the active time alarm
    chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
  } else if (activeTabId !== null) {
    // A window is focused, check if the previously active tab is still active in a focused window
     chrome.tabs.query({ active: true, windowId: windowId }, async (tabs) => {
       if (tabs && tabs[0] && tabs[0].id === activeTabId && tabs[0].url && !isUrlIgnored(tabs[0].url)) {
          // If the previously active tab is still active in the focused window, ensure the alarm is running
           chrome.alarms.create(ACTIVE_TIME_ALARM_NAME, { periodInMinutes: ACTIVE_TIME_INTERVAL / 60000 });
       } else {
         // If the previously active tab is not active in the focused window, clear the alarm
         chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
       }
     });
   } else {
      // If activeTabId is null, clear the active time alarm on window focus change
     chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
  }
});

// Listen for tab updates (e.g., URL change within the same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active && tab.windowId && !isUrlIgnored(changeInfo.url)) {
    // URL changed for the active tab in a window
    activeTabId = tabId;
    const normalizedUrl = normalizeUrl(changeInfo.url);
    const domain = extractDomainFromUrl(normalizedUrl);
    lastActiveTabNormalizedUrl = normalizedUrl;
    // Start or restart the active time alarm
    chrome.alarms.create(ACTIVE_TIME_ALARM_NAME, { periodInMinutes: ACTIVE_TIME_INTERVAL / 60000 });

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
      // The total time alarm will pick this up on its next interval
      // Need to handle title fetching for background tabs too if they are newly tracked
       const normalizedUrl = normalizeUrl(tab.url);
       const domain = extractDomainFromUrl(normalizedUrl);
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
    // Clear the active time alarm if the active tab is removed
    chrome.alarms.clear(ACTIVE_TIME_ALARM_NAME);
  }
  // The total time alarm handles stopping tracking for removed tabs implicitly
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
    } else if (request.action === 'exportData') {
      // TODO: Implement data export logic
      console.log('Export data action received');
      sendResponse({ success: true });
    }
    // Note: For other actions, sendResponse might not be called if not needed,
    // or an error could be logged if the action is unrecognized.
  }
);
