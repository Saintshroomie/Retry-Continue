# SillyTavern Extension: Retry Continue

## Summary

A UI extension that adds a **Retry** button to SillyTavern's quick-action bar (next to Impersonate, Continue, Send). Retry automates the manual workflow of: edit a message to keep the good part → delete the bad part → hit Continue → repeat until satisfied. It does this by snapshotting the message at the point the user commits to, then allowing repeated re-generations from that snapshot without manual editing.

---

## The Problem

When the AI generates a message that's partially good, the user's current workflow is:

1. Click edit on the AI's message.
2. Delete the unwanted portion (keeping the good prefix).
3. Confirm the edit.
4. Click Continue to regenerate from that point.
5. If the new continuation is also bad, repeat steps 1–4.

This is tedious. Each cycle requires 4+ clicks and careful text selection. The user wants to keep iterating on the *continuation* without re-editing each time.

---

## The Solution: Retry Continue

### Core Concept

**Retry** = "Continue from a saved checkpoint, discarding everything generated after that checkpoint."

The extension introduces a **snapshot** — the preserved state of a message at the moment the user first requests a retry-able continuation. Each subsequent Retry press:

1. Restores the message to the snapshot.
2. Triggers a Continue generation from the snapshot text.

This is conceptually identical to how **swipes** work for full messages, but applied to the *continuation portion* of a message.

---

## User-Facing Behavior

### Button Placement

Add a **Retry** button (↻ icon) to the quick-action bar at the bottom of the chat interface, positioned between the Continue button and the Send button.

### Workflow

#### First Use — Establishing a Snapshot

