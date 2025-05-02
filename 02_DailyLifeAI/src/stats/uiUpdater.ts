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

        // Create and append table data cells using DOM manipulation
        const toggleCell = hostRow.insertCell();
        toggleCell.innerHTML = `<span class="toggle-icon">▶</span> ${hostData.hostname} (${hostData.pages.length})`;

        const activeTimeCell = hostRow.insertCell();
        activeTimeCell.textContent = formatTime(hostData.totalActiveMs);
        activeTimeCell.classList.add('text-right'); // Assuming text-right class for alignment, adjust if needed.

        const firstSeenCell = hostRow.insertCell();
        firstSeenCell.textContent = hostData.firstSeen === 0 ? '-' : new Date(hostData.firstSeen).toLocaleString();

        const lastSeenCell = hostRow.insertCell();
        lastSeenCell.textContent = hostData.lastSeen === 0 ? '-' : new Date(hostData.lastSeen).toLocaleString();

        const lifeTimeCell = hostRow.insertCell();
        lifeTimeCell.textContent = formattedHostLifeTime;
        lifeTimeCell.classList.add('text-right'); // Assuming text-right class for alignment, adjust if needed.

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
