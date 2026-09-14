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
const TAMANHO_NOME_CURTO = 3;

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Nome curto casa por PALAVRA INTEIRA: uma sigla de duas letras como
// substring aceitava qualquer favorecido que a contivesse no meio de outra
// palavra. Nome maior (a razão social, o recebedor PIX cadastrado) segue por
// substring, porque o banco costuma cercar o nome de prefixos e sufixos
// ('PAGAMENTO A ... ME').
function nomeCasa(favorecido, nome) {
  const n = semAcento(nome);
  if (!n) return false;
  if (n.length > TAMANHO_NOME_CURTO) return favorecido.includes(n);
  return new RegExp(`\\b${escaparRegex(n)}\\b`).test(favorecido);
}

// Valor lido pela visão. Campo ausente, nulo ou vazio é AUSÊNCIA de leitura,
// não zero: `Number('')` devolve 0, que é finito e casaria com uma fatura de
// value null/0 — um comprovante sem valor nenhum saía "válido".
function valorLido(bruto) {
  if (typeof bruto === 'number') return bruto;
  const texto = String(bruto == null ? '' : bruto).trim().replace(',', '.');
  return texto ? Number(texto) : NaN;
}

function valorUtil(v) {
  return Number.isFinite(v) && v > 0;
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
  const favorecidoConfere = Boolean(favorecido) && (nomesAceitos || []).some((n) => nomeCasa(favorecido, n));
  if (!favorecidoConfere) motivos.push('favorecido não confere com os nomes cadastrados da empresa');

  const dataOk = typeof l.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.data);
  const dias = dataOk ? diasEntre(l.data, hoje) : null;
  const dataConfere = dataOk && dias >= 0 && dias <= JANELA_DIAS;
  if (!dataConfere) motivos.push('data do pagamento fora dos últimos 7 dias');

  const valor = valorLido(l.valor);
  // Fatura sem valor utilizável no SGP não serve de referência para nada.
  const fatura = valorUtil(valor)
    ? (faturas || []).find((f) => valorUtil(Number(f.value)) && Math.abs(Number(f.value) - valor) <= TOLERANCIA_VALOR)
    : null;
  const valorConfere = Boolean(fatura);
  if (!valorConfere) motivos.push('valor não corresponde a nenhuma fatura em aberto');

  return {
    valido: motivos.length === 0,
    tipo: typeof l.tipo === 'string' ? l.tipo : 'outro',
    valor: valorUtil(valor) ? valor : null,
    data: dataOk ? l.data : null,
    favorecidoConfere,
    dataConfere,
    valorConfere,
    faturaId: fatura ? fatura.id : null,
    motivos,
  };
}

module.exports = { conferirComprovante, PROMPT_VISAO, TOLERANCIA_VALOR, JANELA_DIAS, CONFIANCA_MINIMA };
