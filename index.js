/*
 * Retry Continue — SillyTavern Extension
 *
 * Adds a Retry button that saves a message snapshot (checkpoint) and creates
 * new swipes by continuing from that snapshot. Each retry attempt becomes a
 * separate swipe so the user can browse results with ST's native swipe arrows.
 */

// In-memory retry state
let retryState = {
    active: false,
    messageId: null,
    snapshotText: '',
    retryCount: 0,
};

// Guard flag: when true, MESSAGE_EDITED will not overwrite the snapshot.
// This prevents continue/generation from silently updating the checkpoint.
let snapshotLocked = false;

// Extension settings with defaults
const defaultSettings = {
    autoSetOnContinue: false,
    showToasts: true,
    indicatorStyle: 'border', // 'border' | 'icon' | 'none'
};

let extensionSettings = { ...defaultSettings };

// ─── State Persistence ───────────────────────────────────────────────

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

function loadRetryState() {
    const context = SillyTavern.getContext();
    const saved = context.chatMetadata?.retryContinue;
    if (saved && saved.active) {
        retryState = { ...saved };
    } else {
        resetRetryState();
    }
    updateButtonVisuals();
    updateMessageIndicator();
}

function resetRetryState() {
    retryState = {
        active: false,
        messageId: null,
        snapshotText: '',
        retryCount: 0,
    };
}

// ─── Toast Helper ────────────────────────────────────────────────────

function toast(message, type = 'info') {
    if (!extensionSettings.showToasts) return;
    if (typeof toastr !== 'undefined' && toastr[type]) {
        toastr[type](message);
    }
}

// ─── Core Retry Logic ────────────────────────────────────────────────

async function doRetry() {
    const context = SillyTavern.getContext();
    const chat = context.chat;

    // Guard: must have messages
    if (!chat || chat.length === 0) {
        toast('No messages in chat.', 'warning');
        return;
    }

    const lastMsg = chat[chat.length - 1];
    if (!lastMsg) return;

    // Guard: no generation in progress
    if (context.isGenerating) {
        toast('Cannot retry while generation is in progress.', 'warning');
        return;
    }

    const lastMsgIndex = chat.length - 1;

    if (!retryState.active) {
        // First retry: establish snapshot
        retryState.active = true;
        retryState.messageId = lastMsgIndex;
        retryState.snapshotText = lastMsg.mes;
        retryState.retryCount = 0;
        saveRetryState();
        toast(lastMsg.is_user ? 'User message checkpoint set — continuing...' : 'Retry checkpoint set.');
    } else {
        // Subsequent retry: validate snapshot still applies
        if (retryState.messageId !== lastMsgIndex) {
            toast('Message context has changed. Resetting retry checkpoint.', 'warning');
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
            return;
        }
    }

    retryState.retryCount++;
    saveRetryState();
    updateButtonVisuals();

    await createSnapshotSwipeAndContinue(lastMsg, lastMsgIndex);
}

// ─── Swipe Creation & Continue ───────────────────────────────────────

async function createSnapshotSwipeAndContinue(lastMsg, lastMsgIndex) {
    const context = SillyTavern.getContext();

    // Ensure the message has a swipes array
    if (!lastMsg.swipes) {
        lastMsg.swipes = [lastMsg.mes];
        lastMsg.swipe_id = 0;
        lastMsg.swipe_info = [{}];
    }

    // Add a new swipe with the snapshot text
    lastMsg.swipes.push(retryState.snapshotText);
    lastMsg.swipe_info.push({});

    // Switch to the new swipe
    const newSwipeIndex = lastMsg.swipes.length - 1;
    lastMsg.swipe_id = newSwipeIndex;
    lastMsg.mes = retryState.snapshotText;

    // Re-render the message to reflect the new swipe
    await reRenderMessage(lastMsgIndex);

    // Persist the chat
    await context.saveChat();

    // Update message indicator
    updateMessageIndicator();

    // Trigger Continue to generate from the snapshot
    toast('Retrying from checkpoint...');
    snapshotLocked = true;
    await triggerContinue();
}

