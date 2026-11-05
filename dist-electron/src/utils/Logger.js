"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const MAX_BUFFER = 2000; // giữ 2000 dòng gần nhất trong RAM
// Giữ tham chiếu console gốc để tránh đệ quy khi hook console toàn cục.
const rawConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
};
class Logger {
    constructor() {
        this.isEnabled = false;
        this.buffer = [];
        this.listener = null;
        this.consoleHooked = false;
        // Buffer luôn ghi (kể cả production) để tab Nhật ký xem được;
        // isEnabled chỉ điều khiển việc in ra console.
        this.isEnabled = process.env.NODE_ENV !== 'production';
    }
    /**
     * Hook console.* toàn cục để mọi console thẳng (không qua Logger) cũng vào buffer.
     * Gọi 1 lần ở main process. Dùng rawConsole để in ra → không đệ quy.
     */
    installConsoleHook() {
        if (this.consoleHooked)
            return;
        this.consoleHooked = true;
        const levels = ['log', 'error', 'warn', 'info', 'debug'];
        for (const level of levels) {
            console[level] = (...args) => {
                this.record(level, args);
                rawConsole[level](...args);
            };
        }
    }
    /** Đăng ký 1 listener (main process forward sang renderer). */
    onEntry(cb) { this.listener = cb; }
    /** Lấy toàn bộ buffer hiện có (dùng khi mở tab lần đầu). */
    getBuffer() { return this.buffer; }
    /** Xóa buffer. */
    clearBuffer() { this.buffer = []; }
    record(level, args) {
        const msg = args.map(a => {
            if (typeof a === 'string')
                return a;
            try {
                return JSON.stringify(a);
            }
            catch {
                return String(a);
            }
        }).join(' ');
        const entry = { ts: Date.now(), level, msg };
        this.buffer.push(entry);
        if (this.buffer.length > MAX_BUFFER)
            this.buffer.shift();
        try {
            this.listener?.(entry);
        }
        catch { /* listener lỗi không được làm sập log */ }
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    /**
     * Enable logging
     * Bật logging
     */
    enable() {
        this.isEnabled = true;
        rawConsole.log(`[${new Date().toISOString()}] [Logger] ✅ Logging enabled`);
    }
    /**
     * Disable logging
     * Tắt logging
     */
    disable() {
        rawConsole.log(`[${new Date().toISOString()}] [Logger] 🔇 Logging disabled`);
        this.isEnabled = false;
    }
    /**
     * Check if logging is enabled
     * Kiểm tra xem logging có được bật không
     */
    isLoggingEnabled() {
        return this.isEnabled;
    }
    /**
     * Get status
     * Lấy trạng thái
     */
    getStatus() {
        return {
            enabled: this.isEnabled,
            environment: process.env.NODE_ENV || 'development'
        };
    }
    /**
     * Log info message (only if enabled)
     * Ghi log thông tin (chỉ khi được bật)
     */
    log(...args) {
        this.record('log', args);
        if (this.isEnabled) {
            rawConsole.log(...args);
        }
    }
    /**
     * Log error message (always shown, even when disabled)
     * Ghi log lỗi (luôn hiển thị, ngay cả khi tắt)
     */
    error(...args) {
        this.record('error', args);
        rawConsole.error(...args);
    }
    /**
     * Log warning message (only if enabled)
     * Ghi log cảnh báo (chỉ khi được bật)
     */
    warn(...args) {
        this.record('warn', args);
        if (this.isEnabled) {
            rawConsole.warn(...args);
        }
    }
    /**
     * Log info message (only if enabled)
     * Ghi log thông tin (chỉ khi được bật)
     */
    info(...args) {
        this.record('info', args);
        if (this.isEnabled) {
            rawConsole.info(...args);
        }
    }
    /**
     * Log debug message (only if enabled)
     * Ghi log debug (chỉ khi được bật)
     */
    debug(...args) {
        this.record('debug', args);
        if (this.isEnabled) {
            rawConsole.debug(...args);
        }
    }
}
exports.default = Logger.getInstance();
//# sourceMappingURL=Logger.js.map