"use strict";
/**
 * FacebookE2EEStateStore.ts
 * Secure persistence for E2EE device state via Electron safeStorage.
 *
 * Phase 3: Replaces e2eeMemoryOnly=true with encrypted secure storage,
 * so E2EE session/identity survives app restarts without bootstrap loop.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookE2EEStateStore = void 0;
const SecureSettingsService_1 = require("../secure/SecureSettingsService");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const FacebookMetrics_1 = require("./FacebookMetrics");
/** Key namespace for E2EE device state in secure storage */
function e2eeStateKey(accountId) {
    return `facebook:e2ee-device-state:${accountId}`;
}
/** Max state size — 5 MiB (generous for device state with identities/sessions/prekeys) */
const MAX_STATE_SIZE = 5 * 1024 * 1024;
class FacebookE2EEStateStore {
    constructor(accountId) {
        /** Debounce timer for writes — coalesce rapid updates */
        this.writeTimer = null;
        /** Latest pending state to write */
        this.pendingState = null;
        /** Serial counter — only the latest snapshot wins */
        this.writeSerial = 0;
        this.accountId = accountId;
    }
    /**
     * Load serialized E2EE device state from secure storage.
     * Returns undefined if no state exists or state is invalid.
     */
    async load() {
        try {
            const key = e2eeStateKey(this.accountId);
            const raw = (0, SecureSettingsService_1.secureGet)(key);
            if (!raw)
                return undefined;
            // Validate size
            if (raw.length > MAX_STATE_SIZE) {
                Logger_1.default.warn(`[E2EEStateStore:${this.accountId}] State too large (${raw.length} > ${MAX_STATE_SIZE}) - discarding`);
                await this.clear();
                return undefined;
            }
            // Validate it's valid JSON (basic check)
            try {
                JSON.parse(raw);
            }
            catch {
                Logger_1.default.warn(`[E2EEStateStore:${this.accountId}] State is not valid JSON - discarding`);
                await this.clear();
                return undefined;
            }
            Logger_1.default.log(`[E2EEStateStore:${this.accountId}] Loaded state (${raw.length} bytes)`);
            return raw;
        }
        catch (err) {
            Logger_1.default.warn(`[E2EEStateStore:${this.accountId}] Load failed: ${err.message}`);
            return undefined;
        }
    }
    /**
     * Save serialized E2EE device state to secure storage.
     * Debounced — coalesces rapid updates (300ms window), only latest wins.
     */
    save(serializedState) {
        if (!serializedState || serializedState.length > MAX_STATE_SIZE) {
            Logger_1.default.warn(`[E2EEStateStore:${this.accountId}] Save rejected: invalid size`);
            return;
        }
        this.pendingState = serializedState;
        const serial = ++this.writeSerial;
        // Debounce: clear previous timer, schedule new write
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
        }
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            // Only write if this is still the latest snapshot
            if (serial !== this.writeSerial)
                return;
            this.flushWrite();
        }, 400);
    }
    /**
     * Force flush pending state immediately (called on disconnect/logout).
     */
    async flushPending() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = null;
        }
        if (this.pendingState !== null) {
            await this.flushWrite();
        }
    }
    /**
     * Clear E2EE device state from secure storage.
     * Called on logout/account removal.
     */
    async clear() {
        try {
            if (this.writeTimer) {
                clearTimeout(this.writeTimer);
                this.writeTimer = null;
            }
            this.pendingState = null;
            (0, SecureSettingsService_1.secureDelete)(e2eeStateKey(this.accountId));
            Logger_1.default.log(`[E2EEStateStore:${this.accountId}] Cleared state`);
        }
        catch (err) {
            Logger_1.default.warn(`[E2EEStateStore:${this.accountId}] Clear failed: ${err.message}`);
        }
    }
    static async clearForAccount(accountId) {
        (0, SecureSettingsService_1.secureDelete)(e2eeStateKey(accountId));
    }
    flushWrite() {
        if (this.pendingState === null)
            return;
        const state = this.pendingState;
        this.pendingState = null;
        try {
            const key = e2eeStateKey(this.accountId);
            // Phase 3: Use secureSetRequired — fail loudly if encryption unavailable
            (0, SecureSettingsService_1.secureSetRequired)(key, state);
            Logger_1.default.log(`[E2EEStateStore:${this.accountId}] Saved state (${state.length} bytes)`);
        }
        catch (err) {
            (0, FacebookMetrics_1.metricInc)('fb_e2ee_state_save_failure', this.accountId);
            Logger_1.default.warn(`[E2EEStateStore:${this.accountId}] Write failed: ${err.message}`);
            // Non-fatal: bridge still runs this session, state just won't persist
        }
    }
}
exports.FacebookE2EEStateStore = FacebookE2EEStateStore;
exports.default = FacebookE2EEStateStore;
//# sourceMappingURL=FacebookE2EEStateStore.js.map