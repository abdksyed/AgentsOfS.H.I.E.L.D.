document.addEventListener('DOMContentLoaded', () => {
    const statsButton = document.getElementById('statsButton');

    if (statsButton) {
        statsButton.addEventListener('click', () => {
            // Construct the URL relative to the extension's base
            const statsPageUrl = chrome.runtime.getURL('stats/stats.html');
            chrome.tabs.create({ url: statsPageUrl });
        });
    } else {
        console.error("Could not find the stats button in popup.html");
    }
});
