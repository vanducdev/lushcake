"use strict";
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
exports.proxyToBoss = proxyToBoss;
exports.uploadEmployeeMedia = uploadEmployeeMedia;
const AppModeManager_1 = __importDefault(require("../../src/utils/AppModeManager"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Fire-and-forget proxy: send a DB/CRM mutation to the Boss when running in Employee mode.
 * The Boss executes the same IPC handler on its own DB, then relays the resulting
 * event back to all connected employees via SSE.
 *
 * In Boss / standalone mode this is a no-op.
 */
function proxyToBoss(channel, params) {
    try {
        if (AppModeManager_1.default.getInstance().getMode() !== 'employee')
            return;
        const WsMgr = require('../../src/utils/WorkspaceManager').default;
        const activeWs = WsMgr.getInstance().getActiveWorkspace();
        if (!activeWs || activeWs.type !== 'remote')
            return;
        const HCM = require('../../src/services/http/HttpConnectionManager').default;
        if (!HCM.getInstance().isConnected(activeWs.id))
            return;
        HCM.getInstance().proxyAction(activeWs.id, channel, params).catch((err) => {
            Logger_1.default.warn(`[proxyToBoss] ${channel} failed: ${err.message}`);
        });
    }
    catch { }
}
/**
 * Upload media files from Employee machine to Boss machine.
 * Used when Employee's local file path is not valid on Boss (cross-platform paths).
 * Each file is read on Employee, sent as base64 via HTTP, saved on Boss,
 * and the Boss-resolved absolute path is returned.
 *
 * @param filePaths  - Local file paths on Employee machine
 * @param zaloId     - Zalo account ID for organizing media storage on Boss
 * @returns Boss-resolved absolute file paths (preserves order)
 */
async function uploadEmployeeMedia(filePaths, zaloId) {
    if (AppModeManager_1.default.getInstance().getMode() !== 'employee')
        return filePaths;
    const WsMgr = require('../../src/utils/WorkspaceManager').default;
    const activeWs = WsMgr.getInstance().getActiveWorkspace();
    if (!activeWs || activeWs.type !== 'remote')
        throw new Error('Không kết nối tới Boss');
    const HCM = require('../../src/services/http/HttpConnectionManager').default;
    const client = HCM.getInstance().getServiceForWorkspace(activeWs.id);
    if (!client)
        throw new Error('Không kết nối tới Boss');
    const bossPaths = new Array(filePaths.length);
    // Upload parallel all files để giảm thời gian chờ (nhất là khi gửi nhiều ảnh)
    const uploadTasks = filePaths.map(async (fp, index) => {
        if (!fp) {
            bossPaths[index] = fp;
            return;
        }
        if (!fs.existsSync(fp)) {
            Logger_1.default.warn(`[uploadEmployeeMedia] File not found on Employee: ${fp}`);
            bossPaths[index] = fp;
            return;
        }
        const buffer = fs.readFileSync(fp);
        const filename = path.basename(fp);
        try {
            const result = await client.uploadMedia(buffer, filename, zaloId);
            if (result.success && result.bossPath) {
                bossPaths[index] = result.bossPath;
                Logger_1.default.log(`[uploadEmployeeMedia] ✅ ${fp} → ${result.bossPath}`);
            }
            else {
                throw new Error(result.error || 'Upload thất bại');
            }
        }
        catch (err) {
            throw new Error(`Không thể upload file ${fp}: ${err.message}`);
        }
    });
    await Promise.all(uploadTasks);
    return bossPaths;
}
//# sourceMappingURL=proxyHelper.js.map