"use strict";
/**
 * FacebookThreadManager.ts
 * Port t Python _features/_thread/* + _messaging/_message_requests.py
 * Qun l threads: ly danh sch, thay i tn/emoji/nickname
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getThreadList = getThreadList;
exports.getLastSeqId = getLastSeqId;
exports.parseThreadNodes = parseThreadNodes;
exports.getMessageRequests = getMessageRequests;
exports.changeThreadName = changeThreadName;
exports.changeThreadEmoji = changeThreadEmoji;
exports.changeNickname = changeNickname;
exports.fetchThreadMessages = fetchThreadMessages;
exports.addGroupAdmin = addGroupAdmin;
exports.removeGroupAdmin = removeGroupAdmin;
exports.changeApprovalMode = changeApprovalMode;
exports.approvePendingMember = approvePendingMember;
exports.getGroupLink = getGroupLink;
exports.setGroupLink = setGroupLink;
const axios_1 = __importDefault(require("axios"));
const FacebookUtils_1 = require("./FacebookUtils");
const FacebookGraphQLResult_1 = require("./FacebookGraphQLResult");
const Logger_1 = __importDefault(require("../../utils/Logger"));
const GRAPHQL_BATCH_URL = 'https://www.facebook.com/api/graphqlbatch/';
const GRAPHQL_URL = 'https://www.facebook.com/webgraphql/mutation/';
// Doc IDs t Facebook (tm t Python source)
const THREAD_LIST_DOC_ID = '3336396659757871';
const CHANGE_THREAD_NAME_DOC_ID = '1768656823415255';
const CHANGE_EMOJI_DOC_ID = '1498317363570230';
const CHANGE_NICKNAME_DOC_ID = '1349374845128082';
/**
 * Ly danh sch threads t INBOX
 * Tr v thread list + last_seq_id (cn cho MQTT)
 */
async function getThreadList(dataFB, tags = ['INBOX'], httpsAgent) {
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, { requireGraphql: false });
    form['queries'] = JSON.stringify({
        o0: {
            doc_id: THREAD_LIST_DOC_ID,
            query_params: {
                limit: 50,
                before: null,
                tags,
                includeDeliveryReceipts: false,
                includeSeqID: true,
            },
        },
    });
    const config = (0, FacebookUtils_1.buildPostConfig)(GRAPHQL_BATCH_URL, form, dataFB.cookieFacebook, undefined, httpsAgent);
    const response = await axios_1.default.post(config.url, config.data, {
        headers: config.headers,
        timeout: config.timeout,
        ...(httpsAgent ? { httpsAgent } : {}),
    });
    let responseText = response.data;
    // Strip Facebook's for(;;); XSS protection prefix
    if (typeof responseText === 'string') {
        responseText = responseText.replace(/^for\s*\(;;\);/, '').trim();
    }
    const dataGet = responseText.split('{"successful_results"')[0];
    const processingTime = 0;
    let last_seq_id = '0';
    let dataAllThread;
    try {
        const parsed = JSON.parse(dataGet);
        last_seq_id = String(parsed?.o0?.data?.viewer?.message_threads?.sync_sequence_id || '0');
        const nodes = parsed?.o0?.data?.viewer?.message_threads?.nodes || [];
        const threadIDList = [];
        const threadNameList = [];
        for (const node of nodes) {
            if (node?.thread_key?.thread_fbid) {
                threadIDList.push(node.thread_key.thread_fbid);
                threadNameList.push(node.name || '');
            }
        }
        dataAllThread = {
            threadIDList,
            threadNameList,
            countThread: threadIDList.length,
        };
    }
    catch (err) {
        Logger_1.default.warn(`[FacebookThreadManager] getThreadList parse error: ${err.message}`);
        dataAllThread = { threadIDList: [], threadNameList: [], countThread: 0, error: err.message };
    }
    return { dataGet, processingTime, last_seq_id, dataAllThread: dataAllThread };
}
/**
 * Ly last_seq_id cn thit khi ng MQTT listener
 */
async function getLastSeqId(dataFB, httpsAgent) {
    try {
        const result = await getThreadList(dataFB, undefined, httpsAgent);
        return result.last_seq_id;
    }
    catch (err) {
        Logger_1.default.warn(`[FacebookThreadManager] getLastSeqId error: ${err.message}`);
        return '0';
    }
}
/**
 * Parse thread nodes thnh FBThread array
 */
