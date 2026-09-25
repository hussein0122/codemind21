import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

const COOKIE_NAME = 'codemind_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const secret = () => process.env.AUTH_SECRET || '';

export function authDatabaseReady() { return Boolean(pool); }
export async function initializeAuth() {
  if (!pool) return false;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT;
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      model VARCHAR(160) NOT NULL DEFAULT 'openai/gpt-oss-20b',
      max_tokens INTEGER NOT NULL DEFAULT 2400 CHECK (max_tokens BETWEEN 512 AND 8000),
      temperature NUMERIC(3,2) NOT NULL DEFAULT 0.30 CHECK (temperature BETWEEN 0 AND 2),
      concise BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [adminEmail]);
    if (!existing.rowCount) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = await hashPassword(adminPassword, salt);
      await pool.query(
        "INSERT INTO users (name,email,password_hash,password_salt,role) VALUES ($1,$2,$3,$4,'admin')",
        ['CodeMind Admin', adminEmail, hash, salt]
      );
    } else {
      await pool.query("UPDATE users SET role = 'admin' WHERE lower(email) = $1", [adminEmail]);
    }
  }
  return true;
}
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key.toString('hex'))));
}
async function verifyPassword(password, salt, stored) {
  if (!salt || !stored) return false;
  const actual = Buffer.from(await hashPassword(password, salt), 'hex');
  const expected = Buffer.from(stored, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now()/1000) + SESSION_SECONDS })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readToken(token) {
  if (!secret() || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.exp || data.exp < Date.now()/1000) return null;
    return data;
  } catch { return null; }
}
function setSession(res, user) {
  res.cookie(COOKIE_NAME, makeToken(user), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS * 1000
  });
}
export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}
export async function requireAuth(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'database_not_configured', message: 'قاعدة البيانات غير مفعّلة.' });
  if (!secret()) return res.status(503).json({ error: 'auth_not_configured', message: 'إعداد AUTH_SECRET غير موجود.' });
  const session = readToken(req.cookies?.[COOKIE_NAME]);
  if (!session) return res.status(401).json({ error: 'unauthorized', message: 'سجّل الدخول أولًا.' });
  try {
    const { rows } = await pool.query('SELECT id,name,email,role FROM users WHERE id = $1', [session.id]);
    if (!rows[0]) return res.status(401).json({ error: 'unauthorized', message: 'الحساب غير موجود.' });
    req.user = rows[0];
    next();
  } catch (error) { next(error); }
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'هذه الصفحة للأدمن فقط.' });
  next();
}
export function registerAuthRoutes(app) {
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      if (!pool) return res.status(503).json({ error: 'database_not_configured', message: 'قاعدة البيانات غير مفعّلة.' });
      if (!secret()) return res.status(503).json({ error: 'auth_not_configured', message: 'إعداد AUTH_SECRET غير موجود.' });
      const name = String(req.body?.name || '').trim().slice(0,120);
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200)
        return res.status(400).json({ error: 'invalid_input', message: 'أدخل اسمًا وبريدًا صحيحًا وكلمة مرور من 12 حرفًا على الأقل.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = await hashPassword(password, salt);
      const { rows } = await pool.query(
        "INSERT INTO users (name,email,password_hash,password_salt,role) VALUES ($1,$2,$3,$4,'user') RETURNING id,name,email,role",
        [name,email,hash,salt]
      );
      setSession(res, rows[0]);
      res.status(201).json({ user: rows[0] });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'email_exists', message: 'البريد مسجل بالفعل.' });
      next(error);
    }
  });
  app.post('/api/auth/login', async (req, res, next) => {
    try {
      if (!pool) return res.status(503).json({ error: 'database_not_configured', message: 'قاعدة البيانات غير مفعّلة.' });
      if (!secret()) return res.status(503).json({ error: 'auth_not_configured', message: 'إعداد AUTH_SECRET غير موجود.' });
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const { rows } = await pool.query('SELECT id,name,email,role,password_hash,password_salt FROM users WHERE lower(email) = $1', [email]);
      const user = rows[0];
      if (!user || !(await verifyPassword(password,user.password_salt,user.password_hash)))
        return res.status(401).json({ error: 'invalid_credentials', message: 'البريد أو كلمة المرور غير صحيحة.' });
      setSession(res,user);
      res.json({ user: { id:user.id,name:user.name,email:user.email,role:user.role } });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', (req,res) => { clearSession(res); res.json({ ok:true }); });
  app.get('/api/auth/me', requireAuth, (req,res) => res.json({ user:req.user }));
  app.get('/api/admin/ai-settings', requireAuth, requireAdmin, async (req,res,next) => {
    try { const { rows } = await pool.query('SELECT model,max_tokens,temperature,concise,updated_at FROM ai_settings WHERE id=1'); res.json({ settings:rows[0] }); }
    catch (error) { next(error); }
  });
  app.put('/api/admin/ai-settings', requireAuth, requireAdmin, async (req,res,next) => {
    try {
      const model = String(req.body?.model || '').trim().slice(0,160);
      const maxTokens = Number(req.body?.maxTokens);
      const temperature = Number(req.body?.temperature);
      const concise = req.body?.concise !== false;
      if (!model || !Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > 8000 || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)
        return res.status(400).json({ error:'invalid_settings', message:'راجع قيم إعدادات النموذج.' });
      const { rows } = await pool.query(
        'UPDATE ai_settings SET model=$1,max_tokens=$2,temperature=$3,concise=$4,updated_at=NOW() WHERE id=1 RETURNING model,max_tokens,temperature,concise,updated_at',
        [model,maxTokens,temperature,concise]
      );
      res.json({ settings:rows[0] });
    } catch (error) { next(error); }
  });
}
