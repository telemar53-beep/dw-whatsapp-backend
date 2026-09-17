const { createChatCompletion } = require('./openai-client');
const { executeTool } = require('./tool-executor');
const { toOpenAiTools } = require('./tool-registry');
const { getAiConfig, listToolPermissions } = require('./ai-config.repository');
const { recordAiInteraction } = require('./ai-interaction.repository');
const { listRecentMessagesByConversation } = require('../conversations/message.repository');
const { listActiveReasons } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const { hasRecentTrustUnlockByContact } = require('./trust-unlock.repository');
const { getCompanyConfig } = require('../company/company-config.repository');
const sgpClient = require('../integrations/sgp-client');
const { mensagemSegura } = require('./safe-error-log');
const { maskDocument, normalizeContract } = require('./sgp-normalizer');
const { temAlfabetoEstranho, semAlfabetoEstranho } = require('./idioma');

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

// "Vou encaminhar", "vou repassar isso para o setor", "encaminhando seu
// atendimento", "um atendente continua daqui", "direcionado para o setor": o
// modelo anunciando o encaminhamento ao cliente. Qualquer "vou … setor" na
// mesma frase conta — o 2º teste real usou "repassar", que a lista de verbos
// não tinha.
const ANUNCIO_DE_ENCAMINHAMENTO = /\bvou (te )?(encaminhar|transferir|direcionar|repassar|passar|levar|acionar)\b|\bvou\b[^.!?\n]{0,80}\bsetor\b|encaminh(ar|ando|ei) (o |a |seu |sua |este |esta )?(atendimento|solicita[çc][aã]o|pedido|caso|chamado)|(direcionad|encaminhad|repassad)[oa] para o setor|um atendente (continua|vai continuar|d[aá] continuidade|dar[aá] continuidade)/i;

function anunciaEncaminhamento(texto) {
  return ANUNCIO_DE_ENCAMINHAMENTO.test(String(texto || ''));
}

// À noite a IA responde sozinha: duas afirmações dela precisam de um fato do
// lado de cá antes de chegarem ao cliente — que o acesso foi liberado (só a
// ferramenta pode dizer) e que o atendimento já está na fila (só
// concluir_triagem pode dizer).
const AFIRMA_LIBERACAO = /desbloqueio (em confian[çc]a )?(foi |está )?(realizado|feito|conclu[íi]do)|acesso (foi |está )?liberado|liberei (seu|o) acesso|internet (foi |está )?liberada/i;
const AFIRMA_FILA = /deixei (seu |o )?(atendimento|caso|pedido) (na|em) fila|registr(ei|ado) (seu |o )?(atendimento|caso|pedido) para a equipe|já está na fila/i;
// Janela em que uma liberação já feita ainda explica um "foi liberado?" do
// cliente: ele volta na mesma madrugada, ou de manhã, para dizer se voltou.
const LIBERACAO_RECENTE_MS = 24 * 60 * 60 * 1000;
function afirmaLiberacao(texto) { return AFIRMA_LIBERACAO.test(String(texto || '')); }
function afirmaFila(texto) { return AFIRMA_FILA.test(String(texto || '')); }

// Teste real 2026-09-14: identificado o cliente, o modelo escreveu "Perfeito.
// Vou seguir com o Pix do contrato em aberto." e não chamou gerar_pix — o
// cliente teve de pedir "pode mandar" para receber o que já tinha pedido. A
// promessa de enviar só vale com a ferramenta de entrega tendo rodado.
//
// Teste real 2026-09-15 (produção): "Enviei acima o boleto referente ao seu
// contrato..., em PDF e com a linha digitável" — afirmação no PASSADO, sem
// nenhuma chamada a enviar_boleto, e nada chegou ao cliente. A guarda só
// olhava o futuro ("vou enviar"). Agora "enviei/mandei/segue ... boleto/PIX/
// PDF/linha digitável" também conta: dizer que já foi só vale com a entrega
// feita neste turno.
const AFIRMA_ENVIO = /\bvou (te )?(enviar|mandar|gerar|seguir com|providenciar|emitir)\b[^.!?\n]{0,60}\b(pix|boleto|fatura|segunda via|c[óo]digo)\b|\b(enviei|mandei|gerei|segue|seguem)\b[^.!?\n]{0,60}\b(pix|boleto|fatura|segunda via|c[óo]digo|pdf|linha digit[áa]vel)\b/i;
function afirmaEnvio(texto) { return AFIRMA_ENVIO.test(String(texto || '')); }

// Teste real 2026-09-15 (produção, gpt-5.4-mini): "Boa noite, Willemberg! كيف
// posso ajudar você hoje?". O prompt-base já pede português; quando o texto
// final traz letra de outro alfabeto, o turno faz UMA chamada extra, sem
// ferramentas, pedindo a mesma resposta em português. Se ainda vier estranha
// (ou a chamada falhar, ou o tempo do turno tiver acabado), as palavras
// estranhas são cortadas: pior uma palavra a menos do que árabe no WhatsApp.
const INSTRUCAO_PORTUGUES = 'Sua resposta contém palavras ou letras de outro idioma/alfabeto. Reescreva a MESMA resposta, com o mesmo sentido, inteiramente em português do Brasil, sem nenhuma palavra de outro idioma.';

async function garantirPortugues({ texto, messages, config, iniciadoEm, conversationId }) {
  const tokens = { prompt: 0, completion: 0 };
  if (!texto || !temAlfabetoEstranho(texto)) return { texto, tokens };
  if (Date.now() - iniciadoEm < TURNO_MAX_MS) {
    try {
      const r = await createChatCompletion({
        apiKey: config.apiKey, model: config.model, tools: [],
        messages: [...messages, { role: 'assistant', content: texto }, { role: 'system', content: INSTRUCAO_PORTUGUES }],
      });
      tokens.prompt += (r.usage && r.usage.promptTokens) || 0;
      tokens.completion += (r.usage && r.usage.completionTokens) || 0;
      const reescrito = r.message && r.message.content;
      if (reescrito && !temAlfabetoEstranho(reescrito)) return { texto: reescrito, tokens };
    } catch (err) {
      console.error(`Reescrita em português falhou na conversa ${conversationId}: ${mensagemSegura(err)}`);
    }
  }
  console.error(`Resposta da IA com alfabeto estranho cortada na conversa ${conversationId}`);
  return { texto: semAlfabetoEstranho(texto), tokens };
}

// As duas que de fato põem o pagamento na mão do cliente. É o que a volta
// forçada por anúncio de envio aceita como cumprimento da promessa.
// gerar_segunda_via NÃO entra: ela só devolve linha e link ao modelo, sem
// enviar nada — aceitá-la aqui é aceitar a promessa sem o boleto.
const FERRAMENTAS_DE_ENTREGA = ['gerar_pix', 'enviar_boleto'];

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
  'consultar_status_contrato', 'consultar_status_conexao',
  'consultar_status_todos_contratos', 'consultar_faturas_todos_contratos',
  // gerar_segunda_via fica de fora de propósito (teste real 2026-09-15): na
  // triagem ela só devolvia linha e link ao modelo, sem enviar, e marcava a
  // conversa como resolvida — o modelo então dizia "enviei acima o boleto"
  // sem nenhum envio. Quem entrega o boleto na triagem é enviar_boleto; a
  // segunda via continua no assistente, com um humano no comando.
  'gerar_pix', 'enviar_boleto', 'concluir_triagem', 'encerrar_atendimento',
];

// À noite não há atendente: a triagem precisa das ferramentas que resolvem
// sozinha o que sobra (desbloqueio em confiança, leitura de comprovante).
// A leitura de comprovante fecha a porta que o desbloqueio em confiança abre:
// o cliente que já pagou manda a foto e a própria triagem confere.
const FERRAMENTAS_TRIAGEM_NOTURNO = [...FERRAMENTAS_TRIAGEM, 'desbloqueio_confianca', 'analisar_comprovante'];

