// SGP indisponível — DECISÃO DESTA TAREFA (Pendência 1 do despacho): este
// módulo fica com linhas() vazio, de propósito. Não é esqueleto esquecido; é
// a conclusão, verificada, de que não há conteúdo original para migrar aqui
// sem duplicar fatos.js.
//
// ==========================================================================
// POR QUÊ
// ==========================================================================
// A âncora única desta tarefa para este módulo (ai-orchestrator.js:360; o
// brief/plano citava ":418", desatualizado) é:
//
//   `Cliente identificado pela memória (primeiro nome ${nome}), mas o
//   sistema do SGP NÃO respondeu agora. NÃO peça CPF e NÃO tente boleto,
//   PIX nem status de conexão. Cumprimente pelo primeiro nome, diga em uma
//   frase que o sistema de consulta está instável neste momento, e chame
//   concluir_triagem para o setor adequado ao que ele pediu, com o resumo
//   começando por "SGP indisponível na triagem".`
//
// Esse texto JÁ está em fatos.js (Task 12), palavra por palavra, no ramo
// `if (identidade.sgpIndisponivel)` de `linhas()` — conferido linha a linha
// contra o original, idêntico (só o nome de setor, que já não era citado
// aqui, e nenhuma outra diferença). fatos.js entra sempre (`entra() {
// return true; }`) e o próprio ramo `sgpIndisponivel` SUBSTITUI os ramos de
// identidade 'none' e 'forte' (é um if/else if/else — só um dos três roda),
// exatamente o comportamento que o design spec descreve para este módulo:
// "Substitui todos os roteiros que dependeriam do SGP" — descrição do QUE a
// arquitetura já faz em fatos.js, não uma instrução para duplicar em outro
// lugar.
//
// Migrar o mesmo texto de novo aqui faria os dois módulos (fatos.js sempre,
// sgp-indisponivel.js quando sgpIndisponivel) emitirem a MESMA instrução
// duas vezes no prompt montado sempre que sgpIndisponivel for true — mesma
// categoria de duplicação que financeiro.js (Task 16) já evitou para
// "Contrato suspenso por falta de pagamento" (não remigrado por já estar em
// suporte-diagnostico.js) e que identificacao.js (Task 14, ruling do dono)
// resolveu MOVENDO para fora de fatos.js em vez de duplicar. Aqui não há o
// que mover: ao contrário de identificacao.js (que migrou uma INSTRUÇÃO —
// "o que fazer" — que tinha ido parar por engano em fatos.js), o texto de
// sgpIndisponivel É, ele mesmo, ao mesmo tempo o fato ("o SGP não respondeu")
// e a instrução completa para esse caso (não peça CPF, não tente nada,
// cumprimente, avise, encaminhe) — não há uma metade "instrução" limpa para
// separar sem reescrever fatos.js, o que está fora de "O LIMITE" desta
// tarefa (só os seis módulos de fluxos/).
//
// Não inventei conteúdo novo só para o arquivo não ficar vazio — a própria
// instrução desta tarefa proíbe isso explicitamente ("Não invente conteúdo
// para justificar o arquivo").
//
// entra() implementa a interface literal da tarefa
// (`Boolean(estado.identidade.sgpIndisponivel)`) e TEM efeito prático: é o
// que a varredura de montar.test.js usa para garantir que, se algum dia este
// módulo ganhar conteúdo, a guarda de dado operacional (velocidade, preço,
// nome de setor/motivo, oferta) já cobre esse estado — ver
// ESTADOS_PARA_VARREDURA em montar.test.js (o estado de sgpIndisponivel já
// está lá desde a Task 12).
module.exports = {
  nome: 'sgp-indisponivel',
  entra(estado) {
    return Boolean((estado.identidade || {}).sgpIndisponivel);
  },
  linhas() {
    return [];
  },
};
