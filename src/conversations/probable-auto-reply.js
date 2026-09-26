// Fase 1C (25/09/2026): autorresposta PROVÁVEL do destinatário depois de um disparo automático.
// Caso real: a DW manda a cobrança, o WhatsApp Business do destinatário responde sozinho
// ("Restaurante sabor caseiro agradece seu contato. Como podemos ajudar?") e a nossa IA
// respondia ao robô ("Bom dia! Como posso ajudar?").
//
// Regra determinística, em código, sem OpenAI, e CONSERVADORA: falso positivo (calar um
// cliente de verdade) é pior do que deixar uma autorresposta passar. Na dúvida, não suprime.
// Pura: recebe o contexto já lido do banco e não consulta nada.

const JANELA_MS = 120 * 1000;
const REPETICAO_MINIMA = 20;
const MOTIVOS_DA_JANELA = ['janela_padrao_forte', 'janela_padroes_medios'];

/**
 * Normalização pequena para comparar: trim, minúsculas, sem acento, pontuação básica vira
 * espaço, espaços repetidos viram um. Não mexe em dígitos nem em outros símbolos.
 */
function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:()"'“”‘’*_~\-–—/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Famílias FORTES: cada uma sozinha basta dentro da janela, desde que a frase seja
// AFIRMATIVA (termine sem "?") — "Essa mensagem é automática?" é pergunta de gente.
const FAMILIAS_FORTES = [
  ['agradecimento_institucional', /\b(agradece|agradecemos|agradecem)\b.*\b(contato|mensagem|preferencia|visita)\b/],
  ['mensagem_recebida', /\brecebemos (a |o |sua |seu )?(sua |seu )?(mensagem|contato)\b|\bsua mensagem (foi )?recebida\b/],
  ['retorno_posterior', /\b(retornaremos|responderemos)\b|\bentraremos em contato\b|\b(retornamos|respondemos) (em breve|assim que)\b|\b(nossa equipe|um de nossos atendentes|uma de nossas atendentes|nossos atendentes) (ira|vai|irao|vao) (te |lhe )?(responder|retornar|atender)\b/],
  ['horario_comercial', /\bnosso horario\b|\b(atendemos|funcionamos) (de|das|a partir)\b|\bhorario de (atendimento|funcionamento) (e|eh|sera) (de|das)\b/],
  ['ausencia_fechado', /\b(estamos|estou|nos encontramos|encontramo nos) (ausentes?|fechados?|indisponiveis|indisponivel|fora do (horario|expediente))\b|\bfora do (nosso )?horario de (atendimento|funcionamento)\b|\bno momento (nao )?(estamos|podemos) (disponiveis|atender|responder)\b/],
  ['declaracao_automatica', /\b(mensagem|resposta|atendimento) automatic[oa]\b/],
];

// Famílias MÉDIAS: sozinhas não bastam; exigem duas DIFERENTES dentro da janela.
const FAMILIAS_MEDIAS = [
  ['como_podemos_ajudar', /\b(como|em que) (podemos|posso) (te |lhe |voce |a voce )?(ajudar|ser util|ser uteis)\b/],
  ['boas_vindas', /\bseja (muito )?bem vind[oa]s?\b/],
  ['obrigado_pelo_contato', /\bobrigad[oa] (pelo|pela|por) (seu |sua |o |a )?(contato|mensagem|preferencia)\b|\bobrigad[oa] por (entrar em contato|nos contatar|escrever)\b/],
  ['dias_de_atendimento', /\bde segunda a (sexta|sabado|domingo)\b/],
  ['aguarde', /\baguarde\b/],
  ['assim_que_possivel', /\b(assim que|o mais breve) possivel\b/],
];

// Anti-sinais: qualquer um veta. Palavras INTEIRAS (tokens), nunca substring: "seu" e
// "museu" não disparam "eu"; "contato" não dispara "conta".
const ANTI_PALAVRAS = new Set([
  // financeiro
  'fatura', 'faturas', 'boleto', 'boletos', 'pix', 'pagar', 'paguei', 'pago', 'paga', 'pagamento', 'pagamentos',
  'valor', 'valores', 'vencimento', 'vencido', 'vencida', 'venceu', 'vence', 'atraso', 'atrasado', 'atrasada',
  'cobranca', 'cobrancas', 'conta', 'contas',
  // serviço
  'internet', 'sinal', 'wifi', 'conexao', 'cancelamento', 'cancelar', 'contrato',
  // primeira pessoa do singular sobre situação pessoal, e o cliente falando com a empresa
  'eu', 'meu', 'minha', 'meus', 'minhas', 'mim', 'comigo', 'recebi', 'voces', 'vcs',
]);
const ANTI_FRASES = [
  'segunda via', 'wi fi', 'que mensagem', 'qual mensagem', 'quem e', 'quem esta falando', 'quem fala',
  'do que se trata', 'nao sei', 'nao entendi', 'o que e isso', 'que isso',
];
const ANTI_REGEX_CRU = [
  /r\$\s*\d/i, // valor em dinheiro
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ
];

