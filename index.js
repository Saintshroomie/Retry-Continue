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
    debugMode: false,
};

let extensionSettings = { ...defaultSettings };

// ─── State Persistence ───────────────────────────────────────────────

function saveRetryState() {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) {
        debug('saveRetryState: no chatMetadata, skipping');
        return;
    }
    debug('saveRetryState:', { active: retryState.active, messageId: retryState.messageId, retryCount: retryState.retryCount, snapshotLength: retryState.snapshotText.length });
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
        debug('loadRetryState: restoring saved state', { messageId: saved.messageId, retryCount: saved.retryCount, snapshotLength: saved.snapshotText?.length });
        retryState = { ...saved };
    } else {
        debug('loadRetryState: no saved state, resetting');
        resetRetryState();
    }
    updateButtonVisuals();
    updateMessageIndicator();
}

function resetRetryState() {
    debug('resetRetryState: clearing all state | old: { active:', retryState.active, ', messageId:', retryState.messageId, ', snapshotLength:', retryState.snapshotText?.length ?? 0, ', retryCount:', retryState.retryCount, '}');
    retryState = {
        active: false,
        messageId: null,
        snapshotText: '',
        retryCount: 0,
    };
}

// ─── Debug Logger ────────────────────────────────────────────────────

function debug(...args) {
    if (!extensionSettings.debugMode) return;
    console.log('RETRY-CONTINUE:', ...args);
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
    debug('doRetry: invoked');
    const context = SillyTavern.getContext();
    const chat = context.chat;

    // Guard: must have messages
    if (!chat || chat.length === 0) {
        debug('doRetry: no messages in chat, aborting');
        toast('No messages in chat.', 'warning');
        return;
    }

    const lastMsg = chat[chat.length - 1];
    if (!lastMsg) {
        debug('doRetry: lastMsg is falsy, aborting');
        return;
    }

    // Guard: no generation in progress
    if (context.isGenerating) {
        debug('doRetry: generation in progress, aborting');
        toast('Cannot retry while generation is in progress.', 'warning');
        return;
    }

    const lastMsgIndex = chat.length - 1;
    debug('doRetry: lastMsgIndex =', lastMsgIndex, '| is_user =', lastMsg.is_user, '| retryState.active =', retryState.active);

    if (!retryState.active) {
        // First retry: establish snapshot
        debug('doRetry: first retry — setting checkpoint',
            '| old: { active:', retryState.active, ', messageId:', retryState.messageId, ', snapshotLength:', retryState.snapshotText?.length ?? 0, ', retryCount:', retryState.retryCount, '}',
            '| new: { active: true, messageId:', lastMsgIndex, ', snapshotLength:', lastMsg.mes.length, ', retryCount: 0 }');
        retryState.active = true;
        retryState.messageId = lastMsgIndex;
        retryState.snapshotText = lastMsg.mes;
        retryState.retryCount = 0;
        saveRetryState();
        toast(lastMsg.is_user ? 'User message checkpoint set — continuing...' : 'Retry checkpoint set.');
    } else {
        // Subsequent retry: validate snapshot still applies
        if (retryState.messageId !== lastMsgIndex) {
            debug('doRetry: messageId mismatch — expected', retryState.messageId, 'but got', lastMsgIndex, ', resetting');
            toast('Message context has changed. Resetting retry checkpoint.', 'warning');
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
            return;
        }
        debug('doRetry: subsequent retry — checkpoint still valid');
    }

    retryState.retryCount++;
    debug('doRetry: retryCount incremented to', retryState.retryCount);
    saveRetryState();
    updateButtonVisuals();

    await createSnapshotSwipeAndContinue(lastMsg, lastMsgIndex);
}

// ─── Swipe Creation & Continue ───────────────────────────────────────

