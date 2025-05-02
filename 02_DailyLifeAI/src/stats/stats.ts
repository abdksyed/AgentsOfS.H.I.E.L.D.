import { fetchAndProcessStats } from './dataFetcher';
import { exportStatsToCsv } from './csvExporter';
import { AggregatedHostnameData } from '../common/types';
import { updateSummary } from "./uiUpdater";
import { formatTime } from '../common/utils';

// DOM Elements
const dateRangeSelect = document.getElementById('dateRange') as HTMLSelectElement | null;
const customDatePickersDiv = document.getElementById('customDatePickers') as HTMLDivElement | null;
const startDateInput = document.getElementById('startDate') as HTMLInputElement | null;
const endDateInput = document.getElementById('endDate') as HTMLInputElement | null;
const applyCustomRangeButton = document.getElementById('applyCustomRange') as HTMLButtonElement | null;
const exportCsvButton = document.getElementById('exportCsv') as HTMLButtonElement | null;
const statsTableBody = document.getElementById('statsTableBody') as HTMLTableSectionElement | null;
const statsTableHeader = document.querySelector('#statsTable thead') as HTMLTableSectionElement | null;

// State to hold the currently fetched stats for export and sorting
let currentStatsData: AggregatedHostnameData[] = [];
// Use more specific type for sort keys derived from headers
type SortableHeaderKey = 'hostname' | 'activeTime' | 'firstSeen' | 'lastSeen' | 'lifeTime';
// Map header keys to actual data property keys for sorting
const sortKeyMap: { [key in SortableHeaderKey]: keyof Omit<AggregatedHostnameData, 'pages'> | 'lifeTime' } = {
    hostname: 'hostname',
    activeTime: 'totalActiveMs',
    firstSeen: 'firstSeen',
    lastSeen: 'lastSeen',
    lifeTime: 'firstSeen' // Map to an existing key, logic handled in sortData
};

let currentSortKey: SortableHeaderKey = 'activeTime'; // Default sort key (use header key)
let currentSortDirection: 'asc' | 'desc' = 'desc'; // Default sort direction

/**
 * Gets the date range based on the select dropdown value.
 * Returns [startDateString, endDateString]
 */
function getDateRange(): [string, string] {
    if (!dateRangeSelect || !startDateInput || !endDateInput) {
        console.error("Required date elements not found.");
        // Fallback to today or handle error appropriately
        const today = new Date();
         const toYyyyMmDd = (d: Date): string => {
             const year = d.getFullYear();
             const month = String(d.getMonth() + 1).padStart(2, '0');
             const day = String(d.getDate()).padStart(2, '0');
             return `${year}-${month}-${day}`;
         };
        return [toYyyyMmDd(today), toYyyyMmDd(today)];
    }
    const rangeValue = dateRangeSelect.value;
    const today = new Date();
    const endDate = new Date(today); // Default end date is today
    let startDate = new Date(today); // Default start date

    const toYyyyMmDd = (d: Date): string => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    switch (rangeValue) {
        case 'today':
            // startDate and endDate are already today
            break;
        case 'yesterday':
            startDate.setDate(today.getDate() - 1);
            endDate.setDate(today.getDate() - 1);
            break;
        case 'last7':
            startDate.setDate(today.getDate() - 6); // Including today
            break;
        case 'last30':
            startDate.setDate(today.getDate() - 29); // Including today
            break;
        case 'thisMonth':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'all':
            // Use a very early date and today
            startDate = new Date(2000, 0, 1); // Arbitrary early date
            break;
        case 'custom':
            // Use the values from the date pickers
            // Ensure values are valid before returning
            if (startDateInput.value && endDateInput.value) {
                // Basic validation: Ensure start is not after end
                if (new Date(startDateInput.value) <= new Date(endDateInput.value)) {
                   return [startDateInput.value, endDateInput.value];
                } else {
                    alert('Start date cannot be after end date.');
                    // Fallback to today or prevent update?
                    return [toYyyyMmDd(today), toYyyyMmDd(today)];
                }
            } else {
                 // Fallback if custom selected but dates not set
                 alert('Please select a valid custom date range.');
                 return [toYyyyMmDd(today), toYyyyMmDd(today)];
            }
        default:
            // Default to today
            break;
    }

    return [toYyyyMmDd(startDate), toYyyyMmDd(endDate)];
}

/**
 * Sorts the currentStatsData based on the currentSortKey and currentSortDirection.
 */