// De dia, com a leitura de comprovante ligada, entra a LEITURA e só ela: o
// desbloqueio em confiança continua sendo da noite, quando não há atendente.
// Ler de dia é conferência e aviso à atendente, nunca liberação.
const FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA = [...FERRAMENTAS_TRIAGEM, 'analisar_comprovante'];

// A lista fixa da triagem só cresce à noite: descrever ao modelo uma
// capacidade que ele não tem de dia é o jeito conhecido de ele afirmar que fez.
function ferramentasDaTriagem(triagem, config) {
  const noturno = Boolean(triagem && triagem.noturno && triagem.noturno.ativo);
  const leDeDia = Boolean(config && config.triageReadReceiptsDaytime);
  const lista = noturno
    ? FERRAMENTAS_TRIAGEM_NOTURNO
    : (leDeDia ? FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA : FERRAMENTAS_TRIAGEM);
  // Sem exigência de data de nascimento (o padrão) não há o que confirmar: o
  // próprio buscar_cliente já deixa a identidade forte. Deixar a ferramenta
  // descrita seria convidar o modelo a pedir a data — ou a afirmar que a usou.
  if (config && config.triageRequireBirthdate) return lista;
  return lista.filter((n) => n !== 'confirmar_nascimento');
}

// Sem empresa cadastrada a frase precisa continuar de pé: "a empresa é o
// suporte" diz a mesma coisa sem nome nenhum embutido no código.
const NOME_GENERICO_EMPRESA = 'empresa';

function horaDeBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// O modelo não tem calendário: sem a data ele não consegue dizer há quantos
// dias a fatura venceu (decisão do dono, 2026-09-16: pode dizer).
function dataDeBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date());
}