1. The AI generates a message. The user likes the first half but not the second half.
2. The user **edits the message** — deleting the unwanted tail, keeping only the good prefix.
3. The user confirms the edit (checkbox).
4. The user clicks **Retry** (instead of Continue).
5. The extension:
   - **Saves a snapshot** of the current message text (the user's edited version — the "good prefix").
   - Records which message index this snapshot belongs to.
   - Triggers a **Continue** generation from this text.
6. The AI generates new text appended to the snapshot. The full message is now: `snapshot + new_continuation`.

#### Subsequent Retries — Iterating from the Snapshot

7. The user reads the result. The continuation is still not great.
8. The user clicks **Retry** again.
9. The extension:
   - **Restores the message** back to the snapshot text (discarding the previous continuation).
   - Triggers another **Continue** generation.
10. Repeat as needed. Each Retry always returns to the same snapshot and re-generates.

#### Optional: Keeping a Continuation

When the user is satisfied with a continuation, they simply **do nothing** — the message stays as-is. They can continue chatting normally. The snapshot remains stored in case they want to Retry again later.

#### Clearing the Snapshot

The snapshot is automatically cleared when **any new message is added to the chat**, regardless of who sent it:
- The user sends a new message.
- The character generates a new message (not a Continue — a new separate message, e.g., the next turn in the conversation, or a second character responding in a group).
- The user switches to a different chat or character.
- The user explicitly clears it (via a "Clear Retry Checkpoint" option in the message context menu or extension settings).

**The core rule:** The snapshot only applies to the most recent message in the chat at the time it was created. Any new turn — user or character — means the conversation has moved on and the snapshot is no longer relevant.

The snapshot is **not** cleared by:
- Using normal swipes on other messages.
- Using the regular Continue button (Continue appends to whatever the current state is; Retry always resets to snapshot first).
- Editing the snapshotted message manually (this updates the snapshot — see Edge Cases below).

### Visual Indicators

- When a snapshot is active, the Retry button should have a **highlighted/active state** (e.g., a colored dot, a subtle glow, or a badge showing the number of retries attempted).
- Optionally, show a small indicator on the message itself (e.g., a thin colored left-border or a small checkpoint icon) to signal "this message has a retry checkpoint."
- Display a toast notification on first snapshot: `"Retry checkpoint set."` and on each retry: `"Retrying from checkpoint..."`.

---

## Snapshot Lifecycle

This section is the definitive reference for when snapshots are created, updated, and destroyed. All other sections defer to these rules.

### Created

A snapshot is created when the user presses **Retry** and no snapshot currently exists. The snapshot text is whatever the last message's content is at that exact moment (whether the user has edited it or not).

### Updated

A snapshot is updated (replaced with new text, same message) when the user **edits the snapshotted message** — either by trimming it, adding to it, or rewriting part of it. The edited result becomes the new snapshot for future retries.

### Preserved (not affected)

The snapshot is **not** cleared or changed by:
- Pressing the regular **Continue** button (Continue appends to current state; the snapshot remains for future Retry use).
- Using **Swipe** on a *different* message (swipes on other messages don't affect the snapshotted message).
- Pressing **Retry** again (this restores the snapshot and re-continues — that's the whole point).

### Destroyed (cleared)

The snapshot is cleared when **any new message is added to the chat**, regardless of sender:
- The **user sends** a new message → snapshot clears.
- A **character generates a new message** (a new turn, not a Continue on the existing message) → snapshot clears.
- In **group chats**, a different character responding adds a new message → snapshot clears.
- The user **switches chats or characters** → snapshot clears.
- The user uses **Swipe on the snapshotted message** → snapshot clears (swipes replace the entire message, making the snapshot meaningless).
- The user **explicitly clears** it via `/retryclear` command or context menu → snapshot clears.
- The user **deletes messages** such that the snapshotted message is no longer the last in the chat → snapshot clears.

**In short:** The snapshot only lives for the most recent message in the chat. The moment the conversation advances by even one turn in any direction, it's gone.

---

## Technical Architecture

### Extension Structure

```
SillyTavern-RetryContinue/
├── manifest.json
├── index.js          # Main extension logic
├── style.css         # Button styling and indicators
└── README.md         # User documentation
```

### manifest.json

```json
{
  "display_name": "Retry Continue",
  "loading_order": 1,
  "requires": [],
  "optional": [],
  "dependencies": [],
  "js": "index.js",
  "css": "style.css",
  "author": "Chris Phifer",
  "version": "1.0.0",
  "homePage": "",
  "auto_update": true
}
```

### State Management

The extension manages a single state object persisted per-chat in extension settings:

```javascript
// In-memory state (lives for the duration of the session)
let retryState = {
  active: false,           // Whether a snapshot is currently set
  messageId: null,         // Index in context.chat[] of the snapshotted message
  snapshotText: '',        // The saved message text (the "good prefix")
  retryCount: 0,           // Number of times Retry has been pressed for this snapshot
};
```

**Persistence strategy:** The snapshot should be saved to `chat_metadata` (via `context.chatMetadata`) so it survives page refreshes within the same chat. Clear it on chat switch.

```javascript
// Save to chat metadata
function saveRetryState() {
  const context = SillyTavern.getContext();
  if (!context.chatMetadata) return;
  context.chatMetadata.retryContinue = {
    active: retryState.active,
    messageId: retryState.messageId,
    snapshotText: retryState.snapshotText,
    retryCount: retryState.retryCount,
  };
  context.saveMetadata();
}

// Load from chat metadata
function loadRetryState() {
  const context = SillyTavern.getContext();
  const saved = context.chatMetadata?.retryContinue;
  if (saved && saved.active) {
    retryState = { ...saved };
  } else {
    resetRetryState();
  }
  updateButtonVisuals();
}
```

### Core Logic — The Retry Function

```javascript
async function doRetry() {
  const context = SillyTavern.getContext();
  const chat = context.chat;

  // Guard: must have messages, last message must be from the character
  const lastMsg = chat[chat.length - 1];
  if (!lastMsg || lastMsg.is_user) {
    toastr.warning('Retry requires the last message to be from the character.');
    return;
  }

  const lastMsgIndex = chat.length - 1;

  if (!retryState.active) {
    // === FIRST RETRY: Establish snapshot from current message state ===
    retryState.active = true;
    retryState.messageId = lastMsgIndex;
    retryState.snapshotText = lastMsg.mes; // Save current text as checkpoint
    retryState.retryCount = 0;
    saveRetryState();
    toastr.info('Retry checkpoint set.');
  } else {
    // === SUBSEQUENT RETRY: Validate and restore snapshot ===
    if (retryState.messageId !== lastMsgIndex) {
      // The message index has shifted (e.g., messages were added/deleted).
      // Attempt to detect if the snapshotted message is still the last assistant
      // message. If not, warn and reset.
      toastr.warning('Message context has changed. Resetting retry checkpoint.');
      resetRetryState();
      saveRetryState();
      updateButtonVisuals();
      return;
    }

    // Restore the message to the snapshot text
    lastMsg.mes = retryState.snapshotText;

    // Update the displayed message in the DOM
    const messageElement = document.querySelector(
      `#chat .mes[mesid="${lastMsgIndex}"] .mes_text`
    );
    if (messageElement) {
      // Use ST's messageFormatting if available, otherwise set innerHTML
      messageElement.innerHTML = context.messageFormatting?.(
        retryState.snapshotText,
        lastMsg.name,
        lastMsg.is_system,
        lastMsg.is_user,
        lastMsgIndex
      ) ?? retryState.snapshotText;
    }
  }

  retryState.retryCount++;
  saveRetryState();
  updateButtonVisuals();

  // Trigger Continue generation
  // ST's Continue is typically triggered by clicking '#option_continue'
  // or by calling the internal generate function with type 'continue'.
  // The safest approach is to programmatically click the continue button,
  // or use the /continue slash command via context.executeSlashCommands.
  await triggerContinue();
}
```

### Triggering Continue

There are multiple approaches, ordered by reliability:

```javascript
async function triggerContinue() {
  // Approach 1 (Preferred): Use ST's slash command system
  const context = SillyTavern.getContext();
  if (context.executeSlashCommandsWithOptions) {
    await context.executeSlashCommandsWithOptions('/continue');
    return;
  }

  // Approach 2: Programmatically click the Continue button
  const continueButton = document.getElementById('option_continue');
  if (continueButton) {
    continueButton.click();
    return;
  }

  // Approach 3: Direct import (less stable across ST versions)
  // import { Generate } from '../../../../script.js';
  // await Generate('continue');

  toastr.error('Could not trigger Continue. Is the Continue button enabled?');
}
```

**Important note for the implementer:** The exact method for triggering Continue programmatically may vary across ST versions. Check `SillyTavern.getContext()` in the browser console to see what functions are available. The `/continue` slash command is the most stable interface. If the extension needs to await the completion of generation, listen for the `MESSAGE_RECEIVED` or `GENERATION_ENDED` event.

### Saving the Restored Message to Chat File

After restoring `lastMsg.mes` to the snapshot, the chat array in memory is updated, but the chat **file on disk** also needs to be saved. Call `context.saveChatDebounced()` or `context.saveChat()` after modifying the message to ensure persistence.

```javascript
// After restoring snapshot:
lastMsg.mes = retryState.snapshotText;
context.saveChat(); // Persist the restored state before triggering Continue
```

### UI — Adding the Button

```javascript
function addRetryButton() {
  // Find the quick-action bar (the row with Continue, Impersonate, Send)
  const sendForm = document.getElementById('send_form');
  if (!sendForm) return;

  // Check if button already exists
  if (document.getElementById('option_retry_continue')) return;

  // Create the button
  const retryButton = document.createElement('div');
  retryButton.id = 'option_retry_continue';
  retryButton.classList.add('fa-solid', 'fa-arrow-rotate-right', 'interactable');
  retryButton.title = 'Retry Continue — regenerate from checkpoint';
  retryButton.tabIndex = 0;

  // Insert before the Send button (or after Continue)
  const continueButton = document.getElementById('option_continue');
  if (continueButton && continueButton.parentNode) {
    continueButton.parentNode.insertBefore(
      retryButton,
      continueButton.nextSibling
    );
  } else {
    // Fallback: append to send_form
    sendForm.appendChild(retryButton);
  }

  // Event listener
  retryButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await doRetry();
  });
}
```

### Event Subscriptions

```javascript
function init() {
  const context = SillyTavern.getContext();
  const eventSource = context.eventSource;
  const eventTypes = context.eventTypes;

  // Add the button to the UI
  addRetryButton();

  // Load state when a chat is opened
  eventSource.on(eventTypes.CHAT_CHANGED, () => {
    loadRetryState();
  });

  // Clear snapshot when ANY new message is added (user or character)
  // This ensures the snapshot only ever applies to the most recent message.
  eventSource.on(eventTypes.USER_MESSAGE_RENDERED, () => {
    if (retryState.active) {
      resetRetryState();
      saveRetryState();
      updateButtonVisuals();
    }
  });

  eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, () => {
    // CHARACTER_MESSAGE_RENDERED fires for new character messages.
    // We need to distinguish between:
    //   (a) A new separate character message (new turn) — CLEAR the snapshot
    //   (b) A Continue appending to the current message — DO NOT clear
    // Check: if the chat length has increased (new message added), clear.
    // If the chat length is the same (Continue extended the last message), keep.
    const context = SillyTavern.getContext();
    const currentLastIndex = context.chat.length - 1;

    if (retryState.active && currentLastIndex !== retryState.messageId) {
      // A new message was added — the conversation moved on
      resetRetryState();
      saveRetryState();
      updateButtonVisuals();
    }
  });

  // After generation completes, update visuals
  eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
    updateButtonVisuals();
  });

  // If the user edits the snapshotted message, update the snapshot to match
  eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
    if (retryState.active && parseInt(messageId) === retryState.messageId) {
      const ctx = SillyTavern.getContext();
      const msg = ctx.chat[retryState.messageId];
      if (msg) {
        retryState.snapshotText = msg.mes;
        saveRetryState();
        toastr.info('Retry checkpoint updated to your edit.');
      }
    }
  });

  // If the user swipes on the snapshotted message, clear the snapshot
  eventSource.on(eventTypes.MESSAGE_SWIPED, (messageId) => {
    if (retryState.active && parseInt(messageId) === retryState.messageId) {
      resetRetryState();
      saveRetryState();
      updateButtonVisuals();
    }
  });

  // Load state on init (for page refresh scenarios)
  loadRetryState();
}

