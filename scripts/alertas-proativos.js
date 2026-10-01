const store = require('../store');
const shared = require('../src/lib/shared');

async function verificarAlertasProativos() {
  try {
    const alertas = await store.estoque.alertas({});
    
    if (!alertas || alertas.length === 0) {
      console.log('[alertas-proativos] Nenhum alerta encontrado');
      return [];
    }
    
    const notificacoes = alertas.map(alerta => ({
      type: 'alerta_estoque',
      data: {
        material: alerta.material,
        unidade: alerta.unidade,
        contrato: alerta.contrato,
        saldo: alerta.saldo,
        limite: alerta.limite,
        message: `⚠️ ${alerta.material} em ${alerta.unidade} (${alerta.contrato}) está baixo: ${alerta.saldo} unidades`
      }
    }));
    
    // Notificar usuários online via SSE
    for (const notif of notificacoes) {
      shared.broadcast(notif);
    }
    
    console.log(`[alertas-proativos] ${notificacoes.length} alertas enviados via SSE`);
    return notificacoes;
  } catch (e) {
    console.error('[alertas-proativos] Erro:', e.message);
    return [];
  }
}

module.exports = { verificarAlertasProativos };
