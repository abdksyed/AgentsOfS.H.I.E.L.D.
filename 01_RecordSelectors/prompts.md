#### Model Used: Gemini 2.5 Pro Exp 03-25 (with Thinking)

#### Initial Prompt:

```
I want to create a chrome extension, which have a start button and a stop button. 
When the start button is presed it starts recording the clicks on the current webpage and the selectors which was clicked.

If the user clicks on button X, it have to record the button label name and the css selector of that button. The selector will come from the page DOM. So this extension should be capable of doing DOM manipulations

The recorded clicks will be shown in a text box in the extension popup UI and.
The other buttons along with start and stop will b e clear and download. There will also be a small indicator on top right showing the status of recording, if recording is going on it shows green else red.
When presseing clear it clears the existing recorded content and also stops the recording.

The clicks should work even when the page is refreshed or the page is redirected to a new page in the same tab. For now let's work on the same tab only.
```

#### Changes

##### Asked to add README and remove placeholder icons

```
Add a README.md giving details of how to get started and the usage of the tool.

Also for icons, let's remove them for now
```

##### Wanted to get the class-names instead of the tags

```
Here is the sample recording it gave

<example_recording>
Selector: input#ai-input-topic
Text: Apple
---
Selector: html > body > div:nth-of-type(16) > form > div:nth-of-type(2) > div:nth-of-type(4) > div:nth-of-type(2) > div:nth-of-type(6) > div > div > div:nth-of-type(2) > button
Text: 13 × 13
---
Selector: a#bs-select-3-6
Text: 17 × 17
---
Selector: html > body > div:nth-of-type(16) > form > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(2)
Text: List Entries
---
Selector: html > body > div:nth-of-type(16) > form > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(2) > div
Text: AI
---
<\example_recording>

The functionality is working as expected, but the selectors I want are the class for example

Instead of 
``
html > body > div:nth-of-type(16) > form > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(2) > div
``
I want the actual class names which is selected.
```


##### For the input Fields wanted to get the user entered value

```
<example_recording>
Selector: input#ai-input-topic
Text: N/A
---
Selector: div.widget.secondary-button.on.reset-btn
Text: Clear
---
Selector: div.secondary-button-text
Text: No
---
Selector: div.option-title
Text: List Entries
---
Selector: div.option.crossword-create-ai
Text: AI
---
Selector: div.option-title
Text: Empty Grid
---
Selector: div.option.crossword-grid-create
Text: Empty Grid
---
Selector: div.option.crossword-create-ai
Text: AI
---
Selector: div.option-title
Text: List Entries
---
Selector: div.option-title
Text: AI
---
Selector: div.widget.secondary-button.on.reset-btn
Text: Clear
---
Selector: div.widget.secondary-button.on.secondary-btn
Text: No
---
<\example_recording>

Now everything is working fine, but there is small issue. If the input field doesn't have any text when selected, so the text is always N/A, but after typing the text and I click somewhere else I want to record the text change. So in case where the class input we should also have two more field in the recording belowValue afterValue. The afterValue can get after the user clicks somewhere else after input class, read that particular class value
```

##### Request to add Resume button to continue the recording

```
Add one more button resume, where after stopping I can resume the recording, which will not clear the existing recording. Start will continue to work the same where it will clear the current recording and start a new one.
```