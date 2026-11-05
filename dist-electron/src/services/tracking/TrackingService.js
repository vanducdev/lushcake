"use strict";
/**
 * TrackingService - Gửi dữ liệu tracking page lên API deplaoapp.com.
 *
 * - Chỉ hoạt động khi build production (GitHub Actions / NODE_ENV=production).
 * - Cache local: mỗi ngày push 1 lần. Nếu có page mới tích hợp → track lại ngay trong ngày.
 * - Gửi pageId (zalo_id / facebook_id / telegram:xxx), machineId, lastTrackedAt lên Google Sheets.
 * - Không gửi các field nhạy cảm khác (name, phone,...).
 * - Tính năng phục vụ gia hạn tính năng premium, không thu thập thông tin cá nhân.
 *
 * API: POST https://deplaoapp.com/api/tracking/page
 * Rate limit: 10 req/giờ/IP - trả về 429 nếu vượt quá.
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
const BuildConfig_1 = require("../../configs/BuildConfig");
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const uuid_1 = require("uuid");
const axios_1 = __importDefault(require("axios"));
// ─── Constants ──────────────────────────────────────────────────────────────
const API_URL = 'https://deplaoapp.com/api/tracking/page';
const CACHE_FILENAME = 'tracking-cache.json';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 60 phút
// ─── TrackingService ────────────────────────────────────────────────────────
class TrackingService {
    constructor() {
        this.cache = null;
        this.cachePath = '';
        this.timer = null;
        this.running = false;
    }
    static getInstance() {
        if (!TrackingService.instance) {
            TrackingService.instance = new TrackingService();
        }
        return TrackingService.instance;
    }
    /**
     * Khởi động tracking service.
     * Chỉ hoạt động trong production build.
     */
    start() {
        // ── Guard: chỉ chạy trong production ────────────────────────────────
        if (BuildConfig_1.IS_DEV_BUILD) {
            Logger_1.default.log('[TrackingService] 🔇 Bỏ qua - đang chạy ở môi trường development');
            return;
        }
        if (this.running) {
            Logger_1.default.log('[TrackingService] ⚠️ Đã khởi động rồi, bỏ qua');
            return;
        }
        this.running = true;
        try {
            this.cachePath = path.join(electron_1.app.getPath('userData'), CACHE_FILENAME);
            this.loadCache();
            Logger_1.default.log(`[TrackingService] ✅ Khởi động - machineId=${this.cache?.machineId?.slice(0, 8)}... lastTracked=${this.cache?.lastTrackedDate || 'never'}`);
            // Chạy lần đầu sau 10s (đợi DB sẵn sàng)
            setTimeout(() => this.tick(), 10000);
            // Lặp mỗi 60 phút
            this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
        }
        catch (err) {
            Logger_1.default.error(`[TrackingService] ❌ Lỗi khởi động: ${err.message}`);
        }
    }
    /**
     * Dừng tracking service.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
        Logger_1.default.log('[TrackingService] 🔇 Đã dừng');
    }
    // ── Core logic ──────────────────────────────────────────────────────────
    /**
     * Thu thập danh sách pageId hiện tại (Zalo + Facebook + Telegram).
     * Dùng để so sánh với cache, phát hiện page mới tích hợp.
     */
    collectCurrentPageIds() {
        const ids = [];
        try {
            const allAccounts = DatabaseService_1.default.getInstance().getAccounts() || [];
            for (const acc of allAccounts) {
                const ch = acc.channel || 'zalo';
                if (ch === 'telegram') {
                    ids.push(`telegram:${acc.zalo_id}`);
                }
                else {
                    ids.push(acc.zalo_id);
                }
            }
        }
        catch (_) { /* ignore */ }
        try {
            const allFb = DatabaseService_1.default.getInstance().getFBAccounts() || [];
            for (const fb of allFb) {
                if (fb.facebook_id && fb.status !== 'disconnected') {
                    ids.push(fb.facebook_id);
                }
            }
        }
        catch (_) { /* ignore */ }
        if (ids.length === 0) {
            const machineId = this.cache?.machineId || this.generateMachineId();
            ids.push(`machine:${machineId.slice(0, 12)}`);
        }
        return ids.sort();
    }
    /**
     * So sánh 2 danh sách pageId (thứ tự đã sort).
     */
    areSameIds(a, b) {
        if (!a || a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i])
                return false;
        }
        return true;
    }
    async tick() {
        try {
            const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
            const currentIds = this.collectCurrentPageIds();
            // Nếu đã track hôm nay và danh sách page không đổi → bỏ qua
            if (this.cache?.lastTrackedDate === today) {
                const sameIds = this.areSameIds(this.cache.trackedPageIds, currentIds);
                if (sameIds) {
                    return; // Đã track rồi, không có page mới
                }
                Logger_1.default.log('[TrackingService] 🔄 Phát hiện page mới tích hợp - track lại ngay');
            }
            else {
                Logger_1.default.log('[TrackingService] 📡 Bắt đầu gửi tracking hôm nay...');
            }
            await this.sendTracking();
            // Cập nhật cache sau khi gửi thành công
            this.cache = {
                machineId: this.cache?.machineId || this.generateMachineId(),
                lastTrackedDate: today,
                lastTrackedAt: new Date().toISOString(),
                trackedPageIds: currentIds,
            };
            this.saveCache();
            Logger_1.default.log('[TrackingService] ✅ Tracking đã gửi thành công');
        }
        catch (err) {
            Logger_1.default.warn(`[TrackingService] ⚠️ Gửi tracking thất bại: ${err.message}`);
            // Không crash app - thử lại vào lần tick sau (60 phút)
        }
    }
    /**
     * Thu thập dữ liệu accounts (Zalo + Facebook + Telegram) và gửi lên API.
     */
    async sendTracking() {
        const machineId = this.cache?.machineId || this.generateMachineId();
        // ── Lấy tất cả accounts ────────────────────────────────────────────
        let allAccounts = [];
        try {
            allAccounts = DatabaseService_1.default.getInstance().getAccounts() || [];
        }
        catch (dbErr) {
            Logger_1.default.warn(`[TrackingService] ⚠️ Không thể đọc accounts từ DB: ${dbErr.message}`);
        }
        // ── Lấy Facebook accounts (bảng riêng) ────────────────────────────
        let fbAccounts = [];
        try {
            const allFb = DatabaseService_1.default.getInstance().getFBAccounts() || [];
            fbAccounts = allFb
                .filter((fb) => fb.facebook_id && fb.status !== 'disconnected')
                .map((fb) => ({ facebook_id: fb.facebook_id }));
        }
        catch (dbErr) {
            Logger_1.default.warn(`[TrackingService] ⚠️ Không thể đọc Facebook accounts từ DB: ${dbErr.message}`);
        }
        // ── Phân loại theo channel ─────────────────────────────────────────
        const zaloAccounts = allAccounts.filter(a => (a.channel || 'zalo') === 'zalo');
        const telegramAccounts = allAccounts.filter(a => a.channel === 'telegram');
        // ── Không có account nào ───────────────────────────────────────────
        if (zaloAccounts.length === 0 && fbAccounts.length === 0 && telegramAccounts.length === 0) {
            Logger_1.default.log('[TrackingService] ℹ️ Không có account nào - gửi machineId không');
            const payload = [
                {
                    pageId: `machine:${machineId.slice(0, 12)}`,
                    machineId,
                    lastTrackedAt: this.formatDate(new Date()),
                },
            ];
            await this.postTracking(payload);
            return;
        }
        // ── Build payload: mỗi account 1 entry ────────────────────────────
        const now = new Date();
        const lastTrackedAt = this.formatDate(now);
        const payload = [];
        // Zalo accounts → pageId = zalo_id
        for (const acc of zaloAccounts) {
            payload.push({ pageId: acc.zalo_id, machineId, lastTrackedAt });
        }
        // Facebook accounts → pageId = facebook_id
        for (const acc of fbAccounts) {
            payload.push({ pageId: acc.facebook_id, machineId, lastTrackedAt });
        }
        // Telegram accounts → pageId = telegram:{zalo_id}
        for (const acc of telegramAccounts) {
            payload.push({ pageId: `telegram:${acc.zalo_id}`, machineId, lastTrackedAt });
        }
        Logger_1.default.log(`[TrackingService] 📤 Gửi ${payload.length} page(s) lên API (Zalo=${zaloAccounts.length}, FB=${fbAccounts.length}, Tele=${telegramAccounts.length})...`);
        await this.postTracking(payload);
    }
    /**
     * POST dữ liệu lên API tracking.
     */
    async postTracking(payload) {
        const response = await axios_1.default.post(API_URL, { pages: payload }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000, // 15 giây timeout
        });
        const data = response.data;
        if (data.success) {
            Logger_1.default.log(`[TrackingService] ✅ API: ${data.message} (upserted=${data.upserted})`);
        }
        else if (data.errors && data.errors.length > 0) {
            Logger_1.default.warn(`[TrackingService] ⚠️ API partial error: ${data.message}`);
            for (const err of data.errors) {
                Logger_1.default.warn(`[TrackingService]   → pageId=${err.pageId}: ${err.error}`);
            }
        }
        else {
            Logger_1.default.warn(`[TrackingService] ⚠️ API trả về lỗi: ${data.message}`);
        }
    }
    // ── Cache management ────────────────────────────────────────────────────
    loadCache() {
        try {
            if (fs.existsSync(this.cachePath)) {
                const raw = fs.readFileSync(this.cachePath, 'utf-8');
                const parsed = JSON.parse(raw);
                // Migrate: cache cũ không có trackedPageIds → reset để track lại
                if (!Array.isArray(parsed.trackedPageIds)) {
                    parsed.trackedPageIds = [];
                }
                this.cache = parsed;
                Logger_1.default.log(`[TrackingService] 📂 Đã load cache: lastTrackedDate=${this.cache.lastTrackedDate}, trackedPages=${this.cache.trackedPageIds.length}`);
            }
        }
        catch (err) {
            Logger_1.default.warn(`[TrackingService] ⚠️ Lỗi đọc cache: ${err.message} - sẽ tạo mới`);
        }
    }
    saveCache() {
        try {
            const dir = path.dirname(this.cachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf-8');
        }
        catch (err) {
            Logger_1.default.warn(`[TrackingService] ⚠️ Lỗi ghi cache: ${err.message}`);
        }
    }
    /**
     * Sinh hoặc lấy machineId cố định cho máy này.
     * Lưu trong cache để không đổi mỗi lần chạy app.
     */
    generateMachineId() {
        const id = (0, uuid_1.v4)();
        Logger_1.default.log(`[TrackingService] 🆔 Đã tạo machineId mới: ${id.slice(0, 8)}...`);
        return id;
    }
    /**
     * Format date theo định dạng DD/MM/YYYY HH:mm (Google Sheets format).
     */
    formatDate(date) {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
    }
}
exports.default = TrackingService;
//# sourceMappingURL=TrackingService.js.map