async function reRenderMessage(messageIndex) {
    const context = SillyTavern.getContext();
    const messageElement = document.querySelector(
        `#chat .mes[mesid="${messageIndex}"]`,
    );

    if (messageElement) {
        const textElement = messageElement.querySelector('.mes_text');
        const msg = context.chat[messageIndex];
        if (textElement && msg) {
            if (typeof context.messageFormatting === 'function') {
                textElement.innerHTML = context.messageFormatting(
                    msg.mes,
                    msg.name,
                    msg.is_system,
                    msg.is_user,
                    messageIndex,
                );
            } else {
                textElement.textContent = msg.mes;
            }
        }

        // Update swipe counter
        const swipeCountElement = messageElement.querySelector('.swipes-counter');
        if (swipeCountElement && msg && msg.swipes) {
            swipeCountElement.textContent = `${msg.swipe_id + 1}/${msg.swipes.length}`;
        }

        // Show swipe controls if they were hidden (single swipe → multiple)
        const swipeContainer = messageElement.querySelector('.swipe_right, .swipe_left');
        if (swipeContainer) {
            swipeContainer.style.display = '';
        }
    }
}

async function triggerContinue() {
    const context = SillyTavern.getContext();

    // Approach 1: Slash command system (most stable)
    if (context.executeSlashCommandsWithOptions) {
        await context.executeSlashCommandsWithOptions('/continue');
        return;
    }

    // Approach 2: Click the Continue button
    const continueButton = document.getElementById('option_continue');
    if (continueButton) {
        continueButton.click();
        return;
    }

    toast('Could not trigger Continue. Is the Continue button enabled?', 'error');
}

// ─── UI: Button ──────────────────────────────────────────────────────

function addRetryButton() {
    const sendForm = document.getElementById('send_form');
    if (!sendForm) return;

    // Don't add twice
    if (document.getElementById('option_retry_continue')) return;

    const retryButton = document.createElement('div');
    retryButton.id = 'option_retry_continue';
    retryButton.classList.add('list-group-item', 'interactable');
    retryButton.title = 'Retry Continue — regenerate from checkpoint';
    retryButton.tabIndex = 0;
    retryButton.setAttribute('data-i18n', 'Retry');
    retryButton.innerHTML = '<span class="fa-solid fa-arrow-rotate-right"></span> Retry';

    // Insert after the Continue button
    const continueButton = document.getElementById('option_continue');
    if (continueButton && continueButton.parentNode) {
        continueButton.parentNode.insertBefore(
            retryButton,
            continueButton.nextSibling,
        );
    } else {
        sendForm.appendChild(retryButton);
    }

    retryButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await doRetry();
    });
}

function addQuickRetryButton() {
    const rightSendForm = document.getElementById('rightSendForm');
    if (!rightSendForm) return;

    // Don't add twice
    if (document.getElementById('quick_retry_continue')) return;

    const quickBtn = document.createElement('div');
    quickBtn.id = 'quick_retry_continue';
    quickBtn.classList.add('fa-solid', 'fa-arrow-rotate-right', 'interactable');
    quickBtn.title = 'Retry Continue — regenerate from checkpoint';
    quickBtn.tabIndex = 0;

    rightSendForm.appendChild(quickBtn);

    quickBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await doRetry();
    });
}

// ─── UI: Button Visuals ──────────────────────────────────────────────

function updateButtonVisuals() {
    const buttons = [
        document.getElementById('option_retry_continue'),
        document.getElementById('quick_retry_continue'),
    ];

    for (const btn of buttons) {
        if (!btn) continue;
        if (retryState.active) {
            btn.classList.add('retry-active');
            btn.title = `Retry Continue (checkpoint active, ${retryState.retryCount} retries)`;
        } else {
            btn.classList.remove('retry-active');
            btn.title = 'Retry Continue — regenerate from checkpoint';
        }
    }
}

// ─── UI: Message Indicator ───────────────────────────────────────────

