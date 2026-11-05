"use strict";
/**
 * FacebookAttachment.ts
 * Port từ Python _messaging/_attachments.py
 * Upload file đính kèm lên Facebook
 *
 * Lưu ý: Sử dụng manual multipart body để tránh lỗi 0KB do form-data
 * npm package không tương thích với môi trường Electron Node.js.
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
exports.uploadAttachment = uploadAttachment;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const mime = __importStar(require("mime-types"));
const FacebookUtils_1 = require("./FacebookUtils");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const UPLOAD_URL = 'https://upload.facebook.com/ajax/mercury/upload.php';
const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.90 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.90 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/22.0.1207.1 Safari/537.1',
];
let _uploadReqCounter = 0;
/**
 * Build a single multipart field (text value)
 */
function buildTextPart(boundary, name, value) {
    return Buffer.from(`--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${value}\r\n`);
}
/**
 * Build a single multipart field (file value)
 */
function buildFilePart(boundary, name, filename, contentType, data) {
    // Không dùng Content-Transfer-Encoding - header này không chuẩn trong
    // multipart/form-data và gây lỗi parser của Facebook (file về 0KB).
    const header = Buffer.from(`--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`);
    const footer = Buffer.from(`\r\n`);
    return Buffer.concat([header, data, footer]);
}
/**
 * Build closing boundary
 */
function buildClosingBoundary(boundary) {
    return Buffer.from(`--${boundary}--\r\n`);
}
/**
 * Upload file đính kèm lên Facebook
 * Trả về attachmentId để dùng khi send message
 */
async function uploadAttachment(dataFB, filePath, httpsAgent) {
    if (!fs.existsSync(filePath)) {
        Logger_1.default.error(`[FacebookAttachment] File not found: ${filePath}`);
        return null;
    }
    _uploadReqCounter += 1;
    const reqId = (0, FacebookUtils_1.strBase)(_uploadReqCounter, 36);
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    let mimeType = (mime.lookup(filePath) || 'application/octet-stream');
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;
    // WebM audio recordings (từ MediaRecorder) có mimeType audio/webm nhưng
    // mime.lookup(filePath) chỉ dùng extension → trả về video/webm cho file .webm.
    // Heuristic: nếu file < 5MB và extension là .webm hoặc .ogg, coi như audio.
    if ((mimeType === 'video/webm' || mimeType === 'video/ogg') && fileSize < 5 * 1024 * 1024) {
        mimeType = mimeType === 'video/webm' ? 'audio/webm' : 'audio/ogg';
    }
    Logger_1.default.log(`[FacebookAttachment] Uploading: ${fileName} (${fileSize} bytes, ${mimeType})`);
    // Build multipart body manually - reliable across all Node.js versions
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2, 12)}`;
    const parts = [
        buildTextPart(boundary, 'voice_clip', 'false'),
        buildTextPart(boundary, '__a', '1'),
        buildTextPart(boundary, '__req', reqId),
        buildTextPart(boundary, 'fb_dtsg', dataFB.fb_dtsg),
        buildFilePart(boundary, 'upload_0', fileName, mimeType, fileBuffer),
        buildClosingBoundary(boundary),
    ];
    const bodyBuffer = Buffer.concat(parts);
    try {
        const response = await axios_1.default.post(UPLOAD_URL, bodyBuffer, {
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': String(bodyBuffer.length),
                'Referer': 'https://www.facebook.com',
                'Accept': 'text/html',
                'User-Agent': userAgent,
                'Cookie': dataFB.cookieFacebook,
            },
            timeout: 60000,
            maxBodyLength: 100 * 1024 * 1024, // 100MB max
            maxContentLength: 100 * 1024 * 1024, // 100MB max
            ...(httpsAgent ? { httpsAgent } : {}),
        });
        let resultText = response.data;
        if (typeof resultText === 'string') {
            resultText = resultText.replace(/for\s*\(;;\);/, '').trim();
        }
        let parsed;
        try {
            parsed = typeof resultText === 'string' ? JSON.parse(resultText) : resultText;
        }
        catch {
            Logger_1.default.error(`[FacebookAttachment] Upload failed: cannot parse response - ${String(resultText).slice(0, 200)}`);
            return null;
        }
        const payload = parsed?.payload;
        if (!payload) {
            Logger_1.default.error(`[FacebookAttachment] Upload failed: no payload. Response: ${JSON.stringify(parsed).slice(0, 300)}`);
            return null;
        }
        // Parse metadata - FB sometimes returns array, sometimes object keyed by "0"
        let metadata = null;
        if (payload?.metadata) {
            if (Array.isArray(payload.metadata)) {
                metadata = payload.metadata[0] || null;
            }
            else if (typeof payload.metadata === 'object') {
                metadata = payload.metadata['0'] || Object.values(payload.metadata)[0] || null;
            }
        }
        // Fallback: some responses embed attachment directly in payload (no metadata wrapper)
        if (!metadata && payload.attachmentFbid) {
            metadata = { 0: payload.attachmentFbid, 1: null, 2: mimeType, 3: null };
        }
        if (!metadata) {
            Logger_1.default.error(`[FacebookAttachment] Upload failed: no metadata. Payload keys: ${Object.keys(payload || {}).join(',')}`);
            return null;
        }
        // Extract attachment info from metadata
        // Quan trọng: dùng local mimeType thay vì values[2] từ FB response,
        // vì FB có thể trả về type sai (ví dụ audio/webm → video/mp4).
        const values = Array.isArray(metadata) ? metadata : Object.values(metadata);
        const attachmentId = values[0];
        const attachmentUrl = values[3] || undefined;
        Logger_1.default.log(`[FacebookAttachment] Uploaded: ${fileName} (${fileSize} bytes) → id=${attachmentId} type=${mimeType}`);
        return {
            attachmentId: attachmentId,
            attachmentUrl,
            attachmentType: mimeType,
        };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookAttachment] uploadAttachment error: ${err.message}`);
        return null;
    }
}
//# sourceMappingURL=FacebookAttachment.js.map