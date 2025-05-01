import { TabState, PageData } from "../common/types.js";
import { getCurrentDateString } from "../common/utils.js";
import * as storageManager from "./storageManager.js";

/**
 * Determines the activity state based on tab properties.
 */
function getActivityState(tabState: TabState): 'activeFocused' | 'activeUnfocused' | 'idle' | 'inactive' {
    if (!tabState.isActive) {
        return 'inactive';
    }
    if (!tabState.isFocused) {
        return 'activeUnfocused';
    }
    // If active and focused, check idle state
    if (tabState.isIdle) {
        return 'idle';
    }
    return 'activeFocused';
}

/**
 * Calculates the time difference and updates the corresponding counter in storage.
 */
export async function calculateAndUpdateTime(
    previousState: TabState,
    timestamp: number
): Promise<void> {
    if (!previousState || !previousState.url || !previousState.hostname || previousState.stateStartTime > timestamp) {
        // Ignore if state is invalid or start time is in the future (shouldn't happen)
        console.warn("Invalid previous state or timestamp for time update:", previousState, timestamp);
        return;
    }

    const durationMs = timestamp - previousState.stateStartTime;
    if (durationMs <= 0) {
        return; // No time elapsed or negative duration
    }

    const activityState = getActivityState(previousState);
    const dateStr = getCurrentDateString();
    const dataUpdate: Partial<PageData> = {
        lastSeen: timestamp
    };

    switch (activityState) {
        case 'activeFocused':
            dataUpdate.activeFocusedMs = durationMs;
            break;
        case 'activeUnfocused':
            dataUpdate.activeUnfocusedMs = durationMs;
            break;
        case 'idle':
            dataUpdate.idleMs = durationMs;
            break;
        case 'inactive':
            // No specific time counter for inactive, but update lastSeen
            break;
    }

    // Update storage
    try {
        await storageManager.updatePageData(
            dateStr,
            previousState.hostname,
            previousState.url,
            dataUpdate
        );
    } catch (error) {
        console.error("Failed to update time data in storage:", error);
    }
}
