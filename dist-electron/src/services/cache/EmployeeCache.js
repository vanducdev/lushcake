"use strict";
/**
 * EmployeeCache - In-memory cache cho employee mode.
 *
 * Lưu conversation list, recent messages, labels trong memory.
 * Khi user mở app, cache giúp hiển thị ngay lập tức (từ memory)
 * mà không cần chờ REST response.
 *
 * Khi SSE push event mới → cache tự động update.
 * Khi user refresh page → cache mất, load lại từ REST.
 *
 * Chỉ active khi mode=employee.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Logger_1 = __importDefault(require("../../utils/Logger"));
const CACHE_TTL = {
    CONVERSATIONS: 60000, // 1 phút
    MESSAGES: 120000, // 2 phút
    LABELS: 300000, // 5 phút
    QUICK_MSGS: 300000, // 5 phút
    DRAFTS: 60000, // 1 phút
};
class EmployeeCache {
    constructor() {
        this.conversations = new Map();
        this.messages = new Map();
        this.labels = null;
        this.quickMessages = null;
        this.drafts = new Map();
    }
    static getInstance() {
        if (!EmployeeCache.instance) {
            EmployeeCache.instance = new EmployeeCache();
        }
        return EmployeeCache.instance;
    }
    // ═══════════════════════════════════════════════════════════════
    // CONVERSATIONS
    // ═══════════════════════════════════════════════════════════════
    getConversations(zaloId) {
        const cached = this.conversations.get(zaloId);
        if (!cached)
            return null;
        if (Date.now() - cached.fetchedAt > CACHE_TTL.CONVERSATIONS) {
            this.conversations.delete(zaloId);
            return null;
        }
        return cached;
    }
    setConversations(zaloId, items, total) {
        this.conversations.set(zaloId, {
            items,
            total,
            fetchedAt: Date.now(),
            zaloId,
        });
    }
    /**
     * Update 1 conversation trong cache (khi có SSE push update).
     * Dùng để refresh unread_count, last_message mà ko cần re-fetch.
     */
    updateConversation(zaloId, contactId, updates) {
        const cached = this.conversations.get(zaloId);
        if (!cached?.items)
            return;
        const idx = cached.items.findIndex((c) => c.contact_id === contactId || c.id === contactId);
        if (idx >= 0) {
            cached.items[idx] = { ...cached.items[idx], ...updates };
        }
    }
    invalidateConversations(zaloId) {
        if (zaloId) {
            this.conversations.delete(zaloId);
        }
        else {
            this.conversations.clear();
        }
    }
    // ═══════════════════════════════════════════════════════════════
    // MESSAGES
    // ═══════════════════════════════════════════════════════════════
    getMessages(zaloId, threadId) {
        const key = `${zaloId}:${threadId}`;
        const cached = this.messages.get(key);
        if (!cached)
            return null;
        if (Date.now() - cached.fetchedAt > CACHE_TTL.MESSAGES) {
            this.messages.delete(key);
            return null;
        }
        return cached;
    }
    setMessages(zaloId, threadId, items, hasMore) {
        const key = `${zaloId}:${threadId}`;
        this.messages.set(key, {
            items,
            threadId,
            zaloId,
            fetchedAt: Date.now(),
            hasMore,
        });
    }
    /** Prepend messages (khi load more) */
    prependMessages(zaloId, threadId, olderItems) {
        const key = `${zaloId}:${threadId}`;
        const cached = this.messages.get(key);
        if (cached) {
            cached.items = [...olderItems, ...cached.items];
        }
    }
    /** Append a single new message (khi SSE push) */
    appendMessage(zaloId, threadId, message) {
        const key = `${zaloId}:${threadId}`;
        const cached = this.messages.get(key);
        if (cached) {
            // Tránh duplicate
            const exists = cached.items.some((m) => m.msg_id === message.msg_id || m.cli_msg_id === message.cli_msg_id);
            if (!exists) {
                cached.items.push(message);
            }
        }
    }
    invalidateMessages(zaloId, threadId) {
        if (zaloId && threadId) {
            this.messages.delete(`${zaloId}:${threadId}`);
        }
        else if (zaloId) {
            for (const key of this.messages.keys()) {
                if (key.startsWith(`${zaloId}:`)) {
                    this.messages.delete(key);
                }
            }
        }
        else {
            this.messages.clear();
        }
    }
    // ═══════════════════════════════════════════════════════════════
    // LABELS
    // ═══════════════════════════════════════════════════════════════
    getLabels() {
        if (!this.labels)
            return null;
        if (Date.now() - this.labels.fetchedAt > CACHE_TTL.LABELS) {
            this.labels = null;
            return null;
        }
        return this.labels;
    }
    setLabels(items) {
        this.labels = { items, fetchedAt: Date.now() };
    }
    // ═══════════════════════════════════════════════════════════════
    // QUICK MESSAGES
    // ═══════════════════════════════════════════════════════════════
    getQuickMessages() {
        if (!this.quickMessages)
            return null;
        if (Date.now() - this.quickMessages.fetchedAt > CACHE_TTL.QUICK_MSGS) {
            this.quickMessages = null;
            return null;
        }
        return this.quickMessages;
    }
    setQuickMessages(items) {
        this.quickMessages = { items, fetchedAt: Date.now() };
    }
    // ═══════════════════════════════════════════════════════════════
    // DRAFTS
    // ═══════════════════════════════════════════════════════════════
    getDrafts(zaloId) {
        const cached = this.drafts.get(zaloId);
        if (!cached)
            return null;
        return cached;
    }
    setDrafts(zaloId, items) {
        this.drafts.set(zaloId, items);
    }
    updateDraft(zaloId, threadId, content) {
        const drafts = this.drafts.get(zaloId) || [];
        const existing = drafts.findIndex((d) => d.threadId === threadId || d.thread_id === threadId);
        if (existing >= 0) {
            drafts[existing] = { ...drafts[existing], content };
        }
        else {
            drafts.push({ threadId, thread_id: threadId, content });
        }
        this.drafts.set(zaloId, drafts);
    }
    // ═══════════════════════════════════════════════════════════════
    // RESET
    // ═══════════════════════════════════════════════════════════════
    clear() {
        this.conversations.clear();
        this.messages.clear();
        this.labels = null;
        this.quickMessages = null;
        this.drafts.clear();
        Logger_1.default.log('[EmployeeCache] Cleared');
    }
}
exports.default = EmployeeCache;
//# sourceMappingURL=EmployeeCache.js.map