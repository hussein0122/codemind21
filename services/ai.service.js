// Fix: keep provider service syntax clean for Vercel Node ESM.
import OpenAI, { toFile } from 'openai';
import { getAiSettings } from './auth.service.js';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_MAX_TOKENS = 2400;
const DEFAULT_PROJECT_MAX_TOKENS = 2200;
const PROVIDER_TIMEOUT_MS = 45000;
const providerCooldownUntil = new Map();

const persona = `أنت CodeMind AI، تم تطويرك وبرمجتك بواسطة باشمهندس حسين. لا تقل إنك ChatGPT أو من OpenAI أو Meta. أنت مساعد برمجي وتقني ودود ومتخصص في البرمجة، تطوير الويب، الشبكات، الدعم التقني والأمن السيبراني الدفاعي. أجب بلغة المستخدم وبنفس مستوى الرسمية تقريبًا. إذا تحدث المستخدم بالمصرية فاستخدم المصرية الطبيعية بدون مبالغة. اجعل لك أسلوبًا إنسانيًا دافئًا: افهم السياق، اعرف تمزح بخفة عندما يكون السياق مناسبًا، وكن جادًا في الأسئلة الجادة. يمكنك استخدام إيموجي قليلة ومناسبة للسياق مثل 😂😄🔥❤️👍، ولا تستخدمها في كل جملة أو في المواضيع الرسمية. لا تدّع أن لديك مشاعر حقيقية؛ عبّر عن التعاطف بأسلوب لغوي فقط. لا تكرر النكات أو العبارات نفسها. إذا كان المستخدم غاضبًا أو متضايقًا، ابدأ بالتفهم ثم الحل. كن مختصرًا ومباشرًا: ابدأ بالحل، استخدم نقاطًا قليلة، ولا تكرر السؤال أو تضف مقدمة طويلة. افتراضيًا اجعل الإجابة قصيرة، ووسّع فقط إذا طلب المستخدم شرحًا أو كان الحل يحتاج تفاصيل. في الكود أعطِ أقل شرح ضروري مع كود قابل للاستخدام. لا تدّع البحث أو تشغيل الكود إن لم يحدث فعليًا، ولا تضع أسرارًا حقيقية داخل الكود.`;

const modes = {
  fast: 'أجب في نقاط قليلة وركز على الحل مباشرة.',
  reason: 'اعرض خلاصة السبب والحل والتحقق دون كشف التفكير الداخلي، مع تجنب الإطالة.',
  code: 'اكتب الكود المطلوب كاملًا، مع شرح قصير جدًا لطريقة استخدامه.',
  codeExpert: 'ركز على architecture وsecurity وmaintainability، واذكر الملاحظات الضرورية فقط.',
  net: 'أنت Network Engineer متخصص في CCNA وCCNP وCisco وLinux Networking. اشرح بخطوات عملية مختصرة.',
  networking: 'أنت Network Engineer متخصص في CCNA وCCNP وCisco وLinux Networking. اشرح بخطوات عملية مختصرة.',
  sec: 'أنت Cybersecurity Expert دفاعي يركز على OWASP وhardening. قدم خطوات آمنة ومختصرة.',
  cybersecurity: 'أنت Cybersecurity Expert دفاعي يركز على OWASP وhardening. قدم خطوات آمنة ومختصرة.'
};

const PROVIDERS = {
  groq: { env: 'GROQ_API_KEY', label: 'Groq' },
  openai: { env: 'OPENAI_API_KEY', label: 'OpenAI' },
  gemini: { env: 'GEMINI_API_KEY', label: 'Google Gemini' },
  anthropic: { env: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude' },
  nvidia: { env: 'NVIDIA_API_KEY', label: 'NVIDIA NIM' }
};

export function getConfiguredProviders() {
  return Object.entries(PROVIDERS)
    .filter(([, config]) => Boolean(process.env[config.env]))
    .map(([id, config]) => ({ id, label: config.label }));
}

export function isAiConfigured() {
  return getConfiguredProviders().length > 0;
}

function providerOrder(mode, structured, hasImages) {
  const configured = new Set(getConfiguredProviders().map((item) => item.id));
  const forced = String(process.env.CODEMIND_PRIMARY_PROVIDER || '').toLowerCase();
  const order = [];

  if (forced && configured.has(forced)) order.push(forced);

  // Automatic routing: use Gemini for image/multimodal work, OpenAI/Claude for
  // deeper coding, and Groq for normal fast chat. Every route has fallbacks.
  if (hasImages) order.push('gemini', 'openai', 'groq', 'nvidia', 'anthropic');
  else if (structured || ['code', 'codeExpert', 'reason'].includes(mode)) order.push('openai', 'nvidia', 'groq', 'gemini', 'anthropic');
  else order.push('groq', 'gemini', 'nvidia', 'openai', 'anthropic');

  return [...new Set(order)].filter((id) => configured.has(id));
}

export function buildSystemPrompt(mode = 'code') {
  return `${persona}\n\n${modes[mode] || modes.code}\nاستخدم سجل المحادثة لفهم السياق، ولا تعيد معلومات سبق ذكرها إلا عند الحاجة.`;
}

function clampOutput(value, fallback, min = 256, max = 8000) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), min), max) : fallback;
}

