import * as stateManager from "./stateManager.js";
import * as timeUpdater from "./timeUpdater.js";
import { getHostname, getCurrentDateString } from "../common/utils.js";
import { updatePageData } from "./storageManager.js";
import { TabState } from "../common/types.js";

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
    console.log("Setting up listeners...");

    // --- Tab Listeners --- //

    chrome.tabs.onCreated.addListener((tab) => {
        console.log(`Tab created: ${tab.id}`);
        if (tab.id) {
            // Add with initial state, actual state refined by onUpdated/onActivated
            stateManager.addOrUpdateTab(tab.id, tab, Date.now());
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
                    const previousState = stateManager.updateTabState(tabId, { url: tab.url }, timestamp); // title will be handled within updateTabState
                     if (previousState) {
                        await timeUpdater.calculateAndUpdateTime(previousState, timestamp);
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
                stateManager.addOrUpdateTab(activeInfo.tabId, tab, currentTimestamp);
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
        const allTabs = stateManager.getAllTabs();

        for (const tabIdStr in allTabs) {
            const tabId = parseInt(tabIdStr, 10);
            const tabState = allTabs[tabId];
            const isNowFocused = tabState.windowId === windowId;

            if (tabState.isFocused !== isNowFocused) {
                 console.log(`   Updating focus for Tab ${tabId} (Window ${tabState.windowId}). WasFocused: ${tabState.isFocused}, IsNowFocused: ${isNowFocused}`);
                // Check state BEFORE the update is applied
                const currentStateBeforeUpdate = stateManager.getTabState(tabId);
                console.log(`   Tab ${tabId} state BEFORE focus update: ${JSON.stringify(currentStateBeforeUpdate)}`);
                await handleStateTransition(tabId, { isFocused: isNowFocused });
            }
        }
    });

    // --- Idle Listener --- //

    chrome.idle.onStateChanged.addListener(async (newState) => {
        console.log(`Idle state changed: ${newState}`);
        const isNowIdle = newState !== 'active'; // 'idle' or 'locked' means user is idle
        const currentTimestamp = Date.now();
        const allTabs = stateManager.getAllTabs();

        for (const tabIdStr in allTabs) {
            const tabId = parseInt(tabIdStr, 10);
            const tabState = allTabs[tabId];

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
}
