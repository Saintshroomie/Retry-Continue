# CLAUDE.md — SillyTavern Extension Development Guide

## Project Overview

**Retry Continue** is a SillyTavern third-party extension that adds checkpoint-based retry functionality via swipes. It serves as a reference implementation for building SillyTavern extensions.

## Repository Structure

```
├── manifest.json   # Extension metadata (required)
├── index.js        # All extension logic — single entry point
├── style.css       # UI styling using ST's CSS variable system
├── README.md       # User-facing documentation
└── CLAUDE.md       # AI development guide (this file)
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

SillyTavern defines **83+ event types** in `public/scripts/events.js`. The most useful ones for extension development:

#### Core Message Events

| Event | Fires When | Params | Typical Use |
|-------|-----------|--------|-------------|
| `USER_MESSAGE_RENDERED` | User message appears in chat | `messageId` | Clear/reset extension state |
| `CHARACTER_MESSAGE_RENDERED` | Character message appears | `messageId` | Detect new turns vs. continues |
| `MESSAGE_SENT` | User sends a message | `messageId` | Pre-processing before send |
| `MESSAGE_RECEIVED` | Generation completes, message received | `messageId` | Post-generation cleanup, unlock guards |
| `MESSAGE_EDITED` | Any message is edited (user or system) | `messageId` (string!) | Update cached text — use `parseInt(messageId)` |
| `MESSAGE_DELETED` | A message is deleted from chat | `messageId` | Clean up references to deleted messages |
| `MESSAGE_SWIPED` | User swipes to a different response | — | React to swipe navigation |
| `MESSAGE_UPDATED` | Message content is updated | `messageId` | Respond to non-edit content changes |
| `MESSAGE_FILE_EMBEDDED` | A file is embedded in a message | — | Handle file attachments |
| `MESSAGE_SWIPE_DELETED` | A swipe variant is deleted | — | Clean up swipe-related state |

#### Generation Events

| Event | Fires When | Params | Typical Use |
|-------|-----------|--------|-------------|
| `GENERATION_STARTED` | Generation begins | — | Hide buttons, set guard flags |
| `GENERATION_ENDED` | Generation finishes (success or failure) | — | Show buttons, unlock state |
| `GENERATION_STOPPED` | User manually stops generation | — | Handle interrupted generation |
| `GENERATION_AFTER_COMMANDS` | After slash commands processed, before gen | — | Modify generation parameters |
| `GENERATE_BEFORE_COMBINE_PROMPTS` | Before prompts are combined for API call | `data` | Modify prompt assembly |
| `GENERATE_AFTER_COMBINE_PROMPTS` | After prompts are combined | `data` | Inspect/modify final prompt |
| `GENERATE_AFTER_DATA` | After generation data is prepared | `data` | Last chance to modify API payload |
| `STREAM_TOKEN_RECEIVED` | Each token arrives during streaming | `token` | Real-time streaming UI updates |
| `SMOOTH_STREAM_TOKEN_RECEIVED` | Alias for `STREAM_TOKEN_RECEIVED` | `token` | Same event, alias for clarity |

#### Chat & Session Events

| Event | Fires When | Params | Typical Use |
|-------|-----------|--------|-------------|
| `CHAT_CHANGED` | User switches to a different chat | — | Load per-chat state from metadata |
| `CHAT_LOADED` | Chat data finishes loading | — | Post-load initialization |
| `CHAT_CREATED` | A new chat is created | — | Initialize fresh state |
| `CHAT_DELETED` | A chat is deleted | — | Clean up associated data |
| `GROUP_CHAT_CREATED` | A group chat is created | — | Group-specific initialization |
| `GROUP_CHAT_DELETED` | A group chat is deleted | — | Group cleanup |
| `MORE_MESSAGES_LOADED` | Older messages loaded (scrollback) | — | Re-apply indicators to loaded messages |

#### Character Events

| Event | Fires When | Params | Typical Use |
|-------|-----------|--------|-------------|
| `CHARACTER_EDITOR_OPENED` | Character editor panel opens | — | Add custom editor UI |
| `CHARACTER_EDITED` | Character card is modified | — | React to character changes |
| `CHARACTER_DELETED` | A character is deleted | — | Clean up character-specific data |
| `CHARACTER_DUPLICATED` | A character is duplicated | — | Handle copied characters |
| `CHARACTER_RENAMED` | A character is renamed | — | Update name references |
| `CHARACTER_FIRST_MESSAGE_SELECTED` | Alt first message chosen | — | Handle greeting variants |
| `CHARACTER_PAGE_LOADED` | Character page finishes loading | — | Inject custom UI into character page |
| `IMPERSONATE_READY` | Impersonation text is ready | — | Modify impersonated text |

#### Settings & Configuration Events

| Event | Fires When | Params | Typical Use |
|-------|-----------|--------|-------------|
| `SETTINGS_LOADED` | Settings finish loading | — | Read initial configuration |
| `SETTINGS_UPDATED` | Any setting is changed | — | React to setting changes |
| `EXTENSION_SETTINGS_LOADED` | Extension settings loaded | — | Initialize extension state |
| `EXTENSIONS_FIRST_LOAD` | Extensions loaded for the first time | — | One-time setup |
| `WORLDINFO_UPDATED` | World Info entries are changed | — | React to lore changes |
| `WORLDINFO_SETTINGS_UPDATED` | World Info settings changed | — | React to WI config changes |
| `CHATCOMPLETION_SOURCE_CHANGED` | Chat completion API source changed | — | Adapt to different APIs |
| `CHATCOMPLETION_MODEL_CHANGED` | Model selection changed | — | Model-specific behavior |
| `MAIN_API_CHANGED` | Main API backend changed | — | API-specific adaptations |
| `ONLINE_STATUS_CHANGED` | API connection status changed | — | Show/hide connection-dependent UI |
| `CONNECTION_PROFILE_LOADED` | Connection profile loaded | — | Profile-specific setup |

#### App Lifecycle Events

| Event | Fires When | Params | Typical Use |
|-------|-----------|--------|-------------|
| `APP_INITIALIZED` | App initialization complete (sticky) | — | Safe to query app state |
| `APP_READY` | App fully ready (sticky) | — | Safe to interact with all systems |

> **Sticky events**: `APP_INITIALIZED` and `APP_READY` are "sticky" — if you subscribe after they've fired, your callback runs immediately. All other events are fire-and-forget.

> **Important**: Always check that an event type exists before subscribing: `if (eventTypes.GENERATION_STARTED) { eventSource.on(...) }`. This guards against ST version differences where events may not be defined.

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

### One-Time Event Listeners

For events you only need to catch once (e.g., waiting for a specific user message), manually remove the listener:

```javascript
const onUserMessage = () => {
    eventSource.removeListener(eventTypes.USER_MESSAGE_RENDERED, onUserMessage);
    // Handle the event...
};
eventSource.on(eventTypes.USER_MESSAGE_RENDERED, onUserMessage);
```

### `MESSAGE_EDITED` Parameter Caveat

The `messageId` passed to `MESSAGE_EDITED` handlers is a **string**, not a number. Always use `parseInt()` when comparing:

```javascript
eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
    if (parseInt(messageId) === myStoredIndex) {
        // This is the message we're tracking
    }
});
```

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

/* Pseudo-element status indicators (e.g., active dot under a button) */
.my-button.active::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--SmartThemeQuoteColor, #e8a23a);
}

/* Message border indicators (use !important to override ST's base styles) */
.mes.my-highlighted-message {
    border-left: 3px solid var(--SmartThemeQuoteColor, #e8a23a) !important;
}
```

