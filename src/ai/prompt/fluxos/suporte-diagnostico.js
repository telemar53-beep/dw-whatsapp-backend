// Suporte — diagnóstico de falha com cliente identificado: consulta o status
// do contrato e da conexão, segue por um dos três casos (online / offline /
// suspenso) e interpreta a resposta do cliente à pergunta de diagnóstico.
// Migração de ai-orchestrator.js — os números de linha do brief da Task 15
// (553-590) estavam desatualizados; localizado por busca de texto-âncora, hoje
// linhas 456-518: "JÁ NORMALIZOU?" (456), "SUPORTE — RELATO DE FALHA" (458),
// "Se o cliente JÁ disse qual é o problema" (465), o bloco "EXATAMENTE"
// (469-479), "- Conexão offline" (480), "- Contrato suspenso por falta de
// pagamento" (481), "Quando ele responder à pergunta de diagnóstico" (498),
// "Sem identidade confirmada, o fluxo de Suporte" (518).
//
// entra() só com identidade.nivel === 'forte': este módulo chama
// consultar_status_todos_contratos, e sem cliente identificado não há contrato
// para consultar. suporte-geral.js (irmão deste módulo) cobre as explicações
// que não dependem disso e por isso entra sempre.
//
// ==========================================================================
// A CORREÇÃO CENTRAL DESTA TAREFA (o defeito que motivou a entrega inteira)
// ==========================================================================
// O texto original, linhas 469-479, mandava: "Contrato ativo e conexão
// online, responda EXATAMENTE neste modelo, com as quebras de linha" — e o
// modelo citado terminava com "Me diz só uma coisa: você está sem internet,
// com lentidão ou a conexão está caindo?". Quatro linhas ANTES (465), o
// próprio prompt já proibia essa mesma pergunta: "NÃO repita a pergunta de
// diagnóstico [...]: vá direto ao roteiro daquele problema." Duas instruções
// no mesmo bloco, uma mandando perguntar e outra proibindo a mesma pergunta —
// e "EXATAMENTE" tem prioridade lexical mais forte que uma proibição quatro
// linhas acima, então a IA obedecia o modelo fixo e perguntava ao cliente o
// que ele tinha acabado de dizer.
//
// O bloco "EXATAMENTE" NÃO foi migrado. Em seu lugar, as duas linhas abaixo
// (dentro de linhas(), procure "Contrato ativo e conexão online:") escrevem o
// mesmo caso como OBJETIVO: acolher, dizer o que foi consultado, e fazer a
// PRÓXIMA pergunta útil — nunca repetir a de diagnóstico se ele já respondeu.
// Valor acrescentado que não existia em nenhum módulo antes: "ONLINE não prova
// que a internet está funcionando bem" — princípio do dono (2026-09-18) de que
// o status é só o que o sistema enxerga NAQUELE instante (pode haver
// lentidão, Wi-Fi fraco, oscilação, perda de pacotes, problema de alcance ou
// de aplicativo por trás de uma conexão que aparece online) e NUNCA serve
// para contradizer o relato do cliente.
//
// Trava contra o defeito voltar: suporte-diagnostico.test.js tem um teste
// dedicado que garante que NENHUMA linha deste módulo contém "EXATAMENTE" nem
// a pergunta de três opções ("sem internet, com lentidão ou a conexão está
// caindo") — nem mesmo como exemplo negativo. Por isso a linha "Se o cliente
// JÁ disse qual é o problema" (465) teve a citação da pergunta antiga REMOVIDA
// (o original citava a própria frase proibida entre aspas, como exemplo do
// que não repetir) — o sentido de "não repita a pergunta de diagnóstico" é o
// mesmo, só sem citar a frase banida dentro de uma proibição.
// ==========================================================================
//
// Nomes de setor e motivo (Restrição Global do plano, mesma já aplicada em
// fatos.js, painel.js e comercial-novo.js): "conclua para o Suporte" e
// "conclua para o Financeiro" viraram "o setor da lista acima que cuidar de
// suporte" / "...que cuidar do financeiro". O rótulo da seção também mudou:
// o original usava "SUPORTE — RELATO DE FALHA" como cabeçalho (SUPORTE em
// caixa alta não bate no regex da guarda, que é case-sensitive, mas o mesmo
// cuidado que já fez comercial-novo.js trocar "COMERCIAL" por "VENDA" como
// cabeçalho se aplica aqui — o cabeçalho não pode afirmar o nome de um setor
// que talvez não exista com esse nome na operação). Virou "RELATO DE
// FALHA (...)", sem o prefixo. Pela mesma razão, "motivo Comprovante, se
// existir" (linha 481, dentro do caso de contrato suspenso) virou "o motivo da
// lista acima que falar de comprovante, se houver um" — motivo também é dado
// de operação, não deve aparecer como string literal.
//
// "Sem identidade confirmada, o fluxo de Suporte não cita status nenhum"
// (518) foi migrada (é uma das âncoras do plano) mesmo sendo hoje, na prática,
// inalcançável: com entra() gateando por nivel === 'forte' em código, este
// módulo nunca chega a ser lido por um cliente não identificado — o que no
// texto original era só uma ressalva em prosa (o bloco inteiro de SUPORTE
// era emitido incondicionalmente por ai-orchestrator.js, e essa frase existia
// para cobrir o caso de o modelo ler a seção mesmo sem identidade) virou
// garantia estrutural. Mantida por instrução explícita do plano e como
// reforço defensivo; ver ressalva no relatório desta tarefa.
module.exports = {
  nome: 'suporte-diagnostico',
  entra(estado) {
    return (estado.identidade || {}).nivel === 'forte';
  },
  linhas() {
    return [
      '',
      'JÁ NORMALIZOU? ("normalizou o sinal?", "o sinal voltou?", "já resolveram?", "ainda está fora?") é ACOMPANHAMENTO de falha, não é pergunta de cobertura nem de contratação. Chame consultar_status_todos_contratos e responda pelo que ela devolver; se houver aviso ativo na cidade dele, use o aviso. O cliente citar a cidade não transforma o assunto em cobertura — ele está falando do ponto que já tem.',
      'RELATO DE FALHA (internet lenta, caindo, sem acesso, velocidade abaixo da contratada, "está com problema"), cliente com identidade confirmada: ANTES de responder, chame consultar_status_todos_contratos (UMA chamada, cobre todos os contratos) e siga a instrução que ela devolver. Sem emoji. Depois, siga o caso que a consulta devolveu, adaptando o nome:',
      'Se o cliente JÁ disse qual é o problema (lentidão, velocidade menor que a contratada, cai à noite, sem acesso em um cômodo), NÃO repita a pergunta de diagnóstico: vá direto ao roteiro daquele problema. Perguntar o que ele acabou de dizer é o pior erro de atendimento.',
      [
        '- Contrato ativo e conexão online: acolha o relato em uma frase, diga que consultou o cadastro e que o contrato está ativo e a conexão aparece online NESTE MOMENTO, e faça a próxima pergunta útil para o problema que ELE já descreveu. ONLINE não prova que a internet está funcionando bem: pode haver lentidão, Wi-Fi fraco, oscilação, perda de pacotes, problema de alcance ou de aplicativo. NUNCA use o status para dizer que está tudo certo, e NUNCA pergunte o que ele já respondeu — se ele já disse que está lento, que cai ou que está sem acesso, vá direto ao roteiro daquele problema.',
        'Só quando ele NÃO tiver dito qual é o problema, pergunte o que está acontecendo, com as suas palavras.',
      ].join('\n'),
      '- Conexão offline: "Verifiquei aqui que sua conexão está offline no momento. Vou te ajudar a verificar o que está acontecendo. Os equipamentos da internet estão ligados? Tem alguma luz vermelha acesa ou piscando?" Depois da resposta dele, se não houver mais nada para responder, conclua para o setor da lista acima que cuidar de suporte com o relato no resumo.',
      '- Contrato suspenso por falta de pagamento, só quando ele RELATAR falta de acesso (nunca quando ele pediu para pagar): "Verifiquei aqui e consta uma pendência na fatura que deixou o acesso à internet temporariamente suspenso. Pode ser que você já tenha pago e a confirmação ainda não tenha chegado ao sistema. Você chegou a fazer esse pagamento? Assim consigo te orientar no próximo passo." Se ele disser que pagou, peça o comprovante e conclua para o setor da lista acima que cuidar do financeiro (use o motivo da lista acima que falar de comprovante, se houver um); se disser que não pagou, ofereça o PIX ou o boleto (entregue se ele quiser) e conclua para o setor da lista acima que cuidar do financeiro.',
      'Quando ele responder à pergunta de diagnóstico (ou já tiver dito o problema de cara), siga a partir do que ele disse: "lentidão" ou "está lento" leva ao roteiro de VELOCIDADE ABAIXO DA CONTRATADA (peça o teste de velocidade perto do equipamento); "sem acesso" leva às verificações de equipamento; "fica caindo" leva a perguntar se cai em todos os aparelhos e em que horário. Em nenhum caso repita a pergunta.',
      'Sem identidade confirmada, este fluxo de diagnóstico não cita status nenhum: identifique primeiro (peça CPF ou CNPJ) ou apenas encaminhe.',
    ];
  },
};
