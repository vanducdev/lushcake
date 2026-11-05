"use strict";
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
const EventBroadcaster_1 = __importDefault(require("../event/EventBroadcaster"));
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const ConnectionManager_1 = __importDefault(require("../../utils/ConnectionManager"));
const AccountSendQueue_1 = __importDefault(require("./AccountSendQueue"));
const FacebookService_1 = require("../facebook/FacebookService");
const FacebookSendService_1 = require("../facebook/FacebookSendService");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const IntegrationRegistry_1 = __importDefault(require("../integrations/IntegrationRegistry"));
const TelegramUser = __importStar(require("../telegram/TelegramUserListener"));
const TelegramBot = __importStar(require("../telegram/TelegramBotChannelService"));
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
const cron = __importStar(require("node-cron"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const googleapis_1 = require("googleapis");
const aiUtils_1 = require("../../utils/aiUtils");
const channelHelper_1 = require("../../ui/lib/channelHelper");
const zca_js_1 = require("zca-js");
const AIProviderAdapter_1 = require("../ai/AIProviderAdapter");
// Workflow versions before reaction keys were introduced stored the six picker
// options as numbers. Keep those workflows executable while sending the icon
// value that zca-js and Zalo actually accept.
const ZALO_WORKFLOW_REACTIONS = {
    '1': zca_js_1.Reactions.LIKE,
    '2': zca_js_1.Reactions.HEART,
    '3': zca_js_1.Reactions.HAHA,
    '4': zca_js_1.Reactions.WOW,
    '5': zca_js_1.Reactions.CRY,
    '6': zca_js_1.Reactions.ANGRY,
    LIKE: zca_js_1.Reactions.LIKE,
    HEART: zca_js_1.Reactions.HEART,
    HAHA: zca_js_1.Reactions.HAHA,
    WOW: zca_js_1.Reactions.WOW,
    CRY: zca_js_1.Reactions.CRY,
    ANGRY: zca_js_1.Reactions.ANGRY,
};
function resolveZaloWorkflowReaction(value) {
    const reaction = String(value ?? '').trim();
    if (!reaction)
        return null;
    return ZALO_WORKFLOW_REACTIONS[reaction.toUpperCase()]
        || (Object.values(zca_js_1.Reactions).includes(reaction) ? reaction : null);
}
/**
 * Extract only correlation metadata for the Telegram User supergroup/channel
 * ingress trace.  Never put the message body in this diagnostic: these lines
 * are deliberately easy for a user to copy from the Electron terminal.
 */
function getTelegramChannelTrace(data) {
    const envelope = data?.message || data || {};
    const msg = envelope?.data || data?.data || envelope || {};
    const channel = data?.channel || envelope?.channel || msg?.channel || '';
    const chatId = String(envelope?.threadId || data?.threadId || msg?.threadId || msg?.idTo || '');
    if (channel !== 'telegram_user' || !chatId.startsWith('-100'))
        return null;
    return {
        accountId: String(data?.zaloId || data?.accountId || ''),
        chatId,
        msgId: String(msg?.msgId || data?.msgId || ''),
        peerKind: msg?.isChannel ? 'channel' : 'supergroup_or_topic',
        msgType: String(msg?.msgType || ''),
        topicId: String(msg?.topicId || ''),
        isSelf: !!(envelope?.isSelf || data?.isSelf || msg?.isSelf),
    };
}
function logTelegramChannelTrace(stage, trace, extra = {}) {
    if (!trace)
        return;
    const fields = { ...trace, ...extra };
    const printable = Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${value}`);
    // Logger.log(`[TG:channel-workflow] ${stage} | ${printable.join(' ')}`);
}
// ─── Service ─────────────────────────────────────────────────────────────────
class WorkflowEngineService {
    constructor() {
        this.workflows = new Map();
        this.cronJobs = new Map();
        /** Debounce timers for trigger.message - key = workflowId:threadId */
        this.debounceTimers = new Map();
        /** Buffered message events for debounce - key = workflowId:threadId */
        this.debounceBuffers = new Map();
    }
    static getInstance() {
        if (!this.instance)
            this.instance = new WorkflowEngineService();
        return this.instance;
    }
    async initialize() {
        this.loadWorkflows();
        this.registerZaloEventListeners();
        this.registerFacebookEventListeners();
        this.registerTelegramEventListeners();
        this.registerCronJobs();
        // Sync Telegram bot pollers for trigger.telegramCommand
        try {
            const { syncPollers } = require('./TelegramBotPollingService');
            syncPollers();
        }
        catch { /* ignore if module not available */ }
        Logger_1.default.log(`[WorkflowEngine] Initialized - ${this.workflows.size} workflows loaded`);
    }
    normalizeWorkflowChannel(channel) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { normalizeChannel } = require('../../configs/channelConfig');
        // Legacy 'telegram' → default to 'telegram_user' (MTProto)
        if (channel === 'telegram')
            return 'telegram_user';
        return normalizeChannel(channel);
    }
    isRunnableWorkflow(wf) {
        const ch = this.normalizeWorkflowChannel(wf.channel);
        return ch === 'zalo' || ch === 'facebook' || ch === 'telegram_user' || ch === 'telegram_bot';
    }
    /**
     * Resolve Facebook account ID về internal UUID để tìm đúng instance trong FacebookService.
     * FacebookService.instances map dùng UUID làm key, nhưng workflow trigger gửi numeric FB UID.
     * Nếu không resolve, getInstance() sẽ tạo instance mới + connect() mất ~10s không cần thiết.
     */
    resolveFBAccountId(rawId) {
        if (!rawId)
            return '';
        // Nếu đã là UUID (có dấu gạch ngang) → trả về nguyên
        if (rawId.includes('-'))
            return rawId;
        // Nếu là Facebook UID (all digits) → tìm UUID từ DB
        if (/^\d+$/.test(rawId)) {
            try {
                const fbAcc = DatabaseService_1.default.getInstance().getFBAccountByFacebookId(rawId);
                if (fbAcc?.id)
                    return fbAcc.id;
            }
            catch { }
        }
        return rawId;
    }
    // ─── Load ─────────────────────────────────────────────────────────────────
    loadWorkflows() {
        const rows = DatabaseService_1.default.getInstance().getWorkflows();
        this.workflows.clear();
        for (const row of rows) {
            try {
                const pageIdsRaw = row.page_ids || row.page_id || '';
                const wf = {
                    id: row.id, name: row.name, description: row.description || '',
                    enabled: row.enabled === 1 || row.enabled === true,
                    channel: this.normalizeWorkflowChannel(row.channel),
                    pageId: pageIdsRaw.split(',').filter(Boolean)[0] || '',
                    pageIds: pageIdsRaw.split(',').filter(Boolean),
                    nodes: JSON.parse(row.nodes_json || '[]'),
                    edges: JSON.parse(row.edges_json || '[]'),
                    createdAt: row.created_at, updatedAt: row.updated_at,
                };
                this.workflows.set(wf.id, wf);
            }
            catch (e) {
                Logger_1.default.error(`[WorkflowEngine] Failed to parse workflow ${row.id}: ${e.message}`);
            }
        }
    }
    reloadWorkflow(workflowId) {
        const row = DatabaseService_1.default.getInstance().getWorkflowById(workflowId);
        if (!row) {
            this.workflows.delete(workflowId);
            this.unregisterCron(workflowId);
            return;
        }
        try {
            const pageIdsRaw = row.page_ids || row.page_id || '';
            const wf = {
                id: row.id, name: row.name, description: row.description || '',
                enabled: row.enabled === 1 || row.enabled === true,
                channel: this.normalizeWorkflowChannel(row.channel),
                pageId: pageIdsRaw.split(',').filter(Boolean)[0] || '',
                pageIds: pageIdsRaw.split(',').filter(Boolean),
                nodes: JSON.parse(row.nodes_json || '[]'),
                edges: JSON.parse(row.edges_json || '[]'),
                createdAt: row.created_at, updatedAt: row.updated_at,
            };
            this.workflows.set(wf.id, wf);
            this.unregisterCron(workflowId);
            if (wf.enabled && this.isRunnableWorkflow(wf))
                this.registerCronForWorkflow(wf);
            // Sync Telegram pollers when workflow is reloaded
            try {
                const { syncPollers } = require('./TelegramBotPollingService');
                syncPollers();
            }
            catch { /* ignore */ }
        }
        catch (e) {
            Logger_1.default.error(`[WorkflowEngine] reloadWorkflow ${workflowId}: ${e.message}`);
        }
    }
    removeWorkflow(workflowId) {
        this.workflows.delete(workflowId);
        this.unregisterCron(workflowId);
        // Clean up debounce timers/buffers for this workflow
        this.clearDebounceForWorkflow(workflowId);
        // Sync Telegram pollers when workflow is removed
        try {
            const { syncPollers } = require('./TelegramBotPollingService');
            syncPollers();
        }
        catch { /* ignore */ }
    }
    /** Clear all debounce timers and buffers whose key starts with workflowId: */
    clearDebounceForWorkflow(workflowId) {
        const prefix = workflowId + ':';
        for (const [key, timer] of this.debounceTimers) {
            if (key.startsWith(prefix)) {
                clearTimeout(timer);
                this.debounceTimers.delete(key);
                this.debounceBuffers.delete(key);
            }
        }
    }
    // ─── Event Listeners ──────────────────────────────────────────────────────
    registerZaloEventListeners() {
        const EVENT_MAP = {
            'event:message': 'trigger.message',
            'event:friendRequest': 'trigger.friendRequest',
            'event:groupEvent': 'trigger.groupEvent',
            'event:reaction': 'trigger.reaction',
            'event:undo': 'trigger.undo',
            'event:labelAssigned': 'trigger.labelAssigned',
            'integration:payment': 'trigger.payment',
        };
        for (const [channel, triggerType] of Object.entries(EVENT_MAP)) {
            EventBroadcaster_1.default.onBeforeSend(channel, (data) => {
                this.triggerWorkflows(triggerType, data);
            });
        }
    }
    /** Bridge Facebook events to workflow triggers */
    registerFacebookEventListeners() {
        // Simple 1:1 mapping for standalone Facebook events
        const SIMPLE_EVENTS = {
            'fb:onReaction': 'fb.trigger.reaction',
            'fb:onUnsend': 'fb.trigger.unsend',
            'fb:onGroupEvent': 'fb.trigger.groupEvent',
        };
        for (const [channel, triggerType] of Object.entries(SIMPLE_EVENTS)) {
            EventBroadcaster_1.default.onBeforeSend(channel, (data) => {
                this.triggerWorkflows(triggerType, data);
            });
        }
        // Message event - determine specific trigger type from attachment data
        EventBroadcaster_1.default.onBeforeSend('fb:onMessage', (data) => {
            // Always trigger the base text-message workflow
            this.triggerWorkflows('fb.trigger.message', data);
            // Route to media-specific triggers based on attachment type
            const msg = data?.message || {};
            const att = msg.attachments || {};
            const attType = (att.attachmentType || '').toLowerCase();
            if (attType === 'image' || attType === 'photo') {
                this.triggerWorkflows('fb.trigger.image', data);
            }
            else if (attType === 'video') {
                this.triggerWorkflows('fb.trigger.video', data);
            }
            else if (attType === 'file' || attType === 'audio') {
                this.triggerWorkflows('fb.trigger.file', data);
            }
            else if (attType === 'sticker') {
                this.triggerWorkflows('fb.trigger.sticker', data);
            }
        });
    }
    /** Bridge Telegram events to workflow triggers */
    registerTelegramEventListeners() {
        // Telegram messages come through the unified 'event:message' channel
        EventBroadcaster_1.default.onBeforeSend('event:message', (data) => {
            const ch = data?.channel || data?.message?.channel || data?.message?.data?.channel || data?.data?.channel;
            if (ch === 'telegram_user') {
                logTelegramChannelTrace('HOOK_RECEIVED', getTelegramChannelTrace(data));
                this.triggerWorkflows('tg.trigger.message', data);
            }
            if (ch === 'telegram_bot') {
                this.triggerWorkflows('tgbot.trigger.message', data);
                const msg = data?.message?.data || data?.data || {};
                if (/^\/[A-Za-z][\w-]*/.test(String(msg.content || data?.content || ''))) {
                    this.triggerWorkflows('tgbot.trigger.command', data);
                }
            }
        });
        // Telegram message deletes (unsend)
        EventBroadcaster_1.default.onBeforeSend('event:messagesDeleted', (data) => {
            this.triggerWorkflows('tg.trigger.unsend', data);
        });
        // Telegram group events
        EventBroadcaster_1.default.onBeforeSend('event:groupEvent', (data) => {
            if (data.channel === 'telegram_user') {
                this.triggerWorkflows('tg.trigger.groupEvent', data);
            }
        });
        // Bot inline keyboards are delivered as callback_query updates, not normal
        // messages. Route buttons intentionally resume a node in the *same*
        // workflow; they never start an unrelated workflow.
        EventBroadcaster_1.default.onBeforeSend('event:telegramBotCallback', (data) => {
            const callbackData = String(data?.callbackData || '');
            const route = callbackData.match(/^dlw:n:([a-zA-Z0-9_-]+)$/);
            if (route) {
                const routeId = route[1];
                for (const wf of this.workflows.values()) {
                    if (!wf.enabled || !this.isRunnableWorkflow(wf))
                        continue;
                    if (wf.pageIds.length && !wf.pageIds.includes(String(data.accountId || data.zaloId || '')))
                        continue;
                    const sender = wf.nodes.find(node => node.type === 'tgbot.action.sendMessage' &&
                        (node.config?.keyboard?.rows || []).some((row) => (Array.isArray(row) ? row : [row]).some((button) => button?.id === routeId && button?.action === 'node' && button?.targetNodeId)));
                    if (!sender)
                        continue;
                    const button = sender.config.keyboard.rows
                        .flat().find((item) => item?.id === routeId && item?.action === 'node');
                    if (button?.targetNodeId && wf.nodes.some(node => node.id === button.targetNodeId)) {
                        this.executeWorkflow(wf, data, 'tgbot.trigger.callback', button.targetNodeId).catch(err => Logger_1.default.error(`[WorkflowEngine] Telegram Bot inline route failed: ${err.message}`));
                        return;
                    }
                }
                Logger_1.default.warn(`[WorkflowEngine] Telegram Bot inline route not found: ${routeId}`);
                return;
            }
            this.triggerWorkflows('tgbot.trigger.callback', data);
        });
        EventBroadcaster_1.default.onBeforeSend('event:telegramBotMembership', (data) => {
            this.triggerWorkflows('tgbot.trigger.join', data);
        });
        EventBroadcaster_1.default.onBeforeSend('event:telegramBotEditedMessage', (data) => {
            this.triggerWorkflows('tgbot.trigger.editedMessage', data);
        });
        EventBroadcaster_1.default.onBeforeSend('event:telegramBotJoinRequest', (data) => {
            this.triggerWorkflows('tgbot.trigger.joinRequest', data);
        });
    }
    /**
     * Gọi từ main process khi renderer emit 'workflow:labelEvent'.
     * Bridge: renderer (ChatHeader) → ipcMain → engine.
     */
    triggerLabelEvent(data) {
        this.triggerWorkflows('trigger.labelAssigned', data);
    }
    // ─── Cron ─────────────────────────────────────────────────────────────────
    registerCronJobs() {
        for (const wf of this.workflows.values()) {
            if (wf.enabled && this.isRunnableWorkflow(wf))
                this.registerCronForWorkflow(wf);
        }
    }
    registerCronForWorkflow(wf) {
        if (!this.isRunnableWorkflow(wf))
            return;
        const scheduleNode = wf.nodes.find(n => n.type === 'trigger.schedule');
        if (!scheduleNode)
            return;
        const expr = scheduleNode.config.cronExpression || '';
        if (!expr || !cron.validate(expr))
            return;
        const tz = scheduleNode.config.timezone || 'Asia/Ho_Chi_Minh';
        const task = cron.schedule(expr, () => {
            this.executeWorkflow(wf, {}, 'trigger.schedule').catch(err => {
                Logger_1.default.error(`[WorkflowEngine] Cron error in "${wf.name}": ${err.message}`);
            });
        }, { timezone: tz });
        this.cronJobs.set(wf.id, task);
        Logger_1.default.log(`[WorkflowEngine] Cron registered for "${wf.name}" - ${expr}`);
    }
    unregisterCron(workflowId) {
        const job = this.cronJobs.get(workflowId);
        if (job) {
            job.stop();
            this.cronJobs.delete(workflowId);
        }
    }
    // ─── Trigger matching ─────────────────────────────────────────────────────
    triggerWorkflows(triggerType, eventData, targetWorkflowId) {
        const telegramChannelTrace = triggerType === 'tg.trigger.message'
            ? getTelegramChannelTrace(eventData)
            : null;
        logTelegramChannelTrace('TRIGGER_DISPATCH', telegramChannelTrace, {
            triggerType,
            loadedWorkflows: this.workflows.size,
        });
        for (const wf of this.workflows.values()) {
            if (targetWorkflowId && wf.id !== targetWorkflowId)
                continue;
            if (!wf.enabled) {
                logTelegramChannelTrace('WORKFLOW_SKIPPED', telegramChannelTrace, { workflowId: wf.id, reason: 'disabled' });
                continue;
            }
            if (!this.isRunnableWorkflow(wf)) {
                logTelegramChannelTrace('WORKFLOW_SKIPPED', telegramChannelTrace, { workflowId: wf.id, reason: 'unsupported_channel', workflowChannel: wf.channel || '-' });
                continue;
            }
            const triggerNode = wf.nodes.find(n => n.type === triggerType);
            if (!triggerNode) {
                logTelegramChannelTrace('WORKFLOW_SKIPPED', telegramChannelTrace, { workflowId: wf.id, reason: 'trigger_not_present' });
                continue;
            }
            // pageIds: rỗng = áp dụng cho tất cả; có giá trị = chỉ chạy cho page khớp
            if (wf.pageIds.length > 0) {
                const accountId = eventData.zaloId || eventData.fbAccountId || eventData.accountId || '';
                if (accountId && !wf.pageIds.includes(accountId)) {
                    logTelegramChannelTrace('WORKFLOW_SKIPPED', telegramChannelTrace, { workflowId: wf.id, reason: 'account_filter', configuredAccounts: wf.pageIds.join(',') });
                    continue;
                }
            }
            if (!this.matchesTriggerFilter(triggerNode, eventData)) {
                logTelegramChannelTrace('WORKFLOW_SKIPPED', telegramChannelTrace, { workflowId: wf.id, reason: 'trigger_filter', triggerNodeId: triggerNode.id });
                continue;
            }
            logTelegramChannelTrace('WORKFLOW_MATCHED', telegramChannelTrace, {
                workflowId: wf.id,
                triggerNodeId: triggerNode.id,
                debounceSeconds: Number(triggerNode.config.debounceSeconds || 0),
            });
            // ─── Debounce for message triggers: gom tin nhắn liên tiếp ────────
            const debounceSeconds = Number(triggerNode.config.debounceSeconds || 0);
            if ((triggerType === 'trigger.message' || triggerType === 'fb.trigger.message' || triggerType === 'tg.trigger.message') && debounceSeconds > 0) {
                const envelope = eventData.message || eventData;
                const msg = envelope.data || eventData.data || envelope;
                const threadId = msg.threadId || envelope.threadId || eventData.threadId || '';
                const debounceKey = `${wf.id}:${threadId}`;
                // Buffer the event
                if (!this.debounceBuffers.has(debounceKey)) {
                    this.debounceBuffers.set(debounceKey, []);
                }
                this.debounceBuffers.get(debounceKey).push(eventData);
                // Clear existing timer and set new one
                const existingTimer = this.debounceTimers.get(debounceKey);
                if (existingTimer)
                    clearTimeout(existingTimer);
                const timer = setTimeout(() => {
                    this.debounceTimers.delete(debounceKey);
                    const buffered = this.debounceBuffers.get(debounceKey) || [];
                    this.debounceBuffers.delete(debounceKey);
                    if (buffered.length === 0)
                        return;
                    // Merge all buffered messages: take the LAST event as base, combine contents
                    const lastEvent = buffered[buffered.length - 1];
                    if (buffered.length > 1) {
                        // Extract content from each buffered message and join
                        const mergedContents = [];
                        for (const evt of buffered) {
                            const m = evt.data || evt.message || {};
                            const md = m.data || {};
                            const rawContent = md.content || m.content || evt.content;
                            const text = String(rawContent?.msg || (typeof rawContent === 'string' ? rawContent : '') || '').trim();
                            if (text)
                                mergedContents.push(text);
                        }
                        // Inject merged content into last event's message data
                        const lastMsg = lastEvent.data || lastEvent.message || {};
                        const lastMsgData = lastMsg.data || {};
                        const mergedText = mergedContents.join('\n');
                        if (lastMsgData.content && typeof lastMsgData.content === 'object') {
                            lastMsgData.content = { ...lastMsgData.content, msg: mergedText };
                        }
                        else {
                            lastMsgData.content = mergedText;
                        }
                        Logger_1.default.info(`[WorkflowEngine] Debounce merged ${buffered.length} messages for "${wf.name}": "${mergedText.substring(0, 200)}"`);
                    }
                    this.executeWorkflow(wf, lastEvent, triggerType).catch(err => {
                        Logger_1.default.error(`[WorkflowEngine] Error in workflow "${wf.name}" (debounced): ${err.message}`);
                    });
                }, debounceSeconds * 1000);
                this.debounceTimers.set(debounceKey, timer);
                // Cap debounce entries to prevent unbounded memory growth
                if (this.debounceTimers.size > 500) {
                    const oldestKey = this.debounceTimers.keys().next().value;
                    if (oldestKey) {
                        clearTimeout(this.debounceTimers.get(oldestKey));
                        this.debounceTimers.delete(oldestKey);
                        this.debounceBuffers.delete(oldestKey);
                    }
                }
                Logger_1.default.info(`[WorkflowEngine] Debounce: buffered message for "${wf.name}" (${debounceKey}), wait ${debounceSeconds}s`);
                continue;
            }
            this.executeWorkflow(wf, eventData, triggerType).catch(err => {
                Logger_1.default.error(`[WorkflowEngine] Error in workflow "${wf.name}": ${err.message}`);
            });
        }
    }
    /**
     * Find an enabled workflow with a trigger.webhook node matching the given token.
     */
    findWorkflowByWebhookToken(token) {
        for (const wf of this.workflows.values()) {
            if (!wf.enabled)
                continue;
            const triggerNode = wf.nodes.find(n => n.type === 'trigger.webhook');
            if (!triggerNode)
                continue;
            if (triggerNode.config?.webhookToken === token)
                return wf;
        }
        return null;
    }
    /**
     * Find enabled workflows with trigger.telegramCommand matching the given bot integration + command.
     */
    findWorkflowsByTelegramCommand(integrationId, command, chatId) {
        const results = [];
        for (const wf of this.workflows.values()) {
            if (!wf.enabled)
                continue;
            const triggerNode = wf.nodes.find(n => n.type === 'trigger.telegramCommand');
            if (!triggerNode)
                continue;
            const cfg = triggerNode.config || {};
            // Match integration
            if (cfg.integrationId && cfg.integrationId !== integrationId)
                continue;
            // Match command (empty = any)
            if (cfg.command && cfg.command !== command)
                continue;
            // Match chatId filter (empty = any)
            if (cfg.chatIdFilter && cfg.chatIdFilter !== chatId)
                continue;
            results.push(wf);
        }
        return results;
    }
    /**
     * Handle an incoming webhook request from WebhookGatewayService.
     * Looks up the workflow by webhook token, verifies method, then triggers execution.
     */
    async handleWebhook(token, req) {
        const wf = this.findWorkflowByWebhookToken(token);
        if (!wf) {
            Logger_1.default.warn('[WorkflowEngine] Webhook token not found: ' + token);
            return { status: 404, body: { success: false, error: 'Webhook not found' } };
        }
        const triggerNode = wf.nodes.find(n => n.type === 'trigger.webhook');
        const cfg = triggerNode.config || {};
        // Method check
        const allowedMethod = (cfg.method || 'POST').toUpperCase();
        if (allowedMethod !== 'ANY' && req.method.toUpperCase() !== allowedMethod) {
            Logger_1.default.warn('[WorkflowEngine] Webhook ' + token + ': method ' + req.method + ' not allowed (expected ' + allowedMethod + ')');
            return { status: 405, body: { success: false, error: 'Method not allowed' } };
        }
        // IP whitelist check
        if (cfg.allowedIps) {
            const allowedIps = String(cfg.allowedIps).split(',').map(s => s.trim()).filter(Boolean);
            if (allowedIps.length > 0 && req.remoteIp) {
                if (!allowedIps.includes(req.remoteIp)) {
                    Logger_1.default.warn('[WorkflowEngine] Webhook ' + token + ': IP ' + req.remoteIp + ' not allowed');
                    return { status: 403, body: { success: false, error: 'IP not allowed' } };
                }
            }
        }
        // Build event data for triggerWorkflows
        const eventData = {
            webhookToken: token,
            body: req.body || {},
            headers: req.headers || {},
            method: req.method,
            query: req.query || {},
            rawBody: req.rawBody || '',
        };
        // Fire and forget - run workflow async
        this.triggerWorkflows('trigger.webhook', eventData);
        return {
            status: 200,
            body: { success: true, workflowId: wf.id, workflowName: wf.name },
        };
    }
    matchesTriggerFilter(triggerNode, data) {
        const cfg = triggerNode.config;
        if (triggerNode.type === 'trigger.message') {
            // data = { zaloId, message } where message is a zca-js UserMessage | GroupMessage:
            //   { type: 0|1, data: TMessage, threadId: string, isSelf: boolean }
            // All payload fields (uidFrom, msgId, ts, dName, content) live inside message.data (msgData)
            const msg = data.data || data.message || {}; // UserMessage | GroupMessage
            const msgData = msg.data || {}; // TMessage - uidFrom, content, msgId, ts, dName ...
            // type === 1 (ThreadType.Group) is the ONLY reliable group indicator in zca-js
            const isGroup = msg.type === 1 || !!msg.isGroup;
            if (cfg.threadType !== undefined && cfg.threadType !== 'all') {
                if (String(cfg.threadType) === '0' && isGroup)
                    return false;
                if (String(cfg.threadType) === '1' && !isGroup)
                    return false;
            }
            if (cfg.fromId && (msgData.uidFrom || msg.uidFrom || data.fromId) !== cfg.fromId)
                return false;
            if (cfg.groupId && (msg.threadId || data.threadId) !== cfg.groupId)
                return false;
            if (cfg.ignoreOwn !== false) {
                if (msg.isSelf || data.isSelf)
                    return false;
            }
            if (cfg.onlyOwn && !(msg.isSelf || data.isSelf))
                return false;
            if (cfg.keyword) {
                const rawContent = msgData.content || msg.content || data.content;
                const content = String(rawContent?.msg || (typeof rawContent === 'string' ? rawContent : '') || '').toLowerCase();
                const kws = String(cfg.keyword).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
                const mode = cfg.keywordMode || 'contains_any';
                if (mode === 'contains_any' && !kws.some(k => content.includes(k)))
                    return false;
                if (mode === 'contains_all' && !kws.every(k => content.includes(k)))
                    return false;
                if (mode === 'equals' && !kws.includes(content))
                    return false;
                if (mode === 'starts_with' && !kws.some(k => content.startsWith(k)))
                    return false;
                if (mode === 'regex') {
                    try {
                        if (!new RegExp(cfg.keyword, 'i').test(content))
                            return false;
                    }
                    catch {
                        return false;
                    }
                }
            }
        }
        if (triggerNode.type === 'trigger.groupEvent') {
            if (cfg.groupId && data.groupId !== cfg.groupId)
                return false;
            if (cfg.eventType && cfg.eventType !== 'all' && data.eventType !== cfg.eventType)
                return false;
        }
        if (triggerNode.type === 'trigger.reaction') {
            if (cfg.threadId && data.threadId !== cfg.threadId)
                return false;
            if (cfg.reactionType && cfg.reactionType !== 'any') {
                if (String(data.react || data.reactionType || '') !== String(cfg.reactionType))
                    return false;
            }
        }
        if (triggerNode.type === 'trigger.labelAssigned') {
            // action filter: 'any' | 'assigned' | 'removed'
            if (cfg.action && cfg.action !== 'any' && data.action !== cfg.action)
                return false;
            // source filter: 'any' | 'local' | 'zalo'
            if (cfg.labelSource && cfg.labelSource !== 'any') {
                const source = String(data.labelSource || channelHelper_1.CHANNEL.ZALO);
                if (source !== String(cfg.labelSource))
                    return false;
            }
            // New: labelIds array - contains "source:id" strings
            if (Array.isArray(cfg.labelIds) && cfg.labelIds.length > 0) {
                const eventSrc = String(data.labelSource || channelHelper_1.CHANNEL.ZALO);
                const matches = cfg.labelIds.some((item) => {
                    if (typeof item === 'string' && item.includes(':')) {
                        const [src, id] = item.split(':');
                        return String(data.labelId) === String(id) && eventSrc === src;
                    }
                    return String(data.labelId) === String(item);
                });
                if (!matches)
                    return false;
            }
            else {
                // Backward-compat: old single labelId / labelText fields
                if (cfg.labelId && String(data.labelId) !== String(cfg.labelId))
                    return false;
                if (cfg.labelText) {
                    const needle = String(cfg.labelText).toLowerCase().trim();
                    if (!String(data.labelText || '').toLowerCase().includes(needle))
                        return false;
                }
            }
        }
        if (triggerNode.type === 'trigger.payment') {
            const tx = data.transaction || data;
            // Filter by integration id
            if (cfg.integrationId && data.integrationId !== cfg.integrationId)
                return false;
            // Filter by minimum amount
            if (cfg.minAmount && Number(tx.amount || tx.in || 0) < Number(cfg.minAmount))
                return false;
            // Filter by description keyword
            if (cfg.descContains) {
                const desc = String(tx.description || tx.memo || tx.content || '').toLowerCase();
                if (!desc.includes(String(cfg.descContains).toLowerCase()))
                    return false;
            }
        }
        if (triggerNode.type === 'trigger.webhook') {
            // Method filter - already checked in handleWebhook, but double-check
            if (cfg.method && cfg.method !== 'ANY' && data.method !== cfg.method)
                return false;
        }
        if (triggerNode.type === 'trigger.telegramCommand') {
            // Integration filter
            if (cfg.integrationId && data.integrationId !== cfg.integrationId)
                return false;
            // Command filter (empty = any)
            if (cfg.command && cfg.command !== data.command)
                return false;
            // Chat ID filter (empty = any)
            if (cfg.chatIdFilter && cfg.chatIdFilter !== data.chatId)
                return false;
        }
        // Telegram Bot callback filter.  A workflow selected directly by an inline
        // button is already narrowed by id; this filter is for generic callbacks.
        if (triggerNode.type === 'tgbot.trigger.callback') {
            if (cfg.accountId && String(cfg.accountId) !== String(data.accountId || data.zaloId || ''))
                return false;
            if (cfg.chatId && String(cfg.chatId) !== String(data.chatId || data.threadId || ''))
                return false;
            if (cfg.callbackData && String(cfg.callbackData) !== String(data.callbackData || ''))
                return false;
        }
        if (triggerNode.type === 'tgbot.trigger.message' || triggerNode.type === 'tgbot.trigger.command') {
            const envelope = data.message || data;
            const msg = envelope.data || data.data || envelope;
            const content = String(msg.content || data.content || '');
            if (cfg.accountId && String(cfg.accountId) !== String(data.zaloId || data.accountId || ''))
                return false;
            if (cfg.chatId && String(cfg.chatId) !== String(envelope.threadId || data.threadId || msg.idTo || ''))
                return false;
            if (cfg.ignoreOwn !== false && (data.isSelf || envelope.isSelf || msg.isSelf))
                return false;
            const chatType = String(msg.chatType || data.chatType || (msg.isChannel ? 'channel' : '')).toLowerCase();
            if (cfg.chatScope === 'private' && chatType !== 'private')
                return false;
            if (cfg.chatScope === 'group' && !['group', 'supergroup'].includes(chatType))
                return false;
            if (cfg.chatScope === 'channel' && chatType !== 'channel')
                return false;
            if (triggerNode.type === 'tgbot.trigger.command') {
                const command = content.trim().split(/\s+/)[0].replace(/@[^\s]+$/, '').replace(/^\//, '').toLowerCase();
                const commands = [cfg.command, ...String(cfg.aliases || '').split(',')]
                    .map((item) => item.trim().replace(/^\//, '').toLowerCase()).filter(Boolean);
                if (commands.length && !commands.includes(command))
                    return false;
                if (cfg.argumentContains && !content.trim().split(/\s+/).slice(1).join(' ').toLowerCase().includes(String(cfg.argumentContains).toLowerCase()))
                    return false;
                const allowed = String(cfg.authorizedUsers || '').split(',').map((item) => item.trim()).filter(Boolean);
                if (allowed.length && !allowed.includes(String(msg.uidFrom || data.fromId || '')))
                    return false;
            }
            if (triggerNode.type === 'tgbot.trigger.message') {
                if (cfg.fromId && String(cfg.fromId) !== String(msg.uidFrom || data.fromId || ''))
                    return false;
                if (cfg.messageTypes && cfg.messageTypes !== 'all' && String(msg.msgType || data.msgType || 'text') !== cfg.messageTypes)
                    return false;
                const keywords = String(cfg.keyword).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
                if (keywords.length) {
                    const normalized = content.toLowerCase();
                    const mode = cfg.keywordMode || 'contains_any';
                    const matched = mode === 'contains_all' ? keywords.every((item) => normalized.includes(item))
                        : mode === 'exact' ? keywords.some((item) => normalized === item)
                            : mode === 'starts_with' ? keywords.some((item) => normalized.startsWith(item))
                                : keywords.some((item) => normalized.includes(item));
                    if (!matched)
                        return false;
                }
            }
        }
        if (triggerNode.type === 'tgbot.trigger.join') {
            if (cfg.accountId && String(cfg.accountId) !== String(data.accountId || data.zaloId || ''))
                return false;
            if (cfg.chatId && String(cfg.chatId) !== String(data.chatId || data.threadId || ''))
                return false;
            if (cfg.eventType && cfg.eventType !== 'all' && cfg.eventType !== data.eventType)
                return false;
        }
        if (triggerNode.type === 'tgbot.trigger.joinRequest') {
            if (cfg.accountId && String(cfg.accountId) !== String(data.accountId || data.zaloId || ''))
                return false;
            if (cfg.chatId && String(cfg.chatId) !== String(data.chatId || data.threadId || ''))
                return false;
        }
        if (triggerNode.type === 'tgbot.trigger.editedMessage') {
            const envelope = data.message || data;
            const msg = envelope.data || data.data || envelope;
            const content = String(msg.content || data.content || '');
            if (cfg.accountId && String(cfg.accountId) !== String(data.accountId || data.zaloId || ''))
                return false;
            if (cfg.chatId && String(cfg.chatId) !== String(data.chatId || data.threadId || msg.idTo || ''))
                return false;
            const chatType = String(msg.chatType || data.chatType || '').toLowerCase();
            if (cfg.chatScope === 'private' && chatType !== 'private')
                return false;
            if (cfg.chatScope === 'group' && !['group', 'supergroup'].includes(chatType))
                return false;
            if (cfg.chatScope === 'channel' && chatType !== 'channel')
                return false;
            if (cfg.keyword) {
                const keywords = String(cfg.keyword).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
                const normalized = content.toLowerCase();
                const mode = cfg.keywordMode || 'contains_any';
                const matched = mode === 'contains_all' ? keywords.every((item) => normalized.includes(item))
                    : mode === 'exact' ? keywords.some((item) => normalized === item)
                        : mode === 'starts_with' ? keywords.some((item) => normalized.startsWith(item))
                            : keywords.some((item) => normalized.includes(item));
                if (!matched)
                    return false;
            }
        }
        // ── Facebook trigger matching ───────────────────────────────────────────
        if (triggerNode.type === 'fb.trigger.message') {
            // Filter by threadId
            if (cfg.threadId && data.threadId !== cfg.threadId)
                return false;
            // Filter by threadType using the source's explicit discriminator. Both
            // Facebook users and groups may have a numeric ID, so ID shape is never
            // a safe routing signal here.
            if (cfg.threadType !== undefined && cfg.threadType !== 'all') {
                const sourceType = data.typeChat ?? data.message?.type;
                const isGroup = sourceType === null || sourceType === 'group';
                const isUser = sourceType === 'user';
                // Do not guess when a legacy event has no discriminator. This is
                // preferable to firing a "group only" workflow for a personal chat.
                if (!isGroup && !isUser)
                    return false;
                if (String(cfg.threadType) === '0' && isGroup)
                    return false;
                if (String(cfg.threadType) === '1' && !isGroup)
                    return false;
            }
            // Filter by sender (fromId)
            if (cfg.fromId) {
                const senderId = data.fromId || (data.message || {}).userID || '';
                if (senderId !== cfg.fromId)
                    return false;
            }
            // Filter by group (groupId)
            if (cfg.groupId && data.threadId !== cfg.groupId)
                return false;
            // Ignore own messages (default true)
            if (cfg.ignoreOwn !== false) {
                const msg = data.message || {};
                if (msg.isSelf || data.isSelf)
                    return false;
            }
            // Only own messages
            if (cfg.onlyOwn && !((data.message || {}).isSelf || data.isSelf))
                return false;
            // Keyword filter
            if (cfg.keyword) {
                const content = String(data.content || data.message?.body || '').toLowerCase();
                const kws = String(cfg.keyword).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
                const mode = cfg.keywordMode || 'contains_any';
                if (mode === 'contains_any' && !kws.some(k => content.includes(k)))
                    return false;
                if (mode === 'contains_all' && !kws.every(k => content.includes(k)))
                    return false;
                if (mode === 'equals' && !kws.includes(content))
                    return false;
                if (mode === 'starts_with' && !kws.some(k => content.startsWith(k)))
                    return false;
                if (mode === 'regex') {
                    try {
                        if (!(new RegExp(String(cfg.keyword), 'i')).test(content))
                            return false;
                    }
                    catch {
                        // An invalid user pattern must not turn the filter into match-all.
                        return false;
                    }
                }
            }
        }
        // ── Facebook media attachment triggers ────────────────────────────────
        if (['fb.trigger.image', 'fb.trigger.video', 'fb.trigger.file', 'fb.trigger.sticker'].includes(triggerNode.type)) {
            if (cfg.threadId && data.threadId !== cfg.threadId)
                return false;
            // Also verify the message actually has the matching attachment type
            const msg = data?.message || {};
            const att = msg.attachments || {};
            const attType = (att.attachmentType || '').toLowerCase();
            const expectedType = triggerNode.type.split('.').pop(); // image | video | file | sticker
            if (expectedType === 'file' && attType !== 'file' && attType !== 'audio')
                return false;
            if (expectedType === 'image' && attType !== 'image' && attType !== 'photo')
                return false;
            if (expectedType !== 'file' && expectedType !== 'image' && attType !== expectedType)
                return false;
        }
        // ── Facebook reaction trigger ─────────────────────────────────────────
        if (triggerNode.type === 'fb.trigger.reaction') {
            if (cfg.threadId && data.threadId !== cfg.threadId)
                return false;
            if (cfg.reactionType && cfg.reactionType !== 'any') {
                // FB event uses 'emoji' field; Zalo uses 'react'/'reactionType'
                const actualEmoji = data.emoji || data.react || data.reactionType || '';
                if (String(actualEmoji) !== String(cfg.reactionType))
                    return false;
            }
        }
        // ── Facebook unsend trigger ───────────────────────────────────────────
        if (triggerNode.type === 'fb.trigger.unsend') {
            if (cfg.threadId && data.threadId !== cfg.threadId)
                return false;
        }
        // ── Facebook group event trigger ──────────────────────────────────────
        if (triggerNode.type === 'fb.trigger.groupEvent') {
            if (cfg.threadId && data.threadId !== cfg.threadId)
                return false;
            if (cfg.eventType && cfg.eventType !== 'all' && data.type !== cfg.eventType)
                return false;
        }
        // ── Telegram message trigger ──────────────────────────────────────────
        if (triggerNode.type === 'tg.trigger.message') {
            const envelope = data.message || data;
            const msg = envelope.data || data.data || envelope;
            // Filter by chatId (empty = any)
            if (cfg.chatId) {
                const msgChatId = data.threadId || envelope.threadId || msg.threadId || msg.chatId || '';
                if (msgChatId !== cfg.chatId)
                    return false;
            }
            // Filter by chatType (user/group/channel/topic)
            if (cfg.chatType && cfg.chatType !== 'all') {
                const chatId = String(data.threadId || envelope.threadId || msg.threadId || msg.chatId || '');
                const isGroup = chatId.startsWith('-') && !chatId.startsWith('-100');
                const isSupergroup = chatId.startsWith('-100');
                const isChannel = !!msg.isChannel || !!data.isChannel;
                const hasTopic = !!msg.topicId;
                if (cfg.chatType === 'user' && (isGroup || isSupergroup || isChannel))
                    return false;
                if (cfg.chatType === 'group' && ((!isGroup && !isSupergroup) || isChannel))
                    return false;
                if (cfg.chatType === 'channel' && !isChannel)
                    return false;
                if (cfg.chatType === 'topic' && !hasTopic)
                    return false;
            }
            // Filter by sender (fromId)
            if (cfg.fromId) {
                const senderId = String(data.fromId || msg.fromId || msg.senderId || msg.uidFrom || '');
                if (senderId !== cfg.fromId)
                    return false;
            }
            // Ignore own messages (default true)
            if (cfg.ignoreOwn !== false) {
                if (data.isSelf || envelope.isSelf || msg.isSelf)
                    return false;
            }
            // Keyword filter
            if (cfg.keyword) {
                const content = String(data.content || msg.content || msg.text || '').toLowerCase();
                const kws = String(cfg.keyword).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
                const mode = cfg.keywordMode || 'contains_any';
                if (mode === 'contains_any' && !kws.some(k => content.includes(k)))
                    return false;
                if (mode === 'contains_all' && !kws.every(k => content.includes(k)))
                    return false;
                if (mode === 'exact' && !kws.includes(content))
                    return false;
                if (mode === 'starts_with' && !kws.some(k => content.startsWith(k)))
                    return false;
            }
        }
        // ── Telegram unsend trigger ──────────────────────────────────────────
        if (triggerNode.type === 'tg.trigger.unsend') {
            if (cfg.chatId) {
                const chatId = data.threadId || '';
                if (chatId !== cfg.chatId)
                    return false;
            }
        }
        // ── Telegram group event trigger ─────────────────────────────────────
        if (triggerNode.type === 'tg.trigger.groupEvent') {
            if (cfg.chatId) {
                const chatId = data.groupId || data.threadId || '';
                if (chatId !== cfg.chatId)
                    return false;
            }
            if (cfg.eventType && cfg.eventType !== 'all') {
                const eventType = data.eventType || data.type || '';
                if (eventType !== cfg.eventType)
                    return false;
            }
        }
        return true;
    }
    // ─── Execution ────────────────────────────────────────────────────────────
    async executeWorkflow(wf, triggerData, triggeredBy = 'manual', startNodeId) {
        if (!this.isRunnableWorkflow(wf)) {
            throw new Error('Workflow không hỗ trợ chạy (channel unknown)');
        }
        const runId = (0, uuid_1.v4)();
        const startedAt = Date.now();
        const nodeResults = [];
        const telegramChannelTrace = triggeredBy === 'tg.trigger.message'
            ? getTelegramChannelTrace(triggerData)
            : null;
        logTelegramChannelTrace('WORKFLOW_EXECUTION_STARTED', telegramChannelTrace, {
            workflowId: wf.id,
            runId,
            startNodeId: startNodeId || '-',
        });
        // Flatten trigger data for template access
        const flatTrigger = this.flattenTriggerData(triggerData, triggeredBy);
        const context = {
            trigger: flatTrigger,
            nodes: {},
            variables: {},
            pageId: wf.pageIds[0] || wf.pageId || triggerData?.zaloId || '',
            skippedNodes: new Set(),
            _wfNodes: wf.nodes,
            _wfName: wf.name,
        };
        const sortedOrder = this.topologicalSort(wf);
        const routeNodes = startNodeId ? this.getReachableWorkflowNodes(wf, startNodeId) : null;
        const order = routeNodes ? sortedOrder.filter(nodeId => routeNodes.has(nodeId)) : sortedOrder;
        let status = 'success';
        let errorMessage;
        for (const nodeId of order) {
            const node = wf.nodes.find(n => n.id === nodeId);
            if (!node)
                continue;
            const t0 = Date.now();
            if (context.skippedNodes.has(nodeId)) {
                nodeResults.push({ nodeId, nodeType: node.type, label: node.label, status: 'skipped', input: {}, output: { _skipped: true }, durationMs: 0 });
                // Propagate skip to downstream nodes
                this.markDownstreamSkipped(nodeId, wf, context.skippedNodes);
                continue;
            }
            let renderedConfig = {};
            try {
                renderedConfig = this.renderConfig(node.config, context);
                if (node.type === 'zalo.sendMessage') {
                    Logger_1.default.info(`[WorkflowEngine] sendMessage BEFORE: raw="${(node.config.message || '').substring(0, 300)}" → rendered="${(renderedConfig.message || '').substring(0, 300)}"`);
                }
                const output = await this.executeNode(node, renderedConfig, context, wf);
                context.nodes[nodeId] = { output };
                if (node.type === 'ai.generateText') {
                    Logger_1.default.info(`[WorkflowEngine] AI chat output stored: keys=${output ? Object.keys(output).join(',') : 'null'}, result="${typeof output === 'object' && output ? (output.result || '').substring(0, 200) : String(output).substring(0, 200)}"`);
                }
                // If this is an IF node, mark the wrong branch as skipped
                if (node.type === 'logic.if') {
                    const result = output.result;
                    for (const edge of wf.edges.filter(e => e.source === nodeId)) {
                        if (edge.sourceHandle === 'true' && !result) {
                            context.skippedNodes.add(edge.target);
                            this.markDownstreamSkipped(edge.target, wf, context.skippedNodes);
                        }
                        if (edge.sourceHandle === 'false' && result) {
                            context.skippedNodes.add(edge.target);
                            this.markDownstreamSkipped(edge.target, wf, context.skippedNodes);
                        }
                    }
                }
                // switch node: mark all non-matching cases
                if (node.type === 'logic.switch') {
                    const matchedHandle = output.matchedHandle;
                    for (const edge of wf.edges.filter(e => e.source === nodeId)) {
                        if (edge.sourceHandle !== matchedHandle) {
                            context.skippedNodes.add(edge.target);
                            this.markDownstreamSkipped(edge.target, wf, context.skippedNodes);
                        }
                    }
                }
                nodeResults.push({ nodeId, nodeType: node.type, label: node.label, status: 'success', input: this.truncateData(renderedConfig), output: this.truncateData(output), durationMs: Date.now() - t0 });
            }
            catch (err) {
                // logic.stopIf signals a graceful stop - treat as success, halt loop
                if (err.message === '__STOP__') {
                    nodeResults.push({ nodeId, nodeType: node.type, label: node.label, status: 'success', input: this.truncateData(renderedConfig), output: { stopped: true }, durationMs: Date.now() - t0 });
                    break;
                }
                // Build rich error output from axios/HTTP errors
                const errorOutput = {};
                errorOutput._errorType = 'execution_error';
                if (err.response) {
                    errorOutput._errorType = 'http_error';
                    errorOutput._httpStatus = err.response.status;
                    errorOutput._httpStatusText = err.response.statusText;
                    errorOutput._responseData = this.truncateData(err.response.data);
                    errorOutput._responseHeaders = err.response.headers;
                }
                else if (err.request) {
                    errorOutput._errorType = 'network_error';
                    errorOutput._requestSummary = `${err.request.method || ''} ${err.request.url || ''}`;
                }
                if (err.code)
                    errorOutput._errorCode = err.code;
                if (err.message)
                    errorOutput._errorMessage = err.message;
                if (err.stack)
                    errorOutput._stackTrace = err.stack.split('\n').slice(0, 6).join('\n');
                nodeResults.push({ nodeId, nodeType: node.type, label: node.label, status: 'error', input: this.truncateData(renderedConfig), output: this.truncateData(errorOutput), durationMs: Date.now() - t0, error: err.message });
                if (node.config.continueOnError) {
                    status = 'partial';
                }
                else {
                    status = 'error';
                    errorMessage = `Node "${node.label || node.type}" lỗi: ${err.message}`;
                    break;
                }
            }
        }
        const log = {
            id: runId, workflowId: wf.id, workflowName: wf.name,
            triggeredBy, startedAt, finishedAt: Date.now(),
            status, errorMessage, nodeResults,
        };
        DatabaseService_1.default.getInstance().saveWorkflowRunLog(log);
        EventBroadcaster_1.default.emit('workflow:executed', { workflowId: wf.id, runId, status });
        logTelegramChannelTrace('WORKFLOW_EXECUTION_FINISHED', telegramChannelTrace, {
            workflowId: wf.id,
            runId,
            status,
            nodeCount: nodeResults.length,
            durationMs: log.finishedAt - startedAt,
            error: errorMessage || '-',
        });
        return log;
    }
    markDownstreamSkipped(nodeId, wf, skipped) {
        for (const edge of wf.edges.filter(e => e.source === nodeId && !e.data?.telegramInline)) {
            if (!skipped.has(edge.target)) {
                skipped.add(edge.target);
                this.markDownstreamSkipped(edge.target, wf, skipped);
            }
        }
    }
    flattenTriggerData(data, triggerType) {
        if (!data)
            return {};
        if (triggerType === 'trigger.message' || triggerType.startsWith('event:message')) {
            // data = { zaloId, message } where message is zca-js UserMessage | GroupMessage:
            //   { type: 0|1 (ThreadType), data: TMessage, threadId: string, isSelf: boolean }
            // All payload fields live inside message.data (msgData), NOT at top-level of message.
            const msg = data.data || data.message || {}; // UserMessage | GroupMessage
            const msgData = msg.data || {}; // TMessage: uidFrom, msgId, ts, dName, content...
            // type === 1 (ThreadType.Group) is the ONLY reliable group indicator in zca-js
            const isGroup = msg.type === 1 || !!msg.isGroup || !!(data.isGroup);
            const threadType = data.threadType !== undefined
                ? Number(data.threadType)
                : (isGroup ? 1 : 0);
            const rawContent = msgData.content || msg.content || data.content;
            const msgType = String(msgData.msgType || msg.msgType || '');
            let content = String(rawContent?.msg || (typeof rawContent === 'string' ? rawContent : '') || '');
            // Link cards (chat.recommended) often store user text inside content.title, not content.msg.
            if (!content && rawContent && typeof rawContent === 'object') {
                if (msgType === 'chat.recommended' || msgType === 'chat.link') {
                    content = String(rawContent.title || rawContent.href || '');
                }
                else {
                    content = String(rawContent.title || '');
                }
            }
            // Extract image URLs from message content for $trigger.images
            const images = [];
            if (rawContent && typeof rawContent === 'object') {
                let params = rawContent.params;
                if (typeof params === 'string') {
                    try {
                        params = JSON.parse(params);
                    }
                    catch {
                        params = null;
                    }
                }
                const hdUrl = params?.hd || params?.rawUrl || '';
                if (hdUrl)
                    images.push(hdUrl);
                const thumbUrl = rawContent.thumb || rawContent.normalUrl || rawContent.hdUrl || '';
                if (thumbUrl && !images.includes(thumbUrl))
                    images.push(thumbUrl);
            }
            return {
                fromId: msgData.uidFrom || msg.uidFrom || data.fromId || '',
                fromName: data.fromName || msgData.dName || msgData.senderInfo?.displayName
                    || msgData.senderInfo?.zaloName || msgData.senderInfo?.name || msg.fromName || '',
                fromPhone: data.fromPhone || msg.fromPhone || '',
                content,
                images,
                threadId: msg.threadId || data.threadId || msgData.idTo || '',
                threadType,
                isGroup,
                groupName: data.groupName || msg.groupName || msgData.groupName
                    || msgData.groupInfo?.name || msgData.group?.name || '',
                msgId: msgData.msgId || msg.msgId || data.msgId || '',
                cliMsgId: msgData.cliMsgId || msg.cliMsgId || data.cliMsgId || '',
                timestamp: Number(msgData.ts) || Number(msg.ts) || data.timestamp || Date.now(),
                isSelf: !!(msg.isSelf || data.isSelf),
                zaloId: data.zaloId || '',
            };
        }
        if (triggerType === 'trigger.friendRequest' || triggerType.startsWith('event:friendRequest')) {
            const d = data.requester || data.data || data;
            return {
                userId: d.userId || d.uid || data.userId || '',
                displayName: d.displayName || d.dName || data.displayName || '',
                phone: d.phone || d.phoneNumber || data.phone || '',
                message: d.msg || d.message || data.message || '',
                zaloId: data.zaloId || '',
            };
        }
        if (triggerType === 'trigger.groupEvent' || triggerType.startsWith('event:groupEvent')) {
            const d = data.data || data;
            const members = d.updateMembers || [];
            return {
                groupId: data.groupId || d.groupId || '',
                eventType: data.eventType || '',
                actorName: members[0]?.dName || members[0]?.zaloName || '',
                targetNames: members.map((m) => m.dName || m.zaloName || m.id || '').filter(Boolean).join(', '),
                systemText: data.systemText || '',
                zaloId: data.zaloId || '',
            };
        }
        if (triggerType === 'trigger.reaction' || triggerType.startsWith('event:reaction')) {
            return {
                fromId: data.uidFrom || data.fromId || '',
                fromName: data.fromName || '',
                msgId: data.msgId || '',
                threadId: data.threadId || '',
                react: data.react || data.reactionType || '',
                zaloId: data.zaloId || '',
            };
        }
        if (triggerType === 'trigger.labelAssigned') {
            return {
                zaloId: data.zaloId || '',
                threadId: data.threadId || '',
                threadType: data.threadType ?? 0,
                labelId: data.labelId ?? '',
                labelText: data.labelText || '',
                labelColor: data.labelColor || '',
                labelEmoji: data.labelEmoji || '',
                labelSource: data.labelSource || channelHelper_1.CHANNEL.ZALO,
                action: data.action || 'assigned', // 'assigned' | 'removed'
            };
        }
        if (triggerType === 'trigger.payment' || triggerType === 'integration:payment') {
            const tx = data.transaction || data;
            return {
                integrationId: data.integrationId || '',
                integrationType: data.integrationType || '',
                amount: tx.amount || tx.in || 0,
                description: tx.description || tx.memo || tx.content || '',
                bankName: tx.bankName || tx.bank_name || '',
                accountNumber: tx.accountNumber || tx.bank_acc_id || '',
                transactionId: tx.id || tx.transaction_id || tx.tid || '',
                transactionDate: tx.when || tx.transactionDate || tx.created_at || '',
                raw: tx,
            };
        }
        if (triggerType === 'trigger.webhook') {
            return {
                webhookToken: data.webhookToken || '',
                body: data.body || {},
                headers: data.headers || {},
                method: data.method || 'POST',
                query: data.query || {},
                rawBody: data.rawBody || '',
            };
        }
        if (triggerType === 'fb.trigger.unsend') {
            // fb:onUnsend: { fbAccountId, messageId }
            return {
                fbAccountId: data.fbAccountId || '',
                messageId: data.messageId || '',
                threadId: data.threadId || '',
                fromId: '',
                content: '',
                body: '',
                attachments: null,
                isSelf: false,
                emoji: '',
                timestamp: Date.now(),
            };
        }
        if (triggerType === 'fb.trigger.groupEvent') {
            // fb:onGroupEvent: { fbAccountId, threadId, type, participantId, participants, actorFbId }
            return {
                fbAccountId: data.fbAccountId || '',
                messageId: '',
                threadId: data.threadId || '',
                fromId: data.actorFbId || '',
                content: '',
                body: '',
                groupEventType: data.type || '',
                participantId: data.participantId || '',
                participants: data.participants || [],
                actorFbId: data.actorFbId || '',
                attachments: null,
                isSelf: false,
                emoji: '',
                timestamp: Date.now(),
            };
        }
        if (triggerType.startsWith('fb.trigger.')) {
            const msg = data.message || {};
            return {
                fbAccountId: data.fbAccountId || '',
                messageId: data.messageId || '',
                threadId: data.threadId || msg.threadId || msg.replyToID || '',
                fromId: msg.userID || data.userId || data.fromId || '',
                content: msg.body || '',
                body: msg.body || '',
                attachments: msg.attachments || null,
                isSelf: !!(msg.isSelf || data.isSelf),
                emoji: data.emoji || '',
                msgType: msg.type || msg.attachments?.attachmentType || '',
                timestamp: Number(msg.timestamp || data.timestamp || msg.timestamp_precise || Date.now()),
                // Numeric Facebook group IDs cannot be detected from their shape.
                // Retain the tri-state discriminator for downstream send actions.
                typeChat: msg.type === 'user' ? 'user' : msg.type === 'group' ? null : undefined,
            };
        }
        // ── Telegram Bot trigger flattening ────────────────────────────────────
        if (triggerType.startsWith('tgbot.trigger.')) {
            const envelope = data.message || data;
            const msg = envelope.data || data.data || envelope;
            const content = String(msg.content || data.content || '');
            return {
                accountId: data.accountId || data.zaloId || '',
                chatId: data.chatId || envelope.threadId || data.threadId || msg.idTo || '',
                threadId: data.chatId || envelope.threadId || data.threadId || msg.idTo || '',
                fromId: data.fromId || msg.uidFrom || '',
                fromName: data.fromName || msg.dName || '',
                content,
                body: content,
                messageId: data.messageId || msg.msgId || '',
                callbackQueryId: data.callbackQueryId || '',
                callbackData: data.callbackData || '',
                isSelf: !!(data.isSelf || envelope.isSelf || msg.isSelf),
                channel: 'telegram_bot',
                timestamp: Number(msg.ts || data.timestamp || Date.now()),
                eventType: data.eventType || '',
                chatTitle: data.chatTitle || '',
                chatType: data.chatType || '',
                actorId: data.actorId || '',
                actorName: data.actorName || '',
            };
        }
        // ── Telegram trigger flattening ─────────────────────────────────────────
        if (triggerType === 'tg.trigger.message' || triggerType.startsWith('tg.trigger.')) {
            const envelope = data.message || data;
            const msg = envelope.data || data.data || envelope;
            const ch = data.channel || envelope.channel || msg.channel || '';
            const content = msg.preview || msg.content || msg.text || data.content || '';
            return {
                accountId: data.zaloId || data.accountId || '',
                chatId: data.threadId || envelope.threadId || msg.threadId || msg.chatId || '',
                fromId: msg.fromId || msg.senderId || msg.uidFrom || data.fromId || '',
                fromName: msg.fromName || msg.senderName || msg.dName || data.fromName || '',
                content,
                body: content,
                caption: msg.content || msg.text || data.content || '',
                preview: msg.preview || content,
                msgType: msg.msgType || msg.type || 'text',
                messageId: msg.msgId || msg.messageId || data.msgId || '',
                threadId: data.threadId || envelope.threadId || msg.threadId || '',
                isGroup: !!(msg.isGroup || envelope.type === 1 || data.isGroup),
                isSelf: !!(msg.isSelf || envelope.isSelf || data.isSelf),
                channel: ch,
                timestamp: Number(msg.timestamp || msg.ts || data.timestamp || Date.now()),
                attachments: msg.attachments || null,
            };
        }
        return { ...data };
    }
    // ─── Node Executor ────────────────────────────────────────────────────────
    async executeNode(node, cfg, ctx, _wf) {
        switch (node.type) {
            // ── Trigger nodes (just pass-through - already matched) ──────────────
            case 'trigger.message':
            case 'trigger.friendRequest':
            case 'trigger.groupEvent':
            case 'trigger.reaction':
            case 'trigger.undo':
            case 'trigger.schedule':
            case 'trigger.manual':
            case 'trigger.labelAssigned':
            case 'trigger.webhook':
            case 'tgbot.trigger.message':
            case 'tgbot.trigger.command':
            case 'tgbot.trigger.join':
            case 'tgbot.trigger.callback':
            case 'tgbot.trigger.editedMessage':
            case 'tgbot.trigger.joinRequest':
                return { ...ctx.trigger };
            case 'action.forwardCrossChannel': {
                const sourceAccountId = String(cfg.sourceAccountId || ctx.trigger?.accountId || ctx.trigger?.zaloId || ctx.trigger?.fbAccountId || ctx.pageId || '');
                const sourceChannel = String(cfg.sourceChannel || this.getAccountChannel(sourceAccountId) || ctx.trigger?.channel || '');
                const targetAccountId = String(cfg.targetAccountId || '');
                const targetChannel = String(cfg.targetChannel || '');
                const targetChatId = String(cfg.targetChatId || '');
                const messageId = String(cfg.messageId || ctx.trigger?.messageId || ctx.trigger?.msgId || '');
                if (!sourceAccountId || !sourceChannel)
                    throw new Error('[action.forwardCrossChannel] source account/channel required');
                if (!targetAccountId || !targetChannel || !targetChatId)
                    throw new Error('[action.forwardCrossChannel] target channel, account and chat required');
                let sourceMessage = null;
                if (messageId) {
                    try {
                        sourceMessage = DatabaseService_1.default.getInstance().getMessageById(sourceAccountId, messageId);
                    }
                    catch { }
                }
                // Media is persisted first, but its local download completes asynchronously.
                // Do not silently downgrade a just-arrived image/video/file to its caption.
                if (messageId && !this.getForwardMediaPath(sourceMessage) && this.isForwardMedia(sourceMessage, ctx.trigger)) {
                    sourceMessage = await this.waitForForwardMedia(sourceAccountId, messageId, sourceMessage);
                }
                const text = this.getForwardText(sourceMessage?.content ?? ctx.trigger?.content ?? '');
                const mediaPath = this.getForwardMediaPath(sourceMessage);
                const mediaType = String(sourceMessage?.msg_type || sourceMessage?.type || ctx.trigger?.msgType || '');
                const targetThreadType = this.resolveForwardTargetThreadType(targetChannel, cfg);
                const sourceIsMedia = this.isForwardMedia(sourceMessage, ctx.trigger);
                let nativeForwarded = false;
                if (mediaPath) {
                    const mediaResult = await this.sendForwardMedia(targetChannel, targetAccountId, targetChatId, mediaPath, mediaType, targetThreadType);
                    if (!mediaResult.success)
                        throw new Error(mediaResult.error || 'Không gửi được media chuyển tiếp');
                }
                else if (messageId && sourceChannel === targetChannel && sourceAccountId === targetAccountId && (sourceIsMedia || !text)) {
                    const sourceChatId = String(cfg.sourceChatId || ctx.trigger?.chatId || ctx.trigger?.threadId || sourceMessage?.thread_id || '');
                    if (!sourceChatId)
                        throw new Error('[action.forwardCrossChannel] sourceChatId required for native forward');
                    const nativeResult = await this.forwardNativeMessage(sourceChannel, sourceAccountId, sourceChatId, targetChatId, messageId, sourceMessage);
                    if (!nativeResult.success)
                        throw new Error(nativeResult.error || 'Không thể chuyển tiếp tin gốc');
                    nativeForwarded = true;
                }
                else if (sourceIsMedia) {
                    throw new Error('Tệp nguồn chưa tải xong trong 30 giây; không thể chuyển sang kênh hoặc tài khoản khác');
                }
                else if (!text) {
                    throw new Error('Tin nguồn không có nội dung để chuyển tiếp');
                }
                // Captions and the optional compose text deliberately travel as separate
                // messages, matching the chat forward modal and never replacing media.
                const texts = [nativeForwarded ? '' : text, String(cfg.companionText || '')].map(value => value.trim()).filter(Boolean);
                for (const item of texts) {
                    const result = await this.sendForwardText(targetChannel, targetAccountId, targetChatId, item, targetThreadType);
                    if (!result.success)
                        throw new Error(result.error || 'Không gửi được nội dung chuyển tiếp');
                }
                return { success: true, sourceAccountId, targetAccountId, targetChannel, mediaSent: !!mediaPath || nativeForwarded, textMessagesSent: texts.length };
            }
            // ── Zalo Actions ─────────────────────────────────────────────────────
            case 'zalo.sendMessage': return this.enqueueSend(cfg, ctx, async () => {
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.threadType) === 1 ? 1 : 0; // guard NaN → 0
                const targetThreadIds = this.resolveTargetThreadIds(cfg, ctx.trigger?.threadId);
                const continueOnError = cfg.continueOnError === true;
                Logger_1.default.info(`[WorkflowEngine] sendMessage: message="${(cfg.message || '').substring(0, 300)}", threadIds=${JSON.stringify(targetThreadIds)}, threadType=${threadType}, isEmpty=${!cfg.message?.trim()}`);
                // ─── Structured AI response handling ─────────────────────────────
                // Detect AI structured JSON: [{type:"text",content:"..."}, {type:"image",content:["url",...]}]
                const segments = (0, aiUtils_1.parseStructuredResponse)(cfg.message);
                if (segments) {
                    Logger_1.default.info(`[WorkflowEngine] Structured AI response: ${segments.length} segments`);
                    let lastMsgId = '';
                    for (const tid of targetThreadIds) {
                        try {
                            for (let i = 0; i < segments.length; i++) {
                                const seg = segments[i];
                                if (seg.type === 'text' && seg.content) {
                                    if (i > 0)
                                        await new Promise(r => setTimeout(r, 600));
                                    try {
                                        const destType = threadType === 0 ? 3 : undefined;
                                        await api.sendTypingEvent(tid, threadType, destType);
                                    }
                                    catch { }
                                    const typingDelay = Math.min(Math.max(String(seg.content).length * 30, 800), 3000);
                                    await new Promise(r => setTimeout(r, typingDelay));
                                    const res = await api.sendMessage({ msg: String(seg.content) }, tid, threadType);
                                    lastMsgId = res?.message?.msgId || lastMsgId;
                                }
                                else if (seg.type === 'image') {
                                    const urls = Array.isArray(seg.content) ? seg.content : [seg.content];
                                    for (const url of urls) {
                                        if (!url || typeof url !== 'string')
                                            continue;
                                        if (i > 0 || urls.indexOf(url) > 0)
                                            await new Promise(r => setTimeout(r, 500));
                                        try {
                                            const tempPath = await this.downloadUrlToTempFile(String(url));
                                            try {
                                                const res = await api.sendMessage({ msg: '', attachments: [tempPath] }, tid, threadType);
                                                lastMsgId = res?.attachment?.[0]?.msgId || res?.message?.msgId || lastMsgId;
                                            }
                                            finally {
                                                try {
                                                    fs.unlinkSync(tempPath);
                                                }
                                                catch { }
                                            }
                                        }
                                        catch (e) {
                                            Logger_1.default.warn(`[WorkflowEngine] Failed to send image ${url}: ${e.message}`);
                                            await api.sendMessage({ msg: String(url) }, tid, threadType);
                                        }
                                    }
                                }
                            }
                        }
                        catch (err) {
                            Logger_1.default.warn(`[WorkflowEngine] sendMessage to ${tid} failed: ${err.message}`);
                            if (!continueOnError)
                                throw err;
                        }
                    }
                    return { msgId: lastMsgId, success: true, structured: true, segmentCount: segments.length };
                }
                // ─── Plain text: loop qua nhiều thread ────────────────────────────
                let lastResult = { success: false, error: 'Không gửi được đến hội thoại nào' };
                for (const tid of targetThreadIds) {
                    try {
                        const result = await api.sendMessage({ msg: cfg.message }, tid, threadType);
                        lastResult = result;
                        Logger_1.default.log(`[WorkflowEngine] zalo.sendMessage to ${tid}: success=true, msgId=${result?.message?.msgId}`);
                    }
                    catch (err) {
                        Logger_1.default.warn(`[WorkflowEngine] zalo.sendMessage to ${tid} failed: ${err.message}`);
                        lastResult = { success: false, error: err.message };
                        if (!continueOnError)
                            throw err;
                    }
                }
                return {
                    msgId: lastResult?.message?.msgId || '',
                    success: true,
                    _targetCount: targetThreadIds.length,
                };
            });
            case 'zalo.sendTyping': {
                // Gửi sự kiện "đang gõ" rồi chờ delay trước khi bước tiếp theo chạy.
                // Mục đích: đặt thẻ này TRƯỚC zalo.sendMessage để tạo hiệu ứng tự nhiên.
                //   threadType 0 = DM (cần destType=3), 1 = Group (không cần destType)
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.threadType) === 1 ? 1 : 0;
                const destType = threadType === 0 ? 3 : undefined; // DestType.User=3
                try {
                    await api.sendTypingEvent(cfg.threadId, threadType, destType);
                }
                catch (e) {
                    Logger_1.default.warn(`[WorkflowEngine] sendTypingEvent warning: ${e.message}`);
                }
                const delayMs = Number(cfg.delaySeconds || 3) * 1000;
                await new Promise(r => setTimeout(r, Math.min(delayMs, 30000)));
                return { success: true, delayMs };
            }
            case 'zalo.sendImage': return this.enqueueSend(cfg, ctx, async () => {
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.threadType) === 1 ? 1 : 0;
                const targetThreadIds = this.resolveTargetThreadIds(cfg, ctx.trigger?.threadId);
                const continueOnError = cfg.continueOnError === true;
                let lastResult = { success: false, error: 'Không gửi được ảnh đến hội thoại nào' };
                for (const tid of targetThreadIds) {
                    try {
                        const result = await api.sendMessage({ msg: cfg.message || '', attachments: [cfg.filePath] }, tid, threadType);
                        lastResult = result;
                        Logger_1.default.log(`[WorkflowEngine] zalo.sendImage to ${tid}: success=true`);
                    }
                    catch (err) {
                        Logger_1.default.warn(`[WorkflowEngine] zalo.sendImage to ${tid} failed: ${err.message}`);
                        lastResult = { success: false, error: err.message };
                        if (!continueOnError)
                            throw err;
                    }
                }
                return {
                    msgId: lastResult?.attachment?.[0]?.msgId || '',
                    success: true,
                    _targetCount: targetThreadIds.length,
                };
            });
            case 'zalo.sendFile': return this.enqueueSend(cfg, ctx, async () => {
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.threadType) === 1 ? 1 : 0;
                const targetThreadIds = this.resolveTargetThreadIds(cfg, ctx.trigger?.threadId);
                const continueOnError = cfg.continueOnError === true;
                let lastResult = { success: false, error: 'Không gửi được file đến hội thoại nào' };
                for (const tid of targetThreadIds) {
                    try {
                        const result = await api.sendMessage({ msg: '', attachments: [cfg.filePath] }, tid, threadType);
                        lastResult = result;
                        Logger_1.default.log(`[WorkflowEngine] zalo.sendFile to ${tid}: success=true`);
                    }
                    catch (err) {
                        Logger_1.default.warn(`[WorkflowEngine] zalo.sendFile to ${tid} failed: ${err.message}`);
                        lastResult = { success: false, error: err.message };
                        if (!continueOnError)
                            throw err;
                    }
                }
                return {
                    success: true,
                    _targetCount: targetThreadIds.length,
                };
            });
            case 'zalo.findUser': {
                const api = this.getApi(ctx.pageId);
                const result = await api.findUser(cfg.phone);
                return {
                    userId: result?.data?.uid || '', displayName: result?.data?.displayName || '',
                    avatar: result?.data?.avatar || '', isFriend: !!(result?.data?.isFriend),
                };
            }
            case 'zalo.getUserInfo': {
                const api = this.getApi(ctx.pageId);
                const result = await api.getUserInfo({ userId: cfg.userId });
                return result?.data || {};
            }
            case 'zalo.acceptFriendRequest': {
                const api = this.getApi(ctx.pageId);
                await api.acceptFriendRequest(cfg.userId);
                return { success: true };
            }
            case 'zalo.rejectFriendRequest': {
                const api = this.getApi(ctx.pageId);
                await api.rejectFriendRequest(cfg.userId);
                return { success: true };
            }
            case 'zalo.sendFriendRequest': {
                const api = this.getApi(ctx.pageId);
                await api.sendFriendRequest(cfg.message || '', cfg.userId);
                return { success: true };
            }
            case 'zalo.addToGroup': {
                const api = this.getApi(ctx.pageId);
                await api.addUserToGroup({ groupId: cfg.groupId, members: [cfg.userId] });
                return { success: true };
            }
            case 'zalo.removeFromGroup': {
                const api = this.getApi(ctx.pageId);
                await api.removeUserFromGroup({ groupId: cfg.groupId, members: [cfg.userId] });
                return { success: true };
            }
            case 'zalo.undoMessage': {
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.threadType) === 1 ? 1 : 0;
                await api.undo({ msgId: cfg.msgId, threadId: cfg.threadId, threadType });
                return { success: true };
            }
            case 'zalo.setMute': {
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.threadType) === 1 ? 1 : 0;
                await api.setMute(cfg.threadId, threadType, cfg.duration ?? 0, cfg.action === 'mute' ? 1 : 0);
                return { success: true };
            }
            case 'zalo.getMessageHistory': {
                // Read from local DB instead of Zalo API (API may 404 or rate-limit)
                const zaloId = ctx.pageId;
                const threadId = cfg.threadId || ctx.trigger?.threadId || '';
                const count = Number(cfg.count ?? 20);
                const before = cfg.before ? Number(cfg.before) : undefined;
                if (!threadId)
                    throw new Error('[zalo.getMessageHistory] threadId required');
                const messages = DatabaseService_1.default.getInstance().getMessages(zaloId, threadId, count, 0, before);
                return { messages: messages || [] };
            }
            case 'zalo.forwardMessage': {
                const api = this.getApi(ctx.pageId);
                const threadType = Number(cfg.toThreadType ?? 0);
                const threadId = cfg.toThreadId;
                if (!threadId)
                    throw new Error('[zalo.forwardMessage] toThreadId required');
                const message = cfg.message || ctx.trigger?.content || '';
                const msgId = cfg.msgId || ctx.trigger?.msgId || '';
                // Tra DB lấy local_paths + msg_type từ tin nhắn gốc (giống chat sendOneForward)
                let localPaths = {};
                let dbMsgType = '';
                const triggerZaloId = ctx.trigger?.zaloId || ctx.pageId;
                if (msgId && triggerZaloId) {
                    try {
                        const stored = DatabaseService_1.default.getInstance().getMessageById(triggerZaloId, msgId);
                        if (stored) {
                            dbMsgType = stored.msg_type || '';
                            if (stored.local_paths) {
                                const parsed = typeof stored.local_paths === 'string'
                                    ? JSON.parse(stored.local_paths)
                                    : stored.local_paths;
                                if (parsed && typeof parsed === 'object')
                                    localPaths = parsed;
                            }
                        }
                    }
                    catch { }
                }
                // Ưu tiên gửi media (ảnh/file/video) trước - giống sendOneForward
                const mediaPath = localPaths.file || localPaths.video || localPaths.main || localPaths.hd || '';
                if (mediaPath) {
                    // Gửi media + text (caption) trong 1 lần
                    await api.sendMessage({ msg: message, attachments: [mediaPath] }, threadId, threadType);
                }
                else if (message) {
                    // Chỉ có text
                    await api.sendMessage({ msg: message, attachments: [] }, threadId, threadType);
                }
                else {
                    throw new Error('[zalo.forwardMessage] Missing message content');
                }
                return { success: true, msgId };
            }
            case 'zalo.createPoll': {
                const api = this.getApi(ctx.pageId);
                const options = String(cfg.options || '').split('\n').map((s) => s.trim()).filter(Boolean);
                await api.createPoll({
                    groupId: cfg.groupId,
                    question: cfg.question,
                    options,
                    allowMultiVote: !!cfg.allowMultiple,
                    expiredTime: Number(cfg.expireTime ?? 0),
                });
                return { success: true };
            }
            case 'zalo.addReaction': {
                const api = this.getApi(ctx.pageId);
                const reaction = resolveZaloWorkflowReaction(cfg.reactionType ?? 'LIKE');
                if (!reaction) {
                    throw new Error('[zalo.addReaction] Reaction không hợp lệ');
                }
                const msgId = String(cfg.msgId || ctx.trigger?.msgId || '').trim();
                // zca-js needs both the server message ID and the original client
                // message ID. For received messages those two IDs may be different.
                // Falling back to msgId makes the API accept the request in some cases,
                // but Zalo then silently does not apply the reaction.
                const configuredThreadId = String(cfg.threadId || '').trim();
                const triggerThreadId = String(ctx.trigger?.threadId || '').trim();
                const storedMessage = msgId
                    ? DatabaseService_1.default.getInstance().getMessageById(ctx.trigger?.zaloId || ctx.pageId, msgId, configuredThreadId || triggerThreadId || undefined)
                    : undefined;
                const threadId = configuredThreadId || triggerThreadId || String(storedMessage?.thread_id || '').trim();
                const configuredThreadType = cfg.threadType !== undefined && cfg.threadType !== ''
                    ? cfg.threadType
                    : undefined;
                const triggerThreadType = ctx.trigger?.threadType !== undefined && ctx.trigger?.threadType !== ''
                    ? ctx.trigger.threadType
                    : undefined;
                const threadType = Number(configuredThreadType ?? triggerThreadType ?? storedMessage?.thread_type ?? 0) === 1 ? 1 : 0;
                const cliMsgId = String(cfg.clientMsgId || ctx.trigger?.cliMsgId || storedMessage?.cli_msg_id || msgId).trim();
                if (!msgId)
                    throw new Error('[zalo.addReaction] Thiếu ID tin nhắn');
                if (!threadId)
                    throw new Error('[zalo.addReaction] Thiếu ID hội thoại');
                if (!cliMsgId)
                    throw new Error('[zalo.addReaction] Thiếu Client Message ID của tin nhắn');
                await api.addReaction(reaction, {
                    data: {
                        msgId,
                        cliMsgId,
                    },
                    threadId,
                    type: threadType,
                });
                return { success: true, msgId, cliMsgId, reaction };
            }
            case 'zalo.assignLabel': {
                // Giải mã labelIds: mảng "source:id" (new) hoặc fallback về labelId/labelSource cũ
                const rawIds = Array.isArray(cfg.labelIds) && cfg.labelIds.length > 0
                    ? cfg.labelIds
                    : (cfg.labelId ? [`${cfg.labelSource || 'local'}:${cfg.labelId}`] : []);
                if (cfg.labelSource === 'local') {
                    const localIds = rawIds
                        .filter(v => typeof v === 'string' && v.startsWith('local:'))
                        .map(v => Number(v.split(':')[1]))
                        .filter(Boolean);
                    for (const labelId of localIds) {
                        DatabaseService_1.default.getInstance().assignLocalLabelToThread(ctx.pageId, labelId, cfg.threadId);
                    }
                    return { success: true, source: 'local', labelIds: localIds, threadId: cfg.threadId };
                }
                else {
                    // Zalo: chỉ gắn 1 nhãn / hội thoại
                    const api = this.getApi(ctx.pageId);
                    const zaloEntry = rawIds.find(v => typeof v === 'string' && v.startsWith('zalo:')) || rawIds[0] || '';
                    const zaloRawId = typeof zaloEntry === 'string' && zaloEntry.includes(':')
                        ? zaloEntry.split(':')[1]
                        : String(zaloEntry || cfg.labelId || '');
                    const labelsRes = await api.getLabels();
                    const labelData = labelsRes?.labelData || labelsRes?.data?.labelData || [];
                    const version = labelsRes?.version || labelsRes?.data?.version || 0;
                    const label = labelData.find((l) => String(l.id) === String(zaloRawId));
                    if (label) {
                        const existingMembers = label.memberIds || [];
                        if (!existingMembers.includes(cfg.threadId)) {
                            label.memberIds = [...existingMembers, cfg.threadId];
                        }
                        await api.updateLabels({ labelData, version });
                    }
                    return { success: true, source: 'zalo', labelId: zaloRawId, threadId: cfg.threadId };
                }
            }
            case 'zalo.removeLabel': {
                const rawIds = Array.isArray(cfg.labelIds) && cfg.labelIds.length > 0
                    ? cfg.labelIds
                    : (cfg.labelId ? [`${cfg.labelSource || 'local'}:${cfg.labelId}`] : []);
                if (cfg.labelSource === 'local') {
                    const localIds = rawIds
                        .filter(v => typeof v === 'string' && v.startsWith('local:'))
                        .map(v => Number(v.split(':')[1]))
                        .filter(Boolean);
                    for (const labelId of localIds) {
                        DatabaseService_1.default.getInstance().removeLocalLabelFromThread(ctx.pageId, labelId, cfg.threadId);
                    }
                    return { success: true, source: 'local', labelIds: localIds, threadId: cfg.threadId };
                }
                else {
                    // Zalo: gỡ 1 nhãn / hội thoại
                    const api = this.getApi(ctx.pageId);
                    const zaloEntry = rawIds.find(v => typeof v === 'string' && v.startsWith('zalo:')) || rawIds[0] || '';
                    const zaloRawId = typeof zaloEntry === 'string' && zaloEntry.includes(':')
                        ? zaloEntry.split(':')[1]
                        : String(zaloEntry || cfg.labelId || '');
                    const labelsRes = await api.getLabels();
                    const labelData = labelsRes?.labelData || labelsRes?.data?.labelData || [];
                    const version = labelsRes?.version || labelsRes?.data?.version || 0;
                    const label = labelData.find((l) => String(l.id) === String(zaloRawId));
                    if (label) {
                        label.memberIds = (label.memberIds || []).filter((id) => id !== cfg.threadId);
                        await api.updateLabels({ labelData, version });
                    }
                    return { success: true, source: 'zalo', labelId: zaloRawId, threadId: cfg.threadId };
                }
            }
            case 'zalo.changeAliasName': {
                const api = this.getApi(ctx.pageId);
                const friendId = cfg.friendId || ctx.trigger?.fromId;
                if (!friendId)
                    throw new Error('[zalo.changeAliasName] friendId required');
                if (cfg.alias === undefined || cfg.alias === '')
                    throw new Error('[zalo.changeAliasName] alias required');
                const alias = String(cfg.alias);
                // 1. Gọi API Zalo đổi tên gợi nhớ
                await api.changeFriendAlias(alias, String(friendId));
                // 2. Cập nhật DB local (giống IPC handler db:setContactAlias)
                DatabaseService_1.default.getInstance().setContactAlias(ctx.pageId, String(friendId), alias);
                // 3. Broadcast cho nhân viên đang kết nối
                EventBroadcaster_1.default.emit('db:contactAliasChanged', { ownerZaloId: ctx.pageId, contactId: String(friendId), alias });
                return { success: true, friendId, alias };
            }
            // ── Logic Nodes ──────────────────────────────────────────────────────
            case 'logic.if': {
                const left = String(cfg.left ?? '');
                const right = String(cfg.right ?? '');
                const op = cfg.operator ?? 'equals';
                let result = false;
                switch (op) {
                    case 'equals':
                        result = left === right;
                        break;
                    case 'not_equals':
                        result = left !== right;
                        break;
                    case 'contains':
                        result = left.includes(right);
                        break;
                    case 'not_contains':
                        result = !left.includes(right);
                        break;
                    case 'starts_with':
                        result = left.startsWith(right);
                        break;
                    case 'ends_with':
                        result = left.endsWith(right);
                        break;
                    case 'greater_than':
                        result = this.compareValues(left, right) > 0;
                        break;
                    case 'less_than':
                        result = this.compareValues(left, right) < 0;
                        break;
                    case 'is_empty':
                        result = !left || left.trim() === '';
                        break;
                    case 'not_empty':
                        result = !!left && left.trim() !== '';
                        break;
                    case 'regex':
                        try {
                            result = new RegExp(right, 'i').test(left);
                        }
                        catch {
                            result = false;
                        }
                        break;
                }
                ctx.variables[`__if_${node.id}`] = result;
                return { result, branch: result ? 'true' : 'false' };
            }
            case 'logic.switch': {
                const val = String(cfg.value ?? '');
                const cases = cfg.cases || [];
                let matchedHandle = cfg.defaultLabel || 'default';
                for (const c of cases) {
                    if (String(c.match) === val) {
                        matchedHandle = c.label;
                        break;
                    }
                }
                ctx.variables[`__switch_${node.id}`] = matchedHandle;
                return { value: val, matchedHandle };
            }
            case 'logic.wait': {
                const ms = Number(cfg.delayMs ?? (Number(cfg.delaySeconds || 1) * 1000));
                await new Promise(r => setTimeout(r, Math.min(ms, 300000)));
                return { waited: ms };
            }
            case 'logic.setVariable': {
                ctx.variables[cfg.name] = cfg.value;
                return { [cfg.name]: cfg.value };
            }
            case 'logic.stopIf': {
                const left = String(cfg.left ?? '');
                const right = String(cfg.right ?? '');
                const op = cfg.operator ?? 'equals';
                let stop = false;
                switch (op) {
                    case 'equals':
                        stop = left === right;
                        break;
                    case 'not_equals':
                        stop = left !== right;
                        break;
                    case 'contains':
                        stop = left.includes(right);
                        break;
                    case 'not_contains':
                        stop = !left.includes(right);
                        break;
                    case 'starts_with':
                        stop = left.startsWith(right);
                        break;
                    case 'ends_with':
                        stop = left.endsWith(right);
                        break;
                    case 'greater_than':
                        stop = this.compareValues(left, right) > 0;
                        break;
                    case 'less_than':
                        stop = this.compareValues(left, right) < 0;
                        break;
                    case 'is_empty':
                        stop = !left || left.trim() === '';
                        break;
                    case 'not_empty':
                        stop = !!left && left.trim() !== '';
                        break;
                    case 'regex':
                        try {
                            stop = new RegExp(right, 'i').test(left);
                        }
                        catch {
                            stop = false;
                        }
                        break;
                }
                if (stop)
                    throw new Error('__STOP__');
                return { stopped: false };
            }
            case 'logic.forEach': {
                let arr = [];
                try {
                    arr = Array.isArray(cfg.array) ? cfg.array : JSON.parse(cfg.array || '[]');
                }
                catch { }
                return { items: arr, count: arr.length };
            }
            // ── Data Nodes ───────────────────────────────────────────────────────
            case 'data.textFormat':
                return { result: cfg.template || '' };
            case 'data.jsonParse': {
                try {
                    const parsed = typeof cfg.input === 'string' ? JSON.parse(cfg.input) : cfg.input;
                    return { data: parsed };
                }
                catch {
                    return { data: null, error: 'JSON parse failed' };
                }
            }
            case 'data.dateFormat': {
                const d = cfg.date ? new Date(cfg.date) : new Date();
                const opts = { timeZone: 'Asia/Ho_Chi_Minh' };
                if (cfg.format === 'full') {
                    opts.dateStyle = 'full';
                    opts.timeStyle = 'short';
                }
                else if (cfg.format === 'date') {
                    opts.dateStyle = 'short';
                }
                else if (cfg.format === 'time') {
                    opts.timeStyle = 'short';
                }
                else {
                    opts.dateStyle = 'short';
                    opts.timeStyle = 'short';
                }
                return { result: new Intl.DateTimeFormat('vi-VN', opts).format(d), timestamp: d.getTime() };
            }
            case 'data.randomPick': {
                const options = String(cfg.options || '').split('\n').map((s) => s.trim()).filter(Boolean);
                const picked = options.length > 0 ? options[Math.floor(Math.random() * options.length)] : '';
                return { result: picked };
            }
            // ── Output Nodes ─────────────────────────────────────────────────────
            case 'output.httpRequest': {
                let headers = {};
                let body = undefined;
                let params = undefined;
                const method = (cfg.method || 'POST').toUpperCase();
                const url = cfg.url || '';
                try {
                    headers = cfg.headers ? (typeof cfg.headers === 'string' ? JSON.parse(cfg.headers) : cfg.headers) : {};
                }
                catch { }
                try {
                    body = cfg.body ? (typeof cfg.body === 'string' ? JSON.parse(cfg.body) : cfg.body) : undefined;
                }
                catch {
                    body = cfg.body;
                }
                try {
                    params = cfg.params ? (typeof cfg.params === 'string' ? JSON.parse(cfg.params) : cfg.params) : undefined;
                }
                catch { }
                const startTime = Date.now();
                try {
                    const response = await (0, axios_1.default)({
                        method,
                        url,
                        headers,
                        data: body,
                        params,
                        timeout: Number(cfg.timeout ?? 10000),
                        // Accept all HTTP status codes - 4xx/5xx are valid business responses,
                        // not node errors. Let the workflow logic (e.g. logic.if) decide success/failure.
                        validateStatus: () => true,
                    });
                    return {
                        status: response.status,
                        statusText: response.statusText,
                        data: response.data,
                        headers: response.headers,
                        _request: { method, url, headers, body, params },
                        _durationMs: Date.now() - startTime,
                    };
                }
                catch (axiosErr) {
                    // Network errors (ECONNREFUSED, DNS, timeout) - don't throw, return
                    // structured error response so downstream nodes can always access output.
                    const isTimeout = axiosErr.code === 'ECONNABORTED' || axiosErr.message?.includes('timeout');
                    const isConnRefused = axiosErr.code === 'ECONNREFUSED';
                    const isDns = axiosErr.code === 'ENOTFOUND' || axiosErr.code === 'EAI_AGAIN';
                    return {
                        status: 0,
                        statusText: '',
                        data: null,
                        _error: true,
                        _errorType: isTimeout ? 'timeout' : isConnRefused ? 'connection_refused' : isDns ? 'dns_error' : 'network_error',
                        _errorMessage: axiosErr.message,
                        _request: { method, url, headers, body, params },
                        _durationMs: Date.now() - startTime,
                    };
                }
            }
            case 'output.log': {
                const level = cfg.level || 'info';
                const msg = `[Workflow "${ctx._wfName}"] ${cfg.message}`;
                if (level === 'error')
                    Logger_1.default.error(msg);
                else if (level === 'warn')
                    Logger_1.default.warn(msg);
                else
                    Logger_1.default.log(msg);
                return { logged: cfg.message };
            }
            // ── Google Sheets ────────────────────────────────────────────────────
            case 'sheets.appendRow': {
                if (!cfg.spreadsheetId)
                    throw new Error('[sheets.appendRow] spreadsheetId required');
                if (!cfg.serviceAccountPath)
                    throw new Error('[sheets.appendRow] serviceAccountPath required');
                const auth = new googleapis_1.google.auth.GoogleAuth({
                    keyFile: cfg.serviceAccountPath,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
                let rowValues;
                try {
                    const parsed = typeof cfg.values === 'string' ? JSON.parse(cfg.values) : cfg.values;
                    rowValues = Array.isArray(parsed[0]) ? parsed : [parsed];
                }
                catch {
                    // JSON parse failed (e.g., template vars contain special chars) → split by newline or single cell
                    const raw = String(cfg.values ?? '');
                    const lines = raw.split('\n').filter(Boolean);
                    rowValues = lines.length > 0 ? [lines] : [[raw]];
                }
                const res = await sheets.spreadsheets.values.append({
                    spreadsheetId: cfg.spreadsheetId,
                    range: `${cfg.sheetName || 'Sheet1'}!A:Z`,
                    valueInputOption: 'USER_ENTERED',
                    insertDataOption: 'INSERT_ROWS',
                    requestBody: { values: rowValues },
                }, { timeout: 30000 });
                return {
                    success: true,
                    updatedRange: res.data.updates?.updatedRange || '',
                    updatedRows: res.data.updates?.updatedRows || 0,
                };
            }
            case 'sheets.readValues': {
                if (!cfg.spreadsheetId)
                    throw new Error('[sheets.readValues] spreadsheetId required');
                if (!cfg.serviceAccountPath)
                    throw new Error('[sheets.readValues] serviceAccountPath required');
                const auth = new googleapis_1.google.auth.GoogleAuth({
                    keyFile: cfg.serviceAccountPath,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
                });
                const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
                const range = cfg.range || 'Sheet1!A1:Z1000';
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: cfg.spreadsheetId,
                    range,
                }, { timeout: 30000 });
                const rows = res.data.values || [];
                return { rows, count: rows.length, firstRow: rows[0] || [] };
            }
            case 'sheets.updateCell': {
                if (!cfg.spreadsheetId)
                    throw new Error('[sheets.updateCell] spreadsheetId required');
                if (!cfg.serviceAccountPath)
                    throw new Error('[sheets.updateCell] serviceAccountPath required');
                if (!cfg.range)
                    throw new Error('[sheets.updateCell] range required');
                const auth = new googleapis_1.google.auth.GoogleAuth({
                    keyFile: cfg.serviceAccountPath,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
                await sheets.spreadsheets.values.update({
                    spreadsheetId: cfg.spreadsheetId,
                    range: cfg.range,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[cfg.value]] },
                }, { timeout: 30000 });
                return { success: true, range: cfg.range };
            }
            // ── AI (Multi-platform: OpenAI, Gemini, Deepseek, Grok) ─────────────
            case 'ai.generateText': {
                // If assistantId is provided, delegate to AIAssistantService
                if (cfg.assistantId) {
                    try {
                        const AIAssistantService = (await Promise.resolve().then(() => __importStar(require('../ai/AIAssistantService')))).default;
                        const chatMsgs = [];
                        // Add chat history if provided
                        if (cfg.chatHistory) {
                            try {
                                let history = typeof cfg.chatHistory === 'string' && cfg.chatHistory.trim()
                                    ? JSON.parse(cfg.chatHistory) : (Array.isArray(cfg.chatHistory) ? cfg.chatHistory : []);
                                const maxMsgs = Number(cfg.maxHistoryMessages ?? 20);
                                if (history.length > maxMsgs)
                                    history = history.slice(-maxMsgs);
                                for (const msg of history) {
                                    if (msg?.role && msg?.content) {
                                        chatMsgs.push({ role: msg.role, content: String(msg.content) });
                                    }
                                    else if (msg && typeof msg === 'object') {
                                        const content = msg.content?.msg || (typeof msg.content === 'string' ? msg.content : '');
                                        if (content.trim())
                                            chatMsgs.push({ role: msg.isSelf ? 'assistant' : 'user', content });
                                    }
                                }
                            }
                            catch { }
                        }
                        chatMsgs.push({ role: 'user', content: cfg.prompt });
                        const result = await AIAssistantService.getInstance().chatForWorkflow(cfg.assistantId, chatMsgs);
                        Logger_1.default.info(`[WorkflowEngine] AI assistant response: success=${!!result.result}, length=${result.result?.length || 0}, preview="${(result.result || '').substring(0, 200)}", tokens=${result.totalTokens}`);
                        return { result: result.result, totalTokens: result.totalTokens, model: 'assistant' };
                    }
                    catch (e) {
                        throw new Error(`Trợ lý AI lỗi: ${e.message}`);
                    }
                }
                const messages = [];
                if (cfg.systemPrompt)
                    messages.push({ role: 'system', content: cfg.systemPrompt });
                // ── Chat history (ngữ cảnh cuộc hội thoại) ────────────────────────
                if (cfg.chatHistory) {
                    try {
                        let history = [];
                        if (typeof cfg.chatHistory === 'string' && cfg.chatHistory.trim()) {
                            history = JSON.parse(cfg.chatHistory);
                        }
                        else if (Array.isArray(cfg.chatHistory)) {
                            history = cfg.chatHistory;
                        }
                        const maxMsgs = Number(cfg.maxHistoryMessages ?? 20);
                        // Trim to maxMsgs (most recent)
                        if (history.length > maxMsgs)
                            history = history.slice(-maxMsgs);
                        for (const msg of history) {
                            if (msg && typeof msg === 'object') {
                                if (msg.role && msg.content) {
                                    // Already OpenAI format { role, content }
                                    messages.push({ role: msg.role, content: String(msg.content) });
                                }
                                else {
                                    // Zalo message format – convert automatically
                                    const content = msg.content?.msg
                                        || (typeof msg.content === 'string' ? msg.content : '')
                                        || '';
                                    if (content.trim()) {
                                        // isSelf = true → bot/assistant sent it; false → user sent it
                                        messages.push({ role: msg.isSelf ? 'assistant' : 'user', content });
                                    }
                                }
                            }
                        }
                    }
                    catch {
                        // Ignore parse errors - just proceed without history
                    }
                }
                messages.push({ role: 'user', content: cfg.prompt });
                const platform = cfg.platform || 'openai';
                const rawModel = cfg.model || '';
                const maxTokens = Number(cfg.maxTokens || 500);
                const temperature = Number(cfg.temperature ?? 0.7);
                const response = await (0, AIProviderAdapter_1.requestAICompletion)({ platform, model: rawModel, apiKey: cfg.apiKey, messages, maxTokens, temperature });
                return { result: response.result, totalTokens: response.totalTokens, model: response.model };
            }
            case 'ai.classify': {
                const categories = String(cfg.categories || '')
                    .split(',').map((s) => s.trim()).filter(Boolean);
                const systemMsg = `Bạn là bộ phân loại văn bản. Hãy phân loại đoạn văn bản đầu vào vào MỘT trong các danh mục sau: ${categories.join(', ')}. Chỉ trả về đúng tên danh mục, không giải thích thêm.`;
                // If assistantId is provided, delegate to AIAssistantService
                if (cfg.assistantId) {
                    try {
                        const AIAssistantService = (await Promise.resolve().then(() => __importStar(require('../ai/AIAssistantService')))).default;
                        const chatMsgs = [
                            { role: 'system', content: systemMsg },
                            { role: 'user', content: cfg.input },
                        ];
                        const result = await AIAssistantService.getInstance().chat(cfg.assistantId, chatMsgs);
                        const category = (result.result || '').trim();
                        return { category, input: cfg.input };
                    }
                    catch (e) {
                        throw new Error(`Trợ lý AI lỗi: ${e.message}`);
                    }
                }
                const platform = cfg.platform || 'openai';
                const classifyMessages = [
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: cfg.input },
                ];
                const response = await (0, AIProviderAdapter_1.requestAICompletion)({
                    platform,
                    model: cfg.model || '',
                    apiKey: cfg.apiKey,
                    messages: classifyMessages,
                    maxTokens: 30,
                    temperature: 0,
                });
                return { category: response.result.trim(), input: cfg.input, model: response.model };
            }
            // ── Notify: Telegram ─────────────────────────────────────────────────
            case 'notify.telegram': {
                // Resolve botToken: ưu tiên Integration, fallback cfg.botToken (legacy)
                let botToken = cfg.botToken || '';
                if (cfg.integrationId) {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        const IntegrationRegistry = require('../integrations/IntegrationRegistry').default;
                        const integration = IntegrationRegistry.getIntegration(cfg.integrationId);
                        if (integration?.credentials?.botToken) {
                            botToken = integration.credentials.botToken;
                        }
                    }
                    catch (err) {
                        Logger_1.default.warn(`[WorkflowEngine] Không tìm thấy Integration ${cfg.integrationId}: ${err}`);
                    }
                }
                if (!botToken) {
                    return { success: false, error: 'Thiếu Bot Token. Hãy cấu hình Integration Telegram Bot trong Settings.' };
                }
                const message = this.resolveMessageFromConfigOrUpstream(node, cfg, ctx, _wf);
                if (!message.text) {
                    throw new Error('[notify.telegram] Nội dung thông báo đang trống. Nhập nội dung hoặc nối một node tạo văn bản ngay trước node này.');
                }
                const payload = {
                    chat_id: cfg.chatId,
                    text: message.text,
                };
                if (cfg.parseMode)
                    payload.parse_mode = cfg.parseMode;
                const res = await axios_1.default.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload, { timeout: 10000 });
                return {
                    success: true,
                    messageId: res.data.result?.message_id || '',
                    contentSource: message.source,
                };
            }
            // ── Notify: Discord ───────────────────────────────────────────────────
            case 'notify.discord': {
                const payload = {
                    content: cfg.message,
                    username: cfg.username || 'DepLao Bot',
                };
                if (cfg.avatarUrl)
                    payload.avatar_url = cfg.avatarUrl;
                await axios_1.default.post(cfg.webhookUrl, payload, { timeout: 10000 });
                return { success: true };
            }
            // ── Notify: Email ─────────────────────────────────────────────────────
            case 'notify.email': {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: cfg.smtpHost || 'smtp.gmail.com',
                    port: Number(cfg.smtpPort || 587),
                    secure: Number(cfg.smtpPort) === 465,
                    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
                    tls: { rejectUnauthorized: false },
                });
                const info = await transporter.sendMail({
                    from: cfg.from || cfg.smtpUser,
                    to: cfg.to,
                    subject: cfg.subject,
                    ...(cfg.isHtml ? { html: cfg.body } : { text: cfg.body }),
                });
                return { success: true, messageId: info.messageId || '' };
            }
            // ── Notify: Notion ────────────────────────────────────────────────────
            case 'notify.notion': {
                let properties = {};
                try {
                    properties = typeof cfg.properties === 'string'
                        ? JSON.parse(cfg.properties)
                        : (cfg.properties || {});
                }
                catch {
                    properties = {};
                }
                const res = await axios_1.default.post('https://api.notion.com/v1/pages', { parent: { database_id: cfg.databaseId }, properties }, {
                    headers: {
                        Authorization: `Bearer ${cfg.apiKey}`,
                        'Notion-Version': '2022-06-28',
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000,
                });
                return {
                    success: true,
                    pageId: res.data.id || '',
                    url: res.data.url || '',
                };
            }
            // ── P0: trigger.payment (pass-through like other triggers) ──────────────
            case 'trigger.payment':
                return { ...ctx.trigger };
            // ── P0: KiotViet POS ─────────────────────────────────────────────────
            case 'kiotviet.lookupCustomer': {
                const result = await IntegrationRegistry_1.default.executeActionByType('kiotviet', 'lookupCustomer', {
                    phone: cfg.phone,
                });
                const customers = result.customers || [];
                return { customers, found: customers.length > 0, firstCustomer: customers[0] || null };
            }
            case 'kiotviet.lookupOrder': {
                const result = await IntegrationRegistry_1.default.executeActionByType('kiotviet', 'lookupOrder', {
                    phone: cfg.phone,
                    orderId: cfg.orderId,
                });
                const orders = result.orders || (result.order ? [result.order] : []);
                return { orders, order: result.order || orders[0] || null, found: orders.length > 0 };
            }
            case 'kiotviet.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : (cfg.order || {});
                }
                catch { }
                if (!cfg.order || Object.keys(orderObj || {}).length === 0) {
                    let orderDetails = [];
                    try {
                        orderDetails = Array.isArray(cfg.orderDetails)
                            ? cfg.orderDetails
                            : JSON.parse(String(cfg.orderDetails || '[]'));
                    }
                    catch { }
                    orderObj = {
                        ...(cfg.branchId ? { branchId: Number(cfg.branchId) } : {}),
                        ...(cfg.customerId ? { customerId: cfg.customerId } : {}),
                        orderDetails,
                        discount: Number(cfg.discount || 0),
                        description: cfg.note || undefined,
                    };
                }
                const result = await IntegrationRegistry_1.default.executeActionByType('kiotviet', 'createOrder', orderObj);
                return { order: result.order || result, success: true };
            }
            case 'kiotviet.lookupProduct': {
                const result = await IntegrationRegistry_1.default.executeActionByType('kiotviet', 'lookupProduct', {
                    keyword: cfg.keyword, code: cfg.code, limit: Number(cfg.limit || 10),
                });
                return { products: result.products || [], found: result.found };
            }
            // ── P0: Haravan POS ──────────────────────────────────────────────────
            case 'haravan.lookupCustomer': {
                const result = await IntegrationRegistry_1.default.executeActionByType('haravan', 'lookupCustomer', { phone: cfg.phone });
                return { customers: result.customers || [], found: result.found, firstCustomer: result.firstCustomer || null };
            }
            case 'haravan.lookupOrder': {
                const result = await IntegrationRegistry_1.default.executeActionByType('haravan', 'lookupOrder', { phone: cfg.phone, orderId: cfg.orderId });
                const orders = result.orders || (result.order ? [result.order] : []);
                return { orders, order: result.order || orders[0] || null, found: orders.length > 0 };
            }
            case 'haravan.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : cfg.order;
                }
                catch { }
                const result = await IntegrationRegistry_1.default.executeActionByType('haravan', 'createOrder', { order: orderObj });
                return { order: result.order || result, success: true };
            }
            case 'haravan.lookupProduct': {
                const result = await IntegrationRegistry_1.default.executeActionByType('haravan', 'lookupProduct', {
                    keyword: cfg.keyword, limit: Number(cfg.limit || 10),
                });
                return { products: result.products || [], found: result.found };
            }
            // ── P0: Sapo POS ─────────────────────────────────────────────────────
            case 'sapo.lookupCustomer': {
                const result = await IntegrationRegistry_1.default.executeActionByType('sapo', 'lookupCustomer', { phone: cfg.phone });
                return { customers: result.customers || [], found: result.found, firstCustomer: result.firstCustomer || null };
            }
            case 'sapo.lookupOrder': {
                const result = await IntegrationRegistry_1.default.executeActionByType('sapo', 'lookupOrder', { phone: cfg.phone, orderId: cfg.orderId });
                const orders = result.orders || (result.order ? [result.order] : []);
                return { orders, order: result.order || orders[0] || null, found: orders.length > 0 };
            }
            case 'sapo.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : cfg.order;
                }
                catch { }
                const result = await IntegrationRegistry_1.default.executeActionByType('sapo', 'createOrder', { order: orderObj });
                return { order: result.order || result, success: true };
            }
            case 'sapo.lookupProduct': {
                const result = await IntegrationRegistry_1.default.executeActionByType('sapo', 'lookupProduct', {
                    keyword: cfg.keyword, limit: Number(cfg.limit || 10),
                });
                return { products: result.products || [], found: result.found };
            }
            case 'sapo.getInventory': {
                const result = await IntegrationRegistry_1.default.executeActionByType('sapo', 'getInventory', {
                    limit: Number(cfg.limit || 50),
                });
                return { items: result.items || [] };
            }
            // ── P0: Nhanh.vn ─────────────────────────────────────────────────────
            case 'nhanh.lookupCustomer': {
                const result = await IntegrationRegistry_1.default.executeActionByType('nhanh', 'lookupCustomer', { phone: cfg.phone });
                return { customers: result.customers || [], found: result.found, firstCustomer: result.firstCustomer || null };
            }
            case 'nhanh.lookupOrder': {
                const result = await IntegrationRegistry_1.default.executeActionByType('nhanh', 'lookupOrder', { phone: cfg.phone, orderId: cfg.orderId });
                const orders = result.orders || (result.order ? [result.order] : []);
                return { orders, order: result.order || orders[0] || null, found: orders.length > 0 };
            }
            case 'nhanh.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : cfg.order;
                }
                catch { }
                const result = await IntegrationRegistry_1.default.executeActionByType('nhanh', 'createOrder', { order: orderObj });
                return { order: result.order || result, success: true };
            }
            case 'nhanh.lookupProduct': {
                const result = await IntegrationRegistry_1.default.executeActionByType('nhanh', 'lookupProduct', {
                    keyword: cfg.keyword, code: cfg.code, limit: Number(cfg.limit || 10),
                });
                return { products: result.products || [], found: result.found };
            }
            // ── P0: Pancake POS ───────────────────────────────────────────────────
            case 'pancake.lookupCustomer': {
                const result = await IntegrationRegistry_1.default.executeActionByType('pancake', 'lookupCustomer', { phone: cfg.phone });
                return { customers: result.customers || [], found: result.found, firstCustomer: result.firstCustomer || null };
            }
            case 'pancake.lookupOrder': {
                const result = await IntegrationRegistry_1.default.executeActionByType('pancake', 'lookupOrder', { phone: cfg.phone, orderId: cfg.orderId });
                const orders = result.orders || (result.order ? [result.order] : []);
                return { orders, order: result.order || orders[0] || null, found: orders.length > 0 };
            }
            case 'pancake.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : cfg.order;
                }
                catch { }
                const result = await IntegrationRegistry_1.default.executeActionByType('pancake', 'createOrder', { order: orderObj });
                return { order: result.order || result, success: true };
            }
            case 'pancake.lookupProduct': {
                const result = await IntegrationRegistry_1.default.executeActionByType('pancake', 'lookupProduct', {
                    keyword: cfg.keyword, code: cfg.code, limit: Number(cfg.limit || 10),
                });
                return { products: result.products || [], found: result.found };
            }
            // ── P0: Payment (Casso/SePay) ─────────────────────────────────────────
            case 'payment.getTransactions': {
                const type = cfg.integrationType || 'casso';
                const result = await IntegrationRegistry_1.default.executeActionByType(type, 'getTransactions', {
                    limit: Number(cfg.limit || 20),
                    fromDate: cfg.fromDate,
                    toDate: cfg.toDate,
                });
                return { transactions: result.transactions || [], total: result.total || 0 };
            }
            // ── P0: GHN Express ──────────────────────────────────────────────────
            case 'ghn.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : (cfg.order || {});
                }
                catch { }
                orderObj = {
                    ...orderObj,
                    ...(cfg.toName ? { to_name: cfg.toName } : {}),
                    ...(cfg.toPhone ? { to_phone: cfg.toPhone } : {}),
                    ...(cfg.toAddress ? { to_address: cfg.toAddress } : {}),
                    ...(cfg.toDistrictId ? { to_district_id: Number(cfg.toDistrictId) } : {}),
                    ...(cfg.toWardCode ? { to_ward_code: cfg.toWardCode } : {}),
                    ...(cfg.weight ? { weight: Number(cfg.weight) } : {}),
                    ...(cfg.serviceTypeId ? { service_type_id: Number(cfg.serviceTypeId) } : {}),
                    ...(cfg.codAmount != null && String(cfg.codAmount) !== '' ? { cod_amount: Number(cfg.codAmount) } : {}),
                };
                const result = await IntegrationRegistry_1.default.executeActionByType('ghn', 'createOrder', {
                    order: orderObj,
                });
                return { order: result.order || {}, orderCode: result.order?.order_code || '', success: true };
            }
            case 'ghn.getTracking': {
                const result = await IntegrationRegistry_1.default.executeActionByType('ghn', 'getTracking', {
                    orderCode: cfg.orderCode,
                });
                const tracking = result.tracking || {};
                return {
                    tracking,
                    status: tracking.status || '',
                    orderCode: tracking.order_code || cfg.orderCode,
                    updatedDate: tracking.updated_date || '',
                };
            }
            case 'ghn.getProvinces': {
                const result = await IntegrationRegistry_1.default.executeActionByType('ghn', 'getProvinces', {});
                return { provinces: result.provinces || [] };
            }
            case 'ghn.getDistricts': {
                const result = await IntegrationRegistry_1.default.executeActionByType('ghn', 'getDistricts', {
                    provinceId: Number(cfg.provinceId || 0),
                });
                return { districts: result.districts || [] };
            }
            case 'ghn.getWards': {
                const result = await IntegrationRegistry_1.default.executeActionByType('ghn', 'getWards', {
                    districtId: Number(cfg.districtId || 0),
                });
                return { wards: result.wards || [] };
            }
            case 'ghn.getServices': {
                const result = await IntegrationRegistry_1.default.executeActionByType('ghn', 'getServices', {
                    fromDistrict: Number(cfg.fromDistrict || 0),
                    toDistrict: Number(cfg.toDistrict || 0),
                });
                return { services: result.services || [] };
            }
            // ── P0: GHTK ─────────────────────────────────────────────────────────
            case 'ghtk.createOrder': {
                let orderObj = {};
                try {
                    orderObj = typeof cfg.order === 'string' ? JSON.parse(cfg.order) : cfg.order;
                }
                catch { }
                const result = await IntegrationRegistry_1.default.executeActionByType('ghtk', 'createOrder', orderObj);
                return { order: result.order || {}, trackingCode: result.order?.label || '', success: true };
            }
            case 'ghtk.getTracking': {
                const result = await IntegrationRegistry_1.default.executeActionByType('ghtk', 'getTracking', {
                    trackingCode: cfg.trackingCode,
                });
                const tracking = result.tracking || {};
                return {
                    tracking,
                    status: tracking.status_text || tracking.status || '',
                    trackingCode: tracking.label || cfg.trackingCode,
                };
            }
            // ── Telegram ──────────────────────────────────────────────────────────────
            case 'tg.trigger.message':
                return { ...ctx.trigger };
            // ── Facebook ─────────────────────────────────────────────────────────────
            case 'fb.trigger.message':
            case 'fb.trigger.image':
            case 'fb.trigger.video':
            case 'fb.trigger.file':
            case 'fb.trigger.sticker':
            case 'fb.trigger.reaction':
            case 'fb.trigger.unsend':
            case 'fb.trigger.groupEvent':
                return { ...ctx.trigger };
            case 'fb.action.sendMessage': {
                const rawAccountId = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawAccountId)
                    throw new Error('[fb.action.sendMessage] accountId required');
                const accountId = this.resolveFBAccountId(rawAccountId);
                if (!cfg.message)
                    throw new Error('[fb.action.sendMessage] message required');
                const targetThreadIds = this.resolveTargetThreadIds(cfg, ctx.trigger?.threadId);
                if (!targetThreadIds.length)
                    throw new Error('[fb.action.sendMessage] threadId/threadIds required');
                // Parse structured AI response (giống zalo.sendMessage) - nếu là JSON array segments
                // thì join text lại thành 1 message, tránh gửi raw JSON ra cho khách
                const segments = (0, aiUtils_1.parseStructuredResponse)(cfg.message);
                const finalMessage = segments
                    ? segments
                        .filter((s) => s.type === 'text' && s.content)
                        .map((s) => String(s.content).trim())
                        .join('\n\n')
                    : String(cfg.message || '');
                const continueOnError = cfg.continueOnError === true;
                let lastResult = { success: false, error: 'Không gửi được đến hội thoại nào' };
                for (const tid of targetThreadIds) {
                    try {
                        const result = await FacebookSendService_1.FacebookSendService.sendTextMessage({
                            accountId,
                            threadId: tid,
                            body: finalMessage || String(cfg.message || ''),
                            typeChat: Object.prototype.hasOwnProperty.call(cfg, 'typeChat')
                                ? cfg.typeChat
                                : ctx.trigger?.typeChat,
                            replyToMessageId: cfg.replyToMessageId,
                        });
                        lastResult = result;
                        Logger_1.default.log(`[WorkflowEngine] fb.action.sendMessage to ${tid}: success=${result.success}, msgId=${result.messageId}`);
                        if (!result.success && !continueOnError) {
                            throw new Error(result.error || `Không gửi được tin nhắn đến ${tid}`);
                        }
                    }
                    catch (err) {
                        Logger_1.default.warn(`[WorkflowEngine] fb.action.sendMessage to ${tid} failed: ${err.message}`);
                        lastResult = { success: false, error: err.message };
                        if (!continueOnError)
                            throw err;
                    }
                }
                return {
                    success: lastResult.success,
                    messageId: lastResult.messageId,
                    ...(lastResult.error ? { error: lastResult.error } : {}),
                    _targetCount: targetThreadIds.length,
                };
            }
            case 'fb.action.addReaction': {
                const rawAccountId = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawAccountId)
                    throw new Error('[fb.action.addReaction] accountId required');
                const accountId = this.resolveFBAccountId(rawAccountId);
                const service = await FacebookService_1.FacebookService.getInstance(accountId);
                const messageId = cfg.messageId || ctx.trigger?.messageId;
                if (!messageId)
                    throw new Error('[fb.action.addReaction] messageId required');
                // FacebookService resolves the message's actual thread and original
                // sender from DB, then chooses encrypted or group reaction safely.
                const result = await service.addReaction(String(messageId), cfg.emoji || '👍', cfg.action || 'add');
                this.assertFacebookActionSucceeded('thả reaction', result);
                return { success: result.success, ...(result.error ? { error: result.error } : {}) };
            }
            case 'fb.action.sendImage': {
                // DEPLAO_ADAPTER: Delegate to FacebookSendService.sendAttachment() —
                // single entry point for all Facebook attachment sends.
                const rawAccountId = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawAccountId)
                    throw new Error('[fb.action.sendImage] accountId required');
                const accountId = this.resolveFBAccountId(rawAccountId);
                const targetThreadIds = this.resolveTargetThreadIds(cfg, ctx.trigger?.threadId);
                if (!targetThreadIds.length)
                    throw new Error('[fb.action.sendImage] threadId/threadIds required');
                const requestedFilePath = String(cfg.filePath || '').trim();
                if (!requestedFilePath)
                    throw new Error('[fb.action.sendImage] filePath required');
                const caption = cfg.body || cfg.message || '';
                const continueOnError = cfg.continueOnError === true;
                // Resolve typeChat once from workflow config or trigger context
                const suppliedTypeChat = Object.prototype.hasOwnProperty.call(cfg, 'typeChat')
                    ? cfg.typeChat
                    : ctx.trigger?.typeChat;
                // The picker also accepts a URL. Download it once to a local temporary
                // file because FacebookSendService correctly validates local files
                // before selecting the E2EE or REST attachment route.
                let filePath = requestedFilePath;
                let temporaryPath = '';
                try {
                    if (/^https?:\/\//i.test(requestedFilePath)) {
                        temporaryPath = await this.downloadUrlToTempFile(requestedFilePath);
                        filePath = temporaryPath;
                    }
                    let lastResult = { success: false, error: 'Không gửi được đến hội thoại nào' };
                    for (const threadId of targetThreadIds) {
                        try {
                            const result = await FacebookSendService_1.FacebookSendService.sendAttachment({
                                accountId,
                                threadId: String(threadId),
                                filePath,
                                body: caption || undefined,
                                typeChat: suppliedTypeChat,
                            });
                            lastResult = result;
                            if (result.success) {
                                Logger_1.default.log(`[WorkflowEngine] fb.action.sendImage to ${threadId}: success, msgId=${result.messageId}`);
                            }
                            else {
                                Logger_1.default.warn(`[WorkflowEngine] fb.action.sendImage to ${threadId} failed: ${result.error}`);
                                if (!continueOnError)
                                    throw new Error(result.error || 'Không gửi được tệp đính kèm');
                            }
                        }
                        catch (err) {
                            Logger_1.default.warn(`[WorkflowEngine] fb.action.sendImage to ${threadId} failed: ${err.message}`);
                            lastResult = { success: false, error: err.message };
                            if (!continueOnError)
                                throw err;
                        }
                    }
                    return {
                        success: lastResult.success,
                        messageId: lastResult.messageId,
                        ...(lastResult.error ? { error: lastResult.error } : {}),
                        _targetCount: targetThreadIds.length,
                    };
                }
                finally {
                    if (temporaryPath) {
                        try {
                            fs.unlinkSync(temporaryPath);
                        }
                        catch { }
                    }
                }
            }
            case 'fb.action.sendTyping': {
                const rawA1 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA1)
                    throw new Error('[fb.action.sendTyping] accountId required');
                const a1 = this.resolveFBAccountId(rawA1);
                const s1 = await FacebookService_1.FacebookService.getInstance(a1);
                const t1 = cfg.threadId || ctx.trigger?.threadId;
                if (!t1)
                    throw new Error('[fb.action.sendTyping] threadId required');
                await s1.sendTyping(String(t1), cfg.isTyping !== false);
                return { success: true };
            }
            case 'fb.action.markAsRead': {
                const rawA2 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA2)
                    throw new Error('[fb.action.markAsRead] accountId required');
                const a2 = this.resolveFBAccountId(rawA2);
                const s2 = await FacebookService_1.FacebookService.getInstance(a2);
                const t2 = cfg.threadId || ctx.trigger?.threadId;
                if (!t2)
                    throw new Error('[fb.action.markAsRead] threadId required');
                const result = await s2.markReadOnServer(String(t2));
                this.assertFacebookActionSucceeded('đánh dấu đã đọc', result);
                return { success: result.success, ...(result.error ? { error: result.error } : {}) };
            }
            case 'fb.action.forward': {
                const rawAccountId = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawAccountId)
                    throw new Error('[fb.action.forward] accountId required');
                const accountId = this.resolveFBAccountId(rawAccountId);
                const threadId = cfg.targetThreadId || ctx.trigger?.threadId;
                if (!threadId)
                    throw new Error('[fb.action.forward] targetThreadId required');
                const message = cfg.message || ctx.trigger?.content || '';
                if (!message)
                    throw new Error('[fb.action.forward] Missing message content');
                // Resend như tin nhắn mới - giống behavior chat (sendOneForward), không dùng forwardMessage API riêng
                const result = await FacebookSendService_1.FacebookSendService.sendTextMessage({
                    accountId,
                    threadId: String(threadId),
                    body: String(message),
                });
                this.assertFacebookActionSucceeded('gửi lại nội dung', result);
                return {
                    success: result.success,
                    messageId: result.messageId,
                    ...(result.error ? { error: result.error } : {}),
                };
            }
            case 'fb.action.pin': {
                const rawA4 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA4)
                    throw new Error('[fb.action.pin] accountId required');
                const a4 = this.resolveFBAccountId(rawA4);
                const s4 = await FacebookService_1.FacebookService.getInstance(a4);
                const m2 = cfg.messageId || ctx.trigger?.messageId;
                if (!m2)
                    throw new Error('[fb.action.pin] messageId required');
                const t3 = cfg.threadId || ctx.trigger?.threadId;
                if (!t3)
                    throw new Error('[fb.action.pin] threadId required');
                const r2 = await s4.pinMessage(String(m2), String(t3));
                this.assertFacebookActionSucceeded('ghim tin nhắn', r2);
                return { success: r2.success };
            }
            case 'fb.action.unpin': {
                const rawA5 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA5)
                    throw new Error('[fb.action.unpin] accountId required');
                const a5 = this.resolveFBAccountId(rawA5);
                const s5 = await FacebookService_1.FacebookService.getInstance(a5);
                const m3 = cfg.messageId || ctx.trigger?.messageId;
                if (!m3)
                    throw new Error('[fb.action.unpin] messageId required');
                const t4 = cfg.threadId || ctx.trigger?.threadId;
                if (!t4)
                    throw new Error('[fb.action.unpin] threadId required');
                const r3 = await s5.unpinMessage(String(m3), String(t4));
                this.assertFacebookActionSucceeded('bỏ ghim tin nhắn', r3);
                return { success: r3.success };
            }
            case 'fb.action.createPoll': {
                const rawA6 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA6)
                    throw new Error('[fb.action.createPoll] accountId required');
                const a6 = this.resolveFBAccountId(rawA6);
                const s6 = await FacebookService_1.FacebookService.getInstance(a6);
                const t5 = cfg.threadId || ctx.trigger?.threadId;
                if (!t5)
                    throw new Error('[fb.action.createPoll] threadId required');
                if (!cfg.question)
                    throw new Error('[fb.action.createPoll] question required');
                const opts = String(cfg.options || '').split('\n').map((x) => x.trim()).filter(Boolean);
                const r4 = await s6.createPoll(String(t5), String(cfg.question), opts);
                this.assertFacebookActionSucceeded('tạo bình chọn', r4);
                return { success: r4.success, pollId: r4.pollId };
            }
            case 'fb.action.block': {
                const rawA7 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA7)
                    throw new Error('[fb.action.block] accountId required');
                const a7 = this.resolveFBAccountId(rawA7);
                const s7 = await FacebookService_1.FacebookService.getInstance(a7);
                const u1 = cfg.userId || ctx.trigger?.fromId;
                if (!u1)
                    throw new Error('[fb.action.block] userId required');
                const r5 = await s7.blockUser(String(u1));
                this.assertFacebookActionSucceeded('chặn người dùng', r5);
                return { success: r5.success };
            }
            case 'fb.action.unsend': {
                const rawA8 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA8)
                    throw new Error('[fb.action.unsend] accountId required');
                const a8 = this.resolveFBAccountId(rawA8);
                const s8 = await FacebookService_1.FacebookService.getInstance(a8);
                const m4 = cfg.messageId || ctx.trigger?.messageId;
                if (!m4)
                    throw new Error('[fb.action.unsend] messageId required');
                const r6 = await s8.unsendMessage(String(m4));
                this.assertFacebookActionSucceeded('thu hồi tin nhắn', r6);
                return { success: r6.success };
            }
            case 'fb.action.editMessage': {
                const rawA9 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA9)
                    throw new Error('[fb.action.editMessage] accountId required');
                const a9 = this.resolveFBAccountId(rawA9);
                const s9 = await FacebookService_1.FacebookService.getInstance(a9);
                const m5 = cfg.messageId || ctx.trigger?.messageId;
                if (!m5)
                    throw new Error('[fb.action.editMessage] messageId required');
                if (!cfg.text && !cfg.newText)
                    throw new Error('[fb.action.editMessage] text required');
                const editText = cfg.text || cfg.newText || '';
                const r7 = await s9.editMessage(String(m5), String(editText));
                this.assertFacebookActionSucceeded('chỉnh sửa tin nhắn', r7);
                return { success: r7.success };
            }
            case 'fb.action.changeName': {
                const rawA10 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA10)
                    throw new Error('[fb.action.changeName] accountId required');
                const a10 = this.resolveFBAccountId(rawA10);
                const s10 = await FacebookService_1.FacebookService.getInstance(a10);
                const t6 = cfg.threadId || ctx.trigger?.threadId;
                if (!t6)
                    throw new Error('[fb.action.changeName] threadId required');
                if (!cfg.name)
                    throw new Error('[fb.action.changeName] name required');
                const r8 = await s10.changeThreadName(String(t6), String(cfg.name));
                this.assertFacebookActionSucceeded('đổi tên nhóm', r8);
                return { success: r8 };
            }
            case 'fb.action.changeEmoji': {
                const rawA11 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA11)
                    throw new Error('[fb.action.changeEmoji] accountId required');
                const a11 = this.resolveFBAccountId(rawA11);
                const s11 = await FacebookService_1.FacebookService.getInstance(a11);
                const t7 = cfg.threadId || ctx.trigger?.threadId;
                if (!t7)
                    throw new Error('[fb.action.changeEmoji] threadId required');
                if (!cfg.emoji)
                    throw new Error('[fb.action.changeEmoji] emoji required');
                const r9 = await s11.changeThreadEmoji(String(t7), String(cfg.emoji));
                this.assertFacebookActionSucceeded('đổi biểu tượng nhóm', r9);
                return { success: r9 };
            }
            case 'fb.action.changeNickname': {
                const rawA12 = cfg.accountId || ctx.trigger?.fbAccountId || ctx.pageId;
                if (!rawA12)
                    throw new Error('[fb.action.changeNickname] accountId required');
                const a12 = this.resolveFBAccountId(rawA12);
                const s12 = await FacebookService_1.FacebookService.getInstance(a12);
                const t8 = cfg.threadId || ctx.trigger?.threadId;
                if (!t8)
                    throw new Error('[fb.action.changeNickname] threadId required');
                const u2 = cfg.userId || ctx.trigger?.fromId;
                if (!u2)
                    throw new Error('[fb.action.changeNickname] userId required');
                if (cfg.nickname === undefined)
                    throw new Error('[fb.action.changeNickname] nickname required');
                const r10 = await s12.changeNickname(String(t8), String(u2), String(cfg.nickname));
                this.assertFacebookActionSucceeded('đổi biệt danh', r10);
                return { success: r10 };
            }
            // ─── Telegram Actions ──────────────────────────────────────────────────
            case 'tg.sendMessage': {
                const tgAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAccountId)
                    throw new Error('[tg.sendMessage] accountId required');
                const tgChatId = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChatId)
                    throw new Error('[tg.sendMessage] chatId required');
                if (!cfg.message)
                    throw new Error('[tg.sendMessage] message required');
                // Parse structured AI response (same as zalo.sendMessage)
                const tgSegments = (0, aiUtils_1.parseStructuredResponse)(cfg.message);
                const tgMsg = tgSegments
                    ? tgSegments.filter((s) => s.type === 'text').map((s) => s.text).join('')
                    : cfg.message;
                const tgSendResult = await this.sendTelegramMessage(tgAccountId, String(tgChatId), tgMsg);
                return { success: tgSendResult.success, messageId: tgSendResult.messageId, ...(tgSendResult.error ? { error: tgSendResult.error } : {}) };
            }
            case 'tg.sendPhoto': {
                const tgAcc2 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc2)
                    throw new Error('[tg.sendPhoto] accountId required');
                const tgChat2 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat2)
                    throw new Error('[tg.sendPhoto] chatId required');
                if (!cfg.filePath)
                    throw new Error('[tg.sendPhoto] filePath required');
                const tgPhotoResult = await this.sendTelegramPhoto(tgAcc2, String(tgChat2), String(cfg.filePath), cfg.caption || '');
                return { success: tgPhotoResult.success, messageId: tgPhotoResult.messageId, ...(tgPhotoResult.error ? { error: tgPhotoResult.error } : {}) };
            }
            case 'tg.sendFile': {
                const tgAcc3 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc3)
                    throw new Error('[tg.sendFile] accountId required');
                const tgChat3 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat3)
                    throw new Error('[tg.sendFile] chatId required');
                if (!cfg.filePath)
                    throw new Error('[tg.sendFile] filePath required');
                const tgFileResult = await this.sendTelegramFile(tgAcc3, String(tgChat3), String(cfg.filePath), cfg.caption || '');
                return { success: tgFileResult.success, messageId: tgFileResult.messageId, ...(tgFileResult.error ? { error: tgFileResult.error } : {}) };
            }
            case 'tg.forwardMessage': {
                const tgAcc4 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc4)
                    throw new Error('[tg.forwardMessage] accountId required');
                const fromChat = cfg.fromChatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!fromChat)
                    throw new Error('[tg.forwardMessage] fromChatId required');
                const toChat = cfg.toChatId;
                if (!toChat)
                    throw new Error('[tg.forwardMessage] toChatId required');
                const fwdMsgId = cfg.messageId || ctx.trigger?.messageId;
                if (!fwdMsgId)
                    throw new Error('[tg.forwardMessage] messageId required');
                const tgFwdResult = await this.forwardTelegramMessage(tgAcc4, String(fromChat), String(toChat), String(fwdMsgId));
                return { success: tgFwdResult.success, ...(tgFwdResult.error ? { error: tgFwdResult.error } : {}) };
            }
            case 'tg.deleteMessage': {
                const tgAcc5 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc5)
                    throw new Error('[tg.deleteMessage] accountId required');
                const tgChat5 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat5)
                    throw new Error('[tg.deleteMessage] chatId required');
                const delMsgId = cfg.messageId || ctx.trigger?.messageId;
                if (!delMsgId)
                    throw new Error('[tg.deleteMessage] messageId required');
                const tgDelResult = await this.deleteTelegramMessage(tgAcc5, String(tgChat5), String(delMsgId));
                return { success: tgDelResult.success, ...(tgDelResult.error ? { error: tgDelResult.error } : {}) };
            }
            case 'tg.editMessage': {
                const tgAcc6 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc6)
                    throw new Error('[tg.editMessage] accountId required');
                const tgChat6 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat6)
                    throw new Error('[tg.editMessage] chatId required');
                const editMsgId = cfg.messageId || ctx.trigger?.messageId;
                if (!editMsgId)
                    throw new Error('[tg.editMessage] messageId required');
                if (!cfg.text)
                    throw new Error('[tg.editMessage] text required');
                const tgEditResult = await this.editTelegramMessage(tgAcc6, String(tgChat6), String(editMsgId), String(cfg.text));
                return { success: tgEditResult.success, ...(tgEditResult.error ? { error: tgEditResult.error } : {}) };
            }
            case 'tg.addReaction': {
                const tgAcc7 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc7)
                    throw new Error('[tg.addReaction] accountId required');
                const tgChat7 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat7)
                    throw new Error('[tg.addReaction] chatId required');
                const reactMsgId = cfg.messageId || ctx.trigger?.messageId;
                if (!reactMsgId)
                    throw new Error('[tg.addReaction] messageId required');
                const tgReactResult = await this.addTelegramReaction(tgAcc7, String(tgChat7), String(reactMsgId), cfg.emoji || '👍');
                return { success: tgReactResult.success, ...(tgReactResult.error ? { error: tgReactResult.error } : {}) };
            }
            case 'tg.pinMessage': {
                const tgAcc8 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc8)
                    throw new Error('[tg.pinMessage] accountId required');
                const tgChat8 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat8)
                    throw new Error('[tg.pinMessage] chatId required');
                const pinMsgId = cfg.messageId || ctx.trigger?.messageId;
                if (!pinMsgId)
                    throw new Error('[tg.pinMessage] messageId required');
                const tgPinResult = await this.pinTelegramMessage(tgAcc8, String(tgChat8), String(pinMsgId));
                return { success: tgPinResult.success, ...(tgPinResult.error ? { error: tgPinResult.error } : {}) };
            }
            case 'tg.sendPoll': {
                const tgAcc9 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc9)
                    throw new Error('[tg.sendPoll] accountId required');
                const tgChat9 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat9)
                    throw new Error('[tg.sendPoll] chatId required');
                if (!cfg.question)
                    throw new Error('[tg.sendPoll] question required');
                const pollOptions = String(cfg.options || '').split('\n').map((x) => x.trim()).filter(Boolean);
                if (pollOptions.length < 2)
                    throw new Error('[tg.sendPoll] at least 2 options required');
                const tgPollResult = await this.sendTelegramPoll(tgAcc9, String(tgChat9), String(cfg.question), pollOptions);
                return { success: tgPollResult.success, messageId: tgPollResult.messageId, ...(tgPollResult.error ? { error: tgPollResult.error } : {}) };
            }
            case 'tg.banMember': {
                const tgAcc10 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc10)
                    throw new Error('[tg.banMember] accountId required');
                const tgChat10 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat10)
                    throw new Error('[tg.banMember] chatId required');
                const banUserId = cfg.userId || ctx.trigger?.fromId;
                if (!banUserId)
                    throw new Error('[tg.banMember] userId required');
                const tgBanResult = await this.banTelegramMember(tgAcc10, String(tgChat10), String(banUserId));
                return { success: tgBanResult.success, ...(tgBanResult.error ? { error: tgBanResult.error } : {}) };
            }
            case 'tg.promoteMember': {
                const tgAcc11 = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!tgAcc11)
                    throw new Error('[tg.promoteMember] accountId required');
                const tgChat11 = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!tgChat11)
                    throw new Error('[tg.promoteMember] chatId required');
                const promoteUserId = cfg.userId || ctx.trigger?.fromId;
                if (!promoteUserId)
                    throw new Error('[tg.promoteMember] userId required');
                const isAdmin = cfg.isAdmin === true || cfg.isAdmin === 'true';
                const tgPromoteResult = await this.promoteTelegramMember(tgAcc11, String(tgChat11), String(promoteUserId), isAdmin);
                return { success: tgPromoteResult.success, ...(tgPromoteResult.error ? { error: tgPromoteResult.error } : {}) };
            }
            // ── New Telegram actions ─────────────────────────────────────────────
            case 'tg.trigger.message':
            case 'tg.trigger.unsend':
            case 'tg.trigger.groupEvent':
                return { ...ctx.trigger };
            case 'tg.sendSticker': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.sendSticker] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!chatId)
                    throw new Error('[tg.sendSticker] chatId required');
                if (!cfg.stickerId)
                    throw new Error('[tg.sendSticker] stickerId required');
                const r = await this.tgInvoke(acc, 'sendSticker', { chatId, stickerId: cfg.stickerId, accessHash: cfg.accessHash });
                return r;
            }
            case 'tg.sendTyping': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.sendTyping] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!chatId)
                    throw new Error('[tg.sendTyping] chatId required');
                const r = await this.tgInvoke(acc, 'sendTyping', { chatId });
                return r;
            }
            case 'tg.addMember': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.addMember] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.addMember] chatId required');
                const userId = cfg.userId;
                if (!userId)
                    throw new Error('[tg.addMember] userId required');
                const r = await this.tgInvoke(acc, 'addChatUser', { chatId, userId });
                return r;
            }
            case 'tg.removeMember': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.removeMember] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.removeMember] chatId required');
                const userId = cfg.userId;
                if (!userId)
                    throw new Error('[tg.removeMember] userId required');
                const r = await this.tgInvoke(acc, 'deleteChatUser', { chatId, userId });
                return r;
            }
            case 'tg.markAsRead': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.markAsRead] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId || ctx.trigger?.threadId;
                if (!chatId)
                    throw new Error('[tg.markAsRead] chatId required');
                const r = await this.tgInvoke(acc, 'readChatHistory', { chatId });
                return r;
            }
            case 'tg.markTopicAsRead': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.markTopicAsRead] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.markTopicAsRead] chatId required');
                const topicId = cfg.topicId || ctx.trigger?.topicId;
                if (!topicId)
                    throw new Error('[tg.markTopicAsRead] topicId required');
                const r = await this.tgInvoke(acc, 'readForumTopic', { chatId, topMsgId: topicId });
                return r;
            }
            case 'tg.blockUser': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.blockUser] accountId required');
                const userId = cfg.userId || ctx.trigger?.fromId;
                if (!userId)
                    throw new Error('[tg.blockUser] userId required');
                const r = await this.tgInvoke(acc, 'blockUser', { userId });
                return r;
            }
            case 'tg.unblockUser': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.unblockUser] accountId required');
                const userId = cfg.userId || ctx.trigger?.fromId;
                if (!userId)
                    throw new Error('[tg.unblockUser] userId required');
                const r = await this.tgInvoke(acc, 'unblockUser', { userId });
                return r;
            }
            case 'tg.changeGroupName': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.changeGroupName] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.changeGroupName] chatId required');
                if (!cfg.name)
                    throw new Error('[tg.changeGroupName] name required');
                const r = await this.tgInvoke(acc, 'editChatTitle', { chatId, title: cfg.name });
                return r;
            }
            case 'tg.leaveGroup': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.leaveGroup] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.leaveGroup] chatId required');
                const r = await this.tgInvoke(acc, 'leaveChat', { chatId });
                return r;
            }
            case 'tg.exportInviteLink': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.exportInviteLink] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.exportInviteLink] chatId required');
                const r = await this.tgInvoke(acc, 'exportChatInvite', { chatId });
                return { ...r, link: r.link || '' };
            }
            case 'tg.createForumTopic': {
                const acc = cfg.accountId || ctx.trigger?.accountId;
                if (!acc)
                    throw new Error('[tg.createForumTopic] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tg.createForumTopic] chatId required');
                if (!cfg.title)
                    throw new Error('[tg.createForumTopic] title required');
                const r = await this.tgInvoke(acc, 'createForumTopic', { chatId, title: cfg.title });
                return r;
            }
            // ─── Telegram Bot Actions ──────────────────────────────────────────────
            case 'tgbot.action.sendMessage': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.sendMessage] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tgbot.action.sendMessage] chatId required');
                const resolvedMessage = this.resolveMessageFromConfigOrUpstream(node, cfg, ctx, _wf);
                const text = resolvedMessage.text || ctx.trigger?.content || '';
                if (!text)
                    throw new Error('[tgbot.action.sendMessage] message required');
                const TelegramBotChannel = require('../telegram/TelegramBotChannelService');
                const replyMarkup = this.buildTelegramBotReplyMarkup(cfg.keyboard);
                const result = await TelegramBotChannel.sendMessage({
                    accountId: botAccountId,
                    chatId,
                    text,
                    replyMarkup,
                });
                return { success: result?.success, messageId: result?.messageId, contentSource: resolvedMessage.text ? resolvedMessage.source : 'trigger' };
            }
            case 'tgbot.action.sendPhoto': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.sendPhoto] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tgbot.action.sendPhoto] chatId required');
                const photoPath = cfg.photoPath || cfg.url;
                if (!photoPath)
                    throw new Error('[tgbot.action.sendPhoto] photoPath required');
                const result = await TelegramBot.sendPhoto(botAccountId, chatId, photoPath, cfg.caption || '');
                return { success: result?.success, messageId: result?.messageId };
            }
            case 'tgbot.action.sendVideo': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                const videoPath = cfg.videoPath || cfg.url;
                if (!botAccountId || !chatId || !videoPath)
                    throw new Error('[tgbot.action.sendVideo] accountId, chatId and videoPath required');
                const result = await TelegramBot.sendVideo(botAccountId, chatId, videoPath, cfg.caption || '');
                return { success: result.success, messageId: result.messageId, error: result.error };
            }
            case 'tgbot.action.sendFile': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!botAccountId || !chatId || !cfg.filePath)
                    throw new Error('[tgbot.action.sendFile] accountId, chatId and filePath required');
                const result = await TelegramBot.sendDocument(botAccountId, chatId, cfg.filePath, cfg.caption || '');
                return { success: result.success, messageId: result.messageId, error: result.error };
            }
            case 'tgbot.action.sendMenu': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.sendMenu] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tgbot.action.sendMenu] chatId required');
                const text = cfg.text || 'Chọn một tùy chọn:';
                const buttons = cfg.buttons || []; // Array of { text, callback_data }
                // Build inline keyboard
                const inline_keyboard = buttons.map((row) => {
                    if (Array.isArray(row)) {
                        return row.map((btn) => ({
                            text: btn.text || '',
                            callback_data: btn.callback_data || '',
                        }));
                    }
                    return [{ text: row.text || '', callback_data: row.callback_data || '' }];
                });
                const TelegramBotChannel = require('../telegram/TelegramBotChannelService');
                const result = await TelegramBotChannel.sendMessage({
                    accountId: botAccountId,
                    chatId,
                    text,
                    replyMarkup: { inline_keyboard },
                });
                return { success: result?.success, messageId: result?.messageId };
            }
            case 'tgbot.action.sendForm': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.sendForm] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tgbot.action.sendForm] chatId required');
                const formText = cfg.text || 'Vui lòng nhập thông tin:';
                const fields = cfg.fields || []; // Array of { label, field_name, required }
                // Build form as text with buttons
                let formContent = formText + '\n\n';
                fields.forEach((f, i) => {
                    formContent += `${i + 1}. ${f.label}${f.required ? ' *' : ''}\n`;
                });
                const TelegramBotChannel = require('../telegram/TelegramBotChannelService');
                const result = await TelegramBotChannel.sendMessage({
                    accountId: botAccountId,
                    chatId,
                    text: formContent,
                });
                // Store form state in context for follow-up messages
                return {
                    success: result?.success,
                    messageId: result?.messageId,
                    formFields: fields,
                    formChatId: chatId,
                };
            }
            case 'tgbot.action.forward': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.forward] accountId required');
                const targetChatId = cfg.targetChatId;
                if (!targetChatId)
                    throw new Error('[tgbot.action.forward] targetChatId required');
                const fromChatId = cfg.fromChatId || ctx.trigger?.chatId;
                const messageId = cfg.messageId || ctx.trigger?.messageId;
                if (!fromChatId || !messageId)
                    throw new Error('[tgbot.action.forward] fromChatId and messageId required');
                const result = await TelegramBot.forwardMessage(botAccountId, targetChatId, fromChatId, String(messageId));
                return { success: result.success, messageId: result.messageId, error: result.error };
            }
            case 'tgbot.action.editMessage': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.editMessage] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tgbot.action.editMessage] chatId required');
                const messageId = cfg.messageId;
                if (!messageId)
                    throw new Error('[tgbot.action.editMessage] messageId required');
                const text = cfg.text || '';
                if (!text)
                    throw new Error('[tgbot.action.editMessage] text required');
                const result = await TelegramBot.editMessage(botAccountId, chatId, String(messageId), text);
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.deleteMessage': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.deleteMessage] accountId required');
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!chatId)
                    throw new Error('[tgbot.action.deleteMessage] chatId required');
                const messageId = cfg.messageId || ctx.trigger?.messageId;
                if (!messageId)
                    throw new Error('[tgbot.action.deleteMessage] messageId required');
                const result = await TelegramBot.deleteMessage(botAccountId, chatId, String(messageId));
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.pinMessage': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                const messageId = cfg.messageId || ctx.trigger?.messageId;
                if (!botAccountId || !chatId || !messageId)
                    throw new Error('[tgbot.action.pinMessage] accountId, chatId and messageId required');
                const result = await TelegramBot.pinMessage(botAccountId, chatId, String(messageId));
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.unpinMessage': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!botAccountId || !chatId)
                    throw new Error('[tgbot.action.unpinMessage] accountId and chatId required');
                const result = await TelegramBot.unpinChatMessage(botAccountId, chatId, cfg.messageId || ctx.trigger?.messageId || undefined);
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.addReaction': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                const messageId = cfg.messageId || ctx.trigger?.messageId;
                if (!botAccountId || !chatId || !messageId || !cfg.emoji)
                    throw new Error('[tgbot.action.addReaction] accountId, chatId, messageId and emoji required');
                const result = await TelegramBot.addReaction(botAccountId, chatId, String(messageId), cfg.emoji);
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.sendPoll': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                const options = String(cfg.options || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
                if (!botAccountId || !chatId || !cfg.question || options.length < 2)
                    throw new Error('[tgbot.action.sendPoll] accountId, chatId, question and at least two options required');
                const result = await TelegramBot.sendPoll(botAccountId, chatId, cfg.question, options);
                return { success: result.success, messageId: result.messageId, error: result.error };
            }
            case 'tgbot.action.sendChatAction': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                if (!botAccountId || !chatId)
                    throw new Error('[tgbot.action.sendChatAction] accountId and chatId required');
                const result = await TelegramBot.sendChatAction(botAccountId, chatId, cfg.action || 'typing');
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.banMember': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                const userId = cfg.userId || ctx.trigger?.fromId;
                if (!botAccountId || !chatId || !userId)
                    throw new Error('[tgbot.action.banMember] accountId, chatId and userId required');
                const minutes = Number(cfg.durationMinutes || 0);
                const untilDate = minutes > 0 ? Math.floor(Date.now() / 1000) + minutes * 60 : undefined;
                const result = await TelegramBot.banChatMember(botAccountId, chatId, String(userId), untilDate);
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.restrictMember': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                const chatId = cfg.chatId || ctx.trigger?.chatId;
                const userId = cfg.userId || ctx.trigger?.fromId;
                if (!botAccountId || !chatId || !userId)
                    throw new Error('[tgbot.action.restrictMember] accountId, chatId and userId required');
                const minutes = Math.max(1, Number(cfg.durationMinutes || 10));
                const result = await TelegramBot.restrictChatMember(botAccountId, chatId, String(userId), { canSendMessages: false }, Math.floor(Date.now() / 1000) + minutes * 60);
                return { success: result.success, error: result.error };
            }
            case 'tgbot.action.answerCallback': {
                const botAccountId = cfg.accountId || ctx.trigger?.accountId || ctx.pageId;
                if (!botAccountId)
                    throw new Error('[tgbot.action.answerCallback] accountId required');
                const callbackQueryId = cfg.callbackQueryId || ctx.trigger?.callbackQueryId;
                if (!callbackQueryId)
                    throw new Error('[tgbot.action.answerCallback] callbackQueryId required');
                const text = cfg.text || '';
                const result = await TelegramBot.answerCallbackQuery(botAccountId, callbackQueryId, text, !!cfg.showAlert);
                return { success: result.success, error: result.error };
            }
            default:
                return {};
        }
    }
    // ─── Helpers ──────────────────────────────────────────────────────────────
    /**
     * Đẩy 1 tác vụ gửi tin qua hàng đợi theo account (ctx.pageId = zaloId của workflow).
     * Nhiều workflow cùng 1 tài khoản → chung 1 hàng đợi → tin gửi tuần tự, giãn cách ngẫu nhiên
     * theo cấu hình node (sendDelayMin/MaxSeconds) để tránh spam khi nhiều khách nhắn cùng lúc.
     */
    enqueueSend(cfg, ctx, task) {
        const minMs = Number(cfg.sendDelayMinSeconds ?? 0) * 1000;
        const maxMs = Number(cfg.sendDelayMaxSeconds ?? 0) * 1000;
        return AccountSendQueue_1.default.getInstance().enqueue(ctx.pageId, task, minMs, maxMs);
    }
    getApi(pageId) {
        // Try to find connection by pageId or use any connected account
        let conn = ConnectionManager_1.default.getConnection(pageId);
        if (!conn) {
            // Try first available connected account
            for (const [, c] of ConnectionManager_1.default.getAllConnections()) {
                if (c.connected) {
                    conn = c;
                    break;
                }
            }
        }
        if (!conn || !conn.api)
            throw new Error(`Account ${pageId || 'unknown'} không connected`);
        return conn.api;
    }
    getAccountChannel(accountId) {
        if (!accountId)
            return '';
        try {
            return String((DatabaseService_1.default.getInstance().getAccounts?.() || [])
                .find((account) => String(account.zalo_id) === String(accountId))?.channel || 'zalo');
        }
        catch {
            return '';
        }
    }
    getForwardText(raw) {
        if (raw === null || raw === undefined || raw === 'null')
            return '';
        if (typeof raw !== 'string')
            return String(raw || '').trim();
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'string')
                return parsed.trim();
            if (parsed?.msg)
                return String(parsed.msg).trim();
            if (parsed?.text)
                return String(parsed.text).trim();
            // Attachment-shaped JSON is not a human-readable caption.
            if (parsed?.href || parsed?.thumb || parsed?.title)
                return '';
        }
        catch { }
        return raw.trim();
    }
    /** A returned { success: false } must fail the node, not produce a green run. */
    assertFacebookActionSucceeded(action, result) {
        const success = typeof result === 'boolean' ? result : result?.success;
        if (!success)
            throw new Error(result?.error || `Facebook không thể ${action}`);
    }
    getForwardMediaPath(message) {
        if (!message)
            return '';
        try {
            const paths = typeof message.local_paths === 'string' ? JSON.parse(message.local_paths || '{}') : (message.local_paths || {});
            const candidate = paths.file || paths.video || paths.voice || paths.main || paths.hd
                || Object.values(paths).find((value) => typeof value === 'string' && value) || '';
            if (!candidate || typeof candidate !== 'string')
                return '';
            const normalized = candidate.startsWith('local-media:///') ? candidate.replace('local-media:///', '')
                : candidate.startsWith('local-media://') ? candidate.replace('local-media://', '') : candidate;
            return fs.existsSync(normalized) ? normalized : '';
        }
        catch {
            return '';
        }
    }
    isForwardMedia(message, trigger) {
        const attachment = Array.isArray(trigger?.attachments) ? trigger.attachments[0] : trigger?.attachments;
        const type = String(message?.msg_type || message?.type || trigger?.msgType ||
            attachment?.attachmentType || attachment?.type || '').toLowerCase();
        return ['image', 'photo', 'picture', 'video', 'video_note', 'audio', 'voice', 'file', 'document', 'sticker'].includes(type);
    }
    /** Wait only for the downloader of the message currently being forwarded. */
    async waitForForwardMedia(accountId, messageId, initialMessage) {
        const deadline = Date.now() + 30000;
        let message = initialMessage;
        while (Date.now() < deadline) {
            if (this.getForwardMediaPath(message))
                return message;
            await new Promise(resolve => setTimeout(resolve, 400));
            try {
                message = DatabaseService_1.default.getInstance().getMessageById(accountId, messageId) || message;
            }
            catch { }
        }
        return message;
    }
    /** targetThreadType is a Zalo-only knob. Facebook resolves the target from its DB. */
    resolveForwardTargetThreadType(channel, cfg) {
        if (channel !== 'zalo' || cfg.targetThreadType === undefined || cfg.targetThreadType === '')
            return undefined;
        return Number(cfg.targetThreadType) === 1 ? 1 : 0;
    }
    async sendForwardText(channel, accountId, chatId, text, threadType) {
        if (channel === 'zalo') {
            try {
                const result = await this.getApi(accountId).sendMessage({ msg: text, attachments: [] }, chatId, threadType ?? 0);
                return { success: result?.success !== false, messageId: result?.msgId || result?.messageId };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        }
        if (channel === 'facebook') {
            const typeChat = threadType === 0 ? 'user' : threadType === 1 ? null : undefined;
            const result = await FacebookSendService_1.FacebookSendService.sendTextMessage({ accountId: this.resolveFBAccountId(accountId), threadId: chatId, body: text, typeChat });
            return { success: !!result.success, messageId: result.messageId, error: result.error };
        }
        if (channel === 'telegram_bot')
            return TelegramBot.sendMessage(accountId, chatId, text);
        if (channel === 'telegram_user')
            return TelegramUser.sendMessage(accountId, chatId, text);
        return { success: false, error: `Kênh đích không hỗ trợ: ${channel}` };
    }
    async sendForwardMedia(channel, accountId, chatId, filePath, mediaType, threadType) {
        const kind = mediaType.toLowerCase();
        const isImage = ['photo', 'image', 'picture'].includes(kind);
        const isVideo = ['video', 'video_note'].includes(kind);
        if (channel === 'zalo') {
            try {
                const result = await this.getApi(accountId).sendMessage({ msg: '', attachments: [filePath] }, chatId, threadType ?? 0);
                return { success: result?.success !== false, messageId: result?.msgId || result?.messageId };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        }
        if (channel === 'facebook') {
            // DEPLAO_ADAPTER: Delegate to FacebookSendService.sendAttachment().
            const typeChat = threadType === 0 ? 'user' : threadType === 1 ? null : undefined;
            return FacebookSendService_1.FacebookSendService.sendAttachment({
                accountId: this.resolveFBAccountId(accountId),
                threadId: chatId,
                filePath,
                typeChat,
            });
        }
        if (channel === 'telegram_bot') {
            if (isImage)
                return TelegramBot.sendPhoto(accountId, chatId, filePath);
            if (isVideo)
                return TelegramBot.sendVideo(accountId, chatId, filePath);
            return TelegramBot.sendDocument(accountId, chatId, filePath);
        }
        if (channel === 'telegram_user')
            return TelegramUser.sendFile(accountId, chatId, filePath, '');
        return { success: false, error: `Kênh đích không hỗ trợ: ${channel}` };
    }
    async forwardNativeMessage(channel, accountId, sourceChatId, targetChatId, messageId, sourceMessage) {
        if (channel === 'telegram_user' || channel === 'telegram_bot') {
            return this.forwardTelegramMessage(accountId, sourceChatId, targetChatId, messageId);
        }
        if (channel === 'facebook') {
            // DEPLAO_ADAPTER: Don't pass source message type — forwardMessage()
            // resolves target thread kind from DB via resolveThreadKind().
            // Passing sourceMessage.is_group would incorrectly route a group→user
            // forward as group, or user→group as user.
            try {
                const service = await FacebookService_1.FacebookService.getInstance(this.resolveFBAccountId(accountId));
                const result = await service.forwardMessage(messageId, targetChatId);
                return { success: !!result.success, error: result.error };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        }
        if (channel === 'zalo') {
            try {
                const result = await this.getApi(accountId).forwardMessage({
                    message: '', reference: { id: messageId, ts: sourceMessage?.timestamp || Date.now(), logSrcType: 0, fwLvl: 0 },
                }, [targetChatId], Number(sourceMessage?.thread_type || 0));
                return { success: result?.success !== false, error: result?.error };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: `Kênh nguồn không hỗ trợ: ${channel}` };
    }
    // ─── Telegram Helpers ─────────────────────────────────────────────────────
    /** Detect if account is telegram_bot (Bot API) or telegram_user (MTProto) */
    isTelegramBotAccount(accountId) {
        try {
            const accounts = DatabaseService_1.default.getInstance().getAccounts?.() || [];
            const acc = accounts.find((a) => a.zalo_id === accountId);
            return acc?.channel === 'telegram_bot';
        }
        catch {
            return false;
        }
    }
    /** Generic Telegram User API invoke by name */
    async tgInvoke(accountId, method, params) {
        const TelegramUser = require('../telegram/TelegramUserListener');
        switch (method) {
            case 'sendSticker': return await TelegramUser.sendSticker(accountId, params.chatId, params.stickerId, params.accessHash);
            case 'sendTyping': return await TelegramUser.sendTyping(accountId, params.chatId);
            case 'addChatUser': return await TelegramUser.addChatUser(accountId, params.chatId, params.userId);
            case 'deleteChatUser': return await TelegramUser.deleteChatUser(accountId, params.chatId, params.userId);
            case 'readChatHistory': return await TelegramUser.readChatHistory(accountId, params.chatId);
            case 'readForumTopic': return await TelegramUser.readForumTopic(accountId, params.chatId, params.topMsgId);
            case 'blockUser': return await TelegramUser.blockUser(accountId, params.userId);
            case 'unblockUser': return await TelegramUser.unblockUser(accountId, params.userId);
            case 'editChatTitle': return await TelegramUser.editChatTitle(accountId, params.chatId, params.title);
            case 'leaveChat': return await TelegramUser.leaveChat(accountId, params.chatId);
            case 'exportChatInvite': return await TelegramUser.exportChatInvite(accountId, params.chatId);
            case 'createForumTopic': return await TelegramUser.createForumTopic(accountId, params.chatId, params.title);
            default: throw new Error(`[tgInvoke] Unknown method: ${method}`);
        }
    }
    async sendTelegramMessage(accountId, chatId, text) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.sendMessage(accountId, chatId, text);
            }
            return await TelegramUser.sendMessage(accountId, chatId, text);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async sendTelegramPhoto(accountId, chatId, filePath, caption) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.sendPhoto(accountId, chatId, filePath, caption);
            }
            // MTProto: use sendFile which handles all media types
            return await TelegramUser.sendFile(accountId, chatId, filePath, caption);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async sendTelegramFile(accountId, chatId, filePath, caption) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.sendDocument(accountId, chatId, filePath, caption);
            }
            return await TelegramUser.sendFile(accountId, chatId, filePath, caption);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async forwardTelegramMessage(accountId, fromChatId, toChatId, messageId) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.forwardMessage(accountId, toChatId, fromChatId, messageId);
            }
            return await TelegramUser.forwardMessages(accountId, fromChatId, toChatId, [messageId]);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async deleteTelegramMessage(accountId, chatId, messageId) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.deleteMessage(accountId, chatId, messageId);
            }
            return await TelegramUser.deleteMessages(accountId, chatId, [messageId]);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async editTelegramMessage(accountId, chatId, messageId, text) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.editMessage(accountId, chatId, messageId, text);
            }
            return await TelegramUser.editMessage(accountId, chatId, messageId, text);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async addTelegramReaction(accountId, chatId, messageId, emoji) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.addReaction(accountId, chatId, messageId, emoji);
            }
            return await TelegramUser.sendReaction(accountId, chatId, messageId, emoji);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async pinTelegramMessage(accountId, chatId, messageId) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.pinMessage(accountId, chatId, messageId);
            }
            return await TelegramUser.pinMessage(accountId, chatId, messageId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async sendTelegramPoll(accountId, chatId, question, options) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.sendPoll(accountId, chatId, question, options);
            }
            // MTProto: no direct sendPoll export, return not supported
            return { success: false, error: 'sendPoll not supported for telegram_user yet' };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async banTelegramMember(accountId, chatId, userId) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.banChatMember(accountId, chatId, userId);
            }
            return await TelegramUser.deleteChatUser(accountId, chatId, userId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    async promoteTelegramMember(accountId, chatId, userId, isAdmin) {
        try {
            if (this.isTelegramBotAccount(accountId)) {
                return await TelegramBot.promoteChatMember(accountId, chatId, userId);
            }
            return await TelegramUser.editChatAdmin(accountId, chatId, userId, isAdmin);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    topologicalSort(wf) {
        const inDegree = new Map();
        const adj = new Map();
        for (const node of wf.nodes) {
            inDegree.set(node.id, 0);
            adj.set(node.id, []);
        }
        for (const edge of wf.edges) {
            // These dashed edges document an interaction route in the editor. They
            // are activated only by an actual Bot API callback, never by normal flow.
            if (edge.data?.telegramInline)
                continue;
            adj.get(edge.source)?.push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
        }
        const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
        const result = [];
        while (queue.length) {
            const id = queue.shift();
            result.push(id);
            for (const next of adj.get(id) ?? []) {
                const d = (inDegree.get(next) ?? 1) - 1;
                inDegree.set(next, d);
                if (d === 0)
                    queue.push(next);
            }
        }
        // ⚠️ Nếu graph có cycle, topological sort không thể xử lý
        // Chỉ trả về nodes có thể sort được (không cycle)
        Logger_1.default.warn(`[WorkflowEngine] topologicalSort: ${result.length}/${wf.nodes.length} nodes sorted, ${wf.nodes.length - result.length} nodes skipped due to cycle(s)`);
        return result;
    }
    /** Nodes to execute after an inline button is pressed (normal edges only). */
    getReachableWorkflowNodes(wf, startNodeId) {
        const reached = new Set([startNodeId]);
        const queue = [startNodeId];
        while (queue.length) {
            const nodeId = queue.shift();
            for (const edge of wf.edges) {
                if (edge.source !== nodeId || edge.data?.telegramInline || reached.has(edge.target))
                    continue;
                reached.add(edge.target);
                queue.push(edge.target);
            }
        }
        return reached;
    }
    /** Resolve target thread IDs từ cfg, hỗ trợ cả threadIds (mảng JSON) và threadId (string cũ) */
    resolveTargetThreadIds(cfg, triggerThreadId) {
        if (cfg.threadIds) {
            try {
                const parsed = JSON.parse(cfg.threadIds);
                if (Array.isArray(parsed) && parsed.length > 0)
                    return parsed.map(String);
            }
            catch { }
        }
        if (cfg.threadId)
            return [String(cfg.threadId)];
        if (triggerThreadId)
            return [triggerThreadId];
        return [];
    }
    /**
     * Converts the editor's compact keyboard model to Telegram Bot API markup.
     * Never invent callback payloads: generic callbacks must be supplied by the
     * editor, while routed buttons use a short button id payload (Bot API caps
     * callback_data at 64 bytes).
     */
    buildTelegramBotReplyMarkup(keyboard) {
        if (!keyboard?.enabled)
            return undefined;
        const rows = Array.isArray(keyboard.rows) ? keyboard.rows : [];
        if (!rows.length)
            return undefined;
        if (keyboard.type === 'reply') {
            const replyKeyboard = rows
                .map((row) => (Array.isArray(row) ? row : [row]))
                .map((row) => row
                .map(btn => String(btn?.text || '').trim())
                .filter(Boolean))
                .filter((row) => row.length > 0);
            return replyKeyboard.length ? {
                keyboard: replyKeyboard,
                resize_keyboard: keyboard.resize !== false,
                one_time_keyboard: !!keyboard.oneTime,
                is_persistent: !!keyboard.persistent,
            } : undefined;
        }
        const inlineKeyboard = rows
            .map((row) => (Array.isArray(row) ? row : [row]))
            .map((row) => row.map((btn) => {
            const text = String(btn?.text || '').trim();
            if (!text)
                return null;
            if (btn.action === 'url') {
                const url = String(btn.url || '').trim();
                return url ? { text, url } : null;
            }
            const callbackData = btn.action === 'node'
                ? `dlw:n:${String(btn.id || '').trim()}`
                : String(btn.callbackData || '').trim();
            if (!callbackData || Buffer.byteLength(callbackData, 'utf8') > 64)
                return null;
            return { text, callback_data: callbackData };
        }).filter(Boolean))
            .filter((row) => row.length > 0);
        return inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined;
    }
    renderConfig(config, ctx) {
        const rendered = {};
        for (const [key, value] of Object.entries(config)) {
            rendered[key] = typeof value === 'string' ? this.renderTemplate(value, ctx) : value;
        }
        return rendered;
    }
    /**
     * A text-format node is commonly connected directly to a notification node.
     * Make that connection useful without requiring users to paste a node token
     * into the message field. An explicit message (including a template that
     * renders empty) remains authoritative, so a mistyped variable is not
     * replaced with unrelated workflow data.
     */
    resolveMessageFromConfigOrUpstream(node, cfg, ctx, wf) {
        const configured = String(node.config?.message ?? node.config?.text ?? '').trim();
        const rendered = String(cfg.message ?? cfg.text ?? '').trim();
        if (configured || rendered)
            return { text: rendered, source: rendered ? 'config' : 'none' };
        const directSources = wf.edges
            .filter(edge => edge.target === node.id && !edge.data?.telegramInline)
            .map(edge => edge.source);
        for (const sourceId of directSources) {
            const text = this.getTextOutput(ctx.nodes[sourceId]?.output);
            if (text)
                return { text, source: 'upstream' };
        }
        // Legacy workflows can omit the visual edge while still execute in order.
        // Only consider dedicated text-producing nodes to avoid sending a JSON
        // object or an IF result by accident.
        for (const sourceId of Object.keys(ctx.nodes).reverse()) {
            const sourceNode = ctx._wfNodes?.find(candidate => candidate.id === sourceId);
            if (!sourceNode || !['data.textFormat', 'data.randomPick', 'data.dateFormat', 'ai.generateText'].includes(sourceNode.type))
                continue;
            const text = this.getTextOutput(ctx.nodes[sourceId]?.output);
            if (text)
                return { text, source: 'upstream' };
        }
        return { text: '', source: 'none' };
    }
    getTextOutput(output) {
        if (typeof output === 'string')
            return output.trim();
        if (!output || typeof output !== 'object')
            return '';
        for (const key of ['result', 'text', 'message', 'content']) {
            if (typeof output[key] === 'string' && output[key].trim())
                return output[key].trim();
        }
        return '';
    }
    renderTemplate(template, ctx) {
        return template.replace(/\{\{\s*([\s\S]*?)\s*\}\}/gu, (_, raw) => {
            try {
                const expr = raw.trim();
                if (expr.startsWith('$trigger.')) {
                    const val = this.getNestedValue(ctx.trigger, expr.slice(9));
                    return String(val ?? '');
                }
                if (expr.startsWith('$var.'))
                    return String(ctx.variables?.[expr.slice(5)] ?? '');
                if (expr === '$pageId')
                    return ctx.pageId ?? '';
                if (expr === '$date.now')
                    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                if (expr === '$date.today')
                    return new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                if (expr.startsWith('$node.')) {
                    const rest = expr.slice(6);
                    const dotIdx = rest.indexOf('.');
                    if (dotIdx === -1)
                        return '';
                    const nodeRef = rest.slice(0, dotIdx);
                    const field = rest.slice(dotIdx + 1);
                    // Match by nodeId or by node label
                    for (const [nid, ndata] of Object.entries(ctx.nodes)) {
                        const nodeDef = ctx._wfNodes?.find(n => n.id === nid);
                        const labelOrId = nodeDef?.label || nid;
                        if (nid === nodeRef || labelOrId === nodeRef) {
                            // $node.X.output → return the whole output object (not getNestedValue on it)
                            if (field === 'output') {
                                const out = ndata.output;
                                const val = typeof out === 'string' ? out : (out?.result ?? out?.text ?? out?.message ?? JSON.stringify(out ?? ''));
                                Logger_1.default.info(`[WorkflowEngine] $node.${nodeRef}.output → matched by ${nid === nodeRef ? 'id' : 'label'}("${labelOrId}"), value="${String(val).substring(0, 200)}"`);
                                return String(val);
                            }
                            const val = this.getNestedValue(ndata.output, field);
                            Logger_1.default.info(`[WorkflowEngine] $node.${nodeRef}.${field} → matched by ${nid === nodeRef ? 'id' : 'label'}("${labelOrId}"), value="${String(val ?? '').substring(0, 200)}"`);
                            return String(val ?? '');
                        }
                    }
                    // Fallback: match "n4" → 4th node by array order (legacy template IDs like n1,n2,n3...)
                    const idxMatch = nodeRef.match(/^n(\d+)$/);
                    if (idxMatch && ctx._wfNodes) {
                        const targetIdx = parseInt(idxMatch[1]) - 1;
                        if (targetIdx >= 0 && targetIdx < ctx._wfNodes.length) {
                            const targetNodeId = ctx._wfNodes[targetIdx].id;
                            const ndata = ctx.nodes[targetNodeId];
                            if (ndata) {
                                let val;
                                if (field === 'output') {
                                    const out = ndata.output;
                                    val = typeof out === 'string' ? out : (out?.result ?? out?.text ?? out?.message ?? JSON.stringify(out ?? ''));
                                }
                                else {
                                    val = this.getNestedValue(ndata.output, field);
                                }
                                Logger_1.default.info(`[WorkflowEngine] $node.${nodeRef}.${field} → fallback n${targetIdx + 1} → node "${ctx._wfNodes[targetIdx].label}" (${targetNodeId}), value="${String(val ?? '').substring(0, 200)}"`);
                                return String(val ?? '');
                            }
                        }
                        Logger_1.default.warn(`[WorkflowEngine] $node.${nodeRef}.${field} → fallback n${targetIdx + 1} FAILED - no output for node at index ${targetIdx}. Available nodes: ${ctx._wfNodes.map((n, i) => `n${i + 1}=${n.label}`).join(', ')}`);
                    }
                }
            }
            catch { }
            return '';
        });
    }
    getNestedValue(obj, path) {
        return path.split('.').reduce((acc, key) => {
            if (acc === null || acc === undefined)
                return '';
            if (key.endsWith(']')) {
                const bracket = key.indexOf('[');
                const arrKey = key.slice(0, bracket);
                const idx = parseInt(key.slice(bracket + 1, -1));
                return acc[arrKey]?.[idx];
            }
            return acc[key];
        }, obj);
    }
    /**
     * Truncate data for log storage to prevent huge JSON blobs.
     * Truncates strings > 1000 chars and arrays/objects beyond a depth limit.
     */
    truncateData(data, maxStrLen = 1000, maxDepth = 5, depth = 0) {
        if (depth > maxDepth)
            return '[MaxDepth]';
        if (data === null || data === undefined)
            return data;
        if (typeof data === 'string') {
            return data.length > maxStrLen ? data.substring(0, maxStrLen) + `...[truncated, total ${data.length} chars]` : data;
        }
        if (typeof data === 'number' || typeof data === 'boolean')
            return data;
        if (Array.isArray(data)) {
            if (data.length > 50) {
                const arr = data.slice(0, 50).map((item) => this.truncateData(item, maxStrLen, maxDepth, depth + 1));
                arr.push(`...[truncated, total ${data.length} items]`);
                return arr;
            }
            return data.map((item) => this.truncateData(item, maxStrLen, maxDepth, depth + 1));
        }
        if (typeof data === 'object') {
            const result = {};
            for (const [key, value] of Object.entries(data)) {
                result[key] = this.truncateData(value, maxStrLen, maxDepth, depth + 1);
            }
            return result;
        }
        return String(data);
    }
    /**
     * Compare two values for greater_than / less_than.
     * Supports numbers and time strings (HH:MM or HH:MM:SS).
     * Returns positive if left > right, negative if left < right, 0 if equal.
     */
    compareValues(left, right) {
        // Try numeric comparison first
        const ln = Number(left), rn = Number(right);
        if (!isNaN(ln) && !isNaN(rn))
            return ln - rn;
        // Try time comparison: HH:MM or HH:MM:SS
        const parseTime = (s) => {
            const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (!m)
                return null;
            return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + (parseInt(m[3] || '0'));
        };
        const lt = parseTime(left), rt = parseTime(right);
        if (lt !== null && rt !== null)
            return lt - rt;
        // Fallback: string comparison (lexicographic)
        return left.localeCompare(right, 'vi');
    }
    /** Get the OpenAI-compatible chat/completions URL for a given platform */
    getOpenAICompatibleUrl(platform) {
        switch (platform) {
            case 'deepseek': return 'https://api.deepseek.com/v1/chat/completions';
            case 'grok': return 'https://api.x.ai/v1/chat/completions';
            case 'mistral': return 'https://api.mistral.ai/v1/chat/completions';
            case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions';
            case 'openai':
            default: return 'https://api.openai.com/v1/chat/completions';
        }
    }
    /** Convert OpenAI-format messages to Google Gemini format */
    openaiMessagesToGemini(messages) {
        // Gemini uses "contents" with role: "user" | "model"
        // System messages become a user+model pair at the start for best results
        const contents = [];
        let systemText = '';
        for (const msg of messages) {
            if (msg.role === 'system') {
                systemText += (systemText ? '\n' : '') + msg.content;
                continue;
            }
            const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
            contents.push({ role: geminiRole, parts: [{ text: msg.content }] });
        }
        // Prepend system instruction as a user→model pair if present
        if (systemText) {
            contents.unshift({ role: 'user', parts: [{ text: `System instruction: ${systemText}` }] }, { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
        }
        return contents;
    }
    getWorkflows() {
        return [...this.workflows.values()];
    }
    // ─── Structured AI response helpers ───────────────────────────────────────
    /**
     * Parse structured AI JSON response: [{type:"text",content:"..."}, {type:"image",content:["url",...]}]
     * Returns null if the message is not structured JSON, otherwise returns the parsed array.
     */
    // parseStructuredAIResponse → moved to utils/aiUtils.ts
    /**
     * Download a URL to a temporary file. Returns the local temp file path.
     */
    async downloadUrlToTempFile(url) {
        const tmpDir = path.join(os.tmpdir(), 'deplao-workflow-images');
        if (!fs.existsSync(tmpDir))
            fs.mkdirSync(tmpDir, { recursive: true });
        // Extract extension from URL or default to .jpg
        let ext = '.jpg';
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const match = pathname.match(/\.(\w{3,5})$/);
            if (match)
                ext = '.' + match[1];
        }
        catch { }
        const tempPath = path.join(tmpDir, `ai_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
        const response = await (0, axios_1.default)({
            method: 'GET',
            url,
            responseType: 'stream',
            timeout: 30000,
        });
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        return tempPath;
    }
}
exports.default = WorkflowEngineService;
//# sourceMappingURL=WorkflowEngineService.js.map