const { createChatCompletion } = require('./openai-client');
const { executeTool } = require('./tool-executor');
const { toOpenAiTools } = require('./tool-registry');
const { getAiConfig, listToolPermissions } = require('./ai-config.repository');
const { recordAiInteraction } = require('./ai-interaction.repository');
const { listRecentMessagesByConversation } = require('../conversations/message.repository');
const { listActiveReasons } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const sgpClient = require('../integrations/sgp-client');
const { mensagemSegura } = require('./safe-error-log');
const { maskDocument, normalizeContract } = require('./sgp-normalizer');

// A auditoria (ai_interactions.tools_requested) grava os argumentos como o
// modelo os enviou, verbatim — inclui o CPF/CNPJ inteiro de buscar_cliente se
// não passar por aqui primeiro. O padrão é por nome do argumento (não por
// nome da ferramenta) de propósito: cobre qualquer ferramenta futura que
// receba um documento, não só a de hoje.
const CHAVE_DOCUMENTO = /cpf|documento/i;
// Data de nascimento (confirmar_nascimento) não é um documento — maskDocument
// mantém os 3 primeiros e os 4 últimos caracteres, o que em '20/05/1990'
// ainda entrega o dia e o ano de nascimento (fix round 2). Aqui não há nada
// para preservar parcialmente: o valor inteiro vira '[data]'.
const CHAVE_DATA_NASCIMENTO = /nascimento|^data$/i;

function mascararArgsParaAuditoria(args) {
  if (!args || typeof args !== 'object') return args;
  const mascarado = { ...args };
  for (const chave of Object.keys(mascarado)) {
    if (CHAVE_DATA_NASCIMENTO.test(chave)) mascarado[chave] = '[data]';
    else if (CHAVE_DOCUMENTO.test(chave)) mascarado[chave] = maskDocument(mascarado[chave]);
  }
  return mascarado;
}

const HISTORICO_MAX = 20;

// Teto de parede para o turno inteiro. Existe um limite de ferramentas e um
// timeout por chamada (60s na OpenAI, 15s por ferramenta em tool-executor.js),
// mas nenhum limite para a soma de tudo — no pior caso (perto de oito idas e
// vindas à OpenAI mais ferramentas) um único job prende o worker por minutos
// enquanto outras conversas esperam (a fila da IA roda com concorrência 1).
// 120s cobre folgadamente um atendimento saudável (poucos segundos por
// chamada) e ainda assim corta bem antes do pior caso multi-minuto.
const TURNO_MAX_MS = 120000;

function papelDaMensagem(message) {
  return message.direction === 'inbound' ? 'user' : 'assistant';
}

// Áudio transcrito entra no histórico como o texto da transcrição: para o modelo
// não há diferença entre o cliente ter digitado ou falado. Áudio sem transcrição
// concluída fica de fora — a IA nunca deve receber conteúdo em branco.
//
// No perfil de triagem, mídia do cliente (imagem, documento, áudio que não
// transcreveu) vira um placeholder em vez de sumir: a recepcionista precisa
// saber que algo chegou (ex.: para perguntar se é um comprovante), mesmo sem
// "ver" o conteúdo. Isso só vale para o que o CLIENTE mandou (direction
// inbound) — o próprio boleto que a IA envia (enviar_boleto, messageType
// 'document', outbound) não pode virar "cliente enviou um documento" no
// histórico.
function conteudoParaModelo(m, perfil) {
  if (m.messageType === 'text') return m.content || null;
  if (m.messageType === 'audio' && m.transcriptionStatus === 'completed') return m.transcription || null;
  // O content de uma mensagem 'pix' é o copia e cola: uma parede de caracteres
  // sem sentido para o modelo, que ele ainda poderia repetir de volta ao
  // cliente numa resposta gerada. O histórico registra só que o cartão saiu.
  if (m.direction === 'outbound' && m.messageType === 'pix') return '[cartão Pix enviado ao cliente]';
  if (perfil === 'triagem' && m.direction === 'inbound') {
    // A legenda (m.content) acompanha o placeholder quando existir: o
    // cliente pode mandar uma foto do boleto E escrever "já paguei isso" na
    // legenda — perder esse texto perderia informação real da triagem.
    if (m.messageType === 'image') return m.content ? `[cliente enviou uma imagem] ${m.content}` : '[cliente enviou uma imagem]';
    if (m.messageType === 'document') return m.content ? `[cliente enviou um documento] ${m.content}` : '[cliente enviou um documento]';
    if (m.messageType === 'audio') return '[cliente enviou um áudio que não pôde ser transcrito]';
  }
  return null;
}

