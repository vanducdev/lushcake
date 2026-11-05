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
exports.registerLoginIpc = registerLoginIpc;
const axios_1 = __importDefault(require("axios"));
const electron_1 = require("electron");
const LoginService_1 = __importDefault(require("../../src/services/login/LoginService"));
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const ConnectionManager_1 = __importDefault(require("../../src/utils/ConnectionManager"));
const FacebookConnectionManager_1 = __importDefault(require("../../src/utils/FacebookConnectionManager"));
const EventBroadcaster_1 = __importDefault(require("../../src/services/event/EventBroadcaster"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const ZaloLoginHelper_1 = __importDefault(require("../../src/utils/ZaloLoginHelper"));
const TelegramUserListener = __importStar(require("../../src/services/telegram/TelegramUserListener"));
const TelegramBotChannelService = __importStar(require("../../src/services/telegram/TelegramBotChannelService"));
function postLoginSetup(_zaloId, _mainWindow, _name, _phone) {
    // No-op in open-source build.
}
function registerLoginIpc(mainWindow) {
    const loginService = new LoginService_1.default();
    // Giữ callback để không thay đổi contract nội bộ của helper, nhưng không làm gì thêm.
    ZaloLoginHelper_1.default.setQRSuccessCallback((zaloId, _isNewAccount) => {
        postLoginSetup(zaloId, mainWindow);
    });
    // ─── Đăng nhập QR ─────────────────────────────────────────────────────
    electron_1.ipcMain.handle('login:qr', async (_event, { tempId, proxyId }) => {
        try {
            console.log(`[loginIpc] Starting QR login for tempId: ${tempId}`);
            loginService.loginQR(tempId, proxyId ?? null).catch((err) => {
                console.error(`[loginIpc] QR login error: ${err.message}`);
            });
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Abort QR (khi user muốn refresh thủ công) ────────────────────────
    electron_1.ipcMain.handle('login:qr:abort', async (_event, { tempId }) => {
        try {
            const ZaloLoginHelper = require('../../src/utils/ZaloLoginHelper').default;
            ZaloLoginHelper.abortQR(tempId);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Đăng nhập bằng JSON auth (1 ô paste) ────────────────────────────
    // Format: { "imei": "...", "cookies": "...", "userAgent": "..." }
    electron_1.ipcMain.handle('login:auth', async (_event, { authJson, proxyId }) => {
        try {
            if (!authJson)
                return { success: false, error: 'Thiếu auth JSON' };
            let parsed;
            try {
                parsed = typeof authJson === 'string' ? JSON.parse(authJson) : authJson;
            }
            catch {
                return { success: false, error: 'Auth JSON không hợp lệ' };
            }
            const { imei, cookies, userAgent } = parsed;
            if (!imei || !cookies || !userAgent) {
                return { success: false, error: 'Auth JSON thiếu trường: imei, cookies, hoặc userAgent' };
            }
            Logger_1.default.log(`[loginIpc] Starting auth JSON login...`);
            const accountInfo = await loginService.loginCookies(imei, cookies, userAgent, proxyId ?? null);
            // Tìm zaloId từ ConnectionManager
            let zaloId = '';
            const cookiesB64 = Buffer.from(cookies).toString('base64');
            for (const [id, conn] of ConnectionManager_1.default.getAllConnections()) {
                if (conn.authKey === cookiesB64) {
                    zaloId = id;
                    break;
                }
            }
            if (zaloId) {
                const bizPkgId = accountInfo?.profile?.bizPkg?.pkgId ?? accountInfo?.bizPkg?.pkgId ?? 0;
                const fullName = accountInfo?.profile?.displayName || accountInfo?.name || '';
                const phoneNum = accountInfo?.profile?.phoneNumber || accountInfo?.phoneNumber || '';
                DatabaseService_1.default.getInstance().saveAccount({
                    zalo_id: zaloId,
                    full_name: fullName,
                    avatar_url: accountInfo?.profile?.avatar || accountInfo?.avatar || '',
                    phone: phoneNum,
                    is_business: bizPkgId > 0 ? 1 : 0,
                    imei,
                    user_agent: userAgent,
                    cookies,
                    is_active: 1,
                    created_at: new Date().toISOString(),
                });
                // Gắn proxy nếu có
                if (proxyId) {
                    DatabaseService_1.default.getInstance().setAccountProxy(zaloId, proxyId);
                }
                DatabaseService_1.default.getInstance().setListenerActive(zaloId, true);
                postLoginSetup(zaloId, mainWindow, fullName, phoneNum);
            }
            return { success: true, accountInfo, zaloId };
        }
        catch (error) {
            Logger_1.default.error(`[loginIpc] auth JSON login error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    // ─── Đăng nhập Cookies/IMEI (legacy - 3 ô) ───────────────────────────
    electron_1.ipcMain.handle('login:cookies', async (_event, { imei, cookies, userAgent }) => {
        try {
            if (!imei || !cookies || !userAgent) {
                return { success: false, error: 'Thiếu thông tin đăng nhập (imei, cookies, userAgent)' };
            }
            Logger_1.default.log(`[loginIpc] Starting cookies login...`);
            const accountInfo = await loginService.loginCookies(imei, cookies, userAgent);
            const connection = ConnectionManager_1.default.getAllConnections();
            let zaloId = '';
            for (const [id, conn] of connection) {
                const authKey = Buffer.from(cookies).toString('base64');
                if (conn.authKey === authKey) {
                    zaloId = id;
                    break;
                }
            }
            if (zaloId) {
                const bizPkgId2 = accountInfo?.profile?.bizPkg?.pkgId ?? accountInfo?.bizPkg?.pkgId ?? 0;
                const fullName2 = accountInfo?.profile?.displayName || accountInfo?.name || '';
                const phoneNum2 = accountInfo?.profile?.phoneNumber || accountInfo?.phoneNumber || '';
                DatabaseService_1.default.getInstance().saveAccount({
                    zalo_id: zaloId,
                    full_name: fullName2,
                    avatar_url: accountInfo?.profile?.avatar || accountInfo?.avatar || '',
                    phone: phoneNum2,
                    is_business: bizPkgId2 > 0 ? 1 : 0,
                    imei,
                    user_agent: userAgent,
                    cookies,
                    is_active: 1,
                    created_at: new Date().toISOString(),
                });
                DatabaseService_1.default.getInstance().setListenerActive(zaloId, true);
                postLoginSetup(zaloId, mainWindow, fullName2, phoneNum2);
            }
            return { success: true, accountInfo, zaloId };
        }
        catch (error) {
            Logger_1.default.error(`[loginIpc] Cookies login error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    // ─── Kết nối lại tài khoản (reconnect) ───────────────────────────────
    electron_1.ipcMain.handle('login:connect', async (_event, { auth }) => {
        // Tìm zaloId từ cookies để có thể mark listener_active khi thất bại
        let zaloId = '';
        try {
            const cookiesB64 = Buffer.from(auth?.cookies || '').toString('base64');
            for (const [id, conn] of ConnectionManager_1.default.getAllConnections()) {
                if (conn.authKey === cookiesB64) {
                    zaloId = id;
                    break;
                }
            }
            // Nếu chưa có trong ConnectionManager, thử lấy từ DB
            if (!zaloId && auth?.cookies) {
                const accounts = DatabaseService_1.default.getInstance().getAccounts();
                const match = accounts.find((a) => a.cookies === auth.cookies);
                if (match)
                    zaloId = match.zalo_id;
            }
        }
        catch { }
        try {
            const success = await loginService.connectUser(auth);
            if (!success && zaloId) {
                DatabaseService_1.default.getInstance().setListenerActive(zaloId, false);
                EventBroadcaster_1.default.broadcastListenerDead(zaloId, 'connect_failed');
            }
            return { success };
        }
        catch (error) {
            Logger_1.default.error(`[loginIpc] connect error: ${error.message}`);
            if (zaloId) {
                DatabaseService_1.default.getInstance().setListenerActive(zaloId, false);
                EventBroadcaster_1.default.broadcastListenerDead(zaloId, 'connect_error');
            }
            return { success: false, error: error.message };
        }
    });
    // ─── Ngắt kết nối tài khoản ───────────────────────────────────────────
    electron_1.ipcMain.handle('login:disconnect', async (_event, { zaloId }) => {
        try {
            const account = DatabaseService_1.default.getInstance().getAccounts().find((item) => item.zalo_id === zaloId);
            if (account?.channel === 'telegram_user') {
                TelegramUserListener.stopListener(zaloId);
            }
            else {
                await loginService.disconnectUser(zaloId);
            }
            return { success: true };
        }
        catch (error) {
            Logger_1.default.error(`[loginIpc] disconnect error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    // ─── Ngắt kết nối tất cả ─────────────────────────────────────────────
    electron_1.ipcMain.handle('login:disconnectAll', async () => {
        try {
            const connections = ConnectionManager_1.default.getAllConnections();
            for (const zaloId of connections.keys()) {
                await loginService.disconnectUser(zaloId);
            }
            TelegramUserListener.stopAllListeners();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Lấy danh sách tài khoản đã lưu ──────────────────────────────────
    electron_1.ipcMain.handle('login:getAccounts', async () => {
        try {
            const accounts = DatabaseService_1.default.getInstance().getAccounts();
            // Build FB account lookup (fbId → uuid) for connection status checks
            let fbIdToUuid = {};
            try {
                const fbAccounts = DatabaseService_1.default.getInstance().getFBAccounts();
                for (const fb of fbAccounts) {
                    if (fb.facebook_id && fb.id)
                        fbIdToUuid[fb.facebook_id] = fb.id;
                }
            }
            catch { }
            // Thêm trạng thái online/offline
            const accountsWithStatus = accounts.map((acc) => {
                const isFB = acc.channel === 'facebook';
                const isTelegramUser = acc.channel === 'telegram_user';
                const isTelegramBot = acc.channel === 'telegram_bot';
                // For FB: zalo_id = fbId, need UUID for connection manager lookup
                const fbUuid = isFB ? fbIdToUuid[acc.zalo_id] : undefined;
                const isTelegramConnected = isTelegramUser && TelegramUserListener.isConnected(acc.zalo_id);
                const isBotConnected = isTelegramBot && TelegramBotChannelService.isBotPolling(acc.zalo_id);
                return {
                    ...acc,
                    proxy_id: acc.proxy_id ?? null,
                    listenerActive: !!acc.listener_active,
                    isOnline: isFB
                        ? !!(fbUuid && FacebookConnectionManager_1.default.get(fbUuid)?.isConnected())
                        : isTelegramUser
                            ? isTelegramConnected
                            : isTelegramBot
                                ? isBotConnected
                                : ConnectionManager_1.default.isConnected(acc.zalo_id),
                    isConnected: isFB
                        ? !!(fbUuid && FacebookConnectionManager_1.default.get(fbUuid)?.isConnected())
                        : isTelegramUser
                            ? isTelegramConnected
                            : isTelegramBot
                                ? isBotConnected
                                : ConnectionManager_1.default.getConnection(acc.zalo_id) !== undefined,
                    // For FB accounts, zalo_id IS the facebook_id now - expose for display
                    ...(isFB ? { facebook_id: acc.zalo_id } : {}),
                };
            });
            return { success: true, accounts: accountsWithStatus };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Xoá tài khoản (có tuỳ chọn xoá hết dữ liệu) ─────────────────────────
    electron_1.ipcMain.handle('login:removeAccount', async (_event, { zaloId, deleteData }) => {
        try {
            // Check nếu là Facebook account → cleanup qua FacebookConnectionManager
            const accounts = DatabaseService_1.default.getInstance().getAccounts();
            const account = accounts.find((a) => a.zalo_id === zaloId);
            const isFB = account?.channel === 'facebook';
            const isTelegramUser = account?.channel === 'telegram_user';
            if (isFB) {
                // Facebook cleanup: tìm fb_account UUID → disconnect + xóa cookie
                const fbAcc = DatabaseService_1.default.getInstance().getFBAccountByFacebookId(zaloId);
                if (fbAcc?.id) {
                    const FacebookConnectionManager = require('../../src/utils/FacebookConnectionManager').default;
                    await FacebookConnectionManager.disconnect(fbAcc.id).catch(() => { });
                    const { secureDelete } = require('../../src/services/secure/SecureSettingsService');
                    secureDelete(`fb_cookie_${fbAcc.id}`);
                    // Không gọi deleteFBAccount ở đây - deleteAccountData sẽ xử lý FB tables
                }
            }
            else if (isTelegramUser) {
                // MTProto is independent from ConnectionManager. Stop the
                // live GramJS client before removing its local session.
                TelegramUserListener.stopListener(zaloId);
            }
            else {
                // Zalo cleanup
                const ZaloLoginHelper = require('../../src/utils/ZaloLoginHelper').default;
                ZaloLoginHelper.markRemoved(zaloId);
                if (ConnectionManager_1.default.getConnection(zaloId)) {
                    await loginService.disconnectUser(zaloId);
                }
            }
            if (deleteData) {
                // Xoá toàn bộ dữ liệu DB + media
                DatabaseService_1.default.getInstance().deleteAccountData(zaloId);
                const FileStorageService = require('../../src/services/file/FileStorageService').default;
                FileStorageService.deleteAccountMedia(zaloId);
            }
            else {
                // Legacy: chỉ mark inactive
                DatabaseService_1.default.getInstance().deleteAccount(zaloId);
            }
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Lấy cấu hình auto-delete media cho tài khoản ──────────────────────
    electron_1.ipcMain.handle('login:getMediaAutoDelete', async (_event, { zaloId }) => {
        try {
            const config = DatabaseService_1.default.getInstance().getMediaAutoDeleteConfig(zaloId);
            return { success: true, config };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Lưu cấu hình auto-delete media + chạy cleanup ngay ───────────────
    electron_1.ipcMain.handle('login:setMediaAutoDelete', async (_event, { zaloId, enabled, days }) => {
        try {
            const config = { enabled, days: Math.max(1, days) };
            DatabaseService_1.default.getInstance().setMediaAutoDeleteConfig(zaloId, config);
            // Nếu enabled, chạy cleanup ngay lập tức
            if (enabled) {
                const FileStorageService = require('../../src/services/file/FileStorageService').default;
                const deleted = FileStorageService.cleanupOldMedia(zaloId, days);
                return { success: true, config, cleanedDirs: deleted, message: `Đã xoá ${deleted} thư mục media cũ. Cấu hình sẽ tự động chạy hàng ngày.` };
            }
            return { success: true, config };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Chạy cleanup media cho tất cả tài khoản (gọi từ scheduler) ────────
    electron_1.ipcMain.handle('login:runAllMediaCleanup', async () => {
        try {
            const DatabaseService = require('../../src/services/database/DatabaseService').default;
            const FileStorageService = require('../../src/services/file/FileStorageService').default;
            const db = DatabaseService.getInstance();
            const accounts = db.getAccounts();
            const results = [];
            for (const acc of accounts) {
                const config = db.getMediaAutoDeleteConfig(acc.zalo_id);
                if (config?.enabled && config.days > 0) {
                    const cleaned = FileStorageService.cleanupOldMedia(acc.zalo_id, config.days);
                    results.push({ zaloId: acc.zalo_id, cleaned, config });
                }
            }
            Logger_1.default.log(`[MediaCleanup] Ran cleanup for ${results.length} accounts`);
            return { success: true, results };
        }
        catch (error) {
            Logger_1.default.error(`[MediaCleanup] Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    // ─── Kiểm tra sức khỏe listener (WebSocket readyState) ──────────────
    // Gọi từ client mỗi 1 phút (heartbeat) hoặc sau khi reconnect mạng
    // Hỗ trợ batch: zaloIds có thể là string hoặc string[]
    electron_1.ipcMain.handle('login:checkHealth', async (_event, { zaloIds }) => {
        try {
            const ids = Array.isArray(zaloIds) ? zaloIds : [zaloIds];
            const results = ConnectionManager_1.default.checkListenerHealth(ids);
            return { success: true, results };
        }
        catch (error) {
            Logger_1.default.error(`[loginIpc] checkHealth error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
    // ─── Khởi động lại tất cả tài khoản đã lưu ───────────────────────────
    electron_1.ipcMain.handle('login:reconnectAll', async () => {
        try {
            const accounts = DatabaseService_1.default.getInstance().getAccounts();
            const results = [];
            for (const acc of accounts) {
                // Only reconnect Zalo accounts — Telegram/FB have their own reconnect
                const ch = acc.channel || 'zalo';
                if (ch !== 'zalo')
                    continue;
                try {
                    const auth = {
                        imei: acc.imei,
                        cookies: acc.cookies,
                        userAgent: acc.user_agent,
                        proxyId: acc.proxy_id ?? null,
                    };
                    await loginService.connectUser(auth);
                    results.push({ zaloId: acc.zalo_id, success: true });
                }
                catch (err) {
                    results.push({ zaloId: acc.zalo_id, success: false, error: err.message });
                }
            }
            return { success: true, results };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ─── Check + refresh avatar cho tài khoản Zalo ───────────────────────
    // Kiểm tra avatar URL còn hạn không (HTTP HEAD). Nếu lỗi (403/etc) thì
    // gọi Zalo API fetchAccountInfo() để lấy URL mới + cập nhật DB.
    electron_1.ipcMain.handle('login:checkAndRefreshAvatar', async (_event, { zaloId }) => {
        try {
            if (!zaloId)
                return { success: false, refreshed: false, error: 'Missing zaloId' };
            const conn = ConnectionManager_1.default.getConnection(zaloId);
            if (!conn || !conn.connected) {
                return { success: false, refreshed: false, reason: 'not_connected' };
            }
            // Đọc account từ DB để lấy avatar_url hiện tại
            const accounts = DatabaseService_1.default.getInstance().getAccounts();
            const account = accounts.find((a) => a.zalo_id === zaloId);
            if (!account)
                return { success: false, refreshed: false, error: 'Account not found' };
            const currentAvatarUrl = account.avatar_url || '';
            // Kiểm tra URL hiện tại nếu có
            if (currentAvatarUrl) {
                try {
                    const headResp = await axios_1.default.head(currentAvatarUrl, {
                        timeout: 5000,
                        validateStatus: () => true,
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                    });
                    if (headResp.status === 200) {
                        Logger_1.default.log(`[AvatarCheck] ${zaloId}: avatar URL still valid (${currentAvatarUrl.substring(0, 60)}...)`);
                        return { success: true, refreshed: false };
                    }
                    Logger_1.default.log(`[AvatarCheck] ${zaloId}: avatar URL returned status ${headResp.status}, refreshing...`);
                }
                catch (headErr) {
                    Logger_1.default.log(`[AvatarCheck] ${zaloId}: avatar HEAD request failed (${headErr.message}), refreshing...`);
                }
            }
            else {
                Logger_1.default.log(`[AvatarCheck] ${zaloId}: no avatar URL on file, fetching...`);
            }
            // URL expired hoặc không có → gọi Zalo API để refresh
            const accountInfo = await conn.api.fetchAccountInfo();
            const newAvatar = accountInfo?.profile?.avatar || accountInfo?.avatar || '';
            const newName = accountInfo?.profile?.displayName || accountInfo?.displayName || '';
            if (newAvatar && newAvatar !== currentAvatarUrl) {
                // Update DB với avatar + name mới
                const phone = accountInfo?.profile?.phoneNumber || accountInfo?.phoneNumber || '';
                const bizPkgId = accountInfo?.profile?.bizPkg?.pkgId ?? accountInfo?.bizPkg?.pkgId ?? 0;
                const isBusiness = bizPkgId > 0 ? 1 : 0;
                DatabaseService_1.default.getInstance().updateAccountInfo(zaloId, phone, isBusiness, newAvatar, newName || undefined);
                Logger_1.default.log(`[AvatarCheck] ${zaloId}: refreshed avatar: ${newAvatar.substring(0, 60)}...${newName ? ', name: ' + newName : ''}`);
                return { success: true, refreshed: true, avatar_url: newAvatar, full_name: newName || undefined };
            }
            if (newAvatar && newAvatar === currentAvatarUrl) {
                // URL giống nhau nhưng bây giờ vẫn valid → chỉ update timestamp
                Logger_1.default.log(`[AvatarCheck] ${zaloId}: avatar unchanged, still valid`);
                return { success: true, refreshed: false };
            }
            // fetchAccountInfo trả về avatar rỗng
            Logger_1.default.warn(`[AvatarCheck] ${zaloId}: fetchAccountInfo returned empty avatar`);
            return { success: true, refreshed: false, reason: 'empty_avatar_response' };
        }
        catch (error) {
            Logger_1.default.error(`[AvatarCheck] ${zaloId}: error: ${error.message}`);
            return { success: false, refreshed: false, error: error.message };
        }
    });
    // ─── Tải tin nhắn cũ của phiên đăng nhập (requestOldMessages) ────────
    // Gọi listener.requestOldMessages cho cả User và Group threads
    electron_1.ipcMain.handle('login:requestOldMessages', async (_event, { zaloId }) => {
        try {
            const conn = ConnectionManager_1.default.getConnection(zaloId);
            if (!conn || !conn.connected) {
                return { success: false, error: 'Tài khoản không online' };
            }
            const { ThreadType } = await Promise.resolve().then(() => __importStar(require('zca-js')));
            conn.api.listener.requestOldMessages(ThreadType.User, null);
            conn.api.listener.requestOldMessages(ThreadType.Group, null);
            Logger_1.default.log(`[loginIpc] requestOldMessages triggered for ${zaloId}`);
            return { success: true };
        }
        catch (error) {
            Logger_1.default.error(`[loginIpc] requestOldMessages error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
}
//# sourceMappingURL=loginIpc.js.map