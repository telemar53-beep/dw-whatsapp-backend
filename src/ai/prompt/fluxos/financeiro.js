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
// Nome real de cliente: a despedida citava "Imagina, Willemberg! 😊 ..." nas
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
      'PEDIDO DE PAGAMENTO ("quero pagar", "quero o boleto", "quero o PIX", "quero quitar", "como faço para pagar") tem prioridade sobre qualquer roteiro de diagnóstico: entregue o boleto ou o PIX AGORA (enviar_boleto ou gerar_pix), mesmo com o contrato suspenso — a pendência é justamente o que ele está resolvendo. NUNCA pergunte "você chegou a fazer esse pagamento?" a quem acabou de dizer que quer pagar.',
      config.triageResolvedReasonId
        ? [
          'Identidade JÁ confirmada: NÃO peça CPF. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix. NÃO conclua a triagem nesse momento.',
          'Depois de entregar, responda EXATAMENTE no modelo que a ferramenta devolver no campo instrucao. NUNCA diga que enviou o boleto ou o PIX antes de a ferramenta confirmar o envio (enviado: true): sem essa confirmação, nada chegou ao cliente.',
          'Se depois disso ele agradecer ("obrigado", "valeu"): chame encerrar_atendimento e responda no modelo: "Imagina, [nome]! 😊 Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" (à noite, "Tenha uma boa noite!"). Se responder só "ok", "certo" ou um joinha: chame encerrar_atendimento e responda: "Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" Se pedir outra coisa, siga a triagem normalmente e encerre só quando ele agradecer ou confirmar que está tudo certo. No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji ("Imagina, [nome]! Qualquer dúvida…").',
        ].join('\n')
        : 'Identidade JÁ confirmada: NÃO peça CPF. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix e depois conclua a triagem para o setor da lista acima que cuidar do financeiro.',
    ];
    if (contratos.length > 1) {
      l.push('Pedido de boleto ou PIX com mais de um contrato: chame consultar_faturas_todos_contratos ANTES de perguntar qualquer coisa. Se só um contrato tiver fatura em aberto, entregue dele sem perguntar. Se mais de um tiver, pergunte de uma vez pelo endereço, no modelo: "Claro, vou te ajudar com o PIX 😊 Vi que você tem mais de um contrato com a gente. Para eu te enviar os dados do pagamento certinho, pode me confirmar de qual endereço você precisa?" (cite os endereços se ajudar) e entregue na resposta seguinte. Para BOLETO, o mesmo pedido sem emoji: "Claro, vou te ajudar com o boleto. Vi que você tem mais de um contrato com a gente. Para eu te enviar o boleto certinho, pode me confirmar de qual endereço você precisa?"');
    }
    l.push(
      'Se a ferramenta responder que não há fatura em aberto em nenhum contrato, diga isso em uma frase (sem valores) e chame concluir_triagem para o setor da lista acima que cuidar do financeiro na mesma resposta — não pergunte se ele quer ser encaminhado. Se ela devolver contratosComFatura, pergunte pelo endereço e entregue na resposta seguinte.',
      'Se o cliente suspenso perguntar se a internet volta depois de pagar, responda: "Sim — assim que o pagamento for confirmado, o acesso é liberado automaticamente." NUNCA prometa prazo (minutos, horas, "na hora"), e nunca diga que o pagamento foi confirmado.'
    );
    return l;
  },
};
