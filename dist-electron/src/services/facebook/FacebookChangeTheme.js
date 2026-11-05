"use strict";
/**
 * FacebookChangeTheme.ts
 * Port từ Python _messaging/_changeTheme.py
 * Đổi theme (màu/gradient) cho hội thoại Facebook Messenger
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEME_DARK = exports.THEME_LIGHT = void 0;
exports.changeThreadTheme = changeThreadTheme;
const axios_1 = __importDefault(require("axios"));
const FacebookUtils_1 = require("./FacebookUtils");
const FacebookGraphQLResult_1 = require("./FacebookGraphQLResult");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const GRAPHQL_URL = 'https://www.facebook.com/webgraphql/mutation/';
const THEME_LIGHT = 'light';
exports.THEME_LIGHT = THEME_LIGHT;
const THEME_DARK = 'dark';
exports.THEME_DARK = THEME_DARK;
/**
 * Đổi theme cho hội thoại Facebook Messenger (N1)
 *
 * @param theme - Gradient color ID hoặc 'light'/'dark'. Ví dụ:
 *   '1408628207129185' = gradient xanh dương
 *   'light' = theme mặc định
 *   'dark' = dark mode
 */
async function changeThreadTheme(dataFB, threadId, theme, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometChangeThemeMutation',
        docId: '5557418956951811',
    });
    form['variables'] = JSON.stringify({
        data: {
            theme: String(theme),
            thread_id: String(threadId),
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
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('changeThreadTheme', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookChangeTheme] error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
//# sourceMappingURL=FacebookChangeTheme.js.map