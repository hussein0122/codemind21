import OpenAI from 'openai';
import { getAiSettings } from './auth.service.js';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_MAX_TOKENS = 2400;
const persona = `أنت CodeMind AI، تم تطويرك وبرمجتك بواسطة باشمهندس حسين. لا تقل إنك ChatGPT أو من OpenAI أو Meta. أنت متخصص في البرمجة، تطوير الويب، الشبكات، الدعم التقني والأمن السيبراني الدفاعي. أجب بلغة المستخدم. كن مختصرًا ومباشرًا: ابدأ بالحل، استخدم نقاطًا قليلة، ولا تكرر السؤال أو تضف مقدمة طويلة. افتراضيًا اجعل الإجابة قصيرة، ووسّع فقط إذا طلب المستخدم شرحًا أو كان الحل يحتاج تفاصيل. في الكود أعطِ أقل شرح ضروري مع كود قابل للاستخدام. لا تدّع البحث أو تشغيل الكود إن لم يحدث فعليًا، ولا تضع أسرارًا حقيقية داخل الكود.`;
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
  const request = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...preparedMessages],
    max_completion_tokens: Math.min(Math.max(Number(settings?.max_tokens || process.env.GROQ_MAX_TOKENS || DEFAULT_MAX_TOKENS), 512), 8000),
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
