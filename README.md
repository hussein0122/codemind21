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


## الحسابات وSupabase ولوحة الأدمن

- نفّذ ملف `supabase/schema.sql` من Supabase SQL Editor.
- أضف متغيرات البيئة في Vercel Project Settings → Environment Variables:
  - `DATABASE_URL`: اتصال PostgreSQL من Supabase (استخدم connection string المناسب لـ Vercel).
  - `DB_SSL=true`
  - `AUTH_SECRET`: قيمة عشوائية طويلة وفريدة، لا تقل عن 32 بايت.
  - `ADMIN_EMAIL=husseinsead3@gmail.com`
  - `ADMIN_PASSWORD`: كلمة مرور قوية لا تقل عن 12 حرفًا، تضبطها أنت داخل Vercel.
- عند تشغيل الخادم، ينشئ النظام حساب الأدمن المحدد إذا لم يكن موجودًا، أو يرفع دوره إلى admin. لا يُكتب السر إلى GitHub.
- الحسابات تستخدم كلمة مرور مشتقة بـ scrypt وجلسة HttpOnly موقعة. إعدادات AI محمية بدور admin وتُحفظ في جدول `ai_settings`.
- مسارات الحساب: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- مسارات إعدادات الأدمن: `GET/PUT /api/admin/ai-settings`.
- الواجهة تضيف الدخول/إنشاء الحساب من عنصر الحساب الشخصي، ولوحة إعدادات النموذج من عنصر الإعدادات دون إعادة تصميم الصفحة.
- بعد إضافة المتغيرات، أعد نشر Vercel. لا ترسل `DATABASE_URL` أو `AUTH_SECRET` أو كلمة مرور الأدمن في المحادثة أو تضعها في المستودع.