function updateMessageIndicator() {
    // Remove old indicators
    document.querySelectorAll('.retry-checkpoint-indicator').forEach((el) => el.remove());
    document.querySelectorAll('.mes.retry-checkpoint-border').forEach((el) => {
        el.classList.remove('retry-checkpoint-border');
    });

    if (!retryState.active || extensionSettings.indicatorStyle === 'none') return;

    const messageElement = document.querySelector(
        `#chat .mes[mesid="${retryState.messageId}"]`,
    );
    if (!messageElement) return;

    if (extensionSettings.indicatorStyle === 'border') {
        messageElement.classList.add('retry-checkpoint-border');
    } else if (extensionSettings.indicatorStyle === 'icon') {
        const nameBlock = messageElement.querySelector('.ch_name');
        if (nameBlock && !nameBlock.querySelector('.retry-checkpoint-indicator')) {
            const icon = document.createElement('span');
            icon.classList.add('retry-checkpoint-indicator', 'fa-solid', 'fa-bookmark');
            icon.title = 'Retry checkpoint active';
            nameBlock.appendChild(icon);
        }
    }
}

// ─── UI: Quick Button Visibility During Generation ──────────────────

function hideQuickRetryButton() {
    const quickBtn = document.getElementById('quick_retry_continue');
    if (quickBtn) quickBtn.style.display = 'none';
}

function showQuickRetryButton() {
    const quickBtn = document.getElementById('quick_retry_continue');
    if (quickBtn) quickBtn.style.display = '';
}

// ─── Settings Panel ──────────────────────────────────────────────────

function addSettingsPanel() {
    const settingsContainer = document.getElementById('extensions_settings');
    if (!settingsContainer) return;

    const html = `
    <div id="retry_continue_settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Retry Continue</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="retry_auto_continue" type="checkbox" />
                    <span>Auto-set checkpoint on Continue</span>
                </label>
                <label class="checkbox_label">
                    <input id="retry_show_toasts" type="checkbox" />
                    <span>Show toast notifications</span>
                </label>
                <label>
                    Checkpoint indicator style:
                    <select id="retry_indicator_style" class="text_pole">
                        <option value="border">Border</option>
                        <option value="icon">Icon</option>
                        <option value="none">None</option>
                    </select>
                </label>
                <div class="menu_button" id="retry_clear_checkpoint">
                    Clear Retry Checkpoint
                </div>
            </div>
        </div>
    </div>`;

    settingsContainer.insertAdjacentHTML('beforeend', html);

    // Bind controls
    const autoCheck = document.getElementById('retry_auto_continue');
    const toastCheck = document.getElementById('retry_show_toasts');
    const styleSelect = document.getElementById('retry_indicator_style');
    const clearBtn = document.getElementById('retry_clear_checkpoint');

    if (autoCheck) {
        autoCheck.checked = extensionSettings.autoSetOnContinue;
        autoCheck.addEventListener('change', () => {
            extensionSettings.autoSetOnContinue = autoCheck.checked;
            saveExtensionSettings();
        });
    }

    if (toastCheck) {
        toastCheck.checked = extensionSettings.showToasts;
        toastCheck.addEventListener('change', () => {
            extensionSettings.showToasts = toastCheck.checked;
            saveExtensionSettings();
        });
    }

    if (styleSelect) {
        styleSelect.value = extensionSettings.indicatorStyle;
        styleSelect.addEventListener('change', () => {
            extensionSettings.indicatorStyle = styleSelect.value;
            saveExtensionSettings();
            updateMessageIndicator();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
            toast('Retry checkpoint cleared.');
        });
    }
}

function loadExtensionSettings() {
    const context = SillyTavern.getContext();
    const saved = context.extensionSettings?.retryContinue;
    if (saved) {
        extensionSettings = { ...defaultSettings, ...saved };
    }
}

function saveExtensionSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings) return;
    context.extensionSettings.retryContinue = { ...extensionSettings };
    context.saveSettings();
}

// ─── Slash Commands ──────────────────────────────────────────────────

