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
 * "Quebrada" é deduzida das faturas: a fatura que motivou a suspensão é a que
 * estava vencida quando a liberação foi feita. Só as vencidas dentro de uma
 * janela antes da liberação contam — um título antigo, baixado ou esquecido de
 * anos atrás não pode tornar o contrato inelegível para sempre com uma
 * acusação falsa de "não pagou a última liberação".
 *
 * Módulo puro (sem I/O) de propósito: a regra é o que mais importa acertar, e
 * assim ela é testável sem mock nenhum.
 */

const DIAS_ENTRE_LIBERACOES = 30;
const JANELA_FATURAS_DIAS = 60;
const MS_POR_DIA = 86400000;
const FUSO = 'America/Sao_Paulo';

// Calendário de São Paulo, explícito — o processo no Render roda em UTC, e
// uma liberação às 22h aqui já é o dia seguinte lá. Mesmo recurso que
// business-hours.service.js e assignment-message.repository.js usam.
const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' de um Date (no fuso da operação) ou de 'YYYY-MM-DD HH:mm:ss'. */
function dia(valor) {
  if (valor instanceof Date) return formatoDia.format(valor);
  return String(valor || '').slice(0, 10);
}

function somarDias(diaISO, dias) {
  const d = new Date(`${diaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(diaInicio, diaFim) {
  return Math.floor((new Date(`${diaFim}T00:00:00Z`) - new Date(`${diaInicio}T00:00:00Z`)) / MS_POR_DIA);
}

// Só o status EXATO, palavra inteira, conta como encerrado. Um trecho solto
// ("pag") casaria "Aguardando pagamento" — e uma fatura em aberto viraria
// paga, entregando uma segunda liberação a quem nunca pagou. Na dúvida, a
// fatura é considerada aberta: é a direção conservadora.
const STATUS_ENCERRADO = /^(cancelad[oa]|pag[oa]|baixad[oa]|quitad[oa]|liquidad[oa])$/i;

function faturaEmAberto(f) {
  if (f.dataPagamento) return false;
  return !STATUS_ENCERRADO.test(String(f.status || '').trim());
}

/**
 * @param liberacoes registros de ai_trust_unlocks do contrato ({ createdAt })
 * @param faturas faturas normalizadas do contrato ({ vencimentoOriginal, dataPagamento, status })
 * @param totalFaturas total informado pela paginação do SGP (para detectar lista truncada)
 * @param promessasPagamentoMes contador do SGP em consultacliente
 */
function avaliarElegibilidade({ liberacoes = [], faturas = [], totalFaturas = null, promessasPagamentoMes = 0, hoje = new Date() }) {
  if (Number(promessasPagamentoMes) > 0) {
    return { ok: false, motivo: 'ja_liberado_este_mes' };
  }

  const ultima = liberacoes
    .filter((l) => dia(l.createdAt))
    .sort((a, b) => dia(b.createdAt).localeCompare(dia(a.createdAt)))[0];
  if (!ultima) return { ok: true };

  const diaLiberacao = dia(ultima.createdAt);
  const passados = diasEntre(diaLiberacao, dia(hoje));
  if (passados < DIAS_ENTRE_LIBERACOES) {
    return { ok: false, motivo: 'intervalo_minimo', diasRestantes: DIAS_ENTRE_LIBERACOES - passados };
  }

  const inicioJanela = somarDias(diaLiberacao, -JANELA_FATURAS_DIAS);
  const vencimentos = faturas.map((f) => dia(f.vencimentoOriginal)).filter(Boolean).sort();

  // Lista truncada pelo SGP e a página não alcança o começo da janela: não dá
  // para afirmar nem que pagou nem que não pagou. Falha fechada — decidir
  // com dado parcial é a brecha que a regra existe para fechar.
  const truncada = Number.isInteger(totalFaturas) && totalFaturas > faturas.length;
  if (truncada && (vencimentos.length === 0 || vencimentos[0] > inicioJanela)) {
    return { ok: false, motivo: 'historico_incompleto' };
  }

  const quebrada = faturas.some((f) => {
    const venc = dia(f.vencimentoOriginal);
    return venc >= inicioJanela && venc < diaLiberacao && faturaEmAberto(f);
  });
  if (quebrada) return { ok: false, motivo: 'promessa_quebrada' };

  return { ok: true };
}

const MENSAGENS = {
  ja_liberado_este_mes: 'Já houve uma liberação em confiança neste mês para este contrato.',
  intervalo_minimo: 'Só é possível uma liberação em confiança a cada 30 dias.',
  promessa_quebrada: 'Há fatura em aberto anterior à última liberação em confiança. É preciso quitá-la antes de uma nova liberação.',
  historico_incompleto: 'Não foi possível verificar o histórico de faturas deste contrato. Encaminhe para um atendente.',
};

module.exports = { avaliarElegibilidade, DIAS_ENTRE_LIBERACOES, JANELA_FATURAS_DIAS, MENSAGENS };
