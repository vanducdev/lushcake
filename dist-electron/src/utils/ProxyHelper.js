"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProxyUrl = buildProxyUrl;
exports.createProxyAgent = createProxyAgent;
const Logger_1 = __importDefault(require("./Logger"));
/**
 * Tạo proxy URL từ cấu hình proxy.
 * Format: protocol://user:pass@host:port
 */
function buildProxyUrl(proxy) {
    const auth = proxy.username
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
        : '';
    return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
}
/**
 * Tạo proxy agent tương thích với zca-js (agent option trong Zalo constructor).
 * Dùng proxy-agent để tự động nhận diện HTTP/HTTPS/SOCKS4/SOCKS5.
 * Trả về undefined nếu proxy là null/undefined hoặc nếu tạo thất bại.
 */
function createProxyAgent(proxy) {
    if (!proxy)
        return undefined;
    const proxyUrl = buildProxyUrl(proxy);
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ProxyAgent } = require('proxy-agent');
        Logger_1.default.log(`[ProxyHelper] Creating proxy agent for ${proxy.host}:${proxy.port} (${proxy.name}) type=${proxy.type}`);
        // getProxyForUrl callback - proxy-agent auto-detects HTTP/HTTPS/SOCKS from URL protocol
        return new ProxyAgent({
            getProxyForUrl: () => proxyUrl
        });
    }
    catch (err) {
        Logger_1.default.error(`[ProxyHelper] Failed to create proxy agent for "${proxy.name}": ${err.message}`);
        return undefined;
    }
}
//# sourceMappingURL=ProxyHelper.js.map