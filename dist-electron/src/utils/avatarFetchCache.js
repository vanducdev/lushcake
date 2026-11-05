"use strict";
/**
 * avatarFetchCache.ts - Cache cho avatar fetch attempts
 *
 * Tránh gọi API liên tục cho contacts không có avatar.
 * Cache 24 giờ trước khi thử lại.
 * Dùng chung cho cả TelegramUserListener và TelegramBotChannelService.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldFetchAvatar = shouldFetchAvatar;
exports.markAvatarFetched = markAvatarFetched;
exports.markAvatarSuccess = markAvatarSuccess;
exports.resetAvatarCache = resetAvatarCache;
exports.clearAvatarCache = clearAvatarCache;
/** Map: `${accountId}_${contactId}` → lastFetchTimestamp */
const fetchAttempts = new Map();
/** Thời gian cache: 24 giờ (ms) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Số lần thử tối đa trước khi bỏ cuộc vĩnh viễn */
const MAX_ATTEMPTS = 3;
/** Map: `${accountId}_${contactId}` → attemptCount */
const attemptCounts = new Map();
/**
 * Kiểm tra có nên fetch avatar cho contact này không.
 * Trả về true nếu nên fetch, false nếu đang trong cache hoặc đã hết lần thử.
 */
function shouldFetchAvatar(accountId, contactId) {
    const key = `${accountId}_${contactId}`;
    // Kiểm tra số lần thử
    const attempts = attemptCounts.get(key) || 0;
    if (attempts >= MAX_ATTEMPTS)
        return false; // Đã thử đủ lần, bỏ cuộc
    // Kiểm tra cache thời gian
    const lastFetch = fetchAttempts.get(key);
    if (lastFetch && (Date.now() - lastFetch) < CACHE_TTL_MS)
        return false; // Còn trong cache
    return true;
}
/**
 * Đánh dấu đã fetch avatar cho contact này.
 */
function markAvatarFetched(accountId, contactId) {
    const key = `${accountId}_${contactId}`;
    fetchAttempts.set(key, Date.now());
    attemptCounts.set(key, (attemptCounts.get(key) || 0) + 1);
}
/**
 * Đánh dấu avatar fetch thành công (reset counter).
 */
function markAvatarSuccess(accountId, contactId) {
    const key = `${accountId}_${contactId}`;
    fetchAttempts.delete(key); // Xóa cache để lần sau có thể fetch lại nếu cần
    attemptCounts.delete(key);
}
/**
 * Reset cache cho 1 contact cụ thể (dùng khi user nhấn nút "Cập nhật thông tin").
 */
function resetAvatarCache(accountId, contactId) {
    const key = `${accountId}_${contactId}`;
    fetchAttempts.delete(key);
    attemptCounts.delete(key);
}
/**
 * Xóa toàn bộ cache (dùng khi cần).
 */
function clearAvatarCache() {
    fetchAttempts.clear();
    attemptCounts.clear();
}
//# sourceMappingURL=avatarFetchCache.js.map