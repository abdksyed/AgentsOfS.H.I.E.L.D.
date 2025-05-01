import { TrackedData, PageData, DisplayStat, AggregatedHostnameData } from "../common/types.js";
import { formatTime } from "../common/utils.js";

// Assuming storageManager could be accessed if this ran in the background,
// but on the stats page, we need to request data from the background script.
// Or, for simplicity now, directly access storage (requires stats page context)

const STORAGE_KEY = "dailyLifeAIData";

/**
 * Helper to get all data directly from storage (for use in stats page context).
 */
async function getAllDataDirectly(): Promise<TrackedData> {
    try {
        // Check if chrome.storage is available (it should be in extension pages)
        if (chrome?.storage?.local) {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            return result[STORAGE_KEY] || {};
        } else {
            console.error("chrome.storage.local is not available in this context.");
            return {};
        }
    } catch (error) {
        console.error("Error retrieving data directly from local storage:", error);
        return {};
    }
}

/**
 * Fetches data from storage for the specified range and aggregates it by hostname.
 */
export async function fetchAndProcessStats(startDateStr: string, endDateStr: string): Promise<AggregatedHostnameData[]> {
    console.log(`Fetching stats from ${startDateStr} to ${endDateStr}`);
    const allData = await getAllDataDirectly();
    const aggregatedHostData: { [hostname: string]: Omit<AggregatedHostnameData, 'hostname'> } = {};

    const start = new Date(startDateStr + 'T00:00:00'); // Ensure start of day
    const end = new Date(endDateStr + 'T23:59:59'); // Ensure end of day

    // Aggregate data across the date range
    for (const dateStr in allData) {
        const currentDateOnlyStr = dateStr.substring(0, 10);
        const currentDateOnly = new Date(currentDateOnlyStr + 'T00:00:00');

        if (currentDateOnly >= start && currentDateOnly <= end) {
            const dailyData = allData[dateStr];
            for (const hostname in dailyData) {
                // Initialize hostname entry if it doesn't exist
                if (!aggregatedHostData[hostname]) {
                    aggregatedHostData[hostname] = {
                        totalActiveFocusedMs: 0,
                        totalActiveUnfocusedMs: 0,
                        totalIdleMs: 0,
                        totalOpenMs: 0, // Will calculate final span later
                        firstSeen: Infinity,
                        lastSeen: 0,
                        pages: []
                    };
                }
                const hostAggregate = aggregatedHostData[hostname];

                for (const url in dailyData[hostname]) {
                    const pageData = dailyData[hostname][url];

                    // Sum up time values for the hostname total
                    hostAggregate.totalActiveFocusedMs += pageData.activeFocusedMs || 0;
                    hostAggregate.totalActiveUnfocusedMs += pageData.activeUnfocusedMs || 0;
                    hostAggregate.totalIdleMs += pageData.idleMs || 0;

                    // Track overall first/last seen for the hostname
                    hostAggregate.firstSeen = Math.min(hostAggregate.firstSeen, pageData.firstSeen);
                    hostAggregate.lastSeen = Math.max(hostAggregate.lastSeen, pageData.lastSeen);

                    // Create and add the individual page data (formatted)
                    const pageTotalOpenMs = pageData.lastSeen - pageData.firstSeen;
                    hostAggregate.pages.push({
                        hostname: hostname, // Include for potential use
                        url: url,
                        title: pageData.title || url, // Use title, fallback to url
                        activeFocusedTime: formatTime(pageData.activeFocusedMs || 0),
                        activeUnfocusedTime: formatTime(pageData.activeUnfocusedMs || 0),
                        idleTime: formatTime(pageData.idleMs || 0),
                        totalOpenTime: formatTime(pageTotalOpenMs > 0 ? pageTotalOpenMs : 0),
                        firstSeen: new Date(pageData.firstSeen).toLocaleString(),
                        lastSeen: new Date(pageData.lastSeen).toLocaleString(),
                    });
                }
            }
        }
    }

    // Convert aggregated data map to array and calculate final values
    const result: AggregatedHostnameData[] = Object.entries(aggregatedHostData).map(([hostname, data]) => {
        // Calculate final totalOpenMs for the hostname based on its overall span
        const hostnameTotalOpenMs = (data.firstSeen === Infinity || data.lastSeen === 0) ? 0 : data.lastSeen - data.firstSeen;
        return {
            hostname: hostname,
            totalActiveFocusedMs: data.totalActiveFocusedMs,
            totalActiveUnfocusedMs: data.totalActiveUnfocusedMs,
            totalIdleMs: data.totalIdleMs,
            totalOpenMs: hostnameTotalOpenMs > 0 ? hostnameTotalOpenMs : 0,
            firstSeen: data.firstSeen === Infinity ? 0 : data.firstSeen, // Handle case where no data found
            lastSeen: data.lastSeen,
            pages: data.pages.sort((a, b) => { // Sort pages within hostname (e.g., by title)
                if (a.title < b.title) return -1;
                if (a.title > b.title) return 1;
                return 0;
            })
        };
    });

    console.log('Aggregation complete', result);

    // Note: Sorting of hostnames is now handled in stats.ts
    return result;
}
