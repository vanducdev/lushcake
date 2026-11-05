"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRelayIpc = registerRelayIpc;
const electron_1 = require("electron");
const HttpRelayService_1 = __importDefault(require("../../src/services/http/HttpRelayService"));
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const os_1 = __importDefault(require("os"));
/** Lấy địa chỉ IPv4 local (không loopback) */
function getLocalIp() {
    try {
        const nets = os_1.default.networkInterfaces();
        for (const name of Object.keys(nets)) {
            const ifaces = nets[name];
            if (!ifaces)
                continue;
            for (const iface of ifaces) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }
    catch { }
    return '127.0.0.1';
}
function registerRelayIpc() {
    const relay = () => HttpRelayService_1.default.getInstance();
    electron_1.ipcMain.handle('relay:startServer', async (_e, { port } = {}) => {
        try {
            const res = await relay().start(port);
            if (res.success) {
                return { ...res, host: getLocalIp() };
            }
            return res;
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:stopServer', async () => {
        try {
            return relay().stop();
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:getServerStatus', async () => {
        try {
            return { success: true, ...relay().getStatus() };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:kickEmployee', async (_e, { employeeId }) => {
        try {
            relay().kickEmployee(employeeId);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:startTunnel', async () => {
        try {
            return await relay().startTunnel();
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:stopTunnel', async () => {
        try {
            return await relay().stopTunnel();
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:getTunnelStatus', async () => {
        try {
            return { success: true, ...relay().getTunnelStatus() };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ─── Tunnel provider config (cloudflare | ngrok static domain) ──────────────
    electron_1.ipcMain.handle('relay:getTunnelConfig', async () => {
        try {
            const db = DatabaseService_1.default.getInstance();
            return {
                success: true,
                provider: db.getSetting('relay_tunnel_provider') || 'cloudflare',
                authtoken: db.getSetting('relay_ngrok_authtoken') || '',
                domain: db.getSetting('relay_ngrok_domain') || '',
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('relay:setTunnelConfig', async (_e, cfg = {}) => {
        try {
            const db = DatabaseService_1.default.getInstance();
            if (cfg.provider !== undefined)
                db.setSetting('relay_tunnel_provider', cfg.provider);
            if (cfg.authtoken !== undefined)
                db.setSetting('relay_ngrok_authtoken', cfg.authtoken);
            if (cfg.domain !== undefined)
                db.setSetting('relay_ngrok_domain', cfg.domain);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    Logger_1.default.log('[relayIpc] Registered 9 relay IPC channels');
}
//# sourceMappingURL=relayIpc.js.map