function parseThreadNodes(dataGet, accountId, fbUserId) {
    try {
        const parsed = JSON.parse(dataGet);
        const nodes = parsed?.o0?.data?.viewer?.message_threads?.nodes || [];
        return nodes.map((node) => {
            const threadId = node?.thread_key?.thread_fbid || node?.thread_key?.other_user_id;
            const isGroup = !!node?.thread_key?.thread_fbid;
            const participants = node?.all_participants?.edges || [];
            const selfId = String(fbUserId || accountId);
            const actorId = (edge) => String(edge?.node?.messaging_actor?.id || '');
            const actorAvatar = (actor) => actor?.big_image_src?.uri
                || actor?.profile_picture?.uri
                || actor?.profile_picture_url
                || actor?.image?.uri
                || '';
            let threadName = node.name || '';
            let avatarUrl = '';
            if (isGroup) {
                // Group: node.name is often null build from participant names (exclude self)
                if (!threadName) {
                    const otherNames = participants
                        .map((e) => e?.node?.messaging_actor)
                        .filter((a) => a?.id && String(a.id) !== selfId)
                        .map((a) => a?.name || '')
                        .filter(Boolean)
                        .slice(0, 4);
                    threadName = otherNames.length > 0 ? otherNames.join(', ') : 'Nhm khng tn';
                }
                // Group avatar: use thread image_src if available, else first participant avatar
                avatarUrl = node?.image?.uri || '';
                if (!avatarUrl && participants.length > 0) {
                    const firstOther = participants.find((e) => actorId(e) && actorId(e) !== selfId);
                    avatarUrl = actorAvatar(firstOther?.node?.messaging_actor);
                }
            }
            else {
                // 1:1: extract name + avatar from the other participant
                const otherUser = String(node?.thread_key?.other_user_id || '');
                const other = participants.find((e) => {
                    const id = actorId(e);
                    return id && id === otherUser && id !== selfId;
                }) || participants.find((e) => {
                    const id = actorId(e);
                    return id && id !== selfId;
                });
                const actor = other?.node?.messaging_actor;
                threadName = actor?.name || node?.name || '';
                // The thread image is Facebook's canonical image for a Page thread;
                // keep it as fallback when participant data is partial.
                avatarUrl = actorAvatar(actor) || node?.image?.uri || '';
            }
            if (!threadName)
                threadName = 'Khng c tn';
            // The persisted inbox query returns this as `unread_count` on current
            // Messenger responses. Keep the camelCase fallback for older payloads;
            // a missing field deliberately remains zero rather than reusing a stale
            // local badge from a previous process start.
            const rawUnreadCount = Number(node?.unread_count ?? node?.unreadCount ?? 0);
            const unreadCount = Number.isFinite(rawUnreadCount) && rawUnreadCount > 0
                ? Math.floor(rawUnreadCount)
                : 0;
            return {
                id: String(threadId || ''),
                account_id: accountId,
                name: threadName,
                type: isGroup ? 'group' : 'user',
                emoji: node?.customization_info?.emoji || undefined,
                participant_count: participants.length,
                last_message_preview: node?.last_message?.nodes?.[0]?.snippet || undefined,
                last_message_at: node?.updated_time_precise
                    ? Math.floor(parseInt(node.updated_time_precise) / 1000)
                    : undefined,
                unread_count: unreadCount,
                is_muted: false,
                metadata: avatarUrl ? { avatar_url: avatarUrl } : undefined,
            };
        }).filter((t) => t.id);
    }
    catch (err) {
        Logger_1.default.warn(`[FacebookThreadManager] parseThreadNodes error: ${err.message}`);
        return [];
    }
}
/**
 * Ly tin nhn ch (Pending inbox)
 */
async function getMessageRequests(dataFB, httpsAgent) {
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, { requireGraphql: false });
    form['queries'] = JSON.stringify({
        o0: {
            doc_id: THREAD_LIST_DOC_ID,
            query_params: {
                limit: 10000,
                before: null,
                tags: ['PENDING'],
                includeDeliveryReceipts: false,
                includeSeqID: true,
            },
        },
    });
    try {
        const config = (0, FacebookUtils_1.buildPostConfig)(GRAPHQL_BATCH_URL, form, dataFB.cookieFacebook, undefined, httpsAgent);
        const response = await axios_1.default.post(config.url, config.data, {
            headers: config.headers,
            timeout: config.timeout,
            ...(httpsAgent ? { httpsAgent } : {}),
        });
        const dataGet = JSON.parse(response.data.split('{"successful_results"')[0]);
        const pendingList = dataGet?.o0?.data?.viewer?.message_threads?.nodes || [];
        const result = [];
        for (const item of pendingList) {
            const over = item?.last_message?.nodes || [];
            if (over[0]) {
                result.push({
                    senderID: over[0]?.message_sender?.messaging_actor?.id || '',
                    snippet: over[0]?.snippet || '',
                    timestamp_precise: over[0]?.timestamp_precise || '',
                });
            }
        }
        return result;
    }
    catch (err) {
        Logger_1.default.warn(`[FacebookThreadManager] getMessageRequests error: ${err.message}`);
        return [];
    }
}
/**
 * i tn nh
 */
