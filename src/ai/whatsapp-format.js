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
function paraWhatsApp(texto) {
  if (!texto) return texto;
  return texto
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\*\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
}

module.exports = { paraWhatsApp };
