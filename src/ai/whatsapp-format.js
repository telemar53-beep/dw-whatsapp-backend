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

  return semLinhasRepetidas(convertido.replace(PLACEHOLDER, (_, i) => urls[Number(i)]));
}

/**
 * O modelo às vezes repete a própria saída (observado em produção: saudação e
 * pergunta duas vezes num único balão, depois de uma chamada de ferramenta,
 * com a repetição colada na linha anterior). Uma linha idêntica a outra já
 * escrita na mesma mensagem nunca é intencional numa resposta de atendimento
 * — cai. Linhas em branco não contam e são recolhidas a no máximo uma.
 */
function semLinhasRepetidas(texto) {
  const vistas = new Set();
  const saida = [];
  for (const linha of texto.split('\n')) {
    const chave = linha.trim();
    if (chave && vistas.has(chave)) continue;
    if (chave) vistas.add(chave);
    saida.push(linha);
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { paraWhatsApp };
