-- =====================================================================
--  SISUMEPE — Cadeia de auditoria (hash/prevhash)
--  Idempotente: pode ser executado mais de uma vez no SQL Editor.
-- =====================================================================

ALTER TABLE audit ADD COLUMN IF NOT EXISTS prevhash text;
ALTER TABLE audit ADD COLUMN IF NOT EXISTS hash text;

-- Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'audit'
  AND column_name IN ('prevhash', 'hash')
ORDER BY column_name;