async function changeThreadName(dataFB, threadId, name, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'MessengerGroupNameChangeMutation',
        docId: CHANGE_THREAD_NAME_DOC_ID,
    });
    form['variables'] = JSON.stringify({ data: { name, thread_id: threadId } });
    try {
        const formBody = new URLSearchParams(form).toString();
        const response = await axios_1.default.post(GRAPHQL_URL, formBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': dataFB.cookieFacebook,
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://www.facebook.com',
                'Referer': 'https://www.facebook.com/',
            },
            timeout: 15000,
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('changeThreadName', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return true;
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] changeThreadName error: ${err.message}`);
        return false;
    }
}
/**
 * i emoji nh
 */
async function changeThreadEmoji(dataFB, threadId, emoji, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'MessengerCustomizationEmojiMutation',
        docId: CHANGE_EMOJI_DOC_ID,
    });
    form['variables'] = JSON.stringify({ data: { emoji, thread_id: threadId } });
    try {
        const formBody = new URLSearchParams(form).toString();
        const response = await axios_1.default.post(GRAPHQL_URL, formBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': dataFB.cookieFacebook,
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://www.facebook.com',
                'Referer': 'https://www.facebook.com/',
            },
            timeout: 15000,
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('changeThreadEmoji', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return true;
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] changeThreadEmoji error: ${err.message}`);
        return false;
    }
}
/**
 * i nickname thnh vin trong nh
 */
async function changeNickname(dataFB, threadId, userId, nickname, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'MessengerCustomizationNicknameMutation',
        docId: CHANGE_NICKNAME_DOC_ID,
    });
    form['variables'] = JSON.stringify({
        data: { nickname, participant_id: userId, thread_id: threadId },
    });
    try {
        const formBody = new URLSearchParams(form).toString();
        const response = await axios_1.default.post(GRAPHQL_URL, formBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': dataFB.cookieFacebook,
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://www.facebook.com',
                'Referer': 'https://www.facebook.com/',
            },
            timeout: 15000,
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('changeNickname', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return true;
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] changeNickname error: ${err.message}`);
        return false;
    }
}
/**
 * Ly tin nhn lch s t Facebook API (C7)
 * S dng GraphQL batch query (ging getThreadList). H tr cursor-based pagination.
 */
async function fetchThreadMessages(dataFB, threadId, limit = 50, beforeCursor, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const queryParams = {
        id: String(threadId),
        messageLimit: limit,
        loadMessages: true,
        loadAttachment: true,
        loadReactions: true,
    };
    if (beforeCursor) {
        queryParams.before = beforeCursor;
    }
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, { docId: '5587413956701165' });
    form['queries'] = JSON.stringify({
        o0: {
            doc_id: '5587413956701165',
            query_params: queryParams,
        },
    });
    try {
        const config = (0, FacebookUtils_1.buildPostConfig)(GRAPHQL_BATCH_URL, form, dataFB.cookieFacebook, undefined, httpsAgent);
        const response = await axios_1.default.post(config.url, config.data, {
            headers: config.headers,
            timeout: config.timeout,
            ...(httpsAgent ? { httpsAgent } : {}),
        });
        let responseText = response.data;
        if (typeof responseText === 'string') {
            responseText = responseText.replace(/^for\s*\(;;\);/, '').trim();
        }
        const dataGet = responseText.split('{"successful_results"')[0];
        const parsed = JSON.parse(dataGet);
        // Detect GraphQL-level errors
        if (parsed?.o0?.error) {
            const err = parsed.o0.error;
            const errMsg = err.summary || err.description || err.message || `GraphQL error`;
            Logger_1.default.warn(`[FB:fetchThreadMessages] GraphQL error: ${errMsg}. threadId=${threadId}`);
            return { success: false, messages: [], cursor: undefined, error: errMsg };
        }
        const thread = parsed?.o0?.data?.node || parsed?.o0?.data?.message_thread;
        const messageEdges = thread?.messages?.edges || [];
        const pageInfo = thread?.messages?.pageInfo || {};
        const messages = messageEdges.map((edge) => {
            const node = edge.node || edge;
            // Extract replied_to_message info (Facebook GraphQL field)
            const repliedNode = node.replied_to_message || node.repliedToMessage;
            const replyToMessageId = repliedNode?.message_id || repliedNode?.id || repliedNode?.messageMetadata?.messageId || undefined;
            const replyToSenderId = repliedNode?.message_sender?.id || repliedNode?.sender_id ||
                repliedNode?.messageMetadata?.actorFbId || undefined;
            return {
                id: node.message_id || node.id,
                body: node.body?.text || node.body || null,
                timestampMs: parseInt(node.timestamp_precise || node.timestamp || '0'),
                senderId: node.message_sender?.id || node.sender_id || '',
                senderName: node.message_sender?.name || node.sender_name || '',
                attachments: (node.blob_attachments || []).map((a) => ({
                    id: a.attachment_fbid || a.id,
                    type: a.__typename?.replace('Message', '').toLowerCase() || 'file',
                    url: a.large_preview?.uri || a.url || a.preview?.uri || null,
                    name: a.filename || a.name,
                    fileSize: a.filesize,
                    mimeType: a.content_type,
                })),
                reactions: (node.reactions?.nodes || []).map((r) => ({
                    userId: r.user?.id || '',
                    emoji: r.reaction || '',
                })),
                isUnsent: node.message_type === 'unsent',
                timestamp: parseInt(node.timestamp_precise || node.timestamp || '0'),
                replyToMessageId,
                replyToSenderId,
            };
        });
        return {
            success: true,
            messages,
            cursor: {
                before: pageInfo.startCursor,
                after: pageInfo.endCursor,
                hasMore: pageInfo.hasNextPage,
            },
        };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] fetchThreadMessages error: ${err.message}`);
        return { success: false, messages: [], error: err.message };
    }
}
/**
 * Thm admin cho nh (N3)
 */
