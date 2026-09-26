// Guarda de linguagem da regra financeira 0/1/2+ (25/09/2026). A IA já disse "pagamento
// confirmado" sem nada ter sido conferido; comprovante, "já paguei" e o PIX enviado também não são
// prova. Três afirmações só saem com FATO do sistema neste turno:
//
// - pagamento confirmado / compensado / baixado → contexto.pagamentoConfirmado, que só
//   conferir_pagamento põe (o MESMO título relido: statusid 2 + "Pago" + data de pagamento);
// - internet / acesso liberado → contexto.contratoAtivoConfirmado (a releitura do contrato voltou
//   status 1) ou contexto.desbloqueioRealizado (desbloqueio em confiança com liberado:true — o
//   orquestrador também consulta o banco para o desbloqueio de um turno anterior);
// - conectada / online / "voltou", depois de conferir o pagamento → contexto.conexaoOnline (a
//   verificação da conexão). Contrato ativo não é conexão online.
// - promessa de que o acesso volta sozinho depois do pagamento → NUNCA (ajuste de 25/09/2026): não
//   é garantido — com duas ou mais vencidas, pagar uma não libera. A formulação segura é "assim que
//   o pagamento constar no sistema, vou verificar a situação do contrato".
//
// Módulo puro: o orquestrador corrige o modelo UMA vez e, se ele insistir, troca a frase.

// A RESSALVA (negação ou condição) só desfaz a afirmação quando faz parte DIRETA dela: colada, na
// MESMA oração (P1-2 da auditoria final, 25/09/2026). Antes, qualquer "não/se/quando" nos 40
// caracteres anteriores valia — e "Não se preocupe, seu pagamento foi confirmado!" passava. Boa
// parte das ressalvas já nem casa com os padrões ("ainda não foi confirmado", "assim que for
// compensado", "se já estiver pago"); o que sobra é conferido aqui, só na oração da afirmação.
//
// Fronteira de oração: vírgula, ponto e vírgula, dois-pontos, parênteses, travessão e conjunção
// coordenativa. O que vem antes dela não governa a afirmação.
const FRONTEIRA_DE_ORACAO = /[,;:()\u2014\u2013]|\s-\s|\s(?:e|mas|por[eé]m|pois|porque|ent[aã]o)\s/i;
const RESSALVAS_COLADAS = [
  // negação colada ao sujeito ou ao verbo (até uma palavra entre): "ainda não consta como pago"
  /\b(?:n[aã]o|nem|nunca)\s+(?:\S+\s+)?$/i,
  // condição ou tempo que ABRE a oração da afirmação: "se o pagamento já foi confirmado, …"
  /^\s*(?:se|caso|quando|assim que|logo que|depois que|ap[oó]s|at[eé] que|antes que)\s+(?:\S+\s+){0,3}$/i,
  // falta de confirmação ou dúvida que GOVERNA a afirmação: "não tenho confirmação de que o
  // pagamento…", "não sei se o pagamento…", "não consigo confirmar se a conexão…"
  /\b(?:n[aã]o|sem|nem)\b.*\b(?:confirm\w*|informa\w*|registro|certeza|sei|sabemos|saber|consigo|conseguimos|consta)\b.*\b(?:de que|que|se)\s+(?:\S+\s+){0,3}$/i,
];

function ultimaOracao(prefixo) {
  const oracoes = String(prefixo).split(FRONTEIRA_DE_ORACAO);
  return oracoes[oracoes.length - 1];
}

function ressalvaColada(prefixo) {
  const oracao = ultimaOracao(prefixo);
  return RESSALVAS_COLADAS.some((r) => r.test(oracao));
}

// Na CONEXÃO, reagir ao relato do cliente ("Que bom que sua internet voltou!") não é afirmação do
// sistema. Só vale para a conexão: "que bom que seu pagamento foi confirmado" continua sendo afirmação.
const REACAO_AO_RELATO = /\b(?:que bom|que [oó]timo|[oó]timo|fico feliz|ficamos felizes|que maravilha)\s+que\s+(?:\S+\s+){0,2}$/i;
const ressalvaDaConexao = (prefixo) => ressalvaColada(prefixo) || REACAO_AO_RELATO.test(ultimaOracao(prefixo));

