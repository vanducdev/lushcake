import React, { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { socketService } from '../services/socketService';
import {
  Server,
  QrCode,
  Check,
  RefreshCw,
  Bell,
  Trash2,
  Lock,
  Smartphone,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { serverUrl, setServerUrl, isConnected, setIsConnected } = useChatStore();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [hapticEnabled, setHapticEnabled] = useState(true);

  const handleConnect = () => {
    if (!urlInput.trim()) return;

    setIsConnecting(true);
    setStatusMsg('Đang kiểm tra kết nối tới LushCake Host...');

    socketService.connect(
      urlInput,
      () => {
        setIsConnecting(false);
        setIsConnected(true);
        setServerUrl(urlInput);
        setStatusMsg('✅ Kết nối thành công! Dữ liệu Zalo/FB đang đồng bộ realtime.');
      },
      () => {
        setIsConnecting(false);
        setIsConnected(false);
        setStatusMsg('❌ Không thể kết nối. Vui lòng kiểm tra lại URL hoặc mạng Wi-Fi.');
      }
    );
  };

  return (
    <div className="p-3.5 pb-28 space-y-4">
      {/* Page Title */}
      <div>
        <h2 className="text-base font-bold text-slate-900">Cài đặt kết nối & Hệ thống</h2>
        <p className="text-xs text-slate-500">Đồng bộ đám mây giữa iPhone và LushCake Desktop/VPS</p>
      </div>

      {/* Host Connection Card */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <Server className="w-4 h-4 text-sky-600" />
            <span>Địa chỉ LushCake Host</span>
          </div>
          {isConnected && (
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
              Ping: 18ms
            </span>
          )}
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">
            URL Cloudflare Tunnel / Ngrok hoặc IP máy tính (vd: http://192.168.1.5:27799)
          </label>
          <input
            type="text"
            placeholder="http://192.168.1.10:27799"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full bg-slate-50 text-xs font-mono text-slate-900 px-3.5 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex-1 flex items-center justify-center gap-1.5 bg-sky-600 text-white text-xs font-bold py-2.5 rounded-xl shadow-xs ios-active disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Đang kết nối...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Lưu & Đồng bộ ngay</span>
              </>
            )}
          </button>

          <button
            onClick={() => setUrlInput('http://192.168.1.5:27799')}
            className="p-2.5 bg-slate-100 text-slate-600 rounded-xl ios-active"
            title="Quét QR từ máy tính"
          >
            <QrCode className="w-4 h-4" />
          </button>
        </div>

        {statusMsg && (
          <p
            className={`text-xs p-2.5 rounded-xl mt-2 font-medium ${
              isConnected
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}
          >
            {statusMsg}
          </p>
        )}
      </div>

      {/* Mobile Preferences */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-slate-900">Tùy chọn di động (iOS)</h3>

        <div className="divide-y divide-slate-100 text-xs">
          <div className="py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-slate-500" />
              <div>
                <p className="font-semibold text-slate-800">Thông báo đẩy (Push)</p>
                <p className="text-[10px] text-slate-400">Rung & thông báo khi có tin nhắn mới</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={() => setPushEnabled(!pushEnabled)}
              className="w-5 h-5 accent-sky-600 rounded cursor-pointer"
            />
          </div>

          <div className="py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-slate-500" />
              <div>
                <p className="font-semibold text-slate-800">Phản hồi xúc giác (Haptics)</p>
                <p className="text-[10px] text-slate-400">Rung nhẹ khi gửi tin và chạm nút</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={hapticEnabled}
              onChange={() => setHapticEnabled(!hapticEnabled)}
              className="w-5 h-5 accent-sky-600 rounded cursor-pointer"
            />
          </div>

          <div className="py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-500" />
              <div>
                <p className="font-semibold text-slate-800">Khóa ứng dụng (FaceID)</p>
                <p className="text-[10px] text-slate-400">Yêu cầu bảo mật khi mở app</p>
              </div>
            </div>
            <span className="text-[10px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              Khả dụng
            </span>
          </div>
        </div>
      </div>

      {/* App & Version Info */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Phiên bản Mobile</span>
          <span className="font-bold text-slate-900">26.10.0 Pro (Capacitor iOS)</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Khả năng tương thích</span>
          <span className="font-bold text-emerald-600">iOS 14.0 - 18.x (Mọi đời iPhone)</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Bảo mật dữ liệu</span>
          <span className="font-semibold text-slate-700 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Mã hóa AES-256
          </span>
        </div>
      </div>
    </div>
  );
};
