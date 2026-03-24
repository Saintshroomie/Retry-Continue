# CLAUDE.md — SillyTavern Extension Development Guide

## Project Overview

**Retry Continue** is a SillyTavern third-party extension that adds checkpoint-based retry functionality via swipes. It serves as a reference implementation for building SillyTavern extensions.

## Repository Structure

```
├── manifest.json   # Extension metadata (required)
├── index.js        # All extension logic — single entry point
├── style.css       # UI styling using ST's CSS variable system
└── README.md       # User-facing documentation
```

---

## How SillyTavern Extensions Work

### The Manifest (`manifest.json`)

Every extension **must** have a `manifest.json` at its root:

```json
{
  "display_name": "Extension Name",
  "loading_order": 1,
  "requires": [],
  "optional": [],
  "dependencies": [],
  "js": "index.js",
  "css": "style.css",
  "author": "Your Name",
  "version": "1.0.0",
  "homePage": "",
  "auto_update": true
}
```

| Field | Purpose |
|-------|---------|
| `display_name` | Shown in the ST extensions panel |
| `loading_order` | Lower = loaded earlier. Use `1` unless you depend on other extensions |
| `requires` | Array of required ST module names (e.g. `["tts"]`) |
| `optional` | Array of optional ST modules |
| `dependencies` | Array of other extension URLs this depends on |
| `js` | Entry point JavaScript file |
| `css` | Stylesheet file (loaded automatically) |
| `auto_update` | Whether ST should auto-update from the repo |

### Entry Point Pattern

Extensions use jQuery's DOM-ready callback as their entry point:

```javascript
jQuery(async () => {
    init();
});
```

The `init()` function orchestrates all setup: loading settings, adding UI elements, registering commands, subscribing to events, and restoring state.

---

## The SillyTavern Context API

The **single most important pattern** — all interaction with ST flows through the context object:

```javascript
const context = SillyTavern.getContext();
```

