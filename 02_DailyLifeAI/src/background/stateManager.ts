import { getHostname } from "../common/utils.js";
import { ActiveTabs, TabState } from "../common/types.js";

// Use Map for better performance and type safety with numeric keys
const activeTabs: Map<number, TabState> = new Map();

/**
 * Adds or updates the state of a tab.
 * Derives tabId from the tab object.
 */
export function addOrUpdateTab(tab: chrome.tabs.Tab, timestamp: number): void {
    // Ensure tab.id exists before proceeding
    if (tab.id === undefined) {
        console.warn("[stateManager] addOrUpdateTab called with undefined tab.id", tab);
        return;
    }
    const tabId = tab.id;

    const hostname = getHostname(tab.url);
    // Filter out unsupported URLs early
    if (['invalid_url', 'no_url', 'other_scheme', 'about_page'].includes(hostname)) {
        console.log(`[stateManager] Ignoring unsupported URL for tab ${tabId}: ${tab.url}`);
        // If the tab exists, remove it
        if (activeTabs.has(tabId)) {
            removeTab(tabId); // No time calculation needed here, handled by event source
        }
        return;
    }

    const existingState = activeTabs.get(tabId);

    const newState: TabState = {
        url: tab.url || '',
        hostname: hostname,
        windowId: tab.windowId,
        isActive: tab.active,
        // Focus needs to be determined globally, default to window focus
        isFocused: tab.windowId === chrome.windows.WINDOW_ID_NONE ? false : (existingState?.isFocused ?? tab.active), // Keep existing focus or default to active
        isIdle: existingState?.isIdle ?? false, // Keep existing idle state or default to false
        stateStartTime: existingState?.stateStartTime || timestamp,
        firstSeenToday: existingState?.firstSeenToday || timestamp, // Track when URL was first seen today
        title: tab.title || tab.url || '' // Use title, fallback to url
    };

    // Update state if significantly different or new
    if (!existingState || existingState.url !== newState.url || existingState.title !== newState.title) {
        console.log(`[stateManager] Adding/Updating Tab ${tabId} - URL: ${newState.url}, Title: ${newState.title}`);
        activeTabs.set(tabId, newState);
    } else {
        console.log(`[stateManager] Tab ${tabId} state unchanged, not overwriting.`);
    }
}

/**
 * Retrieves the current state of a specific tab.
 */
export function getTabState(tabId: number): TabState | undefined {
    return activeTabs.get(tabId);
}

/**
 * Updates specific properties of a tab's state and returns the previous state.
 */
export function updateTabState(tabId: number, update: Partial<TabState>, timestamp: number): TabState | null {
    const current = activeTabs.get(tabId);
    if (!current) {
        console.warn(`[stateManager] updateTabState called for untracked tab ID: ${tabId}`);
        return null; // Indicate no previous state
    }

    const previousState: TabState = { ...current }; // Copy before mutation
    console.log(`[stateManager] Updating tab ${tabId}. Current: ${JSON.stringify(current)}, Update: ${JSON.stringify(update)}`);

    // Check if URL makes it invalid - if so, remove from tracking
    const newUrl = update.url !== undefined ? update.url : current.url; // Prioritize update URL
    const newHostname = getHostname(newUrl);
    if (newHostname === 'invalid_url' || newHostname === 'no_url') {
        console.warn(`[stateManager] Tab ${tabId} URL changed to invalid: ${newUrl}. Removing from tracking.`);
        removeTab(tabId); // Remove it
        return previousState; // Return the state just before removal
    }

    const newState: TabState = {
        ...current,
        ...update, // Apply updates
        url: newUrl,
        hostname: newHostname,
        stateStartTime: timestamp, // Reset start time for the new state
        firstSeenToday: current.firstSeenToday, // Preserve original firstSeenToday
         // Title logic: Use update title if provided, else current, fallback to newUrl if needed
        title: update.title !== undefined ? update.title : (current.title || newUrl)
    };

    // Handle specific state logic (e.g., focus affects idle)
    if (newState.isFocused === false) newState.isIdle = false; // Cannot be idle if window not focused
    if (newState.isActive === false) newState.isIdle = false; // Cannot be idle if tab not active

    activeTabs.set(tabId, newState);
    console.log(`[stateManager] Tab ${tabId} new state: ${JSON.stringify(newState)}`);

    return previousState; // Return the state *before* this update
}

/**
 * Removes a tab from tracking and returns its final state.
 */
export function removeTab(tabId: number): TabState | null {
    const finalState = activeTabs.get(tabId);
    if (finalState) {
        activeTabs.delete(tabId);
        console.log(`[stateManager] Removed tab ${tabId}. Final state: ${JSON.stringify(finalState)}`);
        return finalState;
    } else {
        console.warn(`[stateManager] Attempted to remove untracked tab ID: ${tabId}`);
        return null;
    }
}

/**
 * Returns a deep copy of the active tabs map.
 */
export function getAllTabs(): Map<number, TabState> {
    return structuredClone(activeTabs);
}

/**
 * Finds the first tab ID in a given window that is marked as active.
 */
export function findActiveTabInWindow(windowId: number): number | null {
    for (const [tabId, tabState] of activeTabs.entries()) {
        if (tabState.windowId === windowId && tabState.isActive) {
            return tabId;
        }
    }
    return null;
}

/**
 * Initializes the state by querying existing tabs and windows.
 */
export async function initializeState(): Promise<void> {
    console.log("[stateManager] Initializing state...");
    activeTabs.clear(); // Start fresh

    try {
        const windows = await chrome.windows.getAll({ populate: true });
        let focusedWindowId: number = chrome.windows.WINDOW_ID_NONE as number; // Explicitly type as number
        windows.forEach(window => {
            // Ensure window.id is a number before assigning
            if (window.focused && typeof window.id === 'number') {
                focusedWindowId = window.id;
            }
        });
        console.log(`[stateManager] Found ${windows.length} windows. Focused Window ID: ${focusedWindowId}`);

        const processTabPromises = windows.flatMap(window =>
            (window.tabs || []).map(async tab => {
                if (tab.id !== undefined) {
                    const windowIsFocused = typeof window.id === 'number' && window.id === focusedWindowId;
                    const isGloballyFocused = windowIsFocused && tab.active;
                    console.log(`[stateManager] Processing Tab ${tab.id} in Window ${window.id}. Active: ${tab.active}, WinFocused: ${windowIsFocused}, TabFocused: ${isGloballyFocused}`);
                    // Use addOrUpdateTab which handles filtering and state creation
                    addOrUpdateTab(tab, Date.now());
                    // Explicitly set focus state AFTER adding/updating base info
                    if (activeTabs.has(tab.id)) { // Check if it was actually added (not filtered)
                         // Pass timestamp to ensure stateStartTime is updated correctly
                         updateTabState(tab.id, { isFocused: isGloballyFocused, isActive: tab.active }, Date.now());
                    }
                } else {
                     console.warn("[stateManager] Found a tab without an ID during initialization.", tab);
                }
            })
        );

        await Promise.allSettled(processTabPromises);

        console.log(`[stateManager] Initial state loaded. ${activeTabs.size} tabs tracked.`);
        console.log("Initial tracked tabs:", Object.fromEntries(activeTabs));

    } catch (error) {
        console.error("[stateManager] Error during state initialization:", error);
        activeTabs.clear();
    }
}
