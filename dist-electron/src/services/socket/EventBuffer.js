"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class EventBuffer {
    constructor() {
        this.buffer = [];
        this.nextSeqId = 1;
        this.prunedCount = 0; // thống kê
    }
    /** Có thể cấu hình MAX_SIZE từ ngoài (cho test hoặc tuning) */
    static setMaxSize(size) {
        // Chỉ cho phép set trước khi có dữ liệu
        EventBuffer.MAX_SIZE = Math.max(100, Math.min(size, 50000));
    }
    /**
     * Thêm event vào buffer, trả về seqId
     */
    push(channel, data) {
        const seqId = this.nextSeqId++;
        const event = { seqId, channel, data, ts: Date.now() };
        this.buffer.push(event);
        // Giới hạn kích thước - shift cũ nhất
        if (this.buffer.length > EventBuffer.MAX_SIZE) {
            this.buffer.shift();
            this.prunedCount++;
        }
        return seqId;
    }
    /**
     * Lấy tất cả event có seqId > lastSeqId (dùng cho catch-up)
     * Nếu lastSeqId <= 0 → trả về toàn bộ buffer (initial sync)
     */
    getSince(lastSeqId) {
        if (lastSeqId <= 0)
            return [...this.buffer];
        // Tối ưu: binary search nếu buffer lớn
        // Hiện tại dùng filter tuyến tính (buffer <= 2000, negligible)
        return this.buffer.filter(e => e.seqId > lastSeqId);
    }
    /**
     * Số event hiện tại trong buffer
     */
    get size() {
        return this.buffer.length;
    }
    /**
     * Số event đã bị loại bỏ do buffer đầy
     */
    get totalPruned() {
        return this.prunedCount;
    }
    /**
     * Reset buffer (dùng khi test)
     */
    reset() {
        this.buffer = [];
        this.nextSeqId = 1;
        this.prunedCount = 0;
    }
}
EventBuffer.MAX_SIZE = 5000;
exports.default = EventBuffer;
//# sourceMappingURL=EventBuffer.js.map