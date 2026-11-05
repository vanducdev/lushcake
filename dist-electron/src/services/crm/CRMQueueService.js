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
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const ConnectionManager_1 = __importDefault(require("../../utils/ConnectionManager"));
const EventBroadcaster_1 = __importDefault(require("../event/EventBroadcaster"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const image_size_1 = __importDefault(require("image-size"));
const message_markup_1 = require("./message-markup");
const TelegramUser = __importStar(require("../telegram/TelegramUserListener"));
const TelegramBot = __importStar(require("../telegram/TelegramBotChannelService"));
/**
 * CRMQueueService - chạy trong main process
 * Token bucket per account: max 60 tin/giờ, refill 1 token mỗi 60s
 * Dispatcher loop: kiểm tra mỗi 5s, nếu đủ delay → gửi 1 tin rồi đợi
 */
class CRMQueueService {
    constructor() {
        this.timers = new Map();
        this.lastSentAt = new Map();
        this.isProcessing = new Map();
        // Token bucket: max 60/giờ - refill 1 token mỗi 60s
        this.tokens = new Map();
        this.lastRefillAt = new Map();
        // Daily limit tracking: campaignId → paused due to daily limit
        this.dailyPausedCampaigns = new Map();
        this.MAX_TOKENS = 60;
        this.REFILL_INTERVAL_MS = 60 * 1000; // 1 phút / token → 60/giờ
        this.CHECK_INTERVAL_MS = 5000; // kiểm tra mỗi 5s
        this.MIN_DELAY_MS = 30 * 1000; // tối thiểu 30s
        this.PHONE_RESOLVE_TIMEOUT_MS = 15000; // timeout resolve phone → tránh treo vô hạn
    }
    static getInstance() {
        if (!CRMQueueService.instance)
            CRMQueueService.instance = new CRMQueueService();
        return CRMQueueService.instance;
    }
    /** Bắt đầu dispatcher cho account */
    startForAccount(zaloId) {
        if (this.timers.has(zaloId))
            return;
        Logger_1.default.log(`[CRMQueue] ▶ Starting queue for ${zaloId}`);
        if (!this.tokens.has(zaloId)) {
            this.tokens.set(zaloId, this.MAX_TOKENS);
            this.lastRefillAt.set(zaloId, Date.now());
        }
        else {
            // Queue đã từng chạy trước đó → refill ngay dựa trên thời gian đã qua
            this.refillTokens(zaloId);
        }
        const timer = setInterval(() => this.process(zaloId), this.CHECK_INTERVAL_MS);
        this.timers.set(zaloId, timer);
    }
    /** Dừng dispatcher cho account */
    stopForAccount(zaloId) {
        const timer = this.timers.get(zaloId);
        if (timer) {
            clearInterval(timer);
            this.timers.delete(zaloId);
        }
        // Clean up satellite maps to prevent unbounded memory growth
        this.lastSentAt.delete(zaloId);
        this.isProcessing.delete(zaloId);
        this.tokens.delete(zaloId);
        this.lastRefillAt.delete(zaloId);
        Logger_1.default.log(`[CRMQueue] ⏹ Stopped queue for ${zaloId}`);
        // Notify renderer so the status bar disappears
        EventBroadcaster_1.default.emit('crm:queueStatus', {
            zaloId,
            type: 'stopped',
            running: false,
            tokens: this.tokens.get(zaloId) ?? this.MAX_TOKENS,
            maxTokens: this.MAX_TOKENS,
            lastSentAt: this.lastSentAt.get(zaloId) ?? 0,
        });
    }
    /** Dừng nếu không còn campaign active */
    checkAndStopIfIdle(zaloId) {
        const hasActive = DatabaseService_1.default.getInstance().hasActiveCampaigns(zaloId);
        if (!hasActive)
            this.stopForAccount(zaloId);
    }
    getStatus(zaloId) {
        const isDailyPaused = Array.from(this.dailyPausedCampaigns.values()).some(v => v);
        return {
            running: this.timers.has(zaloId),
            tokens: this.tokens.get(zaloId) ?? this.MAX_TOKENS,
            maxTokens: this.MAX_TOKENS,
            lastSentAt: this.lastSentAt.get(zaloId) ?? 0,
            dailyPaused: isDailyPaused,
        };
    }
    /** Khởi động lại tất cả campaigns đang active (sau khi app restart) */
    resumeActiveCampaigns() {
        try {
            const owners = DatabaseService_1.default.getInstance().getActiveCampaignOwners();
            for (const zaloId of owners) {
                Logger_1.default.log(`[CRMQueue] Resuming queue for ${zaloId}`);
                this.startForAccount(zaloId);
            }
        }
        catch (err) {
            Logger_1.default.warn(`[CRMQueue] resumeActiveCampaigns: ${err.message}`);
        }
    }
    refillTokens(zaloId) {
        const now = Date.now();
        const lastRefill = this.lastRefillAt.get(zaloId) || now;
        const elapsed = now - lastRefill;
        const tokensToAdd = Math.floor(elapsed / this.REFILL_INTERVAL_MS);
        if (tokensToAdd > 0) {
            const current = this.tokens.get(zaloId) ?? 0;
            this.tokens.set(zaloId, Math.min(this.MAX_TOKENS, current + tokensToAdd));
            this.lastRefillAt.set(zaloId, lastRefill + tokensToAdd * this.REFILL_INTERVAL_MS);
        }
    }
    async process(zaloId) {
        if (this.isProcessing.get(zaloId))
            return;
        // Refill tokens
        this.refillTokens(zaloId);
        const tokens = this.tokens.get(zaloId) ?? 0;
        if (tokens <= 0) {
            Logger_1.default.log(`[CRMQueue] ${zaloId}: No tokens left, waiting for refill`);
            this.broadcastStatus(zaloId, 'rate_limited');
            return;
        }
        const db = DatabaseService_1.default.getInstance();
        const item = db.getNextPendingCampaignContact(zaloId);
        if (!item) {
            this.checkAndStopIfIdle(zaloId);
            return;
        }
        // ── Daily send limit check ──────────────────────────────────────
        const campaignData = db.getCRMCampaign(item.campaign_id);
        // ── Daily start time (tách riêng, không phụ thuộc daily_send_limit) ──
        // Nếu daily_start_time đã qua hôm nay → chạy luôn
        // Nếu chưa đến → đợi
        if (campaignData && campaignData.daily_start_time) {
            const now = new Date();
            const [hh, mm] = campaignData.daily_start_time.split(':').map(Number);
            if (!isNaN(hh) && !isNaN(mm)) {
                const todayStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
                if (now < todayStartTime) {
                    Logger_1.default.log(`[CRMQueue] Campaign ${item.campaign_id}: before daily start time ${campaignData.daily_start_time}`);
                    this.broadcastStatus(zaloId, 'waiting_for_start_time');
                    return;
                }
            }
        }
        // ── Daily limit (chỉ áp dụng nếu có giới hạn) ───────────────────
        if (campaignData && campaignData.daily_send_limit && campaignData.daily_send_limit > 0) {
            const dailyCount = db.getDailySentCountForCampaign(item.campaign_id);
            if (dailyCount >= campaignData.daily_send_limit) {
                this.dailyPausedCampaigns.set(item.campaign_id, true);
                Logger_1.default.log(`[CRMQueue] Campaign ${item.campaign_id} daily limit reached: ${dailyCount}/${campaignData.daily_send_limit}`);
                this.broadcastStatus(zaloId, 'daily_limit_reached');
                return;
            }
            this.dailyPausedCampaigns.delete(item.campaign_id);
        }
        // Check delay: random between delay_min_seconds and delay_max_seconds (range-based)
        const itemAny = item;
        const rawMin = itemAny.delay_min_seconds ?? Math.max(30, (item.delay_seconds || 60) - 10);
        const rawMax = itemAny.delay_max_seconds ?? Math.max(rawMin, (item.delay_seconds || 60) + 10);
        const delayMinSec = Math.max(this.MIN_DELAY_MS / 1000, rawMin);
        const delayMaxSec = Math.max(delayMinSec, rawMax);
        const actualDelayMs = (delayMinSec + Math.random() * (delayMaxSec - delayMinSec)) * 1000;
        const lastSent = this.lastSentAt.get(zaloId) || 0;
        if (Date.now() - lastSent < actualDelayMs)
            return;
        // Get connection
        const conn = ConnectionManager_1.default.getConnection(zaloId);
        const account = db.getAccounts().find(a => a.zalo_id === zaloId);
        // Account is authoritative for legacy campaigns created before the
        // channel snapshot migration; new campaigns persist the same value.
        const channel = account?.channel || campaignData?.channel || 'zalo';
        if (channel === 'zalo' && !conn?.api) {
            Logger_1.default.warn(`[CRMQueue] No connection for ${zaloId}, skipping`);
            return;
        }
        // ── Bắt đầu processing ──────────────────────────────────────────────
        // Đặt isProcessing bên ngoài try, nhưng sẽ reset trong finally
        this.isProcessing.set(zaloId, true);
        // Khai báo tất cả vars ở đây để catch block có thể truy cập
        let effectiveContactId = item.contact_id;
        let effectiveDisplayName = item.display_name || '';
        let campaignType = 'message';
        let isGroup = false;
        let friendMsg = '';
        let mixedActions = [];
        let mixedGroupIds = [];
        let blocksToSend = [];
        let sendMode = 'random';
        let message = '';
        let logBase = {};
        let describeBlock = () => '';
        let substitute = (t) => t;
        try {
            db.updateCampaignContactStatus(item.id, 'sending');
            // ── Phone resolution at send time ──────────────────────────────
            if (channel === 'zalo' && item.contact_id.startsWith('phone:')) {
                const phone = item.contact_id.slice(6);
                Logger_1.default.log(`[CRMQueue] Resolving phone ${phone} at send time...`);
                const resolved = await this.resolvePhoneContact(phone, conn.api);
                if (!resolved) {
                    Logger_1.default.warn(`[CRMQueue] Phone ${phone} not found on Zalo, marking failed`);
                    db.updateCampaignContactStatus(item.id, 'failed', 'Không tìm thấy SĐT trên Zalo');
                    db.save();
                    this.broadcastProgress(zaloId, item.campaign_id, item.contact_id, 'failed', 'Không tìm thấy SĐT trên Zalo');
                    this.checkCampaignCompletion(item.campaign_id, zaloId);
                    this.isProcessing.set(zaloId, false);
                    return;
                }
                effectiveContactId = resolved.uid;
                effectiveDisplayName = resolved.name;
                try {
                    db.updateCampaignContactId(item.id, resolved.uid, resolved.name);
                }
                catch { /* non-critical */ }
                Logger_1.default.log(`[CRMQueue] Phone ${phone} → UID ${resolved.uid} (${resolved.name})`);
            }
            // ── UID resolution at send time ────────────────────────────────
            if (channel === 'zalo' && !effectiveDisplayName && /^\d{5,}$/.test(effectiveContactId)) {
                Logger_1.default.log(`[CRMQueue] Resolving UID ${effectiveContactId} via getUserInfo...`);
                try {
                    const infoRes = await conn.api.getUserInfo(effectiveContactId);
                    const profile = infoRes?.response?.changed_profiles?.[effectiveContactId]
                        ?? infoRes?.changed_profiles?.[effectiveContactId];
                    if (profile)
                        effectiveDisplayName = profile.displayName || profile.zaloName || profile.name || '';
                    if (effectiveDisplayName) {
                        try {
                            db.updateCampaignContactId(item.id, effectiveContactId, effectiveDisplayName);
                        }
                        catch { /* */ }
                        Logger_1.default.log(`[CRMQueue] UID ${effectiveContactId} → "${effectiveDisplayName}"`);
                    }
                    else
                        Logger_1.default.warn(`[CRMQueue] UID ${effectiveContactId}: getUserInfo returned no name`);
                }
                catch (uidErr) {
                    Logger_1.default.warn(`[CRMQueue] UID ${effectiveContactId} getUserInfo failed: ${uidErr.message}`);
                }
            }
            // ── Template preparation ───────────────────────────────────────
            substitute = (tpl) => (tpl || '')
                .replace(/\{name\}/g, effectiveDisplayName || item.contact_id)
                .replace(/\{userId\}/g, effectiveContactId);
            campaignType = item.campaign_type || 'message';
            isGroup = item.contact_type === 'group';
            friendMsg = substitute(item.friend_request_message || '') || substitute(item.template_message || '') || 'Xin chào!';
            let mixedConfig = {};
            try {
                mixedConfig = JSON.parse(item.mixed_config || '{}');
            }
            catch { }
            mixedActions = mixedConfig.actions || [];
            mixedGroupIds = mixedConfig.group_ids || [];
            const parseContentBlocks = (raw) => {
                try {
                    const p = JSON.parse(raw);
                    if (p && Array.isArray(p.blocks))
                        return { blocks: p.blocks, mode: p.mode === 'all' ? 'all' : 'random' };
                }
                catch { }
                return { blocks: [{ id: '', text: raw, images: [] }], mode: 'random' };
            };
            const { blocks: allBlocks, mode: parsedMode } = parseContentBlocks(item.template_message || '');
            sendMode = parsedMode;
            if (sendMode === 'random') {
                const idx = allBlocks.length > 0 ? Math.floor(Math.random() * allBlocks.length) : 0;
                blocksToSend = allBlocks.length > 0 ? [allBlocks[idx]] : [];
            }
            else {
                blocksToSend = allBlocks;
            }
            // Helper: send one block (text + images)
            const sendBlock = async (block, threadId, threadType) => {
                const responses = [];
                const substitutedText = substitute(block.text || '');
                // CRM markup is a Zalo-only transport feature. Telegram must
                // receive exactly what the user composed (including literal
                // square-bracket text) and never run through the Zalo parser.
                const { text: cleanText, styles } = channel === 'zalo'
                    ? (0, message_markup_1.parseMarkup)(substitutedText)
                    : { text: substitutedText, styles: [] };
                // Telegram senders live in the main process and return a normalized
                // result.  Markup/@all are Zalo-specific, so they are intentionally
                // stripped rather than rendered as an unsupported action.
                if (channel === 'telegram_user' || channel === 'telegram_bot') {
                    const sendText = async (text) => channel === 'telegram_user'
                        ? TelegramUser.sendMessage(zaloId, threadId, text)
                        : TelegramBot.sendMessage(zaloId, threadId, text);
                    const sendImage = async (filePath) => channel === 'telegram_user'
                        ? TelegramUser.sendFile(zaloId, threadId, filePath, undefined, 'image')
                        : TelegramBot.sendPhoto(zaloId, threadId, filePath);
                    if (cleanText.trim()) {
                        const resp = await sendText(cleanText);
                        if (!resp.success)
                            throw new Error(resp.error || 'Telegram không gửi được tin nhắn');
                        responses.push(resp);
                    }
                    for (const filePath of (block.images || []).filter(Boolean)) {
                        const resp = await sendImage(filePath);
                        if (!resp.success)
                            throw new Error(resp.error || 'Telegram không gửi được ảnh');
                        responses.push(resp);
                    }
                    return responses;
                }
                if (cleanText.trim()) {
                    const content = { msg: cleanText };
                    let finalStyles = styles;
                    // Tag-all chỉ có nghĩa trong nhóm (threadType 1); user thường (0) bỏ qua.
                    if (threadType === 1 && block.tagAll) {
                        const label = '@' + ((block.tagAllText || 'all').trim() || 'all');
                        const prefix = label + ' ';
                        content.msg = prefix + cleanText;
                        // uid "-1" = mention toàn nhóm; len phải bao đúng đoạn label (đã trừ dấu cách)
                        content.mentions = [{ pos: 0, uid: '-1', len: label.length }];
                        finalStyles = styles.map(s => ({ ...s, start: s.start + prefix.length }));
                    }
                    if (finalStyles.length)
                        content.styles = finalStyles;
                    const resp = await conn.api.sendMessage(content, threadId, threadType);
                    responses.push(resp);
                }
                const imgs = (block.images || []).filter(Boolean);
                if (imgs.length > 0) {
                    await new Promise(r => setTimeout(r, 500));
                    const attachments = [];
                    for (const filePath of imgs) {
                        try {
                            const buffer = fs.readFileSync(filePath);
                            const baseName = path.basename(filePath);
                            const ext = path.extname(baseName) || '.jpg';
                            const safeFilename = (path.extname(baseName) ? baseName : `${baseName}${ext}`);
                            let width = 0, height = 0;
                            try {
                                const dim = (0, image_size_1.default)(buffer);
                                width = dim.width ?? 0;
                                height = dim.height ?? 0;
                            }
                            catch { }
                            attachments.push({ data: buffer, filename: safeFilename, metadata: { totalSize: buffer.length, width, height } });
                        }
                        catch (readErr) {
                            Logger_1.default.error(`[CRMQueue] Image read failed: ${filePath} → ${readErr.message}`);
                            throw new Error(`Không đọc được ảnh: ${filePath} - ${readErr.message}`);
                        }
                    }
                    if (attachments.length > 0) {
                        const resp = await conn.api.sendMessage({ msg: '', attachments }, threadId, threadType);
                        responses.push(resp);
                    }
                }
                return responses;
            };
            // Legacy single-message string for log display
            const firstBlock = blocksToSend[0];
            const displayText = (raw) => {
                const substituted = substitute(raw);
                return channel === 'zalo' ? (0, message_markup_1.parseMarkup)(substituted).text : substituted;
            };
            const firstBlockText = firstBlock ? displayText(firstBlock.text || '') : '';
            const firstBlockImgCount = firstBlock?.images?.filter(Boolean).length || 0;
            message = firstBlockText.trim()
                ? firstBlockText + (firstBlockImgCount > 0 ? ` + ${firstBlockImgCount} ảnh` : '')
                : firstBlockImgCount > 0
                    ? `[${firstBlockImgCount} ảnh]`
                    : '(trống)';
            // Helper: describe block content for log (dùng trong catch)
            describeBlock = (block) => {
                const txt = displayText(block.text || '').trim();
                const imgCount = (block.images || []).filter(Boolean).length;
                if (txt && imgCount > 0)
                    return `${txt} + ${imgCount} ảnh`;
                if (txt)
                    return txt;
                if (imgCount > 0)
                    return `[${imgCount} ảnh]`;
                return '(trống)';
            };
            // Common log base fields
            logBase = {
                owner_zalo_id: zaloId,
                channel,
                contact_id: effectiveContactId,
                display_name: effectiveDisplayName || '',
                phone: item.phone || '',
                contact_type: isGroup ? 'group' : 'user',
                campaign_id: item.campaign_id,
                sent_at: Date.now(),
            };
            // Helper: send multiple blocks with per-block error catching
            const sendBlocks = async (blocks, threadId, threadType) => {
                // Per-contact delay between blocks: use campaign config or fallback 1s
                let perContactDelayMs = 1000;
                if (campaignData) {
                    const pcMin = campaignData.per_contact_delay_min_seconds || 0;
                    const pcMax = campaignData.per_contact_delay_max_seconds || 0;
                    if (pcMin > 0 && pcMax > 0) {
                        perContactDelayMs = (pcMin + Math.random() * (pcMax - pcMin)) * 1000;
                    }
                    else if (pcMin > 0) {
                        perContactDelayMs = pcMin * 1000;
                    }
                }
                let sent = 0;
                const errors = [];
                const responses = [];
                for (let bi = 0; bi < blocks.length; bi++) {
                    if (bi > 0)
                        await new Promise(r => setTimeout(r, perContactDelayMs));
                    try {
                        const resps = await sendBlock(blocks[bi], threadId, threadType);
                        responses.push(...resps);
                        sent++;
                    }
                    catch (blockErr) {
                        const errMsg = blockErr?.message || String(blockErr);
                        errors.push(errMsg);
                        Logger_1.default.error(`[CRMQueue] Block ${bi + 1}/${blocks.length} failed for ${threadId}: ${errMsg}`);
                    }
                }
                return { sent, errors, responses };
            };
            // ── Actual send logic ──────────────────────────────────────────
            if (isGroup) {
                // ── Gửi vào nhóm ─────────────────────────────────────────────────
                const threadType = 1;
                const result = await sendBlocks(blocksToSend, effectiveContactId, threadType);
                const logMsg = sendMode === 'all'
                    ? `[Nhóm] ${result.sent}/${blocksToSend.length} nội dung: ${blocksToSend.map(describeBlock).join(' | ')}`
                    : `[Nhóm] ${message}`;
                db.updateCampaignContactStatus(item.id, result.errors.length > 0 ? 'failed' : 'sent', result.errors.join('; ') || undefined);
                db.saveSendLog({ ...logBase, message: logMsg, status: result.errors.length > 0 ? 'failed' : 'sent',
                    error: result.errors.join('; ') || '', send_type: 'message',
                    data_request: JSON.stringify({ type: 'sendMessage', threadId: effectiveContactId, threadType, blocks: blocksToSend.length, sent: result.sent }),
                    data_response: result.responses.length > 0 ? JSON.stringify(result.responses.length === 1 ? result.responses[0] : result.responses) : '' });
            }
            else if (campaignType === 'mixed' && mixedActions.length > 0) {
                // ── Hỗn hợp (mới) ────────────────────────────────────────────────
                let anyFailed = false;
                for (const action of mixedActions) {
                    try {
                        if (action === 'message') {
                            const threadType = 0;
                            const result = await sendBlocks(blocksToSend, effectiveContactId, threadType);
                            const logMsg = sendMode === 'all'
                                ? `[Hỗn hợp/Tin nhắn] ${result.sent}/${blocksToSend.length} nội dung: ${blocksToSend.map(describeBlock).join(' | ')}`
                                : `[Hỗn hợp/Tin nhắn] ${message}`;
                            db.saveSendLog({ ...logBase, message: logMsg, status: result.errors.length > 0 ? 'failed' : 'sent',
                                error: result.errors.join('; ') || '', send_type: 'message',
                                data_request: JSON.stringify({ type: 'sendMessage', threadId: effectiveContactId, threadType, blocks: blocksToSend.length, sent: result.sent }),
                                data_response: result.responses.length > 0 ? JSON.stringify(result.responses.length === 1 ? result.responses[0] : result.responses) : '' });
                            if (result.errors.length > 0)
                                anyFailed = true;
                            Logger_1.default.log(`[CRMQueue] Mixed/message ✅ → ${effectiveContactId} (${result.sent}/${blocksToSend.length} blocks)`);
                        }
                        else if (action === 'friend_request') {
                            const req = { type: 'sendFriendRequest', msg: friendMsg, userId: effectiveContactId };
                            const resp = await conn.api.sendFriendRequest(friendMsg, effectiveContactId);
                            db.saveSendLog({ ...logBase, message: `[Hỗn hợp/Kết bạn] ${friendMsg}`, status: 'sent', send_type: 'friend_request',
                                data_request: JSON.stringify(req), data_response: JSON.stringify(resp) });
                            Logger_1.default.log(`[CRMQueue] Mixed/friend_request ✅ → ${effectiveContactId}`);
                        }
                        else if (action === 'invite_to_groups' && mixedGroupIds.length > 0) {
                            const req = { type: 'inviteUserToGroups', userId: effectiveContactId, groupIds: mixedGroupIds };
                            const resp = await conn.api.inviteUserToGroups(effectiveContactId, mixedGroupIds);
                            db.saveSendLog({ ...logBase,
                                message: `[Hỗn hợp/Mời nhóm] Mời vào ${mixedGroupIds.length} nhóm: ${mixedGroupIds.join(', ')}`,
                                status: 'sent', send_type: 'invite_to_group',
                                data_request: JSON.stringify(req), data_response: JSON.stringify(resp) });
                            Logger_1.default.log(`[CRMQueue] Mixed/invite_to_groups ✅ → ${effectiveContactId} into ${mixedGroupIds.length} groups`);
                        }
                    }
                    catch (actionErr) {
                        const errCode = Number(actionErr?.errorCode ?? actionErr?.code ?? actionErr?.error_code ?? -1);
                        const req = { type: action, userId: effectiveContactId };
                        const errResponse = {
                            error: true,
                            message: actionErr.message,
                            errorCode: errCode !== -1 ? errCode : undefined,
                        };
                        db.saveSendLog({ ...logBase,
                            message: `[Hỗn hợp/${action}] Lỗi: ${actionErr.message}`,
                            status: 'failed', error: actionErr.message,
                            data_request: JSON.stringify(req), data_response: JSON.stringify(errResponse) });
                        Logger_1.default.warn(`[CRMQueue] Mixed/${action} ❌ → ${effectiveContactId}: ${actionErr.message}`);
                        anyFailed = true;
                    }
                }
                db.updateCampaignContactStatus(item.id, anyFailed && mixedActions.length === 1 ? 'failed' : 'sent');
            }
            else if (campaignType === 'mixed') {
                // ── Hỗn hợp (cũ / fallback) ──────────────────────────────────────
                let actionLabel = 'message';
                let mixedResp = [];
                try {
                    mixedResp = await sendBlock(blocksToSend[0] ?? { id: '', text: '', images: [] }, effectiveContactId, 0);
                }
                catch (msgErr) {
                    if (isMixedFallbackError(msgErr)) {
                        Logger_1.default.log(`[CRMQueue] Mixed fallback → sendFriendRequest for ${effectiveContactId}`);
                        const friendResp = await conn.api.sendFriendRequest(friendMsg, effectiveContactId);
                        mixedResp = [friendResp];
                        actionLabel = 'friend_request_fallback';
                    }
                    else {
                        throw msgErr;
                    }
                }
                db.updateCampaignContactStatus(item.id, 'sent');
                db.saveSendLog({ ...logBase,
                    message: actionLabel === 'message' ? message : `[Kết bạn dự phòng] ${friendMsg}`,
                    status: 'sent',
                    send_type: actionLabel === 'message' ? 'message' : 'friend_request',
                    data_request: JSON.stringify({ type: actionLabel, contact_id: effectiveContactId }),
                    data_response: mixedResp.length > 0 ? JSON.stringify(mixedResp.length === 1 ? mixedResp[0] : mixedResp) : '' });
            }
            else if (campaignType === 'friend_request') {
                // ── Kết bạn only ─────────────────────────────────────────────────
                const req = { type: 'sendFriendRequest', msg: friendMsg, userId: effectiveContactId };
                const resp = await conn.api.sendFriendRequest(friendMsg, effectiveContactId);
                db.updateCampaignContactStatus(item.id, 'sent');
                db.saveSendLog({ ...logBase, message: `[Kết bạn] ${friendMsg}`, status: 'sent',
                    data_request: JSON.stringify(req), data_response: JSON.stringify(resp) });
            }
            else if (campaignType === 'invite_to_group') {
                // ── Mời vào nhóm (standalone) ─────────────────────────────────────
                const groupIds = mixedGroupIds;
                if (groupIds.length === 0)
                    throw new Error('Không có nhóm nào được chỉ định trong chiến dịch');
                const req = { type: 'inviteUserToGroups', userId: effectiveContactId, groupIds };
                const resp = await conn.api.inviteUserToGroups(effectiveContactId, groupIds);
                db.updateCampaignContactStatus(item.id, 'sent');
                db.saveSendLog({ ...logBase,
                    message: `[Mời nhóm] Mời vào ${groupIds.length} nhóm: ${groupIds.join(', ')}`,
                    status: 'sent', send_type: 'invite_to_group',
                    data_request: JSON.stringify(req), data_response: JSON.stringify(resp) });
                Logger_1.default.log(`[CRMQueue] Invite ✅ → ${effectiveContactId} into ${groupIds.length} groups`);
            }
            else {
                // ── Tin nhắn only (default) ───────────────────────────────────────
                const threadType = 0;
                const result = await sendBlocks(blocksToSend, effectiveContactId, threadType);
                const logMsg = sendMode === 'all'
                    ? `[${result.sent}/${blocksToSend.length} nội dung] ${blocksToSend.map(describeBlock).join(' | ')}`
                    : message;
                const finalStatus = result.errors.length > 0 ? 'failed' : 'sent';
                db.updateCampaignContactStatus(item.id, finalStatus, result.errors.join('; ') || undefined);
                db.saveSendLog({ ...logBase, message: logMsg, status: finalStatus,
                    error: result.errors.join('; ') || '',
                    data_request: JSON.stringify({ type: 'sendMessage', threadId: effectiveContactId, threadType, blocks: blocksToSend.length, sent: result.sent }),
                    data_response: result.responses.length > 0 ? JSON.stringify(result.responses.length === 1 ? result.responses[0] : result.responses) : '' });
            }
            // Tiêu thụ 1 token
            this.tokens.set(zaloId, Math.max(0, (this.tokens.get(zaloId) ?? 1) - 1));
            this.lastSentAt.set(zaloId, Date.now());
            db.save();
            Logger_1.default.log(`[CRMQueue] ✅ Sent to ${effectiveContactId} (campaign ${item.campaign_id})`);
            this.broadcastProgress(zaloId, item.campaign_id, effectiveContactId, 'sent');
            this.checkCampaignCompletion(item.campaign_id, zaloId);
        }
        catch (err) {
            const errMsg = err?.message || String(err);
            Logger_1.default.error(`[CRMQueue] ❌ Failed to send to ${effectiveContactId}: ${errMsg}`);
            // Always save log on failure - use describeBlock for human-readable message
            const fallbackLogMsg = blocksToSend.length > 0
                ? blocksToSend.map(describeBlock).join(' | ')
                : (item.template_message || '(unknown)');
            try {
                db.updateCampaignContactStatus(item.id, 'failed', errMsg);
                // Capture error response details if available
                const errResponse = {
                    error: true,
                    message: errMsg,
                    errorCode: err?.errorCode ?? err?.code ?? err?.error_code ?? undefined,
                };
                db.saveSendLog({ ...logBase,
                    message: `[Lỗi] ${errMsg} - ${fallbackLogMsg}`,
                    status: 'failed', error: errMsg,
                    send_type: campaignType === 'friend_request' ? 'friend_request' : campaignType === 'mixed' ? 'mixed' : 'message',
                    data_request: JSON.stringify({ type: campaignType, contact_id: effectiveContactId }),
                    data_response: JSON.stringify(errResponse) });
                db.save();
            }
            catch (logErr) {
                Logger_1.default.error(`[CRMQueue] ❌ Failed to save error log: ${logErr.message}`);
            }
            this.broadcastProgress(zaloId, item.campaign_id, effectiveContactId, 'failed', errMsg);
            this.checkCampaignCompletion(item.campaign_id, zaloId);
        }
        finally {
            this.isProcessing.set(zaloId, false);
        }
    }
    checkCampaignCompletion(campaignId, zaloId) {
        try {
            const db = DatabaseService_1.default.getInstance();
            const contacts = db.getCampaignContacts(campaignId);
            const hasPending = contacts.some(c => c.status === 'pending' || c.status === 'sending');
            if (!hasPending) {
                db.updateCRMCampaignStatus(campaignId, 'done');
                db.save();
                Logger_1.default.log(`[CRMQueue] Campaign ${campaignId} completed`);
                EventBroadcaster_1.default.emit('crm:campaignDone', { zaloId, campaignId });
                this.checkAndStopIfIdle(zaloId);
            }
        }
        catch (err) {
            Logger_1.default.warn(`[CRMQueue] checkCampaignCompletion: ${err.message}`);
        }
    }
    broadcastProgress(zaloId, campaignId, contactId, status, error) {
        const db = DatabaseService_1.default.getInstance();
        const dailyCount = db.getDailySentCountForCampaign(campaignId);
        EventBroadcaster_1.default.emit('crm:queueUpdate', {
            zaloId, campaignId, contactId, status, error,
            tokens: this.tokens.get(zaloId) ?? 0,
            maxTokens: this.MAX_TOKENS,
            lastSentAt: this.lastSentAt.get(zaloId) ?? 0,
            dailySentCount: dailyCount,
        });
    }
    broadcastStatus(zaloId, type) {
        const isDailyPaused = type === 'daily_limit_reached' || type === 'waiting_for_start_time';
        EventBroadcaster_1.default.emit('crm:queueStatus', {
            zaloId, type,
            tokens: this.tokens.get(zaloId) ?? 0,
            maxTokens: this.MAX_TOKENS,
            lastSentAt: this.lastSentAt.get(zaloId) ?? 0,
            dailyPaused: isDailyPaused,
        });
    }
    /**
     * Resolve a phone number to Zalo UID via API.
     * Called at send time to avoid rate limiting when importing phones.
     * Returns { uid, name } or null if not found.
     */
    async resolvePhoneContact(phone, api) {
        // Timeout để tránh API treo vô hạn → queue tê liệt
        /** Helper tạo promise với timeout */
        const withTimeout = (promise, ms) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), ms)),
        ]);
        try {
            const res = await withTimeout(api.findUser(phone), this.PHONE_RESOLVE_TIMEOUT_MS);
            const u = res?.response ?? res;
            if (!u?.uid)
                return null;
            let name = u.display_name || u.zalo_name || phone;
            try {
                const infoRes = await withTimeout(api.getUserInfo(u.uid), this.PHONE_RESOLVE_TIMEOUT_MS);
                const profile = infoRes?.response?.changed_profiles?.[u.uid] ?? infoRes?.changed_profiles?.[u.uid];
                if (profile) {
                    name = profile.displayName || profile.zaloName || profile.name || name;
                }
            }
            catch { /* getUserInfo failure is non-fatal */ }
            return { uid: String(u.uid), name };
        }
        catch {
            return null;
        }
    }
}
exports.default = CRMQueueService;
/**
 * Kiểm tra lỗi gửi tin nhắn có phải do người dùng chặn người lạ không.
 * Nếu đúng → chế độ hỗn hợp sẽ fallback sang gửi lời mời kết bạn.
 */
function isMixedFallbackError(err) {
    const code = Number(err?.errorCode ?? err?.code ?? err?.error_code ?? -1);
    // Zalo error codes for "can only receive from friends" or "blocked"
    if ([4, 9, 214, 216, 576, 579].includes(code))
        return true;
    const msg = String(err?.message || '').toLowerCase();
    return (msg.includes('block') ||
        msg.includes('chặn') ||
        msg.includes('bạn bè') ||
        msg.includes('không thể gửi') ||
        msg.includes('không hợp lệ') ||
        msg.includes('stranger') ||
        msg.includes('not friend') ||
        msg.includes('permission'));
}
//# sourceMappingURL=CRMQueueService.js.map