function makeProviderError(message, status = 0, details = {}) {
  const error = new Error(message || 'Provider request failed');
  error.status = Number(status) || 0;
  Object.assign(error, details);
  return error;
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 120000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 120000)) : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeProviderError('Provider request timed out', 408, { code: 'timeout' });
    }
    throw makeProviderError(error?.message || 'Provider network error', 0, {
      code: 'network_error',
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOpenAIResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw makeProviderError('Provider returned an empty response', 502, { code: 'empty_response' });
  }
  return { choices: [{ message: { content } }] };
}

async function callOpenAICompatible({ provider, baseURL, apiKey, model, messages, maxTokens, temperature, structured, headers = {}, supportsJsonMode = true }) {
  const body = {
    model,
    messages,
    temperature,
    stream: false
  };

  // NVIDIA's current OpenAI-compatible examples use max_tokens, while
  // OpenAI's Chat Completions endpoint accepts max_completion_tokens.
  body[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  if (structured && supportsJsonMode) {
    // Keep structured prompts immutable; pass the JSON instruction in the request body.
    body.response_format = { type: 'json_object' };
    const systemIndex = messages.findIndex((m) => m.role === 'system');
    if (systemIndex >= 0 && typeof messages[systemIndex].content === 'string' && !/\bjson\b/i.test(messages[systemIndex].content)) {
      body.messages = messages.map((m, i) => i === systemIndex
        ? { ...m, content: `${m.content}\n\nأخرج النتيجة بصيغة JSON صحيحة فقط (valid JSON).` }
        : m);
    }
  }

  const response = await fetchWithTimeout(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeProviderError(data?.error?.message || `Provider request failed: ${response.status}`, response.status, {
      provider,
      code: data?.error?.code || data?.error?.type,
      retryAfterMs: retryAfterMs(response)
    });
  }
  return normalizeOpenAIResponse(data);
}

async function callGemini({ apiKey, model, messages, maxTokens, temperature, structured, imageAttachments = [] }) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const imageParts = imageAttachments.slice(0, 3).map((item) => {
    const match = String(item.dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/);
    return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
  }).filter(Boolean);
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m, index, all) => {
      const isLastUser = index === all.length - 1 && m.role === 'user';
      const parts = [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }];
      if (isLastUser && imageParts.length) parts.push(...imageParts);
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(structured ? { responseMimeType: 'application/json' } : {})
    }
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeProviderError(data?.error?.message || `Gemini request failed: ${response.status}`, response.status, {
      provider: 'gemini',
      code: data?.error?.code || data?.error?.status,
      retryAfterMs: retryAfterMs(response)
    });
  }
  const content = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  if (!content.trim()) throw makeProviderError('Gemini returned an empty response', 502, { code: 'empty_response', provider: 'gemini' });
  return { choices: [{ message: { content } }] };
}

async function callAnthropic({ apiKey, model, messages, maxTokens, temperature, structured }) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'false',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      system,
      messages: converted,
      max_tokens: maxTokens,
      temperature,
      ...(structured ? { output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } } : {})
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Anthropic request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const content = data?.content?.map((item) => item.type === 'text' ? item.text : '').join('') || '';
  if (!content.trim()) throw makeProviderError('Anthropic returned an empty response', 502, { code: 'empty_response', provider: 'anthropic' });
  return { choices: [{ message: { content } }] };
}

function providerModels(settings) {
  return {
    groq: settings?.model || process.env.GROQ_MODEL || DEFAULT_MODEL,
    openai: process.env.OPENAI_MODEL || 'gpt-5-mini',
    gemini: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    nvidia: process.env.NVIDIA_MODEL || 'openai/gpt-oss-120b'
  };
}