function temAntiSinal(textoCru, normalizado) {
  if (ANTI_REGEX_CRU.some((r) => r.test(textoCru))) return true;
  const tokens = normalizado.split(' ');
  if (tokens.some((t) => ANTI_PALAVRAS.has(t))) return true;
  const comEspacos = ` ${normalizado} `;
  return ANTI_FRASES.some((f) => comEspacos.includes(` ${f} `));
}

// Frases afirmativas do texto cru (a que termina em "?" é pergunta e fica de fora).
function frasesAfirmativas(textoCru) {
  return (String(textoCru).match(/[^.!?\n]+[.!?\n]*/g) || [])
    .filter((f) => !f.trim().endsWith('?'))
    .map(normalizarTexto)
    .filter(Boolean);
}

function contarSinais(textoCru, normalizado) {
  const afirmativas = frasesAfirmativas(textoCru);
  const fortes = FAMILIAS_FORTES.filter(([, r]) => afirmativas.some((f) => r.test(f))).length;
  const medias = FAMILIAS_MEDIAS.filter(([, r]) => r.test(normalizado)).length;
  return { fortes, medias };
}

// Contexto compatível: disparo de campanha, ou do SGP por TEMPLATE (Meta/360dialog). O disparo
// do SGP em texto livre sai pelo Baileys, que não é canal de disparo da DW: nada muda nele.
function disparoCompativel(disparo) {
  if (!disparo) return false;
  if (disparo.origem === 'campanha') return true;
  return disparo.origem === 'sgp' && disparo.modo === 'template';
}

/**
 * Decide se a mensagem de ENTRADA é autorresposta provável do destinatário.
 *  mensagem: { tipo, texto, citada, recebidaEm }
 *  atendenteId: atendente atribuído à conversa (qualquer um → nunca suprime)
 *  disparo: o disparo automático MAIS RECENTE da conversa { origem, modo, criadoEm } | null
 *  depoisDoDisparo: mensagens da conversa depois dele [{ direcao, autorresposta, automatica }]
 *  anteriores: autorrespostas do contato já gravadas [{ texto, autorresposta, motivo }]
 * Devolve { suprimir: true, motivo } ou { suprimir: false, razao } (códigos estáveis).
 */
function classificarAutorresposta({ mensagem, atendenteId, disparo, depoisDoDisparo = [], anteriores = [] }) {
  const naoSuprime = (razao) => ({ suprimir: false, razao });
  if (atendenteId) return naoSuprime('tem_atendente');
  if (!mensagem || mensagem.tipo !== 'text') return naoSuprime('nao_e_texto');
  if (mensagem.citada) return naoSuprime('resposta_citada');
  if (!disparo) return naoSuprime('sem_disparo');
  if (!disparoCompativel(disparo)) return naoSuprime('disparo_incompativel');
  // Depois do disparo, só valem mensagens de entrada JÁ marcadas como autorresposta; qualquer
  // fala normal do cliente, ou saída que não seja disparo (atendente, IA), encerra o caso.
  if (depoisDoDisparo.some((m) => m.direcao === 'inbound' && !m.autorresposta)) return naoSuprime('humano_depois_do_disparo');
  if (depoisDoDisparo.some((m) => m.direcao === 'outbound' && !m.automatica)) return naoSuprime('saida_nao_automatica_depois_do_disparo');

  const textoCru = String(mensagem.texto || '');
  const normalizado = normalizarTexto(textoCru);
  if (!normalizado) return naoSuprime('texto_vazio');
  if (temAntiSinal(textoCru, normalizado)) return naoSuprime('anti_sinal');

  const decorrido = new Date(mensagem.recebidaEm).getTime() - new Date(disparo.criadoEm).getTime();
  const naJanela = decorrido <= JANELA_MS;
  if (naJanela) {
    const { fortes, medias } = contarSinais(textoCru, normalizado);
    if (fortes >= 1) return { suprimir: true, motivo: 'janela_padrao_forte' };
    if (medias >= 2) return { suprimir: true, motivo: 'janela_padroes_medios' };
  }

  // Fora da janela (ou sem sinais bastantes), só a repetição COMPROVADA: texto igual ao de uma
  // autorresposta já marcada que aconteceu logo após um disparo (motivo da janela).
  if (normalizado.length >= REPETICAO_MINIMA) {
    const repetida = anteriores.some((a) => a && a.autorresposta === true
      && MOTIVOS_DA_JANELA.includes(a.motivo) && normalizarTexto(a.texto) === normalizado);
    if (repetida) return { suprimir: true, motivo: 'repeticao_comprovada' };
  }
  return naoSuprime(naJanela ? 'sinais_insuficientes' : 'fora_da_janela');
}

module.exports = { classificarAutorresposta, normalizarTexto, JANELA_MS, REPETICAO_MINIMA };