> **Note on `!important`**: Sometimes necessary when overriding ST's base message styles (e.g., borders). Use sparingly and only on elements where ST's own styles would win otherwise.

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

### Important: `#mes_continue` vs `#option_continue`

SillyTavern has **two** Continue buttons with different behaviors:

| Button | Location | Behavior |
|--------|----------|----------|
| `#option_continue` | Hamburger menu (`send_form`) | Continues the last message |
| `#mes_continue` | Quick-action bar (`rightSendForm`) | If text is in `#send_textarea`, posts it as a user message AND continues. Otherwise, same as `#option_continue` |

The `/continue` slash command behaves like `#option_continue` — it does **not** post typed text. If you need to handle typed input + continue, use `#mes_continue.click()` instead.

---

## Detecting User Input Text

Check `#send_textarea` before performing actions — the user may have typed text:

```javascript
const textarea = document.getElementById('send_textarea');
const inputText = textarea?.value?.trim();

if (inputText) {
    // User has typed something — handle it
} else {
    // No input — proceed with default behavior
}
```

---

## Auto-Confirming Active Edits

If a user is editing a message (the edit textarea is visible), you may need to confirm the edit before proceeding with your action:

```javascript
function confirmActiveMessageEdit() {
    const visibleEditButtons = document.querySelector(
        '#chat .mes .mes_edit_buttons[style*="display: inline-flex"]'
    );
    if (visibleEditButtons) {
        const editDoneBtn = visibleEditButtons.querySelector('.mes_edit_done');
        if (editDoneBtn) {
            editDoneBtn.click();
            return true;  // An edit was confirmed
        }
    }
    return false;
}
```

