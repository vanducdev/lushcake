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
exports.registerAIAssistantIpc = registerAIAssistantIpc;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const AIAssistantService_1 = __importDefault(require("../../src/services/ai/AIAssistantService"));
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const WorkspaceManager_1 = __importDefault(require("../../src/utils/WorkspaceManager"));
const proxyHelper_1 = require("./proxyHelper");
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
function isEmployeeMode() {
    try {
        const activeWs = WorkspaceManager_1.default.getInstance().getActiveWorkspace();
        if (activeWs?.type === 'remote')
            return true;
    }
    catch { }
    return false;
}
/** Proxy request-response tới Boss (giống wrap() trong zaloIpc) — trả về kết quả từ Boss */
async function proxyToBossWithResult(channel, params) {
    try {
        const activeWs = WorkspaceManager_1.default.getInstance().getActiveWorkspace();
        if (!activeWs || activeWs.type !== 'remote')
            throw new Error('Không kết nối tới Boss');
        const HCM = require('../../src/services/http/HttpConnectionManager').default;
        return await HCM.getInstance().proxyAction(activeWs.id, channel, { ...params, _fromRelay: true });
    }
    catch (err) {
        Logger_1.default.warn(`[AIAssistantIpc] proxyToBoss ${channel} failed: ${err.message}`);
        return { success: false, error: err.message };
    }
}
function registerAIAssistantIpc() {
    // ─── List all assistants ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:listAssistants', async () => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:listAssistants', {});
            const assistants = AIAssistantService_1.default.getInstance().listAssistants();
            // Mask API keys for renderer
            const masked = assistants.map(a => ({ ...a, apiKey: a.apiKey ? '***' : '' }));
            return { success: true, assistants: masked };
        }
        catch (e) {
            Logger_1.default.error(`[AIAssistantIpc] listAssistants: ${e.message}`);
            return { success: false, error: e.message, assistants: [] };
        }
    });
    // ─── Get single assistant ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:getAssistant', async (_e, { id }) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getAssistant', { id });
            const assistant = AIAssistantService_1.default.getInstance().getAssistant(id);
            if (!assistant)
                return { success: false, error: 'Không tìm thấy trợ lý AI' };
            return { success: true, assistant: { ...assistant, apiKey: assistant.apiKey ? '***' : '' } };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Get default assistant ────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:getDefault', async () => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getDefault', {});
            const assistant = AIAssistantService_1.default.getInstance().getDefaultAssistant();
            if (!assistant)
                return { success: true, assistant: null };
            return { success: true, assistant: { ...assistant, apiKey: '***' } };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Save (create/update) ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:saveAssistant', async (_e, { assistant }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)("ai:saveAssistant", { assistant: assistant });
                return { success: true };
            }
            // If apiKey is '***', preserve existing key (handled in service via ON CONFLICT)
            const pinnedLen = assistant?.pinnedProductsJson?.length || 0;
            Logger_1.default.info(`[AIAssistantIpc] saveAssistant: id=${assistant?.id}, posIntegrationId=${assistant?.posIntegrationId}, pinnedProductsJson.length=${pinnedLen}`);
            const id = AIAssistantService_1.default.getInstance().saveAssistant(assistant);
            return { success: true, id };
        }
        catch (e) {
            Logger_1.default.error(`[AIAssistantIpc] saveAssistant: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Delete ───────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:deleteAssistant', async (_e, { id }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)("ai:deleteAssistant", { id: id });
                return { success: true };
            }
            AIAssistantService_1.default.getInstance().deleteAssistant(id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Test connection ──────────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:testAssistant', async (_e, { id }) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:testAssistant', { id });
            return await AIAssistantService_1.default.getInstance().testConnection(id);
        }
        catch (e) {
            return { success: false, message: e.message };
        }
    });
    // ─── Get files ────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:getFiles', async (_e, { assistantId }) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getFiles', { assistantId });
            const files = AIAssistantService_1.default.getInstance().getFiles(assistantId);
            return { success: true, files };
        }
        catch (e) {
            return { success: false, error: e.message, files: [] };
        }
    });
    // ─── Upload file (read text content) ──────────────────────────────────────
    electron_1.ipcMain.handle('ai:uploadFile', async (_e, { assistantId, filePath: fp }) => {
        try {
            if (!fs.existsSync(fp))
                return { success: false, error: 'File không tồn tại' };
            const fileName = path.basename(fp);
            const stat = fs.statSync(fp);
            const ext = path.extname(fp).toLowerCase();
            // Employee mode: upload file content lên Boss trước, dùng Boss path
            if (isEmployeeMode()) {
                try {
                    const buffer = fs.readFileSync(fp);
                    const HttpClientService = require('../services/http/HttpClientService').default;
                    const uploadResult = await HttpClientService.getInstance().uploadMedia(buffer, fileName);
                    if (uploadResult.success && uploadResult.bossPath) {
                        // Dùng Boss path thay vì local path
                        const id = AIAssistantService_1.default.getInstance().addFile(assistantId, fileName, uploadResult.bossPath, stat.size, '');
                        return { success: true, id, fileName, fileSize: stat.size, bossPath: uploadResult.bossPath };
                    }
                }
                catch { }
                // Fallback: proxy thông thường (boss không có file)
                (0, proxyHelper_1.proxyToBoss)('ai:uploadFile', { assistantId, filePath: fp });
                return { success: true };
            }
            // Boss mode: đọc file local
            let contentText = '';
            const textExts = ['.txt', '.md', '.csv', '.json', '.html', '.xml', '.log', '.yml', '.yaml'];
            if (textExts.includes(ext)) {
                contentText = fs.readFileSync(fp, 'utf-8').substring(0, 100000);
            }
            const id = AIAssistantService_1.default.getInstance().addFile(assistantId, fileName, fp, stat.size, contentText);
            return { success: true, id, fileName, fileSize: stat.size, hasContent: !!contentText };
        }
        catch (e) {
            Logger_1.default.error(`[AIAssistantIpc] uploadFile: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Remove file ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:removeFile', async (_e, { fileId }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)("ai:removeFile", { fileId: fileId });
                return { success: true };
            }
            AIAssistantService_1.default.getInstance().removeFile(fileId);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Get suggestions (for chat input) ─────────────────────────────────────
    electron_1.ipcMain.handle('ai:suggest', async (_e, { assistantId, chatHistory }) => {
        try {
            // Employee mode: proxy qua Boss REST API để Boss gọi AI
            if (isEmployeeMode()) {
                try {
                    const { default: WorkspaceManager } = require('../../src/utils/WorkspaceManager');
                    const ws = WorkspaceManager.getInstance().getActiveWorkspace();
                    if (ws?.bossUrl && ws?.token) {
                        const baseUrl = ws.bossUrl.replace(/\/+$/, '');
                        const res = await fetch(`${baseUrl}/api/command/ai/suggest`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${ws.token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ assistantId, chatHistory }),
                            signal: AbortSignal.timeout(60000),
                        });
                        const json = await res.json();
                        if (json?.success)
                            return { success: true, suggestions: json.suggestions || [] };
                        return { success: false, error: json?.error || 'AI suggest thất bại', suggestions: [] };
                    }
                }
                catch { }
                return { success: false, error: 'Không kết nối tới Boss', suggestions: [] };
            }
            const suggestions = await AIAssistantService_1.default.getInstance().getSuggestions(assistantId, chatHistory);
            return { success: true, suggestions };
        }
        catch (e) {
            const status = e.response?.status;
            const errData = e.response?.data;
            Logger_1.default.error(`[AIAssistantIpc] suggest: status=${status}, message=${e.message}, responseData=${JSON.stringify(errData)?.substring(0, 500)}`);
            return { success: false, error: e.message, suggestions: [] };
        }
    });
    // ─── Direct chat ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:chat', async (_e, { assistantId, messages, structured, maxTokens }) => {
        try {
            // Employee mode: proxy qua Boss REST API để Boss gọi AI
            if (isEmployeeMode()) {
                try {
                    const { default: WorkspaceManager } = require('../../src/utils/WorkspaceManager');
                    const ws = WorkspaceManager.getInstance().getActiveWorkspace();
                    if (ws?.bossUrl && ws?.token) {
                        const baseUrl = ws.bossUrl.replace(/\/+$/, '');
                        const res = await fetch(`${baseUrl}/api/command/ai/chat`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${ws.token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ assistantId, messages, structured, maxTokens }),
                            signal: AbortSignal.timeout(120000),
                        });
                        const json = await res.json();
                        if (json?.success)
                            return { success: true, result: json.result, totalTokens: json.totalTokens, promptTokens: json.promptTokens, completionTokens: json.completionTokens };
                        return { success: false, error: json?.error || 'AI chat thất bại' };
                    }
                }
                catch { }
                return { success: false, error: 'Không kết nối tới Boss' };
            }
            Logger_1.default.info(`[AIAssistantIpc] chat: assistantId=${assistantId}, messagesCount=${messages?.length}, structured=${!!structured}, maxTokens=${maxTokens ?? 'default'}`);
            const result = await AIAssistantService_1.default.getInstance().chat(assistantId, messages, !!structured, maxTokens);
            return { success: true, ...result };
        }
        catch (e) {
            const status = e.response?.status;
            const errData = e.response?.data;
            Logger_1.default.error(`[AIAssistantIpc] chat: status=${status}, message=${e.message}, responseData=${JSON.stringify(errData)?.substring(0, 500)}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Per-account assistant assignment ──────────────────────────────────────
    electron_1.ipcMain.handle('ai:getAccountAssistant', async (_e, { zaloId, role }) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getAccountAssistant', { zaloId, role });
            const assistant = AIAssistantService_1.default.getInstance().getAssistantForAccount(zaloId, role);
            if (!assistant)
                return { success: true, assistant: null };
            return { success: true, assistant: { ...assistant, apiKey: '***' } };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('ai:setAccountAssistant', async (_e, { zaloId, role, assistantId }) => {
        try {
            if (isEmployeeMode()) {
                (0, proxyHelper_1.proxyToBoss)("ai:setAccountAssistant", { zaloId: zaloId, role: role, assistantId: assistantId });
                return { success: true };
            }
            AIAssistantService_1.default.getInstance().setAccountAssistant(zaloId, role, assistantId);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('ai:getAccountAssistants', async (_e, { zaloId }) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getAccountAssistants', { zaloId });
            const assignments = AIAssistantService_1.default.getInstance().getAccountAssistants(zaloId);
            return { success: true, ...assignments };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Usage logs & reporting ────────────────────────────────────────────────
    electron_1.ipcMain.handle('ai:getUsageLogs', async (_e, opts) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getUsageLogs', opts);
            const logs = AIAssistantService_1.default.getInstance().getUsageLogs(opts);
            return { success: true, logs };
        }
        catch (e) {
            return { success: false, error: e.message, logs: [] };
        }
    });
    electron_1.ipcMain.handle('ai:getUsageStats', async (_e, opts) => {
        try {
            if (isEmployeeMode())
                return await proxyToBossWithResult('ai:getUsageStats', opts);
            const stats = AIAssistantService_1.default.getInstance().getUsageStats(opts);
            return { success: true, stats };
        }
        catch (e) {
            return { success: false, error: e.message, stats: [] };
        }
    });
    // ─── AI Conversations (chat history persistence) ──────────────────────────
    electron_1.ipcMain.handle('ai:getOrCreateConversation', async (_e, { zaloId, threadId, assistantId }) => {
        try {
            const conv = DatabaseService_1.default.getInstance().getOrCreateAIConversation(zaloId, threadId, assistantId);
            return { success: true, conversation: conv };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('ai:getConversationMessages', async (_e, { conversationId }) => {
        try {
            const messages = DatabaseService_1.default.getInstance().getAIConversationMessages(conversationId);
            return { success: true, messages };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('ai:addConversationMessage', async (_e, { conversationId, role, content, segmentsJson }) => {
        try {
            DatabaseService_1.default.getInstance().addAIConversationMessage(conversationId, role, content, segmentsJson);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('ai:getConversations', async (_e, { zaloId, threadId }) => {
        try {
            const conversations = DatabaseService_1.default.getInstance().getAIConversations(zaloId, threadId);
            return { success: true, conversations };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('ai:deleteConversation', async (_e, { conversationId }) => {
        try {
            DatabaseService_1.default.getInstance().deleteAIConversation(conversationId);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
//# sourceMappingURL=aiAssistantIpc.js.map