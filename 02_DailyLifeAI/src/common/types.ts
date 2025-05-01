export interface PageData {
  // totalOpenMs: number; // Removed - This should be calculated if needed
  activeMs: number;
  // activeUnfocusedMs: number;
  // idleMs: number;
  firstSeen: number; // timestamp
  lastSeen: number; // timestamp
  lastUpdated: number; // internal timestamp
  title: string; // Added page title
}

export interface HostnameData {
  [fullUrl: string]: PageData;
}

export interface DailyData {
  [hostname: string]: HostnameData;
}

export type TrackedData = {
  [date: string]: DailyData;
}

export interface TabState {
  url: string;
  hostname: string;
  windowId: number;
  isActive: boolean;    // Is this the active tab in its window?
  // isFocused: boolean;   // Is the window containing this tab focused?
  // isIdle: boolean;      // Is the user currently idle?
  stateStartTime: number; // Timestamp when this state began
  firstSeenToday: number; // Timestamp when this URL was first seen today
  title: string;
}

export interface ActiveTabs {
  [tabId: number]: TabState;
}

// Interface for aggregated stats display (Page Level)
export interface DisplayStat {
    hostname: string;
    url?: string;                // URL (only for page rows)
    title: string;               // Hostname or Page Title
    activeTime: string;          // Formatted active time
    firstSeenMs: number;         // Raw first seen timestamp (milliseconds)
    lastSeenMs: number;          // Raw last seen timestamp (milliseconds)
    firstSeenFormatted: string;  // Formatted first seen timestamp
    lastSeenFormatted: string;   // Formatted last seen timestamp
}

// Interface for aggregated stats display (Hostname Level)
export interface AggregatedHostnameData {
    hostname: string;
    totalActiveMs: number;       // Total active time for the hostname
    // totalActiveFocusedMs: number;
    // totalActiveUnfocusedMs: number;
    // totalIdleMs: number;
    firstSeen: number;           // Earliest firstSeen across all pages for the host
    lastSeen: number;            // Latest lastSeen across all pages for the host
    pages: DisplayStat[];        // Array of individual page stats under this hostname
}
