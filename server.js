import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isAiConfigured,
  createCompletion
} from './services/ai.service.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const MAX_FILES = 60;
const MAX_PROJECT_SIZE = 5 * 1024 * 1024;

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '4mb' }));
app.use('/api', rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX || 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'طلبات كثيرة. حاول مرة أخرى بعد قليل.' }
}));

function buildSafeHistory(history, project) {
  const messages = Array.isArray(history) ? history : [];
  const safe = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && safe.length < 30; i -= 1) {
    const item = messages[i];
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') continue;
    const content = item.content.trim().slice(0, 12000);
    if (!content || total + content.length > 24000) continue;
    safe.push({ role: item.role, content });
    total += content.length;
  }
  if (project) {
    const manifest = normalizeProject(project);
    if (manifest) safe.push({ role: 'assistant', content: `Current project manifest:\n${JSON.stringify(manifest)}` });
  }
  return safe.reverse();
}

function looksLikeProjectRequest(message, project) {
  if (project) return true;
  const text = message.toLowerCase();
  return [
    'اعمللي موقع', 'اعمل لي موقع', 'برمجلي موقع', 'برمج لي موقع',
    'اعمللي تطبيق', 'اعمل لي تطبيق', 'اعمل مشروع', 'ابني موقع',
    'ابني تطبيق', 'ابني مشروع', 'مشروع كامل', 'ملفات المشروع',
    'build a website', 'build an app', 'build a project',
    'create a website', 'create an app', 'create a project',
    'full project', 'complete project'
  ].some((keyword) => text.includes(keyword));
}

function projectPrompt(message, previousProject) {
  return `You are CodeMind AI Project Builder. Return ONLY valid JSON, never Markdown and never <PROJECT> tags.
Schema: {"name":"kebab-case-name","description":"short description","files":[{"path":"relative/path","content":"complete text"}]}
Request: ${message}
${previousProject ? `Existing project to modify (preserve every unrelated file): ${JSON.stringify(previousProject)}` : 'Create a complete, runnable project.'}
Rules: use relative safe paths; include package.json when needed; include .env.example for environment variables; never include real secrets; keep files complete; maximum ${MAX_FILES} files and ${MAX_PROJECT_SIZE} bytes total.`;
}

function sanitizePath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
}
function sanitizeName(value) {
  return String(value || 'codemind-project').replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g, '').trim().slice(0, 80) || 'codemind-project';
}
function normalizeProject(value) {
  if (!value || !Array.isArray(value.files)) return null;
  const files = value.files.slice(0, MAX_FILES).filter((file) => file && typeof file.content === 'string').map((file) => ({ path: sanitizePath(file.path), content: file.content })).filter((file) => file.path);
  const size = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);
  if (!files.length || size > MAX_PROJECT_SIZE) return null;
  return { name: sanitizeName(value.name), description: typeof value.description === 'string' ? value.description.slice(0, 1000) : '', files };
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const project = normalizeProject(JSON.parse(candidate));
      if (project) return project;
    } catch {
      // Try the next safe candidate.
    }
  }
  return null;
}

app.get('/health', (req, res) => res.json({ ok: true, ai: isAiConfigured(), database: 'disabled', memory: 'conversation_context', projects: 'enabled', zip: 'frontend_jszip_or_stream' }));

app.post('/api/chat', async (req, res) => {
  const { message, mode = 'code', history = [], project: currentProject = null } = req.body || {};
  if (!isAiConfigured()) return res.status(503).json({ error: 'ai_not_configured', message: 'GROQ_API_KEY غير موجود في إعدادات Vercel.' });
  if (typeof message !== 'string' || !message.trim() || message.length > 20000) return res.status(400).json({ error: 'invalid_request', message: 'أرسل رسالة صحيحة.' });

  const projectRequest = looksLikeProjectRequest(message, currentProject);
  const messages = buildSafeHistory(history, currentProject);
  messages.push({ role: 'user', content: projectRequest ? projectPrompt(message.trim(), normalizeProject(currentProject)) : message.trim() });

  try {
    const completion = await createCompletion({ messages, mode, structured: projectRequest });
    const raw = completion?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) {
      return res.json({ reply: 'تعذر الحصول على محتوى من النموذج. حاول مرة أخرى.', project: null });
    }
    if (!projectRequest) return res.json({ reply: raw.trim(), project: null });

    const project = extractJson(raw);
    if (!project) return res.json({ reply: 'تم إنشاء الكود، لكن تعذر تجهيز ملف ZIP تلقائيًا.', project: null });
    return res.json({ reply: 'تم إنشاء المشروع بنجاح.', project });
  } catch (error) {
    console.error('AI request failed:', error);
    const authError = error.status === 401 || error.code === 'invalid_api_key';
    return res.status(502).json({ error: authError ? 'invalid_groq_key' : 'ai_request_failed', message: authError ? 'مفتاح Groq غير صالح أو منتهي.' : 'تعذر الحصول على رد من الذكاء الاصطناعي.', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: 'internal_error', message: 'حدث خطأ داخلي.' });
});

if (!process.env.VERCEL) app.listen(port, () => console.log(`CodeMind AI backend running on http://localhost:${port}`));
export default app;
