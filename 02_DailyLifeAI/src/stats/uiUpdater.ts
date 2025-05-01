import { AggregatedHostnameData } from "../common/types";
import { formatTime } from "../common/utils";

/**
 * Renders the aggregated statistics into the provided table body.
 */
export function renderStatsTable(data: AggregatedHostnameData[], tableBody: HTMLTableSectionElement): void {
    tableBody.innerHTML = ''; // Clear existing rows

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5">No data found for the selected period.</td></tr>'; // Colspan is 5
        return;
    }

    data.forEach(hostData => {
        // Hostname Row (collapsible)
        const hostRow = tableBody.insertRow();
        hostRow.classList.add('hostname-row');
        hostRow.dataset.hostname = hostData.hostname;
        // Calculate Host Life Time
        let hostLifeTimeMs = 0;
        if (hostData.lastSeen && hostData.firstSeen) {
             hostLifeTimeMs = hostData.lastSeen - hostData.firstSeen;
        }
        const formattedHostLifeTime = formatTime(hostLifeTimeMs > 0 ? hostLifeTimeMs : 0);

        hostRow.innerHTML = `
            <td><span class="toggle-icon">▶</span> ${hostData.hostname} (${hostData.pages.length})</td>
            <td>${formatTime(hostData.totalActiveMs)}</td> <!-- Active Time -->
            <td>${hostData.firstSeen === 0 ? '-' : new Date(hostData.firstSeen).toLocaleString()}</td> <!-- First Seen -->
            <td>${hostData.lastSeen === 0 ? '-' : new Date(hostData.lastSeen).toLocaleString()}</td> <!-- Last Seen -->
            <td>${formattedHostLifeTime}</td> <!-- Life Time -->
        `;
        // Add click listener for toggling
        hostRow.onclick = () => {
            const details = tableBody.querySelectorAll<HTMLElement>(`.page-row[data-host="${hostData.hostname}"]`);
            const icon = hostRow.querySelector('.toggle-icon');
            details.forEach(detail => {
                detail.classList.toggle('hidden');
            });
            hostRow.classList.toggle('expanded');
            if (icon) {
                icon.textContent = hostRow.classList.contains('expanded') ? '▼' : '▶';
            }
        };

        // Page Rows (initially hidden)
        hostData.pages.forEach(pageStat => {
            // Calculate Page Life Time
            let pageLifeTimeMs = 0;
            if (pageStat.lastSeenMs && pageStat.firstSeenMs) {
                pageLifeTimeMs = pageStat.lastSeenMs - pageStat.firstSeenMs;
            }
            const formattedPageLifeTime = formatTime(pageLifeTimeMs > 0 ? pageLifeTimeMs : 0);

            const pageRow = tableBody.insertRow();
            pageRow.classList.add('page-row', 'hidden');
            pageRow.dataset.host = hostData.hostname;
            pageRow.innerHTML = `
                <td class="page-title">${pageStat.title}</td> <!-- Title -->
                <td>${pageStat.activeTime}</td> <!-- Active Time -->
                <td>${pageStat.firstSeenFormatted}</td> <!-- First Seen -->
                <td>${pageStat.lastSeenFormatted}</td> <!-- Last Seen -->
                <td>${formattedPageLifeTime}</td> <!-- Life Time -->
            `;
        });
    });
}

/**
 * Updates the summary section with total tracked time.
 */
export function updateSummary(data: AggregatedHostnameData[]): void {
    const summaryElement = document.getElementById('totalTimeSummary') as HTMLElement; 
    let totalActiveSeconds = 0;

    data.forEach(hostData => {
        totalActiveSeconds += hostData.totalActiveMs / 1000;
    });

    if (summaryElement) {
        summaryElement.textContent = formatTime(totalActiveSeconds * 1000);
    } else {
        console.warn("Summary element #totalTimeSummary not found.");
    }
}
