// Privacidade: recusa de dado de OUTRA pessoa (senha do Wi-Fi, dado
// cadastral, endereço...) e a ressalva de que relatar o problema do vizinho
// não é pedido de dado. Migração literal de ai-orchestrator.js — texto-âncora
// "A recusa abaixo vale só quando ele PEDIR" / "DADOS DE OUTRA PESSOA"; os
// números de linha do brief da Task 13 (497-503) estavam desatualizados por
// deslocamento das fases anteriores, achei o bloco por busca de texto (hoje
// linhas 422-423). Vale em QUALQUER estado de identidade — mesmo sem
// identificação, ninguém tem dado de outra pessoa entregue —, por isso
// entra() já é true.
//
// A exceção de FATURA, BOLETO OU PIX de outra pessoa NÃO está aqui: é
// conteúdo de fluxos/terceiros.js, que entra logo em seguida no compositor
// (montar.js) — a ordem preserva a leitura do original, recusa geral antes
// da exceção.
//
// Divergência mecânica com o brief, anotada no relatório da Task 13: o Step 3
// pedia trocar "Suporte"/"Financeiro" literais por referência de papel neste
// bloco, mas o texto atual de ai-orchestrator.js (o que existe de verdade
// hoje, linhas 422-423) não nomeia setor nenhum aqui — não havia nada para
// trocar. Os dois nomes reais de cliente do brief ("Laureny", "Jureildson")
// também não aparecem neste bloco: eles são do texto que foi para
// fluxos/terceiros.js.
module.exports = {
  nome: 'privacidade',
  entra() { return true; },
  linhas() {
    return [
      '',
      'A recusa abaixo vale só quando ele PEDIR um dado de outra pessoa. Relatar problema do vizinho ("o roteador dele está com luz vermelha", "ele me pediu para falar com vocês") NÃO é pedido de dado: atenda o relato normalmente. E a senha da rede DELE mesmo, do contrato dele, é pedido legítimo — nunca recuse.',
      'DADOS DE OUTRA PESSOA: senha do Wi-Fi, dados cadastrais, endereço ou informação de vizinho, parente ou outro cliente NUNCA são passados e NUNCA viram chamado — não encaminhe nem diga que a equipe vai ver. Recuse na hora, no modelo: "Não consigo passar dados de outro cliente, nem a senha da rede dele — só o titular pode informar isso. Posso te ajudar com alguma coisa do seu contrato?" Se ele insistir em falar com um atendente, conclua com o resumo começando por "Pedido de dado de outra pessoa; recusado na triagem".',
    ];
  },
};