const PAGAMENTO = [
  /\bpagamento\s+(j[aá]\s+)?(foi\s+|est[aá]\s+|ficou\s+|j[aá]\s+foi\s+|j[aá]\s+est[aá]\s+)?(confirmado|compensado|baixado|identificado|reconhecido|aprovado)\b/i,
  /\bpagamento\s+(j[aá]\s+)?(compensou|caiu|baixou|entrou)\b/i,
  /\bj[aá]\s+(baixou|compensou)\b/i,
  /\b(fatura|boleto|conta|mensalidade)\s+(j[aá]\s+)?(foi\s+|est[aá]\s+|ficou\s+|j[aá]\s+foi\s+|j[aá]\s+est[aá]\s+)?(paga|pago|quitad[oa]|baixad[oa]|compensad[oa])\b/i,
  /\bconsta(m)?\s+como\s+pag[oa]s?\b/i,
  /\bconfirm(ei|amos)\s+(o\s+|seu\s+|a\s+sua\s+)?pagamento\b/i,
  /\brecebemos\s+(o\s+|seu\s+)?pagamento\b/i,
];

// P2-1 (auditoria final, 25/09/2026): LIBERAÇÃO se divide em dois tipos de afirmação.
// EVENTO — uma liberação ACONTECEU ("desbloqueio realizado", "foi liberado", "liberei"): só a releitura
// do contrato depois do pagamento (status 1) ou o desbloqueio em confiança (liberado:true) provam.
const LIBERACAO_EVENTO = [
  /\b(acesso|internet|conex[aã]o|servi[cç]o|sinal|contrato|plano)\s+(j[aá]\s+)?(foi\s+|ficou\s+|j[aá]\s+foi\s+)?(liberad[oa]|desbloquead[oa]|restabelecid[oa]|reativad[oa]|religad[oa])\b/i,
  /\bliberei\s+(o\s+|seu\s+|sua\s+|a\s+)?(acesso|internet|conex[aã]o|servi[cç]o)\b/i,
  /\bdesbloqueio\s+(em\s+confian[çc]a\s+)?(j[aá]\s+)?(foi\s+|est[aá]\s+)?(realizado|feito|conclu[íi]do|efetuado)\b/i,
  /\b(j[aá]|agora)\s+ficou\s+(liberad|desbloquead)[oa]\b/i,
];
// ESTADO — como o contrato ESTÁ ("consta ativo", "o acesso está liberado"): além dos fatos de evento,
// o status 1 lido do SGP NESTE turno prova. Nunca prova CONEXÃO (ver CONEXAO).
const LIBERACAO_ESTADO = [
  /\b(acesso|contrato|servi[cç]o|plano|cadastro)\s+(j[aá]\s+)?(est[aá]|consta|segue|continua)\s+(como\s+)?(liberad[oa]|desbloquead[oa]|ativ[oa]|ativad[oa]|regularizad[oa])\b/i,
  /\b(internet|conex[aã]o|sinal)\s+(j[aá]\s+)?(est[aá]|segue|continua)\s+(liberad[oa]|desbloquead[oa])\b/i,
  /\b(j[aá]|agora)\s+est[aá]\s+(liberad|desbloquead)[oa]\b/i,
];
const LIBERACAO = [...LIBERACAO_EVENTO, ...LIBERACAO_ESTADO];

/**
 * O status do contrato lido do SGP NESTE turno (a identidade é relida a cada turno) prova o STATUS
 * DO CONTRATO. Só vale com TODOS os contratos de quem fala em status 1 (com um suspenso, "seu contrato
 * está ativo" mascararia a suspensão), sem pedido de terceiro em andamento (o contrato em pauta é de
 * outra pessoa) e sem a releitura do contrato (conferir_pagamento) ter dito o contrário.
 */
function contratoAtivoNoTurno(contexto) {
  const c = contexto || {};
  if (c.contratoAtivoNegado === true || c.terceiro || c.alvoTerceiro) return false;
  const contratos = Array.isArray(c.contracts) ? c.contracts : [];
  return contratos.length > 0 && contratos.every((x) => x && String(x.statusCode) === '1');
}

const eventoDeLiberacaoTemFato = (c) => c.contratoAtivoConfirmado === true || c.desbloqueioRealizado === true;
const estadoDoContratoTemFato = (c) => eventoDeLiberacaoTemFato(c) || contratoAtivoNoTurno(c);

