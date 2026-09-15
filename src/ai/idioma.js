// Teste real 2026-09-15 (produção, gpt-5.4-mini): "Boa noite, Willemberg! كيف
// posso ajudar você hoje?" — uma palavra em árabe no meio da saudação, e não
// foi a primeira vez que o modelo trocou um pedaço da frase de idioma. O
// prompt-base já pede português brasileiro; como ele foi ignorado mesmo
// assim, a garantia é em código, como as outras do projeto (saudação,
// markdown, número de contrato).
//
// "Estranho" = qualquer LETRA que não seja do alfabeto latino (árabe,
// cirílico, chinês, hebraico, grego, tailandês...). Acentos do português,
// emoji, números, pontuação, URL e código PIX não são letras de outro
// alfabeto e passam intactos.

// Uma letra (\p{L}) que NÃO é latina: classe negada de "latina OU não-letra".
const LETRA_NAO_LATINA = /[^\p{Script=Latin}\P{L}]/u;
// A mesma letra com os sinais que a acompanham (\p{M}: diacríticos do árabe,
// por exemplo), em sequência — é a "palavra" a remover.
const PALAVRA_NAO_LATINA = /(?:[^\p{Script=Latin}\P{L}]\p{M}*)+/gu;

function temAlfabetoEstranho(texto) {
  return LETRA_NAO_LATINA.test(String(texto || ''));
}

/**
 * Rede final: remove as palavras de outro alfabeto e ajusta os espaços em
 * volta ("Willemberg! كيف posso" → "Willemberg! posso"). Imperfeito de
 * propósito — perde uma palavra — mas nunca deixa um alfabeto estranho chegar
 * ao cliente. A reescrita pelo modelo (ai-orchestrator.js) vem antes disto.
 */
function semAlfabetoEstranho(texto) {
  if (!texto) return texto;
  return String(texto)
    .replace(PALAVRA_NAO_LATINA, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .trim();
}

module.exports = { temAlfabetoEstranho, semAlfabetoEstranho };
