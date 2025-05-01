document.addEventListener('DOMContentLoaded', () => {
    const statsButton = document.getElementById('statsButton');

    if (statsButton) {
        statsButton.addEventListener('click', () => {
            // Use chrome.runtime.openOptionsPage() which opens the page
            // defined in manifest.json's "options_page" field.
            chrome.runtime.openOptionsPage();
        });
    } else {
        console.error("Could not find the stats button in popup.html");
    }
});
