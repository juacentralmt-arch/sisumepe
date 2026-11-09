-- =====================================================================
--  SISUMEPE - Migração do módulo Assistidos (reescrita completa)
--  Execute este script no SQL Editor do Supabase
-- =====================================================================

-- 1. Tabela assistidos (colunas atuais + novas)
CREATE TABLE IF NOT EXISTS assistidos (
  id serial primary key,
  vinculo text default '',
  nome text default '',
  processo text default '',
  vara text default '',
  cpf text default '',
  telefone text default '',
  endereco text default '',
  situacao_juridica text default '',
  local_assinatura text default '',
  data_inicio text default '',
  data_fim text default '',
  frequencia text default 'mensal',
  etiqueta text default '',
  etiqueta_cor text default '#4f46e5',
  etiqueta_texto text default '',
  status text default 'ativo',
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

-- Garantir colunas em tabelas já existentes (idempotente)
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS cpf text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS telefone text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS endereco text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS situacao_juridica text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS local_assinatura text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS data_inicio text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS data_fim text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS frequencia text default 'mensal';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS etiqueta text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS etiqueta_cor text default '#4f46e5';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS etiqueta_texto text default '';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS status text default 'ativo';
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS deleted_at timestamptz default null;
ALTER TABLE assistidos ADD COLUMN IF NOT EXISTS updatedat timestamptz default now();

-- Remover colunas legadas que não fazem mais parte do modelo (opcional, seguro)
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS statusgrupo;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS sitjuridico;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS inicio;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS numero;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS juntadas;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS extras;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS carga_horaria;
-- ALTER TABLE assistidos DROP COLUMN IF EXISTS tipo_medida;

-- 2. Tabela assistidos_comparecimentos
CREATE TABLE IF NOT EXISTS assistidos_comparecimentos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  data_comparecimento text default '',
  policial_plantao text default '',
  assinado_por text default '',
  juntada text default '',
  protocolado boolean default false,
  data_protocolacao text default '',
  protocolado_por text default '',
  observacoes text default '',
  createdat timestamptz default now()
);

ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS assistido_id integer references assistidos(id) on delete cascade;
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS data_comparecimento text default '';
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS policial_plantao text default '';
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS assinado_por text default '';
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS juntada text default '';
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS protocolado boolean default false;
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS data_protocolacao text default '';
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS protocolado_por text default '';
ALTER TABLE assistidos_comparecimentos ADD COLUMN IF NOT EXISTS observacoes text default '';

-- 3. Tabela assistidos_alertas
CREATE TABLE IF NOT EXISTS assistidos_alertas (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  tipo text default '',
  descricao text default '',
  data_alerta text default '',
  data_resolucao text default '',
  resolvido boolean default false,
  createdat timestamptz default now()
);

-- 4. Tabela assistidos_eventos
CREATE TABLE IF NOT EXISTS assistidos_eventos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  tipo text default '',
  descricao text default '',
  origem text default '',
  usuario text default '',
  createdat timestamptz default now()
);

-- 5. Índices para performance
CREATE INDEX IF NOT EXISTS idx_assistidos_vinculo ON assistidos(vinculo);
CREATE INDEX IF NOT EXISTS idx_assistidos_nome ON assistidos(nome);
CREATE INDEX IF NOT EXISTS idx_assistidos_processo ON assistidos(processo);
CREATE INDEX IF NOT EXISTS idx_assistidos_local ON assistidos(local_assinatura);
CREATE INDEX IF NOT EXISTS idx_assistidos_status ON assistidos(status);
CREATE INDEX IF NOT EXISTS idx_assistidos_frequencia ON assistidos(frequencia);
CREATE INDEX IF NOT EXISTS idx_assistidos_etiqueta ON assistidos(etiqueta);
CREATE INDEX IF NOT EXISTS idx_assistidos_deleted_at ON assistidos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_assistidos_createdat ON assistidos(createdat);
CREATE INDEX IF NOT EXISTS idx_assistidos_comp_assistido ON assistidos_comparecimentos(assistido_id);
CREATE INDEX IF NOT EXISTS idx_assistidos_comp_juntada ON assistidos_comparecimentos(juntada);
CREATE INDEX IF NOT EXISTS idx_assistidos_alertas_assistido ON assistidos_alertas(assistido_id);
CREATE INDEX IF NOT EXISTS idx_assistidos_eventos_assistido ON assistidos_eventos(assistido_id);

-- 6. Atualizar função reset_sequences para incluir as novas tabelas
CREATE OR REPLACE FUNCTION reset_sequences() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  perform setval(pg_get_serial_sequence('persons', 'id'), coalesce((select max(id) from persons), 0) + 1, false);
  perform setval(pg_get_serial_sequence('tickets', 'id'), coalesce((select max(id) from tickets), 0) + 1, false);
  perform setval(pg_get_serial_sequence('chat', 'id'), coalesce((select max(id) from chat), 0) + 1, false);
  perform setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 0) + 1, false);
  perform setval(pg_get_serial_sequence('agenda', 'id'), coalesce((select max(id) from agenda), 0) + 1, false);
  perform setval(pg_get_serial_sequence('termos', 'id'), coalesce((select max(id) from termos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos', 'id'), coalesce((select max(id) from assistidos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos_comparecimentos', 'id'), coalesce((select max(id) from assistidos_comparecimentos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos_alertas', 'id'), coalesce((select max(id) from assistidos_alertas), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos_eventos', 'id'), coalesce((select max(id) from assistidos_eventos), 0) + 1, false);
END $$;

-- 7. Verificação
SELECT 'Tabelas do módulo Assistidos criadas/atualizadas com sucesso!' as status;
