-- Adiciona suporte a bloco de notas por material (TZPR04 vs UPR04)
alter table estoque_notas add column if not exists material text not null default 'GERAL';
-- remove constraint antiga e cria nova incluindo material
alter table estoque_notas drop constraint if exists estoque_notas_modulo_sistema_contrato_unidade_key;
alter table estoque_notas add constraint estoque_notas_modulo_sistema_contrato_unidade_material_key
  unique (modulo, sistema, contrato, unidade, material);
create index if not exists idx_estoque_notas_lookup2 on estoque_notas (modulo, sistema, contrato, unidade, material);