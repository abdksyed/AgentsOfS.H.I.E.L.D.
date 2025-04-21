/**
 * Checks if the click listener is currently active.
 * @type {boolean}
 */
let clickListenerActive: boolean = false;

/**
 * Captures the outerHTML of the clicked element and the simplest ancestor's outerHTML
 * within a specified number of levels, below a complexity threshold.
 * @param {Element} element - The element that was clicked.
 * @param {number} maxLevels - The maximum number of ancestor levels to search upwards (e.g., 3).
 * @returns {[string|null, string|null]} An array containing two strings:
 *   [0]: The outerHTML of the highest suitable ancestor found (or null if none).
 *   [1]: The outerHTML of the originally clicked element (or null if element is null).
 */
function getTargetAndAncestorContextHTML(element: Element | null, maxLevels: number): [string | null, string | null] {
    const clickedHTML: string | null = element?.outerHTML || null;
    let suitableAncestorHTML: string | null = null;
    const COMPLEXITY_THRESHOLD: number = 25; // Max number of descendant elements allowed in ancestor context

    // Build a list of ancestors up to maxLevels
    const ancestors: (Element | null)[] = []; // Array of elements or null
    let tempElement: Element | null = element;
    for (let i: number = 0; i <= maxLevels; i++) {
        if (!tempElement) break;
        ancestors.push(tempElement); // Store the element itself
        tempElement = tempElement.parentElement;
    }

    // Iterate from the highest desired ancestor downwards (ancestors[3], ancestors[2], ancestors[1])
    for (let level: number = maxLevels; level >= 1; level--) {
        const ancestorElement: Element | null = ancestors[level];
        if (ancestorElement) {
             // Check complexity: number of descendant elements
            const descendantCount: number = ancestorElement.querySelectorAll('*').length;
            // console.log(`Level ${level} ancestor: ${ancestorElement.tagName}, Descendants: ${descendantCount}`);

            if (descendantCount < COMPLEXITY_THRESHOLD) {
                suitableAncestorHTML = ancestorElement.outerHTML;
                // console.log(`Selected ancestor at level ${level}`);
                break; // Found the highest suitable ancestor
            }
        }
    }
    
    return [suitableAncestorHTML, clickedHTML];
}

/**
 * Generates a basic CSS selector for a given element.
 * Prioritizes ID, then classes, then the element's tag name.
 * Escapes special CSS characters in IDs and class names.
 * @param {Element} element - The HTML element to generate a selector for.
 * @returns {string|null} A CSS selector string, or null if the input is not a valid element.
 */
