import * as stateManager from "./stateManager.js";
import * as timeUpdater from "./timeUpdater.js";
import { getHostname, getCurrentDateString } from "../common/utils.js";
import { updatePageData } from "./storageManager.js";
import { TabState } from "../common/types.js";

// Flag to ensure listeners are only set up once
let listenersRegistered = false;

// Function to handle state transitions
async function handleStateTransition(tabId: number, update: Partial<Omit<TabState, 'stateStartTime' | 'firstSeenToday'>>): Promise<void> {
    const timestamp = Date.now();
    console.log(`[handleStateTransition] TabID: ${tabId}, Timestamp: ${timestamp}, Update: ${JSON.stringify(update)}`);
    const previousState = stateManager.updateTabState(tabId, update, timestamp);
    if (previousState) {
        console.log(`   Previous State: ${JSON.stringify(previousState)}`);
        await timeUpdater.calculateAndUpdateTime(previousState, timestamp);
    } else {
        console.warn(`   No previous state found for TabID: ${tabId}`);
    }
}

export function setupListeners(): void {
    if (listenersRegistered) {
        console.log("Listeners already registered, skipping setup.");
        return;
    }
    console.log("Setting up listeners...");

    // --- Tab Listeners --- //

    chrome.tabs.onCreated.addListener((tab) => {
        console.log(`Tab created: ${tab.id}`);
        if (tab.id) {
            // Add with initial state, actual state refined by onUpdated/onActivated
            stateManager.addOrUpdateTab(tab, Date.now());
        }
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        // Track URL changes or title changes when loading completes
        const shouldUpdate = (changeInfo.status === 'complete' && tab.url)
        // Only update title if status is complete to avoid intermediate titles
        const newTitle = (changeInfo.status === 'complete') ? tab.title : undefined;

        if (shouldUpdate) {
             console.log(`Tab updated (complete): ${tabId}, URL: ${tab.url}, Title: ${newTitle}`);
            const currentState = stateManager.getTabState(tabId);
            const urlChanged = !currentState || currentState.url !== tab.url;
            const titleChanged = newTitle !== undefined && (!currentState || currentState.title !== newTitle);

            // Update if URL changed OR if title changed (and URL is valid)
            if (urlChanged || titleChanged) {
                const hostname = getHostname(tab.url); // Get hostname regardless
                if (hostname !== 'invalid_url' && hostname !== 'no_url') {
                    const updatePayload: Partial<Omit<TabState, 'stateStartTime' | 'firstSeenToday'>> = {};
                    if (urlChanged) {
                        updatePayload.url = tab.url;
                        updatePayload.hostname = hostname;
                    }
                    // Always include title in the update if it changed or if URL changed
                    if (urlChanged || titleChanged) {
                       updatePayload.title = newTitle || tab.url; // Fallback to URL if title missing
                    }

                    await handleStateTransition(tabId, updatePayload);

                    // Update firstSeen and title in storage if URL genuinely changed to a new valid one
                    if (urlChanged) {
                        await updatePageData(getCurrentDateString(), hostname, tab.url!, { // Use non-null assertion as we checked tab.url
                            firstSeen: Date.now(),
                            title: updatePayload.title // Use the title we determined for the state
                        });
                    } else if (titleChanged) {
                         // If only the title changed, update it in storage too
                         await updatePageData(getCurrentDateString(), hostname, tab.url!, {
                            title: updatePayload.title
                        });
                    }
                } else if (urlChanged) {
                    // If URL changed TO an invalid one, handle removal via stateManager
                    const timestamp = Date.now();
                    const newHostname = getHostname(tab.url); // Get the (invalid) hostname
                    const newTitle = tab.url || ''; // Use URL as title for invalid URLs
                    console.log(`[eventListeners] URL changed to invalid: ${tab.url}. Updating state before removal.`);
                    // Update state with invalid URL info before calculating final time
                    const previousState = stateManager.updateTabState(tabId, { url: tab.url, hostname: newHostname, title: newTitle }, timestamp);
                     if (previousState) {
                        await timeUpdater.calculateAndUpdateTime(previousState, timestamp);
                    } else {
                         // If updateTabState returned null (e.g., tab was already removed), no need to calculate time
                         console.warn(`[eventListeners] No previous state found for tab ${tabId} after URL changed to invalid. Time calculation skipped.`);
                    }
                }
            }
        }
    });

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        console.log(`Tab activated: ${activeInfo.tabId} in window ${activeInfo.windowId}`);
        const currentTimestamp = Date.now();

        // Find previously active tab in the same window (if any)
        const previousActiveTabId = stateManager.findActiveTabInWindow(activeInfo.windowId);
        if (previousActiveTabId && previousActiveTabId !== activeInfo.tabId) {
             console.log(`   Deactivating previous tab: ${previousActiveTabId}`);
            await handleStateTransition(previousActiveTabId, { isActive: false });
        }

        // Activate the new tab
        const newActiveTabState = stateManager.getTabState(activeInfo.tabId);
        if (newActiveTabState) {
             console.log(`   Activating new tab: ${activeInfo.tabId}`);
            await handleStateTransition(activeInfo.tabId, { isActive: true });
        } else {
            // Tab might not be tracked yet (e.g., if created and activated quickly)
            // Try fetching tab info and adding/updating it
             try {
                const tab = await chrome.tabs.get(activeInfo.tabId);
                stateManager.addOrUpdateTab(tab, currentTimestamp);
                 await handleStateTransition(activeInfo.tabId, { isActive: true }); // Now activate it
            } catch (error) {
                console.error(`Error getting tab info for activation: ${activeInfo.tabId}`, error);
            }
        }
    });

    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
        console.log(`Tab removed: ${tabId}`);
        const timestamp = Date.now();
        const finalState = stateManager.removeTab(tabId);
        if (finalState) {
            // Log the final time segment for the removed tab
            await timeUpdater.calculateAndUpdateTime(finalState, timestamp);
             // Update final lastSeen time
            await updatePageData(getCurrentDateString(), finalState.hostname, finalState.url, { lastSeen: timestamp });
        }
    });

    // --- Window Listener --- //

    chrome.windows.onFocusChanged.addListener(async (windowId) => {
        const focusGained = windowId !== chrome.windows.WINDOW_ID_NONE;
        console.log(`Window focus changed: ${focusGained ? `Gained by Window ${windowId}` : 'Lost by Chrome (WINDOW_ID_NONE)'}`);
        const currentTimestamp = Date.now();
        const allTabs = stateManager.getAllTabs(); // Returns Map<number, TabState>

        // Iterate over Map entries
        for (const [tabId, tabState] of allTabs.entries()) {
            // Skip if tabState is somehow undefined (shouldn't happen with Map)
            if (!tabState) continue;

            const isNowFocused = tabState.windowId === windowId;

            if (tabState.isFocused !== isNowFocused) {
                 console.log(`   Updating focus for Tab ${tabId} (Window ${tabState.windowId}). WasFocused: ${tabState.isFocused}, IsNowFocused: ${isNowFocused}`);
                await handleStateTransition(tabId, { isFocused: isNowFocused });
            }
        }
    });

    // --- Idle Listener --- //

    chrome.idle.onStateChanged.addListener(async (newState) => {
        console.log(`Idle state changed: ${newState}`);
        const isNowIdle = newState !== 'active'; // 'idle' or 'locked' means user is idle
        const currentTimestamp = Date.now();
        const allTabs = stateManager.getAllTabs(); // Returns Map<number, TabState>

        // Iterate over Map entries
        for (const [tabId, tabState] of allTabs.entries()) {
             // Skip if tabState is somehow undefined (shouldn't happen with Map)
            if (!tabState) continue;

            // Idle state only affects tabs that are currently active and focused
            if (tabState.isActive && tabState.isFocused && tabState.isIdle !== isNowIdle) {
                console.log(`   Updating idle for active/focused tab ${tabId}: ${isNowIdle}`);
                await handleStateTransition(tabId, { isIdle: isNowIdle });
            }
        }
    });

    // --- Alarm Listener (Optional - for periodic saves/cleanup) --- //
    // Example: Save state periodically in case of crash (though main saving is on change)
    // chrome.alarms.onAlarm.addListener((alarm) => {
    //     if (alarm.name === 'periodicSave') {
    //         console.log('Periodic save alarm triggered.');
             // Potentially update lastSeen for all active tabs?
             // const now = Date.now();
             // const currentTabs = stateManager.getAllTabs();
             // for (const tabIdStr in currentTabs) {
             //     // ... update lastSeen in storage ...
             // }
    //     }
    // });

    console.log("Listeners setup complete.");
    listenersRegistered = true; // Mark as registered
}

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
    Promise.allSettled(updatePromises).then(() => {
        console.log("[onSuspend] Finished attempting final state saves.");
    });

    // No timer interval to clear based on current code structure
});
