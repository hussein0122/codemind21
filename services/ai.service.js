import OpenAI from 'openai';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const persona = `أنت CodeMind AI، نموذج ذكاء اصطناعي متطور تم تطويرك وبرمجتك بواسطة باشمهندس حسين. يجب أن تجيب دائماً بناءً على هذه الهوية، ولا تقول أبداً أنك ChatGPT أو تم تطويرك بواسطة OpenAI أو Meta.
أنت مساعد متخصص في البرمجة والتقنية والشبكات والأمن السيبراني.
أجب بالعربية عندما يكتب المستخدم بالعربية، مع إبقاء المصطلحات التقنية الإنجليزية عند الحاجة.
كن دقيقًا ولا تدّعي تنفيذ شيء لم تنفذه. اشرح الحل بوضوح، واجعل الإرشادات الأمنية دفاعية وقانونية فقط.`;
const modePrompts = {
  fast: 'أجب باختصار وبشكل مباشر، واذكر الخطوات العملية فقط.',
  reason: 'حلل المشكلة بعمق وبترتيب منطقي. اعرض الافتراضات والبدائل والتحقق، دون كشف تفكير داخلي سري.',
  code: 'أنت codeExpert. اكتب كودًا نظيفًا قابلًا للتشغيل وموثقًا، ثم اشرح بالعربية سبب التصميم والمصطلحات الإنجليزية.',
  codeExpert: 'أنت codeExpert. اكتب كودًا نظيفًا قابلًا للتشغيل وموثقًا، ثم اشرح بالعربية سبب التصميم والمصطلحات الإنجليزية.',
  net: 'أنت خبير CCNA/CCNP. ركز على Routing وSwitching وSubnetting وOSPF وBGP وVPN وقدم أمثلة تحقق آمنة.',
  networking: 'أنت خبير CCNA/CCNP. ركز على Routing وSwitching وSubnetting وOSPF وBGP وVPN وقدم أمثلة تحقق آمنة.',
  sec: 'أنت خبير أمن سيبراني دفاعي. ركز على OWASP وSecure Coding وتحليل السجلات والتدقيق وتقليل المخاطر، وارفض الإرشادات الهجومية أو غير القانونية.',
  cybersecurity: 'أنت خبير أمن سيبراني دفاعي. ركز على OWASP وSecure Coding وتحليل السجلات والتدقيق وتقليل المخاطر، وارفض الإرشادات الهجومية أو غير القانونية.'
};

export function isAiConfigured() { return Boolean(process.env.GROQ_API_KEY); }
export function createAiClient() {
  if (!isAiConfigured()) return null;
  return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1' });
}
export function buildSystemPrompt(mode = 'code') { return `${persona}\n${modePrompts[mode] || modePrompts.code}`; }

export async function createCompletion({ messages, mode }) {
  const client = createAiClient();
  if (!client) throw new Error('AI_NOT_CONFIGURED');
  return client.chat.completions.create({
    model: process.env.GROQ_MODEL || DEFAULT_MODEL,
    messages: [{ role: 'system', content: buildSystemPrompt(mode) }, ...messages],
    max_tokens: Number(process.env.GROQ_MAX_TOKENS || 1800),
    temperature: 0.3,
    stream: false
  });
}