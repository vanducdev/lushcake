"use strict";
/**
 * TelegramBotIngressService.ts — Unified Bot API update ingress
 *
 * Owns exactly ONE getUpdates loop per bot token (TG-015 fix).
 * Persists offset to DB for durable idempotency.
 * Parses ALL Bot API update types and fans out to registered consumers.
 * Does NOT advance the durable cursor after a consumer error (TG-016 fix).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBot = startBot;
exports.stopBot = stopBot;
exports.registerConsumer = registerConsumer;
exports.unregisterConsumer = unregisterConsumer;
exports.isPolling = isPolling;
exports.getActivePollers = getActivePollers;
exports.isPollerRunning = isPollerRunning;
exports.hasPollingConflict = hasPollingConflict;
exports.stopAll = stopAll;
exports.validateBotToken = validateBotToken;
const axios_1 = __importDefault(require("axios"));
const crypto = __importStar(require("crypto"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const TELEGRAM_API = 'https://api.telegram.org';
const POLL_INTERVAL_MS = 2000;
const LONG_POLL_TIMEOUT = 25; // seconds
const REQUEST_TIMEOUT_MS = 35000; // slightly longer than long-poll
// ─── Internal state ─────────────────────────────────────────────────────────
/** tokenHash → poller (one loop per token) */
const activePollers = new Map();
/** accountId → tokenHash (reverse lookup) */
const accountIdToTokenHash = new Map();
/** Accounts whose token is currently polled by another process. Kept outside
 * the active poller map so the health check cannot immediately restart them. */