async function montarContextoSistema(config, contact, contracts, habilitadas = []) {
  const [motivos, setores] = await Promise.all([listActiveReasons(), listSectors()]);
  const linhas = [config.systemPrompt, '', 'Motivos de atendimento disponíveis (use o id exato):'];
  for (const m of motivos) linhas.push(`- ${m.id} = ${m.name}`);
  linhas.push('', 'Setores para transferência (use o id exato):');
  for (const s of setores) linhas.push(`- ${s.id} = ${s.name}`);
  linhas.push('');
  if (contact.sgpClientId) {
    linhas.push('O cliente já está identificado.');
    // Passa pelo normalizador de propósito: é a allowlist que garante que senha
    // PPPoE, login e afins nunca entram no contexto do modelo.
    const contratos = contracts.map(normalizeContract);
    if (contratos.length > 1) {
      // O cliente não sabe o número do contrato dele — sabe o endereço. Pedir
      // "qual contrato?" sem listar travava a conversa.
      linhas.push('O cliente tem mais de um contrato:');
      for (const c of contratos) linhas.push(`- ${descreverContrato(c)}`);
      linhas.push(
        'NUNCA peça o número do contrato: o cliente não o conhece. Identifique cada contrato pelo endereço e, se o endereço se repetir, pelo plano.',
        habilitadas.includes('consultar_faturas_todos_contratos')
          ? 'Se a pergunta for sobre fatura, pagamento, boleto ou PIX, use consultar_faturas_todos_contratos (uma chamada só) e responda separando por endereço e plano, sem perguntar qual é.'
          : 'Se a pergunta for sobre fatura, pagamento, boleto ou PIX, consulte contrato a contrato e responda separando por endereço e plano, sem perguntar qual é.',
        'Se for indispensável que ele escolha (ex.: status da conexão), pergunte pelo endereço, nunca pelo número.'
      );
      if (contact.sgpContractId) linhas.push(`Contrato usado por último nesta conversa: ${contact.sgpContractId}.`);
    } else if (contratos.length === 1) {
      linhas.push(`Contrato único: ${descreverContrato(contratos[0])}. Use-o sem perguntar.`);
    } else {
      linhas.push(`Contrato selecionado: ${contact.sgpContractId || 'ainda não escolhido'}.`);
    }
  } else {
    linhas.push('O cliente ainda NÃO foi identificado. Use buscar_cliente com o CPF ou CNPJ dele.');
  }
  // Só descreve a capacidade quando ela existe na lista de ferramentas:
  // descrever uma ferramenta ausente é um jeito conhecido de o modelo afirmar
  // que fez a coisa sem ter feito.
  if (habilitadas.includes('desbloqueio_confianca')) {
    linhas.push(
      '',
      'Desbloqueio em confiança (desbloqueio_confianca): só para contrato com status "suspenso", e só quando o cliente pedir. Nunca prometa prazo por conta própria — informe os dias que a ferramenta devolver, e que a fatura continua devida. Se ela devolver prazoDesconhecido, diga que o prazo será confirmado pelo atendente. Se devolver indeterminado, diga que não foi possível confirmar a liberação e encaminhe para um atendente. Se ela recusar, transmita o motivo com educação.'
    );
  }
  linhas.push(
    '',
    'Formatação: a resposta vai para o WhatsApp. Negrito com *um asterisco*, itálico com _sublinhado_.',
    'Nunca use markdown: nada de **, ##, nem links no formato [texto](url).'
  );
  return linhas.join('\n');
}

function descreverContrato(c) {
  const plano = c.velocidade ? `${c.plano} (${c.velocidade})` : c.plano;
  return `contrato ${c.id} — ${plano} — ${c.endereco || 'endereço não informado'} — ${c.status}`;
}

