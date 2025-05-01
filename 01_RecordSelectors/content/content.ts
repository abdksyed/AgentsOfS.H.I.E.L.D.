console.log('Content script executing...');

// Check if the script has already run in this context
if (typeof (window as any).recorderContentScriptLoaded === 'undefined') {
    (window as any).recorderContentScriptLoaded = true;
    console.log('Content script initializing...');

    /**
     * Checks if the click listener is currently active.
     * @type {boolean}
     */
    let clickListenerActive: boolean = false;

    /**
     * Captures the outerHTML of the clicked element and a filtered HTML representation
     * of its ancestor chain up to a specified number of levels.
     * In the ancestor chain, each element only contains the child that is part of the
     * path down to the originally clicked element, excluding siblings.
     *
     * @param {Element} element - The element that was clicked.
     * @param {number} maxLevels - The maximum number of ancestor levels to include (e.g., 3 levels = parent, grandparent, great-grandparent).
     * @returns {[string | null, string | null]} An array containing two strings:
     *   [0]: The outerHTML of the top-most filtered ancestor (or the element itself if no ancestors included).
     *   [1]: The outerHTML of the originally clicked element.
     */
    function getTargetAndFilteredAncestorsHTML(element: Element | null, maxLevels: number): [string | null, string | null] {
        if (!element) {
            return [null, null];
        }

        const clickedElementHTML: string = element.outerHTML;
        let currentElement: Element | null = element;
        let filteredAncestorChainHTML: string = clickedElementHTML; // Start with the element itself
        let lastBuiltNode: Node | null = element.cloneNode(true); // Start with a clone of the clicked element

        try {
            for (let level = 0; level < maxLevels && currentElement?.parentElement; level++) {
                const parent: Element = currentElement.parentElement;
                if (!parent) break; // Should be caught by loop condition, but safety first

                // Create a shallow clone of the parent (tag, attributes, but no children)
                const parentClone = parent.cloneNode(false) as Element;

                // Append the previously built node (initially the clicked element, then the intermediate parent clone)
                if (lastBuiltNode) {
                    parentClone.appendChild(lastBuiltNode);
                }

                // Update for the next iteration
                currentElement = parent;
                lastBuiltNode = parentClone; // The node to append in the next level up
                filteredAncestorChainHTML = parentClone.outerHTML; // Update the final HTML string
            }
        } catch (error) {
             console.error("Error constructing filtered ancestor chain:", error);
             // On error, might return just the clicked element and whatever was built so far, or null
             // Returning null for the ancestor chain on error seems safer.
             return [null, clickedElementHTML];
        }

        return [filteredAncestorChainHTML, clickedElementHTML];
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

        // Helper for escaping CSS identifiers
        const escapeCSS = (s: string): string => {
            if (typeof CSS?.escape === 'function') {
                return CSS.escape(s);
            }
            // Fallback regex escape
            return s.replace(/([\:.#*+>~=\[\]$|()])/g, "\\$1"); // Added () to regex
        };

        let selector: string = element.nodeName.toLowerCase();

        if (element.id) {
            selector += `#${escapeCSS(element.id)}`;
        } else if (element.classList.length > 0) {
            const classes: string[] = Array.from(element.classList)
                               .filter(cls => cls.length > 0)
                               .map(escapeCSS); // Use helper for classes too
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

        // Get DOM structure: clicked element and its filtered ancestor chain (up to 3 levels)
        const maxLevelsToCapture = 3;
        const domStructure: [string | null, string | null] = getTargetAndFilteredAncestorsHTML(targetElement, maxLevelsToCapture);

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
        if (
          (tagName === 'input' && targetElement instanceof HTMLInputElement) ||
          (tagName === 'textarea' && targetElement instanceof HTMLTextAreaElement)
        ) {
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
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean | undefined => {
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
        // For synchronous listeners, returning undefined (implicitly or explicitly) is standard.
        // If the listener might respond asynchronously, it must return true.
        // Adding explicit return to satisfy linter.
        return undefined;
    });

    // Initial check - If the background script already thinks we should be recording 
    // (e.g., after a refresh), it might send a startListening message upon loading.
    // No explicit action needed here, the listener above handles it.
    console.log("Content script initialization finished.");

} else {
    console.log("Content script already initialized, skipping re-initialization.");
    // If re-initialization is skipped, ensure the listener is attached if the background expects it.
    // Send a message to background to get current state? Or rely on background sending startListening again.
    // For now, just log. Background script should handle re-sending startListening if needed.
} 