"use strict";
/**
 * FacebookBlock.ts
 * Port từ Python _features/_facebook/_block.py
 * Block/unblock user trên Facebook Messenger
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockUser = blockUser;
exports.unblockUser = unblockUser;
const axios_1 = __importDefault(require("axios"));
const FacebookUtils_1 = require("./FacebookUtils");
const FacebookGraphQLResult_1 = require("./FacebookGraphQLResult");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const GRAPHQL_URL = 'https://www.facebook.com/webgraphql/mutation/';
/**
 * Chặn người dùng trên Facebook Messenger (N4)
 */
async function blockUser(dataFB, userId, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometUserBlockMutation',
        docId: '5222223392500896',
    });
    form['variables'] = JSON.stringify({
        data: {
            user_id: String(userId),
            client_mutation_id: '1',
            actor_id: dataFB.FacebookID,
        }
    });
    form['dpr'] = '1';
    try {
        const formBody = new URLSearchParams(form).toString();
        const response = await axios_1.default.post(GRAPHQL_URL, formBody, {
            headers: {
                'Host': 'www.facebook.com',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://www.facebook.com',
                'Referer': 'https://www.facebook.com/',
                'Cookie': dataFB.cookieFacebook,
            },
            timeout: 30000,
            ...(httpsAgent ? { httpsAgent } : {}),
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('blockUser', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookBlock] blockUser error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
/**
 * Bỏ chặn người dùng trên Facebook Messenger (N4)
 */
async function unblockUser(dataFB, userId, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometUserUnblockMutation',
        docId: '5930977328125598',
    });
    form['variables'] = JSON.stringify({
        data: {
            user_id: String(userId),
            client_mutation_id: '1',
            actor_id: dataFB.FacebookID,
        }
    });
    form['dpr'] = '1';
    try {
        const formBody = new URLSearchParams(form).toString();
        const response = await axios_1.default.post(GRAPHQL_URL, formBody, {
            headers: {
                'Host': 'www.facebook.com',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://www.facebook.com',
                'Referer': 'https://www.facebook.com/',
                'Cookie': dataFB.cookieFacebook,
            },
            timeout: 30000,
            ...(httpsAgent ? { httpsAgent } : {}),
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('unblockUser', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookBlock] unblockUser error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
//# sourceMappingURL=FacebookBlock.js.map