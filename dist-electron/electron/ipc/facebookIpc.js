"use strict";
/**
 * facebookIpc.ts
 * IPC handlers cho tất cả Facebook operations
 * Pattern: ipcMain.handle('fb:channel', async (_event, params) => { ... })
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setFBMainWindow = setFBMainWindow;
exports.registerFacebookIpc = registerFacebookIpc;
exports.reconnectAllFBAccounts = reconnectAllFBAccounts;
const electron_1 = require("electron");
const uuid_1 = require("uuid");
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const FacebookConnectionManager_1 = __importDefault(require("../../src/utils/FacebookConnectionManager"));
const FacebookSession_1 = require("../../src/services/facebook/FacebookSession");
const FacebookLoginHelper_1 = require("../../src/services/facebook/FacebookLoginHelper");
const SecureSettingsService_1 = require("../../src/services/secure/SecureSettingsService");
const FacebookE2EEBridge_1 = __importDefault(require("../../src/services/facebook/FacebookE2EEBridge"));
const ProxyHelper_1 = require("../../src/utils/ProxyHelper");
const FacebookUtils_1 = require("../../src/services/facebook/FacebookUtils");
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
// ─── Cookie secure storage helpers ───────────────────────────────────────────
function fbCookieKey(accountId) {
    return `fb_cookie_${accountId}`;
}
// A login wizard owns a short-lived, separate bridge process. It is never
// shared with a connected Facebook account and is destroyed on completion,
// cancel, or expiry.
const nativeLoginSessions = new Map();
const NATIVE_LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;
async function disposeNativeLoginSession(sessionId) {
    const session = nativeLoginSessions.get(sessionId);
    if (!session)
        return;
    nativeLoginSessions.delete(sessionId);
    clearTimeout(session.expiryTimer);
    try {
        await session.bridge.cancelNativeLogin();
    }
    catch { }
    await session.bridge.close().catch(() => { });
}
function serializeNativeCookies(cookies) {
    if (!cookies)
        return '';
    return Object.entries(cookies)
        .filter(([name, value]) => name && typeof value === 'string' && value.length > 0)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}
function validateNativeLoginInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return null;
    const entries = Object.entries(input);
    if (entries.length > 8)
        return null;
    const result = {};
    for (const [key, value] of entries) {
        if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(key) || typeof value !== 'string' || value.length > 4096)
            return null;
        result[key] = value;
    }
    return result;
}
/**
 * Resolve accountId: nếu là Facebook UID (all digits) → tìm UUID từ fb_accounts.
 * Nếu đã là UUID → trả về nguyên. Dùng cho tất cả handlers nhận accountId từ UI.
 */
function resolveInternalId(accountId) {
    // Nếu trông giống Facebook UID (all digits) → lookup UUID
    if (/^\d+$/.test(accountId)) {
        const fbAcc = DatabaseService_1.default.getInstance().getFBAccountByFacebookId(accountId);
        if (fbAcc?.id)
            return fbAcc.id;
    }
    return accountId;
}
/**
 * Luôn resolve numeric Facebook ID - dùng làm tên thư mục lưu media.
 * Không fallback về internal UUID: nếu service null hoặc chưa init,
 * tra DB để lấy facebook_id thật.
 */
function resolveRealFacebookId(internalId, service) {
    const fbId = service?.getRealFacebookId();
    if (fbId)
        return fbId;
    const fbAcc = DatabaseService_1.default.getInstance().getFBAccount(internalId);
    return fbAcc?.facebook_id || internalId;
}
/** Open-source build: giữ hàm để không vỡ import ở main process. */
function setFBMainWindow(_win) { }
/**
 * Lấy FacebookService từ ConnectionManager, tự động reconnect nếu chưa có.
 * Tất cả handlers gọi hàm này thay vì FacebookConnectionManager.get() trực tiếp.
 * Tránh lỗi "Account not connected" khi mạng drop rồi online lại nhưng
 * ConnectionManager chưa kịp đồng bộ.
 */
async function getFBServiceOrReconnect(internalId) {
    let service = FacebookConnectionManager_1.default.get(internalId);
    if (service)
        return service;
    Logger_1.default.warn(`[facebookIpc] Service ${internalId} not in ConnectionManager - attempting auto-reconnect...`);
    const account = DatabaseService_1.default.getInstance().getFBAccount(internalId);
    if (!account)
        return null;
    const cookie = (0, SecureSettingsService_1.secureGet)(fbCookieKey(internalId)) || account.cookie_encrypted;
    if (!cookie)
        return null;
    let proxyId;
    try {
        const accRow = DatabaseService_1.default.getInstance().queryOne('SELECT proxy_id FROM accounts WHERE zalo_id = ?', [account.facebook_id || internalId]);
        proxyId = accRow?.proxy_id ?? null;
    }
    catch {
        proxyId = null;
    }
    try {
        service = await FacebookConnectionManager_1.default.getOrCreate(internalId, cookie, proxyId);
        Logger_1.default.log(`[facebookIpc] Auto-reconnect success for ${internalId}`);
        return service;
    }
    catch (err) {
        Logger_1.default.warn(`[facebookIpc] Auto-reconnect failed for ${internalId}: ${err.message}`);
        return null;
    }
}
/**
 * Connect one account through the same path for the dashboard and automatic
 * startup. Do not add a separate cookie-health preflight here: creating a
 * FacebookService already validates the cookie with the account proxy, and a
 * duplicate homepage request used to leave startup waiting for up to a minute
 * before the MQTT/E2EE listeners were even created.
 */
