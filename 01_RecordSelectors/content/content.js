let clickListenerActive = false;

// Function to get the text content of an element
function getElementText(element) {
    if (!element) return null;
    // Prioritize input values, then button text, then general text content
    if (element.value) {
        return element.value.trim();
    }
    if (element.innerText) {
        return element.innerText.trim();
    }
    if (element.textContent) {
        return element.textContent.trim();
    }
     if (element.alt) { // For images
        return element.alt.trim();
    }
    return null;
}

// Function to generate a CSS selector for the clicked element only.
// Prioritizes ID, then classes, then just the tag name.
function getCssSelector(element) {
    if (!(element instanceof Element)) return null;

    let selector = element.nodeName.toLowerCase();

    if (element.id) {
        // Escape special characters in ID for CSS
        const escapedId = element.id.replace(/([\:.#*+>~=^\[\]$|])/g, "\\$1");
        selector += `#${escapedId}`;
        // We prioritize ID, so we don't add classes if an ID exists.
        // If you want ID *and* classes, uncomment the class part below.
    } else if (element.classList.length > 0) {
        // Filter out empty strings and join classes
        const classes = Array.from(element.classList)
                           .filter(cls => cls.length > 0)
                           .map(cls => cls.replace(/([\:.#*+>~=^\[\]$|])/g, "\\$1")); // Escape class names too
        if (classes.length > 0) {
            selector += "." + classes.join(".");
        }
    }
    // If no ID and no classes, selector remains just the nodeName.
    
    return selector;
}

// Function to handle the blur event on input fields
function handleInputBlur(event, initialValue, selector) {
    const finalValue = event.target.value;
    // Only record if the value actually changed
    if (initialValue !== finalValue) {
        console.log('Input change recorded:', { selector, initialValue, finalValue });
        chrome.runtime.sendMessage({ 
            action: 'recordInputChange',
            selector: selector,
            beforeValue: initialValue,
            afterValue: finalValue
        }, response => {
             if (chrome.runtime.lastError) {
                console.error("Error sending input change data:", chrome.runtime.lastError.message);
             } else if (response && !response.success) {
                console.warn("Background script indicated input change was not recorded:", response.error);
             }
        });
    }
}

// The click handler function
function handleDocumentClick(event) {
    if (!clickListenerActive) return; // Should not happen if listener is removed correctly

    const targetElement = event.target;
    const selector = getCssSelector(targetElement);
    // For inputs/textareas, `text` will be the value at the time of the click
    const text = targetElement.value !== undefined ? targetElement.value.trim() : getElementText(targetElement);

    console.log('Click recorded:', { selector, text });

    // Send the initial click data to the background script
    chrome.runtime.sendMessage({ 
        action: 'recordClick',
        selector: selector,
        text: text // Send value at time of click
    }, response => {
         if (chrome.runtime.lastError) {
            console.error("Error sending click data:", chrome.runtime.lastError.message);
         } else if (response && !response.success) {
            console.warn("Background script indicated click was not recorded:", response.error);
         }
    });

    // If the clicked element is an input or textarea, add a blur listener
    const tagName = targetElement.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') {
        const initialValue = text; // Value at the time of the click
        console.log(`Attaching blur listener to ${selector} with initial value:`, initialValue);
        // Add a one-time blur listener
        targetElement.addEventListener('blur', (blurEvent) => handleInputBlur(blurEvent, initialValue, selector), { once: true });
    }
}

// Function to add the click listener
function addClickListener() {
    if (!clickListenerActive) {
        document.addEventListener('click', handleDocumentClick, true); // Use capture phase
        clickListenerActive = true;
        console.log('Click listener added.');
    }
}

// Function to remove the click listener
function removeClickListener() {
    if (clickListenerActive) {
        document.removeEventListener('click', handleDocumentClick, true);
        clickListenerActive = false;
        console.log('Click listener removed.');
    }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in content script:", message);
    if (message.action === 'startListening') {
        addClickListener();
        sendResponse({ success: true });
    } else if (message.action === 'stopListening') {
        removeClickListener();
        sendResponse({ success: true });
    } else {
        sendResponse({ success: false, error: 'Unknown action' });
    }
    // Indicate asynchronous response potentially needed, though maybe not strictly required here
    // return true;
});

// Initial check - If the background script already thinks we should be recording 
// (e.g., after a refresh), it might send a startListening message upon loading.
// No explicit action needed here, the listener above handles it.
console.log("Content script loaded."); 