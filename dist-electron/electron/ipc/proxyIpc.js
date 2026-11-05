"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProxyIpc = registerProxyIpc;
const electron_1 = require("electron");
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const ProxyHelper_1 = require("../../src/utils/ProxyHelper");
function registerProxyIpc() {
    // ─── Lấy danh sách proxies ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('proxy:list', async () => {
        try {
            const proxies = DatabaseService_1.default.getInstance().getProxies();
            return { success: true, proxies };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] list error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Tạo proxy mới ─────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('proxy:save', async (_event, { proxy }) => {
        try {
            if (!proxy?.host || !proxy?.port) {
                return { success: false, error: 'Host và Port không được để trống' };
            }
            const id = DatabaseService_1.default.getInstance().saveProxy({
                name: proxy.name || `${proxy.host}:${proxy.port}`,
                type: proxy.type || 'http',
                host: proxy.host.trim(),
                port: Number(proxy.port),
                username: proxy.username || '',
                password: proxy.password || '',
            });
            const saved = DatabaseService_1.default.getInstance().getProxyById(id);
            return { success: true, id, proxy: saved };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] save error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Cập nhật proxy ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('proxy:update', async (_event, { id, proxy }) => {
        try {
            if (!id)
                return { success: false, error: 'Thiếu id proxy' };
            DatabaseService_1.default.getInstance().updateProxy(Number(id), proxy);
            const updated = DatabaseService_1.default.getInstance().getProxyById(Number(id));
            return { success: true, proxy: updated };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] update error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Xóa proxy ──────────────────────────────────────────────────────���──────
    electron_1.ipcMain.handle('proxy:delete', async (_event, { id }) => {
        try {
            if (!id)
                return { success: false, error: 'Thiếu id proxy' };
            DatabaseService_1.default.getInstance().deleteProxy(Number(id));
            return { success: true };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] delete error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Gắn/gỡ proxy cho tài khoản ────────────────────────────────────────────
    electron_1.ipcMain.handle('proxy:setAccount', async (_event, { zaloId, proxyId }) => {
        try {
            if (!zaloId)
                return { success: false, error: 'Thiếu zaloId' };
            DatabaseService_1.default.getInstance().setAccountProxy(zaloId, proxyId ?? null);
            return { success: true };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] setAccount error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Lấy proxy của 1 tài khoản ─────────────────────────────────────────────
    electron_1.ipcMain.handle('proxy:getForAccount', async (_event, { zaloId }) => {
        try {
            if (!zaloId)
                return { success: false, error: 'Thiếu zaloId' };
            const proxy = DatabaseService_1.default.getInstance().getAccountProxy(zaloId);
            return { success: true, proxy };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] getForAccount error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
    // ─── Test proxy connection ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('proxy:test', async (_event, { proxy }) => {
        try {
            if (!proxy?.host || !proxy?.port) {
                return { success: false, error: 'Host và Port không được để trống' };
            }
            const agent = (0, ProxyHelper_1.createProxyAgent)({
                id: 0,
                name: proxy.name || '',
                type: proxy.type || 'http',
                host: proxy.host.trim(),
                port: Number(proxy.port),
                username: proxy.username || '',
                password: proxy.password || '',
            });
            if (!agent) {
                return { success: false, error: 'Không thể tạo proxy agent' };
            }
            // Test bằng cách kết nối đến URL qua proxy (HEAD request)
            const https = require('https');
            const URLS = ['https://www.google.com', 'https://httpbin.org/get'];
            const testReq = (url) => new Promise((resolve) => {
                const start = Date.now();
                const parsedUrl = new URL(url);
                const req = https.request({
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname,
                    method: 'HEAD',
                    agent,
                    timeout: 10000,
                }, (res) => {
                    resolve({ ok: true, status: res.statusCode, ms: Date.now() - start });
                    res.resume();
                });
                req.on('error', () => resolve({ ok: false, status: 0, ms: Date.now() - start }));
                req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, ms: Date.now() - start }); });
                req.end();
            });
            // Thử lần lượt các URL
            let lastError = '';
            for (const url of URLS) {
                const result = await testReq(url);
                if (result.ok) {
                    return { success: true, ms: result.ms, status: result.status };
                }
                lastError = `HTTP ${result.status || 'timeout'}`;
            }
            return { success: false, error: `Proxy không phản hồi (${lastError}). Kiểm tra lại host/port/credentials.` };
        }
        catch (err) {
            Logger_1.default.error(`[proxyIpc] test error: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
}
//# sourceMappingURL=proxyIpc.js.map