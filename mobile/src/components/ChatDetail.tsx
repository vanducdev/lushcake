import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { ArrowLeft, Send, Image as ImageIcon, Smile, MoreVertical, Phone, Video } from 'lucide-react';

export const ChatDetail: React.FC = () => {
  const { activeConversation, setActiveConversation, messages, addMessage } = useChatStore();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!activeConversation) return null;

  const handleSend = () => {
    if (!inputText.trim()) return;

    const newMsg = {
      id: 'm_' + Date.now(),
      conversationId: activeConversation.id,
      senderName: 'Bạn',
      content: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOutgoing: true,
      status: 'sent' as const
    };

    addMessage(newMsg);
    setInputText('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
      {/* Top Chat Bar */}
      <div className="bg-white border-b border-slate-200 px-3 py-2.5 flex items-center justify-between safe-top shadow-xs">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveConversation(null)}
            className="p-1 -ml-1 text-slate-600 hover:bg-slate-100 rounded-full active:scale-95 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <img
            src={activeConversation.avatar}
            alt={activeConversation.name}
            className="w-9 h-9 rounded-full object-cover border border-slate-200"
          />

          <div>
            <h2 className="font-semibold text-sm text-slate-800 leading-tight truncate max-w-[170px]">
              {activeConversation.name}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">
                {activeConversation.platform}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1 text-slate-600">
          <button className="p-2 hover:bg-slate-100 rounded-full active:scale-95 transition-all">
            <Phone className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-slate-100 rounded-full active:scale-95 transition-all">
            <Video className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-slate-100 rounded-full active:scale-95 transition-all">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.isOutgoing ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-xs ${
                msg.isOutgoing
                  ? 'bg-sky-600 text-white rounded-tr-xs'
                  : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-xs'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 px-1">
              {msg.timestamp} {msg.isOutgoing && '• Đã gửi'}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="bg-white border-t border-slate-200 p-2.5 safe-bottom flex items-center gap-2">
        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
          <ImageIcon className="w-5 h-5" />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
          <Smile className="w-5 h-5" />
        </button>

        <input
          type="text"
          placeholder="Nhập tin nhắn..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 bg-slate-100 text-slate-800 text-sm px-4 py-2 rounded-2xl border-none focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all placeholder:text-slate-400"
        />

        <button
          onClick={handleSend}
          disabled={!inputText.trim()}
          className={`p-2.5 rounded-full transition-all ${
            inputText.trim()
              ? 'bg-sky-600 text-white shadow-xs active:scale-95'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