/** Carrega os contratos do cliente uma vez por turno, para alimentar o cache. */
async function carregarContratos(contact) {
  if (!contact.sgpDocument) return [];
  try {
    const { contracts } = await sgpClient.lookupClientByCpf(contact.sgpDocument);
    return contracts;
  } catch (err) {
    // Nunca loga err inteiro: err.cause pode ser (ou ter sido, antes do
    // saneamento em sgp-client.js) o axios error cru, cujo config.data é o
    // corpo form-encoded com o token do SGP e o CPF do cliente.
    console.error(`Failed to preload SGP contracts for contact ${contact.id}: ${mensagemSegura(err)}`);
    return [];
  }
}

const FERRAMENTAS_TRIAGEM = [
  'buscar_cliente', 'confirmar_nascimento', 'esquecer_identificacao',
  'consultar_status_contrato', 'consultar_status_conexao', 'consultar_faturas_todos_contratos',
  'gerar_pix', 'gerar_segunda_via', 'enviar_boleto', 'concluir_triagem', 'encerrar_atendimento',
];

function horaDeBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// O contexto de sistema da triagem é deliberadamente separado de
// montarContextoSistema (o do assistente): a recepcionista tem outro
// objetivo (classificar e encaminhar, não resolver), outra postura (uma
// pergunta por vez) e proibições próprias (nunca revelar fatura, valor,
// endereço ou "pagamento confirmado" — isso vai só no resumo interno para o
// atendente humano).
async function montarContextoTriagem(config, identidade, triagem) {
  // Guarda defensiva: um identidade null/undefined não pode derrubar a
  // montagem do contexto — cai no mesmo tratamento de "não identificado".
  identidade = identidade || { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const [setores, motivos] = await Promise.all([listSectors(), listActiveReasons()]);
  const linhas = [
    config.systemPrompt, '',
    'Você está na TRIAGEM: é a recepcionista. Objetivo: entender → identificar (se preciso) → classificar setor e motivo → coletar o mínimo → resumir → encaminhar com concluir_triagem. Não tente resolver o atendimento inteiro.',
    'Uma pergunta por vez. Faça só perguntas indispensáveis. A mensagem mais recente manda quando o cliente muda de assunto.',
    // Tom pedido pelo dono depois dos testes reais (2026-09-13): recepcionista
    // simpática, frases completas, um emoji leve — não telegramas.
    'Tom: caloroso e direto, como uma recepcionista simpática. Frases completas e educadas.',
    'Emoji: no máximo um 😊, e SÓ no fluxo do PIX (na saudação ou no agradecimento). No fluxo do BOLETO e em qualquer outro assunto, NENHUM emoji — nem na saudação.',
    'Escreva UMA mensagem por resposta. Os modelos de frase abaixo são base para adaptar (nome, endereço, PIX ou boleto), não texto para colar: nunca escreva uma frase sua e depois o modelo com o mesmo sentido.',
    // O modelo não tem relógio: sem esta linha ele cumprimenta sem saudação
    // (ou chuta a errada). Fuso de São Paulo, que é o da operação.
    `Agora são ${horaDeBrasilia()} em Brasília. Saudação: "Bom dia" até 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" depois.`,
    '',
    'Setores (use o id exato em concluir_triagem):',
  ];
  for (const s of setores) linhas.push(`- ${s.id} = ${s.name}${s.aiHint ? ` — ${s.aiHint}` : ''}`);
  linhas.push('', 'Motivos (use o id exato, ou null se nenhum se aplica):');
  for (const m of motivos) linhas.push(`- ${m.id} = ${m.name}`);
  linhas.push('');
  const contratos = (identidade.contracts || []).map(normalizeContract);
  if (identidade.nivel === 'none') {
    linhas.push('Cliente NÃO identificado. Peça o CPF/CNPJ só se o setor exigir identificação (Financeiro, Suporte, Reativação): "Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor." Comercial de cliente novo nunca exige CPF. Depois de buscar_cliente, continue a triagem.');
    if (identidade.contestado) linhas.push('O cliente disse que o nome anterior não era dele: a identificação foi descartada. Peça o CPF.');
  } else {
    // Minor (revisão final do branch inteiro): identidade.primeiroNome pode
    // vir falsy (registro do SGP sem nome) mesmo com o cliente já
    // identificado — sem o fallback, o contexto de sistema instruía "primeiro
    // nome null", que o modelo podia repetir de volta ao cliente.
    linhas.push(`Cliente identificado (${identidade.origem === 'memory' ? 'memória' : identidade.origem === 'phone' ? 'telefone' : 'CPF'}): primeiro nome ${identidade.primeiroNome || 'cliente'}. A PRIMEIRA resposta desta conversa começa SEMPRE com a saudação da hora e o primeiro nome ("Bom dia, ${identidade.primeiroNome || 'cliente'}!"), mesmo quando você já entregou algo por ferramenta. Se ele disser que não é ele ou que o nome está errado, chame esquecer_identificacao e peça o CPF.`);
    if (contratos.length > 0) {
      linhas.push('Contratos dele:');
      for (const c of contratos) linhas.push(`- ${descreverContrato(c)}`);
      // O endereço só pode ser falado de volta ao cliente quando a
      // identidade já é FORTE: é o endereço do próprio cliente. Com
      // identidade fraca (CPF ainda não confirmado por data de nascimento) o
      // endereço pertence a quem quer que seja o dono do CPF digitado — pode
      // não ser quem está no WhatsApp, então nada do cadastro pode ser dito.
      linhas.push(
        identidade.nivel === 'forte'
          ? 'Nunca peça o número do contrato nem pergunte "qual contrato": o cliente não sabe. Se precisar saber de qual ponto ele fala, pergunte de uma vez pelo endereço, citando os endereços ("é o da Rua X ou o da Av. Y?"). Pergunte SÓ quando a resposta depender do ponto.'
          : 'Nunca peça o número do contrato e NUNCA cite endereço, plano ou qualquer dado do cadastro ao cliente: a identificação ainda não foi confirmada. Se precisar desambiguar, peça que ELE descreva o local, sem você citar nada.'
      );
    }
    if (identidade.nivel === 'fraca') {
      linhas.push('Identificação por CPF ainda NÃO confirmada: para entregar boleto ou PIX, pergunte a data de nascimento e chame confirmar_nascimento. Se não confirmar, apenas encaminhe.');
    } else {
      linhas.push(
        // Com um motivo de encerramento configurado, o atendimento que começou
        // e terminou em "quero o boleto" não vai mais para a fila: a própria
        // IA fecha. Sem motivo, tudo continua como antes.
        config.triageResolvedReasonId
          ? [
            'Identidade JÁ confirmada: NÃO peça CPF nem data de nascimento. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix. NÃO conclua a triagem nesse momento.',
            'Depois de entregar, responda no modelo (adapte nome, endereço e PIX/boleto): "Enviei acima o PIX referente ao seu contrato do endereço Agenor Costa. É só copiar o código e colar na opção \"PIX Copia e Cola\" do aplicativo do seu banco. Se tiver alguma dificuldade, me avise que eu te ajudo!" Cite o endereço só quando ele tiver mais de um contrato. Para BOLETO, mesma lógica e SEM emoji: "Enviei acima o boleto referente ao seu contrato do endereço Agenor Costa, em PDF e com a linha digitável. É só pagar pelo aplicativo do seu banco, copiando a linha digitável, ou em qualquer lotérica. Se tiver alguma dificuldade, me avise que eu te ajudo!"',
            'Se depois disso ele agradecer ("obrigado", "valeu"): chame encerrar_atendimento e responda no modelo: "Imagina, Willemberg! 😊 Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" (à noite, "Tenha uma boa noite!"). Se responder só "ok", "certo" ou um joinha: chame encerrar_atendimento e responda: "Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" Se pedir outra coisa, siga a triagem normalmente e encerre só quando ele agradecer ou confirmar que está tudo certo. No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji ("Imagina, Willemberg! Qualquer dúvida…").',
          ].join('\n')
          : 'Identidade JÁ confirmada: NÃO peça CPF nem data de nascimento. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix e depois conclua a triagem para o Financeiro.',
        ...(contratos.length > 1
          ? ['Pedido de boleto ou PIX com mais de um contrato: chame consultar_faturas_todos_contratos ANTES de perguntar qualquer coisa. Se só um contrato tiver fatura em aberto, entregue dele sem perguntar. Se mais de um tiver, pergunte de uma vez pelo endereço, no modelo: "Claro, vou te ajudar com o PIX 😊 Vi que você tem mais de um contrato com a gente. Para eu te enviar os dados do pagamento certinho, pode me confirmar de qual endereço você precisa?" (cite os endereços se ajudar) e entregue na resposta seguinte. Para BOLETO, o mesmo pedido sem emoji: "Claro, vou te ajudar com o boleto. Vi que você tem mais de um contrato com a gente. Para eu te enviar o boleto certinho, pode me confirmar de qual endereço você precisa?"']
          : []),
        // A ferramenta agora procura a fatura em TODOS os contratos do cliente
        // antes de dizer que não há: quando ela diz "em nenhum contrato", é
        // definitivo e não há o que perguntar — só avisar e encaminhar.
        'Se a ferramenta responder que não há fatura em aberto em nenhum contrato, diga isso em uma frase (sem valores) e chame concluir_triagem para o Financeiro na mesma resposta — não pergunte se ele quer ser encaminhado. Se ela devolver contratosComFatura, pergunte pelo endereço e entregue na resposta seguinte.'
      );
    }
  }
  linhas.push(
    '',
    'NUNCA diga ao cliente: status do contrato, valores e vencimentos de faturas, plano contratado ou endereço (isso vai só para o resumo). Exceções, SÓ com identidade confirmada: perguntar de qual ponto ele fala, e dizer se existe ou não fatura em aberto. Nunca diga "pagamento confirmado"; nunca prometa prazos ou "um técnico vai".',
    'Preço, planos e cobertura: informe SOMENTE o que estiver escrito nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO abaixo, exatamente como está lá. Se não houver instruções ou o que o cliente pergunta não constar nelas, não invente: diga que o Comercial confirma e encaminhe.',
    'Se o cliente enviou uma imagem, pergunte se é um comprovante e, se for, classifique Financeiro / Comprovante sem confirmar pagamento.',
    'Ao concluir, o resumo é para o atendente: o que o cliente quer e o que você apurou.',
  );
  if (triagem && triagem.forcarConclusao) {
    // O limite barra PERGUNTAS, não entregas: no 1º teste real com dois
    // contratos, o modelo gastou as duas perguntas ("qual contrato", "qual
    // endereço") e, forçado a concluir_triagem, encaminhou sem mandar o PIX
    // que já podia mandar.
    linhas.push(
      '',
      config.triageResolvedReasonId
        ? 'LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente. Se você já tem o que precisa para entregar boleto ou PIX, entregue AGORA e chame encerrar_atendimento, dizendo que qualquer outra coisa é só chamar de novo. Se não tem, chame concluir_triagem com o que apurou.'
        : 'LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente. Se você já tem o que precisa para entregar boleto ou PIX, entregue AGORA (enviar_boleto ou gerar_pix) e em seguida chame concluir_triagem. Se não tem, chame concluir_triagem com o que apurou.'
    );
  }
  if (config.triageExtraInstructions) {
    linhas.push('', 'INSTRUÇÕES ADICIONAIS DA OPERAÇÃO (única fonte para preço, planos e cobertura):', config.triageExtraInstructions);
  } else {
    linhas.push('', 'Não há instruções adicionais da operação: preço, planos e cobertura são sempre com o Comercial.');
  }
  linhas.push('', 'Formatação: WhatsApp. Negrito com *um asterisco*. Nunca markdown. Responda uma vez só: nunca repita uma frase ou parágrafo que você já escreveu.');
  return linhas.join('\n');
}

async function runAiTurn({ conversation, contact, perfil = 'assistente', identidade, triagem, origemMensagem }) {
  const iniciadoEm = Date.now();
  const config = await getAiConfig();

  let tools;
  let contexto;
  let systemContent;

  if (perfil === 'triagem') {
    tools = toOpenAiTools(FERRAMENTAS_TRIAGEM);
    // Guarda defensiva: mesmo fallback usado em montarContextoTriagem — um
    // identidade null/undefined não pode derrubar o turno nem deixar
    // contexto.contracts inconsistente com o que o contexto de sistema viu.
    const identidadeEfetiva = identidade || { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
    // Perfil fixo: os contratos vêm da identidade já resolvida (Task 2), não
    // de uma nova consulta ao SGP via carregarContratos — o cache do turno
    // (contexto.contracts) é o que tool-executor.js usa para a checagem de
    // propriedade (chaveProprietario).
    contexto = {
      conversationId: conversation.id, contact, contracts: identidadeEfetiva.contracts || [], sgpCache: {},
      identidade: identidadeEfetiva, channelId: conversation.channelId, ferramentasPermitidas: FERRAMENTAS_TRIAGEM, registroFerramentas: [],
      triagem, origemMensagem, resolvidoPelaIa: false, triagemConcluida: null,
    };
    systemContent = await montarContextoTriagem(config, identidadeEfetiva, triagem);
  } else {
    const permissoes = await listToolPermissions();
    const habilitadas = permissoes.filter((p) => p.enabled).map((p) => p.toolName);
    tools = toOpenAiTools(habilitadas);

    const contracts = await carregarContratos(contact);
    contexto = { conversationId: conversation.id, contact, contracts, sgpCache: {} };
    systemContent = await montarContextoSistema(config, contact, contracts, habilitadas);
  }

  // listRecentMessagesByConversation (não listMessagesByConversation): esta
  // pega as 20 mensagens mais NOVAS, já em ordem cronológica. A outra função
  // ordena por created_at ASC sem paginação — um LIMIT ali devolveria as
  // mensagens mais antigas da conversa, e a IA nunca veria o que o cliente
  // acabou de escrever.
  const historico = await listRecentMessagesByConversation(conversation.id, HISTORICO_MAX);
  const messages = [
    { role: 'system', content: systemContent },
    ...historico
      .map((m) => ({ role: papelDaMensagem(m), content: conteudoParaModelo(m, perfil) }))
      .filter((m) => m.content),
  ];

  const toolsRequested = [];
  const toolsExecuted = [];
  const toolsRefused = [];
  let texto = null;
  let erro = null;
  let promptTokens = 0;
  let completionTokens = 0;
  // toolChoice forçado só vale na PRIMEIRA chamada do turno: depois disso o
  // modelo já viu a exigência e as chamadas seguintes (após tool results)
  // voltam a ser livres. É 'required' (alguma ferramenta), e não
  // concluir_triagem: forçar a conclusão impedia o modelo de entregar o
  // boleto/PIX que ele já tinha como entregar (1º teste real com dois
  // contratos). A conclusão em código no worker continua como rede.
  let primeiraChamada = true;

  try {
    while (true) {
      if (Date.now() - iniciadoEm > TURNO_MAX_MS) {
        erro = 'turn_timeout';
        break;
      }

      const toolChoice = perfil === 'triagem' && primeiraChamada && triagem && triagem.forcarConclusao
        ? 'required' : undefined;
      primeiraChamada = false;

      const { message, usage } = await createChatCompletion({
        apiKey: config.apiKey, model: config.model, messages, tools, toolChoice,
      });
      promptTokens += usage.promptTokens || 0;
      completionTokens += usage.completionTokens || 0;

      const chamadas = message.tool_calls || [];
      if (chamadas.length === 0) {
        texto = message.content || null;
        // Sem tool_calls e sem texto utilizável (corte por content_filter,
        // turno vazio etc.) não é sucesso silencioso: sem isto, quem consome
        // o retorno não teria como distinguir "respondeu" de "falhou", e a
        // auditoria registraria a mesma ambiguidade.
        if (!texto) erro = 'empty_model_response';
        break;
      }

      if (toolsRequested.length + chamadas.length > config.maxToolsPerInteraction) {
        erro = 'tool_limit_reached';
        // Uma última chamada SEM ferramentas: o modelo responde com o que já
        // apurou e diz o que faltou. Sair daqui com texto nulo deixava o
        // atendente sem sugestão nenhuma — e "consulte todos os contratos"
        // torna este caminho provável justamente no cliente com vários
        // contratos, que é quem mais precisa da ajuda.
        // Respeita o mesmo teto de tempo do laço: perto do limite, a chamada
        // extra estouraria a janela que a fila de concorrência 1 assume.
        if (Date.now() - iniciadoEm < TURNO_MAX_MS) {
          messages.push({
            role: 'system',
            content: 'Não é possível fazer mais consultas neste turno. Responda agora com o que já apurou, diga o que não conseguiu verificar e ofereça encaminhar para um atendente. Não mencione limites internos do sistema.',
          });
          const final = await createChatCompletion({ apiKey: config.apiKey, model: config.model, messages, tools: [] });
          promptTokens += final.usage.promptTokens || 0;
          completionTokens += final.usage.completionTokens || 0;
          texto = final.message.content || null;
        }
        break;
      }

      messages.push({ role: 'assistant', content: message.content || null, tool_calls: chamadas });

      // Chamadas em paralelo: o modelo pede várias de uma vez e nós honramos isso.
      // Promise.all espera todas terminarem antes de seguir — uma recusa de uma
      // ferramenta não derruba as demais, porque executeTool nunca rejeita (ele
      // sempre resolve com {ok:false,...}); cada resultado é tratado depois,
      // individualmente, no laço abaixo.
      const resultados = await Promise.all(
        chamadas.map(async (chamada) => {
          const nome = chamada.function.name;
          let args = {};
          try {
            args = JSON.parse(chamada.function.arguments || '{}');
          } catch (parseErr) {
            return { chamada, resposta: { ok: false, motivo: 'invalid_args', detalhe: 'malformed JSON' } };
          }
          toolsRequested.push({ nome, args: mascararArgsParaAuditoria(args) });
          const resposta = await executeTool(nome, args, contexto);
          return { chamada, resposta };
        })
      );

      for (const { chamada, resposta } of resultados) {
        const nome = chamada.function.name;
        if (resposta.ok) {
          toolsExecuted.push({ nome });
          // Registro compacto para o resumo da triagem: o atendente precisa ver
          // o que a IA consultou e o que veio ("enviar_boleto → nenhuma fatura
          // em aberto"), senão um encaminhamento parece vazio.
          if (Array.isArray(contexto.registroFerramentas)) {
            const serializado = JSON.stringify(resposta.resultado);
            contexto.registroFerramentas.push({
              nome,
              resultado: serializado.length > 200 ? `${serializado.slice(0, 200)}…(truncado)` : serializado,
            });
          }
          messages.push({ role: 'tool', tool_call_id: chamada.id, content: JSON.stringify(resposta.resultado) });
        } else {
          // detalhe fica só na auditoria (toolsRefused): numa recusa inesperada
          // ele carrega texto interno bruto (ex.: "connect ECONNREFUSED
          // 10.0.0.5:5432"), que não pode entrar no contexto do modelo.
          toolsRefused.push({ nome, motivo: resposta.motivo, detalhe: resposta.detalhe });
          messages.push({
            role: 'tool',
            tool_call_id: chamada.id,
            content: JSON.stringify({ erro: resposta.motivo }),
          });
        }
      }
    }
  } catch (err) {
    erro = err.message;
  }

  await recordAiInteraction({
    conversationId: conversation.id,
    contactId: contact.id,
    mode: perfil === 'triagem' ? 'triage' : config.mode,
    model: config.model,
    toolsRequested, toolsExecuted, toolsRefused,
    finalResponse: texto,
    error: erro,
    promptTokens: promptTokens || null,
    completionTokens: completionTokens || null,
    durationMs: Date.now() - iniciadoEm,
  });

  return {
    texto, toolsExecutadas: toolsExecuted, erro,
    triagemConcluida: contexto.triagemConcluida || null,
    atendimentoEncerrado: Boolean(contexto.atendimentoEncerrado),
    identidade: contexto.identidade || null,
  };
}

module.exports = { runAiTurn, FERRAMENTAS_TRIAGEM };
