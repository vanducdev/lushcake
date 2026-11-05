"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIntegrationIpc = registerIntegrationIpc;
const electron_1 = require("electron");
const IntegrationRegistry_1 = __importDefault(require("../../src/services/integrations/IntegrationRegistry"));
const TunnelService_1 = __importDefault(require("../../src/services/tunnel/TunnelService"));
const WorkspaceManager_1 = __importDefault(require("../../src/utils/WorkspaceManager"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const proxyHelper_1 = require("./proxyHelper");
function isEmployeeMode() {
    try {
        const activeWs = WorkspaceManager_1.default.getInstance().getActiveWorkspace();
        if (activeWs?.type === 'remote')
            return true;
    }
    catch { }
    return false;
}
function registerIntegrationIpc() {
    const extractActionError = (data) => {
        if (!data || typeof data !== 'object')
            return null;
        if (data.success === false)
            return data.error || data.message || 'Thao tác thất bại';
        if (typeof data.error === 'string' && data.error.trim())
            return data.error;
        return null;
    };
    // ─── List all integrations (no credentials) ───────────────────────────────
    electron_1.ipcMain.handle('integration:list', async () => {
        try {
            if (isEmployeeMode())
                return { success: true, integrations: [], webhookPort: 0 };
            const items = IntegrationRegistry_1.default.listConfigs();
            const port = IntegrationRegistry_1.default.getWebhookPort();
            return { success: true, integrations: items, webhookPort: port };
        }
        catch (e) {
            Logger_1.default.error(`[IntegrationIpc] list: ${e.message}`);
            return { success: false, error: e.message, integrations: [] };
        }
    });
    // ─── Get single (masked credentials) ─────────────────────────────────────
    electron_1.ipcMain.handle('integration:get', async (_e, { id }) => {
        try {
            if (isEmployeeMode())
                return { success: false, error: 'Không khả dụng ở chế độ nhân viên' };
            const item = IntegrationRegistry_1.default.getConfig(id);
            if (!item)
                return { success: false, error: 'Không tìm thấy' };
            return { success: true, integration: item };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Save (create or update) ──────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:save', async (_e, { integration }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)('integration:save', { integration });
                return { success: true };
            }
            const id = IntegrationRegistry_1.default.saveConfig(integration);
            return { success: true, id };
        }
        catch (e) {
            Logger_1.default.error(`[IntegrationIpc] save: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Delete ───────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:delete', async (_e, { id }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)('integration:delete', { id });
                return { success: true };
            }
            IntegrationRegistry_1.default.deleteConfig(id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Toggle enabled ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:toggle', async (_e, { id, enabled }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)('integration:toggle', { id, enabled });
                return { success: true };
            }
            IntegrationRegistry_1.default.toggleEnabled(id, enabled);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Test connection ──────────────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:test', async (_e, { id }) => {
        try {
            const result = await IntegrationRegistry_1.default.testConnection(id);
            return { success: true, ...result };
        }
        catch (e) {
            return { success: false, message: e.message };
        }
    });
    // ─── Execute action ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:execute', async (_e, { id, action, params }) => {
        try {
            const data = await IntegrationRegistry_1.default.executeAction(id, action, params || {});
            Logger_1.default.info(`[IntegrationIpc] execute ${action} response: ${JSON.stringify(data)?.slice(0, 1200)}`);
            const nestedError = extractActionError(data);
            if (nestedError) {
                Logger_1.default.warn(`[IntegrationIpc] execute ${action} (nested error): ${nestedError}`);
                return { success: false, error: nestedError, data };
            }
            return { success: true, data };
        }
        catch (e) {
            Logger_1.default.error(`[IntegrationIpc] execute ${action}: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Execute by type ──────────────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:executeByType', async (_e, { type, action, params }) => {
        try {
            const data = await IntegrationRegistry_1.default.executeActionByType(type, action, params || {});
            Logger_1.default.info(`[IntegrationIpc] executeByType ${type}.${action} response: ${JSON.stringify(data)?.slice(0, 1200)}`);
            const nestedError = extractActionError(data);
            if (nestedError) {
                Logger_1.default.warn(`[IntegrationIpc] executeByType ${type}.${action} (nested error): ${nestedError}`);
                return { success: false, error: nestedError, data };
            }
            return { success: true, data };
        }
        catch (e) {
            Logger_1.default.error(`[IntegrationIpc] executeByType ${type}.${action}: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Get webhook port ─────────────────────────────────────────────────────
    electron_1.ipcMain.handle('integration:getWebhookPort', async () => {
        return { success: true, port: IntegrationRegistry_1.default.getWebhookPort() };
    });
    // ─── Tunnel: start ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('tunnel:start', async () => {
        try {
            const port = IntegrationRegistry_1.default.getWebhookPort();
            const url = await TunnelService_1.default.start(port, 'Webhook Gateway');
            // Notify all renderer windows of the tunnel URL change
            electron_1.BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tunnel:changed', { port, url }));
            return { success: true, url };
        }
        catch (e) {
            Logger_1.default.error(`[TunnelIpc] start: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Tunnel: stop ─────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('tunnel:stop', async () => {
        try {
            const port = IntegrationRegistry_1.default.getWebhookPort();
            await TunnelService_1.default.stop(port);
            electron_1.BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tunnel:changed', { port, url: null }));
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Tunnel: status ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle('tunnel:status', () => {
        const port = IntegrationRegistry_1.default.getWebhookPort();
        return {
            active: TunnelService_1.default.isActive(port),
            url: TunnelService_1.default.getUrl(port),
        };
    });
    // ─── Tunnel: get all ─────────────────────────────────────────────────────
    electron_1.ipcMain.handle('tunnel:getAll', () => ({
        tunnels: TunnelService_1.default.getAllTunnels(),
    }));
}
//# sourceMappingURL=integrationIpc.js.map