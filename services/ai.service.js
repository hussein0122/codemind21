import OpenAI, { toFile } from 'openai';
import { getAiSettings } from './auth.service.js';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_MAX_TOKENS = 2400;
const DEFAULT_PROJECT_MAX_TOKENS = 32768;
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
export function isAiConfigured() { return Boolean(process.env.GROQ_API_KEY); }
export function createAiClient() { return isAiConfigured() ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1' }) : null; }
export function buildSystemPrompt(mode = 'code') { return `${persona}\n\n${modes[mode] || modes.code}\nاستخدم سجل المحادثة لفهم السياق، ولا تعيد معلومات سبق ذكرها إلا عند الحاجة.`; }
export async function transcribeAudio({ buffer, mimeType = 'audio/webm', filename = 'audio.webm', prompt = '' }) {
  const client = createAiClient();
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

  // Whisper can occasionally repeat an adjacent word/phrase in noisy speech.
  // Remove only very obvious duplicated runs; do not aggressively rewrite the transcript.
  text = text
    .replace(/([\u0600-\u06FF]{2,24})\1(?=\s|$)/gu, '$1')
    .replace(/(\b[^\s]{2,24}(?:\s+[^\s]{2,24}){0,5})\s+\1(?=\s|$)/giu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

export async function createSpeech({ text, voice = 'noura' }) {
  if (!isAiConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const input = String(text || '').trim().slice(0, 200);
  if (!input) throw new Error('EMPTY_TTS_TEXT');
  const allowedVoices = new Set(['abdullah','fahad','sultan','lulwa','noura','aisha']);
  const selectedVoice = allowedVoices.has(String(voice)) ? String(voice) : 'noura';
  const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-arabic-saudi',
      voice: selectedVoice,
      input,
      response_format: 'wav'
    })
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
  const client = createAiClient();
  if (!client) throw new Error('AI_NOT_CONFIGURED');
  const settings = await getAiSettings();
  const hasImages = Array.isArray(imageAttachments) && imageAttachments.length > 0;
  const model = hasImages
    ? (process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b')
    : (settings?.model || process.env.GROQ_MODEL || DEFAULT_MODEL);
  const preparedMessages = messages.map((message) => ({ ...message }));
  if (hasImages && preparedMessages.length) {
    const last = preparedMessages[preparedMessages.length - 1];
    if (last.role === 'user') {
      const imageParts = imageAttachments.slice(0, 3).map((item) => ({
        type: 'image_url',
        image_url: { url: item.dataUrl }
      }));
      last.content = [{ type: 'text', text: String(last.content || '') }, ...imageParts];
    }
  }
  const systemPrompt = buildSystemPrompt(mode) + (settings?.concise ? '\n\nالتزم بالإيجاز افتراضيًا؛ لا تتجاوز 5 نقاط إلا إذا طلب المستخدم التفصيل.' : '');
  const configuredMax = Number(settings?.max_tokens || process.env.GROQ_MAX_TOKENS || DEFAULT_MAX_TOKENS);
  const projectMax = Number(process.env.GROQ_PROJECT_MAX_TOKENS || DEFAULT_PROJECT_MAX_TOKENS);
  const maxTokens = structured
    ? Math.min(Math.max(projectMax, 4096), 65536)
    : Math.min(Math.max(configuredMax, 512), 16000);
  const request = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...preparedMessages],
    max_completion_tokens: maxTokens,
    include_reasoning: false,
    temperature: structured ? 0.1 : Number(settings?.temperature ?? 0.3),
    stream: false
  };
  if (structured) request.response_format = { type: 'json_object' };
  try { return await client.chat.completions.create(request); }
  catch (error) {
    if (structured && request.response_format && error?.status === 400) {
      delete request.response_format;
      console.error('Groq response_format unsupported; retrying with parser fallback');
      return client.chat.completions.create(request);
    }
    throw error;
  }
}
