import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getChats,
  getChat,
  createChat,
  saveChat,
  deleteChat,
  checkDatabase,
  logUsage
} from './lib/db.js';
import {
  isAiConfigured,
  createCompletion
} from './services/ai.service.js';

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
   HEALTH CHECK
========================= */

app.get('/health', async (req, res) => {
  try {
    const database = await checkDatabase();

    res.json({
      ok: true,
      ai: isAiConfigured(),
      database: database.driver
    });
  } catch (error) {
    console.error('HEALTH DATABASE ERROR:', error);

    res.status(503).json({
      ok: false,
      error: 'database_error',
      message: error.message || 'Unknown database error',
      code: error.code || null
    });
  }
});

/* =========================
   CHATS
========================= */

app.get('/api/chats', async (req, res, next) => {
  try {
    res.json(await getChats());
  } catch (error) {
    next(error);
  }
});

app.post('/api/chats', async (req, res, next) => {
  try {
    const title =
      typeof req.body?.title === 'string'
        ? req.body.title.trim().slice(0, 200)
        : 'محادثة جديدة';

    res.json(await createChat(title || 'محادثة جديدة'));
  } catch (error) {
    next(error);
  }
});

app.get('/api/chats/:id', async (req, res, next) => {
  try {
    const chat = await getChat(req.params.id);

    if (!chat) {
      return res.status(404).json({
        error: 'not_found'
      });
    }

    res.json(chat);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/chats/:id', async (req, res, next) => {
  try {
    await deleteChat(req.params.id);

    res.json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});

/* =========================
   AI CHAT
========================= */

app.post('/api/chat', async (req, res) => {
  try {
    const {
      chatId,
      message,
      mode = 'code'
    } = req.body || {};

    if (!isAiConfigured()) {
      return res.status(503).json({
        error: 'ai_not_configured',
        message: 'خدمة الذكاء الاصطناعي غير مهيأة على الخادم.'
      });
    }

    if (
      typeof chatId !== 'string' ||
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > 20000
    ) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'أرسل chatId ورسالة صحيحة ضمن الحد المسموح.'
      });
    }

    const chat = await getChat(chatId);

    if (!chat) {
      return res.status(404).json({
        error: 'chat_not_found'
      });
    }

    const cleanMessage = message.trim();

    chat.messages.push({
      role: 'user',
      text: cleanMessage,
      ts: Date.now()
    });

    if (chat.messages.length === 1) {
      chat.title = cleanMessage.slice(0, 28);
    }

    await saveChat(chat);

    const startedAt = Date.now();

    try {
      const messages = chat.messages
        .slice(-12)
        .map(item => ({
          role: item.role === 'ai' ? 'assistant' : 'user',
          content: item.text
        }));

      const completion = await createCompletion({
        messages,
        mode
      });

      const reply =
        completion.choices?.[0]?.message?.content || '';

      const usage = completion.usage || {};

      chat.messages.push({
        role: 'ai',
        text: reply,
        ts: Date.now()
      });

      await saveChat(chat, usage);

      await logUsage({
        model:
          process.env.GROQ_MODEL ||
          'openai/gpt-oss-20b',
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        latencyMs: Date.now() - startedAt
      });

      return res.json({
        reply
      });

    } catch (error) {
      const status = Number(error.status || 0);

      console.error(
        'AI request failed:',
        status || error.message
      );

      const isAuthError =
        error.status === 401 ||
        error.code === 'invalid_api_key';

      const isNotConfigured =
        error.message === 'AI_NOT_CONFIGURED';

      return res.status(
        isNotConfigured ? 503 : 502
      ).json({
        error: isNotConfigured
          ? 'ai_not_configured'
          : isAuthError
            ? 'invalid_groq_key'
            : 'ai_request_failed',

        message: isNotConfigured
          ? 'خدمة الذكاء الاصطناعي غير مهيأة.'
          : isAuthError
            ? 'مفتاح Groq غير صالح أو منتهي. حدّث GROQ_API_KEY في إعدادات Vercel.'
            : 'تعذر إكمال الطلب حاليًا.'
      });
    }

  } catch (error) {
    console.error(
      'Chat request failed:',
      error.message
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: 'internal_error',
        message: 'حدث خطأ داخلي. حاول مرة أخرى.'
      });
    }
  }
});

/* =========================
   GLOBAL ERROR HANDLER
========================= */

app.use((error, req, res, next) => {
  console.error(
    'Request failed:',
    error.message
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'internal_error',
    message: 'حدث خطأ داخلي. حاول مرة أخرى.'
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
      console.warn(
        'GROQ_API_KEY is missing.'
      );
    }
  });
}

export default app;
