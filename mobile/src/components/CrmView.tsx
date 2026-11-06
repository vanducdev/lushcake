import React, { useState } from 'react';
import { Search, Tag, Phone, Plus, TrendingUp, Users, ShoppingBag, ShieldAlert } from 'lucide-react';

interface CustomerItem {
  id: string;
  name: string;
  phone: string;
  avatar: string;
  platform: 'zalo' | 'facebook' | 'telegram';
  tag: string;
  tagColor: string;
  tagBg: string;
  totalSpent: string;
  ordersCount: number;
  lastActive: string;
}

export const CrmView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const customers: CustomerItem[] = [
    {
      id: '1',
      name: 'Nguyễn Thu Trang',
      phone: '0988 777 666',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120',
      platform: 'zalo',
      tag: 'Khách VIP Vàng',
      tagColor: 'text-amber-800',
      tagBg: 'bg-amber-100',
      totalSpent: '8.450.000đ',
      ordersCount: 8,
      lastActive: 'Vừa xong'
    },
    {
      id: '2',
      name: 'Trần Văn Mạnh',
      phone: '0977 456 789',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120',
      platform: 'zalo',
      tag: 'Đại lý sỉ Miền Bắc',
      tagColor: 'text-purple-800',
      tagBg: 'bg-purple-100',
      totalSpent: '24.900.000đ',
      ordersCount: 15,
      lastActive: '15 phút trước'
    },
    {
      id: '3',
      name: 'Hoàng Lan Anh',
      phone: '0912 345 678',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120',
      platform: 'facebook',
      tag: 'Tiềm năng',
      tagColor: 'text-sky-800',
      tagBg: 'bg-sky-100',
      totalSpent: '1.200.000đ',
      ordersCount: 2,
      lastActive: '1 giờ trước'
    },
    {
      id: '4',
      name: 'Lê Hoàng Minh',
      phone: '0933 888 999',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120',
      platform: 'telegram',
      tag: 'Cảnh báo Boom hàng',
      tagColor: 'text-rose-800',
      tagBg: 'bg-rose-100',
      totalSpent: '350.000đ',
      ordersCount: 1,
      lastActive: 'Hôm qua'
    }
  ];

  const filtered = customers.filter((c) => {
    const matchTag = selectedTag === 'all' || c.tag.includes(selectedTag);
    const matchSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm);
    return matchTag && matchSearch;
  });

  return (
    <div className="p-3.5 pb-28 space-y-3.5">
      {/* Top CRM Performance Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-3.5 bg-gradient-to-br from-sky-500 to-blue-600 rounded-2xl text-white shadow-sm">
          <div className="flex items-center justify-between opacity-80 mb-1">
            <span className="text-[11px] font-medium">Doanh số tháng này</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <p className="text-lg font-black tracking-tight">34.900.000đ</p>
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full inline-block mt-1 font-semibold">
            +18% so với tháng trước
          </span>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Khách hàng lưu trữ</span>
            <Users className="w-4 h-4 text-sky-600" />
          </div>
          <p className="text-lg font-black text-slate-900">1.248</p>
          <span className="text-[10px] text-emerald-600 font-semibold inline-block mt-1">
            ● 12 khách mới hôm nay
          </span>
        </div>
      </div>

      {/* Header & Add Button */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h2 className="text-base font-bold text-slate-900">Quản lý khách hàng & CRM</h2>
          <p className="text-xs text-slate-500">Đồng bộ tự động từ Zalo, Fanpage & Telegram</p>
        </div>
        <button className="flex items-center gap-1 bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs ios-active">
          <Plus className="w-3.5 h-3.5" />
          <span>Thêm khách</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        <input
          type="text"
          placeholder="Tìm theo tên hoặc số điện thoại..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white text-sm text-slate-900 pl-9 pr-4 py-2.5 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20 shadow-xs"
        />
      </div>

      {/* Tag Filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {[
          { id: 'all', label: 'Tất cả' },
          { id: 'VIP', label: 'Khách VIP' },
          { id: 'sỉ', label: 'Đại lý sỉ' },
          { id: 'Tiềm năng', label: 'Tiềm năng' },
          { id: 'Boom', label: 'Cảnh báo boom' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedTag(t.id)}
            className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap transition-all ios-active ${
              selectedTag === t.id
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Customer Cards List */}
      <div className="space-y-2.5">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between hover:bg-slate-50/80 active:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={c.avatar}
                alt={c.name}
                className="w-12 h-12 rounded-2xl object-cover ring-1 ring-slate-200 shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-bold text-sm text-slate-900 truncate">{c.name}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.tagBg} ${c.tagColor}`}>
                    {c.tag}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                  <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-700">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {c.phone}
                  </span>
                  <span>• {c.ordersCount} đơn hàng</span>
                </div>
              </div>
            </div>

            <div className="text-right shrink-0 pl-2">
              <span className="text-xs font-bold text-slate-900 block">{c.totalSpent}</span>
              <span className="text-[10px] text-slate-400">{c.lastActive}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
