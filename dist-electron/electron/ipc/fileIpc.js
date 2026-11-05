"use strict";
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
exports.registerFileIpc = registerFileIpc;
const electron_1 = require("electron");
const FileStorageService_1 = __importDefault(require("../../src/services/file/FileStorageService"));
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const EventBroadcaster_1 = __importDefault(require("../../src/services/event/EventBroadcaster"));
const MediaCacheService_1 = __importDefault(require("../../src/services/cache/MediaCacheService"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Repair queue: dedup concurrent repairs for the same file */
const pendingRepairs = new Map();
/** Faststart repair queue: dedup concurrent ensureFaststart calls for the same file */
const pendingFaststart = new Map();
/** Lấy đường dẫn ffmpeg: ưu tiên ffmpeg-static, fallback về PATH */
function getFfmpegBin() {
    try {
        // ffmpeg-static trả về path tới binary
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        let ffmpegStatic = require('ffmpeg-static');
        // Fix path when running inside Electron asar archive
        if (ffmpegStatic && ffmpegStatic.includes('app.asar') && !ffmpegStatic.includes('app.asar.unpacked')) {
            ffmpegStatic = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
        }
        if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
            return ffmpegStatic;
        }
    }
    catch { /* not installed */ }
    return 'ffmpeg'; // fallback PATH
}
function registerFileIpc() {
    // Init MediaCacheService cho employee mode
    try {
        MediaCacheService_1.default.getInstance().init();
    }
    catch { }
    electron_1.ipcMain.handle('file:openDialog', async (_event, options) => {
        try {
            const result = await electron_1.dialog.showOpenDialog({
                properties: ['openFile', ...(options?.multiSelect ? ['multiSelections'] : [])],
                filters: options?.filters || [
                    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            });
            return { success: true, filePaths: result.filePaths, canceled: result.canceled };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('file:saveImage', async (_event, { zaloId, url, filename }) => {
        try {
            const localPath = await FileStorageService_1.default.downloadImage(zaloId, url, filename);
            return { success: true, localPath };
        }
        catch (error) {
            Logger_1.default.error(`[fileIpc] saveImage error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('file:getAppDataPath', async () => {
        return { success: true, path: electron_1.app.getPath('userData') };
    });
    electron_1.ipcMain.handle('file:openPath', async (_event, filePath) => {
        try {
            // Resolve relative paths (stored in DB as folder-agnostic relative paths)
            const resolved = FileStorageService_1.default.resolveAbsolutePath(filePath);
            await electron_1.shell.openPath(resolved);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    /** Mở thư mục chứa file và highlight file đó (Explorer/Finder) */
    electron_1.ipcMain.handle('file:showItemInFolder', async (_event, filePath) => {
        try {
            // Resolve relative paths (stored in DB as folder-agnostic relative paths)
            const resolved = FileStorageService_1.default.resolveAbsolutePath(filePath);
            electron_1.shell.showItemInFolder(resolved);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    /**
     * Lưu file về máy: hiện dialog chọn vị trí, copy file local hoặc download từ URL
     */
    electron_1.ipcMain.handle('file:saveAs', async (_event, params) => {
        try {
            const ext = path.extname(params.defaultName) || '';
            const extNoDot = ext.replace('.', '').toLowerCase();
            const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'];
            const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'];
            const filters = [];
            if (imageExts.includes(extNoDot)) {
                filters.push({ name: 'Hình ảnh', extensions: imageExts });
            }
            else if (videoExts.includes(extNoDot)) {
                filters.push({ name: 'Video', extensions: videoExts });
            }
            filters.push({ name: 'Tất cả file', extensions: ['*'] });
            const result = await electron_1.dialog.showSaveDialog({
                defaultPath: params.defaultName,
                filters,
                title: 'Lưu file về máy',
            });
            if (result.canceled || !result.filePath) {
                return { success: true, canceled: true };
            }
            const destPath = result.filePath;
            const resolvedLocalPath = params.localPath ? FileStorageService_1.default.resolveAbsolutePath(params.localPath) : '';
            const isImageExt = imageExts.includes(extNoDot);
            // Try local file first - validate if it's an image
            let localValid = false;
            if (resolvedLocalPath && fs.existsSync(resolvedLocalPath)) {
                if (isImageExt) {
                    const v = FileStorageService_1.default.validateImageFile(resolvedLocalPath);
                    localValid = v.valid;
                    if (!v.valid) {
                        Logger_1.default.warn(`[fileIpc] saveAs: local file corrupted (${v.reason}), will try remote`);
                        try {
                            fs.unlinkSync(resolvedLocalPath);
                        }
                        catch { }
                    }
                }
                else {
                    // Non-image: chỉ check size > 0
                    try {
                        localValid = fs.statSync(resolvedLocalPath).size > 0;
                    }
                    catch { }
                }
            }
            if (localValid && resolvedLocalPath) {
                fs.copyFileSync(resolvedLocalPath, destPath);
            }
            else if (params.remoteUrl) {
                if (!params.zaloId)
                    return { success: false, error: 'zaloId required for remote download' };
                const tmpRelPath = await FileStorageService_1.default.downloadImage(params.zaloId, params.remoteUrl, params.defaultName, params.cookiesJson, params.userAgent);
                const tmpPath = tmpRelPath ? FileStorageService_1.default.resolveAbsolutePath(tmpRelPath) : '';
                if (tmpPath && fs.existsSync(tmpPath)) {
                    fs.copyFileSync(tmpPath, destPath);
                }
                else {
                    return { success: false, error: 'Không thể tải file từ server' };
                }
            }
            else if (params.localPath) {
                // Employee mode fallback: local path không tồn tại (path từ Boss)
                // → chuyển thành Boss REST URL và download qua HttpClientService
                try {
                    const { default: WorkspaceManager } = require('../../src/utils/WorkspaceManager');
                    const ws = WorkspaceManager.getInstance().getActiveWorkspace();
                    if (ws?.type === 'remote' && ws.bossUrl && ws.token) {
                        // Build boss REST URL từ local path (giống toLocalMediaUrl)
                        const normalized = params.localPath.replace(/\\/g, '/');
                        const mediaMatch = normalized.match(/(?:^|\/)(media|_uploads|avatar)\/(.+)/);
                        let bossUrl = '';
                        if (mediaMatch) {
                            bossUrl = `${ws.bossUrl.replace(/\/+$/, '')}/api/${mediaMatch[1]}/${mediaMatch[2]}`;
                        }
                        else {
                            const filename = normalized.split('/').pop() || params.defaultName;
                            bossUrl = `${ws.bossUrl.replace(/\/+$/, '')}/api/media/external/${encodeURIComponent(normalized)}`;
                        }
                        // Download từ Boss
                        const response = await fetch(bossUrl, {
                            headers: { 'Authorization': `Bearer ${ws.token}` },
                            signal: AbortSignal.timeout(120000),
                        });
                        if (!response.ok)
                            throw new Error(`HTTP ${response.status}`);
                        const buffer = Buffer.from(await response.arrayBuffer());
                        fs.writeFileSync(destPath, buffer);
                    }
                    else {
                        return { success: false, error: 'Không có nguồn file để lưu' };
                    }
                }
                catch (e) {
                    Logger_1.default.error(`[fileIpc] saveAs employee fallback error: ${e.message}`);
                    return { success: false, error: 'Không thể tải file từ Boss: ' + e.message };
                }
            }
            else {
                return { success: false, error: 'Không có nguồn file để lưu' };
            }
            return { success: true, savedPath: destPath };
        }
        catch (error) {
            Logger_1.default.error(`[fileIpc] saveAs error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    /** Lưu base64 data thành file tạm để gửi ảnh clipboard */
    electron_1.ipcMain.handle('file:saveTempBlob', async (_event, { base64, ext, filename }) => {
        try {
            const tmpDir = path.join(electron_1.app.getPath('temp'), 'deplao-clipboard');
            if (!fs.existsSync(tmpDir))
                fs.mkdirSync(tmpDir, { recursive: true });
            // Preserve original filename if provided, otherwise generate random name
            const safeName = filename
                ? `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
                : `paste_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext || 'png'}`;
            const filePath = path.join(tmpDir, safeName);
            const buffer = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
            fs.writeFileSync(filePath, buffer);
            return { success: true, filePath };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    /**
     * Đọc ảnh từ local path hoặc remote URL và trả về base64.
     * Dùng main process để tránh CORS khi fetch remote URL từ renderer.
     */
    electron_1.ipcMain.handle('file:readImageAsBase64', async (_event, { localPath: lp, remoteUrl }) => {
        try {
            if (lp) {
                const resolved = FileStorageService_1.default.resolveAbsolutePath(lp);
                if (fs.existsSync(resolved)) {
                    const buffer = fs.readFileSync(resolved);
                    const ext = path.extname(resolved).replace('.', '').toLowerCase() || 'jpg';
                    const mimeMap = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
                    return { success: true, base64: buffer.toString('base64'), mimeType: mimeMap[ext] || 'image/jpeg' };
                }
            }
            if (remoteUrl) {
                const response = await electron_1.net.fetch(remoteUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                });
                if (!response.ok)
                    return { success: false, error: `HTTP ${response.status}` };
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const ct = response.headers.get('content-type') || '';
                const mimeType = ct.startsWith('image/') ? ct.split(';')[0].trim() : 'image/jpeg';
                return { success: true, base64: buffer.toString('base64'), mimeType };
            }
            return { success: false, error: 'No source provided' };
        }
        catch (error) {
            Logger_1.default.error(`[fileIpc] readImageAsBase64 error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    /**
     * Lấy metadata video (duration, width, height) và extract thumbnail dùng ffmpeg-static.
     */
    electron_1.ipcMain.handle('file:getVideoMeta', async (_event, { filePath: videoPath }) => {
        try {
            // Resolve relative paths stored in DB
            const resolvedVideoPath = FileStorageService_1.default.resolveAbsolutePath(videoPath);
            if (!fs.existsSync(resolvedVideoPath))
                return { success: false, error: 'File not found' };
            const tmpDir = path.join(electron_1.app.getPath('temp'), 'deplao-videometa');
            if (!fs.existsSync(tmpDir))
                fs.mkdirSync(tmpDir, { recursive: true });
            const thumbPath = path.join(tmpDir, `thumb_${Date.now()}.jpg`);
            let duration = 0;
            let width = 0;
            let height = 0;
            let gotThumb = false;
            const ffmpegBin = getFfmpegBin();
            Logger_1.default.info(`[fileIpc] getVideoMeta using ffmpeg: ${ffmpegBin}`);
            const { execFileSync, spawnSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
            // ── Probe metadata bằng ffmpeg -i (stderr) ──────────────────
            try {
                // ffmpeg -i in ra info vào stderr, không cần output file
                const probe = spawnSync(ffmpegBin, ['-i', resolvedVideoPath, '-hide_banner'], {
                    timeout: 10000,
                    encoding: 'utf8',
                });
                const stderr = (probe.stderr || '') + (probe.stdout || '');
                // Duration: HH:MM:SS.ms  e.g. "Duration: 00:00:05.23"
                const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
                if (durMatch) {
                    duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
                }
                // Video stream: e.g. "Video: h264, ..., 1280x720"
                const dimMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
                if (dimMatch) {
                    width = parseInt(dimMatch[1]);
                    height = parseInt(dimMatch[2]);
                }
                Logger_1.default.info(`[fileIpc] probed: duration=${duration}s w=${width} h=${height}`);
            }
            catch (e) {
                Logger_1.default.warn(`[fileIpc] probe failed: ${e.message}`);
            }
            // ── Extract thumbnail ────────────────────────────────────────
            const tryExtract = (seekSec) => {
                try {
                    // -ss AFTER -i = accurate seek (slow but correct frames)
                    execFileSync(ffmpegBin, [
                        '-y',
                        '-i', resolvedVideoPath,
                        '-ss', String(seekSec),
                        '-vframes', '1',
                        '-q:v', '2',
                        '-vf', 'scale=480:-2',
                        thumbPath,
                    ], { timeout: 20000 });
                    const ok = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500;
                    Logger_1.default.info(`[fileIpc] tryExtract seek=${seekSec}s → ok=${ok} size=${ok ? fs.statSync(thumbPath).size : 0}`);
                    return ok;
                }
                catch (e) {
                    Logger_1.default.warn(`[fileIpc] tryExtract seek=${seekSec}s failed: ${e.message}`);
                    return false;
                }
            };
            // Thử seek tại 10% duration (ít nhất 1s, tối đa 5s), fallback về 0s
            const seek1 = duration > 1 ? Math.min(Math.max(Math.floor(duration * 0.1), 1), 5) : 0;
            gotThumb = tryExtract(seek1);
            if (!gotThumb && seek1 > 0) {
                gotThumb = tryExtract(0);
            }
            return {
                success: true,
                thumbPath: gotThumb ? thumbPath : '',
                duration: Math.round(duration),
                width,
                height,
            };
        }
        catch (error) {
            Logger_1.default.error(`[fileIpc] getVideoMeta error: ${error.message}`);
            return { success: false, error: error.message, thumbPath: '', duration: 0, width: 0, height: 0 };
        }
    });
    /**
     * Repair ảnh lỗi: xóa file hỏng, tải lại từ CDN backup URL, cập nhật DB.
     * Renderer gọi khi img onError fire (MediaBubble / MediaViewer).
     */
    electron_1.ipcMain.handle('file:repairImage', async (_event, params) => {
        const { zaloId, msgId, threadId, localPath, remoteUrl } = params;
        if (!zaloId || !msgId)
            return { success: false, error: 'Missing zaloId or msgId' };
        // Dedup: nếu đang repair file này rồi → chờ kết quả hiện tại
        const queueKey = localPath || `${zaloId}:${msgId}`;
        const existing = pendingRepairs.get(queueKey);
        if (existing)
            return existing;
        const repairPromise = (async () => {
            try {
                // 1. Xóa file cũ nếu tồn tại
                if (localPath) {
                    const absPath = FileStorageService_1.default.resolveAbsolutePath(localPath);
                    if (absPath && fs.existsSync(absPath)) {
                        try {
                            fs.unlinkSync(absPath);
                        }
                        catch { }
                    }
                }
                // 2. Lấy URL ảnh: ưu tiên remoteUrl, fallback lookup DB
                let imgUrl = remoteUrl || '';
                if (!imgUrl) {
                    try {
                        const row = DatabaseService_1.default.getInstance().getMessageById(zaloId, msgId);
                        if (row?.content) {
                            const contentRaw = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                            imgUrl = DatabaseService_1.default.extractImageUrlFromContent(contentRaw) || '';
                        }
                    }
                    catch (e) {
                        Logger_1.default.warn(`[fileIpc] repairImage: DB lookup failed: ${e.message}`);
                    }
                }
                if (!imgUrl)
                    return { success: false, error: 'No image URL available' };
                // 3. Tải lại bằng session của đúng tài khoản. CDN Zalo có thể
                // trả 403 cho request không mang Cookie/User-Agent dù URL vẫn mở
                // được trong trình duyệt.
                const account = DatabaseService_1.default.getInstance().getAccounts()
                    .find(item => item.zalo_id === zaloId);
                const newLocalPath = await FileStorageService_1.default.downloadImage(zaloId, imgUrl, undefined, account?.cookies, account?.user_agent);
                if (!newLocalPath)
                    return { success: false, error: 'Download returned empty (CDN expired?)' };
                // 4. Cập nhật DB
                DatabaseService_1.default.getInstance().updateLocalPaths(zaloId, msgId, { main: newLocalPath });
                // 5. Emit event để renderer refresh
                const resolvedThreadId = threadId || (() => {
                    try {
                        const row = DatabaseService_1.default.getInstance().getMessageById(zaloId, msgId);
                        return row?.thread_id || '';
                    }
                    catch {
                        return '';
                    }
                })();
                if (resolvedThreadId) {
                    EventBroadcaster_1.default.sendDirect('event:localPath', {
                        zaloId, msgId, threadId: resolvedThreadId,
                        localPaths: { main: newLocalPath },
                    });
                }
                Logger_1.default.log(`[fileIpc] repairImage success: ${msgId} → ${newLocalPath}`);
                return { success: true, newLocalPath };
            }
            catch (error) {
                Logger_1.default.error(`[fileIpc] repairImage error: ${error.message}`);
                return { success: false, error: error.message };
            }
        })();
        pendingRepairs.set(queueKey, repairPromise);
        repairPromise.finally(() => pendingRepairs.delete(queueKey));
        return repairPromise;
    });
    /**
     * Ensure MP4 file is faststart (moov atom at beginning).
     * Returns { fixed: true } if file was modified, { fixed: false } if already OK or failed.
     * Dedup: concurrent calls for the same file share one Promise.
     */
    electron_1.ipcMain.handle('file:ensureFaststart', async (_event, { filePath }) => {
        // Dedup: if already processing this file, wait for existing result
        const existing = pendingFaststart.get(filePath);
        if (existing)
            return existing;
        const promise = (async () => {
            try {
                const absPath = FileStorageService_1.default.resolveAbsolutePath(filePath);
                if (!absPath || !fs.existsSync(absPath)) {
                    return { success: false, error: 'File not found' };
                }
                const ext = path.extname(absPath).toLowerCase();
                if (ext !== '.mp4') {
                    return { success: true, fixed: false, reason: 'Not MP4' };
                }
                // Check if already faststart by scanning first 64KB for moov atom
                const stat = fs.statSync(absPath);
                const scanBuf = Buffer.alloc(Math.min(stat.size, 64 * 1024));
                const fd = fs.openSync(absPath, 'r');
                fs.readSync(fd, scanBuf, 0, scanBuf.length, 0);
                fs.closeSync(fd);
                let offset = 0;
                while (offset < scanBuf.length - 8) {
                    const boxSize = scanBuf.readUInt32BE(offset);
                    const boxType = scanBuf.toString('ascii', offset + 4, offset + 8);
                    if (boxType === 'moov') {
                        return { success: true, fixed: false, reason: 'Already faststart' };
                    }
                    if (boxSize < 8)
                        break;
                    offset += boxSize;
                }
                // Not faststart — fix with ffmpeg
                Logger_1.default.log(`[fileIpc] ensureFaststart: fixing ${absPath}`);
                const ffmpegBin = getFfmpegBin();
                const tempPath = absPath + '.faststart.tmp.mp4';
                const { spawnSync } = require('child_process');
                const result = spawnSync(ffmpegBin, [
                    '-y', '-i', absPath,
                    '-c', 'copy',
                    '-movflags', '+faststart',
                    tempPath,
                ], { timeout: 120000, stdio: 'pipe' });
                if (result.status === 0 && fs.existsSync(tempPath)) {
                    fs.renameSync(tempPath, absPath);
                    Logger_1.default.log(`[fileIpc] ensureFaststart: fixed ${absPath}`);
                    return { success: true, fixed: true };
                }
                else {
                    try {
                        fs.unlinkSync(tempPath);
                    }
                    catch { }
                    return { success: false, error: `ffmpeg exit ${result.status}` };
                }
            }
            catch (err) {
                Logger_1.default.error(`[fileIpc] ensureFaststart error: ${err.message}`);
                return { success: false, error: err.message };
            }
        })();
        pendingFaststart.set(filePath, promise);
        promise.finally(() => pendingFaststart.delete(filePath));
        return promise;
    });
    /**
     * Batch validate ảnh local: kiểm tra nhiều ảnh cùng lúc, trả về danh sách ảnh lỗi.
     * Renderer gọi khi load messages để tìm và repair ảnh hỏng từ trước.
     */
    electron_1.ipcMain.handle('file:validateLocalImages', async (_event, items) => {
        const corrupted = [];
        if (!items?.length)
            return { success: true, corrupted };
        for (const item of items) {
            try {
                const absPath = FileStorageService_1.default.resolveAbsolutePath(item.localPath);
                if (!absPath)
                    continue;
                const ext = path.extname(absPath).replace('.', '').toLowerCase();
                const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'];
                if (!imageExts.includes(ext))
                    continue; // Chỉ validate ảnh
                const v = FileStorageService_1.default.validateImageFile(absPath);
                if (!v.valid) {
                    corrupted.push({ ...item, reason: v.reason || 'unknown' });
                    // Xóa file lỗi ngay
                    try {
                        fs.unlinkSync(absPath);
                    }
                    catch { }
                }
            }
            catch { }
        }
        return { success: true, corrupted };
    });
    /**
     * MediaCache: resolve URL với cache-first
     * Employee: kiểm tra cache local trước, nếu miss thì download background + trả về boss URL
     */
    electron_1.ipcMain.handle('media:resolveUrl', async (_event, { bossUrl, mediaType }) => {
        try {
            const cache = MediaCacheService_1.default.getInstance();
            if (!bossUrl)
                return { success: true, displayUrl: '', fromCache: false };
            // 1. Kiểm tra MediaCacheService trước
            const cached = cache.hasCache(bossUrl);
            if (cached) {
                const result = await cache.resolveUrl(bossUrl, (mediaType || 'image'));
                return { success: true, displayUrl: result.displayUrl, fromCache: true };
            }
            // 2. Kiểm tra workspace media directory (file đã download từ trước)
            //    Boss URL pattern: /api/media/{path} → map về workspace media/
            try {
                const mediaPath = bossUrl.includes('/api/media/')
                    ? 'media/' + bossUrl.split('/api/media/')[1].split('?')[0]
                    : '';
                if (mediaPath) {
                    const absPath = FileStorageService_1.default.resolveAbsolutePath(mediaPath);
                    if (absPath && fs.existsSync(absPath)) {
                        // File tồn tại trong workspace → dùng file:// URL
                        const normalized = absPath.replace(/\\/g, '/');
                        const fileUrl = `file:///${normalized.startsWith('/') ? '' : '/'}${normalized}`;
                        Logger_1.default.log(`[fileIpc] media:resolveUrl → workspace hit: ${mediaPath}`);
                        return { success: true, displayUrl: fileUrl, fromCache: true };
                    }
                }
            }
            catch { }
            // 3. Cache miss → download background từ Boss
            const result = await cache.resolveUrl(bossUrl, (mediaType || 'image'));
            return { success: true, displayUrl: result.displayUrl, fromCache: result.fromCache };
        }
        catch (err) {
            Logger_1.default.error(`[fileIpc] media:resolveUrl error: ${err.message}`);
            return { success: false, displayUrl: bossUrl, fromCache: false };
        }
    });
    /** Check xem URL đã được cache hoặc có trong workspace media chưa (sync, nhanh) */
    electron_1.ipcMain.handle('media:hasCache', async (_event, { bossUrl }) => {
        try {
            const cache = MediaCacheService_1.default.getInstance();
            if (cache.hasCache(bossUrl))
                return { success: true, cached: true };
            // Check workspace media directory
            const mediaPath = bossUrl.includes('/api/media/')
                ? 'media/' + bossUrl.split('/api/media/')[1].split('?')[0]
                : '';
            if (mediaPath) {
                const absPath = FileStorageService_1.default.resolveAbsolutePath(mediaPath);
                if (absPath && fs.existsSync(absPath)) {
                    return { success: true, cached: true };
                }
            }
            return { success: true, cached: false };
        }
        catch {
            return { success: true, cached: false };
        }
    });
    /**
     * Employee mode: ensure media file is available locally.
     * Khác với media:resolveUrl (background download), handler này CHỜ download
     * hoàn tất trước khi trả về — dùng khi user click mở video/file để có file local ngay.
     *
     * Input: { bossUrl: string, mediaType?: string }
     * Output: { success: boolean, displayUrl: string, localPath?: string, fromCache: boolean }
     */
    electron_1.ipcMain.handle('file:employeeEnsureMediaLocal', async (_event, { bossUrl, mediaType }) => {
        try {
            const cache = MediaCacheService_1.default.getInstance();
            if (!bossUrl)
                return { success: true, displayUrl: '', fromCache: false };
            // Dùng resolveUrlSync — chờ download nếu cache miss
            const result = await cache.resolveUrlSync(bossUrl, (mediaType || 'image'));
            // Extract local path từ file:// URL
            let localPath = '';
            if (result.displayUrl.startsWith('file://')) {
                const urlPath = result.displayUrl.replace('file:///', '');
                // Handle both Unix and Windows paths
                localPath = decodeURIComponent(urlPath);
                // Normalize Windows paths
                if (process.platform === 'win32' && localPath.startsWith('/')) {
                    localPath = localPath.replace(/^\//, '');
                }
                // Kiểm tra file thực sự tồn tại
                try {
                    if (!require('fs').existsSync(localPath)) {
                        localPath = '';
                    }
                }
                catch {
                    localPath = '';
                }
            }
            return {
                success: true,
                displayUrl: result.displayUrl,
                localPath,
                fromCache: result.fromCache,
            };
        }
        catch (err) {
            Logger_1.default.error(`[fileIpc] employeeEnsureMediaLocal error: ${err.message}`);
            return { success: false, displayUrl: bossUrl, localPath: '', fromCache: false, error: err.message };
        }
    });
    /**
     * Batch preload: nhận danh sách Boss URLs, trigger download background
     * Trả về ngay, không đợi download hoàn tất
     */
    electron_1.ipcMain.handle('media:preloadBatch', async (_event, { urls }) => {
        try {
            const cache = MediaCacheService_1.default.getInstance();
            let triggered = 0;
            for (const url of urls) {
                if (!url)
                    continue;
                // Skip nếu đã có trong cache hoặc workspace media
                if (cache.hasCache(url))
                    continue;
                const mediaPath = url.includes('/api/media/')
                    ? 'media/' + url.split('/api/media/')[1].split('?')[0]
                    : '';
                if (mediaPath) {
                    try {
                        const absPath = FileStorageService_1.default.resolveAbsolutePath(mediaPath);
                        if (absPath && require('fs').existsSync(absPath))
                            continue;
                    }
                    catch { }
                }
                // Cache miss → download background
                cache.resolveUrl(url, 'image').catch(() => { });
                triggered++;
            }
            return { success: true, triggered };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
}
//# sourceMappingURL=fileIpc.js.map