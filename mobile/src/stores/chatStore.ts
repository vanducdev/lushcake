import { create } from 'zustand';

export interface Account {
  id: string;
  name: string;
  avatar: string;
  platform: 'zalo' | 'facebook' | 'telegram';
  status: 'online' | 'offline';
  phone?: string;
}

export interface Conversation {
  id: string;
  accountId: string;
  platform: 'zalo' | 'facebook' | 'telegram';
  name: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  isGroup?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  timestamp: string;
  isOutgoing: boolean;
  status?: 'sent' | 'delivered' | 'read';
}

interface ChatStore {
  serverUrl: string;
  isConnected: boolean;
  activeTab: 'messages' | 'crm' | 'accounts' | 'settings';
  accounts: Account[];
  activeAccount: string | 'all';
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];

  setServerUrl: (url: string) => void;
  setIsConnected: (connected: boolean) => void;
  setActiveTab: (tab: 'messages' | 'crm' | 'accounts' | 'settings') => void;
  setActiveAccount: (accountId: string | 'all') => void;
  setAccounts: (accounts: Account[]) => void;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conv: Conversation | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  serverUrl: localStorage.getItem('lushcake_server_url') || '',
  isConnected: false,
  activeTab: 'messages',
  accounts: [
    { id: 'zl_1', name: 'Zalo Bán Hàng 1', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100', platform: 'zalo', status: 'online', phone: '0988***123' },
    { id: 'zl_2', name: 'Zalo CSKH', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100', platform: 'zalo', status: 'online', phone: '0977***456' },
    { id: 'fb_1', name: 'Fanpage Mỹ Phẩm', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100', platform: 'facebook', status: 'online' },
    { id: 'tg_1', name: 'Telegram Lead', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100', platform: 'telegram', status: 'online' },
  ],
  activeAccount: 'all',
  conversations: [
    {
      id: 'c1',
      accountId: 'zl_1',
      platform: 'zalo',
      name: 'Nguyễn Thu Trang',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100',
      lastMessage: 'Em gửi anh đơn hàng sáng nay nhé!',
      timestamp: '08:45',
      unreadCount: 2
    },
    {
      id: 'c2',
      accountId: 'zl_1',
      platform: 'zalo',
      name: 'Trần Văn Mạnh',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100',
      lastMessage: 'Check giúp mình mã vận đơn này với',
      timestamp: 'Hôm qua',
      unreadCount: 0
    },
    {
      id: 'c3',
      accountId: 'fb_1',
      platform: 'facebook',
      name: 'Hoàng Lan Anh',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100',
      lastMessage: 'Shop có ship COD về Đà Nẵng không ạ?',
      timestamp: 'Hôm qua',
      unreadCount: 1
    },
    {
      id: 'c4',
      accountId: 'tg_1',
      platform: 'telegram',
      name: 'VIP Group Khách Sỉ Miền Nam',
      avatar: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=100',
      lastMessage: 'Admin: Đã cập nhật bảng giá tuần mới',
      timestamp: '04/11',
      unreadCount: 0,
      isGroup: true
    }
  ],
  activeConversation: null,
  messages: [
    { id: 'm1', conversationId: 'c1', senderName: 'Nguyễn Thu Trang', content: 'Chào shop, em muốn đặt thêm 5 hộp kem nữa ạ', timestamp: '08:40', isOutgoing: false },
    { id: 'm2', conversationId: 'c1', senderName: 'Bạn', content: 'Dạ shop sẵn hàng bạn nhé, bạn lấy địa chỉ cũ đúng không?', timestamp: '08:42', isOutgoing: true, status: 'read' },
    { id: 'm3', conversationId: 'c1', senderName: 'Nguyễn Thu Trang', content: 'Em gửi anh đơn hàng sáng nay nhé!', timestamp: '08:45', isOutgoing: false },
  ],

  setServerUrl: (url) => {
    localStorage.setItem('lushcake_server_url', url);
    set({ serverUrl: url });
  },
  setIsConnected: (connected) => set({ isConnected: connected }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveAccount: (accountId) => set({ activeAccount: accountId }),
  setAccounts: (accounts) => set({ accounts }),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conv) => set({ activeConversation: conv }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] }))
}));

