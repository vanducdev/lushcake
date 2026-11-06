import React from 'react';
import { useChatStore } from '../stores/chatStore';
import { ShieldCheck, Plus, CheckCircle2, AlertCircle } from 'lucide-react';

export const AccountList: React.FC = () => {
  const { accounts } = useChatStore();

  return (
    <div className="p-4 pb-20 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800">Tài khoản kết nối</h2>
          <p className="text-xs text-slate-500">Đồng bộ từ máy chủ LushCake Desktop/VPS</p>
        </div>
        <button className="flex items-center gap-1 bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all">
          <Plus className="w-4 h-4" />
          <span>Thêm</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <img
                src={acc.avatar}
                alt={acc.name}
                className="w-11 h-11 rounded-full object-cover border border-slate-200"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-semibold text-sm text-slate-800">{acc.name}</h3>
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                    {acc.platform}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{acc.phone || 'Đa tài khoản'}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-medium">
              {acc.status === 'online' ? (
                <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5" /> Mất kết nối
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