**Important**: ST updates `chat[N].mes` synchronously on edit confirm, but the `MESSAGE_EDITED` event fires asynchronously. If you need the updated text immediately after confirming, read it from `context.chat[N].mes` directly — don't wait for the event.

---

## Hooking Existing ST Buttons

To react when the user clicks ST's native buttons (e.g., Continue), add click listeners:

```javascript
function hookExistingButtons() {
    const continueButton = document.getElementById('option_continue');
    if (continueButton) {
        continueButton.addEventListener('click', () => myHandler());
    }

    const quickContinueBtn = document.getElementById('mes_continue');
    if (quickContinueBtn) {
        quickContinueBtn.addEventListener('click', () => myHandler());
    }
}
```

This is useful for "auto-set on Continue" type features where your extension reacts to ST's built-in actions.

---

## Debug Logging Pattern

Add a conditional debug logger controlled by a user setting:

```javascript
const defaultSettings = {
    debugMode: false,
    // ...other settings
};

function debug(...args) {
    if (!extensionSettings.debugMode) return;
    console.log('MY-EXTENSION:', ...args);
}
```

Use liberally throughout your code — it's free when disabled and invaluable when enabled. Log state transitions, event handlers, and guard flag changes.

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
10. **Keep it lean** — a single `index.js` and `style.css` is often sufficient. No build tools needed
11. **No external dependencies** — SillyTavern extensions run in the browser; prefer vanilla JS + jQuery (already available)
12. **Check eventType existence** — guard with `if (eventTypes.EVENT_NAME)` before subscribing, since event types may differ across ST versions
13. **`MESSAGE_EDITED` messageId is a string** — always `parseInt()` when comparing to numeric indices
14. **Auto-confirm active edits** — if your action modifies message state, confirm any in-progress edits first to avoid data loss
15. **Check `#send_textarea` for typed input** — the user may have text queued; handle it or warn before overwriting
16. **Use the 1000ms unlock delay** — after `MESSAGE_RECEIVED`, delay unlocking guard flags to catch post-generation `MESSAGE_EDITED` events
17. **Add debug logging** — a conditional `debug()` function controlled by a setting costs nothing when off and saves hours of troubleshooting
18. **Multiple button placements** — add buttons to both the hamburger menu (`send_form`) and quick-action bar (`rightSendForm`) for discoverability
19. **Hide/show buttons during generation** — toggle `display` on quick-action buttons via `GENERATION_STARTED`/`GENERATION_ENDED` to prevent double-triggers

---

## Build & Test

- **No build step** — extensions are loaded directly from source
- **Install location** — clone into `SillyTavern/data/default-user/extensions/third-party/`
- **Reload** — refresh the ST page to pick up changes
- **Debug** — use browser DevTools console; ST logs events and errors there
