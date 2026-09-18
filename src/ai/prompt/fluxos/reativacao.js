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
// setores acima; se não houver, vá para o que cuidar de financeiro".
//
// Rodada de correção 1 (revisão do coordenador, 2026-09-18): a 3ª oração
// ("a Reativação cuida disso") tinha virado "esse mesmo setor cuida disso"
// — um pronome com DOIS candidatos a antecedente na frase anterior imediata
// ("o setor que cuidar de reativação..." e "o setor da lista acima que
// cuidar do financeiro", este último mais perto). O sentido pretendido
// (reativação, não o financeiro do "até 90 dias") continuava recuperável
// pelo contexto, mas é uma ambiguidade que NÃO existia no original — lá o
// nome do setor desambiguava por repetição, e a genericização por papel
// tirou essa âncora sem repor outra. Corrigido repetindo a referência por
// extenso ("o setor que cuidar de reativação ou retorno de clientes é quem
// trata disso e encaminhe para ele") em vez de um pronome solto apontando
// para trás. O "ele" final é seguro: só há UM candidato a setor na frase
// que o contém.
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
//
// Rodada de correção 1 da Task 17 (coordenador, 2026-09-18): entra() ganhou
// `&& !identidade.sgpIndisponivel`, mesma correção já aplicada a
// suporte-diagnostico.js e agora estendida aqui por autorização explícita —
// com o SGP fora do ar não há como saber há quantos dias uma fatura está
// vencida (precisa de consulta ao SGP), então o roteamento por "mais de 90
// dias" não tem como ser decidido; fatos.js já instrui a encaminhar direto
// nesse estado, sem tentar apurar nada.
module.exports = {
  nome: 'reativacao',
  entra(estado) {
    const identidade = estado.identidade || {};
    return identidade.nivel === 'forte' && !identidade.sgpIndisponivel;
  },
  linhas() {
    return [
      '',
      'MAIS DE 90 DIAS EM ATRASO OU CONTRATO JÁ CANCELADO: cliente cuja fatura mais antiga venceu há mais de 90 dias (conte pela data de hoje), ou com o contrato já cancelado, vai para o setor que cuidar de reativação ou retorno de clientes, se houver um na lista de setores acima; se não houver, vá para o que cuidar de financeiro. Até 90 dias continua sendo o setor da lista acima que cuidar do financeiro. Se ele perguntar por promoção, condição especial ou desconto para voltar, diga que o setor que cuidar de reativação ou retorno de clientes é quem trata disso e encaminhe para ele; nunca invente promoção, desconto ou valor, e nunca diga que "não trabalha com promoções".',
    ];
  },
};
