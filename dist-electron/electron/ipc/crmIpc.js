"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCRMIpc = registerCRMIpc;
const electron_1 = require("electron");
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const CRMQueueService_1 = __importDefault(require("../../src/services/crm/CRMQueueService"));
const EventBroadcaster_1 = __importDefault(require("../../src/services/event/EventBroadcaster"));
const AppModeManager_1 = __importDefault(require("../../src/utils/AppModeManager"));
const WorkspaceManager_1 = __importDefault(require("../../src/utils/WorkspaceManager"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const proxyHelper_1 = require("./proxyHelper");
const CRMChannelCapabilityService_1 = require("../../src/services/crm/CRMChannelCapabilityService");
function isEmployeeMode() {
    try {
        const activeWs = WorkspaceManager_1.default.getInstance().getActiveWorkspace();
        if (activeWs?.type === 'remote')
            return true;
    }
    catch { }
    return false;
}
function registerCRMIpc() {
    // ─── Notes ─────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('crm:getNotes', async (_e, { zaloId, contactId }) => {
        try {
            if (isEmployeeMode())
                return { success: true, notes: [] };
            return { success: true, notes: DatabaseService_1.default.getInstance().getCRMNotes(zaloId, contactId) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:saveNote', async (_e, { zaloId, note }) => {
        try {
            if (isEmployeeMode())
                (0, proxyHelper_1.proxyToBoss)('crm:saveNote', { zaloId, note });
            const id = DatabaseService_1.default.getInstance().saveCRMNote({ ...note, owner_zalo_id: zaloId });
            DatabaseService_1.default.getInstance().save();
            EventBroadcaster_1.default.emit('crm:noteChanged', { action: 'save', ownerZaloId: zaloId, id, note });
            (0, proxyHelper_1.proxyToBoss)('crm:saveNote', { zaloId, note });
            return { success: true, id };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:deleteNote', async (_e, { zaloId, noteId }) => {
        try {
            if (isEmployeeMode())
                (0, proxyHelper_1.proxyToBoss)('crm:deleteNote', { zaloId, noteId });
            DatabaseService_1.default.getInstance().deleteCRMNote(noteId, zaloId);
            DatabaseService_1.default.getInstance().save();
            EventBroadcaster_1.default.emit('crm:noteChanged', { action: 'delete', ownerZaloId: zaloId, noteId });
            (0, proxyHelper_1.proxyToBoss)('crm:deleteNote', { zaloId, noteId });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Contacts ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('crm:getContacts', async (_e, { zaloId, opts }) => {
        try {
            if (isEmployeeMode())
                return { success: true, contacts: [], total: 0 };
            return { success: true, ...DatabaseService_1.default.getInstance().getCRMContacts(zaloId, opts || {}) };
        }
        catch (e) {
            return { success: false, error: e.message, contacts: [], total: 0 };
        }
    });
    electron_1.ipcMain.handle('crm:getContactStats', async (_e, { zaloId }) => {
        try {
            if (isEmployeeMode())
                return { success: true, total: 0, friendCount: 0, noteCount: 0 };
            return { success: true, ...DatabaseService_1.default.getInstance().getContactStats(zaloId) };
        }
        catch (e) {
            return { success: false, error: e.message, total: 0, friendCount: 0, noteCount: 0 };
        }
    });
    // ─── Campaigns ─────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('crm:getCampaigns', async (_e, { zaloId }) => {
        try {
            if (isEmployeeMode())
                return { success: true, campaigns: [] };
            const capability = (0, CRMChannelCapabilityService_1.getCRMChannelDecision)(zaloId, 'campaign');
            if (!capability.allowed)
                return { success: true, campaigns: [] };
            return { success: true, campaigns: DatabaseService_1.default.getInstance().getCRMCampaigns(zaloId) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:saveCampaign', async (_e, { zaloId, campaign }) => {
        try {
            const capability = (0, CRMChannelCapabilityService_1.validateCampaignForChannel)(zaloId, campaign);
            if (!capability.allowed)
                return { success: false, error: capability.reason };
            const id = DatabaseService_1.default.getInstance().saveCRMCampaign({ ...campaign, owner_zalo_id: zaloId });
            DatabaseService_1.default.getInstance().save();
            EventBroadcaster_1.default.emit('crm:campaignChanged', { action: 'save', ownerZaloId: zaloId, id, campaign });
            // Upload embedded campaign images to Boss so they exist on Boss filesystem
            if (AppModeManager_1.default.getInstance().getMode() === 'employee' && campaign?.template_message) {
                try {
                    const parsed = typeof campaign.template_message === 'string'
                        ? JSON.parse(campaign.template_message)
                        : campaign.template_message;
                    if (parsed?.blocks && Array.isArray(parsed.blocks)) {
                        let hasChanges = false;
                        for (const block of parsed.blocks) {
                            if (block.images && block.images.length > 0) {
                                const bossPaths = await (0, proxyHelper_1.uploadEmployeeMedia)(block.images, zaloId);
                                block.images = bossPaths;
                                hasChanges = true;
                            }
                        }
                        if (hasChanges) {
                            campaign.template_message = typeof campaign.template_message === 'string'
                                ? JSON.stringify(parsed)
                                : parsed;
                        }
                    }
                }
                catch (uploadErr) {
                    Logger_1.default.warn(`[crmIpc] Upload campaign images failed: ${uploadErr.message}`);
                }
            }
            (0, proxyHelper_1.proxyToBoss)('crm:saveCampaign', { zaloId, campaign });
            return { success: true, id };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:deleteCampaign', async (_e, { zaloId, campaignId }) => {
        try {
            DatabaseService_1.default.getInstance().deleteCRMCampaign(campaignId, zaloId);
            DatabaseService_1.default.getInstance().save();
            EventBroadcaster_1.default.emit('crm:campaignChanged', { action: 'delete', ownerZaloId: zaloId, campaignId });
            (0, proxyHelper_1.proxyToBoss)('crm:deleteCampaign', { zaloId, campaignId });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:cloneCampaign', async (_e, { zaloId, campaignId, includeContacts, newName }) => {
        try {
            const db = DatabaseService_1.default.getInstance();
            const source = db.getCRMCampaign(campaignId);
            if (!source || source.owner_zalo_id !== zaloId)
                return { success: false, error: 'Không tìm thấy chiến dịch' };
            const capability = (0, CRMChannelCapabilityService_1.validateCampaignForChannel)(zaloId, source);
            if (!capability.allowed)
                return { success: false, error: capability.reason };
            const newId = db.cloneCRMCampaign(campaignId, zaloId, includeContacts, newName);
            if (!newId)
                return { success: false, error: 'Không thể nhân bản chiến dịch' };
            db.save();
            EventBroadcaster_1.default.emit('crm:campaignChanged', { action: 'clone', ownerZaloId: zaloId, campaignId: newId });
            (0, proxyHelper_1.proxyToBoss)('crm:cloneCampaign', { zaloId, campaignId, includeContacts, newName });
            return { success: true, id: newId };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:updateCampaignStatus', async (_e, { campaignId, status }) => {
        try {
            const db = DatabaseService_1.default.getInstance();
            const existing = db.getCRMCampaign(campaignId);
            if (!existing)
                return { success: false, error: 'Không tìm thấy chiến dịch' };
            const capability = (0, CRMChannelCapabilityService_1.validateCampaignForChannel)(existing.owner_zalo_id, existing);
            if (!capability.allowed)
                return { success: false, error: capability.reason };
            db.updateCRMCampaignStatus(campaignId, status);
            db.save();
            // Start/stop queue
            const campaign = db.getCRMCampaign(campaignId);
            if (campaign) {
                if (status === 'active')
                    CRMQueueService_1.default.getInstance().startForAccount(campaign.owner_zalo_id);
                else if (status === 'paused' || status === 'done')
                    CRMQueueService_1.default.getInstance().checkAndStopIfIdle(campaign.owner_zalo_id);
                EventBroadcaster_1.default.emit('crm:campaignChanged', { action: 'status', ownerZaloId: campaign.owner_zalo_id, campaignId, status });
                (0, proxyHelper_1.proxyToBoss)('crm:updateCampaignStatus', { campaignId, status });
            }
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:addCampaignContacts', async (_e, { zaloId, campaignId, contacts }) => {
        try {
            const campaign = DatabaseService_1.default.getInstance().getCRMCampaign(campaignId);
            if (!campaign || campaign.owner_zalo_id !== zaloId)
                return { success: false, error: 'Không tìm thấy chiến dịch' };
            const capability = (0, CRMChannelCapabilityService_1.validateCampaignForChannel)(zaloId, campaign);
            if (!capability.allowed)
                return { success: false, error: capability.reason };
            DatabaseService_1.default.getInstance().addCampaignContacts(campaignId, zaloId, contacts);
            DatabaseService_1.default.getInstance().save();
            EventBroadcaster_1.default.emit('crm:campaignChanged', { action: 'contactsAdded', ownerZaloId: zaloId, campaignId });
            (0, proxyHelper_1.proxyToBoss)('crm:addCampaignContacts', { zaloId, campaignId, contacts });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:getCampaignContacts', async (_e, { campaignId }) => {
        try {
            return { success: true, contacts: DatabaseService_1.default.getInstance().getCampaignContacts(campaignId) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:deleteCampaignContacts', async (_e, { campaignId, contactIds }) => {
        try {
            DatabaseService_1.default.getInstance().deleteCampaignContacts(campaignId, contactIds);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:deleteAllCampaignContacts', async (_e, { campaignId }) => {
        try {
            DatabaseService_1.default.getInstance().deleteAllCampaignContacts(campaignId);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Send Log ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('crm:getSendLog', async (_e, { zaloId, opts }) => {
        try {
            const capability = (0, CRMChannelCapabilityService_1.getCRMChannelDecision)(zaloId, 'history');
            if (!capability.allowed)
                return { success: true, logs: [] };
            return { success: true, logs: DatabaseService_1.default.getInstance().getSendLog(zaloId, opts || {}) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:getCampaignStats', async (_e, { zaloId, limit }) => {
        try {
            return { success: true, stats: DatabaseService_1.default.getInstance().getTopCampaignStats(zaloId, limit || 10) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('crm:getActivityStats', async (_e, { zaloId, sinceTs, untilTs }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getActivityStats(zaloId, sinceTs, untilTs) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Queue status ──────────────────────────────────────────────────────────
    electron_1.ipcMain.handle('crm:getQueueStatus', async (_e, { zaloId }) => {
        try {
            return { success: true, status: CRMQueueService_1.default.getInstance().getStatus(zaloId) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Analytics / Reporting ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('analytics:dashboardOverview', async (_e, { zaloId, sinceTs, untilTs, threadType }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getDashboardOverview(zaloId, sinceTs, untilTs, threadType) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:messageVolume', async (_e, { zaloId, sinceTs, untilTs, granularity, threadType }) => {
        try {
            return { success: true, data: DatabaseService_1.default.getInstance().getMessageVolume(zaloId, sinceTs, untilTs, granularity, threadType) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:peakHours', async (_e, { zaloId, sinceTs, untilTs, threadType }) => {
        try {
            return { success: true, data: DatabaseService_1.default.getInstance().getPeakHoursHeatmap(zaloId, sinceTs, untilTs, threadType) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:contactGrowth', async (_e, { zaloId, sinceTs, untilTs }) => {
        try {
            return { success: true, data: DatabaseService_1.default.getInstance().getContactGrowth(zaloId, sinceTs, untilTs) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:contactSegmentation', async (_e, { zaloId }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getContactSegmentation(zaloId) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:campaignComparison', async (_e, { zaloId }) => {
        try {
            return { success: true, data: DatabaseService_1.default.getInstance().getCampaignComparison(zaloId) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:friendRequests', async (_e, { zaloId, sinceTs, untilTs }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getFriendRequestAnalytics(zaloId, sinceTs, untilTs) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:workflowAnalytics', async (_e, { zaloId, sinceTs, untilTs }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getWorkflowAnalytics(zaloId, sinceTs, untilTs) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:aiAnalytics', async (_e, { sinceTs, untilTs }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getAIAnalytics(sinceTs, untilTs) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:responseTime', async (_e, { zaloId, sinceTs, untilTs, threadType }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getResponseTimeStats(zaloId, sinceTs, untilTs, threadType) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('analytics:labelUsage', async (_e, { zaloId, sinceTs, untilTs }) => {
        try {
            return { success: true, ...DatabaseService_1.default.getInstance().getLabelUsageAnalytics(zaloId, sinceTs, untilTs) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
//# sourceMappingURL=crmIpc.js.map