function sortData() {
    const sortKeyInternal = sortKeyMap[currentSortKey]; // Get the actual data property key

    currentStatsData.sort((a, b) => {
        let valA: string | number | undefined;
        let valB: string | number | undefined;

        if (currentSortKey === 'lifeTime') {
            // Calculate life time on the fly for sorting
            const lifeTimeA = (a.lastSeen && a.firstSeen) ? a.lastSeen - a.firstSeen : 0;
            const lifeTimeB = (b.lastSeen && b.firstSeen) ? b.lastSeen - b.firstSeen : 0;
            valA = lifeTimeA;
            valB = lifeTimeB;
        } else if (sortKeyInternal === 'hostname') {
             valA = a.hostname.toLowerCase();
             valB = b.hostname.toLowerCase();
        } else {
            // Access properties using the internal key which is guaranteed to be in AggregatedHostnameData
             valA = a[sortKeyInternal as keyof Omit<AggregatedHostnameData, 'pages'>];
             valB = b[sortKeyInternal as keyof Omit<AggregatedHostnameData, 'pages'>];
        }


        // Handle undefined or nulls if necessary, though our data should be populated
        valA = valA ?? (typeof valA === 'string' ? '' : 0);
        valB = valB ?? (typeof valB === 'string' ? '' : 0);

        // Comparison logic
        let comparison = 0;
        if (valA > valB) {
            comparison = 1;
        } else if (valA < valB) {
            comparison = -1;
        }

        return currentSortDirection === 'desc' ? (comparison * -1) : comparison;
    });
}

/**
 * Updates the visual indicators on table headers for sorting.
 */
