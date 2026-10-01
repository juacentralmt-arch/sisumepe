const EstoqueAtualHandler = require('./handlers/EstoqueAtualHandler');
const MediaConsumoHandler = require('./handlers/MediaConsumoHandler');
const ReposicaoSegurancaHandler = require('./handlers/ReposicaoSegurancaHandler');
const ReposicaoHandler = require('./handlers/ReposicaoHandler');
const CompararHandler = require('./handlers/CompararHandler');
const ConsumoHandler = require('./handlers/ConsumoHandler');
const FichaHandler = require('./handlers/FichaHandler');
const ExportHandler = require('./handlers/ExportHandler');
const TendenciaHandler = require('./handlers/TendenciaHandler');
const SerialHandler = require('./handlers/SerialHandler');
const HistoricoHandler = require('./handlers/HistoricoHandler');
const MovsHandler = require('./handlers/MovsHandler');
const SeriaisHandler = require('./handlers/SeriaisHandler');
const RankingHandler = require('./handlers/RankingHandler');
const BaixoHandler = require('./handlers/BaixoHandler');
const UnidadesHandler = require('./handlers/UnidadesHandler');
const SaldoHandler = require('./handlers/SaldoHandler');
const HelpHandler = require('./handlers/HelpHandler');
const PrevisaoRupturaHandler = require('./handlers/PrevisaoRupturaHandler');
const SugestaoCompraHandler = require('./handlers/SugestaoCompraHandler');
const TransferenciaSugeridaHandler = require('./handlers/TransferenciaSugeridaHandler');
const LinguagemNaturalHandler = require('./handlers/LinguagemNaturalHandler');
const HistoricoConversasHandler = require('./handlers/HistoricoConversasHandler');

// Ordem importa: handlers mais específicos primeiro
const handlers = [
  new SerialHandler(),           // serial exato/parcial (mais específico)
  new LinguagemNaturalHandler(), // linguagem natural conversacional
  new HistoricoConversasHandler(), // histórico de consultas
  new HelpHandler(),             // ajuda
  new UnidadesHandler(),         // unidades
  new PrevisaoRupturaHandler(),  // previsão ruptura
  new SugestaoCompraHandler(),   // sugestão compra
  new TransferenciaSugeridaHandler(), // transferência sugerida
  new EstoqueAtualHandler(),     // estoque atual
  new MediaConsumoHandler(),     // média consumo
  new ReposicaoSegurancaHandler(), // necessidade reposição segurança
  new ReposicaoHandler(),        // reposição/compra
  new CompararHandler(),         // comparar
  new ConsumoHandler(),          // consumo/giro/ruptura
  new FichaHandler(),            // ficha/detalhe
  new ExportHandler(),           // export/csv
  new TendenciaHandler(),        // tendência/evolução
  new MovsHandler(),             // movimentações (antes de histórico p/ "hoje/ontem")
  new HistoricoHandler(),        // histórico
  new SeriaisHandler(),          // seriais listagem
  new RankingHandler(),          // ranking
  new BaixoHandler(),            // baixo/alertas
  new SaldoHandler()             // saldo (catch-all por último)
];

module.exports = { handlers };