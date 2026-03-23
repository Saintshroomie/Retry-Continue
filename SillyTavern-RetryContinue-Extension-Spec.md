# SillyTavern Extension: Retry Continue

## Summary

A UI extension that adds a **Retry** button to SillyTavern's quick-action bar (next to Impersonate, Continue, Send). Retry automates the manual workflow of: edit a message to keep the good part → delete the bad part → hit Continue → repeat until satisfied. It does this by snapshotting the message at the point the user commits to, then creating a **new swipe** for each retry attempt and continuing from the snapshot. All retry results are stored as swipes on the same message, so the user can browse them using ST's native swipe arrows and pick the best one.

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
   - **Creates a new swipe** on this message containing the snapshot text.
   - Switches to the new swipe and triggers a **Continue** generation from it.
6. The AI generates new text appended to the snapshot. The new swipe now contains: `snapshot + continuation_A`.

#### Subsequent Retries — Iterating from the Snapshot

7. The user reads the result. The continuation is still not great.
8. The user clicks **Retry** again.
9. The extension:
   - **Creates another new swipe** with the snapshot text.
   - Switches to it and triggers another **Continue** generation.
10. The new swipe now contains: `snapshot + continuation_B`.
11. Repeat as needed. Each Retry creates a new swipe and generates a fresh continuation.

#### Browsing Retry Results

12. All retry attempts are stored as swipes on the same message. The user can use **ST's native swipe arrows** (left/right) to browse between all retry results and pick the one they like best.
13. The swipe counter (e.g., "3/5") reflects the total number of swipes, including both retry-generated swipes and any regular swipes.

#### Keeping a Result

When the user is satisfied with a continuation, they simply **stop retrying** — the message stays on whichever swipe they're viewing. They can continue chatting normally. The snapshot remains stored in case they want to Retry again later.

#### Clearing the Snapshot

The snapshot is automatically cleared when **any new message is added to the chat**, regardless of who sent it:
- The user sends a new message.
- The character generates a new message (not a Continue — a new separate message, e.g., the next turn in the conversation, or a second character responding in a group).
- The user switches to a different chat or character.
- The user explicitly clears it (via a "Clear Retry Checkpoint" option in the message context menu or extension settings).

**The core rule:** The snapshot only applies to the most recent message in the chat at the time it was created. Any new turn — user or character — means the conversation has moved on and the snapshot is no longer relevant.

The snapshot is **not** cleared by:
- Using normal swipes (browsing retry results or generating new full-message swipes).
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
- The user **explicitly clears** it via `/retryclear` command or context menu → snapshot clears.
- The user **deletes messages** such that the snapshotted message is no longer the last in the chat → snapshot clears.

**Not cleared by swiping:** Since retry results are stored as swipes, navigating between swipes (including generating new full-message swipes) does **not** clear the snapshot. The user can freely browse retry swipes and regular swipes while the snapshot remains available.

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

Each Retry creates a new swipe containing the snapshot text, switches to it, and triggers Continue. The result is that every retry attempt is stored as a separate swipe on the message — the user can use ST's native left/right swipe arrows to browse all retry results and pick the one they like best.

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

  // Guard: don't allow retry while generation is in progress
  if (context.isGenerating) {
    toastr.warning('Cannot retry while generation is in progress.');
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
    // === SUBSEQUENT RETRY: Validate snapshot ===
    if (retryState.messageId !== lastMsgIndex) {
      toastr.warning('Message context has changed. Resetting retry checkpoint.');
      resetRetryState();
      saveRetryState();
      updateButtonVisuals();
      return;
    }
  }

  retryState.retryCount++;
  saveRetryState();
  updateButtonVisuals();

  // === Create a new swipe with the snapshot text, then Continue from it ===
  await createSnapshotSwipeAndContinue(lastMsg, lastMsgIndex);
}
```

### Creating a Swipe and Continuing

The key operation: add a new swipe containing the snapshot text, switch to it, then trigger Continue so the LLM generates a new continuation from the snapshot.

```javascript
async function createSnapshotSwipeAndContinue(lastMsg, lastMsgIndex) {
  const context = SillyTavern.getContext();

  // Ensure the message has a swipes array (it should, but be safe)
  if (!lastMsg.swipes) {
    lastMsg.swipes = [lastMsg.mes];
    lastMsg.swipe_id = 0;
    lastMsg.swipe_info = [{}];
  }

  // Add a new swipe with the snapshot text as its starting content
  lastMsg.swipes.push(retryState.snapshotText);
  lastMsg.swipe_info.push({});

  // Switch to the new swipe
  const newSwipeIndex = lastMsg.swipes.length - 1;
  lastMsg.swipe_id = newSwipeIndex;
  lastMsg.mes = retryState.snapshotText;

  // Update the DOM to show the snapshot text on the new swipe
  // ST needs to re-render the message and update the swipe counter display
  await reRenderMessage(lastMsgIndex);

  // Save the chat so the new swipe is persisted
  await context.saveChat();

  // Now trigger Continue to generate new text appended to the snapshot
  await triggerContinue();
}

