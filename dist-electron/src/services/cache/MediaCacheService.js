"use strict";
/**
 * MediaCacheService - Employee-side disk cache cho media files.
 *
 * Khi employee xem ảnh lần đầu → download từ boss → lưu vào cache
 * Lần sau → dùng từ cache (không cần mạng)
 *
 * Cache location: app.getPath('cache')/media-cache/
 * LRU eviction khi vượt quá dung lượng cho phép.
 *
 * Chỉ hoạt động trong employee mode.
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
const FileStorageService_1 = __importDefault(require("../file/FileStorageService"));
class MediaCacheService {
    constructor() {
        this.cacheDir = '';
        this.maxSizeBytes = 2 * 1024 * 1024 * 1024; // 2GB default
        this.indexPath = '';
        this.index = new Map();
        this.initialized = false;
        // ── Concurrency control ──────────────────────────────────────
        this.maxConcurrent = 3;
        this.activeCount = 0;
        this.pendingQueue = [];
        // Track failed URLs để không retry liên tục
        this.failedUrls = new Map(); // url → timestamp
    }
    static getInstance() {
        if (!MediaCacheService.instance) {
            MediaCacheService.instance = new MediaCacheService();
        }
        return MediaCacheService.instance;
    }
    /** Khởi tạo cache folder và load index */
    init(customCacheDir) {
        try {
            this.cacheDir = customCacheDir || this.getDefaultCacheDir();
            this.indexPath = path.join(this.cacheDir, 'index.json');
            // Tạo folder nếu chưa có
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
            }
            // Load index
            this.loadIndex();
            this.initialized = true;
            Logger_1.default.log(`[MediaCacheService] Initialized: ${this.cacheDir} (max ${(this.maxSizeBytes / 1024 / 1024 / 1024).toFixed(1)}GB)`);
        }
        catch (err) {
            Logger_1.default.warn(`[MediaCacheService] Init error: ${err.message}`);
        }
    }
    /**
     * Lấy URL để hiển thị media:
     * - Có trong cache → trả về file:// URL
     * - Không có → trả về boss URL để fetch, đồng thời download background
     */
    async resolveUrl(bossUrl, mediaType = 'image') {
        if (!this.initialized) {
            return { displayUrl: bossUrl, fromCache: false };
        }
        const cacheKey = this.hashUrl(bossUrl);
        const cached = this.index.get(cacheKey);
        // Cache hit (hash-based)
        if (cached && fs.existsSync(this.getCacheFilePath(cacheKey))) {
            cached.accessedAt = Date.now();
            this.saveIndex();
            return {
                displayUrl: this.getCacheFileUrl(cacheKey, cached.mimeType),
                fromCache: true,
            };
        }
        // Cache miss → kiểm tra structured media folder (có thể đã download từ lần trước)
        try {
            const mediaRelPath = this.extractMediaRelPath(bossUrl);
            if (mediaRelPath) {
                let mediaBaseDir = FileStorageService_1.default.getBaseDir?.() || '';
                if (!mediaBaseDir) {
                    const { app } = require('electron');
                    mediaBaseDir = path.join(app.getPath('userData'), 'media');
                }
                const structuredPath = path.resolve(mediaBaseDir, mediaRelPath);
                if (fs.existsSync(structuredPath)) {
                    return { displayUrl: `file:///${structuredPath.replace(/\\/g, '/').replace(/^\//, '')}`, fromCache: true };
                }
            }
        }
        catch { }
        // Cache miss → download background
        this.downloadToCache(bossUrl, cacheKey, mediaType).catch(() => { });
        return { displayUrl: bossUrl, fromCache: false };
    }
    /**
     * Resolve URL với cache-first, nhưng CHỜ download hoàn tất nếu cache miss.
     * Dùng khi user chủ động click mở file/media (cần file local ngay).
     */
    async resolveUrlSync(bossUrl, mediaType = 'image') {
        if (!this.initialized) {
            return { displayUrl: bossUrl, fromCache: false };
        }
        const cacheKey = this.hashUrl(bossUrl);
        const cached = this.index.get(cacheKey);
        // Cache hit
        if (cached && fs.existsSync(this.getCacheFilePath(cacheKey))) {
            cached.accessedAt = Date.now();
            this.saveIndex();
            return {
                displayUrl: this.getCacheFileUrl(cacheKey, cached.mimeType),
                fromCache: true,
            };
        }
        // Cache miss → download SYNCHRONOUS (chờ hoàn tất)
        try {
            await this.downloadToCache(bossUrl, cacheKey, mediaType);
            // Kiểm tra lại sau khi download
            const entry = this.index.get(cacheKey);
            if (entry && fs.existsSync(this.getCacheFilePath(cacheKey))) {
                return {
                    displayUrl: this.getCacheFileUrl(cacheKey, entry.mimeType),
                    fromCache: true,
                };
            }
        }
        catch (err) {
            Logger_1.default.warn(`[MediaCacheService] resolveUrlSync failed: ${err.message}`);
        }
        return { displayUrl: bossUrl, fromCache: false };
    }
    /** Check xem có cache không (sync, nhanh) */
    hasCache(bossUrl) {
        const key = this.hashUrl(bossUrl);
        const entry = this.index.get(key);
        return !!entry && fs.existsSync(this.getCacheFilePath(key));
    }
    async acquireSlot() {
        if (this.activeCount < this.maxConcurrent) {
            this.activeCount++;
            return;
        }
        return new Promise((resolve) => {
            this.pendingQueue.push(resolve);
        });
    }
    releaseSlot() {
        if (this.pendingQueue.length > 0) {
            const next = this.pendingQueue.shift();
            if (next)
                next();
        }
        else {
            this.activeCount--;
        }
    }
    /** Download file từ boss vào cache + lưu đúng folder media/ */
    async downloadToCache(bossUrl, cacheKey, mediaType) {
        await this.acquireSlot();
        try {
            // Skip nếu đã thất bại trong 5 phút qua
            const lastFail = this.failedUrls.get(bossUrl);
            if (lastFail && Date.now() - lastFail < 5 * 60 * 1000)
                return;
            Logger_1.default.log(`[MediaCacheService] Downloading: ${bossUrl.slice(0, 80)}...`);
            const response = await fetch(bossUrl, {
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) {
                Logger_1.default.warn(`[MediaCacheService] Download failed: HTTP ${response.status}`);
                this.failedUrls.set(bossUrl, Date.now());
                return;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const mimeType = response.headers.get('content-type') || this.guessMimeFromUrl(bossUrl);
            const filePath = this.getCacheFilePath(cacheKey);
            // Lưu cache hash-based
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, buffer);
            // Ghi index
            this.index.set(cacheKey, {
                key: cacheKey,
                size: buffer.length,
                accessedAt: Date.now(),
                createdAt: Date.now(),
                url: bossUrl,
                mimeType,
            });
            this.saveIndex();
            this.evictIfNeeded();
            // Đồng thời lưu vào structured media folder nếu boss URL chứa đường dẫn đúng
            // VD: https://boss/api/media/zaloId/2024-06-27/video.mp4
            try {
                const mediaRelPath = this.extractMediaRelPath(bossUrl);
                if (mediaRelPath) {
                    let mediaBaseDir = FileStorageService_1.default.getBaseDir?.() || '';
                    if (!mediaBaseDir) {
                        const { app } = require('electron');
                        mediaBaseDir = path.join(app.getPath('userData'), 'media');
                    }
                    const structuredPath = path.resolve(mediaBaseDir, mediaRelPath);
                    const structuredDir = path.dirname(structuredPath);
                    if (!fs.existsSync(structuredDir))
                        fs.mkdirSync(structuredDir, { recursive: true });
                    if (!fs.existsSync(structuredPath))
                        fs.writeFileSync(structuredPath, buffer);
                    Logger_1.default.log(`[MediaCacheService] Also saved to: ${structuredPath}`);
                }
            }
            catch { }
            Logger_1.default.log(`[MediaCacheService] Cached: ${(buffer.length / 1024).toFixed(1)}KB`);
        }
        catch (err) {
            // Timeout/network error — không track failed để có thể retry sau
            Logger_1.default.warn(`[MediaCacheService] Download error: ${err.message}`);
        }
        finally {
            this.releaseSlot();
        }
    }
    /** Xoá cache cũ nếu vượt quá dung lượng */
    evictIfNeeded() {
        let totalSize = 0;
        const entries = [];
        for (const entry of this.index.values()) {
            totalSize += entry.size;
            entries.push(entry);
        }
        if (totalSize <= this.maxSizeBytes)
            return;
        // Sort by accessedAt (oldest first)
        entries.sort((a, b) => a.accessedAt - b.accessedAt);
        const toDelete = [];
        for (const entry of entries) {
            if (totalSize <= this.maxSizeBytes)
                break;
            toDelete.push(entry.key);
            totalSize -= entry.size;
        }
        for (const key of toDelete) {
            try {
                const fp = this.getCacheFilePath(key);
                if (fs.existsSync(fp))
                    fs.unlinkSync(fp);
                this.index.delete(key);
            }
            catch { }
        }
        this.saveIndex();
        Logger_1.default.log(`[MediaCacheService] Evicted ${toDelete.length} files, freed ${(totalSize / 1024 / 1024).toFixed(0)}MB`);
    }
    /** Xoá cache cũ hơn N ngày (gọi định kỳ) */
    cleanOldCache(maxAgeDays = 7) {
        const now = Date.now();
        const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
        const toDelete = [];
        for (const [key, entry] of this.index) {
            if (now - entry.createdAt > maxAge) {
                toDelete.push(key);
            }
        }
        for (const key of toDelete) {
            try {
                const fp = this.getCacheFilePath(key);
                if (fs.existsSync(fp))
                    fs.unlinkSync(fp);
                this.index.delete(key);
            }
            catch { }
        }
        if (toDelete.length > 0) {
            this.saveIndex();
            Logger_1.default.log(`[MediaCacheService] Cleaned ${toDelete.length} old cache files`);
        }
    }
    /** Reset hoàn toàn cache */
    clear() {
        try {
            for (const key of this.index.keys()) {
                try {
                    fs.unlinkSync(this.getCacheFilePath(key));
                }
                catch { }
            }
            this.index.clear();
            this.saveIndex();
            Logger_1.default.log('[MediaCacheService] Cache cleared');
        }
        catch { }
    }
    // ── Helpers ──────────────────────────────────────────────────
    hashUrl(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }
    getCacheFilePath(key) {
        return path.join(this.cacheDir, key.slice(0, 2), key);
    }
    getCacheFileUrl(key, mimeType) {
        const fp = this.getCacheFilePath(key);
        // Dùng file:// protocol, Electron CSP cho phép
        const normalized = fp.replace(/\\/g, '/');
        return `file:///${normalized.startsWith('/') ? '' : '/'}${normalized}`;
    }
    guessMimeFromUrl(url) {
        const ext = path.extname(url).toLowerCase();
        const mimeMap = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
            '.pdf': 'application/pdf', '.mp3': 'audio/mpeg',
        };
        return mimeMap[ext] || 'application/octet-stream';
    }
    /** Trích xuất relative path từ boss URL để lưu đúng folder media/zaloId/date/
     *  VD: https://boss/api/media/2231125334791940537/2024/06/27/video.mp4
     *    → 2231125334791940537/2024/06/27/video.mp4
     *  VD: https://boss/api/media/thumb/2231125334791940537/2024/06/27/thumb.jpg
     *    → thumb/2231125334791940537/2024/06/27/thumb.jpg
     */
    extractMediaRelPath(bossUrl) {
        try {
            // Match /api/media/ hoặc /api/avatar/...
            const match = bossUrl.match(/\/api\/(?:media|avatar|_uploads)\/(.+)/);
            if (match)
                return match[1];
            // Fallback: lấy pathname từ URL
            const urlObj = new URL(bossUrl);
            const pathname = urlObj.pathname.replace(/^\/api\//, '');
            return pathname || '';
        }
        catch {
            return '';
        }
    }
    getDefaultCacheDir() {
        try {
            const { app } = require('electron');
            return path.join(app.getPath('cache'), 'media-cache');
        }
        catch {
            // Fallback khi không ở trong Electron (dev/test)
            return path.join(process.cwd(), '.cache', 'media');
        }
    }
    loadIndex() {
        try {
            if (fs.existsSync(this.indexPath)) {
                const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
                this.index = new Map(Object.entries(data));
            }
        }
        catch { }
    }
    saveIndex() {
        try {
            const dir = path.dirname(this.indexPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const obj = {};
            for (const [k, v] of this.index) {
                obj[k] = v;
            }
            fs.writeFileSync(this.indexPath, JSON.stringify(obj));
        }
        catch { }
    }
}
exports.default = MediaCacheService;
//# sourceMappingURL=MediaCacheService.js.map