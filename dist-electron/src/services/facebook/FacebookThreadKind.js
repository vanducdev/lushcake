"use strict";
/**
 * FacebookThreadKind.ts
 * Phase 4: Route conversations by type — never infer group vs user from numeric ID.
 *
 * Facebook group IDs are ALSO numeric, so "threadId is a number" ≠ "1:1 chat".
 * Use explicit typeChat from caller → DB metadata → structured error.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThreadKind = resolveThreadKind;
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
/**
 * Resolve thread kind with clear precedence:
 * 1. Explicit caller-supplied typeChat (own-property check preserves tri-state)
 * 2. DB metadata from fb_threads.type (authoritative when recent/valid)
 * 3. Unknown — return error, do NOT guess
 *
 * @param threadId     Numeric thread ID
 * @param typeChat     Explicit type from caller: 'user' | null | undefined
 * @param accountId    Facebook account ID (for DB lookup)
 * @returns Resolved kind or error
 */
async function resolveThreadKind(threadId, typeChat, accountId) {
    // 1. Explicit caller-supplied value (preserves tri-state)
    if (typeChat === 'user') {
        return { kind: 'user' };
    }
    if (typeChat === null) {
        return { kind: 'group' };
    }
    // 2. DB metadata lookup
    try {
        const db = DatabaseService_1.default.getInstance();
        const fbThread = db.queryOne?.(`SELECT type FROM fb_threads WHERE id = ? AND account_id = ?`, [threadId, accountId]);
        if (fbThread?.type === 'user')
            return { kind: 'user' };
        if (fbThread?.type === 'group')
            return { kind: 'group' };
    }
    catch (err) {
        Logger_1.default.warn(`[resolveThreadKind] DB lookup failed: ${err.message}`);
    }
    // 3. Unknown — caller must handle explicitly
    return {
        kind: 'unknown',
        error: `Không thể xác định loại hội thoại cho thread ${threadId}. ` +
            `Vui lòng tải lại cuộc trò chuyện hoặc chọn loại chat thủ công.`,
    };
}
//# sourceMappingURL=FacebookThreadKind.js.map