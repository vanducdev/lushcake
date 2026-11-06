import React, { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { socketService } from '../services/socketService';
import { Server, QrCode, Check, RefreshCw, Smartphone, Shield, Info } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { serverUrl, setServerUrl, isConnected, setIsConnected } = useChatStore();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const handleConnect = () => {
    if (!urlInput.trim()) return;

    setIsConnecting(true);
    setStatusMsg('Đang thử kết nối tới máy chủ...');

    socketService.connect(
      urlInput,
      () => {
        setIsConnecting(false);
        setIsConnected(true);
        setServerUrl(urlInput);
        setStatusMsg('Kết nối thành công tới LushCake Host!');
      },
      (err) => {
        setIsConnecting(false);
        setIsConnected(false);
        setStatusMsg('Kết nối thất bại. Vui lòng kiểm tra lại địa chỉ URL hoặc IP!');
      }
    );
  };

  return (
    <div className="p-4 pb-20 space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800">Cài đặt kết nối Host</h2>
        <p className="text-xs text-slate-500">Kết nối tới LushCake Desktop hoặc VPS đang chạy</p>
      </div>

      {/* Host Connection Card */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
          <Server className="w-4 h-4 text-sky-600" />
          <span>Địa chỉ Máy chủ LushCake</span>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">
            Nhập URL Cloudflare Tunnel / Ngrok hoặc IP Local (vd: http://192.168.1.5:27799)
          </label>
          <input
            type="text"
            placeholder="http://192.168.1.10:27799"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full bg-slate-50 text-sm text-slate-800 px-3.5 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all font-mono"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex-1 flex items-center justify-center gap-1.5 bg-sky-600 text-white text-xs font-semibold py-2.5 rounded-xl active:scale-98 transition-all disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Đang kết nối...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Lưu & Kết nối</span>
              </>
            )}
          </button>

          <button className="flex items-center gap-1 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-xl active:scale-98 transition-all">
            <QrCode className="w-4 h-4" />
            <span>Quét QR</span>
          </button>
        </div>

        {statusMsg && (
          <p
            className={`text-xs p-2.5 rounded-xl mt-2 ${
              isConnected
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}
          >
            {statusMsg}
          </p>
        )}
      </div>

      {/* App Info & About */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
          <Info className="w-4 h-4 text-slate-500" />
          <span>Thông tin ứng dụng</span>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          <div className="py-2 flex items-center justify-between">
            <span className="text-slate-500">Phiên bản Mobile</span>
            <span className="font-semibold text-slate-800">1.0.0 (Capacitor iOS/Android)</span>
          </div>
          <div className="py-2 flex items-center justify-between">
            <span className="text-slate-500">Nền tảng hỗ trợ</span>
            <span className="font-semibold text-slate-800">iOS (iPhone/iPad) & Android</span>
          </div>
          <div className="py-2 flex items-center justify-between">
            <span className="text-slate-500">Bảo mật</span>
            <span className="font-semibold text-emerald-600">Mã hóa đầu cuối E2EE</span>
          </div>
        </div>
      </div>
    </div>
  );
};