const pollingConflicts = new Map();
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}
// ─── Message normalizer ─────────────────────────────────────────────────────
function normalizeMessage(raw) {
    if (!raw)
        return undefined;
    const chatId = String(raw.chat?.id || '');
    const fromId = String(raw.from?.id || '');
    const fromName = [raw.from?.first_name, raw.from?.last_name].filter(Boolean).join(' ') || fromId;
    const chatType = raw.chat?.type || 'private';
    const text = raw.text || raw.caption || '';
    const date = (raw.date || 0) * 1000;
    const messageId = String(raw.message_id || '');
    let isCommand = false;
    let command = '';
    let commandArgs = '';
    if (text.startsWith('/')) {
        const parts = text.split(/\s+/);
        command = parts[0].toLowerCase();
        const atIndex = command.indexOf('@');
        if (atIndex > 0)
            command = command.substring(0, atIndex);
        commandArgs = parts.slice(1).join(' ');
        isCommand = true;
    }
    return { messageId, chatId, chatType, fromId, fromName, text, date, isCommand, command, commandArgs, raw };
}
// ─── Update normalizer ──────────────────────────────────────────────────────
function normalizeUpdate(raw) {
    const updateId = raw.update_id || 0;
    let kind = 'unknown';
    if (raw.message)
        kind = 'message';
    else if (raw.edited_message)
        kind = 'edited_message';
    else if (raw.channel_post)
        kind = 'channel_post';
    else if (raw.edited_channel_post)
        kind = 'edited_channel_post';
    else if (raw.callback_query)
        kind = 'callback_query';
    else if (raw.my_chat_member)
        kind = 'my_chat_member';
    else if (raw.chat_member)
        kind = 'chat_member';
    else if (raw.message_reaction)
        kind = 'message_reaction';
    else if (raw.message_reaction_count)
        kind = 'message_reaction_count';
    else if (raw.poll)
        kind = 'poll';
    else if (raw.poll_answer)
        kind = 'poll_answer';
    else if (raw.chat_join_request)
        kind = 'chat_join_request';
    const result = { updateId, kind, raw };
    switch (kind) {
        case 'message':
            result.message = normalizeMessage(raw.message);
            break;
        case 'edited_message':
            result.editedMessage = normalizeMessage(raw.edited_message);
            break;
        case 'channel_post':
            result.message = normalizeMessage(raw.channel_post);
            break;
        case 'edited_channel_post':
            result.editedMessage = normalizeMessage(raw.edited_channel_post);
            break;
        case 'callback_query':
            result.callbackQuery = raw.callback_query;
            break;
        case 'my_chat_member':
        case 'chat_member':
            result.chatMember = raw.my_chat_member || raw.chat_member;
            break;
        case 'message_reaction':
            result.messageReaction = raw.message_reaction;
            break;
        case 'message_reaction_count':
            result.messageReactionCount = raw.message_reaction_count;
            break;
        case 'poll':
            result.poll = raw.poll;
            break;
        case 'poll_answer':
            result.pollAnswer = raw.poll_answer;
            break;
        case 'chat_join_request':
            result.chatJoinRequest = raw.chat_join_request;
            break;
    }
    return result;
}
// ─── Polling loop ───────────────────────────────────────────────────────────
async function pollLoop(poller) {
    if (!poller.running)
        return;
    try {
        const res = await axios_1.default.get(`${TELEGRAM_API}/bot${poller.primaryAccount.botToken}/getUpdates`, {
            params: {
                offset: poller.offset,
                limit: 100,
                timeout: LONG_POLL_TIMEOUT,
                allowed_updates: JSON.stringify([
                    'message', 'edited_message', 'channel_post', 'edited_channel_post',
                    'callback_query', 'my_chat_member', 'chat_member',
                    'message_reaction', 'message_reaction_count',
                    'poll', 'poll_answer', 'chat_join_request',
                ]),
            },
            timeout: REQUEST_TIMEOUT_MS,
        });
        const updates = res.data?.result || [];
        if (updates.length > 0) {
            Logger_1.default.log(`[BotIngress] Received ${updates.length} updates for ${poller.primaryAccount.accountId} (offset=${poller.offset})`);
            let anyConsumerFailed = false;
            // Track completed consumers per update_id for idempotent retry.
            // Key: `${updateId}:${accountId}:${consumerIndex}` → true
            // This ensures that when a batch is retried after partial failure,
            // consumers that already succeeded are not re-invoked.
            if (!poller._completedConsumers)
                poller._completedConsumers = new Map();
            // Fan out each update to all registered consumers
            for (const rawUpdate of updates) {
                const normalized = normalizeUpdate(rawUpdate);
                for (const [accountId, consumers] of poller.consumers) {
                    // Find the account object for this accountId
                    const account = accountId === poller.primaryAccount.accountId
                        ? poller.primaryAccount
                        : { ...poller.primaryAccount, accountId };
                    for (let ci = 0; ci < consumers.length; ci++) {
                        const completionKey = `${normalized.updateId}:${accountId}:${ci}`;
                        // Skip if this consumer already succeeded for this update
                        if (poller._completedConsumers.get(completionKey))
                            continue;
                        try {
                            await consumers[ci](account, normalized);
                            // Mark as completed — will not re-run on retry
                            poller._completedConsumers.set(completionKey, true);
                        }
                        catch (err) {
                            Logger_1.default.warn(`[BotIngress] Consumer error for ${accountId} update ${normalized.updateId}: ${err.message}`);
                            anyConsumerFailed = true;
                        }
                    }
                }
            }
            // Only advance offset when ALL consumers succeeded (TG-016)
            if (!anyConsumerFailed) {
                const newOffset = updates[updates.length - 1].update_id + 1;
                poller.offset = newOffset;
                // Clear completed tracking — batch fully done
                poller._completedConsumers.clear();
                // Persist to DB
                try {
                    const db = DatabaseService_1.default.getInstance();
                    if (db)
                        db.setBotCursor(poller.tokenHash, newOffset);
                }
                catch (err) {
                    Logger_1.default.warn(`[BotIngress] Failed to persist offset for ${poller.tokenHash}: ${err.message}`);
                }
            }
            else {
                Logger_1.default.warn(`[BotIngress] Not advancing offset for ${poller.tokenHash} due to consumer failure; will retry failed consumers only`);
            }
        }
    }
    catch (err) {
        if (err.response?.status === 409) {
            Logger_1.default.warn(`[BotIngress] 409 Conflict for token ${poller.tokenHash} — another consumer is polling this token. Stopping.`);
            for (const accountId of poller.accountIds) {
                pollingConflicts.set(accountId, poller.tokenHash);
                try {
                    const { EventBroadcaster } = require('../event/EventBroadcaster');
                    EventBroadcaster.emit('event:disconnected', {
                        zaloId: accountId,
                        reason: 'bot_poll_conflict',
                    });
                }
                catch { }
            }
            stopPollerByTokenHash(poller.tokenHash);
            return;
        }
        Logger_1.default.warn(`[BotIngress] Poll error ${poller.tokenHash}: ${err.message}`);
        // If it's a persistent error (401 Unauthorized, 404 Not Found), stop polling
        // and emit disconnect event for all registered accounts
        if (err.response?.status === 401 || err.response?.status === 404) {
            Logger_1.default.warn(`[BotIngress] Fatal error ${err.response.status} for token ${poller.tokenHash} — stopping poller`);
            for (const accountId of poller.accountIds) {
                try {
                    const { EventBroadcaster } = require('../event/EventBroadcaster');
                    EventBroadcaster.emit('event:disconnected', {
                        zaloId: accountId,
                        reason: err.response?.status === 401 ? 'token_invalid' : 'bot_not_found',
                    });
                }
                catch { }
            }
            stopPollerByTokenHash(poller.tokenHash);
            return;
        }
    }
    if (poller.running) {
        poller.timer = setTimeout(() => pollLoop(poller), POLL_INTERVAL_MS);
    }
}
// ─── Internal helpers ───────────────────────────────────────────────────────
function stopPollerByTokenHash(tokenHash) {
    const poller = activePollers.get(tokenHash);
    if (!poller)
        return;
    poller.running = false;
    if (poller.timer)
        clearTimeout(poller.timer);
    // Clean up reverse lookup for all accountIds
    for (const id of poller.accountIds) {
        accountIdToTokenHash.delete(id);
    }
    activePollers.delete(tokenHash);
    Logger_1.default.log(`[BotIngress] Stopped poller for token ${tokenHash}`);
}
// ─── Public API ─────────────────────────────────────────────────────────────
/**
 * Start ingress polling for a bot account.
 * If a poller for the same token already exists, just registers the accountId
 * without starting a second getUpdates loop (TG-015 fix).
 */
