import React, { useState } from 'react';
import { useChatStore, Conversation } from '../stores/chatStore';
import { Search, Pin, CheckCheck, MessageCircle, Filter, X } from 'lucide-react';

export const ChatList: React.FC = () => {
  const { conversations, activeAccount, setActiveConversation, markConversationAsRead } = useChatStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'zalo' | 'facebook' | 'telegram'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);

  const filtered = conversations.filter((c) => {
    const matchAccount = activeAccount === 'all' || c.accountId === activeAccount;
    const matchPlatform = platformFilter === 'all' || c.platform === platformFilter;
    const matchUnread = !onlyUnread || c.unreadCount > 0;
    const matchSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone && c.phone.includes(searchTerm));
    return matchAccount && matchPlatform && matchUnread && matchSearch;
  });

  const getPlatformIcon = (platform: Conversation['platform']) => {
    switch (platform) {
      case 'zalo':
        return (
          <span className="w-4 h-4 rounded-full bg-[#0068FF] text-white flex items-center justify-center text-[9px] font-black shadow-xs">
            Z
          </span>
        );
      case 'facebook':
        return (
          <span className="w-4 h-4 rounded-full bg-[#1877F2] text-white flex items-center justify-center text-[9px] font-black shadow-xs">
            f
          </span>
        );
      case 'telegram':
        return (
          <span className="w-4 h-4 rounded-full bg-[#0088CC] text-white flex items-center justify-center text-[9px] font-black shadow-xs">
            ✈
          </span>
        );
    }
  };

  return (
    <div className="pb-28">
      {/* Search & Filter Header */}
      <div className="p-3 bg-white border-b border-slate-100 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Tìm theo tên, SĐT, nội dung..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-100/90 text-sm text-slate-900 pl-9 pr-8 py-2.5 rounded-2xl border-none focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Platform Selector Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          {(['all', 'zalo', 'facebook', 'telegram'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-all ios-active ${
                platformFilter === p
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p === 'all' ? 'Tất cả nền tảng' : p.toUpperCase()}
            </button>
          ))}

          <button
            onClick={() => setOnlyUnread(!onlyUnread)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-all ios-active flex items-center gap-1 ${
              onlyUnread
                ? 'bg-rose-500 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            <Filter className="w-3 h-3" />
            <span>Chưa đọc</span>
          </button>
        </div>
      </div>

      {/* Conversations Stream */}
      <div className="divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="text-center py-16 px-4 text-slate-400">
            <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30 text-slate-400" />
            <p className="text-sm font-medium">Không có cuộc trò chuyện nào</p>
            <p className="text-xs text-slate-400 mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
          </div>
        ) : (
          filtered.map((conv) => (
            <div
              key={conv.id}
              onClick={() => {
                setActiveConversation(conv);
                markConversationAsRead(conv.id);
              }}
              className="p-3.5 flex items-start gap-3 bg-white hover:bg-slate-50/80 active:bg-slate-100 cursor-pointer transition-colors relative"
            >
              {/* Avatar with Platform Badge */}
              <div className="relative shrink-0 mt-0.5">
                <img
                  src={conv.avatar}
                  alt={conv.name}
                  className="w-12 h-12 rounded-2xl object-cover ring-1 ring-slate-200/60 shadow-xs"
                />
                <div className="absolute -bottom-1 -right-1">
                  {getPlatformIcon(conv.platform)}
                </div>
              </div>

              {/* Chat Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {conv.isPinned && (
                      <Pin className="w-3 h-3 text-amber-500 shrink-0 fill-amber-500" />
                    )}
                    <h3 className="font-bold text-sm text-slate-900 truncate">
                      {conv.name}
                    </h3>
                  </div>
                  <span className={`text-[11px] shrink-0 font-medium ${conv.unreadCount > 0 ? 'text-sky-600 font-bold' : 'text-slate-400'}`}>
                    {conv.timestamp}
                  </span>
                </div>

                {/* Subtitle / Last Message */}
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className={`text-xs truncate ${conv.unreadCount > 0 ? 'text-slate-900 font-semibold' : 'text-slate-500'}`}>
                    {conv.lastMessage}
                  </p>

                  {conv.unreadCount > 0 ? (
                    <span className="shrink-0 bg-sky-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-xs">
                      {conv.unreadCount}
                    </span>
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                </div>

                {/* Tags & CRM Revenue Badge */}
                {Boolean(conv.tags && conv.tags.length > 0) && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {conv.tags?.map((t) => (
                      <span
                        key={t.id}
                        className={`text-[10px] font-semibold px-2 py-0.2 rounded-md ${t.bg} ${t.color}`}
                      >
                        {t.name}
                      </span>
                    ))}
                    {conv.customerRevenue && (
                      <span className="text-[10px] text-slate-400 font-medium ml-auto">
                        Đã mua: <strong className="text-slate-600">{conv.customerRevenue}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