Call `SillyTavern.getContext()` fresh each time you need it (don't cache it long-term). Key properties and methods:

### Chat & Messages

| API | Description |
|-----|-------------|
| `context.chat` | Mutable array of message objects in current chat |
| `context.chat[i].mes` | The message text (raw, pre-formatting) |
| `context.chat[i].is_user` | Boolean — `true` if user message |
| `context.chat[i].swipes` | Array of swipe texts (may not exist until first swipe) |
| `context.chat[i].swipe_id` | Current active swipe index |
| `context.chat[i].swipe_info` | Metadata array parallel to `swipes` |
| `context.saveChat()` | Persist chat to disk (async) |
| `context.isGenerating` | Boolean — whether generation is in progress |

### Metadata (Per-Chat Persistent Storage)

```javascript
// Save custom data that persists with the chat
context.chatMetadata.myExtension = { key: 'value' };
context.saveMetadata();

// Load on chat switch
const saved = context.chatMetadata?.myExtension;
```

Use `chatMetadata` for per-chat state (checkpoints, counters, flags). This survives page refreshes.

### Extension Settings (Global Persistent Storage)

```javascript
// Save settings (persists across all chats)
context.extensionSettings.myExtension = { ...mySettings };
context.saveSettings();

// Load on init
const saved = context.extensionSettings?.myExtension;
if (saved) {
    mySettings = { ...defaults, ...saved };
}
```

Use `extensionSettings` for user preferences (toggles, UI options). Always merge with defaults to handle new settings added in updates.

### Message Formatting

```javascript
if (typeof context.messageFormatting === 'function') {
    textElement.innerHTML = context.messageFormatting(
        msg.mes, msg.name, msg.is_system, msg.is_user, messageIndex,
    );
} else {
    textElement.textContent = msg.mes;  // fallback
}
```

Always provide a fallback — `messageFormatting` may not be available.

### Slash Command Execution

```javascript
await context.executeSlashCommandsWithOptions('/continue');
```

Preferred way to trigger ST built-in actions programmatically.

---

## Event System

SillyTavern uses an EventEmitter pattern. Subscribe in your init:

```javascript
const { eventSource, eventTypes } = SillyTavern.getContext();

eventSource.on(eventTypes.CHAT_CHANGED, () => { /* ... */ });
eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => { /* ... */ });
```

### Key Event Types

| Event | Fires When | Typical Use |
|-------|-----------|-------------|
| `CHAT_CHANGED` | User switches to a different chat | Load per-chat state |
| `USER_MESSAGE_RENDERED` | User message appears in chat | Clear/reset extension state |
| `CHARACTER_MESSAGE_RENDERED` | Character message appears | Detect new turns vs. continues |
| `MESSAGE_EDITED` | Any message is edited | Update cached text (param: `messageId`) |
| `MESSAGE_RECEIVED` | Generation completes, message received | Post-generation cleanup |
| `GENERATION_STARTED` | Generation begins | Hide buttons, set guards |
| `GENERATION_ENDED` | Generation finishes | Show buttons, unlock state |

### Distinguishing New Messages vs. Continues

```javascript
eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, () => {
    const ctx = SillyTavern.getContext();
    const currentLastIndex = ctx.chat.length - 1;

    if (currentLastIndex !== savedMessageId) {
        // New message was added to the chat
    } else {
        // Same message — this was a Continue
    }
});
```

### Guard Flags for Race Conditions

Generation triggers `MESSAGE_EDITED` events that can overwrite your state. Use a lock pattern:

```javascript
let snapshotLocked = false;

// Before triggering generation:
snapshotLocked = true;

// In MESSAGE_EDITED handler:
eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
    if (snapshotLocked) return;       // Skip edits from generation
    if (context.isGenerating) return;  // Double-check
    // ... handle user edit
});

// After generation completes (with delay for post-generation edits):
eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
    setTimeout(() => { snapshotLocked = false; }, 1000);
});
```

The 1000ms delay is important — ST fires `MESSAGE_EDITED` slightly after generation completes.

---

## Registering Slash Commands

```javascript
context.registerSlashCommand(
    'commandname',           // Command name (used as /commandname)
    async (args) => {        // Handler function
        // Do work...
        return '';           // Return value (string)
    },
    [],                      // Aliases array
    'Description for help.', // Help text
    true,                    // interruptsGeneration — stops active gen?
    true,                    // purgeFromMessage — remove from chat input?
);
```

- Always check `context.registerSlashCommand` exists before calling
- Return empty string `''` for action commands, or a status message for informational commands

---

## UI Integration

### Adding Buttons

Insert into existing ST containers rather than creating new panels:

```javascript
// Hamburger menu item (send_form)
const sendForm = document.getElementById('send_form');
const btn = document.createElement('div');
btn.id = 'my_extension_button';
btn.classList.add('list-group-item', 'interactable');
btn.innerHTML = '<span class="fa-solid fa-icon-name"></span> Label';

// Insert relative to an existing button
const referenceBtn = document.getElementById('option_continue');
referenceBtn.parentNode.insertBefore(btn, referenceBtn.nextSibling);

// Quick-action button (rightSendForm)
const rightForm = document.getElementById('rightSendForm');
const quickBtn = document.createElement('div');
quickBtn.classList.add('fa-solid', 'fa-icon-name', 'interactable');
rightForm.appendChild(quickBtn);
```

**Always guard against duplicates:**

```javascript
if (document.getElementById('my_button')) return;
```

### Settings Panel

Add to `#extensions_settings` using ST's inline-drawer pattern:

```javascript
const settingsContainer = document.getElementById('extensions_settings');
settingsContainer.insertAdjacentHTML('beforeend', `
    <div id="my_extension_settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Extension Name</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="my_checkbox" type="checkbox" />
                    <span>Setting description</span>
                </label>
                <select id="my_select" class="text_pole">
                    <option value="a">Option A</option>
                </select>
                <div class="menu_button" id="my_action_button">
                    Action Button
                </div>
            </div>
        </div>
    </div>
`);
```

Standard ST UI classes: `checkbox_label`, `text_pole`, `menu_button`, `interactable`, `list-group-item`.

### Targeting Messages in the DOM

```javascript
const messageEl = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
const textEl = messageEl.querySelector('.mes_text');
const nameEl = messageEl.querySelector('.ch_name');
const swipeCounter = messageEl.querySelector('.swipes-counter');
```

---

## CSS Patterns

### Use ST's CSS Variables

Always prefer SillyTavern's theme variables over hardcoded colors:

```css
.my-element {
    color: var(--SmartThemeQuoteColor, #e8a23a);  /* always provide a fallback */
}
```

### Scope Styles to Your Extension

Prefix IDs and classes to avoid collisions:

```css
#my_extension_button { /* ... */ }
.my-extension-indicator { /* ... */ }
```

### Common Patterns

```css
/* Smooth state transitions */
.my-button {
    opacity: 0.7;
    transition: opacity 0.15s ease, color 0.15s ease;
}
.my-button:hover { opacity: 1; }
.my-button.active { opacity: 1; color: var(--SmartThemeQuoteColor, #e8a23a); }
```

---

## Working with Swipes

Swipes are alternative versions of a message. The `swipes` array may not exist until explicitly created:

```javascript
const msg = context.chat[messageIndex];

// Initialize swipes if needed
if (!msg.swipes) {
    msg.swipes = [msg.mes];       // Current text becomes swipe 0
    msg.swipe_id = 0;
    msg.swipe_info = [{}];
}

// Add a new swipe
msg.swipes.push(newText);
msg.swipe_info.push({});

// Switch to the new swipe
msg.swipe_id = msg.swipes.length - 1;
msg.mes = newText;

// Re-render and save
await reRenderMessage(messageIndex);
await context.saveChat();
```

After creating swipes, update the swipe counter and ensure swipe controls are visible:

```javascript
const swipeCounter = messageEl.querySelector('.swipes-counter');
swipeCounter.textContent = `${msg.swipe_id + 1}/${msg.swipes.length}`;

const swipeControl = messageEl.querySelector('.swipe_right, .swipe_left');
if (swipeControl) swipeControl.style.display = '';
```

---

## Toast Notifications

SillyTavern exposes `toastr` globally:

```javascript
function toast(message, type = 'info') {
    if (typeof toastr !== 'undefined' && toastr[type]) {
        toastr[type](message);
    }
}
// Types: 'info', 'success', 'warning', 'error'
```

Consider making toasts optional via a user setting.

---

## Triggering Built-in Actions

Prefer the slash command system over DOM clicks:

```javascript
// Best approach
if (context.executeSlashCommandsWithOptions) {
    await context.executeSlashCommandsWithOptions('/continue');
    return;
}

// Fallback: click the button
const btn = document.getElementById('option_continue');
if (btn) btn.click();
```

---

## Best Practices Summary

1. **Always get a fresh context** — call `SillyTavern.getContext()` when you need it, don't cache across async boundaries
2. **Guard all DOM operations** — elements may not exist; always null-check
3. **Prevent duplicate UI** — check for existing elements before creating buttons/panels
4. **Use chatMetadata for per-chat state** and **extensionSettings for global preferences**
5. **Merge with defaults on load** — `{ ...defaults, ...saved }` handles new settings gracefully
6. **Lock state during generation** — use guard flags to prevent `MESSAGE_EDITED` from overwriting your data
7. **Use event-driven architecture** — subscribe to ST events, don't poll
8. **Provide graceful fallbacks** — check if APIs exist before calling them
9. **Scope your CSS** — prefix all IDs/classes to avoid conflicts
10. **Keep it lean** — a single `index.js` and `style.css` is often sufficient. No build tools needed.
11. **No external dependencies** — SillyTavern extensions run in the browser; prefer vanilla JS + jQuery (already available)

---

## Build & Test

- **No build step** — extensions are loaded directly from source
- **Install location** — clone into `SillyTavern/data/default-user/extensions/third-party/`
- **Reload** — refresh the ST page to pick up changes
- **Debug** — use browser DevTools console; ST logs events and errors there
