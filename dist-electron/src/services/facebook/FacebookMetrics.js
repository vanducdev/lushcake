"use strict";
/**
 * FacebookMetrics.ts
 * Phase 8: Lightweight in-memory counters for Facebook bridge observability.
 *
 * Logs structured metadata for each counter increment.
 * No external dependencies — works in Electron main process.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricInc = metricInc;
exports.metricGet = metricGet;
exports.metricSnapshot = metricSnapshot;
const Logger_1 = __importDefault(require("../../utils/Logger"));
const counters = new Map();
/**
 * Increment a metric counter. Logs at WARN level for abnormal metrics.
 */
function metricInc(name, accountId, extra) {
    const current = (counters.get(name) || 0) + 1;
    counters.set(name, current);
    // Log structured metadata (no PII — accountId is UUID, not FB ID)
    const meta = extra ? ` ${JSON.stringify(extra)}` : '';
    Logger_1.default.warn(`[METRIC] ${name}=${current}${accountId ? ` acct=${accountId.slice(0, 8)}` : ''}${meta}`);
}
/**
 * Get current value of a metric counter (for dashboards/health checks).
 */
function metricGet(name) {
    return counters.get(name) || 0;
}
/**
 * Get all counters as a snapshot (for health check endpoint).
 */
function metricSnapshot() {
    const snap = {};
    for (const [k, v] of counters) {
        snap[k] = v;
    }
    return snap;
}
//# sourceMappingURL=FacebookMetrics.js.map