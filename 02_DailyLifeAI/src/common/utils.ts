/**
 * Extracts the hostname from a given URL string.
 * Returns 'invalid_url' for invalid inputs or non-HTTP/HTTPS schemes.
 */
export function getHostname(url: string | undefined): string {
  if (!url) {
    return 'no_url';
  }

  // Handle special Chrome URLs
  if (url.startsWith('chrome://')) {
    // Extract the part after chrome:// (e.g., 'newtab', 'extensions')
    try {
      // const specificPage = new URL(url).hostname; // Removed unused variable
      // Return a prefix to categorize, but keep specific page for potential future use
      // For now, just categorize broadly to ignore
      return 'chrome_internal'; // Simplified: Treat all chrome:// pages the same for ignoring
    } catch (e) {
      return 'chrome_internal'; // Fallback for invalid chrome:// URLs
    }
  }
  if (url.startsWith('chrome-extension://')) {
    return 'chrome_extension'; // Ignore extension pages themselves
  }
  if (url.startsWith('about:')) {
    return 'about_page'; // Ignore about pages
  }

  try {
    const parsedUrl = new URL(url);
    // Allow chrome-extension:// URLs as well
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'chrome-extension:') {
        // For file URLs, maybe return something generic or the path?
        // For now, focusing on web pages.
        return parsedUrl.hostname;
    }
    // Handle other schemes like file://, chrome:// differently if needed
    if (parsedUrl.protocol === 'file:') {
        return 'local_file';
    }
    // For chrome:// URLs, return the hostname part (e.g., 'settings', 'extensions')
    if (parsedUrl.protocol === 'chrome:') {
        return parsedUrl.hostname || 'chrome_internal';
    }
    return 'other_scheme'; // Or parsedUrl.protocol;
  } catch (e) {
    // Handle cases like 'about:blank', 'javascript:...', etc.
    if (url.startsWith('about:')) {
        return 'about_page';
    }
    return 'invalid_url';
  }
}

/**
 * Formats milliseconds into a human-readable string HH:MM:SS.
 * Shows "< 1s" for durations between 0ms and 1000ms (exclusive).
 */
export function formatTime(milliseconds: number): string {
  if (isNaN(milliseconds) || milliseconds <= 0) { // Also return 00:00:00 for exactly 0
    return '00:00:00';
  }

  // Handle very short durations
  if (milliseconds < 1000) {
      return '< 1s';
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num: number) => String(num).padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Returns the current date as a string in 'YYYY-MM-DD' format.
 */
export function getCurrentDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generates a CSV string from an array of DisplayStat objects.
 * @param data Array of DisplayStat objects.
 * @returns A string formatted as CSV.
 */
export function generateCsv(data: Array<{ [key: string]: string }>): string {
    if (!data || data.length === 0) {
        return '';
    }

    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','), // Header row
        ...data.map(row =>
            headers.map(header => `"${(row[header] || '').replace(/"/g, '""')}"`).join(',') // Escape quotes
        )
    ];

    return csvRows.join('\n');
}