function registerSlashCommands() {
    const context = SillyTavern.getContext();
    if (!context.registerSlashCommand) return;

    context.registerSlashCommand(
        'retry',
        async () => {
            await doRetry();
            return '';
        },
        [],
        'Retry the continuation from the saved checkpoint. If no checkpoint exists, sets one from the current message state and continues.',
        true,
        true,
    );

    context.registerSlashCommand(
        'retryclear',
        () => {
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
            return 'Retry checkpoint cleared.';
        },
        [],
        'Clear the active retry checkpoint.',
        false,
        true,
    );
}

// ─── Auto-Set on Continue (optional feature) ─────────────────────────

function hookAutoContinue() {
    const continueButton = document.getElementById('option_continue');
    if (!continueButton) return;

    continueButton.addEventListener('click', () => {
        if (!extensionSettings.autoSetOnContinue) return;
        if (retryState.active) return; // Already have a snapshot

        const context = SillyTavern.getContext();
        const chat = context.chat;
        if (!chat || chat.length === 0) return;

        const lastMsg = chat[chat.length - 1];
        if (!lastMsg) return;

        retryState.active = true;
        retryState.messageId = chat.length - 1;
        retryState.snapshotText = lastMsg.mes;
        retryState.retryCount = 0;
        snapshotLocked = true;
        saveRetryState();
        updateButtonVisuals();
        updateMessageIndicator();
        toast('Retry checkpoint auto-set from Continue.');
    });
}

// ─── Event Subscriptions ─────────────────────────────────────────────

function subscribeToEvents() {
    const context = SillyTavern.getContext();
    const eventSource = context.eventSource;
    const eventTypes = context.eventTypes;

    // Chat switched — load saved state
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        loadRetryState();
    });

    // User sends a new message — clear snapshot.
    // Skip if a user-message retry is currently in progress (snapshotLocked),
    // since the continue may cause the user message to re-render.
    eventSource.on(eventTypes.USER_MESSAGE_RENDERED, () => {
        if (retryState.active && snapshotLocked) return;
        if (retryState.active) {
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
        }
    });

    // Character generates a message — clear only if it's a NEW message (not Continue)
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, () => {
        if (!retryState.active) return;

        const ctx = SillyTavern.getContext();
        const currentLastIndex = ctx.chat.length - 1;

        if (currentLastIndex !== retryState.messageId) {
            // A new message was added — conversation moved on
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
        }
    });

    // Message edited — update snapshot if it's the snapshotted message
    // Skip if snapshot is locked (edit came from generation, not the user)
    eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
        if (snapshotLocked) return;
        const ctx = SillyTavern.getContext();
        if (ctx.isGenerating) return;
        if (retryState.active && parseInt(messageId) === retryState.messageId) {
            const msg = ctx.chat[retryState.messageId];
            if (msg) {
                retryState.snapshotText = msg.mes;
                saveRetryState();
                toast('Retry checkpoint updated to your edit.');
            }
        }
    });

    // After generation completes, unlock snapshot (with delay) and update visuals.
    // The delay ensures any post-generation MESSAGE_EDITED events are still
    // blocked, preventing the snapshot from being overwritten with the
    // completed (post-continue) text.
    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
        setTimeout(() => {
            snapshotLocked = false;
        }, 1000);
        updateButtonVisuals();
        updateMessageIndicator();
        showQuickRetryButton();
    });

    // Hide the quick-action Retry button while generation is active
    if (eventTypes.GENERATION_STARTED) {
        eventSource.on(eventTypes.GENERATION_STARTED, () => {
            hideQuickRetryButton();
        });
    }

    // Show the quick-action Retry button when generation ends
    if (eventTypes.GENERATION_ENDED) {
        eventSource.on(eventTypes.GENERATION_ENDED, () => {
            showQuickRetryButton();
        });
    }
}

// ─── Initialization ──────────────────────────────────────────────────

function init() {
    loadExtensionSettings();
    addRetryButton();
    addQuickRetryButton();
    addSettingsPanel();
    registerSlashCommands();
    hookAutoContinue();
    subscribeToEvents();
    loadRetryState();
}

jQuery(async () => {
    init();
});
