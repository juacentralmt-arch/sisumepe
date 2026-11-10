-- =====================================================================
-- SISUMEPE — Módulo Assistidos (monitorados com tornozeleira eletrônica)
-- 3 abas: Todos | Juntada | Concluídos
-- Rode no SQL Editor do Supabase. Idempotente.
--
-- IMPORTANTE
--   * `vinculo` NÃO tem unique de tabela: o índice parcial da linha final
--     já garante unicidade só entre registros vivos (soft-delete). Uma
--     constraint `unique` de tabela bloquearia recadastrar um vínculo
--     arquivado — que a aplicação permite.
--   * Colunas sem `not null`: a base herdada da Planilha Geral tem
--     registros com processo/data vazios, e eles precisam continuar
--     editáveis (o PATCH é parcial e só valida o que o usuário altera).
-- =====================================================================

create table if not exists assistidos (
  id serial primary key,
  vinculo text default '',
  nome text default '',
  processo text default '',
  vara text default '',
  local_assinatura text default '',
  data_inicio text default '',
  data_fim text default '',
  frequencia text default 'mensal',
  cpf text default '',
  telefone text default '',
  endereco text default '',
  situacao_juridica text default '',
  etiqueta text default 'sem', -- 'verde' | 'laranja' | 'vermelho' | 'sem'
  etiqueta_texto text default '',
  etiqueta_cor text default '',
  responsavel_tecnico text default '',
  status text default 'ativo', -- 'ativo' | 'concluido' | 'arquivado'
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

alter table assistidos add column if not exists vinculo text default '';
alter table assistidos add column if not exists nome text default '';
alter table assistidos add column if not exists processo text default '';
alter table assistidos add column if not exists vara text default '';
alter table assistidos add column if not exists local_assinatura text default '';
alter table assistidos add column if not exists data_inicio text default '';
alter table assistidos add column if not exists data_fim text default '';
alter table assistidos add column if not exists frequencia text default 'mensal';
alter table assistidos add column if not exists cpf text default '';
alter table assistidos add column if not exists telefone text default '';
alter table assistidos add column if not exists endereco text default '';
alter table assistidos add column if not exists situacao_juridica text default '';
alter table assistidos add column if not exists etiqueta text default 'sem';
alter table assistidos add column if not exists etiqueta_texto text default '';
alter table assistidos add column if not exists etiqueta_cor text default '';
alter table assistidos add column if not exists responsavel_tecnico text default '';
alter table assistidos add column if not exists status text default 'ativo';
alter table assistidos add column if not exists deleted_at timestamptz default null;
alter table assistidos add column if not exists createdat timestamptz default now();
alter table assistidos add column if not exists updatedat timestamptz default now();

-- Remove a constraint de unicidade de tabela, se existir (bases criadas
-- pela versão antiga da migration). A unicidade passa a ser só do índice
-- parcial abaixo — soft-delete libera o vínculo.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'assistidos'::regclass and contype = 'u'
  loop
    execute format('alter table assistidos drop constraint %I', c.conname);
  end loop;
end $$;

alter table assistidos alter column status set default 'ativo';

create index if not exists idx_assistidos_vinculo on assistidos (vinculo);
create index if not exists idx_assistidos_nome on assistidos (nome);
create index if not exists idx_assistidos_processo on assistidos (processo);
create index if not exists idx_assistidos_status on assistidos (status);
create index if not exists idx_assistidos_etiqueta on assistidos (etiqueta);
create index if not exists idx_assistidos_deleted on assistidos (deleted_at);
-- unicidade apenas entre assistidos vivos (soft-delete libera o vínculo)
create unique index if not exists idx_assistidos_vinculo_unique on assistidos (vinculo) where deleted_at is null;

-- =====================================================================
-- Tabela assistidos_comparecimentos
-- =====================================================================
create table if not exists assistidos_comparecimentos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  data_comparecimento text default '',
  policial_plantao text default '',
  protocolado boolean default false,
  data_protocolacao text default '',
  protocolado_por text default '',
  observacoes text default '',
  juntada text default '',
  assinado_por text default '',
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

alter table assistidos_comparecimentos add column if not exists assistido_id integer references assistidos(id) on delete cascade;
alter table assistidos_comparecimentos add column if not exists data_comparecimento text default '';
alter table assistidos_comparecimentos add column if not exists policial_plantao text default '';
alter table assistidos_comparecimentos add column if not exists protocolado boolean default false;
alter table assistidos_comparecimentos add column if not exists data_protocolacao text default '';
alter table assistidos_comparecimentos add column if not exists protocolado_por text default '';
alter table assistidos_comparecimentos add column if not exists observacoes text default '';
alter table assistidos_comparecimentos add column if not exists juntada text default '';
alter table assistidos_comparecimentos add column if not exists assinado_por text default '';
alter table assistidos_comparecimentos add column if not exists deleted_at timestamptz default null;
alter table assistidos_comparecimentos add column if not exists createdat timestamptz default now();
alter table assistidos_comparecimentos add column if not exists updatedat timestamptz default now();

create index if not exists idx_assistidos_comp_assistido on assistidos_comparecimentos (assistido_id);
create index if not exists idx_assistidos_comp_data on assistidos_comparecimentos (data_comparecimento);
create index if not exists idx_assistidos_comp_deleted on assistidos_comparecimentos (deleted_at);
create index if not exists idx_assistidos_comp_pend on assistidos_comparecimentos (protocolado);

-- SEGURANÇA: RLS habilitado e sem policies = acesso negado para
-- anon/authenticated. O app usa a chave secreta (sb_secret_...), que
-- ignora RLS — como já acontece com persons, tickets, users, audit.
-- Sem isto, estas tabelas ficam legíveis e graváveis pela chave pública
-- do projeto, burlando a API (e a trilha de auditoria).
alter table assistidos enable row level security;
alter table assistidos_comparecimentos enable row level security;

-- =====================================================================
-- Correção de dados
-- =====================================================================
-- A Planilha Geral importada gravou o número da juntada sem ligar a flag
-- `protocolado`. Sem isto, a aba "Juntada" tratava comparecimentos já
-- protocolados como pendentes. Só mexe em quem TEM juntada registrada.
update assistidos_comparecimentos
   set protocolado = true
 where deleted_at is null
   and coalesce(juntada, '') <> ''
   and coalesce(protocolado, false) = false;

-- Status vazio (base antiga sem default) passa a ser 'ativo'.
update assistidos
   set status = 'ativo'
 where coalesce(status, '') = ''
   and deleted_at is null;

-- =====================================================================
-- Função de reajuste de sequencias
-- =====================================================================
create or replace function reset_sequences() returns void language plpgsql as $$
begin
  perform setval(pg_get_serial_sequence('persons', 'id'), coalesce((select max(id) from persons), 0) + 1, false);
  perform setval(pg_get_serial_sequence('tickets', 'id'), coalesce((select max(id) from tickets), 0) + 1, false);
  perform setval(pg_get_serial_sequence('chat', 'id'), coalesce((select max(id) from chat), 0) + 1, false);
  perform setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 0) + 1, false);
  perform setval(pg_get_serial_sequence('agenda', 'id'), coalesce((select max(id) from agenda), 0) + 1, false);
  perform setval(pg_get_serial_sequence('termos', 'id'), coalesce((select max(id) from termos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos', 'id'), coalesce((select max(id) from assistidos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos_comparecimentos', 'id'), coalesce((select max(id) from assistidos_comparecimentos), 0) + 1, false);
end $$;

-- Recarrega o cache do PostgREST para enxergar as colunas novas imediatamente.
notify pgrst, 'reload schema';
