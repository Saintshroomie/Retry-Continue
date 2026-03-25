# Retry Continue — SillyTavern Extension

A UI extension that adds a **Retry** button to SillyTavern's quick-action bar. Retry automates the workflow of editing a message to keep the good part, deleting the bad part, and hitting Continue — storing each retry attempt as a separate swipe so you can browse results with ST's native swipe arrows.

## Installation

1. Open SillyTavern and go to **Extensions** > **Install Extension**.
2. Paste this repository's URL and click Install.
3. The Retry button (↻) will appear in the quick-action bar between Continue and Send.

## Usage

### Basic Workflow

1. The AI generates a message. You like the first half but not the second.
2. **Edit the message** — delete the unwanted tail, keeping only the good prefix.
3. Confirm the edit.
4. Click **Retry** (↻ button in the action bar).
5. The extension saves your edited text as a checkpoint, creates a new swipe, and triggers Continue from it.
6. Not satisfied? Click **Retry** again — each attempt becomes a new swipe.
7. Use ST's native **swipe arrows** to browse all retry results and pick the best one.

### Slash Commands

- `/retry` — Trigger a retry from the command line or Quick Replies.
- `/retryclear` — Clear the active retry checkpoint.

### Settings

Found in the **Extensions** drawer under **Retry Continue**:

- **Show toast notifications** — Toggle notification messages on/off.
- **Checkpoint indicator style** — Choose how the checkpointed message is visually marked (border, icon, or none).

## How It Works

- **First Retry**: Saves the current message text as a snapshot (checkpoint), creates a new swipe with that text, and triggers Continue.
- **Subsequent Retries**: Creates another new swipe from the same snapshot and triggers Continue again.
- **Snapshot clears** when any new message is added to the chat, you switch chats, or you manually clear it.
- **Editing** the checkpointed message updates the snapshot automatically.

## Author

Chris Phifer
