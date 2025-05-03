/**
 * Normalizes a URL by removing query parameters and fragments.
 * @param url The URL to normalize.
 * @returns The normalized URL.
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObject = new URL(url);
    // Remove query parameters and hash fragment
    urlObject.search = '';
    urlObject.hash = '';
    return urlObject.toString();
  } catch (e) {
    console.error(`Failed to normalize URL: ${url}`, e);
    // Return the original URL or a specific error indicator if normalization fails
    return `https://${url}`;
  }
}

/**
 * Formats time in seconds into DD:HH:MM:SS string format.
 * @param totalSeconds The total time in seconds.
 * @returns Formatted time string.
 */
export function formatTime(totalSeconds: number): string {
  if (totalSeconds < 0) {
    totalSeconds = 0;
  }
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (num: number) => num.toString().padStart(2, '0');

  return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Fetches the page title for a given tab.
 * @param tabId The ID of the tab.
 * @returns A promise that resolves with the page title or the tab's URL if title is unavailable.
 * @requires permissions: ["scripting"]
 * @requires host_permissions: ["<all_urls>"]
 */
export async function getPageTitle(tabId: number): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => document.title || window.location.href,
    });
    // executeScript returns an array of results, one for each frame.
    // We assume the first result (main frame) is sufficient.
    if (results && results.length > 0 && results[0].result) {
      return results[0].result;
    }
  } catch (e) {
    console.error(`Failed to get page title for tab ${tabId}:`, e);
  }
  // Fallback: get tab info and use the URL if title fetching fails
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.title || tab.url || 'Unknown Title';
  } catch (e) {
    console.error(`Failed to get tab info for tab ${tabId}:`, e);
    return 'Unknown Title';
  }
}

/**
 * Extracts the domain from a given URL.
 * @param url The URL string.
 * @returns The extracted domain or 'Unknown Domain'.
 */
export function extractDomainFromUrl(url: string): string {
  const domainMatch = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?#]+)/i);
  return domainMatch ? domainMatch[1] : 'Unknown Domain';
}

