// Financeiro — cliente identificado que pede boleto ou PIX: prioridade sobre
// diagnóstico, entrega por ferramenta, o que dizer depois que ele agradece,
// o caso de mais de um contrato, quando a ferramenta não acha fatura em
// aberto, e a pergunta se a internet volta depois de pagar. Migração de
// ai-orchestrator.js — âncoras (números reais, conferidos por grep; os do
// brief e da tarefa já vinham desatualizados, mesmo padrão avisado pelas
// Tasks 13-15):
// - "Identidade JÁ confirmada: NÃO peça CPF" — linhas 388 e 397 (as duas
//   metades do ternário por config.triageResolvedReasonId: com motivo de
//   encerramento configurado a IA entrega e pode fechar sozinha; sem motivo,
//   entrega e sempre encaminha).
// - "Se depois disso ele agradecer" — linha 395 (dentro do bloco acima).
// - "Pedido de boleto ou PIX com mais de um contrato" — linha 399.
// - "Se a ferramenta responder que não há fatura em aberto" — linha 404.
// - "PEDIDO DE PAGAMENTO" (prioridade sobre diagnóstico) — linha 457.
// - "Se o cliente suspenso perguntar se a internet volta depois de pagar" —
//   linha 506.
//
// entra() só com identidade.nivel === 'forte': entregar boleto/PIX exige
// saber QUAL contrato — sem identidade não há o que consultar.
//
// O que NÃO migrou aqui, de propósito:
// - "Contrato suspenso por falta de pagamento, só quando ele RELATAR falta
//   de acesso" (linha 481) — já migrado para fluxos/suporte-diagnostico.js
//   na Task 15 (é o roteiro de STATUS de conexão, não pedido espontâneo de
//   pagamento). Migrar de novo aqui duplicaria a instrução toda vez que
//   identidade for forte.
// - "COMPROVANTE" / "COMPROVANTE À NOITE" / "COMPROVANTE DE CLIENTE NÃO
//   IDENTIFICADO" (linhas 342, 439-444) — conteúdo de fluxos/comprovante.js,
//   ainda esqueleto, fora do escopo desta tarefa.
// "Pedido de boleto ou PIX com mais de um contrato" tem um módulo-irmão de
// nome sugestivo (fluxos/multiplos-contratos.js), também esqueleto hoje —
// mas a lista de âncoras desta tarefa aponta esse texto para financeiro.js
// explicitamente, então ficou aqui (ver preocupação no relatório).
//
// Nomes de setor (Restrição Global do plano — "o setor da lista acima que
// cuidar de X", mesmo idioma já usado em fatos.js/painel.js/comercial-novo.js/
// suporte-*.js): "conclua a triagem para o Financeiro" virou "conclua a
// triagem para o setor da lista acima que cuidar do financeiro" (sempre
// minúsculo — é o assunto, não o nome do setor).
//
// Nome real de cliente: a despedida citava "Imagina, [nome]! 😊 ..." nas
// duas variantes (com emoji, do fluxo geral do PIX/boleto por ferramenta, e
// sem emoji, do fluxo do BOLETO). As duas viraram "Imagina, [nome]! ...":
// marcador, nunca nome real. Guarda dedicada em financeiro.test.js.
//
// Por que a despedida entre aspas NÃO é "roteiro engessado novo": ela é um
// "modelo de frase" no sentido que principios.js já define ("Os exemplos de
// frase são base para adaptar, nunca texto para colar") — o mesmo padrão que
// toda migração anterior preservou (ex.: ALCANCE DO WI-FI e MUDAR O
// EQUIPAMENTO DE LUGAR em suporte-geral.js). O que a Task 15 baniu foi o
// bloco "EXATAMENTE" que MANDAVA reproduzir uma pergunta já proibida quatro
// linhas antes — não há conflito equivalente aqui.
// A linha "Depois de entregar, responda EXATAMENTE no modelo que a
// ferramenta devolver no campo instrucao" É a exceção legítima de "texto que
// uma ferramenta devolve depois de executar" (princípio desta fase): aqui
// "EXATAMENTE" se refere ao RETORNO DINÂMICO da ferramenta, não a um texto
// fixo do prompt — é a proteção que já existia no original contra o teste
// real de 2026-09-15 em que o modelo copiou um exemplo de frase do próprio
// prompt sem chamar a ferramenta, e o cliente não recebeu nada.
//
// Reordenação: "PEDIDO DE PAGAMENTO" (linha 457 no original, depois de todo o
// bloco de entrega) abre o módulo aqui — é o ponto mais importante desta
// tarefa ("pedido de pagamento tem prioridade sobre diagnóstico") e não
// depende de nada declarado depois. Mesma reordenação inerente à
// modularização que toda tarefa anterior já documentou.
//
// Rodada de correção 1 da Task 17 (coordenador, 2026-09-18): entra() ganhou
// `&& !identidade.sgpIndisponivel`, mesma correção já aplicada a
// suporte-diagnostico.js (Pendência 2 original daquela tarefa) e agora
// estendida aqui por autorização explícita — com o SGP fora do ar, fatos.js
// manda não tentar boleto, PIX nem status; este módulo entrega boleto/PIX
// por ferramenta e conclui para o financeiro, exatamente o que a proibição
// veta. A Task 16 já tinha registrado esta mesma contradição como
// preocupação (item 2 do relatório daquela tarefa) sem corrigir por falta
// de autorização; a Task 17 corrige agora.
module.exports = {
  nome: 'financeiro',
  entra(estado) {
    const identidade = estado.identidade || {};
    return identidade.nivel === 'forte' && !identidade.sgpIndisponivel;
  },
  linhas(estado) {
    const config = estado.config || {};
    const contratos = estado.contratos || [];
    const l = [
      '',
      // Conclusão do atendimento (04/10/2026, decisão do proprietário): o pedido genérico continua o meio já escolhido; sem
      // escolha, uma pergunta curta — antes, o modelo escolhia sozinho entre boleto e PIX.
      // Reavaliação r2 (04/10/2026): a versão imperativa desta regra não fez o modelo perguntar (E3, 0/3) e regrediu "como eu
      // pago?" sem meio disponível (E6 #6). Fica a redação avaliada na rodada inicial; a pergunta curta no pedido genérico
      // sem escolha continua sem garantia (pendência registrada).
      // Comportamento da IA (06/10/2026; A7): a pergunta valia mesmo depois de uma resposta dizer que um dos meios não
      // existe nesta fatura. E a cobrança não é consulta: enviar_boleto e gerar_pix geram a 2ª via (e, sem código pronto, o
      // PIX) no SGP antes da trava do meio — nada sai ao cliente, mas o documento é gerado. 06/10 (A6/A7): a escolha passou
      // a ser conferida antes da 2ª via, e a pergunta não afirma que os dois meios existem (sem 2ª via, nada se sabe).
      'PEDIDO DE PAGAMENTO ("quero pagar", "quero o boleto", "quero o PIX", "quero quitar", "como faço para pagar") tem prioridade sobre qualquer roteiro de diagnóstico, mesmo com o contrato suspenso — a pendência é justamente o que ele está resolvendo. Se ele disse o meio (boleto ou PIX), entregue esse meio AGORA (enviar_boleto ou gerar_pix). Num pedido genérico de pagamento ("quero pagar", "manda pra eu pagar"), continue com o meio já escolhido nesta conversa para esta mesma fatura (o que ele pediu ou recebeu antes; o meio usado em outra fatura não conta); se nenhum foi escolhido, pergunte por qual meio ele quer pagar sem afirmar que os dois estão disponíveis (só se sabe gerando o documento, depois da escolha): "Você quer pagar por boleto ou por PIX? Assim que você escolher, eu vejo se ele está disponível para esta fatura." — sem meio escolhido, nada é pedido ao sistema nem entregue. Se ainda não há meio escolhido e uma resposta desta conversa já disse que esta fatura não tem um dos meios, não o ofereça: pergunte só se pode enviar o outro, ou, sem nenhum dos dois, diga que não há outra forma de pagamento por aqui agora. O meio que uma resposta desta conversa já disse que não existe nesta fatura não conta como escolhido: não chame a ferramenta dele de novo, salvo se ele pedir esse meio nesta mensagem. Não chame enviar_boleto nem gerar_pix só para descobrir quais meios existem: chame com o meio escolhido (pedido por ele, aceito numa oferta sua ou já recebido para esta fatura). NUNCA pergunte "você chegou a fazer esse pagamento?" a quem acabou de dizer que quer pagar.',
      config.triageResolvedReasonId
        ? [
          'Identidade JÁ confirmada: NÃO peça CPF. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix. NÃO conclua a triagem nesse momento.',
          'Depois de entregar, responda EXATAMENTE no modelo que a ferramenta devolver no campo instrucao. NUNCA diga que enviou o boleto ou o PIX antes de a ferramenta confirmar o envio (enviado: true): sem essa confirmação, nada chegou ao cliente.',
          'Se depois disso ele agradecer ("obrigado", "valeu"): chame encerrar_atendimento e responda no modelo: "Imagina, [nome]! 😊 Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" (à noite, "Tenha uma boa noite!"). Se responder só "ok", "certo" ou um joinha: chame encerrar_atendimento e responda: "Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" Se pedir outra coisa, siga a triagem normalmente e encerre só quando ele agradecer ou confirmar que está tudo certo. No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji ("Imagina, [nome]! Qualquer dúvida…").',
        ].join('\n')
        : 'Identidade JÁ confirmada: NÃO peça CPF. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix e depois conclua a triagem para o setor da lista acima que cuidar do financeiro.',
    ];
    // Rodada 9 (N5): com o contrato já escolhido pela rua (estado confirmado; fluxos/alvo-financeiro.js), esta regra mandava
    // consultar todos e perguntar o endereço de novo — a ordem contrária à do código.
    const jaEscolhido = Boolean(estado.alvoFinanceiro && estado.alvoFinanceiro.alvo === 'titular'
      && Array.isArray(estado.alvoFinanceiro.escolhidos) && estado.alvoFinanceiro.escolhidos.length > 0);
    if (contratos.length > 1 && !jaEscolhido) {
      l.push('Pedido de boleto ou PIX com mais de um contrato: chame consultar_faturas_todos_contratos ANTES de perguntar qualquer coisa. Se só um contrato tiver fatura em aberto, entregue dele sem perguntar. Se mais de um tiver, pergunte de uma vez pelo endereço, no modelo: "Claro, vou te ajudar com o PIX 😊 Vi que você tem mais de um contrato com a gente. Para eu te enviar os dados do pagamento certinho, pode me confirmar de qual endereço você precisa?" (cite os endereços se ajudar) e entregue na resposta seguinte. Para BOLETO, o mesmo pedido sem emoji: "Claro, vou te ajudar com o boleto. Vi que você tem mais de um contrato com a gente. Para eu te enviar o boleto certinho, pode me confirmar de qual endereço você precisa?"');
    }
    l.push(
      'Se a ferramenta responder que não há fatura em aberto em nenhum contrato, diga isso em uma frase (sem valores) e chame concluir_triagem para o setor da lista acima que cuidar do financeiro na mesma resposta — não pergunte se ele quer ser encaminhado. Se ela devolver contratosComFatura, pergunte pelo endereço e entregue na resposta seguinte.',
      'Qual fatura pode ser enviada é decisão do sistema, não sua: se enviar_boleto ou gerar_pix responder que NÃO houve envio (mais de uma fatura vencida, contrato cancelado ou situação não confirmada), siga a instrucao dela — não escolha outra fatura, não negocie e não tente outro contrato por conta própria.',
      'Se o cliente suspenso perguntar se a internet volta depois de pagar, NÃO prometa que ela volta sozinha nem dê prazo (minutos, horas, "na hora"): responda algo como "Não consigo garantir que o acesso volta sozinho depois do pagamento. Quando quiser, eu confiro o pagamento por aqui." Pagamento confirmado sozinho não é liberação, e comprovante válido também não.',
      'Se o cliente disser que já pagou ou perguntar se o pagamento caiu, chame conferir_pagamento: só ela confirma um pagamento. Comprovante, "já paguei" ou aviso do banco NÃO confirmam. Só diga que a internet foi liberada se conferir_pagamento disser que o contrato está ativo ou se o desbloqueio em confiança tiver liberado — e nem assim diga que ela está conectada ou online.',
      'Boleto pago com comprovante válido e o pagamento ainda não baixado no sistema: o desbloqueio em confiança, quando disponível, segue as regras dele e não espera a baixa. Se ele liberar, diga que o acesso foi liberado em confiança enquanto o pagamento é processado — nunca que o pagamento foi confirmado.'
    );
    return l;
  },
};
