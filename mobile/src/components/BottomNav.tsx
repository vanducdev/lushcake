import React from 'react';
import { useChatStore } from '../stores/chatStore';
import { MessageSquare, Users, Sparkles, ShieldCheck, Sliders } from 'lucide-react';

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab, conversations } = useChatStore();

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const tabs = [
    { id: 'messages' as const, label: 'Hộp thư', icon: MessageSquare, badge: totalUnread },
    { id: 'crm' as const, label: 'CRM & Đơn', icon: Users },
    { id: 'ai' as const, label: 'Trợ lý AI', icon: Sparkles },
    { id: 'accounts' as const, label: 'Tài khoản', icon: ShieldCheck },
    { id: 'settings' as const, label: 'Cài đặt', icon: Sliders },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 glass-nav border-t border-slate-200/80 px-3 pt-2 pb-safe flex items-center justify-around">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all relative ios-active ${
              isActive ? 'text-sky-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <div className="relative">
              <Icon
                className={`w-[22px] h-[22px] transition-transform duration-200 ${
                  isActive ? 'scale-110 stroke-[2.4]' : 'stroke-[1.8]'
                }`}
              />
              {Boolean(tab.badge && tab.badge > 0) && (
                <span className="absolute -top-1.5 -right-2.5 bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full min-w-[16px] text-center border-2 border-white shadow-xs">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-1 tracking-tight font-medium">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
