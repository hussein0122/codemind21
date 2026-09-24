# CodeMind AI

Backend لـ CodeMind AI يعمل بمحرك Groq عبر OpenAI-compatible API، مع استجابة JSON مباشرة وقاعدة PostgreSQL اختيارية للتطوير المحلي.

## المتطلبات

- Node.js 18 أو أحدث
- مفتاح Groq محفوظ في متغيرات البيئة فقط
- PostgreSQL للتشغيل الإنتاجي

## التشغيل

```bash
npm install
copy .env.example .env
```

ضع القيم الحقيقية في `.env` محليًا، ثم نفّذ `schema.sql` على قاعدة PostgreSQL:

```bash
psql "$env:DATABASE_URL" -f schema.sql
npm start
```

يمكن تشغيل التطبيق دون `DATABASE_URL` للتطوير فقط؛ عندها يستخدم `data/chats.json` كـ fallback. في الإنتاج يجب استخدام PostgreSQL.

## إعدادات البيئة

- `GROQ_API_KEY`: لا يُرسل إلى المتصفح أبدًا.
- `GROQ_BASE_URL`: افتراضيًا `https://api.groq.com/openai/v1`.
- `GROQ_MODEL`: افتراضيًا `llama-3.3-70b-versatile`.
- `DATABASE_URL`: رابط PostgreSQL.
- `DB_SSL=true`: مطلوب عادةً مع قواعد البيانات المُدارة.
- `RATE_LIMIT_WINDOW_MS` و`RATE_LIMIT_MAX`: حد الطلبات على `/api`.
- `CORS_ORIGIN`: أصل الواجهة المسموح به في الإنتاج.

## المسارات

- `GET /health`: فحص الخادم وAI وقاعدة البيانات.
- `GET /api/chats`: عرض المحادثات.
- `POST /api/chats`: إنشاء محادثة.
- `GET /api/chats/:id`: قراءة محادثة.
- `DELETE /api/chats/:id`: حذف محادثة.
- `POST /api/chat`: إرسال رسالة وإرجاع `{ "reply": "..." }`؛ يدعم `fast`, `reason`, `code`/`codeExpert`, `net`/`networking`, و`sec`/`cybersecurity`.

## البنية

```text
server.js                 Express, security middleware, routes, JSON chat API
services/ai.service.js    Groq client, system prompts, non-streaming completion
lib/db.js                 PostgreSQL adapter مع fallback JSON للتطوير
schema.sql                users, conversations, messages, memories, usage_logs
public/index.html         الواجهة الحالية دون تعديل
.env.example              أسماء إعدادات البيئة فقط
```

## ملاحظات أمنية

- الاستعلامات تستخدم parameterized queries لتقليل خطر SQL Injection.
- الواجهة الحالية تهرب النصوص قبل العرض، والخادم لا يعيد تفاصيل أخطاء مزود AI.
- Helmet وRate Limiting مفعّلان على المسارات.
- لا تضع المفتاح في Git أو داخل `public/`. المفتاح الذي تم نشره في أي محادثة أو سجل يجب إلغاؤه وتدويره فورًا.