async function reRenderMessage(messageIndex) {
  // Approach 1 (Preferred): Use ST's addOneMessage or equivalent re-render
  // The exact function depends on the ST version. Common approaches:
  const context = SillyTavern.getContext();

  // Try using ST's reloadCurrentChat for a full re-render (reliable but heavy)
  // For a lighter approach, target the specific message element:
  const messageElement = document.querySelector(
    `#chat .mes[mesid="${messageIndex}"]`
  );

  if (messageElement) {
    const textElement = messageElement.querySelector('.mes_text');
    const msg = context.chat[messageIndex];
    if (textElement && msg) {
      // Use ST's message formatting if available
      if (typeof context.messageFormatting === 'function') {
        textElement.innerHTML = context.messageFormatting(
          msg.mes, msg.name, msg.is_system, msg.is_user, messageIndex
        );
      } else {
        textElement.textContent = msg.mes;
      }
    }

    // Update the swipe counter display (e.g., "3/5")
    const swipeCountElement = messageElement.querySelector('.swipes-counter');
    if (swipeCountElement && msg.swipes) {
      swipeCountElement.textContent = `${msg.swipe_id + 1}/${msg.swipes.length}`;
    }
  }
}
```

**Important implementation notes:**

- **Re-rendering swipe UI:** After programmatically adding a swipe and changing `swipe_id`, the swipe navigation arrows and counter (e.g., "3/5") need to update. The simplest reliable method may be to call `context.reloadCurrentChat()` or to dispatch a synthetic swipe event. The implementer should test which approach correctly refreshes the swipe UI without side effects.
- **`/addswipe` alternative:** ST provides a built-in `/addswipe (text)` slash command that handles swipe creation and UI updates internally. An alternative implementation could use this command to add the snapshot text as a new swipe, then trigger Continue. However, `/addswipe` may not switch to the new swipe automatically — test this behavior.
- **Swipe metadata:** Each swipe can have associated metadata in `swipe_info[]` (timestamps, token counts, etc.). The extension pushes an empty object `{}` as a placeholder; ST will populate it when the Continue generation completes.

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

**Important note for the implementer:** The exact method for triggering Continue programmatically may vary across ST versions. Check `SillyTavern.getContext()` in the browser console to see what functions are available. The `/continue` slash command is the most stable interface. If the extension needs to await the completion of generation, listen for the `GENERATION_ENDED` event.

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

**Rule:** Swiping between existing retries is fine — that's the whole point. The user is browsing their retry results. The snapshot remains active. However, if the user triggers a **new swipe generation** (right arrow past the last swipe, which generates a fresh full-message alternative), that new swipe won't have the snapshot prefix — it's a completely independent generation. The snapshot should **remain active** so the user can still press Retry to create another continuation-based swipe. The snapshot only clears per the lifecycle rules (new message added, chat switch, etc.).

### What if the user deletes messages after the snapshot?

**Rule:** If `chat.length - 1` no longer matches `retryState.messageId`, the snapshot is stale. Clear it and notify the user.

### What about group chats?

**Rule:** Retry works the same way — it operates on the last message in the chat. The snapshot tracks the message index, not the character. In group chats, when a different character generates a new response (a new message, not a Continue), the `CHARACTER_MESSAGE_RENDERED` handler detects that the chat length has changed and the last-message index no longer matches the snapshot, so it auto-clears. This is just the standard "any new message clears the snapshot" rule applied naturally.

### What about streaming?

**Rule:** If generation is currently streaming, the Retry button should be **disabled** (grayed out). Do not allow retry while a generation is in progress. Check `context.isGenerating` or listen for generation start/end events.

---

## Slash Command Registration

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

## Settings Panel

Add a minimal settings panel in the Extensions drawer:

- **Auto-set checkpoint on Continue:** Toggle. When enabled, the first time the user clicks regular Continue on a message, the extension automatically sets a snapshot at that point. This means the user never needs to explicitly click Retry first — any Continue becomes retry-able.
- **Show toast notifications:** Toggle (default: on).
- **Checkpoint indicator style:** Dropdown (border / icon / none).

---

## Implementation Checklist

1. [ ] Create extension folder structure and `manifest.json`
2. [ ] Implement `retryState` management (in-memory + chatMetadata persistence)
3. [ ] Add Retry button to the quick-action bar via DOM manipulation
4. [ ] Implement `doRetry()` — snapshot creation, swipe creation, Continue trigger
5. [ ] Implement `createSnapshotSwipeAndContinue()` — add swipe to `msg.swipes[]`, switch to it, save chat, trigger Continue
6. [ ] Implement `reRenderMessage()` — update DOM text and swipe counter after programmatic swipe creation
7. [ ] Implement `triggerContinue()` — test with `/continue` slash command first
8. [ ] Subscribe to events: `CHAT_CHANGED`, `USER_MESSAGE_RENDERED`, `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_EDITED`
9. [ ] Handle edge cases: streaming guard, message index validation, group chat behavior
10. [ ] Add CSS for button states and checkpoint indicator
11. [ ] Register `/retry` and `/retryclear` slash commands
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
- **The chat array is mutable.** You can directly modify `context.chat[n].mes` and it will be reflected when the chat is saved. But you must also update the DOM separately — ST doesn't auto-render on chat array changes.
- **`messageFormatting` may not be exposed.** If it's not available on the context object, you can use ST's internal `mesFormatting()` function if importable, or fall back to setting `.innerText` and letting ST's markdown processor handle it on the next render cycle.
- **Place the extension in:** `SillyTavern/data/<user>/extensions/SillyTavern-RetryContinue/` (current-user install) or `SillyTavern/public/scripts/extensions/third-party/SillyTavern-RetryContinue/` (all-users install).
