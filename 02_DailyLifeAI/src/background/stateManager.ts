import { getHostname } from "../common/utils";
import { TabState } from "../common/types";
import * as timeUpdater from "./timeUpdater";

// Define a constant for filtered hostnames
const FILTERED_HOSTNAMES = [
    'invalid_url',
    'no_url',
    'chrome_internal', // Ignore chrome:// pages
    'chrome_extension',// Ignore extension pages
    'about_page'       // Ignore about: pages
];

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
    if (FILTERED_HOSTNAMES.includes(hostname)) {
        console.log(`[stateManager] Ignoring unsupported hostname type '${hostname}' for tab ${tabId}: ${tab.url?.substring(0, 50)}...`);
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
        windowId: tab.windowId || -1,
        isActive: tab.active, // Only track active state
        stateStartTime: existingState?.stateStartTime || timestamp,
        firstSeenToday: existingState?.firstSeenToday || timestamp, // Track when URL was first seen today
        title: tab.title || tab.url || '' // Use title, fallback to url
    };

    // Update state if significantly different or new
    if (!existingState || 
        existingState.url !== newState.url || 
        existingState.title !== newState.title ||
        existingState.isActive !== newState.isActive
    ) {
        console.log(`[stateManager] Adding/Updating Tab ${tabId} - URL: ${newState.url?.substring(0, 50)}..., Title: ${newState.title}, Active: ${newState.isActive}`);
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
 * Updates specific properties of a tab's state and returns the previous state *if* the update
 * did not involve a URL change. Returns null if the URL changed (state was replaced).
 */
export async function updateTabState(tabId: number, update: Partial<TabState>, timestamp: number): Promise<TabState | null> {
    console.log(`[StateManager DEBUG] updateTabState ENTER - TabID: ${tabId}, Timestamp: ${timestamp}, Update:`, JSON.stringify(update));
    let current = activeTabs.get(tabId);

    if (!current) {
        console.warn(`[StateManager DEBUG] updateTabState - Tab ${tabId} not found in activeTabs. Attempting fetch.`);
        try {
            const tab = await chrome.tabs.get(tabId);
            addOrUpdateTab(tab, timestamp); // Add it first
            current = activeTabs.get(tabId); // Try getting it again
            if (!current) {
                 console.warn(`[stateManager] Tab ${tabId} could not be tracked after fetch (likely invalid URL or closed), ignoring update.`);
                 return null;
            }
             console.log(`[stateManager] Successfully fetched and added state for tab ${tabId}. Proceeding with update.`);
        } catch (error) {
            console.warn(`[stateManager] Error fetching tab ${tabId} during update:`, error);
            if (error instanceof Error && (error.message.includes("No tab with id") || error.message.includes("Invalid tab ID"))) {
                console.log(`[stateManager] Tab ${tabId} likely closed or invalid, ignoring update.`);
            }
            return null;
        }
    }

    // Log current state *before* any changes
    console.log(`[StateManager DEBUG] updateTabState - Current state for Tab ${tabId} BEFORE processing:`, current ? JSON.stringify(current) : 'undefined');

    const previousState: TabState = { ...current }; // Copy the state BEFORE any potential changes
    console.log(`[stateManager] Processing update for tab ${tabId}. Update: ${JSON.stringify(update)}`);

    // --- Check for URL change --- 
    const newUrl = update.url !== undefined ? update.url : current.url;
    const urlChanged = newUrl !== current.url;
    const newHostname = getHostname(newUrl);

    // --- Handle invalid URLs first --- 
    if (FILTERED_HOSTNAMES.includes(newHostname)) {
        // If the URL became invalid, calculate time for the PREVIOUS valid state before removing
        removeTab(tabId); // Remove first
        await timeUpdater.calculateAndUpdateTime(previousState, timestamp); // Use the saved previous state
        console.warn(`[stateManager] Tab ${tabId} URL updated to unsupported type '${newHostname}'. Removing. Final time calculated for previous URL: ${previousState.url}`);
        return null; // Indicate removal, no further processing
    }

    // --- Handle URL Change: Treat as New Page Visit --- 
    if (urlChanged) {
        console.log(`[StateManager DEBUG] updateTabState - URL Change Detected for Tab ${tabId}. Old: ${current.url}, New: ${newUrl}`);

        // 1. Finalize time for the OLD URL state
        console.log(`[StateManager DEBUG] updateTabState - Calling calculateAndUpdateTime for OLD state (URL Change):`, JSON.stringify(previousState));
        await timeUpdater.calculateAndUpdateTime(previousState, timestamp);

        // 2. Create a completely new state for the NEW URL
        const newState: TabState = {
            url: newUrl,
            hostname: newHostname,
            windowId: update.windowId !== undefined ? update.windowId : (current.windowId || -1),
            // Carry over active status from the update if present, otherwise from current state.
            // This ensures that if a background tab navigates, it remains inactive unless explicitly activated.
            isActive: update.isActive !== undefined ? update.isActive : current.isActive, 
            stateStartTime: timestamp, // Start time for the *new* URL state
            firstSeenToday: timestamp, // First time seeing this *new* URL today
            // Use new title from update if available, otherwise try current (which might be from the fetched tab if state was missing), fallback to URL
            title: update.title !== undefined ? update.title : (current.title || newUrl) 
        };
        activeTabs.set(tabId, newState);
        console.log(`[StateManager DEBUG] updateTabState - New state CREATED for Tab ${tabId} due to URL change:`, JSON.stringify(newState));
        return null; 
    } else {
        // --- No URL Change: Standard Update --- 
        
        // Apply updates to the current state
        const cleanUpdate = { ...update }; // Make a copy to potentially modify
        // Remove url/hostname from update as we know they didn't change
        cleanUpdate.url = undefined;
        cleanUpdate.hostname = undefined;

        const newState: TabState = {
            ...current, // Start with existing state
            ...cleanUpdate, // Apply non-URL updates
            // stateStartTime should reflect when this *updated* state began
            stateStartTime: timestamp, 
            // Keep existing firstSeenToday for the same URL
            firstSeenToday: current.firstSeenToday, 
            // Update title only if it's part of the update, otherwise keep current
            title: update.title !== undefined ? update.title : current.title,
        };

        // Check if there was a meaningful change (active status or title) besides the timestamp
        const meaningfulChange = newState.isActive !== previousState.isActive || 
                                 newState.title !== previousState.title;

        if (meaningfulChange) {
            activeTabs.set(tabId, newState);
            console.log(`[StateManager DEBUG] updateTabState - State UPDATED for Tab ${tabId} (No URL Change):`, JSON.stringify(newState));
            console.log(`[StateManager DEBUG] updateTabState - Returning OLD state for time calculation:`, JSON.stringify(previousState));
            return previousState; 
        } else {
            // If only timestamp changed or no change at all, don't update map, don't return previous state for calculation
            console.log(`[StateManager DEBUG] updateTabState - Tab ${tabId} update ignored (no meaningful change).`);
            return null;
        }
    }
}

/**
 * Removes a tab from tracking and returns its final state.
 */
export function removeTab(tabId: number): TabState | null {
    const finalState = activeTabs.get(tabId);
    if (finalState) {
        console.log(`[StateManager DEBUG] removeTab - Removing Tab ${tabId}. Final State:`, JSON.stringify(finalState));
        activeTabs.delete(tabId);
        return finalState;
    } else {
        console.warn(`[StateManager DEBUG] removeTab - Attempted to remove untracked tab ID: ${tabId}`);
        return null;
    }
}

/**
 * Returns a deep copy of the active tabs map.
 */
export function getAllTabs(): Map<number, TabState> {
    if (typeof structuredClone === 'function') {
      return structuredClone(activeTabs);
    }
    // Fallback for Chrome <98
    return JSON.parse(JSON.stringify(activeTabs));
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
        const initializationTimestamp = Date.now(); 

        for (const window of windows) {
            if (!window.tabs) continue;
            for (const tab of window.tabs) {
                if (tab.id === undefined) {
                    console.warn("[stateManager] Found a tab without an ID during initialization.", tab);
                    continue;
                }

                const tabId = tab.id;
                const hostname = getHostname(tab.url);

                if (FILTERED_HOSTNAMES.includes(hostname)) {
                    continue; 
                }

                // console.log(`[stateManager] Initializing Tab ${tab.id} in Window ${window.id}. Active: ${tab.active}`);

                const initialState: TabState = {
                    url: tab.url || '',
                    hostname: hostname,
                    windowId: tab.windowId || -1,
                    isActive: tab.active, 
                    stateStartTime: initializationTimestamp, 
                    firstSeenToday: initializationTimestamp, 
                    title: tab.title || tab.url || ''
                };

                activeTabs.set(tabId, initialState); 
                 // console.log(`[stateManager] Initial state set for Tab ${tabId}. URL: ${initialState.url.substring(0,50)}... Active: ${initialState.isActive}`);
            }
        }

        console.log(`[stateManager] Initial state loaded. ${activeTabs.size} tabs tracked.`);
        // console.log("Initial tracked tabs:", Object.fromEntries(activeTabs));

    } catch (error) {
        console.error("[stateManager] Error during state initialization:", error);
        // Log error but don't clear state if we've already processed some tabs
        if (activeTabs.size === 0) {
            console.error("[stateManager] No tabs were processed successfully.");
        } else {
            console.warn(`[stateManager] Partial initialization with ${activeTabs.size} tabs.`);
        }
    }
}
