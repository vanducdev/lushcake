"use strict";
/**
 * RestQueryService - Employee-side REST client.
 * Dùng trong employee mode để gọi REST API lên Boss.
 *
 * Singleton. Chỉ active khi mode=employee.
 * Boss/standalone mode không dùng file này.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Logger_1 = __importDefault(require("../../utils/Logger"));
const MAX_CONSECUTIVE_FAILURES = 2;
const HEALTH_CHECK_INTERVAL_MS = 15000;
class RestQueryService {
    constructor() {
        this.baseUrl = '';
        this.token = '';
        this.connected = false;
        this.consecutiveFailures = 0;
        this.healthCheckTimer = null;
        this.onStatusChange = null;
    }
    static getInstance() {
        if (!RestQueryService.instance) {
            RestQueryService.instance = new RestQueryService();
        }
        return RestQueryService.instance;
    }
    /** Đăng ký callback mỗi khi trạng thái kết nối thay đổi */
    setOnStatusChange(cb) {
        this.onStatusChange = cb;
    }
    /** Khởi tạo với boss URL + JWT token */
    init(baseUrl, token) {
        let url = baseUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `http://${url}`;
        }
        this.baseUrl = url.replace(/\/+$/, '');
        this.token = token;
        this.connected = true;
        this.consecutiveFailures = 0;
        this.startHealthCheck();
        const msg = `[RestQueryService] Initialized: ${this.baseUrl} token=${token ? token.slice(0, 12) + '...' : 'EMPTY!'}`;
        Logger_1.default.log(msg);
        console.log(msg);
        this.notifyStatus(true, 0);
    }
    /** Reset (khi logout) */
    reset() {
        this.stopHealthCheck();
        this.baseUrl = '';
        this.token = '';
        this.connected = false;
        this.consecutiveFailures = 0;
        Logger_1.default.log('[RestQueryService] Reset');
        this.notifyStatus(false, 0);
    }
    isConnected() {
        return this.connected && !!this.baseUrl && !!this.token;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    // ── Status notification ──────────────────────────────────────────
    notifyStatus(connected, latency) {
        try {
            this.onStatusChange?.(connected, latency);
        }
        catch { /* ignore */ }
    }
    // ── Health check ─────────────────────────────────────────────────
    startHealthCheck() {
        this.stopHealthCheck();
        this.healthCheckTimer = setInterval(async () => {
            // Nếu đã connected mà không có lỗi gần đây → skip
            if (this.connected && this.consecutiveFailures === 0)
                return;
            try {
                const start = Date.now();
                const res = await fetch(`${this.baseUrl}/api/health`, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    signal: AbortSignal.timeout(10000),
                });
                const elapsed = Date.now() - start;
                if (res.ok || res.status === 200) {
                    if (!this.connected) {
                        this.connected = true;
                        this.consecutiveFailures = 0;
                        Logger_1.default.log(`[RestQueryService] ✅ Health check OK — reconnected (${elapsed}ms)`);
                        this.notifyStatus(true, elapsed);
                    }
                }
            }
            catch {
                // Boss vẫn không reachable — nothing to do
            }
        }, HEALTH_CHECK_INTERVAL_MS);
    }
    stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }
    // ── Failure tracking ────────────────────────────────────────────
    onSuccess() {
        this.consecutiveFailures = 0;
    }
    onHttpError(status) {
        // 401/403 = auth issue, không tính network error
        if (status === 401 || status === 403)
            return;
        // Các HTTP error khác (5xx, etc.) — không mất kết nối
        this.consecutiveFailures = 0;
    }
    onNetworkError() {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && this.connected) {
            this.connected = false;
            Logger_1.default.warn(`[RestQueryService] ❌ DISCONNECTED — ${this.consecutiveFailures} consecutive failures`);
            this.notifyStatus(false, 0);
            // Health check sẽ tự động reconnect khi Boss online trở lại
        }
    }
    // ── Generic request ──────────────────────────────────────────────
    async request(opts) {
        if (!this.connected) {
            Logger_1.default.warn(`[RestQueryService] ❌ NOT_CONNECTED: ${opts.method} ${opts.path}`);
            return { success: false, error: 'Chưa kết nối tới BOSS', code: 'NOT_CONNECTED' };
        }
        const url = new URL(opts.path, this.baseUrl);
        if (opts.query) {
            Object.entries(opts.query).forEach(([k, v]) => {
                if (v !== undefined && v !== null && v !== '') {
                    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
                }
            });
        }
        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutMs = opts.timeout || 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let elapsed = 0;
        try {
            Logger_1.default.log(`[RestQueryService] ▶️ ${opts.method} ${opts.path}`, opts.query ? `query=${JSON.stringify(opts.query)}` : '');
            const res = await fetch(url.toString(), {
                method: opts.method,
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: opts.body ? JSON.stringify(opts.body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            elapsed = Date.now() - startTime;
            // Nếu response là binary (media)
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/octet-stream') || contentType.includes('image/')) {
                const blob = await res.blob();
                Logger_1.default.log(`[RestQueryService] ✅ ${opts.method} ${opts.path} (${elapsed}ms, binary ${(blob.size / 1024).toFixed(1)}KB)`);
                this.onSuccess();
                return { success: true, data: blob };
            }
            const json = await res.json();
            if (!res.ok) {
                Logger_1.default.warn(`[RestQueryService] ❌ HTTP ${res.status}: ${opts.method} ${opts.path} (${elapsed}ms) — ${json.error || ''}`);
                this.onHttpError(res.status);
                return {
                    success: false,
                    error: json.error || `HTTP ${res.status}`,
                    code: json.code || `HTTP_${res.status}`,
                };
            }
            if (!json.success) {
                Logger_1.default.warn(`[RestQueryService] ❌ FAILED: ${opts.method} ${opts.path} (${elapsed}ms) — ${json.error || ''}`);
                // Business-level failure — không tính là network error
                this.onSuccess();
                return {
                    success: false,
                    error: json.error || 'Request failed',
                    code: json.code || 'UNKNOWN',
                };
            }
            // Trả về data hoặc toàn bộ response nếu có pagination
            if (json.data !== undefined) {
                const dataSize = Array.isArray(json.data) ? json.data.length : (json.data.items?.length ?? '?');
                Logger_1.default.log(`[RestQueryService] ✅ ${opts.method} ${opts.path} (${elapsed}ms, ${dataSize} items)`);
                this.onSuccess();
                return {
                    success: true,
                    data: json.data,
                    pagination: json.pagination,
                };
            }
            // Fallback: trả về toàn bộ (cho login, health, v.v.)
            Logger_1.default.log(`[RestQueryService] ✅ ${opts.method} ${opts.path} (${elapsed}ms)`);
            this.onSuccess();
            return { success: true, data: json };
        }
        catch (err) {
            clearTimeout(timeoutId);
            elapsed = Date.now() - startTime;
            if (err.name === 'AbortError') {
                Logger_1.default.warn(`[RestQueryService] ⏰ TIMEOUT: ${opts.method} ${opts.path} (${timeoutMs}ms)`);
                this.onNetworkError();
                return { success: false, error: 'Request timeout', code: 'TIMEOUT' };
            }
            Logger_1.default.warn(`[RestQueryService] ❌ ERROR: ${opts.method} ${opts.path} (${elapsed}ms) — ${err.message}`);
            this.onNetworkError();
            return { success: false, error: err.message, code: 'NETWORK_ERROR' };
        }
    }
    // ── Public methods ───────────────────────────────────────────────
    get(path, query, timeout) {
        return this.request({ method: 'GET', path, query, timeout });
    }
    post(path, body, timeout) {
        return this.request({ method: 'POST', path, body, timeout });
    }
    put(path, body, timeout) {
        return this.request({ method: 'PUT', path, body, timeout });
    }
    patch(path, body, timeout) {
        return this.request({ method: 'PATCH', path, body, timeout });
    }
    delete(path, timeout) {
        return this.request({ method: 'DELETE', path, timeout });
    }
    /** Upload binary data to boss. Returns bossPath on success. */
    async postBinary(path, data, headers, timeout = 120000) {
        if (!this.connected) {
            return { success: false, error: 'Chưa kết nối tới BOSS', code: 'NOT_CONNECTED' };
        }
        const url = new URL(path, this.baseUrl);
        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            // Convert Buffer to Uint8Array for fetch compatibility
            const body = data instanceof Blob ? data : new Uint8Array(data);
            const res = await fetch(url.toString(), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    ...headers,
                },
                body,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const elapsed = Date.now() - startTime;
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                Logger_1.default.warn(`[RestQueryService] ❌ postBinary ${path} (${elapsed}ms) — ${json.error || `HTTP ${res.status}`}`);
                return { success: false, error: json.error || `HTTP ${res.status}` };
            }
            Logger_1.default.log(`[RestQueryService] ✅ postBinary ${path} (${elapsed}ms)`);
            this.onSuccess();
            return { success: true, data: json };
        }
        catch (err) {
            clearTimeout(timeoutId);
            Logger_1.default.warn(`[RestQueryService] ❌ postBinary ${path} — ${err.message}`);
            return { success: false, error: err.message };
        }
    }
    // ── Convenience: login (không cần token) ─────────────────────────
    /** Gọi POST /api/auth/login — đặc biệt vì chưa có token */
    static async login(baseUrl, username, password) {
        let url = baseUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `http://${url}`;
        }
        url = url.replace(/\/+$/, '');
        try {
            const res = await fetch(`${url}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: AbortSignal.timeout(15000),
            });
            const json = await res.json();
            return json;
        }
        catch (err) {
            return { success: false, error: err.message, code: 'NETWORK_ERROR' };
        }
    }
}
exports.default = RestQueryService;
//# sourceMappingURL=RestQueryService.js.map