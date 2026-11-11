-- =====================================================================
--  SISUMEPE — Etiqueta como marcador de "conferido"
--
--  A etiqueta nasceu (commit 286349c) como marcador binario da
--  conferencia da ficha: verificado | pendente. Nas reescritas virou uma
--  escala de cores (sem|verde|laranja|vermelho) que pintava a borda do
--  card — passou a ler como prioridade, nao como conferencia. E ficou
--  sem uso: 1.148 de 1.148 registros estavam com 'sem'.
--
--  Aqui a escala volta a ser binaria e ganha autoria: quem conferiu e
--  quando. Sem isso o marcador nao serve para responsabilizacao.
--
--  Idempotente: pode ser executado mais de uma vez.
-- =====================================================================

-- Autoria da conferencia
alter table assistidos add column if not exists conferido_por text default '';
alter table assistidos add column if not exists conferido_em timestamptz default null;

-- Normaliza os valores antigos:
--   sem         -> pendente   (nunca conferido)
--   verde       -> conferido  (ja conferido)
--   laranja     -> pendente   (nao ha registro de conferencia)
--   vermelho    -> pendente
update assistidos set etiqueta = 'pendente'
 where etiqueta is null or etiqueta = '' or etiqueta = 'sem'
    or etiqueta = 'laranja' or etiqueta = 'vermelho';
update assistidos set etiqueta = 'conferido' where etiqueta = 'verde';

alter table assistidos alter column etiqueta set default 'pendente';

-- Quem conferiu / filtro por conferencia
create index if not exists idx_assistidos_conferencia on assistidos (etiqueta);
create index if not exists idx_assistidos_responsavel on assistidos (responsavel_tecnico);

-- Verificacao
select etiqueta, count(*) from assistidos where deleted_at is null group by etiqueta order by 2 desc;
