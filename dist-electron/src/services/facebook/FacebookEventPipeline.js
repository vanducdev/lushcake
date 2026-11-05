"use strict";
/**
 * FacebookEventPipeline.ts
 * Phase 5: Sequential event queue per account.
 *
 * Guarantees:
 * - Events processed one-at-a-time (no parallel DB mutations)
 * - Stale generation events discarded
 * - Bounded queue with priority-based dropping
 * - Duplicate events (same messageId) deduped by durable identity
 * - Stop/close flushes or cancels cleanly
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventPriority = exports.FacebookEventPipeline = void 0;
const Logger_1 = __importDefault(require("../../utils/Logger"));
const FacebookMetrics_1 = require("./FacebookMetrics");
/** Priority levels — lower = more important, dropped first when queue is full */
var EventPriority;
(function (EventPriority) {
    EventPriority[EventPriority["LOW"] = 0] = "LOW";
    EventPriority[EventPriority["NORMAL"] = 1] = "NORMAL";
    EventPriority[EventPriority["HIGH"] = 2] = "HIGH";
})(EventPriority || (exports.EventPriority = EventPriority = {}));
/** Max queue size before dropping low-priority events */
const MAX_QUEUE_SIZE = 500;
/** Only message-critical events may use the emergency headroom. */
const MAX_CRITICAL_QUEUE_SIZE = 2000;
/** Dedup window — events with same ID within this window are dropped */
const DEDUP_WINDOW_MS = 5000;
class FacebookEventPipeline {
    constructor(accountId) {
        this.queue = [];
        this.processing = false;
        this.currentGeneration = 0;
        /** Seen event IDs for dedup — auto-cleaned */
        this.seenEvents = new Map();
        /** IDs waiting in the queue; do not mark them durable until processing succeeds. */
        this.queuedEventIds = new Set();
        this.seenCleanupTimer = null;
        /** Metrics */
        this.droppedCount = 0;
        this.processedCount = 0;
        this.accountId = accountId;
        // Clean seen events every 30s
        this.seenCleanupTimer = setInterval(() => this.cleanSeenEvents(), 30000);
    }
    /**
     * Set the current generation. Events from older generations are discarded.
     */
    setGeneration(gen) {
        this.currentGeneration = gen;
        // Discard stale events from old generations
        const before = this.queue.length;
        this.queue = this.queue.filter(e => e.generation >= gen);
        if (before !== this.queue.length) {
            Logger_1.default.log(`[EventPipeline:${this.accountId}] Discarded ${before - this.queue.length} stale events (gen < ${gen})`);
        }
    }
    /**
     * Enqueue an event for sequential processing.
     * Returns false if the event was dropped (queue full + low priority, or duplicate).
     */
    enqueue(id, priority, generation, processFn) {
        // Discard stale generation
        if (generation < this.currentGeneration) {
            Logger_1.default.log(`[EventPipeline:${this.accountId}] Discarded stale event gen=${generation} < current=${this.currentGeneration}`);
            return false;
        }
        // Dedup by durable identity
        const now = Date.now();
        const lastSeen = this.seenEvents.get(id);
        if (this.queuedEventIds.has(id) || (lastSeen && (now - lastSeen) < DEDUP_WINDOW_MS)) {
            Logger_1.default.log(`[EventPipeline:${this.accountId}] Deduped event id=${id}`);
            return false;
        }
        // Bounded queue — drop low-priority when full
        if (this.queue.length >= MAX_QUEUE_SIZE) {
            // Try to drop a low-priority event to make room
            const lowIdx = this.queue.findIndex(e => e.priority <= EventPriority.LOW);
            if (lowIdx >= 0) {
                this.queue.splice(lowIdx, 1);
                this.droppedCount++;
                (0, FacebookMetrics_1.metricInc)('fb_event_queue_drop_low_priority', this.accountId);
                Logger_1.default.warn(`[EventPipeline:${this.accountId}] Queue full - dropped LOW priority event`);
            }
            else {
                // Queue full of NORMAL/HIGH events — still drop this one if it's low priority
                if (priority <= EventPriority.LOW) {
                    this.droppedCount++;
                    Logger_1.default.warn(`[EventPipeline:${this.accountId}] Queue full of important events - dropping this LOW event`);
                    return false;
                }
                // Never silently evict a reaction/edit/message to admit another
                // important event. Use bounded emergency headroom; once exhausted the
                // caller is told explicitly so it can trigger recovery/catch-up.
                if (this.queue.length >= MAX_CRITICAL_QUEUE_SIZE) {
                    this.droppedCount++;
                    (0, FacebookMetrics_1.metricInc)('fb_event_processing_failure', this.accountId, { reason: 'critical_queue_overflow' });
                    Logger_1.default.error(`[EventPipeline:${this.accountId}] Critical queue overflow; recovery is required`);
                    return false;
                }
            }
        }
        this.queuedEventIds.add(id);
        this.queue.push({
            id,
            generation,
            priority,
            process: processFn,
            receivedAt: now,
        });
        this.drain();
        return true;
    }
    /**
     * Stop accepting new events. Existing events are drained or cancelled.
     * @param cancel If true, discard remaining queue. If false, drain.
     */
    async stop(cancel = false) {
        if (cancel) {
            this.queue = [];
        }
        else {
            // Wait for queue to drain (with timeout)
            const deadline = Date.now() + 10000;
            while (this.processing && this.queue.length > 0 && Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 100));
            }
        }
        if (this.seenCleanupTimer) {
            clearInterval(this.seenCleanupTimer);
            this.seenCleanupTimer = null;
        }
        Logger_1.default.log(`[EventPipeline:${this.accountId}] Stopped. Processed=${this.processedCount} Dropped=${this.droppedCount}`);
    }
    /**
     * Get current queue depth for monitoring.
     */
    getDepth() {
        return this.queue.length;
    }
    async drain() {
        if (this.processing)
            return;
        this.processing = true;
        while (this.queue.length > 0) {
            const event = this.queue.shift();
            // Double-check generation before processing
            if (event.generation < this.currentGeneration) {
                continue;
            }
            try {
                await event.process();
                this.seenEvents.set(event.id, Date.now());
                this.processedCount++;
            }
            catch (err) {
                (0, FacebookMetrics_1.metricInc)('fb_event_processing_failure', this.accountId, { eventTypeId: event.id.slice(0, 20) });
                Logger_1.default.error(`[EventPipeline:${this.accountId}] Event ${event.id} failed: ${err.message}`);
                // Don't let one failed event kill the queue
            }
            finally {
                this.queuedEventIds.delete(event.id);
            }
        }
        this.processing = false;
    }
    cleanSeenEvents() {
        const now = Date.now();
        for (const [id, ts] of this.seenEvents) {
            if (now - ts > DEDUP_WINDOW_MS * 2) {
                this.seenEvents.delete(id);
            }
        }
    }
}
exports.FacebookEventPipeline = FacebookEventPipeline;
//# sourceMappingURL=FacebookEventPipeline.js.map