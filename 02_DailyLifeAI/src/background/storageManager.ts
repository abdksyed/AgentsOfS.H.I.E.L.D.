import { TrackedData, DailyData, PageData } from "../common/types";

const STORAGE_KEY = "dailyLifeAIData";

// --- Debounced Saving Refactor ---
let saveDataTimeoutId: number | null = null; // Use 'number' for browser setTimeout ID
const SAVE_DEBOUNCE_MS = 2000; // 2 seconds

// Structure to hold aggregated updates between saves
// date -> hostname -> url -> { deltaMs, lastSeen, title, isNewEntry }
let pendingUpdates: Map<string, Map<string, Map<string, { deltaMs: number; lastSeen: number; title: string; firstSeen: number | null }>>> = new Map();

async function executeSave(): Promise<void> {
    if (saveDataTimeoutId) {
        clearTimeout(saveDataTimeoutId);
        saveDataTimeoutId = null;
    }

    const updatesToProcess = pendingUpdates;
    pendingUpdates = new Map(); // Clear pending updates immediately for next cycle

    if (updatesToProcess.size === 0) {
        console.log("[StorageManager DEBUG] executeSave - No pending updates to process.");
        return;
    }

    console.log("[StorageManager DEBUG] executeSave - Processing pending updates:", updatesToProcess);

    try {
        // 1. Read current data from storage ONCE
        const allData = await getAllData(); // Reads from chrome.storage.local
        const timestampNow = Date.now();

        // 2. Iterate through pending updates and merge into allData
        for (const [date, hostMap] of updatesToProcess.entries()) {
            if (!allData[date]) allData[date] = {};
            const dayData = allData[date];

            for (const [hostname, urlMap] of hostMap.entries()) {
                if (!dayData[hostname]) dayData[hostname] = {};
                const hostData = dayData[hostname];

                for (const [url, updateInfo] of urlMap.entries()) {
                    const existingPageData = hostData[url]; // Might be undefined

                    const currentActiveMs = existingPageData?.activeMs || 0;
                    // const currentTitle = existingPageData?.title || url; // Removed - unused
                    const currentFirstSeen = existingPageData?.firstSeen || updateInfo.firstSeen || timestampNow; // Use existing, then pending, then now

                    // Simplified Title Logic: Always use the latest title from the pending updates for this URL
                    const finalTitle = updateInfo.title; 

                    const updatedPageData: PageData = {
                        activeMs: currentActiveMs + updateInfo.deltaMs,
                        lastSeen: updateInfo.lastSeen, // Use the latest lastSeen from pending
                        title: finalTitle,
                        firstSeen: currentFirstSeen, // Preserve the earliest firstSeen
                        lastUpdated: timestampNow,
                    };

                    hostData[url] = updatedPageData;
                    // console.log(`[StorageManager DEBUG] executeSave - Merged update for ${url}:`, updatedPageData);
                }
            }
        }

        // 3. Save the modified allData back to storage
        await chrome.storage.local.set({ [STORAGE_KEY]: allData });
        console.log("[StorageManager DEBUG] executeSave - Debounced save successful.");

    } catch (error) {
        console.error("[storageManager] Error during debounced save execution:", error);
        // Consider re-queueing updatesToProcess or other error handling
    }
}

// Schedules the debounced save operation
function scheduleSave(): void {
    if (saveDataTimeoutId) {
        clearTimeout(saveDataTimeoutId);
    }

    saveDataTimeoutId = setTimeout(executeSave, SAVE_DEBOUNCE_MS);
}
// --- End Debounced Saving Refactor ---

/**
 * Helper function to check if a title is generic.
 */
/* // Removed - unused
function isTitleGeneric(title: string | null | undefined, hostname: string, url: string): boolean {
    if (!title) return true;
    const lowerTitle = title.toLowerCase();
    return title === hostname || 
           title === url || 
           lowerTitle === 'chatgpt' || // Basic check
           lowerTitle.includes('chatgpt') || // Catch variations like "ChatGPT - ..." 
           lowerTitle === 'linkedin' || 
           lowerTitle.includes('feed | linkedin') || 
           lowerTitle.includes('notifications | linkedin');
}
*/

