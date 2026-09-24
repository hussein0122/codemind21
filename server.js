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

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet({ contentSecurityPolicy: false }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true
  })
);

app.use(express.json({ limit: '2mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use(
  '/api',
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    limit: Number(process.env.RATE_LIMIT_MAX || 60),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: 'rate_limited',
      message: 'طلبات كثيرة. حاول مرة أخرى بعد قليل.'
    }
  })
);

/* =========================
   HEALTH
========================= */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ai: isAiConfigured(),
    database: 'disabled'
  });
});

/* =========================
   DIRECT AI CHAT
========================= */

app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      mode = 'code'
    } = req.body || {};

    if (!isAiConfigured()) {
      return res.status(503).json({
        error: 'ai_not_configured',
        message: 'GROQ_API_KEY غير موجود في إعدادات Vercel.'
      });
    }

    if (
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > 20000
    ) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'أرسل رسالة صحيحة.'
      });
    }

    const completion = await createCompletion({
      messages: [
        {
          role: 'user',
          content: message.trim()
        }
      ],
      mode
    });

    const reply =
      completion.choices?.[0]?.message?.content || '';

    return res.json({
      reply
    });

  } catch (error) {
    console.error('AI request failed:', error);

    const isAuthError =
      error.status === 401 ||
      error.code === 'invalid_api_key';

    return res.status(502).json({
      error: isAuthError
        ? 'invalid_groq_key'
        : 'ai_request_failed',

      message: isAuthError
        ? 'مفتاح Groq غير صالح أو منتهي.'
        : 'تعذر الحصول على رد من الذكاء الاصطناعي.',

      details:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined
    });
  }
});

/* =========================
   ERROR HANDLER
========================= */

app.use((error, req, res, next) => {
  console.error('Request failed:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'internal_error',
    message: 'حدث خطأ داخلي.'
  });
});

/* =========================
   LOCAL SERVER
========================= */

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(
      `CodeMind AI backend running on http://localhost:${port}`
    );

    if (!isAiConfigured()) {
      console.warn('GROQ_API_KEY is missing.');
    }
  });
}

export default app;