async function connectFacebookAccount(internalId, source) {
    const db = DatabaseService_1.default.getInstance();
    const account = db.getFBAccount(internalId);
    if (!account)
        throw new Error('Account not found');
    const cookie = (0, SecureSettingsService_1.secureGet)(fbCookieKey(internalId)) || account.cookie_encrypted;
    if (!cookie)
        throw new Error('No cookie found for this account');
    let proxyId;
    try {
        const accRow = db.queryOne('SELECT proxy_id FROM accounts WHERE zalo_id = ?', [account.facebook_id || internalId]);
        proxyId = accRow?.proxy_id ?? null;
    }
    catch {
        proxyId = null;
    }
    Logger_1.default.log(`[facebookIpc] ${source} ${internalId}: starting Facebook session`);
    const service = await FacebookConnectionManager_1.default.getOrCreate(internalId, cookie, proxyId);
    // FacebookService.connect() starts MQTT asynchronously. Waiting here is what
    // makes automatic reconnect equivalent to dashboard reconnect, instead of
    // logging success while the socket is still dead.
    const ready = await service.ensureConnected();
    const listenerConnected = service.isListenerActuallyConnected();
    const e2eeConnected = service.isE2EEConnected();
    if (!ready) {
        throw new Error('Facebook listener chưa sẵn sàng sau khi kết nối. Hệ thống sẽ tự thử lại.');
    }
    service.resetListenerRetryCount?.();
    db.setListenerActive(account.facebook_id || internalId, true);
    Logger_1.default.log(`[facebookIpc] ${source} ${internalId}: ready ` +
        `(mqtt=${listenerConnected}, e2ee=${e2eeConnected})`);
    return { service, listenerConnected, e2eeConnected };
}
const FB_STARTUP_RETRY_DELAYS_MS = [15000, 60000, 180000];
const fbStartupRetryTimers = new Map();
function clearFacebookStartupRetry(accountId) {
    const timer = fbStartupRetryTimers.get(accountId);
    if (timer)
        clearTimeout(timer);
    fbStartupRetryTimers.delete(accountId);
}
function scheduleFacebookStartupRetry(accountId, failedAttempt) {
    if (failedAttempt >= FB_STARTUP_RETRY_DELAYS_MS.length || fbStartupRetryTimers.has(accountId))
        return;
    const delay = FB_STARTUP_RETRY_DELAYS_MS[failedAttempt];
    Logger_1.default.warn(`[facebookIpc] startup ${accountId}: retrying in ${Math.round(delay / 1000)}s ` +
        `(attempt ${failedAttempt + 2}/${FB_STARTUP_RETRY_DELAYS_MS.length + 1})`);
    const timer = setTimeout(() => {
        fbStartupRetryTimers.delete(accountId);
        connectFacebookAccount(accountId, 'startup-retry')
            .then(() => clearFacebookStartupRetry(accountId))
            .catch((err) => {
            Logger_1.default.warn(`[facebookIpc] startup retry ${accountId}: ${err?.message || err}`);
            scheduleFacebookStartupRetry(accountId, failedAttempt + 1);
        });
    }, delay);
    timer.unref?.();
    fbStartupRetryTimers.set(accountId, timer);
}
// ─── Handlers ────────────────────────────────────────────────────────────────
function registerFacebookIpc() {
    /**
     * Shared helper: verify cookie, save account to DB, connect.
     * Dùng chung cho cả cookie-based và credentials-based login.
     */
    async function _addFBAccountCommon(cookie, proxyId) {
        // Resolve proxy agent để dùng cho initSession
        let httpsAgent = undefined;
        if (proxyId) {
            try {
                const proxy = DatabaseService_1.default.getInstance().getProxyById(proxyId);
                if (proxy) {
                    const { createProxyAgent } = require('../../src/utils/ProxyHelper');
                    httpsAgent = createProxyAgent(proxy);
                }
            }
            catch { }
        }
        // 1. Verify cookie alive + init session (with proxy)
        const sessionData = await (0, FacebookSession_1.initSession)(cookie, httpsAgent);
        const fbId = sessionData.FacebookID;
        if (!fbId || fbId === '0' || fbId.includes('Unable') || !fbId.match(/^\d+$/)) {
            return { success: false, error: 'Cookie không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại Facebook và copy cookie mới.' };
        }
        // 2. Nếu account đã tồn tại (trong fb_accounts), xoá record cũ để thêm lại
        const existing = DatabaseService_1.default.getInstance().getFBAccounts()
            .find((a) => a.facebook_id === fbId);
        if (existing) {
            Logger_1.default.log(`[facebookIpc] _addFBAccountCommon - account ${fbId} đã tồn tại, xoá cũ và thêm lại`);
            await FacebookConnectionManager_1.default.disconnect(existing.id).catch(() => { });
            (0, SecureSettingsService_1.secureDelete)(fbCookieKey(existing.id));
            DatabaseService_1.default.getInstance().deleteFBAccount(existing.id);
            DatabaseService_1.default.getInstance().deleteAccount(fbId);
        }
        // 3. Lấy tên + avatar
        let name = fbId;
        let avatarUrl = '';
        try {
            const html = await (0, FacebookSession_1.fetchFBHomepage)(cookie);
            const profile = await (0, FacebookSession_1.fetchBasicProfileFromHome)(html);
            name = profile.name || fbId;
            avatarUrl = profile.avatarUrl || '';
        }
        catch { }
        // 4. Lưu vào DB (cookie mã hóa)
        const accountId = (0, uuid_1.v4)();
        (0, SecureSettingsService_1.secureSet)(fbCookieKey(accountId), cookie);
        DatabaseService_1.default.getInstance().saveFBAccount({
            id: accountId,
            facebook_id: fbId,
            name,
            avatar_url: avatarUrl,
            cookie_encrypted: cookie,
            session_data: JSON.stringify(sessionData),
            status: 'disconnected',
        });
        // Also sync to unified accounts table - use fbId as zalo_id (for license matching)
        DatabaseService_1.default.getInstance()['run'](`INSERT INTO accounts (zalo_id, full_name, avatar_url, phone, is_business, imei, user_agent, cookies, is_active, channel, proxy_id, created_at)
       VALUES (?, ?, ?, '', 0, '', '', '', 1, 'facebook', ?, datetime('now'))
       ON CONFLICT(zalo_id) DO UPDATE SET
         full_name = excluded.full_name, avatar_url = excluded.avatar_url,
         channel = 'facebook', is_active = 1, proxy_id = excluded.proxy_id`, [fbId, name, avatarUrl, proxyId ?? null]);
        // 5. Connect (with proxy) - getOrCreate đã tự động connect
        await FacebookConnectionManager_1.default.getOrCreate(accountId, cookie, proxyId);
        const account = DatabaseService_1.default.getInstance().getFBAccount(accountId);
        return { success: true, account, facebookId: fbId, name };
    }
    /**
     * Thêm tài khoản Facebook bằng cookie
     */
    electron_1.ipcMain.handle('fb:addAccount', async (_event, { cookie, proxyId }) => {
        try {
            return await _addFBAccountCommon(cookie, proxyId);
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:addAccount error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    /**
     * Thêm tài khoản Facebook bằng username/password (+ 2FA optional)
     * Gọi loginWithCredentials → lấy cookie → tạo account qua _addFBAccountCommon
     */
    electron_1.ipcMain.handle('fb:addAccountWithCredentials', async (_event, params) => {
        try {
            // Resolve proxy agent cho loginWithCredentials
            let httpsAgent = undefined;
            if (params.proxyId) {
                try {
                    const proxy = DatabaseService_1.default.getInstance().getProxyById(params.proxyId);
                    if (proxy) {
                        const { createProxyAgent } = require('../../src/utils/ProxyHelper');
                        httpsAgent = createProxyAgent(proxy);
                    }
                }
                catch { }
            }
            // 1. Đăng nhập lấy cookie
            const loginResult = await (0, FacebookLoginHelper_1.loginWithCredentials)(params.username, params.password, params.twoFASecret, httpsAgent);
            // 2FA challenge - yêu cầu UI cung cấp twoFASecret
            if (loginResult.error?.error_subcode === 1348162) {
                return {
                    success: false,
                    need2FA: true,
                    error: loginResult.error.description || 'Tài khoản yêu cầu xác thực 2 yếu tố (2FA). Vui lòng nhập mã bí mật 2FA.',
                    errorTitle: loginResult.error.title,
                };
            }
            // Lỗi đăng nhập khác (sai mật khẩu, checkpoint, ...)
            if (!loginResult.success) {
                Logger_1.default.warn(`[facebookIpc] loginWithCredentials failed:`, JSON.stringify(loginResult.error));
                return {
                    success: false,
                    error: loginResult.error?.description || loginResult.error?.title || 'Đăng nhập thất bại',
                    errorTitle: loginResult.error?.title,
                };
            }
            // 2. Thành công - tạo account với cookie vừa lấy được
            const cookie = loginResult.success.setCookies;
            if (!cookie) {
                return { success: false, error: 'Đăng nhập thành công nhưng không lấy được cookie.' };
            }
            return await _addFBAccountCommon(cookie, params.proxyId);
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:addAccountWithCredentials error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    /**
     * Experimental fbchat-v2 Messenger Lite login. Unlike the legacy FB4A
     * endpoint, this returns an explicit step-by-step challenge from upstream.
     * Secrets are passed through IPC but deliberately never written to logs.
     */
    electron_1.ipcMain.handle('fb:startMessengerLiteLogin', async (_event, { proxyId }) => {
        let bridge = null;
        try {
            const binaryPath = (0, FacebookUtils_1.resolveE2EEBinaryPath)();
            bridge = FacebookE2EEBridge_1.default.create(binaryPath);
            bridge.spawn();
            await bridge.hello(10000);
            let proxyUrl;
            if (proxyId) {
                const proxy = DatabaseService_1.default.getInstance().getProxyById(proxyId);
                if (!proxy)
                    return { success: false, error: 'Proxy đã chọn không tồn tại.' };
                proxyUrl = (0, ProxyHelper_1.buildProxyUrl)(proxy);
            }
            const result = await bridge.startNativeLogin(proxyUrl);
            if (result.complete) {
                const cookie = serializeNativeCookies(result.cookies);
                await bridge.close();
                bridge = null;
                if (!cookie)
                    return { success: false, error: 'Đăng nhập hoàn tất nhưng không nhận được cookie phiên.' };
                return await _addFBAccountCommon(cookie, proxyId);
            }
            const sessionId = (0, uuid_1.v4)();
            const expiryTimer = setTimeout(() => { void disposeNativeLoginSession(sessionId); }, NATIVE_LOGIN_SESSION_TTL_MS);
            expiryTimer.unref?.();
            nativeLoginSessions.set(sessionId, { bridge, expiryTimer });
            bridge = null;
            return { success: true, sessionId, step: result.step };
        }
        catch (err) {
            Logger_1.default.warn(`[facebookIpc] Messenger Lite login could not start: ${err.message}`);
            return { success: false, error: err.message || 'Không thể khởi tạo đăng nhập Messenger Lite.' };
        }
        finally {
            if (bridge)
                await bridge.close().catch(() => { });
        }
    });
    electron_1.ipcMain.handle('fb:submitMessengerLiteLogin', async (_event, params) => {
        const sessionId = String(params?.sessionId || '');
        const session = nativeLoginSessions.get(sessionId);
        const input = validateNativeLoginInput(params?.input);
        if (!session)
            return { success: false, expired: true, error: 'Phiên đăng nhập đã hết hạn. Vui lòng bắt đầu lại.' };
        if (!input)
            return { success: false, error: 'Dữ liệu xác thực không hợp lệ.' };
        try {
            const result = await session.bridge.submitNativeLogin(input);
            if (!result.complete)
                return { success: true, sessionId, step: result.step };
            const cookie = serializeNativeCookies(result.cookies);
            await disposeNativeLoginSession(sessionId);
            if (!cookie)
                return { success: false, error: 'Đăng nhập hoàn tất nhưng không nhận được cookie phiên.' };
            return await _addFBAccountCommon(cookie, params.proxyId);
        }
        catch (err) {
            // The upstream state machine keeps its state after a rejected code so the
            // user can retry; do not dispose the session merely because a step failed.
            Logger_1.default.warn(`[facebookIpc] Messenger Lite login step failed: ${err.message}`);
            return { success: false, error: err.message || 'Xác thực Messenger Lite thất bại.' };
        }
    });
    electron_1.ipcMain.handle('fb:cancelMessengerLiteLogin', async (_event, { sessionId }) => {
        await disposeNativeLoginSession(String(sessionId || ''));
        return { success: true };
    });
    /**
     * Xóa tài khoản Facebook
     */
    electron_1.ipcMain.handle('fb:removeAccount', async (_event, { accountId }) => {
        try {
            const internalId = resolveInternalId(accountId);
            await FacebookConnectionManager_1.default.disconnect(internalId);
            (0, SecureSettingsService_1.secureDelete)(fbCookieKey(internalId));
            DatabaseService_1.default.getInstance().deleteFBAccount(internalId);
            // Also remove from unified accounts table (zalo_id = fbId)
            DatabaseService_1.default.getInstance().deleteAccount(accountId);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Cập nhật cookie cho tài khoản Facebook hiện có
     */
    electron_1.ipcMain.handle('fb:updateCookie', async (_event, { accountId, cookie }) => {
        try {
            const internalId = resolveInternalId(accountId);
            const account = DatabaseService_1.default.getInstance().getFBAccount(internalId);
            if (!account)
                return { success: false, error: 'Tài khoản không tồn tại' };
            // Verify cookie alive + init session
            const sessionData = await (0, FacebookSession_1.initSession)(cookie);
            const fbId = sessionData.FacebookID;
            if (!fbId || !fbId.match(/^\d+$/) || fbId.includes('Unable')) {
                return { success: false, error: 'Cookie không hợp lệ hoặc đã hết hạn' };
            }
            // Fetch updated profile
            let name = account.name || fbId;
            let avatarUrl = account.avatar_url || '';
            try {
                const html = await (0, FacebookSession_1.fetchFBHomepage)(cookie);
                const profile = await (0, FacebookSession_1.fetchBasicProfileFromHome)(html);
                if (profile.name)
                    name = profile.name;
                if (profile.avatarUrl)
                    avatarUrl = profile.avatarUrl;
            }
            catch { }
            // Update cookie in secure storage
            (0, SecureSettingsService_1.secureSet)(fbCookieKey(internalId), cookie);
            // Update cookie_encrypted fallback (raw cookie) để reconnect vẫn hoạt động
            // khi safeStorage key thay đổi
            DatabaseService_1.default.getInstance().run(`UPDATE fb_accounts SET cookie_encrypted = ?, updated_at = ? WHERE id = ?`, [cookie, Date.now(), internalId]);
            // Update session + profile
            DatabaseService_1.default.getInstance().updateFBAccountSession(internalId, JSON.stringify(sessionData));
            DatabaseService_1.default.getInstance().updateFBAccountProfile(internalId, name, avatarUrl, fbId);
            // Update unified accounts table (zalo_id = fbId)
            DatabaseService_1.default.getInstance()['run'](`UPDATE accounts SET full_name = ?, avatar_url = ? WHERE zalo_id = ?`, [name, avatarUrl, fbId]);
            Logger_1.default.log(`[facebookIpc] fb:updateCookie success for ${internalId}`);
            return { success: true };
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:updateCookie error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    /**
     * Refresh profile (tên, avatar) cho tài khoản Facebook hiện có
     */
    electron_1.ipcMain.handle('fb:refreshProfile', async (_event, { accountId }) => {
        try {
            const internalId = resolveInternalId(accountId);
            const account = DatabaseService_1.default.getInstance().getFBAccount(internalId);
            if (!account)
                return { success: false, error: 'Tài khoản không tồn tại' };
            const cookie = (0, SecureSettingsService_1.secureGet)(fbCookieKey(internalId)) || account.cookie_encrypted;
            if (!cookie)
                return { success: false, error: 'Không tìm thấy cookie. Vui lòng cập nhật cookie.' };
            let name = account.name || account.facebook_id;
            let avatarUrl = account.avatar_url || '';
            try {
                const html = await (0, FacebookSession_1.fetchFBHomepage)(cookie);
                const profile = await (0, FacebookSession_1.fetchBasicProfileFromHome)(html);
                if (profile.name)
                    name = profile.name;
                if (profile.avatarUrl)
                    avatarUrl = profile.avatarUrl;
            }
            catch (err) {
                Logger_1.default.warn(`[facebookIpc] fb:refreshProfile fetch error: ${err.message}`);
            }
            // Update FB account table
            DatabaseService_1.default.getInstance().updateFBAccountProfile(internalId, name, avatarUrl, account.facebook_id);
            // Update unified accounts table (zalo_id = fbId)
            DatabaseService_1.default.getInstance()['run'](`UPDATE accounts SET full_name = ?, avatar_url = ? WHERE zalo_id = ?`, [name, avatarUrl, account.facebook_id]);
            Logger_1.default.log(`[facebookIpc] fb:refreshProfile success for ${account.facebook_id}: ${name}`);
            return { success: true, name, avatarUrl, facebookId: account.facebook_id };
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:refreshProfile error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    /**
     * Refresh avatar cho 1 contact Facebook (user 1-1).
     * Dùng khi avatar CDN hết hạn (403). Re-fetch thread list từ GraphQL
     * để lấy avatar URL mới, update DB, trả về URL.
     */
    electron_1.ipcMain.handle('fb:refreshContactAvatar', async (_event, { accountId, userId }) => {
        try {
            const internalId = resolveInternalId(accountId);
            const cookie = (0, SecureSettingsService_1.secureGet)(fbCookieKey(internalId));
            if (!cookie)
                return { success: false, error: 'Không tìm thấy cookie. Vui lòng cập nhật cookie.', avatarUrl: null };
            const service = FacebookConnectionManager_1.default.get(internalId);
            if (!service || !service.isConnected()) {
                // Nếu service chưa connect, vẫn có thể gọi refreshContactAvatar
                // bằng cách tạo temporary service không persistent
                return { success: false, error: 'Tài khoản chưa kết nối', avatarUrl: null };
            }
            const avatarUrl = await service.refreshContactAvatar(userId);
            if (avatarUrl) {
                return { success: true, avatarUrl };
            }
            return { success: false, error: 'Không thể lấy avatar mới', avatarUrl: null };
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:refreshContactAvatar error: ${err.message}`);
            return { success: false, error: err.message, avatarUrl: null };
        }
    });
    /** Resolve a one-to-one Facebook identity by its numeric UID. */
    const getUserInfoFacebookHandler = async (_event, { accountId, userId }) => {
        try {
            // Chỉ cho phép user ID dạng số (không phải group chat)
            if (!/^\d+$/.test(userId))
                return { success: false, error: 'Chỉ hỗ trợ user 1-1' };
            const internalId = resolveInternalId(accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối' };
            const info = await service.getUserInfoFacebook(userId);
            if (info) {
                Logger_1.default.log(`[facebookIpc] fb:getUserInfoFacebook: resolved ${userId} → name="${info.name}"`);
                // Lưu dưới Facebook UID thật, không phải UUID nội bộ của account.
                if (info.name) {
                    DatabaseService_1.default.getInstance()['run']?.(`INSERT INTO contacts (owner_zalo_id, contact_id, display_name, avatar_url, is_friend, contact_type, unread_count, last_message, last_message_time, channel)
             VALUES (?, ?, ?, ?, 0, 'user', 0, '', 0, 'facebook')
             ON CONFLICT(owner_zalo_id, contact_id) DO UPDATE SET
               display_name = excluded.display_name,
               avatar_url = excluded.avatar_url`, [resolveRealFacebookId(internalId, service), userId, info.name, info.avatarUrl || '']);
                }
                return { success: true, name: info.name, avatarUrl: info.avatarUrl };
            }
            return { success: false, error: 'Không thể lấy thông tin user' };
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:getUserInfoFacebook error: ${err.message}`);
            return { success: false, error: err.message };
        }
    };
    electron_1.ipcMain.handle('fb:getUserInfoFacebook', getUserInfoFacebookHandler);
    // Kept so renderer bundles released before the IPC rename keep working.
    electron_1.ipcMain.handle('fb:getUserInfoFacebookHtml', getUserInfoFacebookHandler);
    /**
     * Lấy danh sách tài khoản FB
     */
    electron_1.ipcMain.handle('fb:getAccounts', async () => {
        try {
            const accounts = DatabaseService_1.default.getInstance().getFBAccounts();
            return { success: true, accounts };
        }
        catch (err) {
            return { success: false, accounts: [], error: err.message };
        }
    });
    /**
     * Connect MQTT listener cho account
     */
    electron_1.ipcMain.handle('fb:connect', async (_event, { accountId }) => {
        try {
            const internalId = resolveInternalId(accountId);
            const result = await connectFacebookAccount(internalId, 'dashboard');
            clearFacebookStartupRetry(internalId);
            return {
                success: true,
                listenerConnected: result.listenerConnected,
                e2eeConnected: result.e2eeConnected,
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Disconnect MQTT listener
     */
    electron_1.ipcMain.handle('fb:disconnect', async (_event, { accountId }) => {
        try {
            const internalId = resolveInternalId(accountId);
            await FacebookConnectionManager_1.default.disconnect(internalId);
            DatabaseService_1.default.getInstance().updateFBAccountStatus(internalId, 'disconnected');
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Health check
     */
    electron_1.ipcMain.handle('fb:checkHealth', async (_event, { accountId }) => {
        try {
            const internalId = resolveInternalId(accountId);
            const service = FacebookConnectionManager_1.default.get(internalId);
            if (!service)
                return { success: true, alive: false, listenerConnected: false, reason: 'not_initialized' };
            const health = await service.checkHealth();
            return { success: true, ...health };
        }
        catch (err) {
            return { success: false, alive: false, listenerConnected: false, error: err.message };
        }
    });
    /**
     * Gửi tin nhắn (C1: auto-route 1:1 qua E2EE)
     * Dùng chung FacebookSendService.sendTextMessage() với workflow engine.
     */
    electron_1.ipcMain.handle('fb:sendMessage', async (_event, params) => {
        const startedAt = Date.now();
        try {
            const internalId = resolveInternalId(params.accountId);
            Logger_1.default.log(`[facebookIpc] fb:sendMessage accountId=${params.accountId} → internalId=${internalId} threadId=${params.threadId} body="${params.body?.slice(0, 50)}"`);
            // Auto-reconnect nếu service chưa có trong ConnectionManager
            const service = await getFBServiceOrReconnect(internalId);
            if (!service) {
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            }
            const { FacebookSendService } = require('../../src/services/facebook/FacebookSendService');
            // Phase 4: Preserve typeChat tri-state (undefined vs null have different meanings)
            // undefined = not specified → resolve from DB
            // null = explicitly group
            // 'user' = explicitly 1:1
            const hasTypeChat = params.options && Object.prototype.hasOwnProperty.call(params.options, 'typeChat');
            const typeChat = hasTypeChat ? params.options.typeChat : undefined;
            const TIMEOUT_MS = 60000;
            const result = (await Promise.race([
                FacebookSendService.sendTextMessage({
                    accountId: internalId,
                    threadId: params.threadId,
                    body: params.body,
                    typeChat,
                    replyToMessageId: params.options?.replyToMessageId,
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Gửi tin nhắn timeout sau ${TIMEOUT_MS / 1000}s. Vui lòng thử lại.`)), TIMEOUT_MS)),
            ]));
            const elapsedMs = Date.now() - startedAt;
            if (result?.success) {
                Logger_1.default.log(`[facebookIpc] fb:sendMessage completed accountId=${internalId} threadId=${params.threadId} success=true elapsedMs=${elapsedMs}`);
            }
            else {
                Logger_1.default.warn(`[facebookIpc] fb:sendMessage completed accountId=${internalId} threadId=${params.threadId} success=false elapsedMs=${elapsedMs} error=${result?.error || 'unknown'}`);
            }
            return result;
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:sendMessage error after ${Date.now() - startedAt}ms: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    /**
     * Gửi attachment (C2: auto-route 1:1 qua E2EE)
     * DEPLAO_ADAPTER: Delegates to FacebookSendService.sendAttachment() for
     * consolidated route matrix. No fallback between E2EE and REST routes.
     */
    electron_1.ipcMain.handle('fb:sendAttachment', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const { FacebookSendService } = require('../../src/services/facebook/FacebookSendService');
            const result = await FacebookSendService.sendAttachment({
                accountId: internalId,
                threadId: params.threadId,
                filePath: params.filePath,
                body: params.body,
                typeChat: params.typeChat,
                fileType: params.fileType,
                replyToMessageId: params.replyToMessageId,
            });
            return { ...result, fileName: require('path').basename(params.filePath) };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Gửi nhiều ảnh/file cùng 1 request (batch attachments)
     * DEPLAO_ADAPTER: Delegates to FacebookSendService.sendAttachment() per file.
     */
    electron_1.ipcMain.handle('fb:sendAttachments', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const { FacebookSendService } = require('../../src/services/facebook/FacebookSendService');
            let failCount = 0;
            for (const fp of params.filePaths) {
                const result = await FacebookSendService.sendAttachment({
                    accountId: internalId,
                    threadId: params.threadId,
                    filePath: fp,
                    body: params.body,
                    typeChat: params.typeChat,
                    replyToMessageId: params.replyToMessageId,
                });
                if (!result.success)
                    failCount++;
            }
            return {
                success: failCount < params.filePaths.length,
                uploadedCount: params.filePaths.length - failCount,
                totalCount: params.filePaths.length,
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Thu hồi tin nhắn
     */
    electron_1.ipcMain.handle('fb:unsendMessage', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const result = await service.unsendMessage(params.messageId);
            if (result.success) {
                DatabaseService_1.default.getInstance().updateFBMessageUnsent(params.messageId);
            }
            return result;
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Reaction (C3: auto-route via service)
     * DEPLAO_ADAPTER: Delegate entirely to FacebookService.addReaction().
     * Service handles: resolveMessageThreadKind → E2EE/REST routing,
     * correct sender JID from DB, idempotent remove via empty emoji.
     * No local DB write on failure — only on success through the service.
     */
    electron_1.ipcMain.handle('fb:addReaction', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.addReaction(params.messageId, params.emoji, params.action);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Chỉnh sửa nội dung tin nhắn đã gửi (I1)
     */
    electron_1.ipcMain.handle('fb:editMessage', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.editMessage(params.messageId, params.text);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Lấy danh sách threads
     */
    electron_1.ipcMain.handle('fb:getThreads', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            // Lấy từ DB trước (cache)
            const cached = DatabaseService_1.default.getInstance().getFBThreads(internalId);
            if (!params.forceRefresh && cached.length > 0) {
                return { success: true, threads: cached };
            }
            // Refresh both sources. The bridge page contains E2EE/private threads
            // that the legacy web GraphQL inbox does not consistently return.
            const service = await getFBServiceOrReconnect(internalId);
            if (service && service.isConnected()) {
                const history = await service.syncBridgeHistory();
                const threads = await service.getThreadList();
                const db = DatabaseService_1.default.getInstance();
                db.saveFBThreads(internalId, threads);
                // Correct rows that were previously populated with the account avatar.
                // The repair uses Facebook's ID-bound /picture endpoint and only
                // requests avatars that are blank or match the current account.
                const repairedAvatars = await service.refreshSuspectThreadAvatars(db.getFBThreads(internalId).map(thread => thread.id));
                const updated = db.getFBThreads(internalId);
                return { success: true, threads: updated, syncedMessages: history.messages, repairedAvatars };
            }
            return { success: true, threads: cached };
        }
        catch (err) {
            Logger_1.default.error(`[facebookIpc] fb:getThreads error: ${err.message}`);
            return { success: false, threads: [], error: err.message };
        }
    });
    /**
     * Lấy messages từ DB local
     */
    electron_1.ipcMain.handle('fb:getMessages', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const messages = DatabaseService_1.default.getInstance().getFBMessages(internalId, params.threadId, params.limit || 50, params.offset || 0);
            return { success: true, messages };
        }
        catch (err) {
            return { success: false, messages: [], error: err.message };
        }
    });
    /**
     * Đánh dấu đã đọc (C5: gửi lên Facebook server qua bridge)
     */
    electron_1.ipcMain.handle('fb:markAsRead', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            DatabaseService_1.default.getInstance().markFBThreadAsRead(internalId, params.threadId);
            // C5: Also send read receipt to Facebook server
            const service = FacebookConnectionManager_1.default.get(internalId);
            if (service) {
                service.markReadOnServer(params.threadId).catch(() => { });
            }
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Đổi tên nhóm
     */
    electron_1.ipcMain.handle('fb:changeThreadName', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const ok = await service.changeThreadName(params.threadId, params.name);
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Đổi emoji nhóm
     */
    electron_1.ipcMain.handle('fb:changeThreadEmoji', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const ok = await service.changeThreadEmoji(params.threadId, params.emoji);
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Đổi nickname thành viên
     */
    electron_1.ipcMain.handle('fb:changeNickname', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const ok = await service.changeNickname(params.threadId, params.userId, params.nickname);
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Đăng nhập bằng username/password
     */
    electron_1.ipcMain.handle('fb:loginWithCredentials', async (_event, params) => {
        try {
            const result = await (0, FacebookLoginHelper_1.loginWithCredentials)(params.username, params.password, params.twoFASecret);
            return { success: !!result.success, result };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── E2EE Handlers ──────────────────────────────────────────────────────
    /**
     * Gửi tin nhắn E2EE (1:1 encrypted)
     */
    electron_1.ipcMain.handle('fb:sendE2EEMessage', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            // Keep this endpoint on the same guarded route as fb:sendMessage. It
            // retries only a deterministic pre-flight "not connected" failure.
            const result = await service.sendE2EEMessage(params.chatJid, params.text, { replyToMessageId: params.replyToId || '' }, params.replyToSenderJid || '');
            // Save sent message to DB - strip @msgr JID from chatJid để nhất quán
            // với handleE2EEMessage (dùng stripped numeric ID làm thread_id)
            if (result.success && result.messageId) {
                try {
                    const strippedThreadId = params.chatJid ? params.chatJid.replace(/@.*$/, '') : params.chatJid;
                    DatabaseService_1.default.getInstance().saveFBMessage({
                        id: result.messageId,
                        account_id: internalId,
                        thread_id: strippedThreadId, // ← numeric ID, nhất quán với receive path
                        sender_id: resolveRealFacebookId(internalId, service),
                        body: params.text,
                        timestamp: result.timestamp || Date.now(),
                        type: 'text',
                        is_self: 1,
                        is_unsent: 0,
                        ...(params.replyToId ? { reply_to_id: params.replyToId } : {}),
                    });
                }
                catch (dbErr) {
                    Logger_1.default.warn(`[facebookIpc] fb:sendE2EEMessage DB save error: ${dbErr.message}`);
                }
            }
            return result;
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Kiểm tra trạng thái E2EE bridge
     */
    electron_1.ipcMain.handle('fb:getE2EEStatus', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = FacebookConnectionManager_1.default.get(internalId);
            if (!service)
                return { success: true, status: 'disconnected', available: false };
            return {
                success: true,
                status: service.getE2EEStatus(),
                connected: service.isE2EEConnected(),
                available: service.isE2EEAvailable(),
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Bật/tắt E2EE bridge thủ công
     */
    electron_1.ipcMain.handle('fb:toggleE2EE', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            await service.setE2EEEnabled(params.enable);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Gửi typing indicator (C6)
     */
    electron_1.ipcMain.handle('fb:sendTyping', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            await service.sendTyping(params.threadId, params.isTyping);
            return { success: true };
        }
        catch (err) {
            // Typing is best-effort - no error returned
            return { success: true };
        }
    });
    /**
     * Gửi seen/delivered receipt (C5)
     */
    electron_1.ipcMain.handle('fb:sendSeen', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.markReadOnServer(params.threadId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Chuyển tiếp tin nhắn (I2)
     */
    electron_1.ipcMain.handle('fb:forwardMessage', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            // Keep `undefined` distinct from false: an omitted target kind must be
            // resolved from fb_threads, never silently treated as a 1:1 conversation.
            const hasIsGroup = Object.prototype.hasOwnProperty.call(params, 'isGroup');
            const typeChat = hasIsGroup ? (params.isGroup ? null : 'user') : undefined;
            return await service.forwardMessage(params.messageId, params.targetThreadId, typeChat);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Ghim tin nhắn (I3)
     */
    electron_1.ipcMain.handle('fb:pinMessage', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.pinMessage(params.messageId, params.threadId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Bỏ ghim tin nhắn (I3)
     */
    electron_1.ipcMain.handle('fb:unpinMessage', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.unpinMessage(params.messageId, params.threadId);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Tạo poll (I6)
     */
    electron_1.ipcMain.handle('fb:createPoll', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.createPoll(params.threadId, params.question, params.options);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Bỏ phiếu poll (I6)
     */
    electron_1.ipcMain.handle('fb:votePoll', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            return await service.votePoll(params.pollId, params.optionIds);
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Fetch tin nhắn lịch sử từ Facebook API (C7)
     * Khác với fb:getMessages (đọc từ DB local), cái này gọi API GraphQL
     * Tự động lưu tin nhắn fetch được vào DB để dùng offline.
     */
    electron_1.ipcMain.handle('fb:fetchThreadMessages', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const service = await getFBServiceOrReconnect(internalId);
            if (!service)
                return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
            const result = await service.fetchThreadMessages(params.threadId, params.limit, params.beforeCursor);
            // Lưu tin nhắn vào DB để dùng offline
            if (result.success && result.messages?.length) {
                const db = DatabaseService_1.default.getInstance();
                const ownFacebookId = String(resolveRealFacebookId(internalId, service)).replace(/@.*$/, '');
                for (const msg of result.messages) {
                    const senderId = String(msg.senderId || '').replace(/@.*$/, '');
                    const isSelf = senderId !== '' && senderId === ownFacebookId ? 1 : 0;
                    db.saveFBMessage({
                        id: msg.id,
                        account_id: internalId,
                        thread_id: params.threadId,
                        sender_id: senderId,
                        sender_name: msg.senderName || '',
                        body: msg.body || null,
                        timestamp: msg.timestampMs,
                        type: msg.attachments?.length ? 'file' : 'text',
                        attachments: msg.attachments?.length ? JSON.stringify(msg.attachments) : '[]',
                        reply_to_id: msg.replyToMessageId || '',
                        is_self: isSelf,
                        is_unsent: msg.isUnsent ? 1 : 0,
                        reactions: msg.reactions?.length ? JSON.stringify(msg.reactions) : '{}',
                        is_history: true,
                    });
                    if (senderId) {
                        // saveFBMessage is intentionally insert-only for duplicate events.
                        // Reconcile existing rows while the history API still has the
                        // canonical participant id, so messages stored by an older client
                        // immediately regain the correct sender and direction on refresh.
                        db.run(`UPDATE fb_messages
               SET sender_id = ?, sender_name = CASE WHEN ? != '' THEN ? ELSE sender_name END, is_self = ?
               WHERE id = ? AND account_id = ?`, [senderId, msg.senderName || '', msg.senderName || '', isSelf, msg.id, internalId]);
                        db.run(`UPDATE messages SET sender_id = ?, is_sent = ?, status = ?
               WHERE msg_id = ? AND owner_zalo_id = ? AND channel = 'facebook'`, [senderId, isSelf, isSelf ? 'sent' : 'received', msg.id, ownFacebookId]);
                    }
                }
                Logger_1.default.log(`[fb:fetchThreadMessages] Saved ${result.messages.length} messages to DB`);
            }
            return result;
        }
        catch (err) {
            return { success: false, messages: [], error: err.message };
        }
    });
    // ─── Scan Data Handlers ─────────────────────────────────────────────────
    /**
     * Quét thành viên nhóm Facebook
     */
    electron_1.ipcMain.handle('fb:scanGroupMembers', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanGroupMembers(internalId, params.groupId, params.cursor);
            return result;
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Quét nhóm theo từ khóa
     */
    electron_1.ipcMain.handle('fb:scanGroupKeyword', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanSearchComet(internalId, { keyword: params.keyword, type: 'group', cursor: params.cursor, filters: params.filters, bsid: params.bsid, tsid: params.tsid });
            return result;
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Quét fanpage theo từ khóa
     */
    electron_1.ipcMain.handle('fb:scanFanpageKeyword', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanSearchComet(internalId, { keyword: params.keyword, type: 'page', cursor: params.cursor, filters: params.filters, bsid: params.bsid, tsid: params.tsid });
            return result;
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Quét bình luận bài viết
     */
    electron_1.ipcMain.handle('fb:scanPostComments', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanPostComments(internalId, params.postId, params.cursor);
            return result;
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Quét bài viết theo từ khóa
     */
    electron_1.ipcMain.handle('fb:scanPostKeyword', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanSearchComet(internalId, { keyword: params.keyword, type: 'post', cursor: params.cursor, filters: params.filters, bsid: params.bsid, tsid: params.tsid });
            return result;
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Quét bài đăng từ timeline profile/fanpage/group
     */
    electron_1.ipcMain.handle('fb:scanPostTimeline', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanPostTimeline(internalId, params.sourceId, params.sourceType, params.cursor);
            return result;
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Reset scan cache (clear context + docId cache)
     */
    // ─── Batch Scan Handlers ─────────────────────────────────────────────
    /**
     * Quét thành viên nhiều nhóm cùng lúc (batch)
     */
    electron_1.ipcMain.handle('fb:scanGroupMembersBatch', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanGroupMembersBatch(internalId, params.groupIds, params.threadCount || 5);
            return result;
        }
        catch (err) {
            return { success: false, items: [], errors: [err.message], error: err.message };
        }
    });
    /**
     * Quét bình luận nhiều bài viết cùng lúc (batch)
     */
    electron_1.ipcMain.handle('fb:scanPostCommentsBatch', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            const result = await service.scanPostCommentsBatch(internalId, params.postIds, params.threadCount || 5);
            return result;
        }
        catch (err) {
            return { success: false, items: [], errors: [err.message], error: err.message };
        }
    });
    // ─── Scan Log Handlers ───────────────────────────────────────────────
    /**
     * Lưu 1 entry scan history
     */
    electron_1.ipcMain.handle('fb:saveScanLog', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanLogService } = require('../../src/services/facebook/FacebookScanLogService');
            FacebookScanLogService.init();
            const id = FacebookScanLogService.save({
                accountId: internalId,
                tabId: params.tabId || '',
                tabName: params.tabName || '',
                scanType: params.scanType,
                input: params.input,
                status: params.status,
                itemsCount: params.itemsCount || 0,
                error: params.error || '',
                requestPayload: params.requestPayload || '{}',
                responsePreview: params.responsePreview || '',
                requestHeaders: params.requestHeaders || '',
                responseHeaders: params.responseHeaders || '',
                docId: params.docId || '',
                threadCount: params.threadCount || 1,
                createdAt: Date.now(),
            });
            return { success: true, id };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Lấy lịch sử scan
     */
    electron_1.ipcMain.handle('fb:getScanLogs', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanLogService } = require('../../src/services/facebook/FacebookScanLogService');
            const result = FacebookScanLogService.getList(internalId, params.tabId, params.limit || 50, params.offset || 0);
            return { success: true, ...result };
        }
        catch (err) {
            return { success: false, logs: [], total: 0, error: err.message };
        }
    });
    electron_1.ipcMain.handle('fb:scanResetCache', async () => {
        try {
            const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
            const service = FacebookScanService.getInstance();
            service.clearCache();
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── Scan Tab Handlers ────────────────────────────────────────────────
    /**
     * Lưu/cập nhật tab
     */
    electron_1.ipcMain.handle('fb:scanSaveTab', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            FacebookScanTabService.init();
            // Preserve original created_at if tab already exists
            const existing = FacebookScanTabService.getTab(params.id);
            const ok = FacebookScanTabService.saveTab({
                id: params.id,
                accountId: internalId,
                name: params.name,
                scanType: params.scanType,
                config: params.config,
                status: params.status || 'active',
                itemsCount: params.itemsCount || 0,
                createdAt: existing?.createdAt || Date.now(),
                updatedAt: Date.now(),
            });
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Lấy danh sách tabs
     */
    electron_1.ipcMain.handle('fb:scanGetTabs', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const result = FacebookScanTabService.getTabs(internalId, params.status, params.limit, params.offset);
            return { success: true, ...result };
        }
        catch (err) {
            return { success: false, tabs: [], total: 0, error: err.message };
        }
    });
    /**
     * Lấy 1 tab
     */
    electron_1.ipcMain.handle('fb:scanGetTab', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const tab = FacebookScanTabService.getTab(params.id);
            return { success: !!tab, tab };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Cập nhật trạng thái tab (active/archived/deleted)
     */
    electron_1.ipcMain.handle('fb:scanUpdateTabStatus', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const ok = FacebookScanTabService.updateTabStatus(params.id, params.status);
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Xoá hẳn tab + data + request logs
     */
    electron_1.ipcMain.handle('fb:scanDeleteTab', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const ok = FacebookScanTabService.deleteTab(params.id);
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Cập nhật updated_at cho tab (đẩy lên đầu danh sách)
     */
    electron_1.ipcMain.handle('fb:scanTouchTab', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const ok = FacebookScanTabService.touchTab(params.id);
            return { success: ok };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Lưu data cho tab
     */
    electron_1.ipcMain.handle('fb:scanSaveTabData', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const id = FacebookScanTabService.saveTabData(params.tabId, params.items, params.pageInfo);
            return { success: true, id };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Lấy data đã lưu cho tab (items + pageInfo từ lần scan gần nhất)
     */
    electron_1.ipcMain.handle('fb:scanGetTabData', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const rows = FacebookScanTabService.getTabData(params.tabId, 1);
            if (rows.length > 0) {
                const latest = rows[0];
                return {
                    success: true,
                    items: JSON.parse(latest.items || '[]'),
                    pageInfo: JSON.parse(latest.page_info || '{}'),
                };
            }
            return { success: true, items: [], pageInfo: { endCursor: null, hasNextPage: false } };
        }
        catch (err) {
            return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
        }
    });
    /**
     * Lưu request log cho tab
     */
    electron_1.ipcMain.handle('fb:scanSaveRequestLog', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const id = FacebookScanTabService.saveRequestLog(params.tabId, {
                requestPayload: params.requestPayload,
                responsePreview: params.responsePreview,
                status: params.status,
                error: params.error,
                itemsCount: params.itemsCount,
            });
            return { success: true, id };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    /**
     * Lấy request logs của tab
     */
    electron_1.ipcMain.handle('fb:scanGetRequestLogs', async (_event, params) => {
        try {
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const result = FacebookScanTabService.getRequestLogs(params.tabId, params.limit, params.offset);
            return { success: true, ...result };
        }
        catch (err) {
            return { success: false, logs: [], total: 0, error: err.message };
        }
    });
    /**
     * Thống kê scan
     */
    electron_1.ipcMain.handle('fb:scanGetStats', async (_event, params) => {
        try {
            const internalId = resolveInternalId(params.accountId);
            const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
            const stats = FacebookScanTabService.getStats(internalId);
            return { success: true, ...stats };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    Logger_1.default.log('[facebookIpc] All handlers registered');
}
/**
 * Block người dùng (N4)
 */
electron_1.ipcMain.handle('fb:blockUser', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.blockUser(params.userId);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Unblock người dùng (N4)
 */
electron_1.ipcMain.handle('fb:unblockUser', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.unblockUser(params.userId);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Đổi theme hội thoại (N1)
 */
electron_1.ipcMain.handle('fb:changeThreadTheme', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.changeThreadTheme(params.threadId, params.theme);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Tạo Messenger Note (N2)
 */
electron_1.ipcMain.handle('fb:createNote', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.createNote(params.text, params.backgroundColor, params.textColor);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// ─── N3: Group Admin Operations ─────────────────────────────────────────────
/**
 * Thêm admin nhóm (N3)
 */
electron_1.ipcMain.handle('fb:addGroupAdmin', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.addGroupAdmin(params.threadId, params.userId);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Xóa admin nhóm (N3)
 */
electron_1.ipcMain.handle('fb:removeGroupAdmin', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.removeGroupAdmin(params.threadId, params.userId);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Bật/tắt duyệt thành viên (N3)
 */
electron_1.ipcMain.handle('fb:changeApprovalMode', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.changeApprovalMode(params.threadId, params.approved);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Duyệt/từ chối thành viên (N3)
 */
electron_1.ipcMain.handle('fb:approvePendingMember', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.approvePendingMember(params.threadId, params.userId, params.approve);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Lấy link mời nhóm (N3)
 */
electron_1.ipcMain.handle('fb:getGroupLink', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.getGroupLink(params.threadId);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Bật/tắt link mời nhóm (N3)
 */
electron_1.ipcMain.handle('fb:setGroupLink', async (_event, params) => {
    try {
        const internalId = resolveInternalId(params.accountId);
        const service = await getFBServiceOrReconnect(internalId);
        if (!service)
            return { success: false, error: 'Tài khoản chưa kết nối. Vui lòng kết nối lại Facebook.' };
        return await service.setGroupLink(params.threadId, params.enable);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
/**
 * Auto-reconnect tất cả FB accounts khi app khởi động.
 * Uses exactly the same connection path as the dashboard. A socket status
 * flag alone is not enough here: startup must wait for the MQTT transport and
 * let the E2EE bridge initialize from its persisted device state.
 */
async function reconnectAllFBAccounts() {
    try {
        const accounts = DatabaseService_1.default.getInstance().getFBAccounts();
        Logger_1.default.log(`[facebookIpc] reconnectAllFBAccounts: ${accounts.length} FB accounts found`);
        for (const acc of accounts) {
            try {
                const existing = FacebookConnectionManager_1.default.get(acc.id);
                if (existing && (existing.isListenerActuallyConnected() || existing.isE2EEConnected())) {
                    Logger_1.default.log(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: transport already ready, skipping`);
                    continue;
                }
                await connectFacebookAccount(acc.id, 'startup');
                clearFacebookStartupRetry(acc.id);
            }
            catch (err) {
                Logger_1.default.warn(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: ${err.message}`);
                scheduleFacebookStartupRetry(acc.id, 0);
            }
        }
    }
    catch (err) {
        Logger_1.default.warn(`[facebookIpc] reconnectAllFBAccounts error: ${err.message}`);
    }
}
//# sourceMappingURL=facebookIpc.js.map