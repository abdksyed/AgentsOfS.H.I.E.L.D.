import { AggregatedHostnameData, DisplayStat } from "../common/types.js";
import { generateCsv } from "../common/utils.js";
// Import formatTime if you uncomment the empty hostnames section below
// import { formatTime } from "../common/utils.js";

/**
 * Flattens the aggregated data into a list of page stats for CSV export.
 */
function flattenDataForCsv(aggregatedData: AggregatedHostnameData[]): Array<{ [key: string]: string }> {
    const flatData: Array<{ [key: string]: string }> = [];
    aggregatedData.forEach(hostData => {
        if (hostData.pages.length === 0) {
            // Optionally include hostnames even if they have no pages recorded in the timeframe
            // flatData.push({
            //     "Hostname": hostData.hostname,
            //     "Page Title": "(No pages in range)",
            //     "Page URL": "",
            //     "Active & Focused": formatTime(hostData.totalActiveFocusedMs), // Use formatted host totals?
            //     "Active & Unfocused": formatTime(hostData.totalActiveUnfocusedMs),
            //     "Idle Time": formatTime(hostData.totalIdleMs),
            //     "Total Open Time (Host Span)": formatTime(hostData.totalOpenMs),
            //     "First Seen (Page)": "",
            //     "Last Seen (Page)": ""
            // });
        } else {
            hostData.pages.forEach(pageStat => {
                flatData.push({
                    "Hostname": pageStat.hostname, // Or hostData.hostname
                    "Page Title": pageStat.title,
                    "Page URL": pageStat.url,
                    "Active & Focused": pageStat.activeFocusedTime,
                    "Active & Unfocused": pageStat.activeUnfocusedTime,
                    "Idle Time": pageStat.idleTime,
                    "Total Open Time (Page Span)": pageStat.totalOpenTime,
                    "First Seen (Page)": pageStat.firstSeen,
                    "Last Seen (Page)": pageStat.lastSeen
                });
            });
        }
    });
    return flatData;
}

/**
 * Triggers a CSV download for the given aggregated statistics data.
 */
export function exportStatsToCsv(aggregatedData: AggregatedHostnameData[], filename: string = 'dailylifeai_stats.csv'): void {
    if (!aggregatedData || aggregatedData.length === 0) {
        alert("No data available to export.");
        return;
    }

    // Flatten the data structure into one row per page
    const flatData = flattenDataForCsv(aggregatedData);

    if (flatData.length === 0) {
        alert("No page data found within the selected hostnames to export.");
        return;
    }

    // Use the utility function to generate the CSV string
    const csvData = generateCsv(flatData);

    if (!csvData) {
        alert("Failed to generate CSV data.");
        return;
    }

    // Create a Blob and trigger download
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Release the object URL
    URL.revokeObjectURL(url);
}
