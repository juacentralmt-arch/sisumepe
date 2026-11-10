-- =====================================================================
--  SISUMEPE — Sessões persistentes de login
--  Idempotente: pode ser executado mais de uma vez no SQL Editor.
--
--  SEGURANÇA: RLS habilitado e sem policies = acesso negado para
--  anon/authenticated. O app usa a chave secreta (sb_secret_...), que
--  ignora RLS — como já acontece com persons, tickets, users, audit.
--  Sem isso, a tabela ficaria legível pela chave pública do projeto:
--  qualquer um leria os tokens de sessão e assumiria a conta da equipe.
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
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS exp timestamptz;

-- Limpeza das sessões expiradas (roda a cada hora no servidor).
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions (exp);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions ("user");

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Limpeza opcional de sessões já expiradas
DELETE FROM sessions WHERE exp IS NOT NULL AND exp < now();

-- Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'sessions'
ORDER BY ordinal_position;
