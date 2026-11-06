import React, { useState } from 'react';
import { useChatStore, Account } from '../stores/chatStore';
import { Plus, CheckCircle2, AlertCircle, QrCode, RefreshCw, X, MessageSquare } from 'lucide-react';

export const AccountList: React.FC = () => {
  const { accounts } = useChatStore();
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<'zalo' | 'facebook' | 'telegram'>('zalo');

  const getPlatformHeader = (platform: Account['platform']) => {
    switch (platform) {
      case 'zalo':
        return { label: 'Zalo Cá Nhân', color: 'bg-blue-600' };
      case 'facebook':
        return { label: 'Facebook / Messenger', color: 'bg-indigo-600' };
      case 'telegram':
        return { label: 'Telegram Account/Bot', color: 'bg-sky-500' };
    }
  };

  return (
    <div className="p-3.5 pb-28 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">Trung tâm Đa tài khoản</h2>
          <p className="text-xs text-slate-500">Đang đồng bộ 4 tài khoản trực tiếp qua Host</p>
        </div>
        <button
          onClick={() => setShowQrModal(true)}
          className="flex items-center gap-1.5 bg-sky-600 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-xs ios-active"
        >
          <Plus className="w-4 h-4" />
          <span>Thêm Nick</span>
        </button>
      </div>

      {/* Account Cards */}
      <div className="space-y-3">
        {accounts.map((acc) => {
          const plat = getPlatformHeader(acc.platform);
          return (
            <div
              key={acc.id}
              className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={acc.avatar}
                      alt={acc.name}
                      className="w-12 h-12 rounded-2xl object-cover ring-1 ring-slate-200 shadow-xs"
                    />
                    <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-bold text-sm text-slate-900">{acc.name}</h3>
                      <span className={`text-[10px] text-white font-black px-1.5 py-0.2 rounded ${plat.color}`}>
                        {acc.platform.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{acc.phone || 'Đa luồng hoạt động'}</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Online
                  </span>
                </div>
              </div>

              {/* Sub-actions for each account */}
              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tin chưa đọc: <strong>{acc.unreadTotal}</strong></span>
                </div>

                <div className="flex items-center gap-2">
                  <button className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg ios-active">
                    Tải lại
                  </button>
                  <button className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 bg-sky-50 px-2.5 py-1 rounded-lg ios-active">
                    Vào chat
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* QR Login Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={() => setShowQrModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl z-10 space-y-4 animate-slide-up text-center">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-sm">Thêm tài khoản mới</h3>
              <button onClick={() => setShowQrModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Platform Selector */}
            <div className="flex items-center gap-2 justify-center">
              {(['zalo', 'facebook', 'telegram'] as const).map((plat) => (
                <button
                  key={plat}
                  onClick={() => setSelectedPlatform(plat)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl uppercase transition-all ${
                    selectedPlatform === plat
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {plat}
                </button>
              ))}
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 inline-block mx-auto">
              <img
                src="/icon.png"
                alt="QR"
                className="w-40 h-40 object-contain mx-auto rounded-xl p-2 bg-white shadow-inner"
              />
              <p className="text-[11px] text-slate-500 mt-2 font-medium">
                Mở ứng dụng {selectedPlatform.toUpperCase()} trên điện thoại để quét mã
              </p>
            </div>

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full bg-slate-900 text-white text-xs font-bold py-2.5 rounded-xl ios-active"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
