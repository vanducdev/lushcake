import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, Message } from '../stores/chatStore';
import {
  ArrowLeft,
  Send,
  Sparkles,
  Zap,
  Phone,
  User,
  ShoppingBag,
  CheckCheck,
  X,
  CreditCard,
  Plus
} from 'lucide-react';

export const ChatDetail: React.FC = () => {
  const {
    activeConversation,
    setActiveConversation,
    messages,
    addMessage,
    aiAssistantEnabled,
    aiSuggestedReplies,
    quickReplies
  } = useChatStore();

  const [inputText, setInputText] = useState('');
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showCustomerDrawer, setShowCustomerDrawer] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);

  // New Order Form state
  const [orderProduct, setOrderProduct] = useState('Combo Serum Dưỡng Da Collagen');
  const [orderAmount, setOrderAmount] = useState('380.000đ');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!activeConversation) return null;

  const handleSend = (textToSend?: string) => {
    const content = textToSend || inputText;
    if (!content.trim()) return;

    const newMsg: Message = {
      id: 'm_' + Date.now(),
      conversationId: activeConversation.id,
      senderName: 'Bạn',
      content: content.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOutgoing: true,
      status: 'sent'
    };

    addMessage(newMsg);
    if (!textToSend) setInputText('');
  };

  const handleCreateOrder = () => {
    const orderMsg: Message = {
      id: 'ord_' + Date.now(),
      conversationId: activeConversation.id,
      senderName: 'Hệ thống LushCake POS',
      content: '',
      type: 'order',
      orderInfo: {
        orderId: 'LK-' + Math.floor(10000 + Math.random() * 90000),
        items: orderProduct,
        total: orderAmount,
        status: 'pending'
      },
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOutgoing: true,
      status: 'read'
    };

    addMessage(orderMsg);
    setShowOrderModal(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col h-full animate-slide-up">
      {/* Top Header Bar */}
      <div className="glass-header border-b border-slate-200/90 px-3 pt-safe pb-2.5 flex items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setActiveConversation(null)}
            className="p-1.5 -ml-1 text-slate-700 hover:bg-slate-200/60 rounded-full ios-active"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div
            onClick={() => setShowCustomerDrawer(true)}
            className="flex items-center gap-2 cursor-pointer min-w-0 ios-active"
          >
            <div className="relative shrink-0">
              <img
                src={activeConversation.avatar}
                alt={activeConversation.name}
                className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </div>

            <div className="min-w-0">
              <h2 className="font-bold text-sm text-slate-900 leading-tight truncate max-w-[160px]">
                {activeConversation.name}
              </h2>
              <p className="text-[10px] text-slate-500 flex items-center gap-1 font-medium mt-0.5">
                <span className="uppercase font-bold text-sky-600">{activeConversation.platform}</span>
                <span>• {activeConversation.phone || 'Chạm xem CRM'}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {activeConversation.phone && (
            <a
              href={`tel:${activeConversation.phone}`}
              className="p-2 text-slate-600 hover:bg-slate-200/60 rounded-full ios-active"
            >
              <Phone className="w-4 h-4" />
            </a>
          )}

          <button
            onClick={() => setShowOrderModal(true)}
            className="p-2 text-sky-600 hover:bg-sky-50 rounded-full ios-active flex items-center gap-1 text-xs font-semibold"
            title="Tạo đơn hàng nhanh"
          >
            <ShoppingBag className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowCustomerDrawer(true)}
            className="p-2 text-slate-600 hover:bg-slate-200/60 rounded-full ios-active"
          >
            <User className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto scroll-touch p-3.5 space-y-3">
        {/* Pinned Conversation Notice */}
        <div className="text-center my-1">
          <span className="text-[10px] bg-slate-200/80 text-slate-600 px-3 py-1 rounded-full font-medium">
            Mã hóa đầu cuối E2EE bảo mật qua LushCake
          </span>
        </div>

        {messages.map((msg) => {
          if (msg.type === 'order' && msg.orderInfo) {
            return (
              <div
                key={msg.id}
                className="max-w-[85%] mx-auto my-2 p-3.5 bg-white rounded-2xl border border-sky-200 shadow-md"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                  <div className="flex items-center gap-1.5 text-sky-700 font-bold text-xs">
                    <ShoppingBag className="w-4 h-4" />
                    <span>ĐƠN HÀNG: {msg.orderInfo.orderId}</span>
                  </div>
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                    Chờ gửi hàng
                  </span>
                </div>
                <div className="text-xs space-y-1 text-slate-700">
                  <p><strong>Sản phẩm:</strong> {msg.orderInfo.items}</p>
                  <p><strong>Tổng thanh toán:</strong> <span className="text-rose-600 font-bold">{msg.orderInfo.total}</span></p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Khách: {activeConversation.name}</span>
                  <span>{msg.timestamp}</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.isOutgoing ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-xs ${
                  msg.isOutgoing
                    ? 'bg-sky-600 text-white rounded-br-xs font-normal'
                    : 'bg-white text-slate-900 border border-slate-200/70 rounded-bl-xs'
                }`}
              >
                <p className="whitespace-pre-wrap select-text">{msg.content}</p>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
                <span>{msg.timestamp}</span>
                {msg.isOutgoing && <CheckCheck className="w-3 h-3 text-sky-500" />}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Smart Reply Suggestions Bar */}
      {aiAssistantEnabled && (
        <div className="bg-slate-100/95 border-t border-slate-200/60 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 text-indigo-600 text-[11px] font-bold shrink-0">
            <Sparkles className="w-3.5 h-3.5 fill-indigo-500" />
            <span>AI Gợi ý:</span>
          </div>
          {aiSuggestedReplies.map((reply, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(reply)}
              className="text-xs bg-white text-slate-800 border border-slate-200/90 hover:bg-indigo-50 hover:border-indigo-200 px-2.5 py-1 rounded-full whitespace-nowrap shadow-2xs font-medium ios-active shrink-0 transition-all"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {/* Quick Replies Drawer */}
      {showQuickReplies && (
        <div className="bg-white border-t border-slate-200 p-3 max-h-48 overflow-y-auto divide-y divide-slate-100 animate-slide-up">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Mẫu tin nhắn nhanh (1-chạm)
            </span>
            <button onClick={() => setShowQuickReplies(false)} className="text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>
          {quickReplies.map((qr) => (
            <div
              key={qr.id}
              onClick={() => {
                setInputText(qr.content);
                setShowQuickReplies(false);
              }}
              className="py-2.5 px-1 cursor-pointer hover:bg-slate-50 flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-bold text-slate-800">{qr.title}</p>
                <p className="text-[11px] text-slate-500 truncate max-w-[280px]">{qr.content}</p>
              </div>
              <span className="text-[10px] text-sky-600 font-mono bg-sky-50 px-1.5 py-0.5 rounded">
                {qr.shortcut}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Input Bar */}
      <div className="glass-nav border-t border-slate-200/90 p-2 pb-safe flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => setShowQuickReplies(!showQuickReplies)}
          className="p-2 text-amber-500 hover:bg-amber-50 rounded-full ios-active"
          title="Mẫu tin nhắn nhanh"
        >
          <Zap className="w-5 h-5 fill-amber-400" />
        </button>

        <input
          type="text"
          placeholder="Nhập tin nhắn... (hoặc gõ /)"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 bg-slate-100 text-slate-900 text-sm px-3.5 py-2 rounded-2xl border-none focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all placeholder:text-slate-400"
        />

        <button
          onClick={() => handleSend()}
          disabled={!inputText.trim()}
          className={`p-2.5 rounded-full transition-all ios-active ${
            inputText.trim()
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Customer Info Drawer (Right Sidebar Modal) */}
      {showCustomerDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setShowCustomerDrawer(false)}
          />
          <div className="relative w-80 bg-white h-full shadow-2xl p-4 overflow-y-auto space-y-4 pt-safe z-10 animate-slide-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-sm">Hồ sơ khách hàng</h3>
              <button onClick={() => setShowCustomerDrawer(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center py-2">
              <img
                src={activeConversation.avatar}
                alt={activeConversation.name}
                className="w-16 h-16 rounded-full mx-auto object-cover ring-2 ring-sky-100 shadow-sm"
              />
              <h4 className="font-bold text-base text-slate-900 mt-2">{activeConversation.name}</h4>
              <p className="text-xs text-slate-500 mt-0.5">{activeConversation.phone || 'Chưa có SĐT'}</p>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] text-slate-400 block font-medium">Tổng chi tiêu</span>
                <span className="text-xs font-bold text-slate-800">{activeConversation.customerRevenue || '0đ'}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] text-slate-400 block font-medium">Đơn thành công</span>
                <span className="text-xs font-bold text-emerald-600">4 đơn</span>
              </div>
            </div>

            {/* Tags Management */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700">Thẻ phân loại (CRM)</span>
                <button className="text-[11px] text-sky-600 font-semibold flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> Gắn thẻ
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeConversation.tags?.map((t) => (
                  <span key={t.id} className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${t.bg} ${t.color}`}>
                    {t.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Create Order Button */}
            <button
              onClick={() => {
                setShowCustomerDrawer(false);
                setShowOrderModal(true);
              }}
              className="w-full flex items-center justify-center gap-2 bg-sky-600 text-white font-bold text-xs py-3 rounded-xl shadow-xs active:scale-98 transition-all"
            >
              <CreditCard className="w-4 h-4" />
              <span>Tạo đơn hàng ngay</span>
            </button>
          </div>
        </div>
      )}

      {/* Fast Order Creation Modal */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={() => setShowOrderModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl z-10 space-y-4 animate-slide-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">Tạo đơn hàng nhanh (POS)</h3>
              <button onClick={() => setShowOrderModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Khách nhận</label>
                <input
                  type="text"
                  disabled
                  value={activeConversation.name}
                  className="w-full bg-slate-100 text-xs text-slate-800 p-2.5 rounded-xl border-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Tên sản phẩm / Combo</label>
                <input
                  type="text"
                  value={orderProduct}
                  onChange={(e) => setOrderProduct(e.target.value)}
                  className="w-full bg-slate-50 text-xs text-slate-800 p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Tổng tiền thanh toán</label>
                <input
                  type="text"
                  value={orderAmount}
                  onChange={(e) => setOrderAmount(e.target.value)}
                  className="w-full bg-slate-50 text-xs text-slate-800 p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20 font-bold text-rose-600"
                />
              </div>
            </div>

            <button
              onClick={handleCreateOrder}
              className="w-full bg-sky-600 text-white font-bold text-xs py-3 rounded-2xl shadow-xs active:scale-98 transition-all"
            >
              Gửi thẻ đơn hàng vào cuộc trò chuyện
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
