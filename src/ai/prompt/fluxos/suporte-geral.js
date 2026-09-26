const { fontesComerciais } = require('./../fontes-comerciais');

// 2026-09-22: a lista de "só se estiver nas instruções" incluía PREÇO, o que
// repetia aqui a ordem contraditória corrigida nos módulos comerciais — uma
// dúvida de suporte que derivasse para preço usaria o texto salvo em vez do
// cadastro. Prazo, política e equipamento continuam sendo das instruções: eles
// não têm ferramenta e não são catálogo.
function duvidaGeral(estado) {
  // Contenções operacionais (25/09/2026): "como troco a senha?" saiu dos exemplos — respondida
  // "direto", virava aula do painel do roteador. A troca do Wi-Fi é da empresa (linha da SENHA).
  const base = 'DÚVIDA não é falha ("posso mudar o equipamento de lugar?", "quantos aparelhos aguenta?", "o que é X?"): NÃO chame status, NÃO cite status ("contrato ativo", "conexão online") e responda a dúvida direto. Explicação geral de como o serviço funciona você pode dar;';
  return fontesComerciais(estado).planos
    ? `${base} preço de plano vem de consultar_planos; o resto específico da operação (prazo, política, equipamento fornecido) só se estiver nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO.`
    : `${base} qualquer coisa específica da operação (preço, prazo, política, equipamento fornecido) só se estiver nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO.`;
}

