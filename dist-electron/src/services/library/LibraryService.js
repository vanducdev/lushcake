"use strict";
/**
 * LibraryService - Quản lý thư viện media dùng chung (ảnh, file, video).
 *
 * Lưu trên boss storage, employee truy cập qua REST API.
 * Upload qua multipart/form-data, thumbnail tự động gen.
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const uuid_1 = require("uuid");
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const FileStorageService_1 = __importDefault(require("../file/FileStorageService"));
const EventBroadcaster_1 = __importDefault(require("../event/EventBroadcaster"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
const THUMB_SIZE = 320;
class LibraryService {
    static getInstance() {
        if (!LibraryService.instance) {
            LibraryService.instance = new LibraryService();
        }
        return LibraryService.instance;
    }
    // ─── Storage paths ───────────────────────────────────────────────
    getLibraryDir(zaloId) {
        const base = FileStorageService_1.default.getBaseDir();
        return path.join(base, 'library', zaloId);
    }
    getTypeDir(zaloId, type) {
        return path.join(this.getLibraryDir(zaloId), `${type}s`);
    }
    getThumbDir(zaloId) {
        return path.join(this.getLibraryDir(zaloId), 'thumbs');
    }
    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    // ─── Upload ──────────────────────────────────────────────────────
    /**
     * Upload file vào thư viện.
     * @returns LibraryItem info
     */
    async upload(params) {
        const { zaloId, buffer, fileName, mimeType, employeeId, tags, folderId } = params;
        const uuid = (0, uuid_1.v4)();
        const ext = path.extname(fileName) || '.bin';
        const type = this.detectType(mimeType, ext);
        const typeDir = this.getTypeDir(zaloId, type);
        const thumbDir = this.getThumbDir(zaloId);
        this.ensureDir(typeDir);
        this.ensureDir(thumbDir);
        // Save file
        const filePath = path.join(typeDir, `${uuid}${ext}`);
        fs.writeFileSync(filePath, buffer);
        // Dimensions (chỉ cho ảnh)
        let width = 0;
        let height = 0;
        let thumbPath = null;
        if (type === 'image') {
            try {
                const sharp = require('sharp');
                const meta = await sharp(buffer).metadata();
                width = meta.width || 0;
                height = meta.height || 0;
                // Generate thumbnail
                const thumbName = `${uuid}_thumb.jpg`;
                thumbPath = path.join(thumbDir, thumbName);
                await sharp(buffer)
                    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toFile(thumbPath);
            }
            catch (err) {
                Logger_1.default.warn(`[LibraryService] Thumbnail gen error: ${err.message}`);
            }
        }
        if (type === 'video') {
            try {
                const sharp = require('sharp');
                const thumbName = `${uuid}_thumb.jpg`;
                thumbPath = path.join(thumbDir, thumbName);
                // For videos, create a placeholder thumbnail
                await sharp({
                    create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 30, b: 30 } }
                })
                    .jpeg({ quality: 60 })
                    .toFile(thumbPath);
            }
            catch { }
        }
        const now = Date.now();
        const db = DatabaseService_1.default.getInstance();
        const relativeFilePath = filePath;
        const relativeThumbPath = thumbPath;
        db.run(`INSERT INTO media_library_items
       (uuid, owner_zalo_id, type, name, mime_type, size, width, height,
        file_path, thumb_path, alt_text, tags, folder_id, is_favorite, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [uuid, zaloId, type, fileName, mimeType, buffer.length, width, height,
            relativeFilePath, relativeThumbPath, '', tags || '', folderId ?? null, 0, employeeId || '', now, now]);
        const item = {
            uuid, owner_zalo_id: zaloId, type: type, name: fileName,
            mime_type: mimeType, size: buffer.length, width, height,
            file_path: relativeFilePath, thumb_path: relativeThumbPath,
            alt_text: '', tags: tags || '', folder_id: folderId ?? null,
            is_favorite: 0, created_by: employeeId || '', created_at: now, updated_at: now,
        };
        EventBroadcaster_1.default.emit('library:itemAdded', { zaloId, item, uuid });
        Logger_1.default.log(`[LibraryService] Uploaded: ${fileName} (${(buffer.length / 1024).toFixed(1)}KB) type=${type}`);
        return item;
    }
    // ─── Query ───────────────────────────────────────────────────────
    getItems(params) {
        const { zaloId, ownerZaloIds, type, search, folderId, page = 1, limit = 50 } = params;
        const db = DatabaseService_1.default.getInstance();
        const owners = Array.from(new Set((ownerZaloIds || []).filter(id => typeof id === 'string' && id.trim())));
        const effectiveOwners = owners.length > 0 ? owners : [zaloId];
        const conditions = [`owner_zalo_id IN (${effectiveOwners.map(() => '?').join(',')})`];
        const values = [...effectiveOwners];
        if (type && type !== 'all') {
            conditions.push('type = ?');
            values.push(type);
        }
        if (search) {
            conditions.push('(name LIKE ? OR tags LIKE ? OR alt_text LIKE ?)');
            const q = `%${search}%`;
            values.push(q, q, q);
        }
        if (folderId !== undefined && folderId !== null) {
            if (folderId === -1) {
                conditions.push('folder_id IS NULL');
            }
            else {
                conditions.push('folder_id = ?');
                values.push(folderId);
            }
        }
        const where = conditions.join(' AND ');
        const offset = (page - 1) * limit;
        const total = db.queryOne(`SELECT COUNT(*) as n FROM media_library_items WHERE ${where}`, values)?.n || 0;
        const items = db.query(`SELECT * FROM media_library_items WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]) || [];
        return { items, total };
    }
    getItem(uuid) {
        const db = DatabaseService_1.default.getInstance();
        return db.queryOne('SELECT * FROM media_library_items WHERE uuid = ?', [uuid]) || null;
    }
    updateItem(uuid, params) {
        const db = DatabaseService_1.default.getInstance();
        const sets = [];
        const values = [];
        if (params.name !== undefined) {
            sets.push('name = ?');
            values.push(params.name);
        }
        if (params.tags !== undefined) {
            sets.push('tags = ?');
            values.push(params.tags);
        }
        if (params.folderId !== undefined) {
            sets.push('folder_id = ?');
            values.push(params.folderId);
        }
        if (params.isFavorite !== undefined) {
            sets.push('is_favorite = ?');
            values.push(params.isFavorite);
        }
        if (params.altText !== undefined) {
            sets.push('alt_text = ?');
            values.push(params.altText);
        }
        if (sets.length === 0)
            return false;
        sets.push('updated_at = ?');
        values.push(Date.now());
        values.push(uuid);
        db.run(`UPDATE media_library_items SET ${sets.join(', ')} WHERE uuid = ?`, values);
        EventBroadcaster_1.default.emit('library:itemUpdated', { uuid, ...params });
        return true;
    }
    deleteItem(uuid) {
        const db = DatabaseService_1.default.getInstance();
        const item = this.getItem(uuid);
        if (!item)
            return false;
        // Xoá file
        try {
            if (fs.existsSync(item.file_path))
                fs.unlinkSync(item.file_path);
        }
        catch { }
        try {
            if (item.thumb_path && fs.existsSync(item.thumb_path))
                fs.unlinkSync(item.thumb_path);
        }
        catch { }
        db.run('DELETE FROM media_library_items WHERE uuid = ?', [uuid]);
        EventBroadcaster_1.default.emit('library:itemDeleted', { uuid, zaloId: item.owner_zalo_id });
        return true;
    }
    // ─── Folders ─────────────────────────────────────────────────────
    createFolder(params) {
        const db = DatabaseService_1.default.getInstance();
        const sort = (db.queryOne('SELECT MAX(sort_order) as m FROM media_library_folders WHERE owner_zalo_id=?', [params.zaloId])?.m || 0) + 1;
        const id = db.runInsert('INSERT INTO media_library_folders (name, parent_id, owner_zalo_id, color, sort_order, type) VALUES (?,?,?,?,?,?)', [params.name, params.parentId ?? null, params.zaloId, params.color || '#6366f1', sort, params.type || null]);
        return id;
    }
    getFolders(zaloId, type, ownerZaloIds) {
        const db = DatabaseService_1.default.getInstance();
        const owners = Array.from(new Set((ownerZaloIds || []).filter(id => typeof id === 'string' && id.trim())));
        const effectiveOwners = owners.length > 0 ? owners : [zaloId];
        const conditions = [`f.owner_zalo_id IN (${effectiveOwners.map(() => '?').join(',')})`];
        const values = [...effectiveOwners];
        if (type && type !== 'all') {
            // Chỉ load folder đúng type, bỏ qua folder cũ ko có type
            conditions.push('f.type = ?');
            values.push(type);
        }
        const countTypeSql = type && type !== 'all' ? 'AND i.type = ?' : '';
        const queryValues = type && type !== 'all' ? [type, ...values] : values;
        const folders = db.query(`SELECT f.*,
        (SELECT COUNT(*) FROM media_library_items i
          WHERE i.folder_id = f.id AND i.owner_zalo_id = f.owner_zalo_id ${countTypeSql}) as item_count
       FROM media_library_folders f WHERE ${conditions.join(' AND ')} ORDER BY f.sort_order ASC`, queryValues) || [];
        return folders;
    }
    deleteFolder(id) {
        const db = DatabaseService_1.default.getInstance();
        db.run('UPDATE media_library_items SET folder_id = NULL WHERE folder_id = ?', [id]);
        db.run('DELETE FROM media_library_folders WHERE id = ?', [id]);
        return true;
    }
    // ─── Serve file ──────────────────────────────────────────────────
    getFilePath(uuid) {
        const item = this.getItem(uuid);
        if (!item || !fs.existsSync(item.file_path))
            return null;
        return { filePath: item.file_path, mimeType: item.mime_type, fileName: item.name };
    }
    getThumbPath(uuid) {
        const item = this.getItem(uuid);
        if (!item || !item.thumb_path || !fs.existsSync(item.thumb_path))
            return null;
        return { filePath: item.thumb_path, mimeType: 'image/jpeg' };
    }
    // ─── Helpers ─────────────────────────────────────────────────────
    detectType(mime, ext) {
        if (mime.startsWith('image/'))
            return 'image';
        if (mime.startsWith('video/'))
            return 'video';
        if (mime === 'application/pdf' || mime.startsWith('application/') || mime.startsWith('text/')
            || ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.txt', '.csv'].includes(ext)) {
            return 'file';
        }
        return 'file';
    }
    // ─── Migration: create tables ────────────────────────────────────
    migrate() {
        const db = DatabaseService_1.default.getInstance();
        try {
            db.exec(`
        CREATE TABLE IF NOT EXISTS media_library_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL UNIQUE,
          owner_zalo_id TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'image',
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL DEFAULT 0,
          width INTEGER NOT NULL DEFAULT 0,
          height INTEGER NOT NULL DEFAULT 0,
          file_path TEXT NOT NULL DEFAULT '',
          thumb_path TEXT DEFAULT NULL,
          alt_text TEXT DEFAULT '',
          tags TEXT DEFAULT '',
          folder_id INTEGER DEFAULT NULL,
          is_favorite INTEGER DEFAULT 0,
          created_by TEXT DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
            db.exec(`
        CREATE TABLE IF NOT EXISTS media_library_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          parent_id INTEGER DEFAULT NULL,
          owner_zalo_id TEXT NOT NULL,
          color TEXT DEFAULT '#6366f1',
          sort_order INTEGER DEFAULT 0
        )
      `);
            // Thêm cột type nếu chưa có (migration)
            try {
                db.exec(`ALTER TABLE media_library_folders ADD COLUMN type TEXT DEFAULT NULL`);
            }
            catch { }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_library_owner ON media_library_items(owner_zalo_id, type, created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_library_folder ON media_library_items(folder_id)`);
            Logger_1.default.log('[LibraryService] ✅ Tables migrated');
        }
        catch (err) {
            Logger_1.default.warn(`[LibraryService] Migration error: ${err.message}`);
        }
    }
}
exports.default = LibraryService;
//# sourceMappingURL=LibraryService.js.map