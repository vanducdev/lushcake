"use strict";
/**
 * FacebookE2EESender.ts
 * Port từ Python `api` class trong _send_e2ee.py
 *
 * Gửi tin nhắn E2EE mã hóa cho hội thoại 1:1 qua Go bridge.
 * Hỗ trợ standalone mode (tự tạo bridge) hoặc reuse mode (dùng chung bridge với listener).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookE2EESender = void 0;
const FacebookE2EEBridge_1 = require("./FacebookE2EEBridge");
const FacebookUtils_1 = require("./FacebookUtils");
const Logger_1 = __importDefault(require("../../utils/Logger"));
// ─── Main Class ───────────────────────────────────────────────────────────────
class FacebookE2EESender {
    constructor(opts = {}) {
        this.opts = opts;
        this.bridge = null;
        this.ownsBridge = false;
        this.connected = false;
        /** Cached bridge reference (reuse mode) */
        this.sharedBridge = null;
        if (opts.mode === 'reuse' && opts.bridge) {
            this.sharedBridge = opts.bridge;
        }
    }
    // ─── Bridge access ───────────────────────────────────────────────────────
    getBridge() {
        if (this.sharedBridge)
            return this.sharedBridge;
        if (this.bridge && this.bridge.isAlive())
            return this.bridge;
        throw new FacebookE2EEBridge_1.BridgeNotReadyError();
    }
    // ─── Connect (standalone mode) ──────────────────────────────────────────
    /**
     * Standalone connect: spawn bridge → newClient → connect → connectE2EE
     */
    async connect(enableE2EE = true) {
        if (this.sharedBridge) {
            throw new Error('connect() chỉ dùng cho standalone mode. Reuse mode dùng chung bridge listener.');
        }
        if (this.connected) {
            return { user: { id: 'already' } };
        }
        if (!this.opts.cookie) {
            throw new Error('Cookie is required for standalone E2EE sender.');
        }
        const binaryPath = this.opts.binaryPath || (0, FacebookUtils_1.resolveE2EEBinaryPath)();
        this.bridge = FacebookE2EEBridge_1.FacebookE2EEBridge.create(binaryPath);
        this.bridge.spawn();
        this.ownsBridge = true;
        try {
            const cookies = (0, FacebookUtils_1.parseE2EECookies)(this.opts.cookie);
            await this.bridge.newClient({
                cookies,
                platform: 'facebook',
                logLevel: this.opts.logLevel || 'none',
                e2eeMemoryOnly: this.opts.e2eeMemoryOnly ?? true,
            });
            const info = await this.bridge.connect(120000);
            if (enableE2EE) {
                await this.bridge.connectE2EE(60000);
            }
            this.connected = true;
            Logger_1.default.log(`[FBE2EESender] Ready (user=${info?.user?.id ?? '?'})`);
            return info;
        }
        catch (err) {
            Logger_1.default.warn(`[FBE2EESender] Connect failed: ${err.message}`);
            if (this.bridge) {
                try {
                    await this.bridge.close();
                }
                catch { }
                this.bridge = null;
            }
            throw err;
        }
    }
    // ─── Send ────────────────────────────────────────────────────────────────
    /**
     * Gửi tin nhắn E2EE
     *
     * @param chatJid  JID đầy đủ (`{userId}@msgr`) hoặc Facebook user ID
     * @param text     Nội dung tin nhắn
     * @param replyMessageId    (optional) message ID để reply
     * @param replySenderJid    (optional) sender JID của message được reply
     */
    async send(chatJid, text, replyMessageId = '', replySenderJid = '') {
        try {
            const normalizedJid = (0, FacebookUtils_1.normalizeChatJid)(chatJid);
            const normalizedReplySenderJid = replySenderJid
                ? (0, FacebookUtils_1.normalizeChatJid)(replySenderJid)
                : '';
            const bridge = this.getBridge();
            const result = await bridge.sendE2EEMessage({
                chatJid: normalizedJid,
                text,
                replyToId: replyMessageId || '',
                replyToSenderJid: normalizedReplySenderJid,
            });
            return {
                success: true,
                messageId: result.messageId,
                timestamp: result.timestampMs || Date.now(),
            };
        }
        catch (err) {
            if (err instanceof FacebookE2EEBridge_1.BridgeError || err instanceof FacebookE2EEBridge_1.BridgeNotReadyError) {
                return { success: false, error: err.message };
            }
            return { success: false, error: err.message || 'Unknown E2EE send error' };
        }
    }
    /**
     * Gửi E2EE message đến user (convenience - tự động build JID)
     */
    async sendToUser(userId, text, replyMessageId = '', replySenderJid = '') {
        return this.send((0, FacebookUtils_1.chatJidFromUserId)(userId), text, replyMessageId, replySenderJid);
    }
    /**
     * Reply to an E2EE event (convenience - extracts chatJid, messageId, senderJid)
     */
    async reply(eventData, text) {
        return this.send(eventData.chatJid || '', text, eventData.id || eventData.messageId || '', eventData.senderJid || '');
    }
    /**
     * Gửi reaction cho tin nhắn E2EE 1:1
     */
    async sendReaction(chatJid, messageId, senderJid, emoji) {
        try {
            const bridge = this.getBridge();
            await bridge.sendE2EEReaction({
                chatJid: (0, FacebookUtils_1.normalizeChatJid)(chatJid),
                messageId,
                senderJid: senderJid ? (0, FacebookUtils_1.normalizeChatJid)(senderJid) : '',
                emoji,
            });
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'E2EE reaction error' };
        }
    }
    /**
     * Gửi ảnh qua E2EE 1:1
     */
    async sendImage(chatJid, imagePath, caption) {
        try {
            const bridge = this.getBridge();
            const result = await bridge.sendE2EEImage({
                chatJid: (0, FacebookUtils_1.normalizeChatJid)(chatJid),
                imagePath,
                caption,
            });
            return { success: true, messageId: result.messageId, timestamp: result.timestampMs };
        }
        catch (err) {
            return { success: false, error: err.message || 'E2EE image send error' };
        }
    }
    /**
     * Gửi video qua E2EE 1:1
     */
    async sendVideo(chatJid, videoPath, caption) {
        try {
            const bridge = this.getBridge();
            const result = await bridge.sendE2EEVideo({
                chatJid: (0, FacebookUtils_1.normalizeChatJid)(chatJid),
                videoPath,
                caption,
            });
            return { success: true, messageId: result.messageId, timestamp: result.timestampMs };
        }
        catch (err) {
            return { success: false, error: err.message || 'E2EE video send error' };
        }
    }
    /**
     * Gửi audio qua E2EE 1:1
     */
    async sendAudio(chatJid, audioPath, mimeType) {
        try {
            const bridge = this.getBridge();
            const result = await bridge.sendE2EEAudio({
                chatJid: (0, FacebookUtils_1.normalizeChatJid)(chatJid),
                audioPath,
                mimeType,
            });
            return { success: true, messageId: result.messageId, timestamp: result.timestampMs };
        }
        catch (err) {
            return { success: false, error: err.message || 'E2EE audio send error' };
        }
    }
    /**
     * Gửi file/tài liệu qua E2EE 1:1
     */
    async sendFile(chatJid, filePath, fileName) {
        try {
            const bridge = this.getBridge();
            const result = await bridge.sendE2EEDocument({
                chatJid: (0, FacebookUtils_1.normalizeChatJid)(chatJid),
                filePath,
                fileName,
            });
            return { success: true, messageId: result.messageId, timestamp: result.timestampMs };
        }
        catch (err) {
            return { success: false, error: err.message || 'E2EE file send error' };
        }
    }
    /**
     * Gửi sticker qua E2EE 1:1 (C4)
     */
    async sendSticker(chatJid, stickerId) {
        try {
            const bridge = this.getBridge();
            await bridge.sendE2EESticker({
                chatJid: (0, FacebookUtils_1.normalizeChatJid)(chatJid),
                stickerId,
            });
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'E2EE sticker send error' };
        }
    }
    // ─── Cleanup ─────────────────────────────────────────────────────────────
    async close() {
        if (this.ownsBridge && this.bridge) {
            await this.bridge.close();
            this.bridge = null;
            this.connected = false;
        }
    }
    isConnected() {
        if (this.sharedBridge)
            return this.sharedBridge.isAlive();
        return this.connected && this.bridge?.isAlive() === true;
    }
}
exports.FacebookE2EESender = FacebookE2EESender;
exports.default = FacebookE2EESender;
//# sourceMappingURL=FacebookE2EESender.js.map