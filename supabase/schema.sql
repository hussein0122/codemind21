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