async function createSnapshotSwipeAndContinue(lastMsg, lastMsgIndex) {
    debug('createSnapshotSwipeAndContinue: msgIndex =', lastMsgIndex);
    const context = SillyTavern.getContext();

    // Ensure the message has a swipes array
    if (!lastMsg.swipes) {
        debug('createSnapshotSwipeAndContinue: initializing swipes array');
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
    debug('createSnapshotSwipeAndContinue: created swipe', newSwipeIndex, '| total swipes =', lastMsg.swipes.length);

    // Re-render the message to reflect the new swipe
    await reRenderMessage(lastMsgIndex);

    // Persist the chat
    await context.saveChat();
    debug('createSnapshotSwipeAndContinue: chat saved');

    // Update message indicator
    updateMessageIndicator();

    // Trigger Continue to generate from the snapshot
    toast('Retrying from checkpoint...');
    snapshotLocked = true;
    debug('createSnapshotSwipeAndContinue: snapshotLocked = true, triggering continue');
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
        debug('triggerContinue: using slash command /continue');
        await context.executeSlashCommandsWithOptions('/continue');
        return;
    }

    // Approach 2: Click the Continue button
    const continueButton = document.getElementById('option_continue');
    if (continueButton) {
        debug('triggerContinue: falling back to button click');
        continueButton.click();
        return;
    }

    debug('triggerContinue: no continue method available');
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
                <label class="checkbox_label">
                    <input id="retry_debug_mode" type="checkbox" />
                    <span>Debug mode (verbose console logging)</span>
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

    const debugCheck = document.getElementById('retry_debug_mode');
    if (debugCheck) {
        debugCheck.checked = extensionSettings.debugMode;
        debugCheck.addEventListener('change', () => {
            extensionSettings.debugMode = debugCheck.checked;
            saveExtensionSettings();
            console.log('RETRY-CONTINUE: Debug mode', extensionSettings.debugMode ? 'enabled' : 'disabled');
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

function autoSetCheckpointOnContinue() {
    debug('autoSetCheckpointOnContinue: invoked | autoSetOnContinue =', extensionSettings.autoSetOnContinue, '| retryState.active =', retryState.active);
    if (!extensionSettings.autoSetOnContinue) return;
    if (retryState.active) {
        debug('autoSetCheckpointOnContinue: already have a checkpoint, skipping');
        return;
    }

    const context = SillyTavern.getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;

    const lastMsg = chat[chat.length - 1];
    if (!lastMsg) return;

    debug('autoSetCheckpointOnContinue: auto-setting checkpoint',
        '| old: { active:', retryState.active, ', messageId:', retryState.messageId, ', snapshotLength:', retryState.snapshotText?.length ?? 0, ', retryCount:', retryState.retryCount, '}',
        '| new: { active: true, messageId:', chat.length - 1, ', snapshotLength:', lastMsg.mes.length, ', retryCount: 0 }');
    retryState.active = true;
    retryState.messageId = chat.length - 1;
    retryState.snapshotText = lastMsg.mes;
    retryState.retryCount = 0;
    snapshotLocked = true;
    saveRetryState();
    updateButtonVisuals();
    updateMessageIndicator();
    toast('Retry checkpoint auto-set from Continue.');
}

function hookAutoContinue() {
    // Hook the hamburger menu Continue button
    const continueButton = document.getElementById('option_continue');
    if (continueButton) {
        continueButton.addEventListener('click', () => autoSetCheckpointOnContinue());
    }

    // Hook the quick Continue button in the right send form
    const rightSendForm = document.getElementById('rightSendForm');
    if (rightSendForm) {
        const quickContinueBtn = rightSendForm.querySelector('#stscript_continue');
        if (quickContinueBtn) {
            quickContinueBtn.addEventListener('click', () => autoSetCheckpointOnContinue());
        }
    }
}

// ─── Event Subscriptions ─────────────────────────────────────────────

function subscribeToEvents() {
    const context = SillyTavern.getContext();
    const eventSource = context.eventSource;
    const eventTypes = context.eventTypes;

    // Chat switched — load saved state
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        debug('event: CHAT_CHANGED');
        loadRetryState();
    });

    // User sends a new message — clear snapshot.
    // Skip if a user-message retry is currently in progress (snapshotLocked),
    // since the continue may cause the user message to re-render.
    eventSource.on(eventTypes.USER_MESSAGE_RENDERED, () => {
        debug('event: USER_MESSAGE_RENDERED | retryState.active =', retryState.active, '| snapshotLocked =', snapshotLocked);
        if (retryState.active && snapshotLocked) {
            debug('event: USER_MESSAGE_RENDERED — skipping (snapshotLocked)');
            return;
        }
        if (retryState.active) {
            debug('event: USER_MESSAGE_RENDERED — clearing checkpoint (new user message)');
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
        }
    });

    // Character generates a message — clear only if it's a NEW message (not Continue)
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, () => {
        debug('event: CHARACTER_MESSAGE_RENDERED | retryState.active =', retryState.active);
        if (!retryState.active) return;

        const ctx = SillyTavern.getContext();
        const currentLastIndex = ctx.chat.length - 1;

        if (currentLastIndex !== retryState.messageId) {
            // A new message was added — conversation moved on
            debug('event: CHARACTER_MESSAGE_RENDERED — new message detected (lastIndex =', currentLastIndex, ', checkpoint =', retryState.messageId, '), clearing');
            resetRetryState();
            saveRetryState();
            updateButtonVisuals();
            updateMessageIndicator();
        } else {
            debug('event: CHARACTER_MESSAGE_RENDERED — same message (continue), keeping checkpoint');
        }
    });

    // Message edited — update snapshot if it's the snapshotted message
    // Skip if snapshot is locked (edit came from generation, not the user)
    eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
        debug('event: MESSAGE_EDITED | messageId =', messageId, '| snapshotLocked =', snapshotLocked, '| isGenerating =', SillyTavern.getContext().isGenerating);
        if (snapshotLocked) {
            debug('event: MESSAGE_EDITED — skipping (snapshotLocked)');
            return;
        }
        const ctx = SillyTavern.getContext();
        if (ctx.isGenerating) {
            debug('event: MESSAGE_EDITED — skipping (isGenerating)');
            return;
        }
        if (retryState.active && parseInt(messageId) === retryState.messageId) {
            const msg = ctx.chat[retryState.messageId];
            if (msg) {
                debug('event: MESSAGE_EDITED — updating snapshot to edited text, length =', msg.mes.length);
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
        debug('event: MESSAGE_RECEIVED — scheduling snapshotLocked = false (1000ms delay)');
        setTimeout(() => {
            snapshotLocked = false;
            debug('event: MESSAGE_RECEIVED — snapshotLocked = false (after delay)');
        }, 1000);
        updateButtonVisuals();
        updateMessageIndicator();
        showQuickRetryButton();
    });

    // Hide the quick-action Retry button while generation is active
    if (eventTypes.GENERATION_STARTED) {
        eventSource.on(eventTypes.GENERATION_STARTED, () => {
            debug('event: GENERATION_STARTED — hiding quick button');
            hideQuickRetryButton();
        });
    }

    // Show the quick-action Retry button when generation ends
    if (eventTypes.GENERATION_ENDED) {
        eventSource.on(eventTypes.GENERATION_ENDED, () => {
            debug('event: GENERATION_ENDED — showing quick button');
            showQuickRetryButton();
        });
    }
}

// ─── Initialization ──────────────────────────────────────────────────

function init() {
    loadExtensionSettings();
    debug('init: settings loaded', { ...extensionSettings });
    addRetryButton();
    addQuickRetryButton();
    addSettingsPanel();
    registerSlashCommands();
    hookAutoContinue();
    subscribeToEvents();
    loadRetryState();
    debug('init: complete');
}

jQuery(async () => {
    init();
});
