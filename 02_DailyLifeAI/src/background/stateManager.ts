import { ActiveTabs, TabState } from "../common/types.js";
import { getHostname } from "../common/utils.js";

let activeTabs: ActiveTabs = {};

/**
 * Gets the current state of a specific tab.
 */
export function getTabState(tabId: number): TabState | null {
    return activeTabs[tabId] || null;
}

/**
 * Gets the state of all currently tracked tabs.
 */
export function getAllTabs(): ActiveTabs {
    return { ...activeTabs }; // Return a copy
}

/**
 * Adds a new tab to the tracking state or updates an existing one minimally.
 */
export function addOrUpdateTab(tabId: number, tab: chrome.tabs.Tab, initialTimestamp: number): void {
    if (!tab.url || !tab.id) return; // Don't track tabs without URLs or IDs

    const hostname = getHostname(tab.url);
    if (hostname === 'invalid_url' || hostname === 'no_url') return; // Don't track invalid URLs

    // Spread existing state first, then apply defaults/updates
    activeTabs[tabId] = {
        ...(activeTabs[tabId] || {}),
        url: tab.url,
        hostname: hostname,
        title: tab.title || tab.url, // Capture title, fallback to URL
        windowId: tab.windowId,
        isActive: tab.active || false,
        isFocused: false, // Assume not focused initially, window focus event will correct
        isIdle: false, // Assume not idle initially
        stateStartTime: initialTimestamp,
        // Only set firstSeenToday if the tab is genuinely new to tracking
        firstSeenToday: activeTabs[tabId]?.firstSeenToday || initialTimestamp,
    };
}

/**
 * Updates the state of a specific tab and returns its previous state.
 */
export function updateTabState(tabId: number, updates: Partial<Omit<TabState, 'stateStartTime' | 'firstSeenToday'>>, timestamp: number): TabState | null {
    const previousState = getTabState(tabId);
    if (!previousState) {
        console.warn(`Attempted to update non-tracked tabId: ${tabId}`);
        return null;
    }

    const isNewUrl = updates.url && updates.url !== previousState.url;
    let newHostname = previousState.hostname;
    let newFirstSeen = previousState.firstSeenToday;
    let newTitle = updates.title !== undefined ? updates.title : previousState.title; // Prioritize incoming title update

    // Handle URL change specifically
    if (isNewUrl && updates.url) {
        newHostname = getHostname(updates.url);
        if (newHostname === 'invalid_url' || newHostname === 'no_url') {
            console.warn(`Tab ${tabId} changed to invalid URL: ${updates.url}. Removing from tracking.`);
            removeTab(tabId);
            return previousState; // Return the state before removal
        }
        newFirstSeen = timestamp; // Reset firstSeen for the new URL
        // If URL changes, also update the title from the update if provided, otherwise keep existing
        newTitle = updates.title || updates.url; // Update title on URL change, fallback to URL
    }

    // Update the state, applying calculated hostname/firstSeen/title if URL changed
    activeTabs[tabId] = {
        ...previousState,
        ...updates,
        hostname: newHostname, // Apply potentially updated hostname
        firstSeenToday: newFirstSeen, // Apply potentially reset firstSeen
        title: newTitle, // Apply updated title
        stateStartTime: timestamp // Always reset start time on state change
    };

    return previousState;
}

/**
 * Removes a tab from tracking and returns its final state.
 */
export function removeTab(tabId: number): TabState | null {
    const finalState = getTabState(tabId);
    if (finalState) {
        delete activeTabs[tabId];
    }
    return finalState;
}

/**
 * Finds the ID of the currently active tab in a given window.
 */
export function findActiveTabInWindow(windowId: number): number | null {
    for (const tabId in activeTabs) {
        const tab = activeTabs[tabId];
        // Ensure tabId is treated as a number for comparison if necessary, though windowId is the primary check
        if (tab.windowId === windowId && tab.isActive) {
            return parseInt(tabId, 10);
        }
    }
    return null;
}

/**
 * Initializes the state by querying all existing tabs and windows.
 */
export async function initializeState(): Promise<void> {
    console.log("Initializing extension state...");
    const initialTimestamp = Date.now();
    activeTabs = {}; // Reset state

    try {
        // 1. Get all relevant windows (normal type)
        const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });

        // 2. Determine the currently focused window (if any)
        let focusedWindowId: number | null = null;
        const focusedWindow = await new Promise<chrome.windows.Window | null>((resolve) => {
            // Use getLastFocused, ensuring we handle potential errors or undefined returns
            chrome.windows.getLastFocused({ populate: false, windowTypes: ['normal'] }, (window) => {
                if (chrome.runtime.lastError) {
                    console.warn("Error getting last focused window:", chrome.runtime.lastError.message);
                    resolve(null);
                } else {
                    resolve(window || null);
                }
            });
        });
        focusedWindowId = focusedWindow?.id ?? null;

        // 3. Iterate through windows and their tabs to populate initial state
        for (const window of windows) {
            if (window.tabs && window.id !== undefined) { // Ensure window.id is defined
                const isWindowFocused = (window.id === focusedWindowId);
                for (const tab of window.tabs) {
                    if (tab.id) {
                        // Add the tab with its basic info (including title)
                        addOrUpdateTab(tab.id, tab, initialTimestamp);

                        // Now refine the state based on focus
                        if (activeTabs[tab.id]) {
                            activeTabs[tab.id].isFocused = isWindowFocused;
                            // Reset startTime again to reflect the *final* initial state calculation
                            activeTabs[tab.id].stateStartTime = initialTimestamp;
                        }
                    }
                }
            }
        }

        console.log("Initial state loaded:", Object.keys(activeTabs).length, "tabs tracked.");
        // Use JSON.stringify for potentially large objects
        // console.log("Initial state details:", JSON.stringify(activeTabs, null, 2));

    } catch (error) {
        console.error("Error during initializeState:", error);
    }
}
