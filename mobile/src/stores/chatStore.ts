import { create } from 'zustand';

export interface Account {
  id: string;
  name: string;
  avatar: string;
  platform: 'zalo' | 'facebook' | 'telegram';
  status: 'online' | 'offline' | 'syncing';
  phone?: string;
  unreadTotal: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  bg: string;
}

export interface Conversation {
  id: string;
  accountId: string;
  platform: 'zalo' | 'facebook' | 'telegram';
  name: string;
  phone?: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  isGroup?: boolean;
  tags?: Tag[];
  customerRevenue?: string;
  isPinned?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  type?: 'text' | 'image' | 'order' | 'quick_reply';
  imageUrl?: string;
  orderInfo?: {
    orderId: string;
    items: string;
    total: string;
    status: 'pending' | 'shipping' | 'completed';
  };
  timestamp: string;
  isOutgoing: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
}

export interface QuickReply {
  id: string;
  title: string;
  content: string;
  shortcut: string;
}

interface ChatStore {
  serverUrl: string;
  isConnected: boolean;
  activeTab: 'messages' | 'crm' | 'ai' | 'accounts' | 'settings';
  accounts: Account[];
  activeAccount: string | 'all';
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  quickReplies: QuickReply[];
  aiAssistantEnabled: boolean;
  aiSuggestedReplies: string[];
  isCustomerDrawerOpen: boolean;