/**
 * Retrieves all tracked data from storage.
 */
async function getAllData(): Promise<TrackedData> {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        return result[STORAGE_KEY] || {};
    } catch (error) {
        console.error("Error retrieving data from local storage:", error);
        return {};
    }
}

/**
 * Retrieves tracked data for a specific date.
 */
export async function getDataForDate(date: string): Promise<DailyData | null> {
    // Ensure pending saves are flushed before reading for external use
    if (saveDataTimeoutId) {
        await executeSave(); // Force save if one is pending
    }
    const allData = await getAllData();
    return allData[date] || null;
}

/**
 * Retrieves tracked data for a given date range (inclusive).
 */
export async function getDataForRange(startDate: string, endDate: string): Promise<TrackedData> {
     // Ensure pending saves are flushed before reading for external use
    if (saveDataTimeoutId) {
        await executeSave(); // Force save if one is pending
    }
    const allData = await getAllData();
    const filteredData: TrackedData = {};
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (const dateStr in allData) {
        const current = new Date(dateStr);
        if (current >= start && current <= end) {
            filteredData[dateStr] = allData[dateStr];
        }
    }
    return filteredData;
}

/**
 * Accumulates page data updates and schedules a debounced save.
 * This function NO LONGER reads or writes directly to storage.
 */
export async function updatePageData(date: string, hostname: string, url: string, dataUpdate: Partial<PageData>): Promise<void> {
    // console.log(`[StorageManager DEBUG] updatePageData ACCUMULATE - Date: ${date}, Host: ${hostname}, URL: ${url}, Update:`, JSON.stringify(dataUpdate));

    // Basic validation
    if (!hostname || !url || hostname === 'invalid_url' || hostname === 'no_url' || hostname === 'chrome_internal' || hostname === 'chrome_extension' || hostname === 'about_page' || hostname === 'local_file' || hostname === 'other_scheme') {
        console.warn(`[StorageManager DEBUG] updatePageData - Invalid host/url provided, ignoring. Host: ${hostname}, URL: ${url}`);
        return;
    }

    // Ensure maps exist
    if (!pendingUpdates.has(date)) pendingUpdates.set(date, new Map());
    const hostMap = pendingUpdates.get(date)!;
    if (!hostMap.has(hostname)) hostMap.set(hostname, new Map());
    const urlMap = hostMap.get(hostname)!;

    // Get existing pending update or initialize
    let currentPending = urlMap.get(url);
    if (!currentPending) {
        currentPending = { deltaMs: 0, lastSeen: 0, title: dataUpdate.title || url, firstSeen: dataUpdate.firstSeen || null }; // Initialize title, firstSeen might be null initially
    }

    // Accumulate/update pending data
    currentPending.deltaMs += dataUpdate.activeMs || 0;
    currentPending.lastSeen = Math.max(currentPending.lastSeen, dataUpdate.lastSeen || 0);
    // Update title only if the new update provides one
    if (dataUpdate.title) {
        currentPending.title = dataUpdate.title; 
    }
     // Keep the earliest firstSeen encountered for this pending cycle
    if (dataUpdate.firstSeen && (currentPending.firstSeen === null || dataUpdate.firstSeen < currentPending.firstSeen)) {
         currentPending.firstSeen = dataUpdate.firstSeen;
    }


    urlMap.set(url, currentPending);
    // console.log(`[StorageManager DEBUG] updatePageData - Updated pending for ${url}:`, currentPending);

    // Schedule the save operation (which will process all pending updates)
    scheduleSave();
}

/**
 * Clears all tracked data from storage.
 */
export async function clearAllData(): Promise<void> {
    try {
        // Clear pending updates first
        pendingUpdates = new Map();
        if (saveDataTimeoutId) {
            clearTimeout(saveDataTimeoutId);
            saveDataTimeoutId = null;
        }
        // Clear storage
        await chrome.storage.local.remove(STORAGE_KEY);
        console.log("Cleared all tracking data (pending and storage).");
    } catch (error) {
        console.error("Error clearing data:", error);
    }
}