async function addGroupAdmin(dataFB, threadId, userId) {
    return changeGroupAdminStatus(dataFB, threadId, userId, true);
}
/**
 * Xa admin khi nh (N3)
 */
async function removeGroupAdmin(dataFB, threadId, userId) {
    return changeGroupAdminStatus(dataFB, threadId, userId, false);
}
async function changeGroupAdminStatus(dataFB, threadId, userId, add) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometGroupAdminChangeMutation',
        docId: add ? '5257785392787132' : '2039160555321787',
    });
    form['variables'] = JSON.stringify({
        data: {
            thread_id: String(threadId),
            user_id: String(userId),
            admin_type: 'GROUP',
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
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)(add ? 'addGroupAdmin' : 'removeGroupAdmin', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] changeGroupAdmin error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
/**
 * i ch duyt thnh vin (N3)
 * approved: true = bt duyt, false = tt duyt
 */
async function changeApprovalMode(dataFB, threadId, approved, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometGroupApprovalMutation',
        docId: '1060150802166515',
    });
    form['variables'] = JSON.stringify({
        data: {
            thread_id: String(threadId),
            approval_mode: approved,
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
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('changeApprovalMode', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] changeApprovalMode error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
/**
 * Duy t chi thnh vin vo nh (N3)
 */
async function approvePendingMember(dataFB, threadId, userId, approve, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometGroupApprovePendingMemberMutation',
        docId: approve ? '2261853580790833' : '1205134861206560',
    });
    form['variables'] = JSON.stringify({
        data: {
            thread_id: String(threadId),
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
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('approvePendingMember', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] approvePendingMember error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
/**
 * Ly link mi nh (N3)
 */
async function getGroupLink(dataFB, threadId, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometGroupLinkQuery',
        docId: '2212560156192546',
    });
    form['variables'] = JSON.stringify({
        data: {
            thread_id: String(threadId),
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
        });
        const parsed = (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data);
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('getGroupLink', parsed);
        const link = parsed?.data?.node?.group?.group_invite_link?.url
            || parsed?.data?.group?.invite_link;
        return { success: true, link: link ? String(link) : undefined };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] getGroupLink error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
/**
 * t link mi nh (N3)
 */
async function setGroupLink(dataFB, threadId, enable, httpsAgent) {
    await (0, FacebookUtils_1.rateLimitDelay)();
    const form = (0, FacebookUtils_1.buildFormData)(dataFB, {
        friendlyName: 'CometGroupSetLinkMutation',
        docId: enable ? '1737162272258162' : '4417237731557110',
    });
    form['variables'] = JSON.stringify({
        data: {
            thread_id: String(threadId),
            enable,
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
        });
        (0, FacebookGraphQLResult_1.assertFacebookMutationSuccess)('setGroupLink', (0, FacebookGraphQLResult_1.parseFacebookResponse)(response.data));
        return { success: true };
    }
    catch (err) {
        Logger_1.default.error(`[FacebookThreadManager] setGroupLink error: ${err.message}`);
        return { success: false, error: err.message };
    }
}
//# sourceMappingURL=FacebookThreadManager.js.map