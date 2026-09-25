import pg from 'pg';

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000
}) : null;

export async function initializeConversations() {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(180) NOT NULL DEFAULT 'محادثة جديدة', mode VARCHAR(40) NOT NULL DEFAULT 'code',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages(conversation_id, id);
  `);
  return true;
}
function validId(id) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || '')); }
export async function listConversations(userId) {
  const { rows } = await pool.query('SELECT id,title,mode,created_at,updated_at FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100',[userId]);
  return rows;
}
export async function createConversation(userId, title='محادثة جديدة', mode='code') {
  const { rows } = await pool.query('INSERT INTO conversations (user_id,title,mode) VALUES ($1,$2,$3) RETURNING id,title,mode,created_at,updated_at',[userId,String(title||'محادثة جديدة').trim().slice(0,180)||'محادثة جديدة',String(mode||'code').slice(0,40)]);
  return rows[0];
}
export async function getConversation(userId, id) {
  if (!validId(id)) return null;
  const chat = await pool.query('SELECT id,title,mode,created_at,updated_at FROM conversations WHERE id=$1 AND user_id=$2',[id,userId]);
  if (!chat.rows[0]) return null;
  const messages = await pool.query('SELECT id,role,content,attachments,created_at FROM conversation_messages WHERE conversation_id=$1 ORDER BY id ASC LIMIT 500',[id]);
  return { ...chat.rows[0], messages: messages.rows };
}
export async function addConversationMessage(userId,id,role,content,attachments=[]) {
  if (!validId(id)) return false;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const owns=await client.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
    if (!owns.rows[0]) { await client.query('ROLLBACK'); return false; }
    await client.query('INSERT INTO conversation_messages (conversation_id,role,content,attachments) VALUES ($1,$2,$3,$4::jsonb)',[id,role==='assistant'?'assistant':'user',String(content||'').slice(0,50000),JSON.stringify(Array.isArray(attachments)?attachments.slice(0,10):[])]);
    await client.query('UPDATE conversations SET updated_at=NOW() WHERE id=$1',[id]);
    await client.query('COMMIT'); return true;
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function deleteConversation(userId,id) { if(!validId(id)) return false; const r=await pool.query('DELETE FROM conversations WHERE id=$1 AND user_id=$2',[id,userId]); return r.rowCount>0; }