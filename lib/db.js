import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '..', 'data', 'chats.json');
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
}) : null;

async function readAll() {
  try { return JSON.parse(await fs.readFile(DB_FILE, 'utf-8')); } catch { return []; }
}
async function writeAll(chats) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(chats, null, 2), 'utf-8');
}
function toChat(row, messages = []) {
  return { id: row.id, title: row.title, messages, createdAt: new Date(row.created_at).getTime() };
}

export async function checkDatabase() {
  if (pool) await pool.query('SELECT 1');
  return { driver: pool ? 'postgres' : 'json' };
}

export async function getChats() {
  if (pool) {
    const { rows } = await pool.query('SELECT id, title, created_at FROM conversations ORDER BY updated_at DESC');
    return rows.map(row => ({ id: row.id, title: row.title, createdAt: new Date(row.created_at).getTime() }));
  }
  return (await readAll()).map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getChat(id) {
  if (pool) {
    const conversation = await pool.query('SELECT id, title, created_at FROM conversations WHERE id = $1', [id]);
    if (!conversation.rowCount) return null;
    const { rows } = await pool.query('SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at', [id]);
    return toChat(conversation.rows[0], rows.map(m => ({ role: m.role === 'assistant' ? 'ai' : m.role, text: m.content, ts: new Date(m.created_at).getTime() })));
  }
  return (await readAll()).find(c => c.id === id) || null;
}

export async function createChat(title) {
  if (pool) {
    const { rows } = await pool.query('INSERT INTO conversations (title) VALUES ($1) RETURNING id, title, created_at', [title]);
    return toChat(rows[0]);
  }
  const chats = await readAll();
  const chat = { id: randomUUID(), title, messages: [], createdAt: Date.now() };
  chats.push(chat); await writeAll(chats); return chat;
}

export async function saveChat(updated, usage = null) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2', [updated.title, updated.id]);
      const last = updated.messages.at(-1);
      if (last) await client.query('INSERT INTO messages (conversation_id, role, content, token_usage) VALUES ($1, $2, $3, $4)', [updated.id, last.role === 'ai' ? 'assistant' : last.role, last.text, usage || {}]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return;
  }
  const chats = await readAll(); const index = chats.findIndex(c => c.id === updated.id);
  if (index >= 0) chats[index] = updated; await writeAll(chats);
}

export async function logUsage({ userId = null, model, inputTokens, outputTokens, latencyMs }) {
  if (pool) await pool.query('INSERT INTO usage_logs (user_id, model, input_tokens, output_tokens, latency_ms) VALUES ($1, $2, $3, $4, $5)', [userId, model, inputTokens, outputTokens, latencyMs]);
}

export async function deleteChat(id) {
  if (pool) { await pool.query('DELETE FROM conversations WHERE id = $1', [id]); return; }
  await writeAll((await readAll()).filter(c => c.id !== id));
}
