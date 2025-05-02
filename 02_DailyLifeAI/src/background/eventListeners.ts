import * as stateManager from "./stateManager";
import * as timeUpdater from "./timeUpdater";
import { getHostname, getCurrentDateString } from "../common/utils";
import { updatePageData } from "./storageManager";
import { TabState } from "../common/types";

// Flag to prevent multiple registrations
let listenersRegistered = false;

// Debounce updates to avoid redundant calculations on rapid events
const DEBOUNCE_DELAY = 100;
const debounceMap: Map<number, number> = new Map();

// Simplified state update handler
async function handleStateTransition(tabId: number, timestamp: number, update: Partial<TabState>) {
    // console.log(`[handleStateTransition] TabID: ${tabId}, Timestamp: ${timestamp}, Update: ${JSON.stringify(update)}`);
    const previousState = await stateManager.updateTabState(tabId, update, timestamp);
    if (previousState) {
        // Calculate time for the state that *ended*
        await timeUpdater.calculateAndUpdateTime(previousState, timestamp);
    }
}

// Debounced version of handleStateTransition
function debouncedHandleStateTransition(tabId: number, timestamp: number, update: Partial<TabState>) {
    if (debounceMap.has(tabId)) {
        clearTimeout(debounceMap.get(tabId)!);
    }
    console.log(`[EventListener DEBUG] Debounce - Scheduling handleStateTransition for Tab ${tabId}, Update:`, JSON.stringify(update));
    // setTimeout returns a number in browser environments
    const timeoutId: number = setTimeout(() => {
        console.log(`[EventListener DEBUG] Debounce - EXECUTING handleStateTransition for Tab ${tabId}, Update:`, JSON.stringify(update));
        handleStateTransition(tabId, timestamp, update);
        debounceMap.delete(tabId); // Clean up after execution
    }, DEBOUNCE_DELAY);
    debounceMap.set(tabId, timeoutId);
}

/**
 * Sets up the necessary Chrome event listeners for tracking tab states.
 */
export function registerEventListeners() {
    if (listenersRegistered) {
        // console.log("Listeners already registered, skipping setup.");
        return;
    }
    console.log("Setting up listeners...");

    // --- Tab Events --- //

    // Fired when a tab is created
    // chrome.tabs.onCreated.addListener((tab) => {
        // console.log(`Tab created: ${tab.id}`);
        // Let onUpdated handle the initial valid URL state
    // });

    // Fired when a tab is updated
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo /* REMOVED unused tab */) => {
        // We are primarily interested in updates when the tab loading is complete
        // or when the title changes significantly.
        if (changeInfo.status === 'complete' || changeInfo.title) {
            const timestamp = Date.now();
            try {
                // *** Always fetch the latest tab state directly from Chrome ***
                const currentTab = await chrome.tabs.get(tabId);
                const hostname = getHostname(currentTab.url);
                const isValid = !['invalid_url', 'no_url', 'chrome_internal', 'chrome_extension', 'about_page'].includes(hostname);

                console.log(`[EventListener DEBUG] onUpdated - Tab: ${tabId}, Status: ${changeInfo.status}, Title Change: ${changeInfo.title}, Fetched URL: ${currentTab.url}, Fetched Title: ${currentTab.title}, IsValid: ${isValid}`);

                if (isValid) {
                    // Prepare the update payload using the fresh tab data
                    const update: Partial<TabState> = {
                        url: currentTab.url,        // Always use fresh URL
                        hostname: hostname,         // Always use fresh hostname
                        title: currentTab.title || currentTab.url, // Always use fresh title
                        isActive: currentTab.active // Always use fresh active state
                        // windowId is implicitly handled by stateManager if needed
                    };
                    console.log(`[EventListener DEBUG] onUpdated - Calling debouncedHandleStateTransition for Tab ${tabId} with update:`, JSON.stringify(update));
                    // Call the debounced handler with the complete, fresh state update
                    debouncedHandleStateTransition(tabId, timestamp, update);
                } else {
                    // If the *current* URL (fetched directly) is invalid, trigger removal
                    console.warn(`[EventListener DEBUG] onUpdated - Tab ${tabId} updated to invalid URL: ${currentTab.url}. Triggering state update/removal.`);
                    // Send an update containing the invalid URL to stateManager
                    const update = { url: currentTab.url };
                    console.log(`[EventListener DEBUG] onUpdated - Calling debouncedHandleStateTransition for Tab ${tabId} with invalid URL update:`, JSON.stringify(update));
                    debouncedHandleStateTransition(tabId, timestamp, update); 
                }
            } catch (error) {
                // This might happen if the tab is closed between the event firing and chrome.tabs.get completing
                console.warn(`Error fetching tab ${tabId} in onUpdated:`, error);
                // Attempt to finalize state if it existed
                const finalState = stateManager.removeTab(tabId);
                if (finalState) {
                    timeUpdater.calculateAndUpdateTime(finalState, timestamp);
                }
                if (debounceMap.has(tabId)) {
                    clearTimeout(debounceMap.get(tabId)!);
                    debounceMap.delete(tabId);
                }
            }
        } 
    });

    // Fired when the active tab in a window changes
    chrome.tabs.onActivated.addListener((activeInfo) => {
        // console.log(`Tab activated: ${activeInfo.tabId} in window ${activeInfo.windowId}`);
        const timestamp = Date.now();

        // Deactivate the previous active tab in this window (if any)
        stateManager.getAllTabs().forEach((tabState, tabId) => {
            if (tabState.windowId === activeInfo.windowId && tabState.isActive && tabId !== activeInfo.tabId) {
                // console.log(`    Deactivating previous tab: ${tabId}`);
                debouncedHandleStateTransition(tabId, timestamp, { isActive: false });
            }
        });

        // Activate the new tab
        // console.log(`    Activating new tab: ${activeInfo.tabId}`);
        debouncedHandleStateTransition(activeInfo.tabId, timestamp, { isActive: true });
    });

    // Fired when a tab is closed
    chrome.tabs.onRemoved.addListener((tabId) => {
        // console.log(`Tab removed: ${tabId}`);
        const finalState = stateManager.removeTab(tabId);
        if (finalState) {
            timeUpdater.calculateAndUpdateTime(finalState, Date.now());
        }
        if (debounceMap.has(tabId)) {
            clearTimeout(debounceMap.get(tabId)!);
            debounceMap.delete(tabId);
        }
    });

    // --- Window Events (REMOVED) --- //
    // --- Idle Detection (REMOVED) --- //

    listenersRegistered = true;
    console.log("Listeners setup complete.");
}

