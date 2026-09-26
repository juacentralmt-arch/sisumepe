-- =====================================================================
--  Migração Infinity: TZPR04 → TZPR + exclusão definitiva da UPR04
--  Rode no SQL Editor do Supabase (idempotente — pode rodar 2x sem efeito).
--  Espelha a migração automática que o servidor já faz no db.json local.
-- =====================================================================

-- 1. Soma os saldos TZPR04 nas linhas TZPR já existentes
--    (evita violar a unique sistema/contrato/material/unidade)
UPDATE estoque t
SET saldo = t.saldo + q.saldo, updatedat = now()
FROM (SELECT unidade, saldo FROM estoque WHERE sistema = 'infinity' AND material = 'TZPR04') q
WHERE t.sistema = 'infinity' AND t.material = 'TZPR' AND t.unidade = q.unidade;

-- 2. Converte as TZPR04 restantes em TZPR (onde não havia TZPR)
UPDATE estoque
SET material = 'TZPR', updatedat = now()
WHERE sistema = 'infinity' AND material = 'TZPR04';

-- 3. Garante a linha TZPR zerada em toda unidade do Infinity
INSERT INTO estoque (sistema, contrato, material, unidade, saldo)
SELECT 'infinity', 'INF', 'TZPR', u.unidade, 0
FROM (SELECT DISTINCT unidade FROM estoque WHERE sistema = 'infinity') u
WHERE NOT EXISTS (
  SELECT 1 FROM estoque e
  WHERE e.sistema = 'infinity' AND e.contrato = 'INF'
    AND e.material = 'TZPR' AND e.unidade = u.unidade
);

-- 4. Histórico: renomeia TZPR04 → TZPR no Infinity
UPDATE estoque_mov
SET material = 'TZPR'
WHERE sistema = 'infinity' AND material = 'TZPR04';

-- 5. UPR04 no Infinity: EXCLUSÃO DEFINITIVA (estoque + histórico + seriais 471)
DELETE FROM estoque WHERE sistema = 'infinity' AND material = 'UPR04';
DELETE FROM estoque_mov WHERE sistema = 'infinity' AND material = 'UPR04';
DELETE FROM estoque_serial WHERE sistema = 'infinity' AND serial LIKE '471%';

-- 6. Verificação (esperado: só TZPR/FONTE04/CINTA/TRAVAS; 0 seriais 471)
SELECT material, COUNT(*) AS linhas, SUM(saldo) AS saldo_total
FROM estoque WHERE sistema = 'infinity' GROUP BY material ORDER BY material;
SELECT COUNT(*) AS seriais_471_restantes
FROM estoque_serial WHERE sistema = 'infinity' AND serial LIKE '471%';
SELECT material, COUNT(*) AS movs
FROM estoque_mov WHERE sistema = 'infinity' GROUP BY material ORDER BY material;
