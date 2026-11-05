"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestAICompletion = requestAICompletion;
const axios_1 = __importDefault(require("axios"));
const aiModelCatalog_1 = require("../../shared/aiModelCatalog");
function endpoint(platform, model, apiKey, baseUrl) {
    const base = baseUrl?.replace(/\/+$/, '');
    if (base) {
        if (base.includes(':generateContent') || base.endsWith('/chat/completions') || base.endsWith('/messages'))
            return base;
        if (platform === 'gemini')
            return `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        if (platform === 'claude')
            return `${base}/v1/messages`;
        return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    }
    if (platform === 'gemini')
        return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    if (platform === 'claude')
        return 'https://api.anthropic.com/v1/messages';
    switch (platform) {
        case 'deepseek': return 'https://api.deepseek.com/v1/chat/completions';
        case 'grok': return 'https://api.x.ai/v1/chat/completions';
        case 'mistral': return 'https://api.mistral.ai/v1/chat/completions';
        case '9router': return 'http://localhost:20128/v1/chat/completions';
        case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions';
        default: return 'https://api.openai.com/v1/chat/completions';
    }
}
function responsesEndpoint(baseUrl) {
    const base = baseUrl?.replace(/\/+$/, '');
    if (!base)
        return 'https://api.openai.com/v1/responses';
    if (base.endsWith('/responses'))
        return base;
    const root = base.replace(/\/chat\/completions$/, '');
    return root.endsWith('/v1') ? `${root}/responses` : `${root}/v1/responses`;
}
function systemAndConversation(messages) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content.trim()).filter(Boolean).join('\n\n');
    const conversation = messages
        .filter(message => message.role !== 'system' && message.content?.trim())
        .map(message => ({ role: message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user', content: message.content }));
    return { system, conversation };
}
function asText(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(item => asText(item?.text ?? item?.content ?? item)).join('');
    if (value && typeof value === 'object')
        return asText(value.text ?? value.content ?? value.value ?? '');
    return '';
}
function usesGPT6Responses(platform, model) {
    return platform === 'openai' && /^gpt-6(?:[.-]|$)/.test(model);
}
function responsesInput(messages) {
    return messages
        .filter(message => message.content?.trim())
        .map(message => ({
        // Responses uses developer messages for application-level instructions.
        role: message.role === 'system'
            ? 'developer'
            : (message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user'),
        content: message.content,
    }));
}
function responsesText(response) {
    if (typeof response?.output_text === 'string')
        return response.output_text;
    return (response?.output || [])
        .filter((item) => item?.type === 'message')
        .flatMap((item) => item.content || [])
        .filter((part) => part?.type === 'output_text' || typeof part?.text === 'string')
        .map((part) => asText(part?.text))
        .join('');
}
function geminiPayload(messages, model, maxTokens, temperature) {
    const { system, conversation } = systemAndConversation(messages);
    const contents = conversation.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
    }));
    // Gemini requires at least one user turn even for malformed/empty input.
    if (!contents.length)
        contents.push({ role: 'user', parts: [{ text: 'Xin chào' }] });
    const generationConfig = {
        maxOutputTokens: model.startsWith('gemini-3.') ? Math.max(1024, maxTokens) : maxTokens,
        temperature,
    };
    if (model.startsWith('gemini-3.'))
        generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    return {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig,
    };
}
/** Provider-specific request and response adaptation shared by Assistants and Workflow. */
async function requestAICompletion(request) {
    const platform = String(request.platform || 'openai').toLowerCase();
    const model = (0, aiModelCatalog_1.normalizeAIModel)(platform, request.model);
    const maxTokens = Math.max(1, Math.floor(Number(request.maxTokens) || 500));
    const temperature = Number.isFinite(Number(request.temperature)) ? Number(request.temperature) : 0.7;
    const url = endpoint(platform, model, request.apiKey, request.baseUrl);
    if (platform === 'gemini') {
        const response = await axios_1.default.post(url, geminiPayload(request.messages, model, maxTokens, temperature), {
            headers: { 'Content-Type': 'application/json' }, timeout: 60000,
        });
        const result = (response.data?.candidates?.[0]?.content?.parts || []).map((part) => asText(part?.text)).join('').trim();
        const promptTokens = response.data?.usageMetadata?.promptTokenCount || 0;
        const completionTokens = response.data?.usageMetadata?.candidatesTokenCount || 0;
        return { result, model, promptTokens, completionTokens, totalTokens: response.data?.usageMetadata?.totalTokenCount || promptTokens + completionTokens };
    }
    if (platform === 'claude') {
        const { system, conversation } = systemAndConversation(request.messages);
        const claude5 = /^(claude-(?:fable|opus|sonnet)-5)/.test(model);
        const response = await axios_1.default.post(url, {
            model,
            max_tokens: maxTokens,
            ...(system ? { system } : {}),
            messages: conversation,
            // Claude 5 rejects non-default sampling parameters.
            ...(!claude5 ? { temperature } : {}),
        }, {
            headers: { 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            timeout: 60000,
        });
        const result = (response.data?.content || []).filter((part) => part?.type === 'text' || part?.text).map((part) => asText(part.text)).join('').trim();
        const promptTokens = response.data?.usage?.input_tokens || 0;
        const completionTokens = response.data?.usage?.output_tokens || 0;
        return { result, model, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
    }
    if (usesGPT6Responses(platform, model)) {
        const response = await axios_1.default.post(responsesEndpoint(request.baseUrl), {
            model,
            input: responsesInput(request.messages),
            // Responses requires at least 16 output tokens, even when a legacy
            // workflow saved a smaller maxTokens value.
            max_output_tokens: Math.max(16, maxTokens),
            // GPT-6 reasoning rejects sampling controls such as temperature. Omit
            // reasoning as well so the provider's documented model default applies.
        }, {
            headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000,
        });
        const promptTokens = response.data?.usage?.input_tokens || 0;
        const completionTokens = response.data?.usage?.output_tokens || 0;
        return {
            result: responsesText(response.data).trim(), model: response.data?.model || model,
            promptTokens, completionTokens, totalTokens: response.data?.usage?.total_tokens || promptTokens + completionTokens,
        };
    }
    const openAIRequest = {
        model,
        messages: request.messages.filter(message => message.content?.trim()),
        ...(platform === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        // GPT-5.6 only accepts its default temperature.
        temperature: platform === 'openai' && model.startsWith('gpt-5.6-') ? 1 : temperature,
    };
    // DeepSeek V4 uses the standard OpenAI-compatible request. Do not send its
    // obsolete thinking_mode field; its API rejects that legacy field.
    const response = await axios_1.default.post(url, openAIRequest, {
        headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000,
    });
    const raw = response.data?.choices?.[0]?.message?.content ?? response.data?.choices?.[0]?.text ?? response.data?.content ?? response.data?.response;
    const promptTokens = response.data?.usage?.prompt_tokens || 0;
    const completionTokens = response.data?.usage?.completion_tokens || 0;
    return {
        result: asText(raw).trim(), model: response.data?.model || model, promptTokens, completionTokens,
        totalTokens: response.data?.usage?.total_tokens || promptTokens + completionTokens,
    };
}
//# sourceMappingURL=AIProviderAdapter.js.map