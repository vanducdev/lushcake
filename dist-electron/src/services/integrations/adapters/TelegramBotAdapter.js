"use strict";
/**
 * TelegramBotAdapter.ts - Integration adapter cho Telegram Bot API
 *
 * Lưu botToken encrypted, validate qua getMe, gửi tin nhắn qua sendMessage.
 * Dùng chung cho: notify.telegram node + trigger.telegramCommand (Phase 1C).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramBotAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const IntegrationAdapter_1 = require("../IntegrationAdapter");
const TELEGRAM_API = 'https://api.telegram.org';
const REQUEST_TIMEOUT = 10000;
class TelegramBotAdapter extends IntegrationAdapter_1.IntegrationAdapter {
    constructor(config) {
        super(config);
        this.type = 'telegram_bot';
        this.name = 'Telegram Bot';
    }
    get botToken() {
        return this.config.credentials?.botToken || '';
    }
    get apiBase() {
        return `${TELEGRAM_API}/bot${this.botToken}`;
    }
    /**
     * Validate bot token bằng cách gọi getMe
     */
    async testConnection() {
        if (!this.botToken) {
            return { success: false, message: 'Thiếu Bot Token' };
        }
        try {
            const res = await axios_1.default.get(`${this.apiBase}/getMe`, { timeout: REQUEST_TIMEOUT });
            if (res.data?.ok) {
                const bot = res.data.result;
                return {
                    success: true,
                    message: `Kết nối thành công! Bot: @${bot.username} (${bot.first_name})`,
                };
            }
            return { success: false, message: 'Token không hợp lệ' };
        }
        catch (err) {
            const msg = err.response?.data?.description || err.message || 'Lỗi kết nối';
            return { success: false, message: `Lỗi: ${msg}` };
        }
    }
    /**
     * Gửi tin nhắn qua Telegram Bot API
     */
    async executeAction(action, params) {
        switch (action) {
            case 'sendMessage':
                return this.sendMessage(params.chatId, params.text, params.parseMode);
            case 'getMe':
                return this.getMe();
            case 'getUpdates':
                return this.getUpdates(params.offset, params.limit, params.timeout);
            default:
                throw new Error(`Action không hỗ trợ: ${action}`);
        }
    }
    /**
     * Gửi tin nhắn
     */
    async sendMessage(chatId, text, parseMode) {
        const payload = {
            chat_id: chatId,
            text,
        };
        if (parseMode)
            payload.parse_mode = parseMode;
        const res = await axios_1.default.post(`${this.apiBase}/sendMessage`, payload, { timeout: REQUEST_TIMEOUT });
        return {
            success: true,
            messageId: res.data.result?.message_id || '',
        };
    }
    /**
     * Lấy thông tin bot
     */
    async getMe() {
        const res = await axios_1.default.get(`${this.apiBase}/getMe`, { timeout: REQUEST_TIMEOUT });
        return res.data?.result;
    }
    /**
     * Lấy updates (dùng cho polling)
     */
    async getUpdates(offset, limit, timeout) {
        const params = {};
        if (offset !== undefined)
            params.offset = offset;
        if (limit !== undefined)
            params.limit = limit;
        if (timeout !== undefined)
            params.timeout = timeout;
        const res = await axios_1.default.get(`${this.apiBase}/getUpdates`, {
            params,
            timeout: (timeout || 30) * 1000 + 5000, // timeout + 5s buffer
        });
        return res.data?.result || [];
    }
}
exports.TelegramBotAdapter = TelegramBotAdapter;
//# sourceMappingURL=TelegramBotAdapter.js.map