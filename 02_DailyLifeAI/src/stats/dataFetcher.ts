import { TrackedData, AggregatedHostnameData, DisplayStat, PageData } from "../common/types";
import { formatTime } from "../common/utils";

// Define a local interface for intermediate page aggregation
interface AggregatedPageData {
    hostname: string;
    url: string;
    title: string;
    activeMs: number;
    firstSeenMs: number;
    lastSeenMs: number;
}

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

// Helper function to compare pages by title
function comparePagesByTitle(a: DisplayStat, b: DisplayStat): number {
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    return 0;
}

/**
 * Fetches data from storage for the specified range and aggregates it by hostname.
 */
export async function fetchAndProcessStats(startDateStr: string, endDateStr: string): Promise<AggregatedHostnameData[]> {
    console.log(`Fetching stats from ${startDateStr} to ${endDateStr}`);
    const allData = await getAllDataDirectly();
    const aggregatedHostData: { 
        [hostname: string]: Omit<AggregatedHostnameData, 'hostname' | 'pages'> & { pages: { [url: string]: { latestTitle: string, latestTimestamp: number, data: AggregatedPageData } } } 
    } = {};
    
    const ignoredHostnames = ['chrome_internal', 'chrome_extension', 'about_page', 'local_file', 'other_scheme', 'invalid_url', 'no_url'];

    // Use UTC for date comparisons to avoid timezone issues
    const start = new Date(startDateStr + 'T00:00:00Z'); // Force UTC
    const end = new Date(endDateStr + 'T23:59:59Z'); // Force UTC

    // Aggregate data across the date range
    for (const dateStr in allData) {
        // Assuming dateStr is YYYY-MM-DD from getCurrentDateString()
        const currentDateOnly = new Date(dateStr + 'T00:00:00Z'); // Force UTC

        if (currentDateOnly >= start && currentDateOnly <= end) {
            const dailyData = allData[dateStr];
            for (const hostname in dailyData) {
                // *** Filter out ignored hostnames ***
                if (ignoredHostnames.includes(hostname)) {
                    continue; // Skip this hostname
                }

                // Initialize hostname entry if it doesn't exist
                if (!aggregatedHostData[hostname]) {
                    aggregatedHostData[hostname] = {
                        totalActiveMs: 0,
                        firstSeen: Infinity,
                        lastSeen: 0,
                        pages: {} // Change pages to an object keyed by URL for aggregation
                    };
                }
                const hostAggregate = aggregatedHostData[hostname];

                for (const url in dailyData[hostname]) {
                    const pageData: PageData = dailyData[hostname][url];
                    
                    // Sum up time values for the hostname total
                    hostAggregate.totalActiveMs += pageData.activeMs || 0;

                    // Track overall first/last seen for the hostname
                    hostAggregate.firstSeen = Math.min(hostAggregate.firstSeen, pageData.firstSeen);
                    hostAggregate.lastSeen = Math.max(hostAggregate.lastSeen, pageData.lastSeen);

                    // Aggregate page data, keeping track of the latest title
                    if (!hostAggregate.pages[url]) {
                         hostAggregate.pages[url] = {
                            latestTitle: pageData.title || url,
                            latestTimestamp: pageData.lastSeen || 0,
                            data: { // Initialize AggregatedPageData
                                hostname: hostname,
                                url: url,
                                title: pageData.title || url, // Initial title
                                activeMs: pageData.activeMs || 0,      // Use pageData value
                                firstSeenMs: pageData.firstSeen || Infinity,
                                lastSeenMs: pageData.lastSeen || 0
                            }
                        };
                    } else {
                        // *** ELSE: Add time for subsequent records for this URL ***
                        const pageAggregate = hostAggregate.pages[url];
                        // Add time segments
                        pageAggregate.data.activeMs += pageData.activeMs || 0;

                        // Update first/last seen for the specific page URL
                        pageAggregate.data.firstSeenMs = Math.min(pageAggregate.data.firstSeenMs, pageData.firstSeen);
                        pageAggregate.data.lastSeenMs = Math.max(pageAggregate.data.lastSeenMs, pageData.lastSeen);
                        
                        // *** Update title if this segment is later ***
                        if ((pageData.lastSeen || 0) >= pageAggregate.latestTimestamp) {
                            pageAggregate.latestTitle = pageData.title || url; // Update latest title
                            pageAggregate.latestTimestamp = pageData.lastSeen || 0;
                        }
                    }
                }
            }
        }
    }

    // Convert aggregated data map to array and format page data
    const result: AggregatedHostnameData[] = Object.entries(aggregatedHostData).map(([hostname, data]) => {
        // Map the aggregated page data object back to an array for the final structure
        const formattedPages: DisplayStat[] = Object.values(data.pages).map(pageAgg => {
            // Calculate raw firstSeenMs for DisplayStat
            const firstSeenTimestampMs = pageAgg.data.firstSeenMs === Infinity ? 0 : pageAgg.data.firstSeenMs;
            const lastSeenTimestampMs = pageAgg.data.lastSeenMs === 0 ? 0 : pageAgg.data.lastSeenMs; // Get raw lastSeenMs

             const firstSeenDate = firstSeenTimestampMs ? new Date(firstSeenTimestampMs) : null;
             const lastSeenDate = lastSeenTimestampMs ? new Date(lastSeenTimestampMs) : null;

            return {
                hostname: hostname,
                url: pageAgg.data.url,
                title: pageAgg.latestTitle, // Use the determined latest title
                activeTime: formatTime(pageAgg.data.activeMs),
                firstSeenMs: firstSeenTimestampMs, // Pass raw timestamp
                lastSeenMs: lastSeenTimestampMs,     // Pass raw timestamp
                firstSeenFormatted: firstSeenDate ? firstSeenDate.toLocaleString() : '-', // Renamed
                lastSeenFormatted: lastSeenDate ? lastSeenDate.toLocaleString() : '-',   // Renamed
            };
        }).sort(comparePagesByTitle); // Sort pages alphabetically by title within hostname

        return {
            hostname: hostname,
            totalActiveMs: data.totalActiveMs,
            firstSeen: data.firstSeen === Infinity ? 0 : data.firstSeen, // Handle case where no data found
            lastSeen: data.lastSeen,
            pages: formattedPages // Assign the formatted and sorted pages array
        };
    });

    console.log('Aggregation complete', result);

    // Note: Sorting of hostnames is now handled in stats.ts
    return result;
}