// Entry point — called by ST's extension loader
jQuery(async () => {
  init();
});
```

### Button Visuals

```javascript
function updateButtonVisuals() {
  const btn = document.getElementById('option_retry_continue');
  if (!btn) return;

  if (retryState.active) {
    btn.classList.add('retry-active');
    btn.title = `Retry Continue (checkpoint active, ${retryState.retryCount} retries)`;
  } else {
    btn.classList.remove('retry-active');
    btn.title = 'Retry Continue — regenerate from checkpoint';
  }
}

function resetRetryState() {
  retryState = {
    active: false,
    messageId: null,
    snapshotText: '',
    retryCount: 0,
  };
}
```

### CSS (style.css)

```css
#option_retry_continue {
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s ease, color 0.15s ease;
  font-size: 1.1em;
  padding: 2px 5px;
}

#option_retry_continue:hover {
  opacity: 1;
}

#option_retry_continue.retry-active {
  opacity: 1;
  color: var(--SmartThemeQuoteColor, #e8a23a);
  position: relative;
}

#option_retry_continue.retry-active::after {
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
```

---

## Edge Cases and Rules

### What if the user manually edits the message while a snapshot is active?

**Rule:** If the user edits the message that has an active snapshot, **update the snapshot** to the new edited text. The user is intentionally refining their checkpoint. Listen for the `MESSAGE_EDITED` event (or equivalent) and update accordingly:

```javascript
eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
  if (retryState.active && parseInt(messageId) === retryState.messageId) {
    const context = SillyTavern.getContext();
    const msg = context.chat[retryState.messageId];
    if (msg) {
      retryState.snapshotText = msg.mes;
      saveRetryState();
      toastr.info('Retry checkpoint updated to your edit.');
    }
  }
});
```

### What if the user clicks regular Continue (not Retry) while a snapshot is active?

**Rule:** Regular Continue appends to whatever the current message is. It does **not** interact with the snapshot. The snapshot remains stored. A subsequent Retry will still roll back to the original snapshot, discarding both the regular Continue's output and the previous Retry's output.

### What if the user uses Swipe on the snapshotted message?

**Rule:** Swiping replaces the entire message (all swipes are full alternatives). If the user swipes away from the snapshotted message, **clear the snapshot** — the message content is now entirely different. Listen for `MESSAGE_SWIPED` or equivalent.

### What if the user deletes messages after the snapshot?

**Rule:** If `chat.length - 1` no longer matches `retryState.messageId`, the snapshot is stale. Clear it and notify the user.

### What about group chats?

**Rule:** Retry works the same way — it operates on the last message in the chat. The snapshot tracks the message index, not the character. In group chats, when a different character generates a new response (a new message, not a Continue), the `CHARACTER_MESSAGE_RENDERED` handler detects that the chat length has changed and the last-message index no longer matches the snapshot, so it auto-clears. This is just the standard "any new message clears the snapshot" rule applied naturally.

### What about streaming?

**Rule:** If generation is currently streaming, the Retry button should be **disabled** (grayed out). Do not allow retry while a generation is in progress. Check `context.isGenerating` or listen for generation start/end events.

---

## Slash Command Registration (Optional but Recommended)

Register a `/retry` command so power users and Quick Replies can invoke it:

```javascript
context.registerSlashCommand(
  'retry',
  async () => { await doRetry(); return ''; },
  [],
  'Retry the continuation from the saved checkpoint. If no checkpoint exists, sets one from the current message state and continues.',
  true,  // interruptsGeneration
  true,  // purgeFromMessage
);
```

Also register `/retryClear` to manually clear the snapshot:

```javascript
context.registerSlashCommand(
  'retryclear',
  () => { resetRetryState(); saveRetryState(); updateButtonVisuals(); return 'Retry checkpoint cleared.'; },
  [],
  'Clear the active retry checkpoint.',
  false,
  true,
);
```

---

## Context Menu Integration (Optional Enhancement)

Add a right-click context menu option to any character message:

- **"Set as Retry Checkpoint"** — Manually sets the snapshot to this message's current content, even if it's not the last message (for advanced use).
- **"Clear Retry Checkpoint"** — Clears the active snapshot.

This can be done by hooking into ST's message context menu system (check for `eventTypes.MESSAGE_CONTEXT_MENU` or the `.mes_buttons` DOM structure).

---

## Settings Panel (Optional Enhancement)

Add a minimal settings panel in the Extensions drawer:

- **Auto-set checkpoint on Continue:** Toggle. When enabled, the first time the user clicks regular Continue on a message, the extension automatically sets a snapshot at that point. This means the user never needs to explicitly click Retry first — any Continue becomes retry-able.
- **Show toast notifications:** Toggle (default: on).
- **Checkpoint indicator style:** Dropdown (border / icon / none).

---

## Implementation Checklist

1. [ ] Create extension folder structure and `manifest.json`
2. [ ] Implement `retryState` management (in-memory + chatMetadata persistence)
3. [ ] Add Retry button to the quick-action bar via DOM manipulation
4. [ ] Implement `doRetry()` — snapshot creation, message restoration, Continue trigger
5. [ ] Implement `triggerContinue()` — test with `/continue` slash command first
6. [ ] Subscribe to events: `CHAT_CHANGED`, `USER_MESSAGE_RENDERED`, `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_EDITED`, `MESSAGE_SWIPED`
7. [ ] Handle edge cases: streaming guard, message index validation, group chat behavior
8. [ ] Add CSS for button states and checkpoint indicator
9. [ ] Register `/retry` and `/retryclear` slash commands
10. [ ] Test with KoboldCpp backend (Text Completion API — the primary use case)
11. [ ] Test with a Chat Completion API to confirm Continue behaves the same way
12. [ ] Test persistence: set a checkpoint, refresh the page, verify it loads correctly

---

## Key SillyTavern APIs Referenced

| API | Access | Purpose |
|-----|--------|---------|
| `SillyTavern.getContext()` | Global | Access to chat, characters, events, settings |
| `context.chat` | Mutable array | Read/write message objects |
| `context.chat[n].mes` | String | The message text content |
| `context.chatMetadata` | Object | Per-chat metadata storage (persisted) |
| `context.saveChat()` | Function | Save current chat to disk |
| `context.saveMetadata()` | Function | Save chat metadata to disk |
| `context.eventSource` | EventEmitter | Subscribe to application events |
| `context.eventTypes` | Enum | Event type constants |
| `context.executeSlashCommandsWithOptions(cmd)` | Function | Run slash commands programmatically |
| `context.registerSlashCommand(...)` | Function | Register custom slash commands |

---

## Development Notes

- **Test in browser console first.** Before writing the extension, open ST in the browser, press F12, and run `SillyTavern.getContext()` to explore the available API surface. Check what functions exist for triggering Continue, saving chats, and subscribing to events. The API surface evolves between ST releases.
- **The chat array is mutable.** You can directly modify `context.chat[n].mes` and it will be reflected when the chat is saved. But you must also update the DOM separately — ST doesn't auto-render on chat array changes.
- **`messageFormatting` may not be exposed.** If it's not available on the context object, you can use ST's internal `mesFormatting()` function if importable, or fall back to setting `.innerText` and letting ST's markdown processor handle it on the next render cycle.
- **Place the extension in:** `SillyTavern/data/<user>/extensions/SillyTavern-RetryContinue/` (current-user install) or `SillyTavern/public/scripts/extensions/third-party/SillyTavern-RetryContinue/` (all-users install).
