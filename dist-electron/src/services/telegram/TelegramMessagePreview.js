"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTelegramMessagePreview = getTelegramMessagePreview;
/**
 * Text used outside the message detail (conversation rows, notifications and
 * workflow/webhook payloads). A caption remains the message content, but must
 * never make a media message look like a plain-text message.
 */
function getTelegramMessagePreview(msgType, content) {
    switch (String(msgType || 'text').toLowerCase()) {
        case 'photo': return '🖼️ Hình ảnh';
        case 'video': return '🎬 Video';
        case 'video_note': return '🎥 Video tròn';
        case 'audio': return '🎵 Tin nhắn thoại';
        case 'voice': return '🎤 Tin nhắn thoại';
        case 'sticker': return '🎨 Nhãn dán';
        case 'file':
        case 'document': return '📎 Tệp đính kèm';
        case 'telegram.contact': return '👤 Liên hệ';
        case 'telegram.location': return '📍 Vị trí';
        case 'telegram.venue': return '📍 Địa điểm';
        case 'telegram.poll': return '📊 Bình chọn';
        case 'telegram.dice': return '🎲 Xúc xắc';
        case 'telegram.game': return '🎮 Trò chơi';
        case 'telegram.invoice': return '🧾 Hóa đơn';
        case 'telegram.story': return '📖 Tin';
        case 'telegram.giveaway': return '🎁 Giveaway';
        case 'telegram.webpage': return '🔗 Liên kết';
        default: return String(content || '').trim();
    }
}
//# sourceMappingURL=TelegramMessagePreview.js.map