"use strict";
/**
 * channelHelper.ts — Shared channel detection utilities + constants
 *
 * Thay vì lặp `channel === 'telegram_bot' || channel === 'telegram_user'`
 * ở 20+ file, dùng các helper này.
 *
 * Design principle: UI nên check capability (channelSupports) thay vì check channel name.
 * Nhưng khi cần check channel cụ thể (routing API, chọn adapter), dùng helper ở đây.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL = void 0;
exports.isZalo = isZalo;
exports.isFacebook = isFacebook;
exports.isTelegram = isTelegram;
exports.isTelegramBot = isTelegramBot;
exports.isTelegramUser = isTelegramUser;
exports.isNonZalo = isNonZalo;
exports.resolveChannel = resolveChannel;
exports.supports = supports;
exports.getCap = getCap;
exports.isTelegramForumGeneral = isTelegramForumGeneral;
exports.shouldSkipZaloApi = shouldSkipZaloApi;
exports.shouldUseAdapter = shouldUseAdapter;
const channelConfig_1 = require("../../configs/channelConfig");
// ─── Channel constants — single source of truth cho string literals ───────────
// Dùng CHANNEL.ZALO thay vì 'zalo' để tránh typo và dễ refactor.
exports.CHANNEL = {
    ZALO: 'zalo',
    FACEBOOK: 'facebook',
    TELEGRAM_BOT: 'telegram_bot',
    TELEGRAM_USER: 'telegram_user',
};
// ─── Channel type checks ─────────────────────────────────────────────────────
function isZalo(ch) {
    return (ch || exports.CHANNEL.ZALO) === exports.CHANNEL.ZALO;
}
function isFacebook(ch) {
    return ch === exports.CHANNEL.FACEBOOK;
}
function isTelegram(ch) {
    return ch === exports.CHANNEL.TELEGRAM_BOT || ch === exports.CHANNEL.TELEGRAM_USER;
}
function isTelegramBot(ch) {
    return ch === exports.CHANNEL.TELEGRAM_BOT;
}
function isTelegramUser(ch) {
    return ch === exports.CHANNEL.TELEGRAM_USER;
}
/** Non-Zalo = cần dùng adapter thay vì ipc.zalo */
function isNonZalo(ch) {
    return (ch || exports.CHANNEL.ZALO) !== exports.CHANNEL.ZALO;
}
// ─── Resolve channel ─────────────────────────────────────────────────────────
/**
 * Resolve channel từ contact + account, ưu tiên contact.channel.
 * Dùng trong component khi cần channel mà không muốn lặp logic.
 */
function resolveChannel(contact, account) {
    return (contact?.channel || account?.channel || exports.CHANNEL.ZALO);
}
// ─── Capability-based helpers ────────────────────────────────────────────────
/**
 * Kiểm tra feature có được hỗ trợ cho channel không.
 * Wrapper gọn hơn channelSupports().
 */
function supports(ch, feature) {
    return (0, channelConfig_1.channelSupports)(ch, feature);
}
/**
 * Lấy capability object cho channel.
 */
function getCap(ch) {
    return (0, channelConfig_1.getCapability)(ch);
}
// ─── Telegram Forum helpers ──────────────────────────────────────────────────
/**
 * Telegram Forum: General topic (ForumTopic.id = 1) is the normal supergroup
 * timeline — NOT a reply thread. Only topics with id != 1 are threads that
 * use GetReplies / InputReplyToMessage.topMsgId.
 *
 * When this returns true, the caller should use ordinary history/send
 * semantics instead of topic-specific paths.
 *
 * @param topicId The activeTopicId stored in chatStore (root message id or forum topic id)
 */
function isTelegramForumGeneral(topicId) {
    return topicId === '1' || topicId === 'general';
}
// ─── Common pattern helpers ──────────────────────────────────────────────────
/**
 * Helper cho pattern phổ biến: "chỉ gọi Zalo API khi channel là Zalo".
 * Trả về true nếu nên skip (không phải Zalo).
 *
 * Usage:
 *   if (shouldSkipZaloApi(ch)) return;
 *   await ipc.zalo?.someMethod(...)
 */
function shouldSkipZaloApi(ch) {
    return (ch || exports.CHANNEL.ZALO) !== exports.CHANNEL.ZALO;
}
/**
 * Helper cho pattern: "dùng adapter cho non-Zalo, ipc.zalo cho Zalo".
 * Trả về true nếu nên dùng adapter.
 */
function shouldUseAdapter(ch) {
    return (ch || exports.CHANNEL.ZALO) !== exports.CHANNEL.ZALO;
}
//# sourceMappingURL=channelHelper.js.map