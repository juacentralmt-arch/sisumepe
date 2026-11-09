-- =====================================================================
--  SISUMEPE — Sessões persistentes de login
--  Idempotente: pode ser executado mais de uma vez no SQL Editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS sessions (
  token text primary key,
  "user" text,
  role text,
  name text,
  sistema text,
  mustchangepassword boolean default false,
  exp timestamptz
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sistema text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mustchangepassword boolean default false;

-- Limpeza opcional de sessões já expiradas
DELETE FROM sessions WHERE exp IS NOT NULL AND exp < now();

-- Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'sessions'
ORDER BY ordinal_position;
