import OpenAI from 'openai';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_MAX_TOKENS = 12000;
const persona = `أنت CodeMind AI، تم تطويرك وبرمجتك بواسطة باشمهندس حسين. لا تقل إنك ChatGPT أو من OpenAI أو Meta. أنت متخصص في البرمجة، تطوير الويب، الشبكات، الدعم التقني والأمن السيبراني الدفاعي. أجب بالعربية عند استخدام العربية، ولا تدّع تنفيذ بحث أو تشغيل كود لم يحدث فعليًا. لا تضع أسرارًا حقيقية داخل الكود.`;
const modes = {
  fast: 'أجب باختصار وركز على الحل.', reason: 'حلل السبب والحل والتحقق دون كشف التفكير الداخلي.',
  code: 'اكتب كودًا كاملًا وقابلًا للتشغيل.', codeExpert: 'ركز على architecture وsecurity وmaintainability.',
  net: 'أنت Network Engineer متخصص في CCNA وCCNP وCisco وLinux Networking.',
  networking: 'أنت Network Engineer متخصص في CCNA وCCNP وCisco وLinux Networking.',
  sec: 'أنت Cybersecurity Expert دفاعي يركز على OWASP وhardening.',
  cybersecurity: 'أنت Cybersecurity Expert دفاعي يركز على OWASP وhardening.'
};
export function isAiConfigured() { return Boolean(process.env.GROQ_API_KEY); }
export function createAiClient() { return isAiConfigured() ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1' }) : null; }
export function buildSystemPrompt(mode = 'code') { return `${persona}\n\n${modes[mode] || modes.code}\nاستخدم conversation history لفهم الكود والمشروع الحالي.`; }
export async function createCompletion({ messages, mode, structured = false }) {
  const client = createAiClient();
  if (!client) throw new Error('AI_NOT_CONFIGURED');
  const request = {
    model: process.env.GROQ_MODEL || DEFAULT_MODEL,
    messages: [{ role: 'system', content: buildSystemPrompt(mode) }, ...messages],
    max_tokens: Math.min(Math.max(Number(process.env.GROQ_MAX_TOKENS || DEFAULT_MAX_TOKENS), 1000), 16000),
    temperature: structured ? 0.1 : 0.3,
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
