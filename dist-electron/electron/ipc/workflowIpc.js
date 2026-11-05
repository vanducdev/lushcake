"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkflowIpc = registerWorkflowIpc;
const electron_1 = require("electron");
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const WorkflowEngineService_1 = __importDefault(require("../../src/services/workflow/WorkflowEngineService"));
const AppModeManager_1 = __importDefault(require("../../src/utils/AppModeManager"));
const WorkspaceManager_1 = __importDefault(require("../../src/utils/WorkspaceManager"));
const EmployeeService_1 = __importDefault(require("../../src/services/employee/EmployeeService"));
const uuid_1 = require("uuid");
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const WebhookGatewayService_1 = __importDefault(require("../../src/services/workflow/WebhookGatewayService"));
const TunnelService_1 = __importDefault(require("../../src/services/tunnel/TunnelService"));
function isEmployeeMode() {
    try {
        const activeWs = WorkspaceManager_1.default.getInstance().getActiveWorkspace();
        if (activeWs?.type === 'remote')
            return true;
    }
    catch { }
    return false;
}
/** Helper: row → Workflow shape (pageIds array) */
const channelConfig_1 = require("../../src/configs/channelConfig");
const normalizeWorkflowChannel = (channel) => (0, channelConfig_1.normalizeChannel)(channel);
function rowToWorkflow(r) {
    const pageIdsRaw = r.page_ids || r.page_id || '';
    const pageIds = pageIdsRaw.split(',').filter(Boolean);
    return {
        id: r.id, name: r.name, description: r.description || '',
        enabled: r.enabled === 1 || r.enabled === true,
        channel: normalizeWorkflowChannel(r.channel),
        pageId: pageIds[0] || '',
        pageIds,
        nodes: JSON.parse(r.nodes_json || '[]'),
        edges: JSON.parse(r.edges_json || '[]'),
        createdAt: r.created_at, updatedAt: r.updated_at,
    };
}
/** Get assigned zaloIds for the current employee, or null if not in employee mode */
function getEmployeeAssignedAccounts() {
    try {
        const mode = AppModeManager_1.default.getInstance().getMode();
        if (mode !== 'employee')
            return null;
        const employeeId = AppModeManager_1.default.getInstance().getEmployeeId();
        if (!employeeId)
            return null;
        const emp = EmployeeService_1.default.getInstance().getEmployeeById(employeeId);
        if (!emp?.assigned_accounts)
            return null;
        return typeof emp.assigned_accounts === 'string'
            ? JSON.parse(emp.assigned_accounts)
            : emp.assigned_accounts;
    }
    catch {
        return null;
    }
}
// ─── Helpers ──────────────────────────────────────────────────────────────
/** Generate a fresh UUID webhook token */
function generateWebhookToken() {
    return (0, uuid_1.v4)();
}
/** Check if a workflow has a trigger.webhook node */
function hasWebhookTrigger(nodes) {
    return nodes.some(n => n.type === "trigger.webhook");
}
/** Ensure webhook token exists on a trigger.webhook node config */
function ensureWebhookToken(nodes) {
    const hookNode = nodes.find(n => n.type === "trigger.webhook");
    if (!hookNode)
        return null;
    if (!hookNode.config)
        hookNode.config = {};
    if (!hookNode.config.webhookToken) {
        hookNode.config.webhookToken = generateWebhookToken();
    }
    return hookNode.config.webhookToken;
}
function registerWorkflowIpc() {
    // ── Label Event bridge REMOVED - now centralized in databaseIpc.ts and zaloIpc.ts ──
    // ─── List ─────────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:list', async () => {
        try {
            const rows = DatabaseService_1.default.getInstance().getWorkflows();
            if (isEmployeeMode())
                return { success: true, workflows: [] };
            let workflows = rows.map(rowToWorkflow);
            // Employee mode: filter workflows by assigned accounts
            const assignedAccounts = getEmployeeAssignedAccounts();
            if (assignedAccounts) {
                const accountSet = new Set(assignedAccounts);
                workflows = workflows.filter(wf => {
                    // Global workflows (no pageIds) - always show
                    if (wf.pageIds.length === 0)
                        return true;
                    // Only show workflows that include at least one assigned account
                    return wf.pageIds.some(id => accountSet.has(id));
                });
            }
            return { success: true, workflows };
        }
        catch (e) {
            return { success: false, error: e.message, workflows: [] };
        }
    });
    // ─── Get single ───────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:get', async (_e, { id }) => {
        try {
            if (isEmployeeMode())
                return { success: false, error: "Không khả dụng" };
            const row = DatabaseService_1.default.getInstance().getWorkflowById(id);
            if (!row)
                return { success: false, error: 'Not found' };
            return { success: true, workflow: rowToWorkflow(row) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Save ─────────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:save', async (_e, { workflow }) => {
        try {
            const now = Date.now();
            // Normalise pageIds: accept both pageIds[] and legacy pageId string
            const pageIds = Array.isArray(workflow.pageIds)
                ? workflow.pageIds.filter(Boolean)
                : (workflow.pageId ? [workflow.pageId] : []);
            const channel = normalizeWorkflowChannel(workflow.channel);
            const wf = {
                id: workflow.id || (0, uuid_1.v4)(),
                name: workflow.name || 'Workflow mới',
                description: workflow.description || '',
                enabled: workflow.enabled ?? true,
                channel,
                pageId: pageIds[0] || '',
                pageIds,
                nodes: workflow.nodes || [],
                edges: workflow.edges || [],
                createdAt: workflow.createdAt || now,
                updatedAt: now,
            };
            // Auto-generate webhook token if workflow has trigger.webhook
            let webhookToken = null;
            if (hasWebhookTrigger(wf.nodes)) {
                webhookToken = ensureWebhookToken(wf.nodes);
            }
            Logger_1.default.log(`[WorkflowIpc] Saving workflow id=${wf.id} name="${wf.name}" nodes=${wf.nodes.length} edges=${wf.edges.length} channel=${channel}`);
            DatabaseService_1.default.getInstance().saveWorkflow(wf);
            DatabaseService_1.default.getInstance().save();
            WorkflowEngineService_1.default.getInstance().reloadWorkflow(wf.id);
            return { success: true, id: wf.id, webhookToken };
        }
        catch (e) {
            Logger_1.default.error(`[WorkflowIpc] save error: ${e.message} | workflow=${JSON.stringify({ id: workflow?.id, name: workflow?.name })}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Delete ───────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:delete', async (_e, { id }) => {
        try {
            DatabaseService_1.default.getInstance().deleteWorkflow(id);
            DatabaseService_1.default.getInstance().save();
            WorkflowEngineService_1.default.getInstance().removeWorkflow(id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Toggle ───────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:toggle', async (_e, { id, enabled }) => {
        try {
            if (enabled) {
                const row = DatabaseService_1.default.getInstance().getWorkflowById(id);
                if (!row)
                    return { success: false, error: 'Not found' };
                const wf = rowToWorkflow(row);
                // FB workflows are now supported - no channel check needed
            }
            DatabaseService_1.default.getInstance().toggleWorkflow(id, enabled);
            DatabaseService_1.default.getInstance().save();
            WorkflowEngineService_1.default.getInstance().reloadWorkflow(id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Run manual ───────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:runManual', async (_e, { id, triggerData }) => {
        try {
            const row = DatabaseService_1.default.getInstance().getWorkflowById(id);
            if (!row)
                return { success: false, error: 'Not found' };
            const wf = rowToWorkflow(row);
            const log = await WorkflowEngineService_1.default.getInstance().executeWorkflow({ ...wf, enabled: true }, triggerData || {}, 'manual');
            return { success: true, log };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Clone workflow → target page ─────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:clone', async (_e, { id, targetZaloId }) => {
        try {
            const row = DatabaseService_1.default.getInstance().getWorkflowById(id);
            if (!row)
                return { success: false, error: 'Không tìm thấy workflow gốc' };
            const wf = rowToWorkflow(row);
            if (wf.channel !== 'zalo' && wf.channel !== 'facebook') {
                return { success: false, error: 'Chỉ có thể nhân bản workflow Zalo hoặc Facebook ở phiên bản hiện tại.' };
            }
            const newId = DatabaseService_1.default.getInstance().cloneWorkflow(id, targetZaloId);
            if (!newId)
                return { success: false, error: 'Không tìm thấy workflow gốc' };
            // Regenerate webhook token for cloned workflow if it has trigger.webhook
            const clonedRow = DatabaseService_1.default.getInstance().getWorkflowById(newId);
            if (clonedRow) {
                const clonedWf = rowToWorkflow(clonedRow);
                if (hasWebhookTrigger(clonedWf.nodes)) {
                    ensureWebhookToken(clonedWf.nodes);
                    DatabaseService_1.default.getInstance().saveWorkflow(clonedWf);
                }
            }
            DatabaseService_1.default.getInstance().save();
            WorkflowEngineService_1.default.getInstance().reloadWorkflow(newId);
            return { success: true, newId };
        }
        catch (e) {
            Logger_1.default.error(`[WorkflowIpc] clone error: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Clone ALL workflows from one page → another ──────────────────────────
    electron_1.ipcMain.handle('workflow:cloneAll', async (_e, { sourceZaloId, targetZaloId }) => {
        try {
            const count = DatabaseService_1.default.getInstance().cloneAllWorkflows(sourceZaloId, targetZaloId);
            DatabaseService_1.default.getInstance().save();
            // Reload engine for newly cloned workflows
            const rows = DatabaseService_1.default.getInstance().getWorkflows();
            for (const r of rows) {
                const ids = (r.page_ids || '').split(',').filter(Boolean);
                if (ids.includes(targetZaloId)) {
                    WorkflowEngineService_1.default.getInstance().reloadWorkflow(r.id);
                }
            }
            return { success: true, count };
        }
        catch (e) {
            Logger_1.default.error(`[WorkflowIpc] cloneAll error: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Get logs ─────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:getLogs', async (_e, { id, limit }) => {
        try {
            const logs = DatabaseService_1.default.getInstance().getWorkflowRunLogs(id, limit || 50);
            return { success: true, logs };
        }
        catch (e) {
            return { success: false, error: e.message, logs: [] };
        }
    });
    // ─── Delete logs ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:deleteLogs', async (_e, { id }) => {
        try {
            const db = DatabaseService_1.default.getInstance();
            db['run'](`DELETE FROM workflow_run_logs WHERE workflow_id=?`, [id]);
            DatabaseService_1.default.getInstance().save();
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Webhook: Get webhook URL ────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:getWebhookUrl', async (_e, { id }) => {
        try {
            const row = DatabaseService_1.default.getInstance().getWorkflowById(id);
            if (!row)
                return { success: false, error: 'Not found' };
            const wf = rowToWorkflow(row);
            const hookNode = wf.nodes.find(n => n.type === 'trigger.webhook');
            if (!hookNode)
                return { success: false, error: 'Workflow này không có trigger.webhook' };
            const token = hookNode.config?.webhookToken || '';
            const tunnelUrl = TunnelService_1.default.getUrl(9889);
            const webhookUrl = tunnelUrl ? tunnelUrl + '/api/workflow/webhook/' + token : null;
            return { success: true, webhookUrl, token, tunnelActive: !!tunnelUrl };
        }
        catch (e) {
            Logger_1.default.error('[WorkflowIpc] getWebhookUrl error: ' + e.message);
            return { success: false, error: e.message };
        }
    });
    // ─── Webhook: Gateway Tunnel ───────────────────────────────────────
    electron_1.ipcMain.handle('workflow:startTunnel', async () => {
        try {
            const result = await WebhookGatewayService_1.default.getInstance().startTunnel();
            return result;
        }
        catch (e) {
            Logger_1.default.error('[WorkflowIpc] startTunnel error: ' + e.message);
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('workflow:stopTunnel', async () => {
        try {
            const result = await WebhookGatewayService_1.default.getInstance().stopTunnel();
            return result;
        }
        catch (e) {
            Logger_1.default.error('[WorkflowIpc] stopTunnel error: ' + e.message);
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('workflow:getTunnelStatus', async () => {
        try {
            return { success: true, ...WebhookGatewayService_1.default.getInstance().getStatus() };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Webhook: Regenerate token ─────────────────────────────────────────
    electron_1.ipcMain.handle('workflow:regenerateWebhookToken', async (_e, { id }) => {
        try {
            const row = DatabaseService_1.default.getInstance().getWorkflowById(id);
            if (!row)
                return { success: false, error: 'Not found' };
            const wf = rowToWorkflow(row);
            const hookNode = wf.nodes.find(n => n.type === 'trigger.webhook');
            if (!hookNode)
                return { success: false, error: 'Workflow này không có trigger.webhook' };
            const newToken = generateWebhookToken();
            if (!hookNode.config)
                hookNode.config = {};
            hookNode.config.webhookToken = newToken;
            // Save updated node config back to DB
            DatabaseService_1.default.getInstance().saveWorkflow(wf);
            DatabaseService_1.default.getInstance().save();
            WorkflowEngineService_1.default.getInstance().reloadWorkflow(wf.id);
            const tunnelUrl = TunnelService_1.default.getUrl(9889);
            const webhookUrl = tunnelUrl ? tunnelUrl + '/api/workflow/webhook/' + newToken : null;
            return { success: true, webhookUrl, token: newToken };
        }
        catch (e) {
            Logger_1.default.error('[WorkflowIpc] regenerateWebhookToken error: ' + e.message);
            return { success: false, error: e.message };
        }
    });
    // ─── Webhook: Get/Set port config ─────────────────────────────────────
    electron_1.ipcMain.handle('workflow:getPortConfig', async () => {
        try {
            const db = DatabaseService_1.default.getInstance();
            const intPort = db.getSetting('webhook_port_integration');
            const wfPort = db.getSetting('webhook_port_workflow');
            return { success: true, integrationPort: intPort ? Number(intPort) : 9888, workflowPort: wfPort ? Number(wfPort) : 9889 };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('workflow:setPortConfig', async (_e, { key, port }) => {
        try {
            DatabaseService_1.default.getInstance().setSetting(key, String(port));
            DatabaseService_1.default.getInstance().save();
            return { success: true };
        }
        catch (e) {
            Logger_1.default.error('[WorkflowIpc] setPortConfig error: ' + e.message);
            return { success: false, error: e.message };
        }
    });
}
//# sourceMappingURL=workflowIpc.js.map