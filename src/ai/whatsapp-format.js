/**
 * Converte o markdown que o modelo tende a escrever para a formatação que o
 * WhatsApp entende. O cliente vê o texto cru: "**negrito**" chega com os
 * asteriscos duplos na tela dele. O contexto do sistema já pede o formato
 * certo, mas o modelo escorrega — esta função é a garantia determinística.
 *
 * Só toca no que é markdown inequívoco. Um asterisco simples, sublinhado
 * simples e hífen de lista já são WhatsApp e passam intactos — assim como um
 * código PIX copia e cola, que não contém nenhum desses padrões.
 */

// Sentinela construída em tempo de execução, e não como escape no fonte: um
// NUL literal no arquivo faz o git tratá-lo como binário. O caractere em si é
// a escolha certa — nunca aparece em texto de modelo, então não colide.
const NUL = String.fromCharCode(0);
const PLACEHOLDER = new RegExp(NUL + '(\\d+)' + NUL, 'g');
const LINK_COM_PLACEHOLDER = new RegExp('\\[([^\\]]+)\\]\\((' + NUL + '\\d+' + NUL + ')\\)', 'g');

function paraWhatsApp(texto) {
  if (!texto) return texto;

  // URLs saem do texto antes das regras e voltam intactas no fim: "__" e "*"
  // dentro de um link de boleto ou de um endereço assinado não são markdown, e
  // uma regra aplicada sobre eles entregaria ao cliente um link quebrado.
  const urls = [];
  const comPlaceholders = texto.replace(/https?:\/\/[^\s)\]]+/g, (url) => {
    urls.push(url);
    return NUL + (urls.length - 1) + NUL;
  });

  const convertido = comPlaceholders
    // Três asteriscos (negrito+itálico) primeiro: a regra de dois deixaria
    // sobrar um par literal, que é exatamente o defeito que esta função evita.
    .replace(/\*\*\*(.+?)\*\*\*/g, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\*\s+/gm, '- ')
    .replace(LINK_COM_PLACEHOLDER, '$1 ($2)');

  return semNumeroDeContrato(semParagrafoQuaseRepetido(semRepeticaoIntegral(convertido.replace(PLACEHOLDER, (_, i) => urls[Number(i)]))));
}

/**
 * Defeito C (teste real 2026-09-14): o modelo escreveu "a do contrato 2354" ao
 * cliente. O número do contrato não significa nada para ele — e com a
 * identidade ainda fraca (CPF digitado, data não conferida) é dado de outra
 * pessoa. O prompt proíbe; isto é a garantia determinística.
 *
 * Só o NÚMERO cai; a palavra "contrato" e a preposição antes dela ficam, para
 * a frase continuar de pé ("a fatura do contrato 2354 está em aberto" → "a
 * fatura do contrato está em aberto"). O $1 preserva o C maiúsculo. Uma regra
 * separada para "do/no/para o/pelo contrato NNN" seria redundante: esta já
 * deixa a preposição intacta.
 *
 * Não toca em número que não venha logo depois de "contrato" (protocolo, CEP),
 * nem no código PIX copia e cola, que não contém a palavra.
 */
function semNumeroDeContrato(texto) {
  if (!texto) return texto;
  return texto.replace(/\b(contratos?)\s+(n[ºo°]?\s*)?\d{3,}\b/gi, '$1');
}

function tokensNormalizados(linha) {
  return linha
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let intersecao = 0;
  for (const x of sa) if (sb.has(x)) intersecao += 1;
  const uniao = sa.size + sb.size - intersecao;
  return uniao === 0 ? 0 : intersecao / uniao;
}

// Uma linha só conta como "quase repetida" quando tem corpo de frase: linhas
// curtas e legitimamente iguais ("Status: Ativo" em dois contratos, "- 600
// Mega") ficam abaixo deste piso e nunca são tocadas.
const MINIMO_DE_PALAVRAS = 8;
const SIMILARIDADE_MINIMA = 0.7;

/**
 * O modelo, instruído a responder "no modelo: ...", às vezes escreve a frase
 * com as palavras dele E cola o modelo em seguida (observado em produção:
 * "Bom dia, Willemberg! Vou te ajudar com o boleto. Como você tem mais de um
 * contrato..." seguido de "Claro, vou te ajudar com o boleto. Como você tem
 * mais de um contrato..."). Não é repetição idêntica, então
 * semRepeticaoIntegral não pega. Aqui uma linha com corpo de frase cujas
 * palavras coincidem em 70% ou mais com uma linha anterior é descartada.
 */
function semParagrafoQuaseRepetido(texto) {
  if (!texto || !texto.includes('\n')) return texto;
  const mantidas = [];
  const vistas = [];
  for (const linha of texto.split('\n')) {
    const t = tokensNormalizados(linha);
    const repetida = t.length >= MINIMO_DE_PALAVRAS && vistas.some((v) => jaccard(t, v) >= SIMILARIDADE_MINIMA);
    if (repetida) continue;
    mantidas.push(linha);
    if (t.length >= MINIMO_DE_PALAVRAS) vistas.push(t);
  }
  return mantidas.join('\n').trim();
}

/**
 * O modelo às vezes repete a própria saída inteira (observado em produção:
 * saudação e pergunta duas vezes num único balão, depois de uma chamada de
 * ferramenta, com a repetição colada na linha anterior). Só esse padrão é
 * tratado: a mensagem é "A, quebra de linha, A" — devolve A. Deduplicar
 * linhas soltas seria mais amplo e apagaria linhas legítimas repetidas, como
 * "Status: Ativo" em dois contratos diferentes.
 */
function semRepeticaoIntegral(texto) {
  const t = texto.trim();
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) {
    const cabeca = t.slice(0, i).trim();
    const cauda = t.slice(i).trim();
    if (cabeca && cabeca === cauda) return semRepeticaoIntegral(cabeca);
  }
  return t;
}

module.exports = { paraWhatsApp, semParagrafoQuaseRepetido, semNumeroDeContrato };
