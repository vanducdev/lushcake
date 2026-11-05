"use strict";
/**
 * FacebookScanTabService.ts
 * Quản lý tab scan + data + request logs trong DB.
 * Mỗi tab = 1 phiên quét (có cài đặt, dữ liệu, lịch sử request).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookScanTabService = void 0;
const DatabaseService_1 = __importDefault(require("../database/DatabaseService"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
// ─── Service ─────────────────────────────────────────────────────────
class FacebookScanTabService {
    static init() {
        if (this.initialized)
            return;
        try {
            const db = DatabaseService_1.default.getInstance();
            // ⚠️ BẮT BUỘC: SQLite mặc định tắt foreign keys → CASCADE không hoạt động!
            db.run('PRAGMA foreign_keys = ON');
            db.exec(`
        CREATE TABLE IF NOT EXISTS fb_scan_tabs (
          id            TEXT PRIMARY KEY,
          account_id    TEXT NOT NULL,
          name          TEXT NOT NULL DEFAULT 'Scan',
          scan_type     TEXT NOT NULL,
          config        TEXT NOT NULL DEFAULT '{}',
          status        TEXT NOT NULL DEFAULT 'active',
          items_count   INTEGER DEFAULT 0,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scan_tabs_account ON fb_scan_tabs(account_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS fb_scan_tab_data (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          tab_id        TEXT NOT NULL,
          items         TEXT NOT NULL DEFAULT '[]',
          total_count   INTEGER DEFAULT 0,
          page_info     TEXT DEFAULT '{}',
          created_at    INTEGER NOT NULL,
          FOREIGN KEY (tab_id) REFERENCES fb_scan_tabs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scan_tab_data_tab ON fb_scan_tab_data(tab_id);

        CREATE TABLE IF NOT EXISTS fb_scan_tab_requests (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          tab_id          TEXT NOT NULL,
          request_payload TEXT DEFAULT '{}',
          response_preview TEXT DEFAULT '',
          status          TEXT NOT NULL DEFAULT 'error',
          error           TEXT DEFAULT '',
          items_count     INTEGER DEFAULT 0,
          created_at      INTEGER NOT NULL,
          FOREIGN KEY (tab_id) REFERENCES fb_scan_tabs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scan_tab_reqs_tab ON fb_scan_tab_requests(tab_id, created_at DESC);
      `);
            this.initialized = true;
            Logger_1.default.log('[ScanTab] Tables initialized');
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] Init error: ${err.message}`);
        }
    }
    // ─── Tab CRUD ─────────────────────────────────────────────────
    static saveTab(tab) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            const existing = db.queryOne('SELECT id FROM fb_scan_tabs WHERE id = ?', [tab.id]);
            if (existing) {
                // Tab đã tồn tại → UPDATE, không chạm updated_at (tránh xáo trộn thứ tự)
                db.run(`
          UPDATE fb_scan_tabs SET account_id = ?, name = ?, scan_type = ?, config = ?,
            status = ?, items_count = ?
          WHERE id = ?
        `, [tab.accountId, tab.name, tab.scanType, tab.config, tab.status, tab.itemsCount, tab.id]);
            }
            else {
                // Tab mới → INSERT với created_at và updated_at
                db.run(`
          INSERT INTO fb_scan_tabs (id, account_id, name, scan_type, config, status, items_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [tab.id, tab.accountId, tab.name, tab.scanType, tab.config, tab.status, tab.itemsCount, tab.createdAt, tab.updatedAt]);
            }
            return true;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] SaveTab error: ${err.message}`);
            return false;
        }
    }
    static getTabs(accountId, status, limit = 100, offset = 0) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            let where = 'account_id = ?';
            const params = [accountId];
            if (status) {
                where += ' AND status = ?';
                params.push(status);
            }
            params.push(limit, offset);
            const tabs = db.query(`SELECT * FROM fb_scan_tabs WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, params);
            const countParams = [accountId];
            if (status)
                countParams.push(status);
            const totalRow = db.queryOne(`SELECT COUNT(*) as total FROM fb_scan_tabs WHERE account_id = ?${status ? ' AND status = ?' : ''}`, countParams);
            return {
                tabs: (tabs || []).map(this.mapTab),
                total: totalRow?.total || 0,
            };
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] GetTabs error: ${err.message}`);
            return { tabs: [], total: 0 };
        }
    }
    static getTab(id) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            const row = db.queryOne('SELECT * FROM fb_scan_tabs WHERE id = ?', [id]);
            return row ? this.mapTab(row) : null;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] GetTab error: ${err.message}`);
            return null;
        }
    }
    static updateTabStatus(id, status) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            db.run('UPDATE fb_scan_tabs SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
            return true;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] UpdateTabStatus error: ${err.message}`);
            return false;
        }
    }
    // Cập nhật updated_at khi người dùng kích hoạt tab (để đẩy lên đầu danh sách)
    static touchTab(id) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            db.run('UPDATE fb_scan_tabs SET updated_at = ? WHERE id = ?', [Date.now(), id]);
            return true;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] TouchTab error: ${err.message}`);
            return false;
        }
    }
    static deleteTab(id) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            // Explicit delete từ child tables (safety net nếu foreign_keys chưa bật)
            db.run('DELETE FROM fb_scan_tab_requests WHERE tab_id = ?', [id]);
            db.run('DELETE FROM fb_scan_tab_data WHERE tab_id = ?', [id]);
            // Xóa cả lịch sử scan liên quan đến tab này
            try {
                const { default: FacebookScanLogService } = require('./FacebookScanLogService');
                FacebookScanLogService.deleteByTabId(id);
            }
            catch { }
            // Xóa tab (CASCADE sẽ xóa nốt nếu foreign_keys đã bật)
            db.run('DELETE FROM fb_scan_tabs WHERE id = ?', [id]);
            return true;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] DeleteTab error: ${err.message}`);
            return false;
        }
    }
    // ─── Tab Data ─────────────────────────────────────────────────
    static saveTabData(tabId, items, pageInfo) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            // Xóa data cũ của tab trước khi lưu mới (chỉ giữ bản snapshot mới nhất)
            db.run('DELETE FROM fb_scan_tab_data WHERE tab_id = ?', [tabId]);
            db.run(`
        INSERT INTO fb_scan_tab_data (tab_id, items, total_count, page_info, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [tabId, JSON.stringify(items), items.length, JSON.stringify(pageInfo), Date.now()]);
            const row = db.queryOne('SELECT last_insert_rowid() as id');
            // Cập nhật items_count trong tab = số items hiện tại
            db.run('UPDATE fb_scan_tabs SET items_count = ?, updated_at = ? WHERE id = ?', [items.length, Date.now(), tabId]);
            return row?.id ?? null;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] SaveTabData error: ${err.message}`);
            return null;
        }
    }
    static getTabData(tabId, limit = 1) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            return db.query('SELECT * FROM fb_scan_tab_data WHERE tab_id = ? ORDER BY created_at DESC LIMIT ?', [tabId, limit]);
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] GetTabData error: ${err.message}`);
            return [];
        }
    }
    // ─── Request Logs ─────────────────────────────────────────────
    static saveRequestLog(tabId, log) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            db.run(`
        INSERT INTO fb_scan_tab_requests (tab_id, request_payload, response_preview, status, error, items_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [tabId, log.requestPayload, log.responsePreview, log.status, log.error || '', log.itemsCount || 0, Date.now()]);
            const row = db.queryOne('SELECT last_insert_rowid() as id');
            return row?.id ?? null;
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] SaveRequestLog error: ${err.message}`);
            return null;
        }
    }
    static getRequestLogs(tabId, limit = 50, offset = 0) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            const rows = db.query('SELECT * FROM fb_scan_tab_requests WHERE tab_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [tabId, limit, offset]);
            const totalRow = db.queryOne('SELECT COUNT(*) as total FROM fb_scan_tab_requests WHERE tab_id = ?', [tabId]);
            return { logs: rows || [], total: totalRow?.total || 0 };
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] GetRequestLogs error: ${err.message}`);
            return { logs: [], total: 0 };
        }
    }
    // ─── Stats ────────────────────────────────────────────────────
    static getStats(accountId) {
        try {
            this.init();
            const db = DatabaseService_1.default.getInstance();
            const totalTabs = db.queryOne('SELECT COUNT(*) as total FROM fb_scan_tabs WHERE account_id = ?', [accountId])?.total || 0;
            // Lấy tổng items từ fb_scan_tab_data (dữ liệu thật) thay vì items_count có thể sai
            const totalItems = db.queryOne(`
        SELECT COALESCE(SUM(td.total_count), 0) as total
        FROM fb_scan_tab_data td
        JOIN fb_scan_tabs t ON t.id = td.tab_id
        WHERE t.account_id = ? AND t.status != 'deleted'
      `, [accountId])?.total || 0;
            // Request counts từ fb_scan_tab_requests
            const successCount = db.queryOne(`
        SELECT COUNT(*) as total FROM fb_scan_tab_requests r
        JOIN fb_scan_tabs t ON r.tab_id = t.id
        WHERE t.account_id = ? AND t.status != 'deleted' AND r.status = 'success'
      `, [accountId])?.total || 0;
            const errorCount = db.queryOne(`
        SELECT COUNT(*) as total FROM fb_scan_tab_requests r
        JOIN fb_scan_tabs t ON r.tab_id = t.id
        WHERE t.account_id = ? AND t.status != 'deleted' AND r.status = 'error'
      `, [accountId])?.total || 0;
            const byTypeRows = db.query('SELECT scan_type, COUNT(*) as cnt FROM fb_scan_tabs WHERE account_id = ? AND status != \'deleted\' GROUP BY scan_type', [accountId]);
            const byType = {};
            for (const r of byTypeRows || [])
                byType[r.scan_type] = r.cnt;
            // Top tabs theo total_count thật từ fb_scan_tab_data
            const topTabs = db.query(`
        SELECT t.id, t.name, COALESCE(td.total_count, 0) as items_count
        FROM fb_scan_tabs t
        LEFT JOIN (
          SELECT tab_id, total_count FROM fb_scan_tab_data
          WHERE rowid IN (SELECT MAX(rowid) FROM fb_scan_tab_data GROUP BY tab_id)
        ) td ON td.tab_id = t.id
        WHERE t.account_id = ? AND t.status != 'deleted'
        ORDER BY items_count DESC LIMIT 5
      `, [accountId]) || [];
            return { totalTabs, totalItems, successCount, errorCount, byType, topTabs };
        }
        catch (err) {
            Logger_1.default.error(`[ScanTab] getStats error: ${err.message}`);
            return { totalTabs: 0, totalItems: 0, successCount: 0, errorCount: 0, byType: {}, topTabs: [] };
        }
    }
    // ─── Helper ───────────────────────────────────────────────────
    static mapTab(r) {
        return {
            id: r.id,
            accountId: r.account_id,
            name: r.name,
            scanType: r.scan_type,
            config: r.config,
            status: r.status,
            itemsCount: r.items_count,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}
exports.FacebookScanTabService = FacebookScanTabService;
FacebookScanTabService.initialized = false;
//# sourceMappingURL=FacebookScanTabService.js.map