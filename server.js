import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAiConfigured, createCompletion } from './services/ai.service.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const MAX_PROJECT_FILES = 60;
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '4mb' }));

app.use('/api', rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX || 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'طلبات كثيرة. حاول مرة أخرى بعد قليل.'
  }
}));

function buildSafeHistory(history = []) {
  if (!Array.isArray(history)) return [];
  const safe = [];
  let total = 0;

  for (let i = history.length - 1; i >= 0 && safe.length < 30; i -= 1) {
    const item = history[i];
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') {
      continue;
    }

    const content = item.content.trim().slice(0, 12000);
    if (!content) continue;
    if (total + content.length > 24000 && safe.length >= 4) break;

    safe.push({ role: item.role, content });
    total += content.length;
  }

  return safe.reverse();
}

function looksLikeProjectRequest(message) {
  const text = String(message || '').toLowerCase();
  const keywords = [
    'برمجلي موقع', 'برمج لي موقع', 'اعمللي موقع', 'اعمل لي موقع',
    'برمجلي تطبيق', 'برمج لي تطبيق', 'اعمللي تطبيق', 'اعمل لي تطبيق',
    'برمجلي مشروع', 'برمج لي مشروع', 'اعمللي مشروع', 'اعمل لي مشروع',
    'ابني موقع', 'ابني تطبيق', 'ابني مشروع', 'مشروع كامل', 'ملفات المشروع',
    'build a website', 'build an app', 'build a project',
    'create a website', 'create an app', 'create a project',
    'full project', 'complete project', 'ecommerce website', 'store website'
  ];

  return keywords.some((keyword) => text.includes(keyword));
}

function sanitizeProjectName(value) {
  return String(value || 'codemind-project').replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g, '').trim().slice(0, 80) || 'codemind-project';
}

function sanitizeProjectPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function normalizeProject(projectInput) {
  if (!projectInput || typeof projectInput !== 'object') return null;

  const filesSource = Array.isArray(projectInput.files) ? projectInput.files : [];
  const files = filesSource
    .slice(0, MAX_PROJECT_FILES)
    .filter((file) => file && typeof file === 'object' && typeof file.content === 'string' && typeof file.path === 'string')
    .map((file) => ({
      path: sanitizeProjectPath(file.path),
      content: String(file.content)
    }))
    .filter((file) => file.path);

  if (!files.length) return null;

  const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);
  if (totalBytes > MAX_PROJECT_BYTES) return null;

  return {
    name: sanitizeProjectName(projectInput.name || 'codemind-project'),
    description: typeof projectInput.description === 'string' ? projectInput.description.slice(0, 1000) : '',
    files
  };
}