  setServerUrl: (url: string) => void;
  setIsConnected: (connected: boolean) => void;
  setActiveTab: (tab: 'messages' | 'crm' | 'ai' | 'accounts' | 'settings') => void;
  setActiveAccount: (accountId: string | 'all') => void;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conv: Conversation | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  toggleAiAssistant: () => void;
  setAiSuggestedReplies: (suggestions: string[]) => void;
  toggleCustomerDrawer: () => void;
  markConversationAsRead: (id: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  serverUrl: localStorage.getItem('lushcake_server_url') || 'http://localhost:27799',
  isConnected: true,
  activeTab: 'messages',
  aiAssistantEnabled: true,
  isCustomerDrawerOpen: false,
  aiSuggestedReplies: [
    'Dạ bên em sẵn hàng ship luôn trong ngày ạ! Anh/chị cho em xin địa chỉ nhé.',
    'Sản phẩm hiện đang có ưu đãi giảm 15% khi mua từ 2 hộp ạ!',
    'Em đã gửi mã vận đơn qua Zalo cho mình rồi ạ, anh/chị kiểm tra giúp em nhé.'
  ],

  accounts: [
    { id: 'zl_1', name: 'Zalo Bán Hàng 01', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120', platform: 'zalo', status: 'online', phone: '0988 567 890', unreadTotal: 4 },
    { id: 'zl_2', name: 'Zalo CSKH VIP', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120', platform: 'zalo', status: 'online', phone: '0977 123 456', unreadTotal: 0 },
    { id: 'fb_1', name: 'Fanpage Mỹ Phẩm Chính Hãng', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120', platform: 'facebook', status: 'online', unreadTotal: 2 },
    { id: 'tg_1', name: 'Telegram Wholesale Bot', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120', platform: 'telegram', status: 'online', unreadTotal: 1 },
  ],
  activeAccount: 'all',

  quickReplies: [
    { id: 'q1', title: 'Lời chào đầu', content: 'Dạ LushCake xin chào bạn! Shop có thể tư vấn gì cho bạn hôm nay ạ?', shortcut: '/chao' },
    { id: 'q2', title: 'Thông tin STK', content: 'STK: 1029384756 - Ngân hàng Vietcombank - Tên: NGUYEN VAN A. Nội dung: [Tên + SĐT] ạ.', shortcut: '/stk' },
    { id: 'q3', title: 'Chốt đơn hàng', content: 'Dạ em xác nhận đơn của anh/chị gồm: 2 sản phẩm, tổng tiền 450.000đ đã freeship. Anh/chị check lại giúp em nha!', shortcut: '/chot' },
    { id: 'q4', title: 'Hỏi địa chỉ nhận', content: 'Dạ bạn gửi giúp shop địa chỉ cụ thể và số điện thoại nhận hàng nhé!', shortcut: '/dc' },
  ],

  conversations: [
    {
      id: 'c1',
      accountId: 'zl_1',
      platform: 'zalo',
      name: 'Nguyễn Thu Trang (Khách VIP)',
      phone: '0988 777 666',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120',
      lastMessage: 'Em gửi anh đơn hàng sáng nay nhé!',
      timestamp: '09:15',
      unreadCount: 2,
      isPinned: true,
      customerRevenue: '8.450.000đ',
      tags: [
        { id: 't1', name: 'VIP Vàng', color: 'text-amber-700', bg: 'bg-amber-100' },
        { id: 't2', name: 'Đã cọc', color: 'text-emerald-700', bg: 'bg-emerald-100' }
      ]
    },
    {
      id: 'c2',
      accountId: 'fb_1',
      platform: 'facebook',
      name: 'Hoàng Lan Anh',
      phone: '0912 345 678',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120',
      lastMessage: 'Shop có ship COD về Đà Nẵng không ạ?',
      timestamp: '08:40',
      unreadCount: 1,
      customerRevenue: '1.200.000đ',
      tags: [
        { id: 't3', name: 'Tiềm năng', color: 'text-sky-700', bg: 'bg-sky-100' }
      ]
    },
    {
      id: 'c3',
      accountId: 'zl_1',
      platform: 'zalo',
      name: 'Trần Văn Mạnh (Khách Buôn)',
      phone: '0977 456 789',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120',
      lastMessage: 'Check giúp mình mã vận đơn này với',
      timestamp: 'Hôm qua',
      unreadCount: 0,
      customerRevenue: '24.900.000đ',
      tags: [
        { id: 't4', name: 'Đại lý sỉ', color: 'text-purple-700', bg: 'bg-purple-100' }
      ]
    },
    {
      id: 'c4',
      accountId: 'tg_1',
      platform: 'telegram',
      name: 'Nhóm Khách Sỉ Miền Nam & Tây Nguyên',
      avatar: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=120',
      lastMessage: 'Admin: Đã cập nhật bảng giá chiết khấu mới trong file đính kèm.',
      timestamp: '04/11',
      unreadCount: 1,
      isGroup: true,
      tags: [
        { id: 't5', name: 'Nhóm Zalo/Tele', color: 'text-blue-700', bg: 'bg-blue-100' }
      ]
    }
  ],

  activeConversation: null,
  messages: [
    {
      id: 'm1',
      conversationId: 'c1',
      senderName: 'Nguyễn Thu Trang',
      content: 'Chào shop, em muốn lấy thêm 5 combo serum dưỡng da đợt mới nha!',
      timestamp: '09:10',
      isOutgoing: false
    },
    {
      id: 'm2',
      conversationId: 'c1',
      senderName: 'Bạn',
      content: 'Dạ chị Trang ơi, bên em vẫn giữ mức giá ưu đãi đại lý VIP cho chị là 380k/combo nhé!',
      timestamp: '09:12',
      isOutgoing: true,
      status: 'read'
    },
    {
      id: 'm3',
      conversationId: 'c1',
      senderName: 'Bạn',
      content: '',
      type: 'order',
      orderInfo: {
        orderId: 'LK-88921',
        items: '5x Combo Serum Dưỡng Da Collagen',
        total: '1.900.000đ (Freeship)',
        status: 'pending'
      },
      timestamp: '09:13',
      isOutgoing: true,
      status: 'read'
    },
    {
      id: 'm4',
      conversationId: 'c1',
      senderName: 'Nguyễn Thu Trang',
      content: 'Ok shop, lên đơn gửi qua địa chỉ cũ giúp em nhé!',
      timestamp: '09:15',
      isOutgoing: false
    }
  ],

  setServerUrl: (url) => {
    localStorage.setItem('lushcake_server_url', url);
    set({ serverUrl: url });
  },
  setIsConnected: (connected) => set({ isConnected: connected }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveAccount: (accountId) => set({ activeAccount: accountId }),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conv) => set({ activeConversation: conv }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  toggleAiAssistant: () => set((state) => ({ aiAssistantEnabled: !state.aiAssistantEnabled })),
  setAiSuggestedReplies: (suggestions) => set({ aiSuggestedReplies: suggestions }),
  toggleCustomerDrawer: () => set((state) => ({ isCustomerDrawerOpen: !state.isCustomerDrawerOpen })),
  markConversationAsRead: (id) => set((state) => ({
    conversations: state.conversations.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
  }))
}));