function startBot(account) {
    const tokenHash = hashToken(account.botToken);
    if (pollingConflicts.get(account.accountId) === tokenHash) {
        Logger_1.default.warn(`[BotIngress] Polling remains paused for ${account.accountId}: Telegram reported another getUpdates consumer. Stop the other consumer or restart after it is removed.`);
        return false;
    }
    const existingPoller = activePollers.get(tokenHash);
    if (existingPoller) {
        // Token already polled — just register this accountId
        existingPoller.accountIds.add(account.accountId);
        accountIdToTokenHash.set(account.accountId, tokenHash);
        if (!existingPoller.consumers.has(account.accountId)) {
            existingPoller.consumers.set(account.accountId, []);
        }
        Logger_1.default.log(`[BotIngress] Reusing existing poller for ${account.accountId} (@${account.botUsername}) on token ${tokenHash}`);
        return true;
    }
    // New token — start a new poller
    const db = DatabaseService_1.default.getInstance();
    const savedOffset = db ? db.getBotCursor(tokenHash) : 0;
    const poller = {
        tokenHash,
        accountIds: new Set([account.accountId]),
        primaryAccount: account,
        offset: savedOffset,
        running: true,
        timer: null,
        consumers: new Map([[account.accountId, []]]),
    };
    activePollers.set(tokenHash, poller);
    accountIdToTokenHash.set(account.accountId, tokenHash);
    Logger_1.default.log(`[BotIngress] Started poller for ${account.accountId} (@${account.botUsername}) offset=${savedOffset}`);
    pollLoop(poller);
    return true;
}
/**
 * Stop ingress polling for a bot account.
 * Only stops the poller when ALL accountIds for this token are removed.
 */
