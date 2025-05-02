import { AggregatedHostnameData } from "../common/types";
import { formatTime } from "../common/utils";
// import { generateCsv } from './csvUtils'; // Removed unused import

/**
 * Converts the aggregated stats data into a CSV formatted string.
 */
function convertToCsv(data: AggregatedHostnameData[]): string {
    // const now = Date.now(); // Removed unused variable

    // Define headers - Updated for new order and names
    const headers = [
        'Hostname',
        'Page Title',
        'URL',
        'Active Time',
        'First Seen',
        'Last Seen',
        'Life Time' // New column name
    ];

    // Flatten the data: one row per page
    const rows = data.flatMap(hostData => {
        // Iterate over the pages array which contains DisplayStat objects
        return hostData.pages.map(page => {
            // Calculate Page Life Time for CSV (always lastSeen - firstSeen)
            let pageLifeTimeMs = 0;
            if (page.lastSeenMs && page.firstSeenMs) {
                 pageLifeTimeMs = page.lastSeenMs - page.firstSeenMs;
            }
            const formattedPageLifeTime = formatTime(pageLifeTimeMs > 0 ? pageLifeTimeMs : 0);

            const activeTimeStr = page.activeTime;

            return [
                hostData.hostname,
                page.title,
                page.url || '',
                activeTimeStr, // Active Time (formatted string)
                page.firstSeenFormatted, // First Seen (formatted string)
                page.lastSeenFormatted,  // Last Seen (formatted string)
                formattedPageLifeTime   // Life Time (formatted string)
            ];
        });
    });

    // Escape and join data into CSV format
    const escapeCell = (cellData: string | number): string => {
        const cellStr = String(cellData);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
    };

    const headerRow = headers.map(escapeCell).join(',');
    const dataRows = rows.map(row => 
        row.map(escapeCell).join(',')
    );

    return [headerRow, ...dataRows].join('\n');
}

/**
 * Triggers the download of the CSV file.
 */
export function exportStatsToCsv(data: AggregatedHostnameData[], filename: string): void {
    if (!data || data.length === 0) {
        console.warn("No data provided for CSV export.");
        return;
    }

    const csvContent = convertToCsv(data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) { // Feature detection
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } else {
        alert('CSV export is not supported in this browser.');
    }
}
