import { getAllEntries, clearAllEntries, WebsiteTimeEntry } from './db';
import { formatTime } from './utils';

// DOM Elements
const errorNotification = document.getElementById('error-notification') as HTMLDivElement;
const exportCsvButton = document.getElementById('export-csv') as HTMLButtonElement;
const clearDataButton = document.getElementById('clear-data') as HTMLButtonElement;
const statsTable = document.getElementById('stats-table') as HTMLTableElement;
const tableBody = statsTable.querySelector('tbody') as HTMLTableSectionElement;

// State
let allEntries: WebsiteTimeEntry[] = [];

// Initialize the page
async function init() {
    try {
        allEntries = await getAllEntries();
        renderTable();
    } catch (error) {
        showError('Failed to load data. Please try refreshing the page.');
        console.error('Error initializing stats page:', error);
    }

    // Set up event listeners
    exportCsvButton.addEventListener('click', exportToCsv);
    clearDataButton.addEventListener('click', clearData);
}

// Render the table with aggregated data
function renderTable() {
    tableBody.innerHTML = '';

    if (allEntries.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3">No data available</td>';
        tableBody.appendChild(row);
        return;
    }

    // Aggregate by domain
    const domainMap = new Map<string, { active: number; total: number; urls: WebsiteTimeEntry[] }>();
    
    allEntries.forEach(entry => {
        if (!domainMap.has(entry.domain)) {
            domainMap.set(entry.domain, { active: 0, total: 0, urls: [] });
        }
        const domainData = domainMap.get(entry.domain);
        if (domainData) {
            domainData.active += entry.activeSeconds;
            domainData.total += entry.totalSeconds;
            domainData.urls.push(entry);
        }
    });

    // Sort domains by total time (descending)
    const sortedDomains = Array.from(domainMap.entries()).sort((a, b) => b[1].total - a[1].total);

    // Render domain rows
    sortedDomains.forEach(([domain, data]) => {
        const domainRow = document.createElement('tr');
        domainRow.className = 'expandable';
        domainRow.innerHTML = `
            <td>${domain}</td>
            <td>${formatTime(data.active)}</td>
            <td>${formatTime(data.total)}</td>
        `;
        tableBody.appendChild(domainRow);

        // Add click handler for expansion
        domainRow.addEventListener('click', () => {
            const nextRow = domainRow.nextElementSibling;
            if (nextRow && nextRow.classList.contains('url-details')) {
                nextRow.classList.toggle('show');
            } else {
                renderUrlDetails(domainRow, data.urls);
            }
        });
    });
}

// Render URL details for a domain
function renderUrlDetails(domainRow: HTMLTableRowElement, urls: WebsiteTimeEntry[]) {
    // Sort URLs by total time (descending)
    const sortedUrls = urls.sort((a, b) => b.totalSeconds - a.totalSeconds);

    // Create details row
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'url-details show';
    
    const detailsCell = document.createElement('td');
    detailsCell.colSpan = 3;
    
    const innerTable = document.createElement('table');
    innerTable.className = 'url-table';
    innerTable.innerHTML = `
        <thead>
            <tr>
                <th>Titles</th>
                <th>Active Time</th>
                <th>Total Time</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    
    const innerTableBody = innerTable.querySelector('tbody')!;
    
    sortedUrls.forEach(urlEntry => {
        const urlRow = document.createElement('tr');
        urlRow.innerHTML = `
            <td class="url-title-cell" title="${urlEntry.normalizedUrl.replace(/"/g, '&quot;')}">${truncateText(urlEntry.titles, 150)}</td>
            <td>${formatTime(urlEntry.activeSeconds)}</td>
            <td>${formatTime(urlEntry.totalSeconds)}</td>
        `;
        innerTableBody.appendChild(urlRow);

        // Add click listener to copy URL
        const titleCell = urlRow.querySelector('.url-title-cell');
        if (titleCell) {
            titleCell.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(urlEntry.normalizedUrl);
                    // Change text to "Copied!" temporarily
                    const originalText = titleCell.textContent;
                    titleCell.textContent = 'Copied!';
                    setTimeout(() => {
                        titleCell.textContent = originalText;
                    }, 2000); // Change back after 2 seconds
                    console.log('URL copied to clipboard');
                } catch (err) {
                    console.error('Failed to copy URL: ', err);
                    showError('Failed to copy URL.');
                }
            });
        }
    });
    
    detailsCell.appendChild(innerTable);
    detailsRow.appendChild(detailsCell);
    domainRow.parentNode!.insertBefore(detailsRow, domainRow.nextSibling);
}

// Truncate text with ellipsis
function truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
}

// Export data to CSV
async function exportToCsv() {
    const originalButtonText = exportCsvButton.textContent;
    exportCsvButton.textContent = 'Exporting...';
    exportCsvButton.disabled = true;

    try {
        const entries = await getAllEntries();
        if (entries.length === 0) {
            showError('No data to export');
            return;
        }

        // CSV header
        let csv = 'Domain,Normalized URL,Titles,Active Seconds,Total Seconds\n';
        
        // CSV rows
        entries.forEach(entry => {
            csv += `"${entry.domain}","${entry.normalizedUrl}","${entry.titles}",${entry.activeSeconds},${entry.totalSeconds}\n`;
        });

        // Create download link
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'web_time_tracker_export.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        showError('Failed to export data');
        console.error('Error exporting to CSV:', error);
    } finally {
        exportCsvButton.textContent = originalButtonText;
        exportCsvButton.disabled = false;
    }
}

// Clear all data
async function clearData() {
    const confirmed = confirm('Are you sure you want to clear all tracking data? This cannot be undone.');
    if (!confirmed) return;

    const originalButtonText = clearDataButton.textContent;
    clearDataButton.textContent = 'Clearing...';
    clearDataButton.disabled = true;

    try {
        await clearAllEntries();
        allEntries = [];
        renderTable();
    } catch (error) {
        showError('Failed to clear data');
        console.error('Error clearing data:', error);
    } finally {
        clearDataButton.textContent = originalButtonText;
        clearDataButton.disabled = false;
    }
}

// Show error notification
function showError(message: string) {
    errorNotification.textContent = message;
    errorNotification.classList.remove('hidden');
    setTimeout(() => {
        errorNotification.classList.add('hidden');
    }, 5000);
}

// Initialize the page when loaded
document.addEventListener('DOMContentLoaded', init); 