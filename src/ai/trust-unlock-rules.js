/**
 * Regra da casa para o desbloqueio em confiança — aplicada ANTES de chamar o
 * SGP, que por cima ainda impõe as regras dele (quantidade no mês, máximo de
 * títulos atrasados).
 *
 * A regra do usuário tem duas partes: no máximo uma liberação a cada 30 dias,
 * e uma liberação cuja fatura não foi paga bloqueia as seguintes até pagar.
 * Sem a segunda parte, o cliente ganharia alguns dias de internet grátis todo
 * mês só pedindo e não pagando.
 *
 * O histórico vem da NOSSA tabela (ai_trust_unlocks): o SGP instalado na DW
 * não expõe a listagem de promessas (promessapagamento/list responde 404).
 * O que ele expõe é `promessasPagamentoMes` em consultacliente — o contador
 * do mês corrente, que serve de trava contra liberações feitas por fora
 * (app da Central, atendente no SGP).
 *
 * "Quebrada" é deduzida das faturas: toda fatura que já estava vencida quando
 * a liberação foi feita precisa ter data de pagamento agora.
 *
 * Módulo puro (sem I/O) de propósito: a regra é o que mais importa acertar, e
 * assim ela é testável sem mock nenhum.
 */

const DIAS_ENTRE_LIBERACOES = 30;
const MS_POR_DIA = 86400000;

/**
 * 'YYYY-MM-DD' de um Date ou de 'YYYY-MM-DD HH:mm:ss' — comparável como texto.
 * Para Date usa o calendário LOCAL, não toISOString(): o banco devolve
 * timestamptz como Date, e em São Paulo (UTC-3) uma liberação às 22h viraria
 * o dia seguinte em UTC — e a contagem dos 30 dias sairia errada por um.
 */
function dia(valor) {
  if (valor instanceof Date) {
    const mes = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${valor.getFullYear()}-${mes}-${d}`;
  }
  return String(valor || '').slice(0, 10);
}

function diasDesde(diaISO, hoje) {
  const inicio = new Date(`${diaISO}T00:00:00`);
  const fim = new Date(`${dia(hoje)}T00:00:00`);
  return Math.floor((fim - inicio) / MS_POR_DIA);
}

function faturaEmAberto(f) {
  if (f.dataPagamento) return false;
  return !/cancel/i.test(String(f.status || ''));
}

/**
 * @param liberacoes registros de ai_trust_unlocks do contrato ({ createdAt })
 * @param faturas faturas normalizadas do contrato ({ vencimentoOriginal, dataPagamento, status })
 * @param promessasPagamentoMes contador do SGP em consultacliente
 */
function avaliarElegibilidade({ liberacoes = [], faturas = [], promessasPagamentoMes = 0, hoje = new Date() }) {
  if (Number(promessasPagamentoMes) > 0) {
    return { ok: false, motivo: 'ja_liberado_este_mes' };
  }

  const ultima = liberacoes
    .filter((l) => dia(l.createdAt))
    .sort((a, b) => dia(b.createdAt).localeCompare(dia(a.createdAt)))[0];
  if (!ultima) return { ok: true };

  const passados = diasDesde(dia(ultima.createdAt), hoje);
  if (passados < DIAS_ENTRE_LIBERACOES) {
    return { ok: false, motivo: 'intervalo_minimo', diasRestantes: DIAS_ENTRE_LIBERACOES - passados };
  }

  const quebrada = faturas.some(
    (f) => dia(f.vencimentoOriginal) < dia(ultima.createdAt) && faturaEmAberto(f)
  );
  if (quebrada) return { ok: false, motivo: 'promessa_quebrada' };

  return { ok: true };
}

const MENSAGENS = {
  ja_liberado_este_mes: 'Já houve uma liberação em confiança neste mês para este contrato.',
  intervalo_minimo: 'Só é possível uma liberação em confiança a cada 30 dias.',
  promessa_quebrada: 'A liberação anterior não foi paga. É preciso quitar a fatura pendente antes de uma nova liberação.',
};

module.exports = { avaliarElegibilidade, DIAS_ENTRE_LIBERACOES, MENSAGENS };