function stripCodeFences(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/^```(?:json|javascript|js|typescript|ts|html|css|markdown)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function findJsonCandidate(text) {
  if (typeof text !== 'string') return [];

  const cleaned = stripCodeFences(text);
  const candidates = new Set();

  candidates.add(cleaned);

  const startTag = cleaned.indexOf('<PROJECT>');
  const endTag = cleaned.lastIndexOf('</PROJECT>');
  if (startTag !== -1 && endTag !== -1 && endTag > startTag) {
    candidates.add(cleaned.slice(startTag + 9, endTag));
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.add(cleaned.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    candidates.add(cleaned.slice(firstBracket, lastBracket + 1));
  }

  return [...candidates].filter(Boolean).map((candidate) => candidate.replace(/,\s*([}\]])/g, '$1'));
}

function parseProjectFromText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return { reply: '', project: null };

  for (const candidate of findJsonCandidate(rawText)) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed === 'object') {
        if (parsed.project && typeof parsed.project === 'object') {
          const normalized = normalizeProject(parsed.project);
          if (normalized) {
            return {
              reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'تم إنشاء المشروع بنجاح.',
              project: normalized
            };
          }
        }

        if (Array.isArray(parsed.files) || parsed.name || parsed.description) {
          const normalized = normalizeProject(parsed);
          if (normalized) {
            return {
              reply: 'تم إنشاء المشروع بنجاح.',
              project: normalized
            };
          }
        }
      }
    } catch (error) {
      // try next candidate
    }
  }

  const tagMatch = rawText.match(/<PROJECT>\s*([\s\S]*?)\s*<\/PROJECT>/i);
  if (tagMatch) {
    try {
      const parsed = JSON.parse(stripCodeFences(tagMatch[1]));
      const normalized = normalizeProject(parsed);
      if (normalized) {
        return {
          reply: 'تم إنشاء المشروع بنجاح.',
          project: normalized
        };
      }
    } catch (error) {
      console.error('Project parse failed from PROJECT tag:', error);
    }
  }

  return { reply: rawText.trim(), project: null };
}

function buildProjectPrompt(message) {
  return `
أنت CodeMind AI Project Builder.
الرد يجب أن يكون JSON فقط، لا Markdown، لا نص إضافي، لا <PROJECT>.
النسق المطلوب:
{
  "reply": "تم إنشاء المشروع بنجاح.",
  "project": {
    "name": "project-name",
    "description": "وصف مختصر",
    "files": [{ "path": "index.html", "content": "..." }]
  }
}

مطلوب:
- استخدم project.files مع ملفّات فعليّة كاملة.
- لا تستخدم مسارات تبدأ بـ / أو ../.
- استخدم أسماء ملفات آمنة وحقيقية.
- لا تضع أسرار أو API keys.
- إذا كان المشروع يتطلب متغيرات بيئة، أضف .env.example.
- اجعل المشروع مناسبًا لطلب المستخدم: ${message}
- لا تكتب محتوى المشروع داخل reply فقط.
- استخدم JSON صالٍ فقط.
`;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ai: isAiConfigured(),
    database: 'disabled',
    memory: 'conversation_context',
    projects: 'enabled',
    zip: 'browser_jszip'
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, mode = 'code', history = [], project: currentProject = null } = req.body || {};

    if (!isAiConfigured()) {
      return res.status(503).json({
        error: 'ai_not_configured',
        message: 'GROQ_API_KEY غير موجود في إعدادات Vercel.'
      });
    }

    if (typeof message !== 'string' || !message.trim() || message.length > 20000) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'أرسل رسالة صحيحة.'
      });
    }

    const projectRequest = looksLikeProjectRequest(message) || Boolean(currentProject);
    const messages = buildSafeHistory(history);

    if (projectRequest) {
      messages.push({ role: 'user', content: buildProjectPrompt(message.trim()) });
    } else {
      messages.push({ role: 'user', content: message.trim() });
    }

    const completion = await createCompletion({
      messages,
      mode,
      structured: projectRequest
    });

    const rawReply = completion?.choices?.[0]?.message?.content || '';

    if (!rawReply.trim()) {
      return res.json({
        reply: projectRequest ? 'تم إنشاء المشروع بنجاح.' : 'تم الاستلام.',
        project: projectRequest ? (currentProject || null) : null
      });
    }

    if (!projectRequest) {
      return res.json({ reply: rawReply.trim(), project: null });
    }

    const parsed = parseProjectFromText(rawReply);

    if (parsed.project) {
      return res.json({
        reply: parsed.reply || 'تم إنشاء المشروع بنجاح.',
        project: parsed.project
      });
    }

    return res.json({
      reply: parsed.reply && parsed.reply.trim() ? parsed.reply.trim() : 'تم إنشاء الكود، لكن تعذر تجهيز ملف ZIP تلقائيًا.',
      project: null
    });
  } catch (error) {
    console.error('AI request failed:', error);
    const isAuthError = error?.status === 401 || error?.code === 'invalid_api_key';
    return res.status(502).json({
      error: isAuthError ? 'invalid_groq_key' : 'ai_request_failed',
      message: isAuthError ? 'مفتاح Groq غير صالح أو منتهي.' : 'تعذر الحصول على رد من الذكاء الاصطناعي.',
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: 'internal_error', message: 'حدث خطأ داخلي.' });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`CodeMind AI backend running on http://localhost:${port}`);
  });
}

export default app;
