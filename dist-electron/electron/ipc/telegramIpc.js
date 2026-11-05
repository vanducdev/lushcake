"use strict";
/**
 * telegramIpc.ts - IPC handlers cho Telegram Bot channel
 *
 * Channels:
 * - telegram:validateBot    — Validate bot token qua getMe
 * - telegram:startBot       — Start polling cho bot account
 * - telegram:stopBot        — Stop polling
 * - telegram:sendMessage    — Gửi tin nhắn
 * - telegram:sendPhoto      — Gửi ảnh
 * - telegram:getActiveBots  — Get danh sách bot đang active
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
exports.registerTelegramIpc = registerTelegramIpc;
const electron_1 = require("electron");
const TelegramBotChannel = __importStar(require("../../src/services/telegram/TelegramBotChannelService"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
function registerTelegramIpc() {
    // ── Validate bot token ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:validateBot', async (_event, botToken) => {
        try {
            return await TelegramBotChannel.validateBotToken(botToken);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:validateBot] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Start bot polling ───────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:startBot', async (_event, account) => {
        try {
            TelegramBotChannel.startBot(account);
            return { success: true };
        }
        catch (err) {
            Logger_1.default.error(`[telegram:startBot] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Stop bot polling ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:stopBot', async (_event, accountId) => {
        try {
            TelegramBotChannel.stopBot(accountId);
            return { success: true };
        }
        catch (err) {
            Logger_1.default.error(`[telegram:stopBot] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Check if bot is actively polling ────────────────────────────────────
    electron_1.ipcMain.handle('telegram:isBotPolling', async (_event, params) => {
        try {
            const polling = TelegramBotChannel.isBotPolling(params.accountId);
            return { success: true, polling };
        }
        catch (err) {
            return { success: true, polling: false };
        }
    });
    // ── Send message ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendMessage', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendMessage(params);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:sendMessage] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Send photo ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendPhoto', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendPhoto(params.accountId, params.chatId, params.photoPath, params.caption);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:sendPhoto] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Get active bots ─────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:getActiveBots', async () => {
        try {
            // Strip non-serializable properties (functions, circular refs) for IPC
            const bots = TelegramBotChannel.getActiveBots().map(b => ({
                accountId: b.accountId,
                botUsername: b.botUsername,
                botFirstName: b.botFirstName,
            }));
            return { success: true, bots };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Send video ─────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendVideo', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendVideo(params.accountId, params.chatId, params.videoPath, params.caption);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:sendVideo] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Send document/file ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendDocument', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendDocument(params.accountId, params.chatId, params.filePath, params.caption);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:sendDocument] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Send audio ─────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendAudio', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendAudio(params.accountId, params.chatId, params.audioPath, params.caption);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:sendAudio] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Forward message ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:forwardMessage', async (_event, params) => {
        try {
            return await TelegramBotChannel.forwardMessage(params.accountId, params.chatId, params.fromChatId, params.messageId);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:forwardMessage] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Delete message ─────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:deleteMessage', async (_event, params) => {
        try {
            return await TelegramBotChannel.deleteMessage(params.accountId, params.chatId, params.messageId);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:deleteMessage] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Add reaction ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:addReaction', async (_event, params) => {
        try {
            return await TelegramBotChannel.addReaction(params.accountId, params.chatId, params.messageId, params.emoji);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:addReaction] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Pin message ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:pinMessage', async (_event, params) => {
        try {
            return await TelegramBotChannel.pinMessage(params.accountId, params.chatId, params.messageId);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:pinMessage] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Send poll ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendPoll', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendPoll(params.accountId, params.chatId, params.question, params.options);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:sendPoll] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Edit message ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:editMessage', async (_event, params) => {
        try {
            return await TelegramBotChannel.editMessage(params.accountId, params.chatId, params.messageId, params.text);
        }
        catch (err) {
            Logger_1.default.error(`[telegram:editMessage] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Group Management ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:getChat', async (_event, params) => {
        try {
            return await TelegramBotChannel.getChat(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:getChatAdministrators', async (_event, params) => {
        try {
            return await TelegramBotChannel.getChatAdministrators(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:getChatMember', async (_event, params) => {
        try {
            return await TelegramBotChannel.getChatMember(params.accountId, params.chatId, params.userId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:banChatMember', async (_event, params) => {
        try {
            return await TelegramBotChannel.banChatMember(params.accountId, params.chatId, params.userId, params.untilDate);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:unbanChatMember', async (_event, params) => {
        try {
            return await TelegramBotChannel.unbanChatMember(params.accountId, params.chatId, params.userId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:promoteChatMember', async (_event, params) => {
        try {
            return await TelegramBotChannel.promoteChatMember(params.accountId, params.chatId, params.userId, params.perms);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:leaveChat', async (_event, params) => {
        try {
            return await TelegramBotChannel.leaveChat(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:setChatPhoto', async (_event, params) => {
        try {
            return await TelegramBotChannel.setChatPhoto(params.accountId, params.chatId, params.photoPath);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:exportChatInviteLink', async (_event, params) => {
        try {
            return await TelegramBotChannel.exportChatInviteLink(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:deleteChatPhoto', async (_event, params) => {
        try {
            return await TelegramBotChannel.deleteChatPhoto(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:setChatDescription', async (_event, params) => {
        try {
            return await TelegramBotChannel.setChatDescription(params.accountId, params.chatId, params.description);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── New: Sending media types ────────────────────────────────────────────
    electron_1.ipcMain.handle('telegram:sendSticker', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendSticker(params.accountId, params.chatId, params.stickerPath);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:sendVoice', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendVoice(params.accountId, params.chatId, params.voicePath, params.caption);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:sendAnimation', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendAnimation(params.accountId, params.chatId, params.animPath, params.caption);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:sendVideoNote', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendVideoNote(params.accountId, params.chatId, params.videoPath);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:sendContact', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendContact(params.accountId, params.chatId, params.phone, params.firstName, params.lastName);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:sendLocation', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendLocation(params.accountId, params.chatId, params.latitude, params.longitude);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:sendChatAction', async (_event, params) => {
        try {
            return await TelegramBotChannel.sendChatAction(params.accountId, params.chatId, params.action || 'typing');
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:unpinChatMessage', async (_event, params) => {
        try {
            return await TelegramBotChannel.unpinChatMessage(params.accountId, params.chatId, params.messageId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:getChatMemberCount', async (_event, params) => {
        try {
            return await TelegramBotChannel.getChatMemberCount(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:restrictChatMember', async (_event, params) => {
        try {
            return await TelegramBotChannel.restrictChatMember(params.accountId, params.chatId, params.userId, params.permissions, params.untilDate);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegram:editMessageCaption', async (_event, params) => {
        try {
            return await TelegramBotChannel.editMessageCaption(params.accountId, params.chatId, params.messageId, params.caption);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    Logger_1.default.log('[telegramIpc] Registered 37 Telegram IPC channels');
}
//# sourceMappingURL=telegramIpc.js.map