function updateSortIndicators() {
    if (!statsTableHeader) {
        console.warn("Stats table header not found for sorting indicators.");
        return;
    }
    statsTableHeader.querySelectorAll('th[data-sort-key]').forEach(th => {
        const thElement = th as HTMLElement;
        const key = thElement.dataset.sortKey as SortableHeaderKey | undefined; // Cast dataset key
        thElement.classList.remove('sort-asc', 'sort-desc');
        // Compare the header's data-sort-key with the currently active *header* key
        if (key && key === currentSortKey) {
            thElement.classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

/**
 * Main function to load and display statistics.
 */
async function loadAndDisplayStats() {
    if (!statsTableBody) {
        console.error("Stats table body not found. Cannot display data.");
        return;
    }

    statsTableBody.innerHTML = '<tr><td colspan="5">Loading data...</td></tr>'; // Show loading state
    currentStatsData = []; // Clear previous data

    try {
        const [startDate, endDate] = getDateRange(); // getDateRange handles its own element checks
        console.log(`Requesting stats for range: ${startDate} to ${endDate}`);
        currentStatsData = await fetchAndProcessStats(startDate, endDate);
        sortData(); // Sort the data based on current settings
        renderStatsTable(currentStatsData, statsTableBody!); // renderStatsTable needs tableBody
        updateSummary(currentStatsData); // updateSummary does not directly access these DOM elements
        updateSortIndicators(); // updateSortIndicators needs statsTableHeader
    } catch (error) {
        console.error("Failed to load or display stats:", error);
        statsTableBody.innerHTML = '<tr><td colspan="5">Error loading data. See console for details.</td></tr>';
    }
}

// --- Event Listeners --- //

// Check if dateRangeSelect and customDatePickersDiv exist before adding listener
if (dateRangeSelect && customDatePickersDiv && startDateInput && endDateInput) {
    dateRangeSelect.addEventListener('change', () => {
        if (dateRangeSelect.value === 'custom') {
            customDatePickersDiv.style.display = 'block';
             // Set default custom dates to today
             const todayStr = toYyyyMmDd(new Date());
             if (!startDateInput.value) startDateInput.value = todayStr;
             if (!endDateInput.value) endDateInput.value = todayStr;
        } else {
            customDatePickersDiv.style.display = 'none';
            loadAndDisplayStats(); // Reload stats for non-custom ranges
        }
    });
}

// Check if applyCustomRangeButton exists before adding listener
if (applyCustomRangeButton) {
    applyCustomRangeButton.addEventListener('click', () => {
        loadAndDisplayStats(); // Reload stats using the custom dates
    });
}

// Check if exportCsvButton exists before adding listener
if (exportCsvButton) {
    exportCsvButton.addEventListener('click', () => {
         if (currentStatsData.length > 0) {
            const [startDate, endDate] = getDateRange(); // getDateRange handles its own element checks
            const filename = `dailylifeai_stats_${startDate}_to_${endDate}.csv`;
            // Pass the aggregated data for CSV export
            exportStatsToCsv(currentStatsData, filename);
        } else {
            alert("No data loaded to export.");
        }
    });
}

// Add listeners to table headers for sorting
if (statsTableHeader) {
    statsTableHeader.querySelectorAll('th[data-sort-key]').forEach(th => {
        th.addEventListener('click', () => {
            const key = (th as HTMLElement).dataset.sortKey as SortableHeaderKey | undefined; // Cast dataset key
            if (!key || !sortKeyMap[key]) return; // Ignore if key is invalid

            const newSortKey = key;

            if (currentSortKey === newSortKey) {
                // Toggle direction if same key is clicked
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                // Set new key and default to descending (or ascending for hostname)
                currentSortKey = newSortKey;
                currentSortDirection = (key === 'hostname') ? 'asc' : 'desc';
            }

            sortData(); // Re-sort the existing data
            renderStatsTable(currentStatsData, statsTableBody!); // Re-render the table
            updateSortIndicators(); // Update header visuals
        });
    });
}

// --- Initial Load --- //

// Helper function for date formatting used in multiple places
const toYyyyMmDd = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Initialize date pickers and load initial stats
document.addEventListener('DOMContentLoaded', () => {
    // Set default custom dates if needed (e.g., to today)
    if (startDateInput && endDateInput) {
        const todayStr = toYyyyMmDd(new Date());
        if (!startDateInput.value) startDateInput.value = todayStr;
        if (!endDateInput.value) endDateInput.value = todayStr;
    }

    // Initial load based on default selection (e.g., 'today')
    // loadAndDisplayStats already checks for statsTableBody
    loadAndDisplayStats();
});

/**
 * Renders the stats table.
 */
function renderStatsTable(data: AggregatedHostnameData[], tableBody: HTMLTableSectionElement) {
    // Assumes tableBody is already checked for null by the caller (loadAndDisplayStats)
    tableBody.innerHTML = ''; // Clear previous rows

    if (data.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 5; // Keep colspan at 5
        cell.textContent = 'No data available for the selected period.';
        cell.style.textAlign = 'center';
        return;
    }

    data.forEach((hostData) => {
        const hostRow = tableBody.insertRow();
        hostRow.classList.add('host-row');
        hostRow.dataset.hostname = hostData.hostname;

        // --- Host Row Cells (5 Cells Total) ---
        // 1. Hostname / Page Title Column (with count)
        const hostnameCell = hostRow.insertCell();
        const pageCount = hostData.pages?.length || 0;
        hostnameCell.innerHTML = `<span class="toggle-icon">▶</span> ${hostData.hostname} (${pageCount})`;
        hostnameCell.className = 'hostname-cell';
        hostnameCell.style.cursor = 'pointer';
        hostnameCell.onclick = () => toggleDetails(tableBody, hostData.hostname);

        // 2. Active Time
        const activeTimeCell = hostRow.insertCell();
        activeTimeCell.textContent = formatTime(hostData.totalActiveMs || 0);
        activeTimeCell.classList.add('time-cell');

        // 3. First Seen
        const firstSeenCell = hostRow.insertCell();
        firstSeenCell.textContent = hostData.firstSeen ? new Date(hostData.firstSeen).toLocaleString() : 'N/A';

        // 4. Last Seen
        const lastSeenCell = hostRow.insertCell();
        lastSeenCell.textContent = hostData.lastSeen ? new Date(hostData.lastSeen).toLocaleString() : 'N/A';

        // 5. Life Time (lastSeen - firstSeen)
        const lifeTimeCell = hostRow.insertCell();
        let hostLifeTimeMs = 0;
        if (hostData.lastSeen && hostData.firstSeen) {
            hostLifeTimeMs = hostData.lastSeen - hostData.firstSeen;
        }
        lifeTimeCell.textContent = formatTime(hostLifeTimeMs > 0 ? hostLifeTimeMs : 0);
        lifeTimeCell.classList.add('time-cell');


        // --- Detail Rows (initially hidden, 5 Cells Total) ---
        hostData.pages.forEach(page => {
            const pageRow = tableBody.insertRow();
            pageRow.classList.add('page-row', 'details-hidden');
            pageRow.dataset.parentHostname = hostData.hostname;

            // 1. Page Title Cell (Indented via CSS)
            const pageTitleCell = pageRow.insertCell();
            pageTitleCell.textContent = page.title || 'N/A';
            pageTitleCell.className = 'page-title-cell';
            pageTitleCell.title = page.url || 'URL not available';
            pageTitleCell.dataset.url = page.url || '';
            pageTitleCell.style.cursor = 'pointer';

            // CLICK-TO-COPY:
            pageTitleCell.onclick = (event: MouseEvent) => {
                const targetCell = event.currentTarget as HTMLTableCellElement;
                const urlToCopy = targetCell.dataset.url;
                const originalText = targetCell.textContent;
                if (urlToCopy) {
                    navigator.clipboard.writeText(urlToCopy).then(() => {
                        targetCell.textContent = 'Copied!';
                        setTimeout(() => {
                           if(targetCell.textContent === 'Copied!') {
                                targetCell.textContent = originalText;
                           }
                        }, 1000);
                        console.log('URL copied to clipboard:', urlToCopy);
                    }).catch(err => {
                        targetCell.textContent = 'Copy Failed';
                         setTimeout(() => {
                           if(targetCell.textContent === 'Copy Failed') {
                                targetCell.textContent = originalText;
                           }
                        }, 1000);
                        console.error('Failed to copy URL: ', err);
                    });
                }
                event.stopPropagation(); 
            };

            // 2. Page Active Time
            const pageActiveTimeCell = pageRow.insertCell();
            pageActiveTimeCell.textContent = page.activeTime;
            pageActiveTimeCell.classList.add('time-cell');

            // 3. Page First Seen (Formatted)
            const pageFirstSeenCell = pageRow.insertCell();
            pageFirstSeenCell.textContent = page.firstSeenFormatted;

            // 4. Page Last Seen (Formatted)
            const pageLastSeenCell = pageRow.insertCell();
            pageLastSeenCell.textContent = page.lastSeenFormatted;

            // 5. Page Life Time (lastSeenMs - firstSeenMs)
            const pageLifeTimeCell = pageRow.insertCell();
            let pageLifeTimeMs = 0;
            if (page.lastSeenMs && page.firstSeenMs) {
                 pageLifeTimeMs = page.lastSeenMs - page.firstSeenMs;
            }
            pageLifeTimeCell.textContent = formatTime(pageLifeTimeMs > 0 ? pageLifeTimeMs : 0);
            pageLifeTimeCell.classList.add('time-cell');

        });
    });
}

/**
 * Toggles the visibility of detail rows for a specific hostname.
 */
function toggleDetails(tableBody: HTMLTableSectionElement, hostname: string) {
    const pageRows = tableBody.querySelectorAll<HTMLElement>(`.page-row[data-parent-hostname="${hostname}"]`); // Use HTMLElement type
    const hostRow = tableBody.querySelector<HTMLElement>(`.host-row[data-hostname="${hostname}"]`);
    const toggleIcon = hostRow?.querySelector<HTMLElement>('.toggle-icon'); // Find the icon span

    let isHidden = false;
    pageRows.forEach(row => {
        isHidden = row.classList.contains('details-hidden');
        if (isHidden) {
            row.classList.remove('details-hidden');
            row.style.display = 'table-row';
        } else {
            row.classList.add('details-hidden');
            row.style.display = 'none';
        }
    });

    // Update host row appearance and toggle icon
     if (hostRow) {
        if (isHidden) { // If rows were hidden, they are now shown (expanded)
             hostRow.classList.add('expanded');
             if (toggleIcon) toggleIcon.textContent = '▼'; // Down arrow
        } else { // Rows were shown, now hidden (collapsed)
            hostRow.classList.remove('expanded');
             if (toggleIcon) toggleIcon.textContent = '▶'; // Right arrow
        }
     }
}

// --- Add necessary CSS to your stylesheet (e.g., stats.css) --- 
/*
.details-hidden {
    display: none;
}

.page-row .page-title-cell {
    padding-left: 25px;  // Indent page titles
}

.host-row .hostname-cell .toggle-icon {
    display: inline-block;
    width: 1em;
    margin-right: 5px;
    text-align: center;
    transition: transform 0.2s ease-in-out; // Smooth rotation
}

.host-row.expanded .hostname-cell .toggle-icon {
   // transform: rotate(90deg); // Optional: rotate icon instead of changing text
}

.host-row.expanded {
     background-color: #f0f0f0; // Optional: Highlight expanded host row
}

.time-cell {
    text-align: right;
    white-space: nowrap;
}

*/