// O contexto de sistema da triagem é deliberadamente separado de
// montarContextoSistema (o do assistente): a recepcionista tem outro
// objetivo (classificar e encaminhar, não resolver), outra postura (uma
// pergunta por vez) e proibições próprias (nunca revelar fatura, valor,
// endereço ou "pagamento confirmado" — isso vai só no resumo interno para o
// atendente humano).
async function montarContextoTriagem(config, identidade, triagem, avisoCidade, empresa) {
  // Com a confirmação por data de nascimento desligada (o padrão), a data
  // não é citada em lugar nenhum do prompt: o CPF sozinho identifica.
  const exigeNascimento = Boolean(config && config.triageRequireBirthdate);
  const eDataDeNascimento = exigeNascimento ? ' e data de nascimento' : '';
  const nemDataDeNascimento = exigeNascimento ? ' nem data de nascimento' : '';
  // Guarda defensiva: um identidade null/undefined não pode derrubar a
  // montagem do contexto — cai no mesmo tratamento de "não identificado".
  identidade = identidade || { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const [setores, motivos] = await Promise.all([listSectors(), listActiveReasons()]);
  const linhas = [
    config.systemPrompt, '',
    'Você está na TRIAGEM: é a recepcionista. Objetivo: entender → identificar (se preciso) → classificar setor e motivo → coletar o mínimo → resumir → encaminhar com concluir_triagem. Não tente resolver o atendimento inteiro.',
    'Uma pergunta por vez. Faça só perguntas indispensáveis. A mensagem mais recente manda quando o cliente muda de assunto.',
    // Print 2026-09-17: a mesma pergunta de diagnóstico saiu três vezes
    // seguidas, mesmo com o cliente respondendo "Lentidão" no meio.
    'NUNCA repita uma mensagem que você já enviou nesta conversa, nem com outras palavras. Se ele já respondeu a sua pergunta, siga em frente a partir da resposta dele — repetir a pergunta é o sinal mais claro de atendimento quebrado.',
    // Teste real (2026-09-13, Suporte): o modelo escreveu "vou encaminhar para
    // o Suporte" sem chamar concluir_triagem, e só encaminhou no turno
    // seguinte, depois de um "OK" do cliente — um turno inteiro perdido.
    'Quando decidir encaminhar, chame concluir_triagem NA MESMA resposta em que avisa o cliente. Nunca escreva "vou encaminhar" sem concluir; nunca espere um "ok" para encaminhar.',
    // Print 2026-09-16: a IA pediu "me encaminhe a mensagem da promoção" E
    // concluiu no mesmo turno. Fora da triagem ela não responde mais, então a
    // imagem que a cliente mandou em seguida ficou sem ninguém.
    'NUNCA chame concluir_triagem no mesmo turno em que você pede alguma coisa ao cliente (um dado, uma foto, uma confirmação). Ou você pergunta, ou você encaminha — depois que ele responder, aí sim encaminhe. Encaminhar logo depois de pedir algo deixa a resposta dele sem ninguém para ler.',
    // Mesmo dia: "não trabalho com promoções aqui na triagem".
    'NUNCA cite o funcionamento interno ao cliente: nada de "aqui na triagem", "sou a triagem", "meu sistema", "minha ferramenta", "não tenho acesso a isso". Fale do que você pode fazer, não de como você funciona por dentro.',
    // Tom pedido pelo dono depois dos testes reais (2026-09-13): recepcionista
    // simpática, frases completas, um emoji leve — não telegramas.
    'Tom: caloroso e direto, como uma recepcionista simpática. Frases completas e educadas.',
    // Print 2026-09-17: entrega de boleto inteira sem chamar a cliente pelo
    // nome, logo depois de identificar pelo CPF.
    'Assim que souber o primeiro nome do cliente (pelo cadastro ou porque ele acabou de se identificar), use o nome dele na resposta seguinte e continue usando de vez em quando. Entregar boleto, PIX ou resposta sem nunca chamar a pessoa pelo nome soa robótico.',
    // Emoji do COMERCIAL ampliado pelo dono (2026-09-15): ícone por plano
    // (como vier nas instruções) e 👍 ao confirmar o endereço.
    'Emoji SÓ nos fluxos do PIX e do COMERCIAL. No PIX: no máximo um 😊 por mensagem (na saudação ou no agradecimento). No COMERCIAL: um 😊 na saudação ou no encaminhamento, um ícone por plano se as instruções trouxerem, e 👍 ao confirmar o endereço. No BOLETO, no SUPORTE e em qualquer outro assunto, NENHUM emoji — nem na saudação.',
    'Escreva UMA mensagem por resposta. Os modelos de frase abaixo são base para adaptar (nome, endereço, PIX ou boleto), não texto para colar: nunca escreva uma frase sua e depois o modelo com o mesmo sentido.',
    // Teste real (2026-09-13): estourado o teto de ferramentas, o modelo
    // escreveu "não consegui confirmar aqui o status da conexão... posso
    // encaminhar para o suporte verificar". Para o dono, inaceitável: a
    // empresa É o suporte, não há para quem encaminhar "a verificação".
    `NUNCA diga ao cliente que não conseguiu verificar, confirmar ou consultar algo: a ${empresa || NOME_GENERICO_EMPRESA} é o suporte. Se uma consulta falhar, responda com o que tem e encaminhe ao setor dizendo que a equipe verifica.`,
    // O modelo não tem relógio: sem esta linha ele cumprimenta sem saudação
    // (ou chuta a errada). Fuso de São Paulo, que é o da operação.
    // Print 2026-09-17: com a exigência desligada, a IA ainda pediu "sua data
    // de nascimento" para conferir um comprovante — e insistiu quando a
    // cliente respondeu. O dono: nunca peça, em nenhum fluxo.
    ...(exigeNascimento ? [] : ['NUNCA peça data de nascimento ao cliente, em nenhuma situação — nem para identificar, nem para conferir comprovante, nem para "seguir com a conferência". O CPF já identifica.']),
    `Hoje é ${dataDeBrasilia()} e agora são ${horaDeBrasilia()} em Brasília. Saudação: "Bom dia" até 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" depois. Cumprimente só na primeira resposta da conversa; nas seguintes, não repita a saudação: vá direto ao assunto.`,
  ];
  // A empresa já sabe da falha: mandar o cliente reiniciar o roteador é perder
  // o tempo dele e o nosso. O aviso entra cedo no contexto, antes de qualquer
  // roteiro de suporte, porque é ele que muda o roteiro.
  if (avisoCidade) {
    linhas.push(
      `AVISO ATIVO NA CIDADE DO CLIENTE (${avisoCidade.cidade}): ${avisoCidade.mensagem}`,
      'Se ele reclamar de internet lenta, caindo ou sem acesso: informe que há uma falha regional em andamento nessa cidade (use o aviso acima), NÃO peça verificações de equipamento, NÃO prometa previsão, e conclua para o Suporte na mesma resposta com "falha regional" no resumo. Se o assunto for outro, atenda normalmente.',
    );
  }
  // Fora do horário comercial não há ninguém para "continuar daqui": o modelo
  // precisa saber disso ANTES de escrever qualquer promessa ao cliente.
  if (triagem && triagem.noturno && triagem.noturno.ativo) {
    linhas.push(
      '',
      `MODO NOTURNO: estamos fora do horário comercial e NÃO há atendente agora. Você atende sozinha o que as ferramentas permitem e deixa na fila, com resumo, o que precisa de gente. A equipe volta às ${triagem.noturno.retornoAs}. Nunca prometa solução imediata, técnico ou prazo.`,
      `Ao concluir para um setor à noite, diga que "nossa equipe dá continuidade a partir das ${triagem.noturno.retornoAs}" — nunca "um atendente continua daqui".`,
      // O roteiro do comprovante só existe à noite porque as duas ferramentas
      // que ele usa (analisar_comprovante e desbloqueio_confianca) também só
      // entram na lista da triagem à noite.
      'COMPROVANTE À NOITE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Se conferir e o contrato estiver SUSPENSO, chame desbloqueio_confianca do contrato indicado — a ferramenta já avisa o cliente antes de executar; depois responda EXATAMENTE com a frase que ela devolver e conclua para o Financeiro na mesma resposta. Se o comprovante não conferir, ou o contrato estiver ativo, não desbloqueie: agradeça, diga que a equipe confere a partir do horário de retorno e conclua para o Financeiro (motivo "Comprovante" se existir). Se ele pedir liberação SEM comprovante ("paguei, libera"), chame desbloqueio_confianca direto: a regra da casa decide. NUNCA diga "pagamento confirmado" nem "acesso liberado" sem a ferramenta ter devolvido liberado: true. Se a ferramenta devolver jaUtilizado: true, NÃO diga isso ao cliente nem cite outro contrato: responda o mesmo acolhimento (comprovante registrado para a equipe conferir a partir do horário de retorno) e conclua para o Financeiro.',
      // O roteiro de conexão só existe à noite e usa as duas ferramentas
      // básicas de diagnóstico (consultar_status_todos_contratos) e, quando
      // aplicável, desbloqueio em confiança.
      `CONEXÃO À NOITE: os mesmos roteiros de Suporte (consulte consultar_status_todos_contratos antes). Depois da pergunta de diagnóstico, faça ATÉ DUAS etapas simples, uma por mensagem: "Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?" e depois "A luz voltou a ficar verde?". Se resolver, conclua para o Suporte dizendo que ficou registrado que a conexão voltou. Se não resolver, conclua para o Suporte respondendo no modelo: "Vou deixar seu atendimento na fila do Suporte com tudo o que verificamos. Nossa equipe dá continuidade a partir das ${triagem.noturno.retornoAs}." Sem prometer técnico nem prazo. Contrato suspenso por pendência: roteiro do suspenso e, se vier comprovante, o roteiro do comprovante.`,
    );
  }
  linhas.push('', 'Setores (use o id exato em concluir_triagem):');
  for (const s of setores) linhas.push(`- ${s.id} = ${s.name}${s.aiHint ? ` — ${s.aiHint}` : ''}`);
  linhas.push('', 'Motivos (use o id exato, ou null se nenhum se aplica):');
  for (const m of motivos) linhas.push(`- ${m.id} = ${m.name}`);
  linhas.push('');
  const contratos = (identidade.contracts || []).map(normalizeContract);
  if (identidade.sgpIndisponivel) {
    // Vínculo gravado + SGP fora do ar (identity-resolver). O cliente continua
    // identificado — pedir CPF de novo a quem já foi chamado pelo nome é o
    // pior desfecho —, mas não há contratos nem consultas possíveis, então o
    // único caminho é cumprimentar, avisar e encaminhar.
    linhas.push(`Cliente identificado pela memória (primeiro nome ${identidade.primeiroNome || 'cliente'}), mas o sistema do SGP NÃO respondeu agora. NÃO peça CPF${nemDataDeNascimento} e NÃO tente boleto, PIX nem status de conexão. Cumprimente pelo primeiro nome, diga em uma frase que o sistema de consulta está instável neste momento, e chame concluir_triagem para o setor adequado ao que ele pediu, com o resumo começando por "SGP indisponível na triagem".`);
  } else if (identidade.nivel === 'none') {
    linhas.push('Cliente NÃO identificado. Peça o CPF/CNPJ só se o setor exigir identificação (Financeiro, Suporte, Reativação): "Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor." Comercial de cliente novo nunca exige CPF. Depois de buscar_cliente, continue a triagem.');
    if (identidade.contestado) linhas.push('O cliente disse que o nome anterior não era dele: a identificação foi descartada. Peça o CPF.');
  } else {
    // Minor (revisão final do branch inteiro): identidade.primeiroNome pode
    // vir falsy (registro do SGP sem nome) mesmo com o cliente já
    // identificado — sem o fallback, o contexto de sistema instruía "primeiro
    // nome null", que o modelo podia repetir de volta ao cliente.
    linhas.push(`Cliente identificado (${identidade.origem === 'memory' ? 'memória' : identidade.origem === 'phone' ? 'telefone' : 'CPF'}): primeiro nome ${identidade.primeiroNome || 'cliente'}. A PRIMEIRA resposta desta conversa começa SEMPRE com a saudação da hora e o primeiro nome ("Bom dia, ${identidade.primeiroNome || 'cliente'}!"), mesmo quando você já entregou algo por ferramenta. Se ele disser que não é ele ou que o nome está errado, chame esquecer_identificacao e peça o CPF.`);
    if (contratos.length > 0) {
      // O endereço (e o próprio fato de existirem dois pontos) só pode ser
      // falado de volta ao cliente quando a identidade já é FORTE: é o
      // endereço do próprio cliente. Com identidade fraca (CPF ainda não
      // confirmado por data de nascimento) o cadastro pertence a quem quer
      // que seja o dono do CPF digitado — pode não ser quem está no WhatsApp.
      // Defeito C: listar os contratos também com identidade fraca era o que
      // dava ao modelo o número que ele acabava citando ("contrato 2354").
      if (identidade.nivel === 'forte') {
        linhas.push('Contratos dele:');
        for (const c of contratos) linhas.push(`- ${descreverContrato(c)}`);
        linhas.push('Se precisar saber de qual ponto ele fala, pergunte de uma vez pelo endereço, citando os endereços ("é o da Rua X ou o da Av. Y?"). Pergunte SÓ quando a resposta depender do ponto.');
      } else {
        linhas.push(`Contratos: ${contratos.length}.`);
        linhas.push('NUNCA cite endereço, plano ou qualquer dado do cadastro ao cliente: a identificação ainda não foi confirmada. Se precisar desambiguar, peça que ELE descreva o local, sem você citar nada.');
      }
      // Vale para os DOIS níveis, e aparece uma vez só: o cliente não conhece
      // o número do contrato, nem com a identidade já confirmada.
      linhas.push('Nunca peça o número do contrato nem pergunte "qual contrato": o cliente não sabe. NUNCA cite o número do contrato ao cliente.');
      if (contratos.length === 1) linhas.push('Contrato único: use-o sem perguntar qual.');
    }
    if (identidade.nivel === 'fraca') {
      linhas.push('Identificação por CPF ainda NÃO confirmada: para entregar boleto ou PIX, pergunte a data de nascimento e chame confirmar_nascimento. Se não confirmar, apenas encaminhe. O CPF já foi informado; NÃO peça o CPF de novo.');
    } else {
      linhas.push(
        // Com um motivo de encerramento configurado, o atendimento que começou
        // e terminou em "quero o boleto" não vai mais para a fila: a própria
        // IA fecha. Sem motivo, tudo continua como antes.
        config.triageResolvedReasonId
          ? [
            `Identidade JÁ confirmada: NÃO peça CPF${nemDataDeNascimento}. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix. NÃO conclua a triagem nesse momento.`,
            // Os modelos de frase da entrega NÃO ficam aqui (teste real
            // 2026-09-15: com o exemplo "Enviei acima o boleto..." no prompt, o
            // modelo copiou a frase sem chamar enviar_boleto e o cliente não
            // recebeu nada). A frase sai da própria ferramenta, no campo
            // instrucao, só depois de ela ter enviado de verdade.
            'Depois de entregar, responda EXATAMENTE no modelo que a ferramenta devolver no campo instrucao. NUNCA diga que enviou o boleto ou o PIX antes de a ferramenta confirmar o envio (enviado: true): sem essa confirmação, nada chegou ao cliente.',
            'Se depois disso ele agradecer ("obrigado", "valeu"): chame encerrar_atendimento e responda no modelo: "Imagina, Willemberg! 😊 Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" (à noite, "Tenha uma boa noite!"). Se responder só "ok", "certo" ou um joinha: chame encerrar_atendimento e responda: "Qualquer dúvida sobre o pagamento ou se precisar de ajuda com a internet, pode chamar a gente por aqui. Tenha um ótimo dia!" Se pedir outra coisa, siga a triagem normalmente e encerre só quando ele agradecer ou confirmar que está tudo certo. No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji ("Imagina, Willemberg! Qualquer dúvida…").',
          ].join('\n')
          : `Identidade JÁ confirmada: NÃO peça CPF${nemDataDeNascimento}. Se o cliente pedir apenas o boleto ou o PIX, entregue com enviar_boleto ou gerar_pix e depois conclua a triagem para o Financeiro.`,
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
    // Decisão do dono (2026-09-16): "quantos dias estou em atraso?" pode ser
    // respondido — ficou sem resposta num print e o cliente só queria saber.
    'Com identidade confirmada você pode dizer há quantos dias/meses a fatura está vencida e quantas faturas estão em aberto (use a data de hoje, no alto, para contar). Continua proibido dizer o VALOR.',
    'NUNCA diga ao cliente: valores e vencimentos de faturas, plano contratado ou endereço (isso vai só para o resumo). Exceções, SÓ com identidade confirmada: perguntar de qual ponto ele fala, dizer se existe ou não fatura em aberto, e dizer o status do contrato e da conexão no fluxo de SUPORTE abaixo. Nunca diga "pagamento confirmado"; nunca prometa prazos ou "um técnico vai".',
    'Preço, planos e cobertura: informe SOMENTE o que estiver escrito nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO abaixo, exatamente como está lá. Se não houver instruções ou o que o cliente pergunta não constar nelas, não invente: diga que o Comercial confirma e encaminhe.',
    // Prints 2026-09-16 (dois atendimentos reais): "quero a senha do meu
    // vizinho" virou chamado no Suporte, e "minha internet não pega no canto
    // da rua" virou encaminhamento sem explicação nenhuma. Encaminhar tinha
    // virado a saída padrão para tudo o que a IA não sabia resolver.
    // Prints 2026-09-16: "tem uma luz vermelha no roteador do meu vizinho" e
    // "quero tirar o QR code porque fica passando a senha do MEU Wi-Fi"
    // receberam os dois a recusa de dado de terceiro. A regra virou gatilho
    // cego para qualquer menção a outra pessoa ou à palavra senha.
    'A recusa abaixo vale só quando ele PEDIR um dado de outra pessoa. Relatar problema do vizinho ("o roteador dele está com luz vermelha", "ele me pediu para falar com vocês") NÃO é pedido de dado: atenda o relato normalmente. E a senha da rede DELE mesmo, do contrato dele, é pedido legítimo — nunca recuse.',
    'DADOS DE OUTRA PESSOA: senha do Wi-Fi, dados cadastrais, endereço ou informação de vizinho, parente ou outro cliente NUNCA são passados e NUNCA viram chamado — não encaminhe nem diga que a equipe vai ver. Recuse na hora, no modelo: "Não consigo passar dados de outro cliente, nem a senha da rede dele — só o titular pode informar isso. Posso te ajudar com alguma coisa do seu contrato?" Se ele insistir em falar com um atendente, conclua com o resumo começando por "Pedido de dado de outra pessoa; recusado na triagem".',
    // Decisão do dono (2026-09-16): a segunda via no site do SGP sai só com o
    // CPF, então pedir o boleto do amigo é atendimento normal. O que não pode
    // é o contato de quem pediu virar o titular (print do mesmo dia).
    // Print 2026-09-17: "o boleto da cliente Laureny Araújo" + CPF → a IA
    // respondeu "Laureny, seu atendimento vai para o Financeiro", chamando
    // quem estava falando pelo nome do titular.
    'Se ele citar o NOME de outra pessoa junto com o pedido ("a fatura da cliente Laureny", "o boleto do meu marido"), isso já é pedido de terceiro: passe titularEOutraPessoa: true e nunca chame quem está falando pelo nome do titular.',
    'FATURA, BOLETO OU PIX DE OUTRA PESSOA é a exceção: se ele disser que é de outra pessoa ("quero a fatura do Jureildson", "o boleto do meu marido"), peça o CPF do titular e chame buscar_cliente com titularEOutraPessoa: true. Depois siga normalmente (consultar fatura, enviar boleto ou PIX). NUNCA diga "seu contrato" nem "sua fatura" nesse caso: diga que localizou o contrato no CPF informado e, ao entregar, diga de quem é o boleto. Continue chamando quem fala pelo nome dela, nunca pelo nome do titular.',
    'Nunca encaminhe deixando a pergunta dele sem resposta: responda primeiro com o que você sabe (ou com o que dizem as instruções da operação) e só então diga que está encaminhando. "Vou encaminhar" sozinho, sem nada antes, é atendimento ruim.',
    'Ao pedir um esclarecimento, pergunte direto o que você precisa saber — nunca "me diga qual problema para eu encaminhar ao setor correto". O encaminhamento não se anuncia antes de acontecer.',
    // Com a leitura de dia ligada, perguntar antes de ler é exatamente o que
    // a flag elimina: a ferramenta abre a imagem e a conferência vai para o
    // resumo. O que a ferramenta apurar NUNCA vira promessa ao cliente — de
    // dia não existe liberação nenhuma.
    config.triageReadReceiptsDaytime && !(triagem && triagem.noturno && triagem.noturno.ativo)
      ? 'COMPROVANTE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Qualquer que seja o resultado, NÃO confirme pagamento nem prometa liberação: agradeça, diga que a equipe confere e dá baixa, e conclua para o Financeiro (motivo "Comprovante" se existir). Se a ferramenta disser que o comprovante já foi utilizado, NÃO diga isso ao cliente: responda o mesmo acolhimento e conclua — a equipe trata.'
      : 'Se o cliente enviou uma imagem, pergunte se é um comprovante e, se for, classifique Financeiro / Comprovante sem confirmar pagamento.',
    '',
    // Roteiros de SUPORTE ditados pelo dono (2026-09-13) depois do teste real
    // em que a IA encaminhou sem consultar nada: primeiro o status, depois
    // UMA pergunta de diagnóstico, e só então o encaminhamento.
    // Print 2026-09-17 (16:32): "quero pagar minha internet" + CPF recebeu o
    // roteiro do contrato suspenso, com "você chegou a fazer esse pagamento?"
    // — a cliente acabou de dizer que QUER pagar, não que pagou.
    'PEDIDO DE PAGAMENTO ("quero pagar", "quero o boleto", "quero o PIX", "quero quitar", "como faço para pagar") tem prioridade sobre qualquer roteiro de diagnóstico: entregue o boleto ou o PIX AGORA (enviar_boleto ou gerar_pix), mesmo com o contrato suspenso — a pendência é justamente o que ele está resolvendo. NUNCA pergunte "você chegou a fazer esse pagamento?" a quem acabou de dizer que quer pagar.',
    'SUPORTE — RELATO DE FALHA (internet lenta, caindo, sem acesso, velocidade abaixo da contratada, "está com problema"), cliente com identidade confirmada: ANTES de responder, chame consultar_status_todos_contratos (UMA chamada, cobre todos os contratos) e siga a instrução que ela devolver. Sem emoji. Depois responda por UM destes modelos, adaptando o nome:',
    // Print 2026-09-16: "posso mudar o roteador de lugar?" abriu com
    // "verifiquei que seu contrato está ativo e sua conexão aparece online".
    // Status é para falha; dúvida se responde direto.
    'DÚVIDA não é falha ("posso mudar o equipamento de lugar?", "quantos aparelhos aguenta?", "como troco a senha?", "o que é X?"): NÃO chame status, NÃO cite status ("contrato ativo", "conexão online") e responda a dúvida direto. Explicação geral de como o serviço funciona você pode dar; qualquer coisa específica da operação (preço, prazo, política, equipamento fornecido) só se estiver nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO.',
    // Mesmo dia: a cliente disse "contratei 500 mega e aparece 20" e a IA
    // perguntou "está sem acesso, com lentidão ou caindo?".
    'Se o cliente JÁ disse qual é o problema (lentidão, velocidade menor que a contratada, cai à noite, sem acesso em um cômodo), NÃO pergunte "está totalmente sem acesso, com lentidão ou a conexão fica caindo?": vá direto ao roteiro daquele problema. Perguntar o que ele acabou de dizer é o pior erro de atendimento.',
    '- Contrato ativo e conexão online: "Verifiquei aqui que seu contrato está ativo e sua conexão aparece online no momento. Mesmo assim, você pode estar enfrentando alguma dificuldade para usar a internet. Me conta: está totalmente sem acesso, com lentidão ou a conexão fica caindo?" Depois da resposta dele, se não houver mais nada para responder, conclua para o Suporte com o relato no resumo.',
    '- Conexão offline: "Verifiquei aqui que sua conexão está offline no momento. Vou te ajudar a verificar o que está acontecendo. Os equipamentos da internet estão ligados? Tem alguma luz vermelha acesa ou piscando?" Depois da resposta dele, se não houver mais nada para responder, conclua para o Suporte com o relato no resumo.',
    '- Contrato suspenso por falta de pagamento, só quando ele RELATAR falta de acesso (nunca quando ele pediu para pagar): "Verifiquei aqui e consta uma pendência na fatura que deixou o acesso à internet temporariamente suspenso. Pode ser que você já tenha pago e a confirmação ainda não tenha chegado ao sistema. Você chegou a fazer esse pagamento? Assim consigo te orientar no próximo passo." Se ele disser que pagou, peça o comprovante e conclua para o Financeiro (motivo Comprovante, se existir); se disser que não pagou, ofereça o PIX ou o boleto (entregue se ele quiser) e conclua para o Financeiro.',
    // Print 2026-09-16: "não pega no canto da rua" / "some quando saio de
    // casa" caiu no roteiro de falha (conexão online → uma pergunta →
    // encaminhar) e o cliente saiu sem entender nada. Alcance de Wi-Fi é
    // comportamento normal e merece explicação, não chamado cego.
    'ALCANCE DO WI-FI: perda de sinal ao se AFASTAR (quintal, portão, canto da rua, cômodo distante, "some quando saio de casa") NÃO é falha de conexão — é o alcance normal do Wi-Fi. Não peça reinício de equipamento nem trate como defeito. Responda no modelo: "O Wi-Fi tem alcance limitado: a distância e as paredes vão enfraquecendo o sinal, por isso ele some quando você se afasta. Dentro de casa, perto do equipamento, a internet está funcionando bem?" Se ele confirmar que dentro de casa funciona, está tudo normal: NÃO abra chamado — diga que é o comportamento esperado do Wi-Fi e pergunte se precisa de mais alguma coisa. Só conclua para o Suporte se ele quiser melhorar o alcance (resumo: "quer melhorar o alcance do Wi-Fi") ou se disser que dentro de casa também está ruim. Nunca prometa visita técnica nem equipamento. Se as INSTRUÇÕES ADICIONAIS DA OPERAÇÃO disserem o que a empresa oferece nesse caso (repetidor, ponto extra), siga exatamente o que está lá; se não disserem nada, não ofereça nada.',
    // Print 2026-09-16: "contratei 500 mega, no celular aparece 20, quero o
    // restante e o reembolso" — a IA ignorou o relato E o pedido de reembolso.
    'VELOCIDADE ABAIXO DA CONTRATADA ("contratei 500 e aparece 20", "não chega a velocidade que pago"): responda no modelo: "A velocidade do plano é entregue até o equipamento e medida por cabo. No Wi-Fi ela sempre chega menor, porque a distância, as paredes e o próprio aparelho limitam o sinal — por isso o número que aparece no celular fica abaixo do contratado. Para a gente comparar direito: você consegue fazer um teste de velocidade perto do equipamento?" Depois da resposta, conclua para o Suporte com o valor medido e o relato no resumo. NUNCA diga que a velocidade está correta sem teste, nem prometa técnico.',
    'REEMBOLSO, DESCONTO OU ABATIMENTO: nunca prometa e nunca recuse — quem decide é a equipe. Diga que registrou o pedido para o atendente avaliar, escreva "Cliente pediu reembolso/desconto" no resumo, e siga atendendo o problema técnico normalmente.',
    // Mesmo dia: "quero mudar meu roteador de lugar, posso?" virou consulta de
    // status + uma pergunta inútil + encaminhamento sem responder.
    'MUDAR O EQUIPAMENTO DE LUGAR: responda direto, sem consultar status: "Pode sim, e você mesma pode fazer: só precisa de uma tomada no novo ponto e que o cabo alcance. Quanto mais central o equipamento ficar, melhor o Wi-Fi na casa toda. Se o cabo não alcançar ou precisar passar por parede, é serviço técnico e nossa equipe avalia." Se ela disser que o cabo não alcança ou pedir ajuda para mudar, conclua para o Suporte com isso no resumo; se ela só queria saber se pode, não encaminhe — pergunte se precisa de mais alguma coisa.',
    // Print 2026-09-16: "tô tentando assistir um filme há uma hora, não carrega
    // no Globoplay" recebeu "está sem acesso, com lentidão ou caindo?" — o
    // relato não tinha roteiro próprio e o modelo voltou para a lista fixa.
    // Mesmo print: ele respondeu "Lentidão" e a IA não tinha para onde ir.
    'Quando ele responder à pergunta de diagnóstico, SIGA a partir da resposta: "lentidão" ou "está lento" leva ao roteiro de VELOCIDADE ABAIXO DA CONTRATADA (peça o teste de velocidade perto do equipamento); "sem acesso" leva às verificações de equipamento; "fica caindo" leva a perguntar se cai em todos os aparelhos e em que horário. Em nenhum caso repita a pergunta.',
    'PROBLEMA JÁ RELATADO SEM ROTEIRO PRÓPRIO (vídeo travando ou não carregando, jogo com travamento, aplicativo que não abre, cai só em um cômodo): NÃO use a lista fixa de diagnóstico. Comece pelo que ele disse — repita o problema com as palavras dele para mostrar que entendeu —, diga o que você verificou, e faça UMA pergunta que faça sentido para AQUELE problema. Para vídeo travando ou não carregando: "acontece só nesse aplicativo ou em tudo (outros vídeos, sites)?" e, se ajudar, "os outros aparelhos da casa estão iguais?". Depois da resposta, conclua para o Suporte com o relato no resumo.',
    // Decisão do dono (2026-09-16): existe o setor Reativação para quem está
    // com vários meses em atraso, e é lá que as promoções acontecem.
    // Regra do dono ajustada em 2026-09-17: o corte é 90 dias, não dois meses.
    'REATIVAÇÃO: cliente com mais de 90 dias em atraso (a fatura mais antiga venceu há mais de 90 dias, conte pela data de hoje), ou com o contrato já cancelado, vai para o setor de Reativação (se ele existir na lista de setores) — não para o Financeiro. Até 90 dias continua sendo Financeiro. Se ele perguntar por promoção, condição especial ou desconto para voltar, diga que a Reativação cuida disso e encaminha; nunca invente promoção, desconto ou valor, e nunca diga que "não trabalha com promoções".',
    // Mesmo dia: "quitando o débito a internet já volta a funcionar?" ficou
    // sem resposta e a IA mandou o Pix por cima da pergunta.
    'Se o cliente suspenso perguntar se a internet volta depois de pagar, responda: "Sim — assim que o pagamento for confirmado, o acesso é liberado automaticamente." NUNCA prometa prazo (minutos, horas, "na hora"), e nunca diga que o pagamento foi confirmado.',
    // Mesmo dia: pedido do QR code da própria rede recebeu a recusa de dado
    // de terceiro, e outro pedido igual virou encaminhamento seco.
    'SENHA OU QR CODE DO WI-FI DO PRÓPRIO CLIENTE: é pedido normal de Suporte. Responda que a senha fica no equipamento (normalmente numa etiqueta atrás dele) e que a equipe ajuda a trocar a senha ou a gerar o QR code da rede, e conclua para o Suporte com o pedido no resumo. Nunca trate isso como dado de outra pessoa.',
    // Mesmo dia: "fica ruim de noite, das nove em diante trava tudo na TV"
    // caiu na lista fixa de diagnóstico.
    'PIORA EM HORÁRIO CERTO ("ruim só de noite", "depois das 9 trava", "de dia é boa"): não trate como falha geral. Reconheça o padrão e pergunte quantos aparelhos costumam estar usando nesse horário e se acontece em todos eles ou só na TV. Depois da resposta, conclua para o Suporte com o horário e o relato no resumo.',
    // Mesmo dia: "eu e minha vizinha dividimos internet, o roteador fica na
    // casa dela" virou encaminhamento seco.
    'EQUIPAMENTO NA CASA DE OUTRA PESSOA (internet dividida com vizinho ou parente, roteador em outra casa): é alcance de Wi-Fi, não falha. Explique que o sinal precisa atravessar a distância e as paredes entre as duas casas e que por isso chega fraco, e que o contrato é atendido no endereço onde o equipamento está instalado. Conclua para o Suporte com isso no resumo.',
    'DADOS MÓVEIS (2G, 3G, 4G, 5G): se ele disser que está conectado nos dados do celular, avise com cuidado que aí ele não está usando a internet da casa, e peça que teste conectado ao Wi-Fi antes de qualquer diagnóstico.',
    'Fim de roteiro NÃO é automático: só conclua quando não houver mais nada para responder. Se a última mensagem dele traz uma pergunta, responda-a na mesma mensagem em que encaminha.',
    `Sem identidade confirmada, o fluxo de Suporte não cita status nenhum: identifique primeiro (CPF${eDataDeNascimento}) ou apenas encaminhe.`,
    '',
    // Roteiros de COMERCIAL ditados pelo dono (2026-09-13) depois do teste real
    // em que a IA confirmou a cobertura, engoliu os planos que estavam nas
    // instruções adicionais e encaminhou. Planos e cidades vêm SÓ de lá.
    // Teste real 2026-09-15 (print do dono): a IA pediu bairro/rua três vezes
    // e, quando o cliente perguntou "qual é o melhor?", encaminhou sem
    // responder (era o turno forçado pelo limite). Roteiro ditado pelo dono:
    // endereço é UMA pergunta, confirma o que veio e pede só o que falta uma
    // vez, responde antes de encaminhar, frases de encaminhamento de dia e de
    // noite. Planos e cidades continuam vindo SÓ das instruções.
    'COMERCIAL (cobertura, planos, contratar, mudar de plano): responda com o que estiver nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO. Planos: copie o bloco de planos EXATAMENTE como está escrito nas instruções (mesmas linhas, mesmos ícones, mesmos preços); se lá não houver um bloco pronto, liste um plano por linha no formato "• 500 Mega por R$ 100/mês". Nunca peça CPF de cliente novo. Cobertura: se a cidade estiver nas instruções, atendemos em TODOS os bairros e ruas dela. Pergunta de cobertura de cliente novo ("tem internet em X?"): responda "Atendemos em X!" e, NA MESMA mensagem, emende a abertura de cliente novo (planos e a pergunta de endereço) — a pergunta de cobertura é o começo da venda, não o fim. NUNCA encaminhe um cliente novo na primeira resposta se a cidade estiver na lista. Se a cidade NÃO estiver na lista de cobertura, diga que o Comercial confirma a cobertura e conclua para o Comercial, sem inventar. Modelos:',
    // Print 1 (teste real 2026-09-14): quem já é cliente e queria outro ponto
    // caía no roteiro de cliente novo, e a IA despejava a lista inteira de
    // cidades atendidas em vez de confirmar a dele.
    `Se ele disser que JÁ é cliente e quer outro ponto ou mudar de plano, identifique primeiro (CPF${eDataDeNascimento}) e use o roteiro de cliente identificado. Não liste todas as cidades atendidas: pergunte a cidade e o bairro dele e confirme só a dele.`,
    [
      '- Cliente NOVO (não identificado): "Boa noite! 😊 Temos planos de internet 100% fibra óptica:',
      '',
      '[bloco de planos copiado das instruções]',
      '',
      'Instalação grátis.',
      '',
      'Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua." (saudação da hora; "Que bom ter você por aqui 😊" pode entrar depois da saudação).',
      'Endereço é UMA pergunta só (bairro e rua juntos). Se ele responder só uma parte, confirme o que veio e peça só o que falta, UMA vez: "Perfeito, Centro de Godofredo Viana 👍 Qual é a rua onde deseja instalar?" Nunca peça a mesma coisa uma terceira vez. Se ele mudar de assunto ou perguntar algo, responda e siga sem voltar a cobrar o endereço. Não é preciso ter o endereço completo para encaminhar.',
      'Se ele perguntar qual plano é o melhor ou pedir indicação: se as instruções trouxerem critério de recomendação, recomende um plano com uma frase de motivo; se não trouxerem, explique que a diferença é só a velocidade (todos fibra) e pergunte quantas pessoas ou aparelhos vão usar, para o Comercial já receber isso. Nunca encaminhe deixando uma pergunta dele sem resposta: responda primeiro, na mesma mensagem.',
    ].join('\n'),
    [
      '- Cliente JÁ identificado: "Boa tarde, Willemberg! Claro, vou te ajudar a conhecer nossos planos 😊 Temos estas opções:',
      '',
      '• 500 Mega por R$ 100/mês',
      '• 600 Mega por R$ 135/mês',
      '• 800 Mega por R$ 185/mês',
      '',
      'Qual deles você tem interesse em contratar? Com sua escolha, encaminho para o Comercial verificar a alteração no seu contrato e continuar o atendimento por aqui." Depois da escolha, conclua para o Comercial com o plano escolhido no resumo.',
    ].join('\n'),
    // Print 2026-09-15 (21:16): "tem internet em Viseu?" → "Atendemos em Viseu.
    // Certo! Vou encaminhar você para o Comercial." — encaminhou na primeira
    // resposta, sem planos nem endereço, e com um "Certo!" solto. O momento de
    // encaminhar fica explícito, e o "Certo!" só responde a um pedido.
    // Print 2026-09-17: "quais dados preciso para fazer meu cadastro?" virou
    // encaminhamento seco. A lista fica nas instruções da operação.
    'O QUE PRECISA PARA FAZER O CADASTRO ("quais dados/documentos preciso", "o que preciso levar"): se as INSTRUÇÕES ADICIONAIS DA OPERAÇÃO trouxerem a lista de documentos ou dados necessários, responda com a lista exatamente como está lá e pergunte se ele quer seguir com a contratação. Se lá não houver nada sobre isso, diga em uma frase que o Comercial confirma a documentação e encaminhe — mas NÃO encaminhe sem responder alguma coisa.',
    // Print 2026-09-16: "quero mudar minha internet de endereço, vou embora
    // pra outra casa, o que eu faço?" recebeu só "o atendimento vai para o
    // Comercial" — pergunta sem resposta, e é um dos pedidos mais comuns.
    'MUDANÇA DE ENDEREÇO ("vou me mudar", "quero levar a internet para outra casa"): isso é a transferência do ponto. Responda no modelo: "Claro! Mudança de endereço a gente chama de transferência do ponto. Para o Comercial já adiantar, me diz o novo endereço (cidade, bairro e rua) e a data prevista da mudança?" NÃO encaminhe sem pedir isso — com a resposta, conclua para o Comercial com o endereço novo e a data no resumo. Prazo, custo e disponibilidade quem confirma é o Comercial: não invente nenhum dos três.',
    'Encaminhe ao Comercial SOMENTE quando: ele escolher um plano ou pedir para contratar; ou já tiver dado o endereço; ou pedir para falar com um atendente; ou a cidade não estiver na lista. Antes disso, continue a venda (planos, endereço, dúvidas). O "Certo!" do modelo é só quando ele pediu algo (contratar, falar com atendente); senão comece direto em "Vou encaminhar...".',
    // Frases de encaminhamento ao Comercial ditadas pelo dono (2026-09-15);
    // a da noite não cita hora de retorno de propósito.
    (triagem && triagem.noturno && triagem.noturno.ativo)
      ? 'Ao encaminhar para o Comercial (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar seu atendimento para nossa equipe Comercial. No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem. Resumo: plano de interesse, cidade, bairro/rua se tiver, e o que ele contou.'
      : 'Ao encaminhar para o Comercial (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar você para o Comercial. Um atendente continuará o atendimento por aqui." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem. Resumo: plano de interesse, cidade, bairro/rua se tiver, e o que ele contou.',
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
        ? 'LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente. Se você já tem o que precisa para entregar boleto ou PIX, entregue AGORA e chame encerrar_atendimento, dizendo que qualquer outra coisa é só chamar de novo. Se não tem, chame concluir_triagem com o que apurou. Se ele fez uma pergunta nesta mensagem, responda-a ANTES de dizer que está encaminhando, na mesma mensagem.'
        : 'LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente. Se você já tem o que precisa para entregar boleto ou PIX, entregue AGORA (enviar_boleto ou gerar_pix) e em seguida chame concluir_triagem. Se não tem, chame concluir_triagem com o que apurou. Se ele fez uma pergunta nesta mensagem, responda-a ANTES de dizer que está encaminhando, na mesma mensagem.'
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

async function runAiTurn({ conversation, contact, perfil = 'assistente', identidade, triagem, origemMensagem, avisoCidade = null }) {
  const iniciadoEm = Date.now();
  const config = await getAiConfig();
  // Uma leitura por turno: o nome da empresa é configuração, não constante —
  // o sistema roda em mais de um provedor.
  const empresa = await getCompanyConfig();

  let tools;
  let contexto;
  let systemContent;

  if (perfil === 'triagem') {
    tools = toOpenAiTools(ferramentasDaTriagem(triagem, config));
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
      identidade: identidadeEfetiva, channelId: conversation.channelId, ferramentasPermitidas: ferramentasDaTriagem(triagem, config), registroFerramentas: [],
      triagem, origemMensagem, resolvidoPelaIa: false, triagemConcluida: null,
    };
    systemContent = await montarContextoTriagem(config, identidadeEfetiva, triagem, avisoCidade, empresa.name);
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
  // Anúncio sem conclusão (teste real do Suporte, 2026-09-13): o modelo
  // escreveu "vou encaminhar para o Suporte" e não chamou concluir_triagem —
  // só encaminhou no turno seguinte, depois de um "OK" do cliente. Quando o
  // texto final anuncia encaminhamento e a triagem não concluiu, o laço dá
  // UMA volta a mais, obrigando concluir_triagem antes de qualquer envio.
  let exigiuConclusaoPorAnuncio = false;
  // Limite de ferramentas na triagem (teste real 2026-09-13): com vários
  // contratos, 2N consultas estouram o teto e o caminho antigo fazia a IA
  // dizer "não consegui confirmar o status da conexão". Em vez disso, o limite
  // obriga concluir_triagem UMA vez; se o modelo ignorar, cai no caminho antigo.
  let exigiuConclusaoPorLimite = false;
  // Uma única correção por turno: se o modelo insistir na afirmação falsa
  // depois de corrigido, o texto sai como está em vez de o laço girar sem fim.
  let corrigiuLiberacao = false;
  // Envio anunciado sem ferramenta de entrega. Uma vez por turno: se o modelo
  // insistir em prometer sem entregar, o texto sai como está em vez de o laço
  // girar sem fim.
  let exigiuEntregaPorAnuncio = false;
  let proximoToolChoice;

  try {
    while (true) {
      if (Date.now() - iniciadoEm > TURNO_MAX_MS) {
        erro = 'turn_timeout';
        break;
      }

      const toolChoice = proximoToolChoice
        || (perfil === 'triagem' && primeiraChamada && triagem && triagem.forcarConclusao ? 'required' : undefined);
      proximoToolChoice = undefined;
      primeiraChamada = false;

      const { message, usage } = await createChatCompletion({
        apiKey: config.apiKey, model: config.model, messages, tools, toolChoice,
      });
      promptTokens += usage.promptTokens || 0;
      completionTokens += usage.completionTokens || 0;

      const chamadas = message.tool_calls || [];
      if (chamadas.length === 0) {
        const conteudo = message.content || null;
        // Antes da guarda de anúncio: uma liberação afirmada sem ter
        // acontecido é o erro mais caro da noite — o cliente vai testar a
        // internet e ela continua fora.
        if (
          perfil === 'triagem' && conteudo && !corrigiuLiberacao
          && !contexto.desbloqueioRealizado && afirmaLiberacao(conteudo)
        ) {
          // contexto.desbloqueioRealizado só conhece ESTE turno. A liberação
          // pode ter acontecido no turno anterior — o cliente volta e pergunta
          // "foi liberado?" —, e aí a afirmação é VERDADEIRA: corrigi-la seria
          // mentir ao cliente sobre algo que aconteceu de verdade. Por isso o
          // banco é a segunda fonte, e a resposta fica guardada na marca do
          // turno para não consultar duas vezes no mesmo turno.
          const jaLiberado = await hasRecentTrustUnlockByContact(
            contexto.contact && contexto.contact.id, LIBERACAO_RECENTE_MS
          );
          if (jaLiberado) {
            contexto.desbloqueioRealizado = true;
          } else {
            corrigiuLiberacao = true;
            messages.push({ role: 'assistant', content: conteudo });
            messages.push({
              role: 'system',
              content: 'Você afirmou uma liberação que NÃO aconteceu neste atendimento. Responda de novo, sem afirmar liberação: diga que não conseguiu liberar o acesso agora, que o pedido/comprovante fica registrado para a equipe conferir no horário de retorno, e que a liberação é automática quando o pagamento for confirmado.',
            });
            const final = await createChatCompletion({ apiKey: config.apiKey, model: config.model, messages, tools: [] });
            promptTokens += final.usage.promptTokens || 0;
            completionTokens += final.usage.completionTokens || 0;
            texto = final.message.content || null;
            if (!texto) {
              erro = 'empty_model_response';
              break;
            }
            // O texto corrigido promete ao cliente que o pedido "fica
            // registrado para a equipe conferir". Sem concluir_triagem isso é
            // falso: a conversa fica na automação, não na fila. Então a
            // correção não encerra o turno — ela exige a conclusão em seguida,
            // e o texto final ao cliente sai do caminho de conclusão que já
            // existe. exigiuConclusaoPorAnuncio isenta essa volta do teto de
            // ferramentas (como as outras conclusões forçadas) e impede que a
            // guarda de fila/anúncio exija a conclusão uma segunda vez.
            if (!contexto.triagemConcluida && !contexto.atendimentoEncerrado) {
              exigiuConclusaoPorAnuncio = true;
              messages.push({ role: 'assistant', content: texto });
              messages.push({
                role: 'system',
                content: 'Agora chame concluir_triagem para o Financeiro com o resumo (comprovante/desbloqueio recusado) e responda ao cliente em uma frase.',
              });
              proximoToolChoice = 'concluir_triagem';
              continue;
            }
            break;
          }
        }
        // Antes da guarda de encaminhamento: o que o cliente pediu foi o Pix
        // (ou o boleto), e é ele que falta. A conclusão, se for o caso, ainda
        // cabe na volta seguinte — e o worker conclui em código de qualquer jeito.
        if (
          perfil === 'triagem' && conteudo && !exigiuEntregaPorAnuncio
          && !contexto.resolvidoPelaIa && afirmaEnvio(conteudo)
        ) {
          exigiuEntregaPorAnuncio = true;
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({
            role: 'system',
            content: 'Você disse que vai enviar, mas não chamou gerar_pix/enviar_boleto. Chame a ferramenta de entrega AGORA (o contrato único, ou o escolhido) e depois responda.',
          });
          proximoToolChoice = 'required';
          continue;
        }
        if (
          perfil === 'triagem' && conteudo && !exigiuConclusaoPorAnuncio
          && !contexto.triagemConcluida && !contexto.atendimentoEncerrado
          && (anunciaEncaminhamento(conteudo) || afirmaFila(conteudo))
        ) {
          exigiuConclusaoPorAnuncio = true;
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({
            role: 'system',
            content: 'Você anunciou o encaminhamento mas NÃO chamou concluir_triagem. Chame concluir_triagem AGORA, com o setor e o resumo do que apurou. Depois responda ao cliente em uma frase.',
          });
          proximoToolChoice = 'concluir_triagem';
          continue;
        }
        texto = conteudo;
        // Sem tool_calls e sem texto utilizável (corte por content_filter,
        // turno vazio etc.) não é sucesso silencioso: sem isto, quem consome
        // o retorno não teria como distinguir "respondeu" de "falhou", e a
        // auditoria registraria a mesma ambiguidade.
        if (!texto) erro = 'empty_model_response';
        break;
      }

      // A conclusão forçada (por limite ou por anúncio sem conclusão) não pode
      // cair no limite que a provocou: só ELA passa — uma volta espontânea
      // que também só peça concluir_triagem continua sujeita ao teto, senão um
      // modelo teimoso só seria barrado pelo TURNO_MAX_MS.
      const soConclusao = perfil === 'triagem' && (exigiuConclusaoPorLimite || exigiuConclusaoPorAnuncio)
        && chamadas.length > 0 && chamadas.every((c) => c.function.name === 'concluir_triagem');
      // Irmã da isenção acima, pelo mesmo motivo: a volta que exige a entrega
      // anunciada não pode morrer no teto que o próprio turno já gastou — seria
      // devolver ao cliente exatamente a promessa sem o Pix que a guarda existe
      // para fechar. Só ELA passa, e só com ferramentas de entrega: uma chamada
      // espontânea de gerar_pix depois do teto continua barrada.
      const soEntrega = perfil === 'triagem' && exigiuEntregaPorAnuncio
        && chamadas.length > 0 && chamadas.every((c) => FERRAMENTAS_DE_ENTREGA.includes(c.function.name));
      if (!soConclusao && !soEntrega && toolsRequested.length + chamadas.length > config.maxToolsPerInteraction) {
        erro = 'tool_limit_reached';
        // Na triagem que ainda não concluiu, o limite vira uma ordem de
        // concluir — nunca um pedido de desculpas ao cliente. O resumo interno
        // é onde entra o que não deu para consultar; o atendente lê, o cliente não.
        if (
          perfil === 'triagem' && !exigiuConclusaoPorLimite
          && !contexto.triagemConcluida && !contexto.atendimentoEncerrado
        ) {
          exigiuConclusaoPorLimite = true;
          messages.push({
            role: 'system',
            content: 'Limite de consultas deste turno. Chame concluir_triagem AGORA, com o setor adequado e o resumo do que apurou (inclua o que não pôde consultar no resumo, para o atendente). Ao cliente, responda a pergunta dele se houver (com o que já sabe) e diga que está encaminhando para o setor — NUNCA que não conseguiu verificar algo.',
          });
          proximoToolChoice = 'concluir_triagem';
          continue;
        }
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
          // `instrucao` é o campo oposto: texto escrito à mão para o modelo
          // ler (defeito D — sem ele, a recusa seca fazia o modelo improvisar).
          toolsRefused.push({ nome, motivo: resposta.motivo, detalhe: resposta.detalhe });
          messages.push({
            role: 'tool',
            tool_call_id: chamada.id,
            content: JSON.stringify({
              erro: resposta.motivo,
              ...(resposta.instrucao ? { instrucao: resposta.instrucao } : {}),
            }),
          });
        }
      }
    }
  } catch (err) {
    erro = err.message;
  }

  // Depois do laço, antes da auditoria: vale para os dois perfis, e o que fica
  // gravado (finalResponse) é o que o cliente/atendente recebe de fato.
  const portugues = await garantirPortugues({ texto, messages, config, iniciadoEm, conversationId: conversation.id });
  texto = portugues.texto;
  promptTokens += portugues.tokens.prompt;
  completionTokens += portugues.tokens.completion;

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
    // O worker usa isto para saber se pode mandar a frase de sucesso por
    // código quando o turno estoura o tempo antes da resposta final.
    desbloqueioRealizado: Boolean(contexto.desbloqueioRealizado),
    identidade: contexto.identidade || null,
  };
}

module.exports = { runAiTurn, FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO, FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA, ferramentasDaTriagem, afirmaLiberacao, afirmaFila, afirmaEnvio };
