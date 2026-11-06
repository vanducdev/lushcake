import React from 'react';
import { useChatStore } from '../stores/chatStore';
import { Wifi, WifiOff, Bell, ChevronDown } from 'lucide-react';

export const Header: React.FC = () => {
  const { isConnected, activeAccount, setActiveAccount, accounts, setActiveTab } = useChatStore();

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-2.5 flex items-center justify-between">
      {/* App Branding & Account Picker */}
      <div className="flex items-center gap-2">
        <img src="/icon.png" alt="LushCake" className="w-7 h-7 rounded-lg shadow-sm" />
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-800 text-sm tracking-tight">LushCake</span>
            <span className="text-[10px] bg-sky-100 text-sky-700 font-semibold px-1.5 py-0.2 rounded-full border border-sky-200">
              Mobile
            </span>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={activeAccount}
              onChange={(e) => setActiveAccount(e.target.value)}
              className="text-xs text-slate-600 bg-transparent font-medium border-0 p-0 pr-4 focus:ring-0 cursor-pointer appearance-none"
            >
              <option value="all">Tất cả tài khoản ({accounts.length})</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.platform.toUpperCase()}: {acc.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 pointer-events-none -ml-3.5" />
          </div>
        </div>
      </div>

      {/* Connection Indicator & Notifications */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full transition-all ${
            isConnected
              ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
              : 'bg-amber-50 text-amber-600 border border-amber-200'
          }`}
        >
          {isConnected ? (
            <>
              <Wifi className="w-3 h-3 text-emerald-500" />
              <span>Đã kết nối</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-amber-500" />
              <span>Chờ máy chủ</span>
            </>
          )}
        </button>

        <button className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 active:scale-95 transition-all">
          <Bell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

