// Reativação — cliente identificado com mais de 90 dias em atraso (ou
// contrato já cancelado) é roteado para o setor de reativação em vez do
// financeiro; quem pergunta por promoção de volta é encaminhado para lá, sem
// inventar valor. Migração de ai-orchestrator.js — âncora "REATIVAÇÃO:
// cliente com mais de 90 dias em atraso", hoje linha 503 (o brief citava
// 577, desatualizado — o construtor mudou depois de escrito, mesmo padrão já
// avisado pelas Tasks 13-15; localizado por grep de texto-âncora).
//
// entra() só com identidade.nivel === 'forte': só dá para saber há quantos
// dias uma fatura está vencida com o cliente já identificado.
//
// O corte de 90 dias é regra de NEGÓCIO (decisão do dono, 2026-09-17) e por
// isso fica, verbatim — não é dado de operação nem string de UI, é o
// critério de roteamento em si, que a Restrição Global não proíbe.
//
// Nomes de setor (Restrição Global — "o setor da lista acima que cuidar de
// X", mesmo idioma de fatos.js/painel.js/comercial-novo.js/suporte-*.js): o
// texto original manda para "o setor de Reativação (se ele existir na lista
// de setores) — não para o Financeiro", diz "Até 90 dias continua sendo
// Financeiro" e "a Reativação cuida disso". As três citam nome de setor
// fixo. Reescritas por papel, preservando a MESMA regra de fallback que já
// existia em prosa (reativação se houver; senão, financeiro): "o setor que
// cuidar de reativação ou retorno de clientes, se houver um na lista de
// setores acima; se não houver, vá para o que cuidar de financeiro". As duas
// menções seguintes ("Até 90 dias..." e a de promoção) reusam essa mesma
// referência ("o setor da lista acima que cuidar do financeiro" / "esse
// mesmo setor") em vez de repetir a frase inteira duas vezes.
//
// Achado à mão (categoria que a guarda de montar.test.js ainda não cobria,
// mesmo padrão de comercial-novo.js/Task 14 trocando "COMERCIAL" por "VENDA"
// e suporte-diagnostico.js/Task 15 trocando "SUPORTE —" por "RELATO DE
// FALHA"): usar "REATIVAÇÃO:" como RÓTULO desta linha (como o original
// fazia) nomeia o setor em CAIXA ALTA — a guarda é case-sensitive e só pega
// "Reativação" com R maiúsculo e o resto minúsculo, não "REATIVAÇÃO" inteiro
// maiúsculo. Terceira ocorrência do mesmo tipo de escape; esta migração
// estende formalmente a guarda em montar.test.js (categoria "nome de setor
// em CAIXA ALTA") em vez de deixar para uma quarta tarefa redescobrir — ver
// relatório. Aqui o rótulo virou "MAIS DE 90 DIAS EM ATRASO OU CONTRATO JÁ
// CANCELADO" (a situação, não o setor de destino).
module.exports = {
  nome: 'reativacao',
  entra(estado) {
    return (estado.identidade || {}).nivel === 'forte';
  },
  linhas() {
    return [
      '',
      'MAIS DE 90 DIAS EM ATRASO OU CONTRATO JÁ CANCELADO: cliente cuja fatura mais antiga venceu há mais de 90 dias (conte pela data de hoje), ou com o contrato já cancelado, vai para o setor que cuidar de reativação ou retorno de clientes, se houver um na lista de setores acima; se não houver, vá para o que cuidar de financeiro. Até 90 dias continua sendo o setor da lista acima que cuidar do financeiro. Se ele perguntar por promoção, condição especial ou desconto para voltar, diga que esse mesmo setor cuida disso e encaminhe; nunca invente promoção, desconto ou valor, e nunca diga que "não trabalha com promoções".',
    ];
  },
};
