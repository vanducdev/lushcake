"use strict";
/**
 * libraryIpc - IPC handlers cho thư viện Media (boss side).
 * Boss dùng IPC trực tiếp, employee dùng REST API.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLibraryIpc = registerLibraryIpc;
const electron_1 = require("electron");
const LibraryService_1 = __importDefault(require("../../src/services/library/LibraryService"));
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const WorkspaceManager_1 = __importDefault(require("../../src/utils/WorkspaceManager"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const lib = () => LibraryService_1.default.getInstance();
function isEmployeeMode() {
    try {
        const activeWs = WorkspaceManager_1.default.getInstance().getActiveWorkspace();
        if (activeWs?.type === 'remote')
            return true;
    }
    catch { }
    return false;
}
function registerLibraryIpc() {
    // ── Get items ──────────────────────────────────────────────
    electron_1.ipcMain.handle('library:getItems', async (_event, params) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            const result = lib().getItems({
                zaloId: params.zaloId,
                ownerZaloIds: params.ownerZaloIds,
                type: params.type,
                search: params.search,
                folderId: params.folderId !== undefined ? params.folderId : undefined,
                page: params.page || 1,
                limit: Math.min(params.limit || 50, 200),
            });
            return {
                success: true,
                items: result.items.map((item) => ({
                    ...item,
                    file_path: undefined,
                    thumb_path: undefined,
                    fileUrl: `/api/library/file/${item.uuid}`,
                    thumbUrl: item.thumb_path ? `http://localhost:9900/api/library/thumb/${item.uuid}` : null,
                    _localPath: item.file_path,
                    _thumbLocalPath: item.thumb_path,
                })),
                total: result.total,
            };
        }
        catch (err) {
            return { success: false, error: err.message, items: [], total: 0 };
        }
    });
    // ── Upload ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('library:upload', async (_event, params) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            const buffer = Buffer.from(params.base64, 'base64');
            const item = await lib().upload({
                zaloId: params.zaloId,
                buffer,
                fileName: params.fileName,
                mimeType: params.mimeType,
                employeeId: params.employeeId || '',
                tags: params.tags || '',
                folderId: params.folderId ?? null,
            });
            return {
                success: true,
                data: {
                    ...item,
                    file_path: undefined,
                    thumb_path: undefined,
                    fileUrl: `/api/library/file/${item.uuid}`,
                    thumbUrl: item.thumb_path ? `/api/library/thumb/${item.uuid}` : null,
                    _localPath: item.file_path,
                    _thumbLocalPath: item.thumb_path,
                },
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Delete ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('library:deleteItem', async (_event, uuid) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            lib().deleteItem(uuid);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Get folders ────────────────────────────────────────────
    electron_1.ipcMain.handle('library:getFolders', async (_event, params) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            const folders = lib().getFolders(params.zaloId, params.type, params.ownerZaloIds);
            return { success: true, items: folders };
        }
        catch (err) {
            return { success: false, error: err.message, items: [] };
        }
    });
    // ── Create folder ──────────────────────────────────────────
    electron_1.ipcMain.handle('library:createFolder', async (_event, params) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            const id = lib().createFolder(params);
            return { success: true, id };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Rename folder ──────────────────────────────────────────
    electron_1.ipcMain.handle('library:renameFolder', async (_event, params) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            const db = DatabaseService_1.default.getInstance();
            db.run('UPDATE media_library_folders SET name=? WHERE id=?', [params.name, params.id]);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Delete folder ──────────────────────────────────────────
    electron_1.ipcMain.handle('library:deleteFolder', async (_event, id) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            lib().deleteFolder(id);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Update item (favorite, rename, tags, etc.) ─────────────
    electron_1.ipcMain.handle('library:updateItem', async (_event, params) => {
        try {
            if (isEmployeeMode())
                return { success: true };
            Logger_1.default.log(`[libraryIpc] updateItem: uuid=${params.uuid}, keys=${Object.keys(params).join(',')}, name=${params.name}, isFavorite=${params.isFavorite}`);
            const result = lib().updateItem(params.uuid, params);
            Logger_1.default.log(`[libraryIpc] updateItem result: ${result}`);
            return { success: result };
        }
        catch (err) {
            Logger_1.default.error(`[libraryIpc] updateItem error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    Logger_1.default.log('[libraryIpc] Registered');
}
//# sourceMappingURL=libraryIpc.js.map