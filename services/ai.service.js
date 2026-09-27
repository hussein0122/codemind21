import OpenAI, { toFile } from 'openai';
import { getAiSettings } from './auth.service.js';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_MAX_TOKENS = 2400;
const DEFAULT_PROJECT_MAX_TOKENS = 2200;

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

function normalizeOpenAIResponse(data) {
  return { choices: [{ message: { content: data?.choices?.[0]?.message?.content || '' } }] };
}

async function callOpenAICompatible({ baseURL, apiKey, model, messages, maxTokens, temperature, structured, headers = {} }) {
  const body = {
    model,
    messages,
    max_completion_tokens: maxTokens,
    temperature,
    stream: false
  };
  if (structured) {
    body.response_format = { type: 'json_object' };
    const systemIndex = messages.findIndex((m) => m.role === 'system');
    if (systemIndex >= 0 && typeof messages[systemIndex].content === 'string' && !/\bjson\b/i.test(messages[systemIndex].content)) {
      body.messages = messages.map((m, i) => i === systemIndex
        ? { ...m, content: `${m.content}\n\nأخرج النتيجة بصيغة JSON صحيحة فقط (valid JSON).` }
        : m);
    }
  }

  const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Provider request failed: ${response.status}`);
    error.status = response.status;
    error.provider = data?.error?.type || data?.error?.code;
    throw error;
  }
  return normalizeOpenAIResponse(data);
}

async function callGemini({ apiKey, model, messages, maxTokens, temperature, structured }) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

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
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Gemini request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const content = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  return { choices: [{ message: { content } }] };
}

async function callAnthropic({ apiKey, model, messages, maxTokens, temperature, structured }) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
  return { choices: [{ message: { content } }] };
}

function providerModels(settings) {
  return {
    groq: settings?.model || process.env.GROQ_MODEL || DEFAULT_MODEL,
    openai: process.env.OPENAI_MODEL || 'gpt-5-mini',
    gemini: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
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
    if (hasImages && provider === 'groq' && prepared.length) {
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
      structured
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
      structured
    });
  }

  if (provider === 'gemini') {
    return callGemini({
      apiKey: process.env.GEMINI_API_KEY,
      model: models.gemini,
      messages: [{ role: 'system', content: buildSystemPrompt(mode) + (settings?.concise ? '\n\nالتزم بالإيجاز افتراضيًا.' : '') }, ...messages.filter((m) => m.role !== 'system')],
      maxTokens,
      temperature,
      structured
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
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 413 || status === 429 || status >= 500;
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
  for (const provider of order) {
    try {
      const result = await callProvider(provider, { messages, mode, structured, imageAttachments, settings });
      console.log(`CodeMind AI provider: ${provider}`);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`AI provider ${provider} failed:`, error?.status || error?.message || error);
      if (!shouldFallback(error)) throw error;

      // Keep project generation alive under provider TPM/rate limits by retrying the
      // same request on the next configured brain with compact context.
      if (provider === order[order.length - 1]) break;
    }
  }

  // One final compact fallback on the first available provider.
  if (lastError) {
    const lastUser = [...messages].reverse().find((item) => item.role === 'user');
    const compactMessages = lastUser ? [{ role: 'user', content: typeof lastUser.content === 'string' ? lastUser.content.slice(-9000) : lastUser.content }] : messages.slice(-1);
    for (const provider of order) {
      try {
        return await callProvider(provider, { messages: compactMessages, mode, structured, imageAttachments: [], settings });
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error('AI_REQUEST_FAILED');
}
