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

// Quantas variáveis o corpo tem, contando pelo MAIOR número usado e não pela
// quantidade de marcadores: {{1}} repetido três vezes é uma variável só, e é
// assim que o backend conta (extractVariableCount). Se as duas contas
// divergissem, o formulário pediria um número de exemplos que a criação recusa.
export function contarVariaveis(bodyText) {
  const numeros = [...String(bodyText || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return numeros.length === 0 ? 0 : Math.max(...numeros);
}
