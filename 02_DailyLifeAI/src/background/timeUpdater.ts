import { TabState, PageData } from "../common/types";
import { getCurrentDateString } from "../common/utils";
import * as storageManager from "./storageManager";

/**
 * Calculates the time difference and updates the corresponding counter in storage.
 */
export async function calculateAndUpdateTime(
    previousState: TabState,
    timestamp: number
): Promise<void> {
    console.log(`[TimeUpdater DEBUG] calculateAndUpdateTime ENTER - Timestamp: ${timestamp}, Prev State:`, JSON.stringify(previousState));

    if (!previousState || !previousState.url || !previousState.hostname || previousState.stateStartTime > timestamp) {
        console.warn("[TimeUpdater DEBUG] Invalid previous state or timestamp for time update, returning:", previousState, timestamp);
        return;
    }

    const durationMs = timestamp - previousState.stateStartTime;
    console.log(`[TimeUpdater DEBUG] Calculated Duration: ${durationMs}ms for URL: ${previousState.url}`);

    if (durationMs <= 0) {
        console.log("[TimeUpdater DEBUG] No time elapsed or negative duration, returning.");
        return; // No time elapsed or negative duration
    }

    // Prepare base update (lastSeen, title)
    const baseUpdate: Partial<PageData> = {
        lastSeen: timestamp,
        title: previousState.title
    };
    console.log(`[TimeUpdater DEBUG] Base Update:`, JSON.stringify(baseUpdate));

    // If the previous state was active, add active time
    if (previousState.isActive) {
        const dataUpdate: Partial<PageData> = {
            ...baseUpdate,
            activeMs: durationMs // Add duration to active time
        };
        try {
            console.log(`[TimeUpdater DEBUG] ACTIVE - Calling updatePageData for ${previousState.hostname}/${previousState.url} with:`, JSON.stringify(dataUpdate));
            await storageManager.updatePageData(
                getCurrentDateString(),
                previousState.hostname,
                previousState.url,
                dataUpdate
            );
        } catch (error) {
            console.error("Failed to update active time data in storage:", error);
        }
    } else {
        // If previous state was inactive, still update lastSeen and title
        try {
             console.log(`[TimeUpdater DEBUG] INACTIVE - Calling updatePageData for ${previousState.hostname}/${previousState.url} with:`, JSON.stringify(baseUpdate));
             await storageManager.updatePageData(
                getCurrentDateString(),
                previousState.hostname,
                previousState.url,
                baseUpdate // Only contains lastSeen and title
            );
        } catch (error) {
            console.error("Failed to update lastSeen/title for inactive state:", error);
        }
    }
}
