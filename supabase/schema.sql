-- Run this in Supabase SQL Editor.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));


-- Persistent CodeMind conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL DEFAULT 'محادثة جديدة',
  mode VARCHAR(40) NOT NULL DEFAULT 'code',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages(conversation_id, id);
