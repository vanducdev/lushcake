import React from 'react';
import { useChatStore } from '../stores/chatStore';
import { Sparkles, Wifi, WifiOff, ChevronDown, Check } from 'lucide-react';

export const Header: React.FC = () => {
  const {
    isConnected,
    activeAccount,
    setActiveAccount,
    accounts,
    aiAssistantEnabled,
    toggleAiAssistant,
    setActiveTab
  } = useChatStore();

  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);

  const currentAcc = accounts.find((a) => a.id === activeAccount);

  return (
    <header className="sticky top-0 z-30 glass-header border-b border-slate-200/80 px-4 pt-safe pb-2.5 transition-all">
      <div className="flex items-center justify-between">
        {/* Account Selector Pill */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 bg-slate-100/90 active:bg-slate-200 py-1.5 px-2.5 rounded-full ios-active"
          >
            {currentAcc ? (
              <img
                src={currentAcc.avatar}
                alt={currentAcc.name}
                className="w-5 h-5 rounded-full object-cover ring-1 ring-white"
              />
            ) : (
              <img src="/icon.png" alt="LushCake" className="w-5 h-5 rounded-full" />
            )}
            <span className="text-xs font-semibold text-slate-800 max-w-[140px] truncate">
              {currentAcc ? currentAcc.name : `Tất cả (${accounts.length})`}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* Account Picker Modal / Dropdown */}
          {isDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute left-0 mt-2 w-64 bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-slate-200/80 py-2 z-50 animate-slide-up">
                <div className="px-3 py-1.5 border-b border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Chọn tài khoản hiển thị
                  </span>
                </div>

                <button
                  onClick={() => {
                    setActiveAccount('all');
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition-colors ${
                    activeAccount === 'all' ? 'text-sky-600 font-semibold' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <img src="/icon.png" alt="All" className="w-6 h-6 rounded-lg" />
                    <div>
                      <p className="text-xs font-medium">Tất cả tài khoản</p>
                      <p className="text-[10px] text-slate-400">Xem tin nhắn tổng hợp</p>
                    </div>
                  </div>
                  {activeAccount === 'all' && <Check className="w-4 h-4 text-sky-600" />}
                </button>

                <div className="my-1 border-t border-slate-100" />

                {accounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setActiveAccount(acc.id);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition-colors ${
                      activeAccount === acc.id ? 'text-sky-600 font-semibold' : 'text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <img
                          src={acc.avatar}
                          alt={acc.name}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
                      </div>
                      <div>
                        <p className="text-xs font-medium truncate max-w-[130px]">{acc.name}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">{acc.platform}</p>
                      </div>
                    </div>
                    {activeAccount === acc.id && <Check className="w-4 h-4 text-sky-600" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right Action Icons: AI Assist & Connection Status */}
        <div className="flex items-center gap-2">
          {/* AI Toggle Button */}
          <button
            onClick={toggleAiAssistant}
            className={`p-2 rounded-full transition-all ios-active ${
              aiAssistantEnabled
                ? 'bg-gradient-to-r from-indigo-500 to-sky-500 text-white shadow-xs'
                : 'bg-slate-100 text-slate-400'
            }`}
            title="Trợ lý AI trả lời thông minh"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>

          {/* Connection Indicator */}
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ios-active ${
              isConnected
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                : 'bg-amber-50 text-amber-700 border border-amber-200/80'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span>{isConnected ? 'Host Online' : 'Mất kết nối'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
