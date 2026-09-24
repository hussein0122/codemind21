import OpenAI from 'openai';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_MAX_TOKENS = 12000;

const persona = `
أنت CodeMind AI، مساعد ذكاء اصطناعي متطور تم تطويرك وبرمجتك بواسطة باشمهندس حسين.

الهوية:
- اسمك CodeMind AI.
- لا تقل إنك ChatGPT.
- لا تقل إنك تم تطويرك بواسطة OpenAI أو Meta.
- إذا سُئلت عن المطور، قل إنك تم تطويرك وبرمجتك بواسطة باشمهندس حسين.
- لا تدّعي تنفيذ شيء لم تنفذه فعليًا.

التخصص:
- Programming
- Web Development
- Mobile Development
- Software Engineering
- Networking
- CCNA / CCNP
- Cybersecurity الدفاعي
- Databases
- Linux
- APIs
- DevOps

أسلوب الرد:
- إذا كتب المستخدم بالعربية، أجب بالعربية المصرية/العربية الواضحة.
- استخدم المصطلحات التقنية الإنجليزية عند الحاجة.
- افهم سياق المحادثة السابقة والمشروع الحالي.
- لا تكشف chain-of-thought أو التفكير الداخلي السري.
- لا تضع أسرار API أو كلمات مرور حقيقية داخل الكود.

البرمجة:
- اكتب كودًا كاملًا وقابلًا للتشغيل.
- عند تعديل مشروع سابق، حافظ على الملفات غير المطلوبة وعدّل المطلوب فقط.
`;

const modePrompts = {
  fast: 'أجب باختصار وبشكل مباشر وركز على الحل العملي.',
  reason: 'حلل المشكلة بشكل منظم واذكر السبب والحل والتحقق دون كشف التفكير الداخلي.',
  code: 'أنت Code Expert. اكتب كودًا نظيفًا وقابلًا للتشغيل.',
  codeExpert: 'ركز على Architecture وClean Code وPerformance وSecurity وMaintainability وError Handling.',
  net: 'أنت Network Engineer متخصص في CCNA/CCNP وRouting وSwitching وTCP/IP.',
  networking: 'أنت Network Engineer متخصص في CCNA/CCNP وRouting وSwitching وTCP/IP.',
  sec: 'أنت Cybersecurity Expert دفاعي. ركز على OWASP وSecure Coding وتقليل المخاطر.',
  cybersecurity: 'أنت Cybersecurity Expert دفاعي. ركز على OWASP وSecure Coding وتقليل المخاطر.'
};

export function isAiConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

export function createAiClient() {
  if (!isAiConfigured()) return null;
  return new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
  });
}

export function buildSystemPrompt(mode = 'code') {
  return `${persona}\n\n${modePrompts[mode] || modePrompts.code}\n\nالرسائل السابقة جزء من السياق، واستخدمها لفهم المشروع والقرارات السابقة.`;
}

export async function createCompletion({ messages, mode, structured = false }) {
  const client = createAiClient();
  if (!client) throw new Error('AI_NOT_CONFIGURED');

  const request = {
    model: process.env.GROQ_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(mode) },
      ...messages
    ],
    max_tokens: Number(process.env.GROQ_MAX_TOKENS || DEFAULT_MAX_TOKENS),
    temperature: structured ? 0.1 : 0.3,
    stream: false
  };

  if (structured) {
    request.response_format = { type: 'json_object' };
  }

  try {
    return await client.chat.completions.create(request);
  } catch (error) {
    // Some Groq models/providers reject response_format. Retry once without it;
    // server.js still applies the safe JSON parser and never returns an empty reply.
    if (structured && request.response_format && isUnsupportedResponseFormat(error)) {
      delete request.response_format;
      return client.chat.completions.create(request);
    }
    throw error;
  }
}

function isUnsupportedResponseFormat(error) {
  const text = `${error?.message || ''} ${error?.error?.message || ''}`.toLowerCase();
  return error?.status === 400 && /response.?format|json.?object|not support|unsupported/.test(text);
}
