import { TrackedData, DailyData, PageData, HostnameData } from "../common/types.js";

const STORAGE_KEY = "dailyLifeAIData";

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
 * Saves the entire tracked data object back to storage.
 */
async function saveData(data: TrackedData): Promise<void> {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (error) {
        console.error("Error saving data to local storage:", error);
    }
}

/**
 * Retrieves tracked data for a specific date.
 */
export async function getDataForDate(date: string): Promise<DailyData | null> {
    const allData = await getAllData();
    return allData[date] || null;
}

/**
 * Retrieves tracked data for a given date range (inclusive).
 */
export async function getDataForRange(startDate: string, endDate: string): Promise<TrackedData> {
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
 * Updates the data for a specific page URL on a specific date.
 * Merges the provided partial data with existing data.
 */
export async function updatePageData(date: string, hostname: string, url: string, dataUpdate: Partial<PageData>): Promise<void> {
    if (!hostname || !url || hostname === 'invalid_url' || hostname === 'no_url') {
        console.warn(`Attempted to update data for invalid host/url: ${hostname}, ${url}`);
        return;
    }

    const allData = await getAllData();

    // Ensure day data exists
    if (!allData[date]) {
        allData[date] = {};
    }
    const dayData = allData[date];

    // Ensure hostname data exists
    if (!dayData[hostname]) {
        dayData[hostname] = {};
    }
    const hostData = dayData[hostname];

    // Get existing page data or initialize if new
    const isNewEntry = !hostData[url];
    const existingPageData = hostData[url] || {
        totalOpenMs: 0,
        activeFocusedMs: 0,
        activeUnfocusedMs: 0,
        idleMs: 0,
        firstSeen: dataUpdate.firstSeen || Date.now(), // Use provided firstSeen if available (only on creation)
        lastSeen: Date.now(),
        lastUpdated: Date.now(),
        title: dataUpdate.title || url // Initialize title, fallback to url
    };

    // Merge updates, incrementing time values
    const updatedPageData: PageData = {
        ...existingPageData,
        activeFocusedMs: (existingPageData.activeFocusedMs || 0) + (dataUpdate.activeFocusedMs || 0),
        activeUnfocusedMs: (existingPageData.activeUnfocusedMs || 0) + (dataUpdate.activeUnfocusedMs || 0),
        idleMs: (existingPageData.idleMs || 0) + (dataUpdate.idleMs || 0),
        // Update timestamps
        lastSeen: dataUpdate.lastSeen !== undefined ? dataUpdate.lastSeen : Date.now(),
        lastUpdated: Date.now(),
        // Update title only if provided in the update, otherwise keep existing
        title: dataUpdate.title !== undefined ? dataUpdate.title : existingPageData.title,
        // Ensure firstSeen is only set on genuine new entries
        firstSeen: isNewEntry ? (dataUpdate.firstSeen || existingPageData.firstSeen) : existingPageData.firstSeen
    };

    hostData[url] = updatedPageData;

    // Save the modified data
    await saveData(allData);
}

/**
 * Clears all tracked data from storage. (Useful for debugging)
 */
export async function clearAllData(): Promise<void> {
    try {
        await chrome.storage.local.remove(STORAGE_KEY);
        console.log("Cleared all tracking data.");
    } catch (error) {
        console.error("Error clearing data:", error);
    }
}
