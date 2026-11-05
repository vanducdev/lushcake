"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCRMChannelDecision = getCRMChannelDecision;
exports.validateCampaignForChannel = validateCampaignForChannel;
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const channelConfig_1 = require("../../configs/channelConfig");
function getCRMChannelDecision(accountId, action) {
    const account = DatabaseService_1.default.getInstance().getAccounts().find(a => a.zalo_id === accountId);
    const channel = (0, channelConfig_1.normalizeChannel)(account?.channel);
    const capability = (0, channelConfig_1.getCapability)(channel);
    const allowed = action === 'campaign' || action === 'campaign_message'
        ? capability.supportsCampaigns
        : action === 'campaign_media'
            ? capability.supportsCampaigns && capability.supportsImage
            : action === 'history'
                ? capability.supportsCRMHistory
                : capability.supportsCRMGroups;
    return allowed
        ? { allowed: true, channel }
        : { allowed: false, channel, reason: `${capability.label} không hỗ trợ tính năng CRM này` };
}
/** Telegram deliberately supports message campaigns only.  Do not silently
 * downgrade Zalo-only campaign types such as friend request or group invite. */
function validateCampaignForChannel(accountId, campaign) {
    const decision = getCRMChannelDecision(accountId, 'campaign');
    if (!decision.allowed)
        return decision;
    if ((decision.channel === 'telegram_user' || decision.channel === 'telegram_bot')
        && (campaign?.campaign_type || 'message') !== 'message') {
        return { allowed: false, channel: decision.channel, reason: 'Telegram chỉ hỗ trợ chiến dịch gửi tin nhắn trong CRM' };
    }
    return decision;
}
//# sourceMappingURL=CRMChannelCapabilityService.js.map