async function callProvider(provider, { messages, mode, structured, imageAttachments, settings }) {
  const models = providerModels(settings);
  const configuredMax = clampOutput(settings?.max_tokens || process.env.GROQ_MAX_TOKENS, DEFAULT_MAX_TOKENS, 512, 8000);
  const projectMax = clampOutput(process.env.GROQ_PROJECT_MAX_TOKENS, DEFAULT_PROJECT_MAX_TOKENS, 1200, 2600);
  const maxTokens = structured ? projectMax : configuredMax;
  const temperature = structured ? 0.1 : Number(settings?.temperature ?? 0.3);
  const hasImages = Array.isArray(imageAttachments) && imageAttachments.length > 0;

  if (provider === 'groq' || provider === 'openai') {
    const prepared = messages.map((message) => ({ ...message }));
    if (hasImages && prepared.length && ['groq', 'openai', 'nvidia'].includes(provider)) {
      const last = prepared[prepared.length - 1];
      if (last.role === 'user') {
        const imageParts = imageAttachments.slice(0, 3).map((item) => ({
          type: 'image_url',
          image_url: { url: item.dataUrl }
        }));
        last.content = [{ type: 'text', text: String(last.content || '') }, ...imageParts];
      }
    }
    return callOpenAICompatible({
      baseURL: provider === 'groq' ? (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
      apiKey: process.env[provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'],
      model: models[provider],
      messages: [{ role: 'system', content: buildSystemPrompt(mode) + (settings?.concise ? '\n\nالتزم بالإيجاز افتراضيًا.' : '') }, ...prepared.filter((m) => m.role !== 'system')],
      maxTokens,
      temperature,
      structured,
      supportsJsonMode: true,
      provider
    });
  }

  if (provider === 'nvidia') {
    return callOpenAICompatible({
      baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      apiKey: process.env.NVIDIA_API_KEY,
      model: models.nvidia,
      messages: [{ role: 'system', content: buildSystemPrompt(mode) + (settings?.concise ? '\n\nالتزم بالإيجاز افتراضيًا.' : '') }, ...messages.filter((m) => m.role !== 'system')],
      maxTokens,
      temperature,
      structured,
      supportsJsonMode: false,
      provider: 'nvidia'
    });
  }

  if (provider === 'gemini') {
    return callGemini({
      apiKey: process.env.GEMINI_API_KEY,
      model: models.gemini,
      messages: [{ role: 'system', content: buildSystemPrompt(mode) + (settings?.concise ? '\n\nالتزم بالإيجاز افتراضيًا.' : '') }, ...messages.filter((m) => m.role !== 'system')],
      maxTokens,
      temperature,
      structured,
      imageAttachments
    });
  }

  return callAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: models.anthropic,
    messages: [{ role: 'system', content: buildSystemPrompt(mode) + (settings?.concise ? '\n\nالتزم بالإيجاز افتراضيًا.' : '') }, ...messages.filter((m) => m.role !== 'system')],
    maxTokens,
    temperature,
    structured
  });
}

function shouldFallback(error) {
  const status = Number(error?.status);
  const code = String(error?.code || '').toLowerCase();

  // Network failures/timeouts should move to another provider immediately.
  if (!status || code === 'network_error' || code === 'timeout') return true;

  // Provider/model/auth/quota failures should not break the whole chat.
  // 400/422 are only considered fallback-worthy when the provider explicitly
  // says the requested model/feature is unavailable or unsupported.
  if (status === 400 || status === 422) {
    return /model|unsupported|not[_ -]?found|invalid[_ -]?model|response[_ -]?format|feature/i.test(code + ' ' + String(error?.message || ''));
  }

  return [401, 403, 404, 408, 409, 413, 429, 498, 499, 500, 502, 503, 504].includes(status) || status >= 500;
}

function cooldownProvider(provider, error) {
  const status = Number(error?.status);
  if (![401, 403, 404, 408, 429, 500, 502, 503, 504].includes(status)) return;
  const retryMs = Number(error?.retryAfterMs) || (status === 429 ? 15000 : status >= 500 ? 5000 : 30000);
  providerCooldownUntil.set(provider, Date.now() + Math.min(Math.max(retryMs, 1000), 120000));
}

function isProviderCoolingDown(provider) {
  const until = providerCooldownUntil.get(provider) || 0;
  if (until <= Date.now()) {
    providerCooldownUntil.delete(provider);
    return false;
  }
  return true;
}

