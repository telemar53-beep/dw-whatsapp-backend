// Terceiros: a exceção de FATURA, BOLETO OU PIX de outra pessoa — pedir o
// boleto do marido, da esposa, de um parente é atendimento normal, não
// interrogatório. Migração de ai-orchestrator.js — texto-âncora "Se ele citar
// o NOME de outra pessoa" / "FATURA, BOLETO OU PIX DE OUTRA PESSOA é a
// exceção" (hoje linhas 430-431; os números do brief, 504-505, estavam
// desatualizados). Vale em QUALQUER estado de identidade, por isso entra()
// já é true.
//
// Nomes reais trocados por marcador: o original usa "a fatura da cliente
// Laureny" e "quero a fatura do Jureildson" como exemplo — pessoas reais
// versionadas no repositório. ai-orchestrator.js já documenta (comentário nas
// linhas 427-429) um caso real em que o modelo copiou um exemplo assim ao pé
// da letra ("Laureny, seu atendimento vai para o Financeiro", chamando quem
// falava pelo nome do titular). Os exemplos abaixo usam [nome] no lugar.
//
// CONTEÚDO NOVO desta tarefa (não é migração): o parágrafo de "pode/não
// pode" e o de expiração. Renderizando o prompt atual (ai-orchestrator.js)
// com e sem terceiro preenchido, os dois cenários saem IDÊNTICOS — o
// construtor antigo nunca informa o modelo sobre o escopo de um contrato
// alheio antes de ele tentar agir; a recusa só existe hoje em tempo de
// execução, como resultado de ferramenta (INSTRUCAO_TERCEIRO em
// tool-executor.js, e a instrução que buscar_cliente devolve com
// titularEOutraPessoa em tool-registry.js). FERRAMENTAS_PERMITIDAS_EM_TERCEIRO
// (tool-registry.js) é a lista fechada real por trás de "consultar a fatura e
// entregar o boleto ou o PIX": consultar_faturas, enviar_boleto, gerar_pix,
// gerar_segunda_via. Tudo mais que existe como ferramenta (status de
// contrato/conexão, plano, financeiro, desbloqueio em confiança, e as versões
// "_todos_contratos") é recusado para o contrato de um terceiro. A linha de
// expiração reflete o TTL real de 30 minutos por conversa (MINUTOS_DE_VIDA em
// third-party-scope.js, checado a cada turno por escopoValido() em
// ai-worker.js) — sem citar o número, só o limite.
//
// Escrito como objetivo e limite, não como roteiro: nenhuma frase nova de
// "responda exatamente" foi inventada aqui — só o que já existia no original
// (a recusa migrada em privacidade.js) mantém o "no modelo:". O princípio da
// fase é reservar frase fixa nova para texto que uma ferramenta devolve
// depois de executar de verdade.
//
// Cuidado ao editar: NÃO escreva "parentesco", "nascimento" nem "nome da
// mãe" em nenhuma linha abaixo — o teste deste módulo e a guarda de
// montar.test.js reprovam qualquer ocorrência da palavra, mesmo dentro de uma
// proibição ("nunca peça parentesco" já reprova). Por isso a restrição de
// dado abaixo é um "nem qualquer outro dado" genérico, não uma lista que
// nomeia parentesco.
//
// Rodada de correção 1 da Task 20 (execução real com a OpenAI, 2026-09-18):
// o módulo passou a receber `estado` por causa da ÚLTIMA linha, a do
// desfecho da entrega. O defeito medido: no roteiro 14 (boleto da esposa) o
// modelo entregou o boleto e chamou concluir_triagem no mesmo turno, e a
// conversa saiu da triagem. A instrução que evitaria isso existe, mas mora em
// fluxos/financeiro.js (ramo config.triageResolvedReasonId, "NÃO conclua a
// triagem nesse momento") — e financeiro.entra() é false com
// identidade.nivel === 'none', que é EXATAMENTE o estado do fluxo de
// terceiro: titularEOutraPessoa preenche contexto.terceiro e NUNCA
// contexto.contracts, de propósito (decisão de segurança da Fase 2). Duas
// decisões certas deixando um buraco entre elas.
// O conserto é trazer SÓ ESSA instrução para cá, que entra em qualquer
// estado — não fazer o financeiro inteiro entrar. Nada aqui eleva a
// identidade de quem fala, nada mexe na allowlist de ferramentas
// (FERRAMENTAS_PERMITIDAS_EM_TERCEIRO segue com as mesmas quatro) e nenhuma
// instrução destinada ao TITULAR entra junto: a linha fala do fluxo de quem
// PEDIU, e por isso diz "quem está falando", não "o cliente" (que aqui seria
// ambíguo).
// Conferido no código, não suposto: encerrar_atendimento é
// isentoDeProprietario (tool-registry.js:1448), então a allowlist de terceiro
// — que só governa ferramentas com chaveProprietario (tool-executor.js:128) —
// não o recusa; enviar_boleto/gerar_pix gravam markTriageResolvedByAi
// (tool-registry.js:829 e 1286), que é a trava que ele exige; e ele já trata
// contexto.terceiro, limpando o escopo antes de fechar. A linha nova manda
// fazer algo que a produção já sabe executar neste estado.
// Sem motivo de encerramento configurado a linha não entra: aí encerrar pela
// IA nem existe (a ferramenta devolve "Encerramento pela IA não está
// configurado") e o comportamento atual, concluir a triagem, continua certo.
module.exports = {
  nome: 'terceiros',
  entra() { return true; },
  linhas(estado) {
    const config = (estado && estado.config) || {};
    const l = [
      '',
      'FATURA, BOLETO OU PIX DE OUTRA PESSOA é atendimento normal, não interrogatório: se ele disser que é de outra pessoa ("quero a fatura do meu marido", "a fatura da cliente [nome]", "quero a fatura do [nome]"), peça APENAS o CPF ou CNPJ do titular e chame buscar_cliente com titularEOutraPessoa: true. Não peça mais nada além disso — nem endereço, nem telefone, nem qualquer outro dado sobre o titular ou sobre quem está falando.',
      'Com o contrato do titular localizado, você pode consultar a fatura e entregar o boleto ou o PIX dele. Plano, conexão, status do contrato, situação financeira e liberação ou desbloqueio desse contrato NÃO podem ser consultados nem executados: se ele pedir qualquer uma dessas coisas, diga que só o titular consegue resolver isso.',
      'Se ele citar o NOME de outra pessoa junto com o pedido, isso também é pedido de terceiro: passe titularEOutraPessoa: true. NUNCA diga "seu contrato" nem "sua fatura" nesse caso — diga que localizou o contrato no CPF ou CNPJ informado e, ao entregar, diga de quem é (o boleto ou o PIX). Continue chamando quem está falando pelo próprio nome dele, nunca pelo nome do titular.',
      'Essa autorização vale só por um tempo e só para esta conversa: se ela expirar, peça o CPF ou CNPJ do titular de novo antes de continuar — não assuma que ele já foi informado antes.',
    ];
    if (config.triageResolvedReasonId) {
      l.push('Depois de entregar o boleto ou o PIX do titular, NÃO conclua a triagem nesse momento: espere quem está falando confirmar ou agradecer e então chame encerrar_atendimento. Se ele pedir outra coisa, siga a triagem normalmente.');
    }
    return l;
  },
};