// A promessa já é condicional ("assim que pagar…"), então a ressalva de condição não a desfaz; só
// uma negação colada no verbo ("não volta automaticamente").
const PROMESSA = [
  /\b(libera[çc][ãa]o|desbloqueio|religa[çc][ãa]o)\s+(do\s+\S+\s+|da\s+\S+\s+)?(é|e|será|sera|vai\s+ser|acontece|ocorre|fica)\s+autom[aá]tic[ao]\b/i,
  /\b(liberad[oa]|desbloquead[oa]|religad[oa]|restabelecid[oa]|libera|volta|voltar[aá]|retorna|retornar[aá])\s+(de\s+forma\s+)?automaticamente\b/i,
  /\bautomaticamente\s+(liberad|desbloquead|religad|restabelecid)[oa]\b/i,
];
const NEGACAO_COLADA = /\b(n[aã]o|nem|nunca)\s+(\S+\s+)?$/i;
const negacaoColada = (prefixo) => NEGACAO_COLADA.test(prefixo);

const CONEXAO = [
  /\b(internet|conex[aã]o|sinal)\s+(j[aá]\s+)?(est[aá]\s+|voltou\s+a\s+(estar\s+|ficar\s+)?|j[aá]\s+est[aá]\s+)?(online|conectad[oa]|funcionando|normalizad[oa])\b/i,
  /\b(internet|conex[aã]o|sinal)\s+(j[aá]\s+)?voltou\b/i,
];

/** Alguma ocorrência do padrão, NA frase, sem negação ou condição logo antes? */
function afirmaNaFrase(frase, padroes, ressalva = ressalvaColada) {
  if (/\?\s*$/.test(frase)) return false;
  return padroes.some((padrao) => {
    const global = new RegExp(padrao.source, padrao.flags.includes('g') ? padrao.flags : `${padrao.flags}g`);
    let achado = global.exec(frase);
    while (achado) {
      if (!ressalva(frase.slice(0, achado.index))) return true;
      achado = global.exec(frase);
    }
    return false;
  });
}

const RESSALVA_POR_PADRAO = new Map([
  ...PROMESSA.map((p) => [p, negacaoColada]),
  ...CONEXAO.map((p) => [p, ressalvaDaConexao]),
]);

/** A frase afirma algum dos padrões (cada um com a sua ressalva)? */
function fraseAfirma(frase, padroes) {
  return padroes.some((p) => afirmaNaFrase(frase, [p], RESSALVA_POR_PADRAO.get(p) || ressalvaColada));
}

function frasesDe(texto) {
  return String(texto || '').split(/(?<=[.!?…])\s+|\n+/).map((f) => f.trim()).filter(Boolean);
}

function afirma(texto, padroes) {
  return frasesDe(texto).some((frase) => fraseAfirma(frase, padroes));
}

function afirmaPagamentoConfirmado(texto) { return afirma(texto, PAGAMENTO); }
function afirmaLiberacaoAmpla(texto) { return afirma(texto, LIBERACAO); }
function afirmaConexao(texto) { return afirma(texto, CONEXAO); }
function prometeLiberacao(texto) { return afirma(texto, PROMESSA); }

const PADROES_POR_VIOLACAO = {
  pagamento_sem_confirmacao: PAGAMENTO,
  liberacao_sem_fato: LIBERACAO,
  conexao_sem_fato: CONEXAO,
  promessa_de_liberacao: PROMESSA,
};

/** As afirmações do texto que não têm o fato do sistema neste turno. */
function violacoesDoPagamento(texto, contexto = {}) {
  const c = contexto || {};
  const violacoes = [];
  if (c.pagamentoConfirmado !== true && afirmaPagamentoConfirmado(texto)) violacoes.push('pagamento_sem_confirmacao');
  if ((!eventoDeLiberacaoTemFato(c) && afirma(texto, LIBERACAO_EVENTO))
      || (!estadoDoContratoTemFato(c) && afirma(texto, LIBERACAO_ESTADO))) {
    violacoes.push('liberacao_sem_fato');
  }
  // Conexão só com a verificação da conexão (conexaoOnline) — nem o pagamento conferido, nem o
  // contrato ativo (lido no turno ou relido) dizem que a internet está funcionando.
  const statusSemConexao = c.pagamentoConferido === true || c.contratoAtivoConfirmado === true || contratoAtivoNoTurno(c);
  if (statusSemConexao && c.conexaoOnline !== true && afirmaConexao(texto)) violacoes.push('conexao_sem_fato');
  // Sem fato que a autorize: nem pagamento confirmado, nem contrato ativo, nem desbloqueio.
  if (prometeLiberacao(texto)) violacoes.push('promessa_de_liberacao');
  return violacoes;
}