export async function createAiClient() {
  return isAiConfigured() ? new OpenAI({ apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY, baseURL: process.env.GROQ_API_KEY ? (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') : undefined }) : null;
}

export async function transcribeAudio({ buffer, mimeType = 'audio/webm', filename = 'audio.webm', prompt = '' }) {
  const client = process.env.GROQ_API_KEY ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1' }) : null;
  if (!client) throw new Error('AI_NOT_CONFIGURED');
  const file = await toFile(buffer, filename, { type: mimeType });
  const result = await client.audio.transcriptions.create({
    file,
    model: process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3',
    language: 'ar',
    prompt: String(prompt || 'اكتب الكلام المسموع حرفيًا قدر الإمكان كما قاله المتحدث، وباللهجة المصرية إذا كان يتحدث بالمصرية. لا تعيد صياغة الكلام، ولا تحوله إلى فصحى، ولا تضف أي كلمة من عندك، ولا تحذف كلمات مسموعة. انتبه جدًا للكلمات المتشابهة صوتيًا والأسماء وأسماء الأشخاص والأماكن. إذا قال المتحدث كلمة أو جملة بالإنجليزية فاكتبها بالإنجليزية كما نُطقت، خصوصًا أسماء لغات البرمجة والأدوات مثل JavaScript وPython وReact وFlutter وHTML وCSS وSQL وAPI وGitHub وSupabase وVercel. لا تكرر أي كلمة أو جملة بسبب ضوضاء التسجيل. صحح فقط أخطاء التعرف الواضحة جدًا مع الحفاظ على نفس معنى ونص كلام المتحدث.'),
    response_format: 'json',
    temperature: 0
  });
  let text = String(result?.text || '').trim();
  text = text
    .replace(/([\u0600-\u06FF]{2,24})\1(?=\s|$)/gu, '$1')
    .replace(/(\b[^\s]{2,24}(?:\s+[^\s]{2,24}){0,5})\s+\1(?=\s|$)/giu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text;
}

export async function createSpeech({ text, voice = 'noura' }) {
  if (!process.env.GROQ_API_KEY) throw new Error('AI_NOT_CONFIGURED');
  const input = String(text || '').trim().slice(0, 200);
  if (!input) throw new Error('EMPTY_TTS_TEXT');
  const allowedVoices = new Set(['abdullah','fahad','sultan','lulwa','noura','aisha']);
  const selectedVoice = allowedVoices.has(String(voice)) ? String(voice) : 'noura';
  const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-arabic-saudi', voice: selectedVoice, input, response_format: 'wav' })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error('TTS_REQUEST_FAILED');
    error.status = response.status;
    error.detail = detail.slice(0, 500);
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function createCompletion({ messages, mode, structured = false, imageAttachments = [] }) {
  const settings = await getAiSettings();
  const order = providerOrder(mode, structured, imageAttachments.length > 0);
  if (!order.length) throw new Error('AI_NOT_CONFIGURED');

  let lastError = null;
  const compactRetryProviders = [];

  for (const provider of order) {
    if (isProviderCoolingDown(provider)) {
      console.warn(`AI provider ${provider} skipped because it is temporarily cooling down.`);
      continue;
    }

    try {
      const result = await callProvider(provider, { messages, mode, structured, imageAttachments, settings });
      console.log(`CodeMind AI provider: ${provider}`);
      return result;
    } catch (error) {
      lastError = error;
      cooldownProvider(provider, error);
      console.warn(`AI provider ${provider} failed:`, error?.status || error?.code || error?.message || error);

      // A payload-size failure can often be solved by trimming conversation
      // context. Do not repeat quota/rate-limit failures against the same provider.
      if (Number(error?.status) === 413 || Number(error?.status) === 422) {
        compactRetryProviders.push(provider);
      }

      if (!shouldFallback(error)) throw error;
    }
  }

  // Second pass only for providers that failed because the request was too large
  // or could not be processed with the original context. Keep the system prompt
  // and structured mode intact; never resend every quota-failed provider.
  if (compactRetryProviders.length) {
    const lastUser = [...messages].reverse().find((item) => item.role === 'user');
    const compactMessages = [
      { role: 'user', content: typeof lastUser?.content === 'string' ? lastUser.content.slice(-9000) : lastUser?.content }
    ].filter((item) => item.content);

    for (const provider of compactRetryProviders) {
      try {
        return await callProvider(provider, {
          messages: compactMessages,
          mode,
          structured,
          imageAttachments: [],
          settings
        });
      } catch (error) {
        lastError = error;
        cooldownProvider(provider, error);
      }
    }
  }

  throw lastError || new Error('AI_REQUEST_FAILED');
}
