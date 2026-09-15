// Lê o recebedor de dentro do próprio código Pix copia e cola que vem do
// Financeiro do SGP. `lerRecebedorDoPix` é pura (sem I/O); a única exceção é
// `resolverRecebedorPix`, que busca a chave via HTTP quando o código é
// dinâmico e não traz a chave embutida.
//
// O cartão nativo de Pix da API oficial (Meta/360dialog) exige, junto do
// código, o nome do recebedor, a chave e o tipo da chave. Esses três dados já
// viajam dentro do código EMV/BR Code — então não há cadastro nenhum a manter
// em Integrações: quem manda é sempre o boleto que o cliente vai pagar.
//
// Formato EMV/BR Code: uma sequência de TLVs `II LL VVV…` (2 dígitos de id, 2
// dígitos de tamanho, valor com esse tamanho). Nada aqui altera o código: um
// caractere a mais ou a menos invalidaria o CRC, e o código que sai ao cliente
// é sempre o original, byte a byte.

const axios = require('axios');

const GUI_PIX = 'br.gov.bcb.pix';

// Faixa das "Merchant Account Information" no padrão EMV. Na prática o Pix
// mora na 26, mas a especificação permite 26–51, então varremos a faixa toda.
const MAI_PRIMEIRA = 26;
const MAI_ULTIMA = 51;

/**
 * Quebra uma sequência de TLVs em `{ id, valor }`. Devolve null se o texto não
 * respeitar o formato (tamanho não numérico, valor truncado, sobra solta) —
 * código malformado nunca lança, só não é lido.
 */
function lerTlvs(texto) {
  const itens = [];
  let i = 0;
  while (i < texto.length) {
    if (i + 4 > texto.length) return null;
    const id = texto.slice(i, i + 2);
    const tamanhoTexto = texto.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(tamanhoTexto)) return null;
    const tamanho = Number(tamanhoTexto);
    const inicio = i + 4;
    const fim = inicio + tamanho;
    if (fim > texto.length) return null;
    itens.push({ id, valor: texto.slice(inicio, fim) });
    i = fim;
  }
  return itens;
}

function valorDaTag(itens, id) {
  const item = itens.find((t) => t.id === id);
  return item ? item.valor : null;
}

/** A chave manda no tipo: é dela que a Meta espera o key_type correspondente. */
function tipoDaChave(chave) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) return 'EVP';
  if (/^\d{14}$/.test(chave)) return 'CNPJ';
  if (/^\d{11}$/.test(chave)) return 'CPF';
  if (chave.includes('@')) return 'EMAIL';
  if (chave.startsWith('+')) return 'PHONE';
  return 'EVP';
}

/**
 * `{ name, key, keyType }` lido do código, ou null quando o texto não é um
 * código Pix EMV (sem a tag 00 = '01', ou sem nenhuma conta de comerciante com
 * o GUI do Pix).
 *
 * `key` vem null nos códigos dinâmicos, em que a tag 26 traz só a URL do
 * payload (subtag 25) e nenhuma chave — aí o cartão oficial não tem como ser
 * montado, e quem chama decide o que fazer.
 */
function lerRecebedorDoPix(codigo) {
  if (typeof codigo !== 'string' || !codigo) return null;
  const itens = lerTlvs(codigo);
  if (!itens) return null;
  if (valorDaTag(itens, '00') !== '01') return null;

  let chave = null;
  let achouPix = false;
  for (const item of itens) {
    const id = Number(item.id);
    if (id < MAI_PRIMEIRA || id > MAI_ULTIMA) continue;
    const subtags = lerTlvs(item.valor);
    if (!subtags) continue;
    const gui = valorDaTag(subtags, '00');
    if (!gui || gui.trim().toLowerCase() !== GUI_PIX) continue;
    achouPix = true;
    const lida = valorDaTag(subtags, '01');
    if (lida && lida.trim()) {
      chave = lida.trim();
      break;
    }
  }
  if (!achouPix) return null;

  const nomeLido = valorDaTag(itens, '59');
  const name = nomeLido && nomeLido.trim() ? nomeLido.trim() : null;
  return { name, key: chave, keyType: chave ? tipoDaChave(chave) : null };
}

/**
 * Acha a URL de localização (subtag 25) dentro do mesmo bloco de conta do
 * comerciante (26–51, GUI do Pix) que `lerRecebedorDoPix` já varre. Devolve
 * null se o bloco Pix não tiver subtag 25 (código estático, por exemplo).
 */
function acharUrlDaCobranca(codigo) {
  const itens = lerTlvs(codigo);
  if (!itens) return null;
  for (const item of itens) {
    const id = Number(item.id);
    if (id < MAI_PRIMEIRA || id > MAI_ULTIMA) continue;
    const subtags = lerTlvs(item.valor);
    if (!subtags) continue;
    const gui = valorDaTag(subtags, '00');
    if (!gui || gui.trim().toLowerCase() !== GUI_PIX) continue;
    const url = valorDaTag(subtags, '25');
    if (url && url.trim()) return url.trim();
  }
  return null;
}

/**
 * Igual a `lerRecebedorDoPix`, mas resolve códigos dinâmicos: quando a chave
 * não vem embutida no código (só a URL da cobrança, subtag 25), busca essa
 * URL — um endpoint público do BCB, sem autenticação — e lê a chave da
 * resposta. Nunca lança: qualquer falha de rede (timeout, 4xx/5xx, resposta
 * sem `chave`) devolve o resultado original, com `key: null`.
 */
async function resolverRecebedorPix(codigo) {
  const resultado = lerRecebedorDoPix(codigo);
  if (!resultado) return null;
  if (resultado.key) return resultado;

  const url = acharUrlDaCobranca(codigo);
  if (!url) return resultado;

  try {
    const response = await axios.get('https://' + url, { timeout: 5000 });
    const chave = response.data && response.data.chave;
    if (typeof chave === 'string' && chave.trim()) {
      return { name: resultado.name, key: chave.trim(), keyType: tipoDaChave(chave.trim()) };
    }
    return resultado;
  } catch (err) {
    return resultado;
  }
}

module.exports = { lerRecebedorDoPix, resolverRecebedorPix };
