const { createChatCompletion } = require('./openai-client');
const { executeTool } = require('./tool-executor');
const { toOpenAiTools } = require('./tool-registry');
const { montarContexto } = require('./prompt/montar');
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

function mascararArgsParaAuditoria(args) {
  if (!args || typeof args !== 'object') return args;
  const mascarado = { ...args };
  for (const chave of Object.keys(mascarado)) {
    if (CHAVE_DOCUMENTO.test(chave)) mascarado[chave] = maskDocument(mascarado[chave]);
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
  'buscar_cliente', 'esquecer_identificacao',
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
  return lista;
}

async function runAiTurn({ conversation, contact, perfil = 'assistente', identidade, triagem, origemMensagem, avisoCidade = null, terceiro = null, messageId = null }) {
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
    // Guarda defensiva: um identidade null/undefined não pode derrubar o turno
    // nem deixar contexto.contracts inconsistente com o que o contexto de
    // sistema viu. O compositor (src/ai/prompt) tem o mesmo fallback por
    // dentro, mas a lista de contratos que vai para o prompt é montada aqui.
    const identidadeEfetiva = identidade || { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
    // Perfil fixo: os contratos vêm da identidade já resolvida (Task 2), não
    // de uma nova consulta ao SGP via carregarContratos — o cache do turno
    // (contexto.contracts) é o que tool-executor.js usa para a checagem de
    // propriedade (chaveProprietario).
    contexto = {
      conversationId: conversation.id, contact, contracts: identidadeEfetiva.contracts || [], sgpCache: {},
      identidade: identidadeEfetiva, terceiro, channelId: conversation.channelId, ferramentasPermitidas: ferramentasDaTriagem(triagem, config), registroFerramentas: [],
      triagem, origemMensagem, resolvidoPelaIa: false, triagemConcluida: null,
      // A mensagem do cliente que abriu este turno. É a MESMA em todas as tool
      // calls do turno e em todas as voltas internas do laço — é isso que faz a
      // chave de reenvio de enviar_boleto/gerar_pix valer por pedido do
      // cliente, e não por chamada de ferramenta.
      messageId,
    };
    // Setores e motivos em paralelo: são duas consultas independentes e o
    // turno inteiro espera por elas antes da primeira chamada à OpenAI.
    const [setores, motivos] = await Promise.all([listSectors(), listActiveReasons()]);
    // montarContexto é SÍNCRONA — todo o I/O do prompt acontece aqui em cima,
    // no estado que ela recebe pronto.
    systemContent = montarContexto({
      config,
      identidade: identidadeEfetiva,
      contratos: (identidadeEfetiva.contracts || []).map(normalizeContract),
      triagem: triagem || { noturno: { ativo: false }, forcarConclusao: false },
      avisoCidade,
      empresa: empresa.name,
      ferramentas: ferramentasDaTriagem(triagem, config),
      setores,
      motivos,
      terceiro,
      agora: new Date(),
    });
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
                content: 'Agora chame concluir_triagem para o setor que cuidar de financeiro com o resumo (comprovante/desbloqueio recusado) e responda ao cliente em uma frase.',
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
          // em aberto"), senão um encaminhamento parece vazio. Este valor NUNCA
          // volta para o modelo — o que alimenta `messages`, duas linhas abaixo,
          // é JSON.stringify(resposta.resultado) por inteiro, sem corte nenhum.
          // O único consumidor de contexto.registroFerramentas é a linha
          // "Ferramentas:" do resumo (concluir_triagem/encerrar_atendimento em
          // tool-registry.js), e quem de fato enxuga esse texto para o
          // atendente é a função legivel() de lá: ela faz o parse, descarta os
          // campos `instrucao`/`proximoPasso` (texto para o MODELO, não para o
          // atendente) e corta o que sobra em 160 caracteres. O corte aqui
          // embaixo é só uma salvaguarda contra uma ferramenta futura devolver
          // algo gigante — Rodada de correção 1 (Task 11): 200 era estreito
          // demais e cortava no MEIO do JSON de enviar_boleto/gerar_pix (que
          // têm um `instrucao` longo), antes de legivel poder filtrar esse
          // campo; o resultado chegava a legivel já não sendo mais JSON
          // válido, e a linha do resumo virava fragmento cru. 2000 é folgado
          // o bastante para o formato real de qualquer ferramenta hoje.
          if (Array.isArray(contexto.registroFerramentas)) {
            const serializado = JSON.stringify(resposta.resultado);
            contexto.registroFerramentas.push({
              nome,
              resultado: serializado.length > 2000 ? `${serializado.slice(0, 2000)}…(truncado)` : serializado,
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
    // O harness de simulação encadeia roteiros e precisa do escopo de saída; o
    // worker ignora este campo, porque quem persiste é a própria ferramenta.
    terceiro: contexto.terceiro || null,
  };
}

module.exports = { runAiTurn, FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO, FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA, ferramentasDaTriagem, afirmaLiberacao, afirmaFila, afirmaEnvio };
