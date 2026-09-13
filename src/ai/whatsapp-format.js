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

  return semRepeticaoIntegral(convertido.replace(PLACEHOLDER, (_, i) => urls[Number(i)]));
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

module.exports = { paraWhatsApp };
