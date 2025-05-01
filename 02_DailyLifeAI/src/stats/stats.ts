import { fetchAndProcessStats } from "./dataFetcher.js";
import { renderStatsTable, updateSummary } from "./uiUpdater.js";
import { exportStatsToCsv } from "./csvExporter.js";
import { DisplayStat, AggregatedHostnameData } from "../common/types.js";

// DOM Elements
const dateRangeSelect = document.getElementById('dateRange') as HTMLSelectElement;
const customDatePickersDiv = document.getElementById('customDatePickers') as HTMLDivElement;
const startDateInput = document.getElementById('startDate') as HTMLInputElement;
const endDateInput = document.getElementById('endDate') as HTMLInputElement;
const applyCustomRangeButton = document.getElementById('applyCustomRange') as HTMLButtonElement;
const exportCsvButton = document.getElementById('exportCsv') as HTMLButtonElement;
const statsTableBody = document.getElementById('statsTableBody') as HTMLTableSectionElement;
const statsTableHeader = document.querySelector('#statsTable thead') as HTMLTableSectionElement;

// State to hold the currently fetched stats for export and sorting
let currentStatsData: AggregatedHostnameData[] = [];
// Use more specific type for sort keys derived from headers
type SortableHeaderKey = 'hostname' | 'activeFocused' | 'activeUnfocused' | 'idle' | 'totalOpen' | 'firstSeen' | 'lastSeen';
// Map header keys to actual data keys for sorting
const sortKeyMap: Record<SortableHeaderKey, keyof AggregatedHostnameData | 'hostname'> = {
    hostname: 'hostname',
    activeFocused: 'totalActiveFocusedMs',
    activeUnfocused: 'totalActiveUnfocusedMs',
    idle: 'totalIdleMs',
    totalOpen: 'totalOpenMs',
    firstSeen: 'firstSeen',
    lastSeen: 'lastSeen'
};

let currentSortKey: SortableHeaderKey = 'activeFocused'; // Default sort key (use header key)
let currentSortDirection: 'asc' | 'desc' = 'desc'; // Default sort direction

/**
 * Gets the date range based on the select dropdown value.
 * Returns [startDateString, endDateString]
 */
function getDateRange(): [string, string] {
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

        // Get values based on the *internal* sort key
        if (sortKeyInternal === 'hostname') {
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
    if (!statsTableHeader) return;
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
    if (!statsTableBody) return;

    statsTableBody.innerHTML = '<tr><td colspan="8">Loading data...</td></tr>'; // Show loading state
    currentStatsData = []; // Clear previous data

    try {
        const [startDate, endDate] = getDateRange();
        console.log(`Requesting stats for range: ${startDate} to ${endDate}`);
        currentStatsData = await fetchAndProcessStats(startDate, endDate);
        sortData(); // Sort the data based on current settings
        renderStatsTable(currentStatsData, statsTableBody);
        updateSummary(currentStatsData); // Update summary section
        updateSortIndicators(); // Update header visuals
    } catch (error) {
        console.error("Failed to load or display stats:", error);
        statsTableBody.innerHTML = '<tr><td colspan="8">Error loading data. See console for details.</td></tr>';
    }
}

// --- Event Listeners --- //

dateRangeSelect.addEventListener('change', () => {
    if (dateRangeSelect.value === 'custom') {
        customDatePickersDiv.style.display = 'block';
         // Set default custom dates to today
         const todayStr = getDateRange()[0]; // Careful: calling getDateRange might trigger alerts if custom selected
         if (!startDateInput.value) startDateInput.value = toYyyyMmDd(new Date());
         if (!endDateInput.value) endDateInput.value = toYyyyMmDd(new Date());
    } else {
        customDatePickersDiv.style.display = 'none';
        loadAndDisplayStats(); // Reload stats for non-custom ranges
    }
});

applyCustomRangeButton.addEventListener('click', () => {
    loadAndDisplayStats(); // Reload stats using the custom dates
});

exportCsvButton.addEventListener('click', () => {
     if (currentStatsData.length > 0) {
        const [startDate, endDate] = getDateRange();
        const filename = `dailylifeai_stats_${startDate}_to_${endDate}.csv`;
        // Pass the aggregated data for CSV export - This needs csvExporter to be updated
        exportStatsToCsv(currentStatsData, filename); // Error here will be fixed in next step
    } else {
        alert("No data loaded to export.");
    }
});

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
            renderStatsTable(currentStatsData, statsTableBody); // Re-render the table
            updateSortIndicators(); // Update header visuals
        });
    });
}

// --- Initial Load --- //

// Helper function for initial date setting to avoid calling getDateRange too early
const toYyyyMmDd = (d: Date): string => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

// Set default custom dates on initial load
const todayStr = toYyyyMmDd(new Date());
startDateInput.value = todayStr;
endDateInput.value = todayStr;

// Load stats for the default range (Today) when the page loads
document.addEventListener('DOMContentLoaded', loadAndDisplayStats);
