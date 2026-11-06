import React from 'react';
import { useChatStore } from '../stores/chatStore';
import { MessageSquare, Users, ShieldCheck, Settings } from 'lucide-react';

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab, conversations } = useChatStore();

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const tabs = [
    { id: 'messages' as const, label: 'Tin nhắn', icon: MessageSquare, badge: totalUnread },
    { id: 'crm' as const, label: 'Khách hàng', icon: Users },
    { id: 'accounts' as const, label: 'Tài khoản', icon: ShieldCheck },
    { id: 'settings' as const, label: 'Cài đặt', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 px-2 py-1 flex items-center justify-around safe-bottom">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all relative ${
              isActive ? 'text-sky-600 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
              {Boolean(tab.badge && tab.badge > 0) && (
                <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full min-w-[16px] text-center border-2 border-white">
                  {tab.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