function stopBot(accountId) {
    pollingConflicts.delete(accountId);
    const tokenHash = accountIdToTokenHash.get(accountId);
    if (!tokenHash)
        return;
    const poller = activePollers.get(tokenHash);
    if (!poller)
        return;
    poller.accountIds.delete(accountId);
    poller.consumers.delete(accountId);
    accountIdToTokenHash.delete(accountId);
    if (poller.accountIds.size === 0) {
        // No more consumers — stop the poller
        poller.running = false;
        if (poller.timer)
            clearTimeout(poller.timer);
        activePollers.delete(tokenHash);
        Logger_1.default.log(`[BotIngress] Stopped poller for token ${tokenHash} (no remaining accounts)`);
    }
    else {
        Logger_1.default.log(`[BotIngress] Removed ${accountId} from poller ${tokenHash}; ${poller.accountIds.size} accounts remain`);
    }
}
/**
 * Register a consumer that receives all updates for a bot account.
 * Multiple consumers can be registered (inbox handler + workflow trigger).
 */
function registerConsumer(accountId, consumer) {
    const tokenHash = accountIdToTokenHash.get(accountId);
    if (!tokenHash) {
        Logger_1.default.warn(`[BotIngress] Cannot register consumer — no active poller for ${accountId}`);
        return;
    }
    const poller = activePollers.get(tokenHash);
    if (!poller)
        return;
    const consumers = poller.consumers.get(accountId) || [];
    if (!consumers.includes(consumer)) {
        consumers.push(consumer);
        poller.consumers.set(accountId, consumers);
    }
}
/**
 * Unregister a consumer from a bot account.
 */
function unregisterConsumer(accountId, consumer) {
    const tokenHash = accountIdToTokenHash.get(accountId);
    if (!tokenHash)
        return;
    const poller = activePollers.get(tokenHash);
    if (!poller)
        return;
    const consumers = poller.consumers.get(accountId) || [];
    poller.consumers.set(accountId, consumers.filter(c => c !== consumer));
}
/**
 * Check if a bot token is currently being polled.
 * Accepts either an accountId or looks up the token hash directly.
 */
function isPolling(accountId) {
    const tokenHash = accountIdToTokenHash.get(accountId);
    return tokenHash ? activePollers.has(tokenHash) : false;
}
/**
 * Get status of all active pollers.
 */
function getActivePollers() {
    return Array.from(activePollers.values()).map(p => ({
        accountId: p.primaryAccount.accountId,
        botUsername: p.primaryAccount.botUsername,
        offset: p.offset,
        consumerCount: Array.from(p.consumers.values()).reduce((sum, c) => sum + c.length, 0),
        accountIds: Array.from(p.accountIds),
    }));
}
/**
 * Check if a poller is running for the given accountId.
 */
function isPollerRunning(accountId) {
    const tokenHash = accountIdToTokenHash.get(accountId);
    if (!tokenHash)
        return false;
    const poller = activePollers.get(tokenHash);
    return !!poller?.running;
}
/** True when Telegram rejected this process because another getUpdates loop owns the token. */
function hasPollingConflict(accountId) {
    return pollingConflicts.has(accountId);
}
/**
 * Stop all pollers. Called on app shutdown.
 */
function stopAll() {
    for (const tokenHash of Array.from(activePollers.keys())) {
        stopPollerByTokenHash(tokenHash);
    }
}
/**
 * Validate bot token via getMe.
 */
async function validateBotToken(botToken) {
    try {
        const res = await axios_1.default.get(`${TELEGRAM_API}/bot${botToken}/getMe`, { timeout: 10000 });
        if (res.data?.ok) {
            return { success: true, bot: res.data.result };
        }
        return { success: false, error: 'Token không hợp lệ' };
    }
    catch (err) {
        return { success: false, error: err.response?.data?.description || err.message };
    }
}
//# sourceMappingURL=TelegramBotIngressService.js.map