const FRASE_CONEXAO_COM_CONTRATO_ATIVO = 'O contrato consta ativo no sistema, mas ainda preciso verificar o status da conexão.';

const FRASE_SEGURA = {
  pagamento_sem_confirmacao: 'O pagamento ainda não consta como confirmado no sistema.',
  liberacao_sem_fato: 'Ainda não tenho a confirmação de que o acesso foi liberado.',
  conexao_sem_fato: 'Daqui eu não consigo confirmar se a conexão já está online.',
  promessa_de_liberacao: 'Assim que o pagamento constar no sistema, vou verificar a situação do contrato.',
};

/**
 * A troca final: sai só a frase com a afirmação proibida. Se nada sobrar, sai a frase segura de
 * cada violação — que não afirma pagamento, liberação nem conexão.
 */
function respostaSemAfirmacoes(texto, violacoes, contexto = {}) {
  const c = contexto || {};
  // Com o estado do contrato provado, só o EVENTO de liberação sai; "consta ativo" fica.
  const padroesDe = (v) => (v === 'liberacao_sem_fato' && estadoDoContratoTemFato(c) ? LIBERACAO_EVENTO : PADROES_POR_VIOLACAO[v] || []);
  const padroes = violacoes.flatMap(padroesDe);
  const linhas = String(texto || '').split('\n').map((linha) => frasesDe(linha)
    .filter((frase) => !fraseAfirma(frase, padroes))
    .join(' '));
  const restante = linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (restante && violacoesDoPagamento(restante, contexto).length === 0) return restante;
  // P2-1: para o cliente ATIVO, a frase de conexão não pode sugerir bloqueio.
  const ativo = c.contratoAtivoConfirmado === true || contratoAtivoNoTurno(c);
  return violacoes.map((v) => (v === 'conexao_sem_fato' && ativo ? FRASE_CONEXAO_COM_CONTRATO_ATIVO : FRASE_SEGURA[v]))
    .filter(Boolean).join(' ');
}

/** A correção ao modelo, UMA vez por turno. */
function correcaoDoPagamento(violacoes) {
  const partes = [];
  if (violacoes.includes('pagamento_sem_confirmacao')) {
    partes.push('Você afirmou que o pagamento foi confirmado/compensado/baixado, mas o sistema NÃO confirmou isso neste atendimento. Comprovante, "já paguei" ou o PIX enviado não confirmam pagamento. Se precisar saber, chame conferir_pagamento; sem ela, diga no máximo que o pagamento ainda não consta como confirmado no sistema.');
  }
  if (violacoes.includes('liberacao_sem_fato')) {
    partes.push('Você afirmou uma liberação do acesso que nenhum fato do sistema confirma. Só diga que a internet foi liberada se o contrato relido estiver ativo ou se o desbloqueio em confiança tiver liberado; sem isso, não afirme liberação e não prometa prazo.');
  }
  if (violacoes.includes('conexao_sem_fato')) {
    partes.push('Contrato ativo não quer dizer conexão online: não diga que a internet está conectada, online ou que voltou sem a verificação da conexão.');
  }
  if (violacoes.includes('promessa_de_liberacao')) {
    partes.push('Você prometeu que o acesso volta sozinho depois do pagamento, e isso não é garantido. Diga no máximo: "Assim que o pagamento constar no sistema, vou verificar a situação do contrato."');
  }
  return `${partes.join(' ')} Responda de novo ao cliente sem essa afirmação.`;
}

module.exports = {
  violacoesDoPagamento, respostaSemAfirmacoes, correcaoDoPagamento,
  afirmaPagamentoConfirmado, afirmaLiberacaoAmpla, afirmaConexao, prometeLiberacao, contratoAtivoNoTurno,
};