function getCssSelector(element: Element | null): string | null {
    if (!(element instanceof Element)) return null;

    let selector: string = element.nodeName.toLowerCase();

    if (element.id) {
        // Escape special characters in ID for CSS
        const escapedId: string = element.id.replace(/([\\:.#*+>~=^\[\]$|])/g, "\\\\$1");
        selector += `#${escapedId}`;
        // We prioritize ID, so we don't add classes if an ID exists.
        // If you want ID *and* classes, uncomment the class part below.
    } else if (element.classList.length > 0) {
        // Filter out empty strings and join classes
        const classes: string[] = Array.from(element.classList)
                           .filter(cls => cls.length > 0)
                           .map(cls => cls.replace(/([\\:.#*+>~=^\[\]$|])/g, "\\\\$1")); // Escape class names too
        if (classes.length > 0) {
            selector += "." + classes.join(".");
        }
    }
    // If no ID and no classes, selector remains just the nodeName.
    
    return selector;
}

/**
 * Handles the 'blur' event on input fields to record changes.
 * Sends a message to the background script if the input value has changed
 * since the corresponding 'focus' or 'click' event.
 * @param {FocusEvent} event - The blur event object.
 * @param {string} initialValue - The value of the input field when it was focused/clicked.
 * @param {string} selector - The CSS selector for the input element.
 */
function handleInputBlur(event: FocusEvent, initialValue: string, selector: string | null): void {
    // Ensure target is an input or textarea and selector exists
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!target || !selector) return; 

    const finalValue: string = target.value;
    // Only record if the value actually changed
    if (initialValue !== finalValue) {
        console.log('Input change recorded:', { selector, initialValue, finalValue });
        chrome.runtime.sendMessage({ 
            action: 'recordInputChange',
            selector: selector, // Send the non-null selector
            beforeValue: initialValue,
            afterValue: finalValue
        }, (response?: { success: boolean; error?: string }) => { // Type the response parameter
             if (chrome.runtime.lastError) {
                console.error("Error sending input change data:", chrome.runtime.lastError.message);
             } else if (response && !response.success) {
                console.warn("Background script indicated input change was not recorded:", response.error);
             }
        });
    }
}

/**
 * Handles click events on the document when the listener is active.
 * Captures DOM context (clicked element and ancestor HTML), records the click,
 * and attaches a blur listener to input/textarea elements.
 * @param {MouseEvent} event - The click event object.
 */
function handleDocumentClick(event: MouseEvent): void {
    if (!clickListenerActive) return; // Should not happen if listener is removed correctly

    const targetElement = event.target as Element | null; // Cast target to Element or null
    if (!targetElement) return; // Exit if target is null

    // NEW: Get DOM structure of element and 3 ancestors
    const domStructure: [string | null, string | null] = getTargetAndAncestorContextHTML(targetElement, 3);

    console.log('Click recorded:', { domStructure });

    // Send the new DOM structure data to the background script
    chrome.runtime.sendMessage({ 
        action: 'recordClick',
        domStructure: domStructure // Send array of HTML strings
    }, (response?: { success: boolean; error?: string }) => { // Type the response parameter
         if (chrome.runtime.lastError) {
            console.error("Error sending click data:", chrome.runtime.lastError.message);
         } else if (response && !response.success) {
            console.warn("Background script indicated click was not recorded:", response.error);
         }
    });

    // If the clicked element is an input or textarea, add a blur listener
    const tagName: string = targetElement.tagName.toLowerCase();
    if ((tagName === 'input' || tagName === 'textarea') && targetElement instanceof (HTMLInputElement || HTMLTextAreaElement)) {
        const inputElement = targetElement as HTMLInputElement | HTMLTextAreaElement; // Assert type
        const initialValue: string = inputElement.value; // Get current value directly
        const selectorForInput: string | null = getCssSelector(inputElement); // Still need selector for input change tracking
        
        if (selectorForInput) { // Only attach if selector is valid
            console.log(`Attaching blur listener to ${selectorForInput} with initial value:`, initialValue);
            // Add a one-time blur listener, pass the selector
            inputElement.addEventListener('blur', (blurEvent) => handleInputBlur(blurEvent as FocusEvent, initialValue, selectorForInput), { once: true });
        } else {
             console.warn("Could not generate selector for input/textarea, blur listener not attached.", inputElement);
        }
    }
}

/**
 * Adds the global click listener to the document.
 * Uses the capture phase to ensure clicks are caught early.
 * Sets the `clickListenerActive` flag to true.
 */
function addClickListener(): void {
    if (!clickListenerActive) {
        document.addEventListener('click', handleDocumentClick, true); // Use capture phase
        clickListenerActive = true;
        console.log('Click listener added.');
    }
}

/**
 * Removes the global click listener from the document.
 * Sets the `clickListenerActive` flag to false.
 */
function removeClickListener(): void {
    if (clickListenerActive) {
        document.removeEventListener('click', handleDocumentClick, true);
        clickListenerActive = false;
        console.log('Click listener removed.');
    }
}

/**
 * Listener for messages from the background script or popup.
 * Handles 'startListening' and 'stopListening' actions.
 */
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean | void => { // Type parameters and return
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
    // Return void or boolean based on async nature. Since it's sync, void is fine.
});

// Initial check - If the background script already thinks we should be recording 
// (e.g., after a refresh), it might send a startListening message upon loading.
// No explicit action needed here, the listener above handles it.
console.log("Content script loaded."); 