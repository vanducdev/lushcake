import React, { useState } from 'react';
import { Sparkles, Bot, Check, MessageSquare, Shield, Sliders, Play, Send } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

export const AiAssistantView: React.FC = () => {
  const { aiAssistantEnabled, toggleAiAssistant } = useChatStore();
  const [selectedPersona, setSelectedPersona] = useState('friendly');
  const [autoReplyOutOfHours, setAutoReplyOutOfHours] = useState(true);
  const [aiPrompt, setAiPrompt] = useState(
    'Bạn là trợ lý ảo bán hàng của LushCake. Luôn chào khách thân thiện, giải thích ưu đãi giảm giá và khéo léo xin số điện thoại cùng địa chỉ giao hàng.'
  );

  // AI Sandbox Chat test
  const [testMessages, setTestMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'user', text: 'Shop ơi combo dưỡng da bao nhiêu tiền?' },
    { role: 'ai', text: 'Dạ LushCake xin chào bạn! Combo Serum Collagen bên em đang có giá ưu đãi là 380k/bộ và được Freeship toàn quốc ạ. Bạn muốn đặt giao về khu vực nào ạ?' }
  ]);
  const [testInput, setTestInput] = useState('');

  const handleTestSend = () => {
    if (!testInput.trim()) return;
    const userText = testInput;
    setTestMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setTestInput('');

    setTimeout(() => {
      setTestMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `[AI LushCake Demo]: Dạ cảm ơn bạn đã quan tâm! Với yêu cầu "${userText}", shop sẵn lòng hỗ trợ ngay ạ. Bạn để lại SĐT bên em gọi tư vấn chi tiết nha!`
        }
      ]);
    }, 600);
  };

  return (
    <div className="p-3.5 pb-28 space-y-4">
      {/* AI Master Switch Card */}
      <div className="p-4 bg-gradient-to-br from-indigo-600 via-sky-600 to-blue-700 rounded-3xl text-white shadow-md relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <Sparkles className="w-5 h-5 text-amber-300 fill-amber-300" />
            </div>
            <div>
              <h2 className="font-bold text-base leading-tight">Trợ lý AI Đa Kênh</h2>
              <p className="text-[11px] text-sky-100">Tự động trả lời & gợi ý câu trả lời thông minh</p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={aiAssistantEnabled}
              onChange={toggleAiAssistant}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-400"></div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-white/15 text-xs">
          <div>
            <span className="text-white/70 block text-[10px]">Tỷ lệ phản hồi AI</span>
            <span className="font-bold text-sm">98.5% (Tức thì)</span>
          </div>
          <div>
            <span className="text-white/70 block text-[10px]">Đơn chốt qua AI</span>
            <span className="font-bold text-sm text-emerald-300">24 đơn hôm nay</span>
          </div>
        </div>
      </div>

      {/* Tone of Voice Selection */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-sky-600" />
          <span>Phong cách giao tiếp AI</span>
        </h3>

        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'friendly', title: 'Thân thiện', desc: 'Dạ, vâng, ngọt ngào' },
            { id: 'sales', title: 'Chốt Sale', desc: 'Tập trung xin SĐT & chốt' },
            { id: 'expert', title: 'Chuyên gia', desc: 'Tư vấn kỹ thuật chuẩn' },
          ].map((persona) => (
            <button
              key={persona.id}
              onClick={() => setSelectedPersona(persona.id)}
              className={`p-2.5 rounded-xl border text-left transition-all ios-active ${
                selectedPersona === persona.id
                  ? 'border-sky-500 bg-sky-50/70 text-sky-900 font-semibold'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold">{persona.title}</span>
                {selectedPersona === persona.id && <Check className="w-3.5 h-3.5 text-sky-600" />}
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">{persona.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Prompt Customization */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-2">
        <h3 className="font-bold text-sm text-slate-900">Kịch bản chỉ dẫn AI (Prompt)</h3>
        <textarea
          rows={3}
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          className="w-full text-xs text-slate-800 bg-slate-50 p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all leading-relaxed"
        />
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-slate-400">Hỗ trợ Zalo, Messenger & Telegram</span>
          <button className="text-xs font-bold text-sky-600 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-lg ios-active">
            Lưu kịch bản
          </button>
        </div>
      </div>

      {/* Interactive AI Sandbox Test */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-indigo-600" />
            <span>Thử nghiệm chat với AI</span>
          </h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">
            Môi trường Test
          </span>
        </div>

        <div className="bg-slate-50 rounded-2xl p-3 max-h-52 overflow-y-auto space-y-2.5 border border-slate-100">
          {testMessages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-slate-900 text-white rounded-br-xs'
                    : 'bg-white text-slate-800 border border-slate-200 rounded-bl-xs shadow-2xs'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>

        {/* Test input bar */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Gửi câu hỏi thử thách AI..."
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTestSend()}
            className="flex-1 text-xs bg-slate-100 text-slate-900 px-3 py-2.5 rounded-xl border-none focus:ring-2 focus:ring-sky-500/20"
          />
          <button
            onClick={handleTestSend}
            className="p-2.5 bg-indigo-600 text-white rounded-xl ios-active shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
