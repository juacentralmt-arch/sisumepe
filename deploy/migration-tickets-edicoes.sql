-- Histórico de edições no ticket (quem alterou + o que foi alterado).
-- Rode UMA VEZ no Supabase (SQL Editor). Sem esta coluna, as edições
-- funcionam mas o histórico some ao recarregar (fallback em memória).
alter table tickets
  add column if not exists edicoes jsonb not null default '[]'::jsonb;
