import { DisplayStat, AggregatedHostnameData } from "../common/types.js";
import { formatTime } from "../common/utils.js"; // Import if needed for summary

const EXPAND_ICON = '▶';
const COLLAPSE_ICON = '▼';

/**
 * Escapes a string for use as a CSS identifier (class name component).
 * Replaces non-alphanumeric characters (excluding hyphen/underscore) with underscore.
 */
function escapeHostnameForCss(hostname: string): string {
    // Simple replace. For stricter compliance, CSS.escape() is better but might be overkill.
    return hostname.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Toggles the visibility of page rows for a given hostname.
 */
function toggleHostnameRows(hostname: string, expanderCell: HTMLElement) {
    const escapedHostname = escapeHostnameForCss(hostname);
    const pageRows = document.querySelectorAll(`.page-row.hostname-${escapedHostname}`);
    const isExpanding = expanderCell.textContent === EXPAND_ICON;
    pageRows.forEach(row => {
        (row as HTMLElement).style.display = isExpanding ? 'table-row' : 'none';
    });
    expanderCell.textContent = isExpanding ? COLLAPSE_ICON : EXPAND_ICON;
}

/**
 * Renders the aggregated statistics data into the provided table body element.
 */
export function renderStatsTable(aggregatedStats: AggregatedHostnameData[], tableBody: HTMLTableSectionElement): void {
    // Clear previous content
    tableBody.innerHTML = '';

    if (!aggregatedStats || aggregatedStats.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8">No data available for the selected period.</td></tr>';
        return;
    }

    // Populate table rows
    aggregatedStats.forEach(hostData => {
        const escapedHostname = escapeHostnameForCss(hostData.hostname);
        // --- Create Hostname Row --- //
        const hostRow = tableBody.insertRow();
        hostRow.classList.add('hostname-row');
        hostRow.dataset.hostname = hostData.hostname;
        hostRow.style.cursor = 'pointer'; // Indicate clickable

        const cellExpander = hostRow.insertCell();
        cellExpander.textContent = EXPAND_ICON;
        cellExpander.style.width = '20px'; // Small width for icon

        const cellHostname = hostRow.insertCell();
        cellHostname.textContent = hostData.hostname;
        cellHostname.colSpan = 1; // Hostname takes up title space

        const cellHostActiveFocused = hostRow.insertCell();
        cellHostActiveFocused.textContent = formatTime(hostData.totalActiveFocusedMs);

        const cellHostActiveUnfocused = hostRow.insertCell();
        cellHostActiveUnfocused.textContent = formatTime(hostData.totalActiveUnfocusedMs);

        const cellHostIdle = hostRow.insertCell();
        cellHostIdle.textContent = formatTime(hostData.totalIdleMs);

        // Calculate total time on the fly and display it
        const cellHostTotalTime = hostRow.insertCell();
        const totalTimeMs = (hostData.lastSeen && hostData.firstSeen && hostData.lastSeen > hostData.firstSeen)
                            ? hostData.lastSeen - hostData.firstSeen
                            : 0;
        cellHostTotalTime.textContent = formatTime(totalTimeMs);
        cellHostTotalTime.dataset.sortValue = totalTimeMs.toString();

        const cellHostFirstSeen = hostRow.insertCell();
        cellHostFirstSeen.textContent = hostData.firstSeen ? new Date(hostData.firstSeen).toLocaleString() : '-';

        const cellHostLastSeen = hostRow.insertCell();
        cellHostLastSeen.textContent = hostData.lastSeen ? new Date(hostData.lastSeen).toLocaleString() : '-';

        // Add click listener to the host row for expansion
        hostRow.addEventListener('click', () => {
            toggleHostnameRows(hostData.hostname, cellExpander);
        });

        // --- Create Page Rows (hidden initially) --- //
        hostData.pages.forEach(pageStat => {
            const pageRow = tableBody.insertRow();
            pageRow.classList.add('page-row', `hostname-${escapedHostname}`);
            pageRow.style.display = 'none'; // Hidden by default

            const cellPageExpander = pageRow.insertCell(); // Placeholder cell
            cellPageExpander.style.width = '20px';

            const cellPageTitle = pageRow.insertCell();
            cellPageTitle.textContent = pageStat.title;
            cellPageTitle.title = pageStat.url; // Show full URL on hover
            cellPageTitle.colSpan = 1;

            const cellPageActiveFocused = pageRow.insertCell();
            cellPageActiveFocused.textContent = pageStat.activeFocusedTime;

            const cellPageActiveUnfocused = pageRow.insertCell();
            cellPageActiveUnfocused.textContent = pageStat.activeUnfocusedTime;

            const cellPageIdle = pageRow.insertCell();
            cellPageIdle.textContent = pageStat.idleTime;

            const cellPageTotalOpen = pageRow.insertCell();
            cellPageTotalOpen.textContent = pageStat.totalOpenTime;

            const cellPageFirstSeen = pageRow.insertCell();
            cellPageFirstSeen.textContent = pageStat.firstSeen;

            const cellPageLastSeen = pageRow.insertCell();
            cellPageLastSeen.textContent = pageStat.lastSeen;
        });
    });
}

/**
 * Updates the summary section (e.g., total time).
 */
export function updateSummary(aggregatedStats: AggregatedHostnameData[]): void {
    const summaryElement = document.getElementById('totalTimeSummary');
    if (!summaryElement) return;

    let totalTrackedTimeMs = 0;
    aggregatedStats.forEach(hostData => {
        // Calculate host total time based on first/last seen for summary
        const hostTotalTime = (hostData.lastSeen && hostData.firstSeen && hostData.lastSeen > hostData.firstSeen)
                              ? hostData.lastSeen - hostData.firstSeen
                              : 0;
        // Summing active/unfocused/idle time for a measure of tracked activity within the span
        totalTrackedTimeMs += (hostData.totalActiveFocusedMs || 0) +
                             (hostData.totalActiveUnfocusedMs || 0) +
                             (hostData.totalIdleMs || 0);
        // If we want total span time, we could sum hostTotalTime instead/as well
    });

    summaryElement.textContent = `Total Tracked Activity: ${formatTime(totalTrackedTimeMs)}`;
}
