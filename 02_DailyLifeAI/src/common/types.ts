export interface PageData {
  totalOpenMs: number;
  activeFocusedMs: number;
  activeUnfocusedMs: number;
  idleMs: number;
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
  isActive: boolean; // Is it the selected tab in its window?
  isFocused: boolean; // Is its window focused by the OS?
  isIdle: boolean; // Is the system idle (applies only if isActive & isFocused)?
  stateStartTime: number; // When the current combination of states began
  firstSeenToday: number; // When this URL was first seen today
  title: string; // Added page title
}

export interface ActiveTabs {
  [tabId: number]: TabState;
}

// Interface for aggregated stats display (Page Level)
export interface DisplayStat {
    hostname: string; // Keep hostname for context if needed later
    url: string; // Keep raw URL
    title: string; // Display this primarily
    activeFocusedTime: string;
    activeUnfocusedTime: string;
    idleTime: string;
    totalOpenTime: string;
    firstSeen: string; // Formatted timestamp for the page
    lastSeen: string; // Formatted timestamp for the page
}

// Interface for aggregated stats display (Hostname Level)
export interface AggregatedHostnameData {
    hostname: string;
    totalActiveFocusedMs: number;
    totalActiveUnfocusedMs: number;
    totalIdleMs: number;
    // totalOpenMs: number; // Removed: Calculated span (max lastSeen - min firstSeen)
    firstSeen: number; // Earliest firstSeen across pages
    lastSeen: number; // Latest lastSeen across pages
    pages: DisplayStat[]; // Individual page stats under this host
}
