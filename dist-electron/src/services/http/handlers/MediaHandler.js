"use strict";
/**
 * MediaHandler - Serve media files từ Boss storage qua HTTP.
 * Employee dùng URL trực tiếp trong <img src> thay vì request binary.
 *
 * Routes:
 *   GET /api/media/{zaloId}/{date}/{filename}  → File gốc
 *   GET /api/media/thumb/{zaloId}/{date}/{filename} → Thumbnail
 *   GET /api/media/avatar/{zaloId}/{filename}  → Avatar
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
exports.handleMediaRequest = handleMediaRequest;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const Logger_1 = __importDefault(require("../../../utils/Logger"));
const FileStorageService_1 = __importDefault(require("../../file/FileStorageService"));
const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
};
function detectMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}
/**
 * Handle GET /api/media/* request.
 * Trả về file trực tiếp với Content-Type phù hợp.
 * Supports Range requests cho video.
 */
function handleMediaRequest(req, res, mediaBasePath) {
    const url = req.url || '';
    try {
        // Parse URL: /api/media/{zaloId}/{date}/{filename}
        //             /api/media/thumb/{zaloId}/{date}/{filename}
        //             /api/media/avatar/{zaloId}/{filename}
        const mediaPath = url.replace('/api/media/', '');
        // Security: resolve real path (follow symlinks, case-normalize on Windows)
        let resolved;
        try {
            resolved = fs.realpathSync(path.resolve(mediaBasePath, mediaPath));
        }
        catch {
            // Direct resolve failed — try resolveAbsolutePath which handles base dir
            // migration (e.g. file was saved under old media directory but getBaseDir
            // now returns a different path when accessed via REST / tunnel).
            // This fixes employee-mode 404 when toBossMediaUrl extracts a relative
            // path after /media/ from an absolute path that lives under a different
            // configFolder than the current getBaseDir().
            try {
                const altPath = FileStorageService_1.default.resolveAbsolutePath(path.join('media', mediaPath));
                if (altPath) {
                    resolved = fs.realpathSync(altPath);
                }
                else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'File not found' }));
                    return;
                }
            }
            catch {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'File not found' }));
                return;
            }
        }
        const safeBase = fs.realpathSync(path.resolve(mediaBasePath));
        if (!resolved.startsWith(safeBase)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
            return;
        }
        if (!fs.existsSync(resolved)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'File not found' }));
            return;
        }
        const stat = fs.statSync(resolved);
        const mime = detectMime(resolved);
        const isImage = mime.startsWith('image/');
        const maxAge = url.includes('/avatar/') ? 604800 : 86400; // Avatar: 7 ngày, còn lại: 1 ngày
        // Handle Range requests (cho video)
        const range = req.headers.range;
        if (range && !isImage) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            const chunkSize = end - start + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': mime,
                'Cache-Control': `public, max-age=${maxAge}`,
            });
            const stream = fs.createReadStream(resolved, { start, end });
            stream.pipe(res);
            return;
        }
        // Normal request
        res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': stat.size,
            'Cache-Control': `public, max-age=${maxAge}`,
            'ETag': `"${stat.mtimeMs}"`,
            'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(resolved).pipe(res);
    }
    catch (err) {
        Logger_1.default.error(`[MediaHandler] Error: ${err.message}`);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
    }
}
//# sourceMappingURL=MediaHandler.js.map