import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { isAiConfigured, createCompletion } from './services/ai.service.js';
import { isProjectRequest, buildProjectPrompt, parseProjectResponse } from './services/project-builder.service.js';
import { normalizeProject } from './services/project.service.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

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

function buildSafeHistory(history = []) {
  if (!Array.isArray(history)) return [];
  const safe = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0 && safe.length < 30; i -= 1) {
    const item = history[i];
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') continue;
    const content = item.content.trim().slice(0, 12000);
    if (!content) continue;
    if (total + content.length > 24000 && safe.length >= 4) break;
    safe.push({ role: item.role, content });
    total += content.length;
  }
  return safe.reverse();
}

app.get('/health', (req, res) => res.json({
  ok: true,
  ai: isAiConfigured(),
  database: 'disabled',
  memory: 'conversation_context',
  projects: 'enabled',
  zip: 'browser_jszip'
}));

app.post('/api/chat', async (req, res) => {
  try {
    const { message, mode = 'code', history = [], project: currentProject = null } = req.body || {};
    if (!isAiConfigured()) return res.status(503).json({ error: 'ai_not_configured', message: 'GROQ_API_KEY غير موجود في إعدادات Vercel.' });
    if (typeof message !== 'string' || !message.trim() || message.length > 20000) {
      return res.status(400).json({ error: 'invalid_request', message: 'أرسل رسالة صحيحة.' });
    }

    const existingProject = normalizeProject(currentProject);
    const projectRequest = isProjectRequest(message, existingProject);
    const messages = buildSafeHistory(history);
    messages.push({
      role: 'user',
      content: projectRequest ? buildProjectPrompt(message.trim(), existingProject) : message.trim()
    });

    const completion = await createCompletion({ messages, mode, structured: projectRequest });
    const rawReply = completion?.choices?.[0]?.message?.content || '';
    if (!rawReply.trim()) {
      return res.json({
        reply: projectRequest ? 'تم تحديث المشروع.' : 'تم الاستلام.',
        project: projectRequest ? existingProject : null
      });
    }
    if (!projectRequest) return res.json({ reply: rawReply.trim(), project: null });

    const parsed = parseProjectResponse(rawReply);
    if (parsed.project) return res.json({ reply: parsed.reply || 'تم إنشاء المشروع بنجاح.', project: parsed.project });
    return res.json({ reply: parsed.reply || 'تم إنشاء الكود، لكن تعذر تجهيز Project Manifest.', project: null });
  } catch (error) {
    console.error('AI request failed:', error);
    const auth = error?.status === 401 || error?.code === 'invalid_api_key';
    return res.status(502).json({
      error: auth ? 'invalid_groq_key' : 'ai_request_failed',
      message: auth ? 'مفتاح Groq غير صالح أو منتهي.' : 'حصل خطأ أثناء معالجة الطلب، حاول مرة أخرى.',
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
});

// Inject the workspace scripts without requiring a rewrite of the large legacy HTML file.
app.get('/', async (req, res, next) => {
  try {
    const html = await readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const scripts = '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" integrity="sha512-x2k3eGq6uZ4k8FQWw1X1fQ1h4qN7v2vYw5vJw9cQ7s6R5P9Gk1hL8mM8Y9H8hQ8gG0f3k2W7r5c4x5n6G7f8A==" crossorigin="anonymous" referrerpolicy="no-referrer"></script><script src="/project-workspace.js"></script>';
    res.type('html').send(html.replace('</body>', `${scripts}</body>`));
  } catch (error) {
    next(error);
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