// --- Runtime Listeners (outside setupListeners) --- //

// Optional: Add a listener for when the extension is shutting down (e.g., update/disable)
// This helps ensure final data points are saved.
chrome.runtime.onSuspend.addListener(() => {
    console.log("Extension suspending. Saving final tab states.");
    const shutdownTimestamp = Date.now();
    const allTabs = stateManager.getAllTabs(); // Returns Map<number, TabState>

    // Use Promise.allSettled to wait for all async updates to complete
    // Iterate over Map entries for onSuspend as well
    const updatePromises = Array.from(allTabs.entries()).map(async ([tabId, tabState]) => {
        // const tabId = Number(rawId); // No longer needed
        // Check for required fields in tabState
        if (!tabState || !tabState.url || !tabState.hostname || !tabState.firstSeenToday) { // Corrected check
            console.warn(`[onSuspend] Skipping invalid tab state for ID ${tabId}`);
            return; // skip incomplete state
        }

        try {
            // 1. Calculate and save the final time chunk before suspension
            console.log(`[onSuspend] Calculating final time for tab ${tabId}`);
            await timeUpdater.calculateAndUpdateTime(tabState, shutdownTimestamp);

            // 2. Update the lastSeen timestamp specifically for this page
            console.log(`[onSuspend] Updating lastSeen for tab ${tabId} to ${new Date(shutdownTimestamp).toISOString()}`);
            await updatePageData(getCurrentDateString(), tabState.hostname, tabState.url, { lastSeen: shutdownTimestamp });

        } catch (error) {
            console.error(`[onSuspend] Error processing tab ${tabId}:`, error);
        }
    });

    // Although onSuspend doesn't guarantee completion of async ops, we try.
    // NOTE: There's a risk of data loss here if the service worker is terminated
    // before the async operations complete (within ~5 seconds limit).
    // A more robust solution might involve periodic saving via chrome.alarms.
    Promise.allSettled(updatePromises).then(() => {
        console.log("[onSuspend] Finished attempting final state saves.");
    });

    // No timer interval to clear based on current code structure
});
