"use strict";
/**
 * FacebookCreateNotes.ts
 * Port từ Python _messaging/_createNotes.py
 * Tạo và chia sẻ Messenger Notes (24h)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNote = createNote;
const axios_1 = __importDefault(require("axios"));
const FacebookUtils_1 = require("./FacebookUtils");
const FacebookGraphQLResult_1 = require("./FacebookGraphQLResult");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const GRAPHQL_URL = 'https://www.facebook.com/webgraphql/mutation/';
/**
 * Tạo Messenger Note mới (N2)
 * Notes là tin nhắn tự hủy sau 24h, hiển thị ở đầu inbox.
 */
async function createNote(dataFB, text, backgroundColor, textColor, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometCreateNoteMutation',
        docId: '7370547589079803',
    });
    form['variables'] = JSON.stringify({
        data: {
            note_text: text,
            background_color: backgroundColor || '#FFC300',
            text_color: textColor || '#000000',
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
            timeout: 30000, ...(httpsAgent ? { httpsAgent } : {}),
        });
        const parsed = (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data);
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('createNote', parsed);
        const noteId = parsed?.data?.note_create?.note?.id;
        return { success: true, noteId: noteId ? String(noteId) : undefined };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookCreateNotes] createNote error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
//# sourceMappingURL=FacebookCreateNotes.js.map