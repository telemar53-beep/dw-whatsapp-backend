// Leitura do comprovante pela visão da OpenAI e conferência EM CÓDIGO. O
// modelo de chat nunca digita valor, data ou favorecido: quem lê é a visão,
// quem confere é este módulo, e o modelo só recebe o veredito.
const PROMPT_VISAO = [
  'Esta imagem deve ser um comprovante de pagamento brasileiro (PIX, boleto ou transferência).',
  'Extraia: ehComprovante (true/false), tipo ("pix" | "boleto" | "transferencia" | "outro"), valor (número em reais, ponto decimal, ex.: 135.00), data (do pagamento, formato AAAA-MM-DD), favorecido (nome de quem recebeu), banco (do pagador, se aparecer), confianca (0 a 1).',
  'Se um campo não estiver legível, use null. Responda SOMENTE com JSON, sem texto fora dele.',
].join(' ');

// Centavos de diferença acontecem em arredondamento de juros/desconto; acima
// disso não é a mesma fatura.
const TOLERANCIA_VALOR = 0.05;
const JANELA_DIAS = 7;
const CONFIANCA_MINIMA = 0.6;

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// A data do pagamento é comparada com o dia de São Paulo, não com o UTC: às
// 22h de Brasília o UTC já virou o dia seguinte e um comprovante de hoje
// pareceria "do futuro".
function dataEmSaoPaulo(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // AAAA-MM-DD
}

function diasEntre(iso, hoje) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hy, hm, hd] = dataEmSaoPaulo(hoje).split('-').map(Number);
  return Math.round((Date.UTC(hy, hm - 1, hd) - Date.UTC(y, m - 1, d)) / 86400000);
}

/**
 * Confere a leitura da visão contra as faturas em aberto do cliente. Tudo que
 * a visão devolve é tratado como texto de origem duvidosa: campo faltando,
 * tipo errado ou formato estranho viram "não conferido", nunca exceção.
 */
function conferirComprovante({ leitura, faturas, nomesAceitos, hoje = new Date() }) {
  const l = leitura && typeof leitura === 'object' ? leitura : {};
  const motivos = [];
  const confianca = Number(l.confianca);
  if (l.ehComprovante !== true) motivos.push('a imagem não parece um comprovante de pagamento');
  else if (!(confianca >= CONFIANCA_MINIMA)) motivos.push('leitura do comprovante com confiança baixa');

  const favorecido = semAcento(l.favorecido);
  const favorecidoConfere = Boolean(favorecido) && (nomesAceitos || []).some((n) => semAcento(n) && favorecido.includes(semAcento(n)));
  if (!favorecidoConfere) motivos.push('favorecido não é a DW');

  const dataOk = typeof l.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.data);
  const dias = dataOk ? diasEntre(l.data, hoje) : null;
  const dataConfere = dataOk && dias >= 0 && dias <= JANELA_DIAS;
  if (!dataConfere) motivos.push('data do pagamento fora dos últimos 7 dias');

  const valor = typeof l.valor === 'number' ? l.valor : Number(String(l.valor || '').replace(',', '.'));
  const fatura = Number.isFinite(valor) ? (faturas || []).find((f) => Math.abs(Number(f.value) - valor) <= TOLERANCIA_VALOR) : null;
  const valorConfere = Boolean(fatura);
  if (!valorConfere) motivos.push('valor não corresponde a nenhuma fatura em aberto');

  return {
    valido: motivos.length === 0,
    tipo: typeof l.tipo === 'string' ? l.tipo : 'outro',
    valor: Number.isFinite(valor) ? valor : null,
    data: dataOk ? l.data : null,
    favorecidoConfere,
    dataConfere,
    valorConfere,
    faturaId: fatura ? fatura.id : null,
    motivos,
  };
}

module.exports = { conferirComprovante, PROMPT_VISAO, TOLERANCIA_VALOR, JANELA_DIAS, CONFIANCA_MINIMA };
