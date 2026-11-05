"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * SocketIOClient - Employee-side Socket.IO client.
 *
 * Replaces the SSE connection for real-time event delivery.
 * - Connects to Boss Socket.IO server (attach to same port, path /socket.io)
 * - Authenticates via JWT token
 * - Auto-reconnects with Socket.IO built-in (không watchdog, không code tay)
 * - Tracks lastSeqId for catch-up on reconnect
 * - Forwards received events to EventBroadcaster.sendDirect
 *
 * Integration:
 *   HttpClientService.connect() → this.connect(bossUrl, token)
 *   HttpClientService.disconnect() → this.disconnect()
 */
const socket_io_client_1 = require("socket.io-client");
const Logger_1 = __importDefault(require("../../utils/Logger"));
class SocketIOClient {
    constructor() {
        this.socket = null;
        this.bossUrl = '';
        this.token = '';
        this.workspaceId = '';
        /** SeqId của event cuối cùng đã nhận (dùng cho catch-up khi reconnect) */
        this.lastSeqId = 0;
        /** Callback khi nhận event từ Boss */
        this.onEvent = null;
        /** Callback khi trạng thái kết nối thay đổi */
        this.onStatusChange = null;
    }
    /**
     * Kết nối đến Boss Socket.IO server.
     * Socket.IO tự động:
     * - Dùng WebSocket nếu khả dụng, fallback xuống HTTP polling
     * - Ping/pong để phát hiện mất kết nối
     * - Auto-reconnect với exponential backoff
     * - Buffer events trong quá trình reconnect
     */
    connect(bossUrl, token) {
        this.disconnect();
        this.bossUrl = bossUrl;
        this.token = token;
        this.lastSeqId = 0;
        Logger_1.default.log(`[SocketIOClient] Connecting to ${bossUrl}...`);
        this.socket = (0, socket_io_client_1.io)(bossUrl, {
            path: '/socket.io',
            auth: { token },
            // Ưu tiên WebSocket, fallback polling cho tunnel
            transports: ['websocket', 'polling'],
            // Auto-reconnect
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 15000,
            randomizationFactor: 0.5,
            timeout: 20000,
            // Giảm memory
            forceNew: true,
        });
        // ─── Connected ───────────────────────────────────────────────
        this.socket.on('connect', () => {
            Logger_1.default.log(`[SocketIOClient] 🟢 Connected to ${this.bossUrl} (id=${this.socket?.id})`);
            this.onStatusChange?.(true);
            // Catch-up: xin lại event đã miss khi offline
            // lastSeqId có thể = 0 (lần đầu) → Boss gửi toàn bộ buffer
            this.socket?.emit('catch-up', { lastSeqId: this.lastSeqId });
        });
        // ─── Event từ Boss ──────────────────────────────────────────
        this.socket.on('event', (payload) => {
            if (!payload || !payload.channel)
                return;
            // Track seqId
            if (payload.seqId > this.lastSeqId) {
                this.lastSeqId = payload.seqId;
            }
            // Forward đến handler (handlePushedEvent trong HttpClientService)
            this.onEvent?.(payload.channel, payload.data);
        });
        // ─── Disconnected ───────────────────────────────────────────
        this.socket.on('disconnect', (reason) => {
            Logger_1.default.log(`[SocketIOClient] 🔴 Disconnected from ${this.bossUrl}: ${reason}`);
            this.onStatusChange?.(false);
        });
        // ─── Connect error ──────────────────────────────────────────
        this.socket.on('connect_error', (err) => {
            Logger_1.default.warn(`[SocketIOClient] Connection error: ${err.message}`);
            this.onStatusChange?.(false);
        });
        // ─── Error ──────────────────────────────────────────────────
        this.socket.on('error', (err) => {
            Logger_1.default.warn(`[SocketIOClient] Error: ${err.message}`);
        });
    }
    /**
     * Ngắt kết nối
     */
    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.socket = null;
        }
        this.lastSeqId = 0;
    }
    /**
     * Kiểm tra trạng thái kết nối
     */
    isConnected() {
        return this.socket?.connected ?? false;
    }
    // ─── Callbacks ────────────────────────────────────────────────
    setOnEvent(cb) {
        this.onEvent = cb;
    }
    setOnStatusChange(cb) {
        this.onStatusChange = cb;
    }
    setWorkspaceId(id) {
        this.workspaceId = id;
    }
    /** Reset seqId (dùng khi reconnect toàn bộ) */
    resetSeqId() {
        this.lastSeqId = 0;
    }
}
exports.default = SocketIOClient;
//# sourceMappingURL=SocketIOClient.js.map