import { initializeState } from './stateManager';
import { registerEventListeners } from "./eventListeners";
import { clearAllData } from './storageManager';

console.log("Service Worker starting...");

/**
 * Ensures the extension state is properly initialized and event listeners are registered.
 * Used for both initial setup and when recovering from service worker inactivity.
 */
function ensureExtensionIsReady() {
    return initializeState().then(() => {
        console.log("State initialization finished.");
        registerEventListeners();
    }).catch(error => {
        console.error("Error during extension initialization:", error);
    });
}

// Initialize state on startup
ensureExtensionIsReady().then(() => {
    // Once state is initialized, set up the listeners
    registerEventListeners();

    // Set the idle detection interval (15 seconds is the minimum)
    chrome.idle.setDetectionInterval(15);
    console.log("Idle detection interval set to 15 seconds.");

    // Optional: Create alarms if needed (e.g., for periodic backup)
    // chrome.alarms.create('periodicSave', { periodInMinutes: 5 });
    // console.log("Periodic save alarm created.");

    // --- Development/Debugging Helpers --- //
    // Example: Add a context menu item to clear data
    chrome.runtime.onInstalled.addListener((details) => {
        console.log("DailyLifeAI Extension Installed/Updated.", details.reason);
        // Create context menu item here, only on install/update
        chrome.contextMenus.create({
            id: "clearDailyLifeAIData",
            title: "Clear DailyLifeAI Data",
            contexts: ["action"] // Show in the context menu for the extension icon
        });

        ensureExtensionIsReady(); // Ensure extension is ready on install/update
        // Set up initial alarm if needed (e.g., for periodic saves)
        // chrome.alarms.create('periodicSave', { periodInMinutes: 5 });
        // Keep service worker alive logic (optional)
         // Example: Setup a keep-alive mechanism if necessary
         // setupKeepAliveInterval();
    });

    chrome.runtime.onStartup.addListener(() => {
        console.log("Extension starting up.");
        ensureExtensionIsReady(); // Ensure extension is ready on startup
    });

    // Example: Allow clearing data from the options page or popup
    function clearAllTrackedData() {
        clearAllData()
            .then(() => {
                console.log("All tracked data cleared.");
                // Optionally, reset the in-memory state as well
                initializeState(); // Re-initialize to empty state
            })
            .catch(error => {
                console.error("Error clearing data:", error);
            });
    }

    // Example: Listen for messages from popup/options page
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "requestClearData") {
            clearAllTrackedData();
            sendResponse({ success: true });
            return true; // Indicates asynchronous response
        } else if (message.action === "requestDataForDate") {
            // Placeholder: Need to import and call appropriate function from storageManager
            // Example: storageManager.getDataForDate(message.date).then(...) 
            sendResponse({ success: false, error: "Not implemented yet" }); 
            return true;
        } else if (message.action === "forceSave") {
             console.log("Received forceSave message - Not implemented");
             // Placeholder: Could trigger a save of current state if needed
             sendResponse({ success: false, message: "Not implemented" });
        } else if (message.action === "getKeepAliveStatus") {
            // Example: Respond with status of keep-alive
            sendResponse({ isAlive: false }); // Keep-alive removed
        } else {
             sendResponse({ success: false, message: "Unknown action" });
        }
        return true; // Indicates asynchronous response (optional)
    });

    // Example: Context Menu Item - Moved creation to onInstalled
    // chrome.contextMenus.create({
    //     id: "clearDailyLifeAIData",
    //     title: "Clear DailyLifeAI Data",
    //     contexts: ["action"] // Show in the context menu for the extension icon
    // });

    chrome.contextMenus.onClicked.addListener((info /* Remove unused _tab */) => {
        if (info.menuItemId === "clearDailyLifeAIData") {
             if (confirm("Are you sure you want to clear all tracked DailyLifeAI data?")) {
                 clearAllTrackedData();
             }
        }
    });
     // ------------------------------------ //

}).catch(error => {
    console.error("Error during service worker initialization:", error);
});

// Keep service worker alive logic (can be necessary for persistent listeners)
// A common pattern is to reconnect a port periodically

// TODO: Review if keepAlive is strictly necessary with event-driven model
// It might be overly aggressive. Consider removing if alarms/events suffice.
// _keepAlive(); // Start the keep-alive process if deemed necessary

console.log("Service Worker setup complete.");

// Initial setup check - important if service worker was inactive
// Ensure state is initialized when the worker wakes up
ensureExtensionIsReady(); // Ensure extension is ready when worker wakes up
// Make sure listeners are active

// Keep alive Test (Commented out)
/*
chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 0.25 }); // Renamed alarm

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepAliveAlarm') { // Match renamed alarm
    // Do nothing, the alarm firing itself keeps the SW alive
    console.log('Keep alive alarm fired'); // Ensure block is not empty
  }
});
*/
