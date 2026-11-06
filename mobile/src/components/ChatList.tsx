import React, { useState } from 'react';
import { useChatStore, Conversation } from '../stores/chatStore';
import { Search, Filter, CheckCheck } from 'lucide-react';

export const ChatList: React.FC = () => {
  const { conversations, activeAccount, setActiveConversation } = useChatStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'zalo' | 'facebook' | 'telegram'>('all');

  const filtered = conversations.filter((c) => {
    const matchAccount = activeAccount === 'all' || c.accountId === activeAccount;
    const matchPlatform = platformFilter === 'all' || c.platform === platformFilter;
    const matchSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        c.lastMessage.toLowerCase().includes(searchTerm.toLowerCase());
    return matchAccount && matchPlatform && matchSearch;
  });

  const getPlatformBadge = (platform: Conversation['platform']) => {
    switch (platform) {
      case 'zalo':
        return <span className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.2 rounded">ZALO</span>;
      case 'facebook':
        return <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.2 rounded">FB</span>;
      case 'telegram':
        return <span className="text-[9px] bg-sky-100 text-sky-700 font-bold px-1.5 py-0.2 rounded">TELE</span>;
    }
  };

  return (
    <div className="pb-20">
      {/* Search Bar */}
      <div className="p-3 bg-white border-b border-slate-100">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Tìm kiếm tin nhắn, bạn bè..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-100/90 text-sm text-slate-800 pl-9 pr-4 py-2 rounded-xl border-none focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all placeholder:text-slate-400"
          />
        </div>

        {/* Platform Filter Chips */}
        <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar">
          {(['all', 'zalo', 'facebook', 'telegram'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap transition-all ${
                platformFilter === p
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p === 'all' ? 'Tất cả' : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Conversations List */}
      <div className="divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="text-center py-12 px-4 text-slate-400 text-sm">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Không tìm thấy cuộc hội thoại nào
          </div>
        ) : (
          filtered.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setActiveConversation(conv)}
              className="p-3.5 flex items-center gap-3 bg-white hover:bg-slate-50 active:bg-slate-100 cursor-pointer transition-colors"
            >
              {/* Avatar with Platform Indicator */}
              <div className="relative shrink-0">
                <img
                  src={conv.avatar}
                  alt={conv.name}
                  className="w-12 h-12 rounded-full object-cover border border-slate-200 shadow-xs"
                />
                <div className="absolute -bottom-1 -right-1">
                  {getPlatformBadge(conv.platform)}
                </div>
              </div>

              {/* Message Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-sm text-slate-800 truncate">{conv.name}</h3>
                  <span className="text-[11px] text-slate-400 shrink-0">{conv.timestamp}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 truncate pr-2">{conv.lastMessage}</p>
                  {conv.unreadCount > 0 ? (
                    <span className="shrink-0 bg-sky-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full min-w-[18px] text-center">
                      {conv.unreadCount}
                    </span>
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

