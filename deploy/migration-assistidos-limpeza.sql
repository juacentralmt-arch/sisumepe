-- =====================================================================
--  SISUMEPE — Limpeza do schema de assistidos
--
--  As colunas abaixo vinham de um schema anterior do modulo (antes da
--  reescrita) e NAO sao usadas por nenhum codigo — nenhuma referencia
--  no store, nas rotas ou no frontend. As 9 colunas de texto estavam
--  100% vazias na base (verificado em 1.154 registros).
--
--  A coluna `extras` (jsonb) FOI mantida de proposito: a importacao da
--  Planilha Geral guarda ali as colunas que o modulo nao reconhece, em
--  vez de descartar o dado.
--
--  Idempotente: pode ser executado mais de uma vez.
-- =====================================================================

-- Colunas legadas sem uso (drop se existirem).
alter table assistidos drop column if exists statusgrupo;
alter table assistidos drop column if exists sitjuridico;
alter table assistidos drop column if exists inicio;
alter table assistidos drop column if exists observacao;
alter table assistidos drop column if exists proximajuntada;
alter table assistidos drop column if exists dias;
alter table assistidos drop column if exists alerta;
alter table assistidos drop column if exists numero;
alter table assistidos drop column if exists juntadas;

-- extras e a bolsa para as colunas desconhecidas da planilha.
alter table assistidos add column if not exists extras jsonb default '{}'::jsonb;

-- Normaliza NULL em colunas cujo default e string vazia.
--
-- A aba Juntada filtra os pendentes por `juntada` vazia. Um comparecimento
-- gravado com juntada = NULL nao casa com esse filtro e some da aba — o
-- monitorado comparecia mas o registro nao aparecia para protocolar.
-- Daqui em diante toda escrita usa string vazia; isto alinha o que ja
-- foi gravado.
update assistidos_comparecimentos set juntada = '' where juntada is null;
update assistidos_comparecimentos set observacoes = '' where observacoes is null;
update assistidos_comparecimentos set protocolado = false where protocolado is null;
update assistidos_comparecimentos set policial_plantao = '' where policial_plantao is null;
update assistidos_comparecimentos set data_protocolacao = '' where data_protocolacao is null;
update assistidos_comparecimentos set protocolado_por = '' where protocolado_por is null;
update assistidos_comparecimentos set assinado_por = '' where assinado_por is null;

-- Indice para a busca por nome/vinculo/processo.
-- A busca usa ilike com %termo%, que nao aproveita btree: o trigram
-- resolve. Precisa da extensao pg_trgm.
create extension if not exists pg_trgm;
create index if not exists idx_assistidos_nome_trgm on assistidos using gin (nome gin_trgm_ops);
create index if not exists idx_assistidos_vinculo_trgm on assistidos using gin (vinculo gin_trgm_ops);
create index if not exists idx_assistidos_processo_trgm on assistidos using gin (processo gin_trgm_ops);

-- Verificacao
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assistidos'
order by ordinal_position;
