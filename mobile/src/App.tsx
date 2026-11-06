import React from 'react';
import { useChatStore } from './stores/chatStore';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { ChatList } from './components/ChatList';
import { ChatDetail } from './components/ChatDetail';
import { AccountList } from './components/AccountList';
import { CrmView } from './components/CrmView';
import { SettingsView } from './components/SettingsView';

export const App: React.FC = () => {
  const { activeTab, activeConversation } = useChatStore();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans max-w-md mx-auto shadow-2xl relative">
      {/* Header */}
      <Header />

      {/* Main Content Area Based on Tab */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'messages' && <ChatList />}
        {activeTab === 'crm' && <CrmView />}
        {activeTab === 'accounts' && <AccountList />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Full-screen Chat Modal when selected */}
      {activeConversation && <ChatDetail />}

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  );
};

