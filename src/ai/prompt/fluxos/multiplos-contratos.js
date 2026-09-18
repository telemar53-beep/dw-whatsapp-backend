// Múltiplos contratos — DECISÃO DESTA TAREFA, pelo mesmo raciocínio que a
// Pendência 1 do despacho pede explicitamente para sgp-indisponivel.js
// (decidir e justificar, sem inventar conteúdo): este módulo também fica com
// linhas() vazio. Não é uma das "quatro pendências" nomeadas pelo despacho,
// mas é a mesma categoria de achado — registrado aqui e no relatório desta
// tarefa como uma quinta constatação, feita por iniciativa própria ao
// localizar a âncora.
//
// ==========================================================================
// POR QUÊ
// ==========================================================================
// A spec (design doc, tabela de módulos) e o plano descrevem este módulo
// como "Desambiguação por endereço" — e a âncora textual correspondente
// (`Se precisar saber de qual ponto ele fala`, `Nunca peça o número do
// contrato`, `Contrato único: use-o sem perguntar`, `Contratos dele:`) EXISTE
// no construtor atual, mas inteira dentro de fatos.js desde a Task 12
// (ai-orchestrator.js:376-380 == fatos.js, ramo
// `if (contratos.length > 0) { ... }`, conferido linha a linha, idêntico —
// só "use-o sem perguntar qual." com "qual" no final, que é o texto ATUAL de
// ai-orchestrator.js, não a variante sem "qual" que aparece no inventário
// congelado de linhas antigas; o código vivo é a fonte de verdade, como as
// Tasks 13-16 já vinham fazendo). fatos.js aplica esse bloco incondicionalmente
// a partir de 1 contrato (`contratos.length > 0`), o que já cobre por completo
// o caso de MAIS de um — inclusive a frase "Contrato único: use-o sem
// perguntar qual." só quando length === 1, ou seja, o próprio bloco já sabe
// diferenciar os dois casos.
//
// financeiro.js (Task 16) já usa a âncora IRMÃ desta ("Pedido de boleto ou
// PIX com mais de um contrato: chame consultar_faturas_todos_contratos...",
// ai-orchestrator.js:399) — essa é a desambiguação por endereço ESPECÍFICA DE
// PAGAMENTO, condicionada a `contratos.length > 1`, e já está no lugar certo
// (Task 16, revisão limpa, e a preocupação registrada no relatório daquela
// tarefa foi FECHADA explicitamente: "a spec dá escopos diferentes aos dois
// módulos... sem ação necessária").
//
// Ou seja: busquei em todo o ai-orchestrator.js (grep, não amostragem) por
// QUALQUER menção a "contrato" fora dessas duas âncoras já migradas (fatos.js
// para o caso geral, financeiro.js para o caso de pagamento) e não achei uma
// terceira. Não há texto original específico de ">1 contrato" sobrando fora
// dos dois lugares onde ele já está.
//
// Por que não movi o conteúdo de fatos.js para cá (o mesmo padrão que a Task
// 14 aplicou para identificacao.js, movendo instrução que tinha ido parar em
// fatos.js por engano): fatos.js é um módulo de tarefa anterior, já revisado
// e aprovado por múltiplas rodadas, e "O LIMITE" desta tarefa é explícito —
// "Preencha os seis módulos em src/ai/prompt/fluxos/" — sem autorizar tocar
// fatos.js. Diferente da sgp-indisponivel (onde não sobrava uma "instrução"
// limpa para extrair), aqui SOBRARIA uma extração limpa (as três frases de
// instrução, mantendo só "Contratos dele:" + a listagem como fato em
// fatos.js) — mas fazer essa cirurgia em fatos.js está fora do escopo
// autorizado desta tarefa. Registro a recomendação no relatório para uma
// rodada de ruling futura, no mesmo espírito do achado que a Task 12 deixou
// registrado para esta própria tarefa (Pendência 1).
//
// Não inventei conteúdo novo só para o arquivo não ficar vazio (mesma
// instrução explícita do despacho para sgp-indisponivel.js, aplicada aqui
// pela mesma razão).
//
// entra() implementa a interface literal da tarefa
// (`estado.contratos.length > 1`) e mantém efeito prático na varredura de
// montar.test.js (o estado de 2 contratos já está em ESTADOS_PARA_VARREDURA
// desde a Task 12/14).
module.exports = {
  nome: 'multiplos-contratos',
  entra(estado) {
    return (estado.contratos || []).length > 1;
  },
  linhas() {
    return [];
  },
};
