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
exports.registerLockScreenIpc = registerLockScreenIpc;
const electron_1 = require("electron");
const bcrypt = __importStar(require("bcryptjs"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const DatabaseService_1 = __importDefault(require("../../src/services/database/DatabaseService"));
const Logger_1 = __importDefault(require("../../src/utils/Logger"));
const BCRYPT_ROUNDS = 12;
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30000; // 30s cooldown after 5 failed attempts
// Track failed attempts in memory (resets on app restart)
let failedAttempts = 0;
let cooldownUntil = 0;
/** Generate a 24-char recovery key formatted as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
function generateRecoveryKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0,O,1,I)
    const segments = [];
    for (let i = 0; i < 6; i++) {
        let seg = '';
        for (let j = 0; j < 4; j++) {
            seg += chars[crypto.randomBytes(1)[0] % chars.length];
        }
        segments.push(seg);
    }
    return segments.join('-');
}
function registerLockScreenIpc() {
    const db = () => DatabaseService_1.default.getInstance();
    // ─── Get lock screen status ──────────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:status', async () => {
        try {
            const enabled = db().getSetting('lock_screen_enabled') === '1';
            const biometricEnabled = db().getSetting('lock_screen_biometric') === '1';
            const biometricAvailable = checkBiometricAvailable();
            const now = Date.now();
            const isCoolingDown = now < cooldownUntil;
            const remainingCooldown = isCoolingDown ? Math.ceil((cooldownUntil - now) / 1000) : 0;
            return { success: true, enabled, biometricEnabled, biometricAvailable, failedAttempts, isCoolingDown, remainingCooldown };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Setup lock screen password ─────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:setup', async (_event, { password }) => {
        try {
            if (!password || password.length < 4) {
                return { success: false, error: 'Mật khẩu phải có ít nhất 4 ký tự' };
            }
            const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            db().setSetting('lock_screen_hash', hash);
            db().setSetting('lock_screen_enabled', '1');
            // Generate and encrypt recovery key
            const recoveryKey = generateRecoveryKey();
            if (electron_1.safeStorage.isEncryptionAvailable()) {
                const encrypted = electron_1.safeStorage.encryptString(recoveryKey).toString('base64');
                db().setSetting('lock_screen_recovery', encrypted);
            }
            else {
                // Fallback: store base64-encoded (less secure but functional)
                db().setSetting('lock_screen_recovery', Buffer.from(recoveryKey).toString('base64'));
            }
            failedAttempts = 0;
            cooldownUntil = 0;
            Logger_1.default.log('[LockScreen] Password set up successfully');
            return { success: true, recoveryKey };
        }
        catch (e) {
            Logger_1.default.error(`[LockScreen] setup error: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Verify password ────────────────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:verify', async (_event, { password }) => {
        try {
            const now = Date.now();
            if (now < cooldownUntil) {
                const remaining = Math.ceil((cooldownUntil - now) / 1000);
                return { success: false, error: `Đã quá số lần thử. Vui lòng chờ ${remaining} giây.`, cooldownRemaining: remaining };
            }
            const hash = db().getSetting('lock_screen_hash');
            if (!hash)
                return { success: false, error: 'Chưa đặt mật khẩu' };
            const valid = await bcrypt.compare(password, hash);
            if (valid) {
                failedAttempts = 0;
                cooldownUntil = 0;
                Logger_1.default.log('[LockScreen] Password verified');
                return { success: true };
            }
            failedAttempts++;
            if (failedAttempts >= MAX_ATTEMPTS) {
                cooldownUntil = Date.now() + COOLDOWN_MS;
                Logger_1.default.warn(`[LockScreen] Max attempts reached, cooling down for ${COOLDOWN_MS / 1000}s`);
                return { success: false, error: `Sai mật khẩu ${MAX_ATTEMPTS} lần. Vui lòng chờ ${COOLDOWN_MS / 1000} giây.`, cooldownRemaining: COOLDOWN_MS / 1000 };
            }
            return { success: false, error: `Sai mật khẩu. Còn ${MAX_ATTEMPTS - failedAttempts} lần thử.`, failedAttempts };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Verify recovery key ────────────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:verifyRecovery', async (_event, { recoveryKey }) => {
        try {
            const encrypted = db().getSetting('lock_screen_recovery');
            if (!encrypted)
                return { success: false, error: 'Không có recovery key' };
            let storedKey;
            if (electron_1.safeStorage.isEncryptionAvailable()) {
                storedKey = electron_1.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
            }
            else {
                storedKey = Buffer.from(encrypted, 'base64').toString('utf8');
            }
            if (recoveryKey.trim().toUpperCase() === storedKey.toUpperCase()) {
                failedAttempts = 0;
                cooldownUntil = 0;
                Logger_1.default.log('[LockScreen] Recovery key verified');
                return { success: true };
            }
            return { success: false, error: 'Recovery key không đúng' };
        }
        catch (e) {
            Logger_1.default.error(`[LockScreen] verifyRecovery error: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
    // ─── Change password ────────────────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:changePassword', async (_event, { oldPassword, newPassword }) => {
        try {
            const hash = db().getSetting('lock_screen_hash');
            if (!hash)
                return { success: false, error: 'Chưa đặt mật khẩu' };
            const valid = await bcrypt.compare(oldPassword, hash);
            if (!valid)
                return { success: false, error: 'Mật khẩu hiện tại không đúng' };
            if (!newPassword || newPassword.length < 4) {
                return { success: false, error: 'Mật khẩu mới phải có ít nhất 4 ký tự' };
            }
            const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
            db().setSetting('lock_screen_hash', newHash);
            Logger_1.default.log('[LockScreen] Password changed');
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Reset password with recovery key ───────────────────────────────
    electron_1.ipcMain.handle('lockScreen:resetPassword', async (_event, { recoveryKey, newPassword }) => {
        try {
            // Verify recovery key first
            const encrypted = db().getSetting('lock_screen_recovery');
            if (!encrypted)
                return { success: false, error: 'Không có recovery key' };
            let storedKey;
            if (electron_1.safeStorage.isEncryptionAvailable()) {
                storedKey = electron_1.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
            }
            else {
                storedKey = Buffer.from(encrypted, 'base64').toString('utf8');
            }
            if (recoveryKey.trim().toUpperCase() !== storedKey.toUpperCase()) {
                return { success: false, error: 'Recovery key không đúng' };
            }
            if (!newPassword || newPassword.length < 4) {
                return { success: false, error: 'Mật khẩu mới phải có ít nhất 4 ký tự' };
            }
            const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
            db().setSetting('lock_screen_hash', newHash);
            failedAttempts = 0;
            cooldownUntil = 0;
            Logger_1.default.log('[LockScreen] Password reset via recovery key');
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Disable lock screen ────────────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:disable', async (_event, { password }) => {
        try {
            const hash = db().getSetting('lock_screen_hash');
            if (!hash)
                return { success: false, error: 'Chưa đặt mật khẩu' };
            const valid = await bcrypt.compare(password, hash);
            if (!valid)
                return { success: false, error: 'Mật khẩu không đúng' };
            db().setSetting('lock_screen_enabled', '0');
            db().setSetting('lock_screen_biometric', '0');
            failedAttempts = 0;
            cooldownUntil = 0;
            Logger_1.default.log('[LockScreen] Lock screen disabled');
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── View recovery key (requires password) ──────────────────────────
    electron_1.ipcMain.handle('lockScreen:getRecoveryKey', async (_event, { password }) => {
        try {
            const hash = db().getSetting('lock_screen_hash');
            if (!hash)
                return { success: false, error: 'Chưa đặt mật khẩu' };
            const valid = await bcrypt.compare(password, hash);
            if (!valid)
                return { success: false, error: 'Mật khẩu không đúng' };
            const encrypted = db().getSetting('lock_screen_recovery');
            if (!encrypted)
                return { success: false, error: 'Không có recovery key' };
            let recoveryKey;
            if (electron_1.safeStorage.isEncryptionAvailable()) {
                recoveryKey = electron_1.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
            }
            else {
                recoveryKey = Buffer.from(encrypted, 'base64').toString('utf8');
            }
            return { success: true, recoveryKey };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Enable/disable biometric ───────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:setBiometric', async (_event, { enabled }) => {
        try {
            if (enabled && !checkBiometricAvailable()) {
                return { success: false, error: 'Thiết bị không hỗ trợ sinh trắc học' };
            }
            db().setSetting('lock_screen_biometric', enabled ? '1' : '0');
            Logger_1.default.log(`[LockScreen] Biometric ${enabled ? 'enabled' : 'disabled'}`);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    // ─── Biometric unlock ───────────────────────────────────────────────
    electron_1.ipcMain.handle('lockScreen:biometricUnlock', async () => {
        try {
            if (!checkBiometricAvailable()) {
                return { success: false, error: 'Thiết bị không hỗ trợ sinh trắc học' };
            }
            if (process.platform === 'win32') {
                // Windows: use Windows Hello (fingerprint / PIN / face)
                const verified = await promptWindowsHello();
                if (!verified) {
                    return { success: false, error: 'Xác thực Windows Hello thất bại hoặc bị huỷ' };
                }
                failedAttempts = 0;
                cooldownUntil = 0;
                Logger_1.default.log('[LockScreen] Windows Hello unlock successful');
                return { success: true };
            }
            if (process.platform === 'darwin') {
                // macOS: Keychain ACL requires Touch ID
                const token = db().getSetting('lock_screen_biometric_token');
                if (!token) {
                    const randomToken = crypto.randomBytes(32).toString('hex');
                    if (electron_1.safeStorage.isEncryptionAvailable()) {
                        const encrypted = electron_1.safeStorage.encryptString(randomToken).toString('base64');
                        db().setSetting('lock_screen_biometric_token', encrypted);
                    }
                    failedAttempts = 0;
                    cooldownUntil = 0;
                    return { success: true };
                }
                if (electron_1.safeStorage.isEncryptionAvailable()) {
                    electron_1.safeStorage.decryptString(Buffer.from(token, 'base64'));
                }
                failedAttempts = 0;
                cooldownUntil = 0;
                Logger_1.default.log('[LockScreen] Touch ID unlock successful');
                return { success: true };
            }
            return { success: false, error: 'Nền tảng không hỗ trợ' };
        }
        catch (e) {
            Logger_1.default.error(`[LockScreen] biometricUnlock error: ${e.message}`);
            return { success: false, error: 'Xác thực sinh trắc học thất bại' };
        }
    });
}
/** Check if biometric hardware is available on this machine */
function checkBiometricAvailable() {
    // Disabled - password-only unlock
    return false;
}
/** Prompt Windows Hello verification via WinRT UserConsentVerifier */
function promptWindowsHello() {
    return new Promise((resolve) => {
        // Use reflection to load WinRT types - works across PS 5.1 and 7
        // Returns: 0=Verified, 1=Canceled, 2=RetriesExhausted, 99=NotAvailable, -1=Error
        const bt = '`'; // backtick char for PowerShell generic type name
        const psScript = "$ErrorActionPreference = 'Stop'\n" +
            'try {\n' +
            '    [void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]\n' +
            "    $type = [type]::GetTypeFromTypeName('Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime')\n" +
            '    if (!$type) { Write-Output 99; exit 0 }\n' +
            '    $asTaskGeneric = ([AppDomain]::CurrentDomain.GetAssemblies() | ForEach-Object {\n' +
            "        $_.GetType('System.Runtime.WindowsRuntime.WindowsRuntimeSystemExtensions')\n" +
            '    } | Where-Object { $_ } | ForEach-Object {\n' +
            `        $_.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${bt}1' }\n` +
            '    } | Select-Object -First 1)\n' +
            '    function Await($WinRtTask, $ResultType) {\n' +
            '        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)\n' +
            '        $netTask = $asTask.Invoke($null, @($WinRtTask))\n' +
            '        $netTask.Wait(-1) | Out-Null\n' +
            '        $netTask.Result\n' +
            '    }\n' +
            "    $checkMethod = $type.GetMethod('CheckAvailabilityAsync', [System.Reflection.BindingFlags]::Public -bor [System.Reflection.BindingFlags]::Static)\n" +
            '    $availResult = Await $checkMethod.Invoke($null, $null) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])\n' +
            "    if ($availResult -ne 'Available') { Write-Output 99; exit 0 }\n" +
            "    $verifyMethod = $type.GetMethod('RequestVerificationAsync', [System.Reflection.BindingFlags]::Public -bor [System.Reflection.BindingFlags]::Static)\n" +
            "    $result = Await $verifyMethod.Invoke($null, @('Mở khoá Deplao')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])\n" +
            '    Write-Output ([int]$result)\n' +
            '} catch {\n' +
            '    Write-Output -1\n' +
            '}\n';
        (0, child_process_1.execFile)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', psScript
        ], { timeout: 60000 }, (error, stdout) => {
            if (error) {
                Logger_1.default.error(`[LockScreen] Windows Hello error: ${error.message}`);
                resolve(false);
                return;
            }
            const code = parseInt((stdout || '').trim(), 10);
            if (code === 0) {
                resolve(true);
            }
            else if (code === 99) {
                Logger_1.default.warn('[LockScreen] Windows Hello not available on this device');
                resolve(false);
            }
            else {
                Logger_1.default.warn(`[LockScreen] Windows Hello result code: ${code}`);
                resolve(false);
            }
        });
    });
}
//# sourceMappingURL=lockScreenIpc.js.map