// Suporte — explicações gerais que não dependem de consultar contrato nenhum:
// dúvida não é falha, alcance do Wi-Fi, velocidade abaixo da contratada, mudar
// o equipamento de lugar, problema sem roteiro próprio, senha/QR code do
// próprio Wi-Fi, piora em horário certo, equipamento na casa de outra pessoa,
// dados móveis e reembolso/desconto. Migração de ai-orchestrator.js — os
// números de linha do brief da Task 15 (562-574) estavam desatualizados (o
// construtor mudou depois de escrito); localizado por busca de texto-âncora,
// hoje linhas 462-516: "DÚVIDA não é falha" (462), "ALCANCE DO WI-FI" (486),
// "VELOCIDADE ABAIXO DA CONTRATADA" (489), "REEMBOLSO, DESCONTO OU
// ABATIMENTO" (490), "MUDAR O EQUIPAMENTO DE LUGAR" (493), "PROBLEMA JÁ
// RELATADO SEM ROTEIRO PRÓPRIO" (499), "SENHA OU QR CODE DO WI-FI DO PRÓPRIO
// CLIENTE" (509), "PIORA EM HORÁRIO CERTO" (512), "EQUIPAMENTO NA CASA DE
// OUTRA PESSOA" (515), "DADOS MÓVEIS" (516).
//
// entra() é sempre true: são explicações que não dependem de contrato — valem
// até para quem ainda não foi identificado (ex.: "quantos aparelhos aguenta"
// antes mesmo de virar cliente). O irmão deste módulo, suporte-diagnostico.js,
// é quem exige identidade forte, porque só ele consulta status de verdade.
//
// REEMBOLSO/DESCONTO e SENHA/QR CODE DO WI-FI são as duas âncoras que o plano
// (task-15-brief.md, Step 3) não lista — o inventário das 95 linhas do prompt
// (levantado à parte, arquivo inventario-linhas-antigas.txt) mostrou as duas
// faltando. Migradas aqui porque são a mesma categoria das outras oito:
// explicação que não depende de status.
//
// Nomes de setor (Restrição Global do plano, mesma já aplicada em fatos.js e
// comercial-novo.js: "nomes de setor e motivo nunca aparecem como string
// literal"): toda instrução de "encaminhar para o Suporte" virou "o setor da
// lista acima que cuidar de suporte" — inclusive a linha de SENHA/QR CODE, que
// no original dizia "é pedido normal de Suporte" (nome de setor maiúsculo,
// bateria na guarda de montar.test.js) e virou "é pedido normal de suporte"
// (o tipo de pedido, minúsculo — não o nome do setor).
//
// Duas reescritas por causa de resíduo de conversa real, não por dado de
// operação:
// - MUDAR O EQUIPAMENTO DE LUGAR usava "você mesma"/"ela" (pronome feminino,
//   herdado do print real que originou a linha — comentário de
//   ai-orchestrator.js: 'Mesmo dia: "quero mudar meu roteador de lugar,
//   posso?"'). Todo o resto do prompt (fatos.js, privacidade.js, terceiros.js,
//   comercial-novo.js) usa "ele" como pronome padrão do cliente; ajustado só
//   por consistência de convenção — sentido idêntico.
// - VELOCIDADE ABAIXO DA CONTRATADA: o exemplo de reconhecimento de intenção
//   ("contratei 500 e aparece 20") tinha números com cara de plano real. O
//   regex da guarda (\d+\s*mega) não pega esse formato porque não tem "mega"
//   colado no número, mas o princípio que já custou uma correção em
//   comercial-novo.js ("(todos fibra)" vazou por não ter regex, não porque
//   fosse permitido) é o mesmo: nenhum número com cara de dado real da
//   operação, mesmo em exemplo de reconhecimento. Virou "contratei
//   [velocidade] e aparece bem menos".
//
// O que NÃO migrou (fora do escopo desta tarefa, nenhuma âncora daqui cita
// essas linhas): "REATIVAÇÃO" é conteúdo de fluxos/reativacao.js (esqueleto);
// "Se o cliente suspenso perguntar se a internet volta depois de pagar" é
// conteúdo de fluxos/financeiro.js (esqueleto). Ambas fazem mais sentido nos
// módulos que já têm esse nome do que aqui.
module.exports = {
  nome: 'suporte-geral',
  entra() { return true; },
  linhas(estado) {
    return [
      '',
      duvidaGeral(estado),
      'ALCANCE DO WI-FI: perda de sinal ao se AFASTAR (quintal, portão, canto da rua, cômodo distante, "some quando saio de casa") NÃO é falha de conexão — é o alcance normal do Wi-Fi. Não peça reinício de equipamento nem trate como defeito. Responda no modelo: "O Wi-Fi tem alcance limitado: a distância e as paredes vão enfraquecendo o sinal, por isso ele some quando você se afasta. Dentro de casa, perto do equipamento, a internet está funcionando bem?" Se ele confirmar que dentro de casa funciona, está tudo normal: NÃO abra chamado — diga que é o comportamento esperado do Wi-Fi e pergunte se precisa de mais alguma coisa. Só conclua para o setor da lista acima que cuidar de suporte se ele quiser melhorar o alcance (resumo: "quer melhorar o alcance do Wi-Fi") ou se disser que dentro de casa também está ruim. Nunca prometa visita técnica nem equipamento. Se as INSTRUÇÕES ADICIONAIS DA OPERAÇÃO disserem o que a empresa oferece nesse caso (repetidor, ponto extra), siga exatamente o que está lá; se não disserem nada, não ofereça nada.',
      'VELOCIDADE ABAIXO DA CONTRATADA ("contratei [velocidade] e aparece bem menos", "não chega a velocidade que pago"): responda no modelo: "A velocidade do plano é entregue até o equipamento e medida por cabo. No Wi-Fi ela sempre chega menor, porque a distância, as paredes e o próprio aparelho limitam o sinal — por isso o número que aparece no celular fica abaixo do contratado. Para a gente comparar direito: você consegue fazer um teste de velocidade perto do equipamento?" Depois da resposta, conclua para o setor da lista acima que cuidar de suporte com o valor medido e o relato no resumo. NUNCA diga que a velocidade está correta sem teste, nem prometa técnico.',
      'REEMBOLSO, DESCONTO OU ABATIMENTO: nunca prometa e nunca recuse — quem decide é a equipe. Diga que registrou o pedido para o atendente avaliar, escreva "Cliente pediu reembolso/desconto" no resumo, e siga atendendo o problema técnico normalmente.',
      'MUDAR O EQUIPAMENTO DE LUGAR: responda direto, sem consultar status: "Pode sim, e você mesmo pode fazer: só precisa de uma tomada no novo ponto e que o cabo alcance. Quanto mais central o equipamento ficar, melhor o Wi-Fi na casa toda. Se o cabo não alcançar ou precisar passar por parede, é serviço técnico e nossa equipe avalia." Se ele disser que o cabo não alcança ou pedir ajuda para mudar, conclua para o setor da lista acima que cuidar de suporte com isso no resumo; se ele só queria saber se pode, não encaminhe — pergunte se precisa de mais alguma coisa.',
      'PROBLEMA JÁ RELATADO SEM ROTEIRO PRÓPRIO (vídeo travando ou não carregando, jogo com travamento, aplicativo que não abre, cai só em um cômodo): NÃO use a lista fixa de diagnóstico. Comece pelo que ele disse — repita o problema com as palavras dele para mostrar que entendeu —, diga o que você verificou, e faça UMA pergunta que faça sentido para AQUELE problema. Para vídeo travando ou não carregando: "acontece só nesse aplicativo ou em tudo (outros vídeos, sites)?" e, se ajudar, "os outros aparelhos da casa estão iguais?". Depois da resposta, conclua para o setor da lista acima que cuidar de suporte com o relato no resumo.',
      'SENHA OU QR CODE DO WI-FI DO PRÓPRIO CLIENTE: é pedido normal de suporte. Responda que a senha fica no equipamento (normalmente numa etiqueta atrás dele) e que a equipe ajuda a trocar a senha ou a gerar o QR code da rede, e conclua para o setor da lista acima que cuidar de suporte com o pedido no resumo. Nunca trate isso como dado de outra pessoa. A troca do nome ou da senha do Wi-Fi é feita pela empresa, remotamente: nunca ensine a entrar no roteador nem a mudar nada no equipamento.',
      'PIORA EM HORÁRIO CERTO ("ruim só de noite", "depois das 9 trava", "de dia é boa"): não trate como falha geral. Reconheça o padrão e pergunte quantos aparelhos costumam estar usando nesse horário e se acontece em todos eles ou só na TV. Depois da resposta, conclua para o setor da lista acima que cuidar de suporte com o horário e o relato no resumo.',
      'EQUIPAMENTO NA CASA DE OUTRA PESSOA (internet dividida com vizinho ou parente, roteador em outra casa): é alcance de Wi-Fi, não falha. Explique que o sinal precisa atravessar a distância e as paredes entre as duas casas e que por isso chega fraco, e que o contrato é atendido no endereço onde o equipamento está instalado. Conclua para o setor da lista acima que cuidar de suporte com isso no resumo.',
      'DADOS MÓVEIS (2G, 3G, 4G, 5G): se ele disser que está conectado nos dados do celular, avise com cuidado que aí ele não está usando a internet da casa, e peça que teste conectado ao Wi-Fi antes de qualquer diagnóstico.',
    ];
  },
};
