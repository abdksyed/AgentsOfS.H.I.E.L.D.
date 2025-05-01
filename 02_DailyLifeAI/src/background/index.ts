import * as stateManager from "./stateManager.js";
import { setupListeners } from "./eventListeners.js";
import { clearAllData } from "./storageManager.js"; // Optional: for debugging

console.log("Service Worker starting...");

// Initialize state on startup
stateManager.initializeState().then(() => {
    console.log("State initialization finished.");
    // Once state is initialized, set up the listeners
    setupListeners();

    // Set the idle detection interval (15 seconds is the minimum)
    chrome.idle.setDetectionInterval(15);
    console.log("Idle detection interval set to 15 seconds.");

    // Optional: Create alarms if needed (e.g., for periodic backup)
    // chrome.alarms.create('periodicSave', { periodInMinutes: 5 });
    // console.log("Periodic save alarm created.");

    // --- Development/Debugging Helpers --- //
    // Example: Add a context menu item to clear data
    chrome.runtime.onInstalled.addListener(() => {
        chrome.contextMenus.create({
            id: "clearDailyLifeAIData",
            title: "Clear DailyLifeAI Tracking Data",
            contexts: ["action"]
        });
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === "clearDailyLifeAIData") {
            clearAllData().then(() => {
                console.log("Data cleared via context menu.");
                // Optionally, re-initialize state after clearing
                stateManager.initializeState();
            });
        }
    });
     // ------------------------------------ //

}).catch(error => {
    console.error("Error during service worker initialization:", error);
});

// Keep service worker alive logic (can be necessary for persistent listeners)
// A common pattern is to reconnect a port periodically
let lifeline: chrome.runtime.Port | null;

async function keepAlive() {
  if (lifeline) return;
  for (const tab of await chrome.tabs.query({ url: "*://*/*" })) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () => console.log("DailyLifeAI keep-alive ping"),
      });
      chrome.runtime.connect({ name: "keepAlive" }).onDisconnect.addListener(keepAlive);
      lifeline = null;
      return;
    } catch (e) {}
  }
}

// TODO: Review if keepAlive is strictly necessary with event-driven model
// It might be overly aggressive. Consider removing if alarms/events suffice.
// keepAlive(); // Start the keep-alive process if deemed necessary

console.log("Service Worker setup complete.");
