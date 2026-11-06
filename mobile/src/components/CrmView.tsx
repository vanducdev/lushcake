import React, { useState } from 'react';
import { Users, Search, Tag, Phone, Mail, ChevronRight, UserPlus } from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  phone: string;
  avatar: string;
  tag: string;
  tagColor: string;
  platform: 'zalo' | 'facebook' | 'telegram';
  ordersCount: number;
}

export const CrmView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const customers: Customer[] = [
    { id: '1', name: 'Nguyễn Thu Trang', phone: '0988 123 456', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100', tag: 'Khách VIP', tagColor: 'bg-amber-100 text-amber-700', platform: 'zalo', ordersCount: 5 },
    { id: '2', name: 'Trần Văn Mạnh', phone: '0977 456 789', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100', tag: 'Khách sỉ', tagColor: 'bg-emerald-100 text-emerald-700', platform: 'zalo', ordersCount: 12 },
    { id: '3', name: 'Hoàng Lan Anh', phone: '0912 345 678', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100', tag: 'Tiềm năng', tagColor: 'bg-sky-100 text-sky-700', platform: 'facebook', ordersCount: 1 },
    { id: '4', name: 'Lê Hoàng Minh', phone: '0933 888 999', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100', tag: 'Mới', tagColor: 'bg-slate-100 text-slate-700', platform: 'telegram', ordersCount: 0 },
  ];

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
  );

  return (
    <div className="p-4 pb-20 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800">Khách hàng (CRM)</h2>
          <p className="text-xs text-slate-500">Quản lý khách hàng từ Zalo, FB, Telegram</p>
        </div>
        <button className="flex items-center gap-1 bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all">
          <UserPlus className="w-4 h-4" />
          <span>Thêm</span>
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input
          type="text"
          placeholder="Tìm tên, số điện thoại..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white text-sm text-slate-800 pl-9 pr-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20 shadow-xs"
        />
      </div>

      <div className="space-y-2.5">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between hover:bg-slate-50 active:bg-slate-100 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              <img
                src={c.avatar}
                alt={c.name}
                className="w-11 h-11 rounded-full object-cover border border-slate-200"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-semibold text-sm text-slate-800">{c.name}</h3>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${c.tagColor}`}>
                    {c.tag}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {c.phone}
                  </span>
                  <span>• {c.ordersCount} đơn</span>
                </div>
              </div>
            </div>

            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>
        ))}
      </div>
    </div>
  );
};

