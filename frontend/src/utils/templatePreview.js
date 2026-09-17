// Substitui {{1}}, {{2}}… pelo que o atendente digitou, para ele ver o texto
// final antes de enviar. Template não dá para corrigir depois: uma variável no
// lugar errado chega assim ao cliente.
//
// Variável ainda não preenchida continua aparecendo como {{n}} em vez de virar
// buraco no texto — é isso que deixa claro o que falta.
export function substituirVariaveis(bodyText, variables = []) {
  return String(bodyText || '').replace(/\{\{(\d+)\}\}/g, (marcador, numero) => {
    const valor = variables[Number(numero) - 1];
    return valor && valor.trim() ? valor : marcador;
  });
}
