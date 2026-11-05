"use strict";
/**
 * WebhookGatewayService - dedicated HTTP server for external webhooks.
 * Listens on port 9889 and routes incoming requests to registered handlers.
 *
 * Currently handles:
 *  - Workflow webhooks:  POST /api/workflow/webhook/{token}
 *
 * Design: kept separate from IntegrationRegistry's webhook server (port 9888)
 * to avoid regression. Can be merged into a unified gateway later.
 *
 * Usage:
 *   WebhookGatewayService.getInstance().start();
 *   WebhookGatewayService.getInstance().startTunnel();
 *   // → https://xxxx.trycloudflare.com/api/workflow/webhook/{token}
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const Logger_1 = __importDefault(require("../../utils/Logger"));
const TunnelService_1 = __importDefault(require("../tunnel/TunnelService"));
// Lazy import to avoid circular dependency at module load time
let WorkflowEngineService = null;
function getWorkflowEngine() {
    if (!WorkflowEngineService) {
        WorkflowEngineService = require('../workflow/WorkflowEngineService').default;
    }
    return WorkflowEngineService.getInstance();
}
class WebhookGatewayService {
    constructor() {
        this.server = null;
        this.port = 9889;
        this.running = false;
        this.tunnelActive = false;
        this.tunnelUrl = null;
        /** Registered exact-path route handlers */
        this.routes = new Map();
        /** Prefix-based route handlers - first match wins */
        this.prefixRoutes = [];
    }
    static getInstance() {
        if (!WebhookGatewayService.instance) {
            WebhookGatewayService.instance = new WebhookGatewayService();
        }
        return WebhookGatewayService.instance;
    }
    // ─── Lifecycle ──────────────────────────────────────────────────
    async start(port) {
        if (this.running) {
            return { success: true, port: this.port };
        }
        this.port = port || this.port;
        try {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));
            // Register built-in routes
            this.registerPrefixRoute('/api/workflow/webhook/', (req, res, parsed) => {
                this.handleWorkflowWebhook(req, res, parsed);
            });
            return new Promise((resolve) => {
                this.server.listen(this.port, '127.0.0.1', () => {
                    this.running = true;
                    Logger_1.default.log(`[WebhookGateway] ✅ Server listening on http://127.0.0.1:${this.port}`);
                    resolve({ success: true, port: this.port });
                });
                this.server.on('error', (err) => {
                    Logger_1.default.error(`[WebhookGateway] ❌ Server error: ${err.message}`);
                    resolve({ success: false, error: err.message });
                });
            });
        }
        catch (err) {
            Logger_1.default.error(`[WebhookGateway] Start error: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
    stop() {
        try {
            if (this.server) {
                this.server.close();
                this.server = null;
            }
            if (this.tunnelActive) {
                TunnelService_1.default.stop(this.port).catch(() => { });
                this.tunnelActive = false;
                this.tunnelUrl = null;
            }
            this.running = false;
            this.routes.clear();
            this.prefixRoutes = [];
            Logger_1.default.log('[WebhookGateway] Server stopped');
        }
        catch (err) {
            Logger_1.default.error(`[WebhookGateway] Stop error: ${err.message}`);
        }
    }
    // ─── Tunnel ──────────────────────────────────────────────────────
    async startTunnel() {
        if (!this.running) {
            return { success: false, error: 'Gateway server chưa được bật' };
        }
        try {
            const url = await TunnelService_1.default.start(this.port, 'Webhook Gateway');
            this.tunnelActive = true;
            this.tunnelUrl = url;
            Logger_1.default.log(`[WebhookGateway] 🌐 Tunnel active: ${url}`);
            TunnelService_1.default.onChange(this.port, (newUrl) => {
                this.tunnelUrl = newUrl;
                this.tunnelActive = !!newUrl;
            });
            return { success: true, tunnelUrl: url };
        }
        catch (err) {
            Logger_1.default.error(`[WebhookGateway] Tunnel start error: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
    async stopTunnel() {
        await TunnelService_1.default.stop(this.port);
        this.tunnelActive = false;
        this.tunnelUrl = null;
        return { success: true };
    }
    getStatus() {
        return {
            running: this.running,
            port: this.port,
            tunnelActive: this.tunnelActive,
            tunnelUrl: this.tunnelUrl,
        };
    }
    // ─── Route Registration ──────────────────────────────────────────
    /** Register an exact-path route handler */
    registerRoute(path, handler) {
        this.routes.set(path, handler);
        Logger_1.default.log(`[WebhookGateway] Registered route: ${path}`);
    }
    /** Unregister an exact-path route */
    unregisterRoute(path) {
        this.routes.delete(path);
        Logger_1.default.log(`[WebhookGateway] Unregistered route: ${path}`);
    }
    /** Register a prefix-based route handler (e.g. /api/workflow/webhook/) */
    registerPrefixRoute(prefix, handler) {
        this.prefixRoutes.push({ prefix, handler });
        Logger_1.default.log(`[WebhookGateway] Registered prefix route: ${prefix}`);
    }
    // ─── HTTP Router ─────────────────────────────────────────────────
    handleRequest(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Signature');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = req.url || '/';
        const pathname = url.split('?')[0];
        const queryStr = url.includes('?') ? url.split('?')[1] : '';
        const query = {};
        if (queryStr) {
            for (const part of queryStr.split('&')) {
                const [k, v] = part.split('=').map(decodeURIComponent);
                if (k)
                    query[k] = v || '';
            }
        }
        // Collect headers as plain object
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = Array.isArray(v) ? v.join(', ') : String(v || '');
        }
        const remoteIp = req.socket?.remoteAddress || '';
        // Parse body
        let bodyRaw = '';
        req.on('data', (chunk) => { bodyRaw += chunk.toString(); });
        req.on('end', () => {
            let body = {};
            try {
                body = bodyRaw ? JSON.parse(bodyRaw) : {};
            }
            catch {
                body = { raw: bodyRaw };
            }
            const parsed = {
                pathname,
                body,
                rawBody: bodyRaw,
                query,
                headers,
                method: req.method || 'GET',
                remoteIp,
            };
            // 1. Try exact match
            const exactHandler = this.routes.get(pathname);
            if (exactHandler) {
                exactHandler(req, res, parsed);
                return;
            }
            // 2. Try prefix match
            for (const { prefix, handler } of this.prefixRoutes) {
                if (pathname.startsWith(prefix)) {
                    handler(req, res, parsed);
                    return;
                }
            }
            // 3. Health check
            if (pathname === '/api/health' || pathname === '/') {
                this.json(res, 200, { status: 'ok', service: 'webhook-gateway', port: this.port });
                return;
            }
            // 4. Not found
            Logger_1.default.warn(`[WebhookGateway] Route not found: ${req.method} ${pathname}`);
            this.json(res, 404, { success: false, error: 'Route not found' });
        });
    }
    // ─── Workflow Webhook Handler ────────────────────────────────────
    handleWorkflowWebhook(req, res, parsed) {
        // Extract token from path: /api/workflow/webhook/{token}
        const parts = parsed.pathname.split('/').filter(Boolean);
        // parts = ['api', 'workflow', 'webhook', '{token}']
        const token = parts[3] || '';
        if (!token) {
            this.json(res, 400, { success: false, error: 'Missing webhook token' });
            return;
        }
        // Delegate to WorkflowEngine
        const engine = getWorkflowEngine();
        engine.handleWebhook(token, {
            method: parsed.method,
            body: parsed.body,
            headers: parsed.headers,
            query: parsed.query,
            rawBody: parsed.rawBody,
            remoteIp: parsed.remoteIp,
        }).then((result) => {
            this.json(res, result.status, result.body);
        }).catch((err) => {
            Logger_1.default.error(`[WebhookGateway] Workflow webhook error: ${err.message}`);
            this.json(res, 500, { success: false, error: 'Internal error' });
        });
    }
    // ─── Utility ─────────────────────────────────────────────────────
    json(res, status, data) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    getWebhookUrl() {
        return this.tunnelUrl ? `${this.tunnelUrl}/api/workflow/webhook` : null;
    }
}
exports.default = WebhookGatewayService;
//# sourceMappingURL=WebhookGatewayService.js.map