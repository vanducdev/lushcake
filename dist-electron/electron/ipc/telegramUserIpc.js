"use strict";
/**
 * telegramUserIpc.ts - IPC handlers cho Telegram cá nhân (MTProto)
 *
 * Channels:
 * - telegramUser:sendCode      — Gửi mã OTP đến SĐT
 * - telegramUser:signIn         — Xác nhận mã OTP
 * - telegramUser:signIn2FA      — Xác nhận 2FA password
 * - telegramUser:startListener  — Start MTProto listener
 * - telegramUser:stopListener   — Stop listener
 * - telegramUser:sendMessage    — Gửi tin nhắn
 * - telegramUser:isConnected    — Check connection status
 * - telegramUser:getActive      — Get danh sách listeners active
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
exports.registerTelegramUserIpc = registerTelegramUserIpc;
const electron_1 = require("electron");
const TelegramUser = __importStar(require("../../src/services/telegram/TelegramUserListener"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
function getTopicRootMessageId(params) {
    const topicRootMessageId = params.topicRootMessageId || params.topicId;
    if (!topicRootMessageId)
        throw new Error('Thiếu topicRootMessageId cho Telegram forum');
    return topicRootMessageId;
}
function registerTelegramUserIpc() {
    // ── Send OTP code ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:sendCode', async (_event, phoneNumber) => {
        try {
            return await TelegramUser.sendCode(phoneNumber);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:sendCode] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Sign in with OTP ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:signIn', async (_event, params) => {
        try {
            return await TelegramUser.signIn(params.phoneNumber, params.code, params.phoneCodeHash);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:signIn] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Sign in with 2FA ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:signIn2FA', async (_event, password) => {
        try {
            return await TelegramUser.signIn2FA(password);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:signIn2FA] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Start listener ──────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:startListener', async (_event, account) => {
        try {
            return await TelegramUser.startListener(account);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:startListener] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Stop listener ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:stopListener', async (_event, accountId) => {
        try {
            TelegramUser.stopListener(accountId);
            return { success: true };
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:stopListener] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Send message ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:sendMessage', async (_event, params) => {
        try {
            return await TelegramUser.sendMessage(params.accountId, params.chatId, params.text, params.mentions, params.replyToMsgId);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:sendMessage] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Check connection ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:isConnected', async (_event, accountId) => {
        try {
            return { success: true, connected: TelegramUser.isConnected(accountId) };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Get active listeners ────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:getActive', async () => {
        try {
            return { success: true, listeners: TelegramUser.getActiveListeners() };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Explicit message catch-up from the TopBar refresh action ───────────
    // A full Telegram history pass can take minutes. Acknowledge immediately
    // and let the service notify the renderer when background work completes.
    electron_1.ipcMain.handle('telegramUser:refreshMessages', async (_event, params) => {
        try {
            return TelegramUser.startAccountMessageRefresh(params.accountId);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:refreshMessages] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Fetch self avatar ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:fetchSelfAvatar', async (_event, accountId) => {
        try {
            return await TelegramUser.fetchSelfAvatar(accountId);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:fetchSelfAvatar] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Refresh contact avatar (re-download when file missing) ─────────────
    electron_1.ipcMain.handle('telegramUser:refreshContactAvatar', async (_event, params) => {
        try {
            return await TelegramUser.refreshContactAvatar(params.accountId, params.chatId);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:refreshContactAvatar] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Get bot commands (via users.getFullUser → botInfo.commands) ─────────
    electron_1.ipcMain.handle('telegramUser:getBotCommands', async (_event, params) => {
        try {
            return await TelegramUser.getBotCommands(params.accountId, params.botId);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:getBotCommands] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ── Telegram WebView (Mini App) ────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:requestWebView', async (_event, params) => {
        try {
            return await TelegramUser.requestWebView(params.accountId, params.botId, params.url, params.fromBotMenu);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:requestMainWebView', async (_event, params) => {
        try {
            return await TelegramUser.requestMainWebView(params.accountId, params.botId, params.startParam);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:prolongWebView', async (_event, params) => {
        try {
            return await TelegramUser.prolongWebView(params.accountId, params.botId, params.queryId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── New: Message operations ────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:editMessage', async (_event, params) => {
        try {
            return await TelegramUser.editMessage(params.accountId, params.chatId, params.messageId, params.text);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:deleteMessages', async (_event, params) => {
        try {
            return await TelegramUser.deleteMessages(params.accountId, params.chatId, params.messageIds);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:forwardMessages', async (_event, params) => {
        try {
            return await TelegramUser.forwardMessages(params.accountId, params.fromChatId, params.toChatId, params.messageIds);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:pinMessage', async (_event, params) => {
        try {
            return await TelegramUser.pinMessage(params.accountId, params.chatId, params.messageId, params.silent, params.unpin);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:syncPinnedMessages', async (_event, params) => {
        try {
            return await TelegramUser.syncPinnedMessages(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:ensureMessageAvailable', async (_event, params) => {
        try {
            return await TelegramUser.ensureMessageAvailable(params.accountId, params.chatId, params.messageId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendFile', async (_event, params) => {
        try {
            return await TelegramUser.sendFile(params.accountId, params.chatId, params.filePath, params.caption, params.fileType, params.replyToMsgId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendTopicFile', async (_event, params) => {
        try {
            return await TelegramUser.sendTopicFile(params.accountId, params.chatId, params.topicRootMessageId, params.filePath, params.caption);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendTyping', async (_event, params) => {
        try {
            return await TelegramUser.sendTyping(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendReaction', async (_event, params) => {
        try {
            return await TelegramUser.sendReaction(params.accountId, params.chatId, params.messageId, params.emoji);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── Group Management ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:getGroupInfo', async (_event, params) => {
        try {
            return await TelegramUser.getGroupInfo(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getGroupMembers', async (_event, params) => {
        try {
            return await TelegramUser.getGroupMembers(params.accountId, params.chatId, params.limit);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:addChatUser', async (_event, params) => {
        try {
            return await TelegramUser.addChatUser(params.accountId, params.chatId, params.userId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:deleteChatUser', async (_event, params) => {
        try {
            return await TelegramUser.deleteChatUser(params.accountId, params.chatId, params.userId, params.revokeHistory);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:editChatTitle', async (_event, params) => {
        try {
            return await TelegramUser.editChatTitle(params.accountId, params.chatId, params.title);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:editChatPhoto', async (_event, params) => {
        try {
            return await TelegramUser.editChatPhoto(params.accountId, params.chatId, params.photoPath);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:editChatAdmin', async (_event, params) => {
        try {
            return await TelegramUser.editChatAdmin(params.accountId, params.chatId, params.userId, params.isAdmin);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:leaveChat', async (_event, params) => {
        try {
            return await TelegramUser.leaveChat(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:blockUser', async (_event, params) => {
        try {
            return await TelegramUser.blockUser(params.accountId, params.userId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:unblockUser', async (_event, params) => {
        try {
            return await TelegramUser.unblockUser(params.accountId, params.userId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:exportChatInvite', async (_event, params) => {
        try {
            return await TelegramUser.exportChatInvite(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:readChatHistory', async (_event, params) => {
        try {
            return await TelegramUser.readChatHistory(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:readForumTopic', async (_event, params) => {
        try {
            return await TelegramUser.readForumTopic(params.accountId, params.chatId, params.topMsgId, params.readMaxId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getMessages', async (_event, params) => {
        try {
            return await TelegramUser.getMessages(params.accountId, params.chatId, { limit: params.limit, offsetId: params.offsetId, topicRootMessageId: params.topicRootMessageId, returnMessages: params.returnMessages });
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:joinGroup', async (_event, params) => {
        try {
            return await TelegramUser.joinGroup(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:hydrateMessageSenders', async (_event, params) => {
        try {
            return await TelegramUser.hydrateMessageSenders(params.accountId, params.chatId, params.messageIds || [], params.senderIds || []);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:setDialogMute', async (_event, params) => {
        try {
            return await TelegramUser.setDialogMute(params.accountId, params.chatId, params.muteUntil);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:setDialogArchived', async (_event, params) => {
        try {
            return await TelegramUser.setDialogArchived(params.accountId, params.chatId, params.archived);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:setDialogPin', async (_event, params) => {
        try {
            return await TelegramUser.setDialogPin(params.accountId, params.chatId, params.pinned);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getMessageReactions', async (_event, params) => {
        try {
            return await TelegramUser.getMessageReactions(params.accountId, params.chatId, params.messageId, params.reaction, params.offset, params.limit);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:repairMessageMedia', async (_event, params) => {
        try {
            return await TelegramUser.repairMessageMedia(params.accountId, params.chatId, params.messageId);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:repairMessageMedia] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:repairEmptyMessages', async (_event, params) => {
        try {
            return await TelegramUser.repairEmptyMessages(params.accountId, params.chatId, params.messageIds || []);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:repairMessageQuotes', async (_event, params) => {
        try {
            return await TelegramUser.repairMessageQuotes(params.accountId, params.chatId, params.items);
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:repairMessageQuotes] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getFullChat', async (_event, params) => {
        try {
            return await TelegramUser.getFullChat(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getUserProfile', async (_event, params) => {
        try {
            return await TelegramUser.getUserProfile(params.accountId, params.userId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── Peer Resolution ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:resolveUsername', async (_event, params) => {
        try {
            return await TelegramUser.resolveUsername(params.accountId, params.username);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:searchContacts', async (_event, params) => {
        try {
            return TelegramUser.searchContacts(params.accountId, params.query);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getPeers', async (_event, params) => {
        try {
            return TelegramUser.getPeers(params.accountId, params.peerType);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── Forum / Topics ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:isForum', async (_event, params) => {
        try {
            const result = await TelegramUser.isForum(params.accountId, params.chatId, params.forceApi);
            return result;
        }
        catch (err) {
            Logger_1.default.error(`[telegramUser:isForum] ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:checkForumForNewGroups', async (_event, params) => {
        try {
            await TelegramUser.checkForumForNewGroups(params.accountId);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getForumTopics', async (_event, params) => {
        try {
            return await TelegramUser.getForumTopics(params.accountId, params.chatId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getForumTopicMessages', async (_event, params) => {
        try {
            return await TelegramUser.getForumTopicMessages(params.accountId, params.chatId, getTopicRootMessageId(params), params.limit);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:createForumTopic', async (_event, params) => {
        try {
            return await TelegramUser.createForumTopic(params.accountId, params.chatId, params.title, params.iconColor, params.iconEmojiId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:editForumTopic', async (_event, params) => {
        try {
            return await TelegramUser.editForumTopic(params.accountId, params.chatId, getTopicRootMessageId(params), params);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendTopicMessage', async (_event, params) => {
        try {
            return await TelegramUser.sendTopicMessage(params.accountId, params.chatId, params.topicRootMessageId, params.text);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── Sticker / GIF APIs ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('telegramUser:getStickerSets', async (_event, params) => {
        try {
            return await TelegramUser.getStickerSets(params.accountId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getStickerSetStickers', async (_event, params) => {
        try {
            return await TelegramUser.getStickerSetStickers(params.accountId, params.setId, params.accessHash, params.shortName);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getRecentStickers', async (_event, params) => {
        try {
            return await TelegramUser.getRecentStickers(params.accountId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:getGifs', async (_event, params) => {
        try {
            return await TelegramUser.getGifs(params.accountId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:searchGifs', async (_event, params) => {
        try {
            return await TelegramUser.searchGifs(params.accountId, params.query);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendSticker', async (_event, params) => {
        try {
            return await TelegramUser.sendSticker(params.accountId, params.chatId, params.stickerId, params.accessHash);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:sendGif', async (_event, params) => {
        try {
            return await TelegramUser.sendGif(params.accountId, params.chatId, params.documentId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('telegramUser:downloadSticker', async (_event, params) => {
        try {
            return await TelegramUser.downloadSticker(params.accountId, params.stickerId, params.accessHash);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    Logger_1.default.log('[telegramUserIpc] Registered 59 Telegram User IPC channels');
}
//# sourceMappingURL=telegramUserIpc.js.map