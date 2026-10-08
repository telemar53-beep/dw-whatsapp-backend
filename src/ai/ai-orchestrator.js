const { createChatCompletion } = require('./openai-client');
const { executeTool } = require('./tool-executor');
const { toOpenAiTools } = require('./tool-registry');
const { montarContexto } = require('./prompt/montar');
const { fatosDoAlvoFinanceiro } = require('./prompt/fluxos/alvo-financeiro');
const { getAiConfig, listToolPermissions } = require('./ai-config.repository');
const { recordAiInteraction, listAiInteractionsByConversation } = require('./ai-interaction.repository');
const { promessasSemEvidencia, respostaSemPromessas } = require('./promessas-sem-evidencia');
const { violacoesDaEntrega, respostaSemEntregaSemFato } = require('./anuncio-de-entrega');
const {
  meiosDaJanela, meiosDoTurno, respostaSemOfertaDeMeioInexistente, respostaSemIndisponibilidadeNaoConfirmada,
} = require('./meios-de-pagamento');
const { listRecentMessagesByConversation, findMessageById } = require('../conversations/message.repository');
const { resumoParaModelo, encontrarDisparoRelacionado, fatoDoDisparo } = require('../conversations/automatic-message');
const { linhasDoDisparoRecente } = require('./prompt/fluxos/disparo-recente');
const { listActiveReasons } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const { hasRecentTrustUnlockByContact } = require('./trust-unlock.repository');
const { violacoesDoPagamento, respostaSemAfirmacoes, correcaoDoPagamento } = require('./guarda-pagamento');
const { getCompanyConfig } = require('../company/company-config.repository');
const sgpClient = require('../integrations/sgp-client');
const { mensagemSegura } = require('./safe-error-log');
const { maskDocument, normalizeContract } = require('./sgp-normalizer');
const { temAlfabetoEstranho, semAlfabetoEstranho } = require('./idioma');
const {
  avisoExplicaReclamacao, contradizAviso, respostaSeguraDoAviso, suspensaoAfastaOAviso,
} = require('./regional-outage');
const {
  sinaisOperacionais, violacoesDaResposta, correcaoDaResposta, respostaSeguraDaContencao,
} = require('./contencoes-operacionais');
const {
  estadoDoDocumento, violacoesDoDocumento, correcaoDoDocumento, respostaSemRepetirDocumento, pedeDocumento, alvoDoPedido,
  pendenteAgora,
} = require('./documento-pendente');

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
// Pendências do atendimento (04/10/2026): a forma negada ("Não consegui encaminhar seu atendimento", "ainda não entrou na
// fila", "não deixei registrado") não é anúncio nem afirmação de sucesso — e não pede uma conclusão para cumpri-la. A
// negação vale colada ao verbo, com até uma palavra entre ("não consegui encaminhar"); "não" de outra oração não conta.
const NAO_NEGADO = String.raw`(?<!\bn[aã]o\s+(?:[^\s.,;:!?]+\s+)?)`;
const ANUNCIO_DE_ENCAMINHAMENTO = new RegExp([
  String.raw`${NAO_NEGADO}\bvou (te )?(encaminhar|transferir|direcionar|repassar|passar|levar|acionar)\b`,
  String.raw`${NAO_NEGADO}\bvou\b[^.!?\n]{0,80}\bsetor\b`,
  String.raw`${NAO_NEGADO}encaminh(ar|ando|ei) (o |a |seu |sua |este |esta )?(atendimento|solicita[çc][aã]o|pedido|caso|chamado)`,
  String.raw`${NAO_NEGADO}(direcionad|encaminhad|repassad)[oa] para o setor`,
  'um atendente (continua|vai continuar|d[aá] continuidade|dar[aá] continuidade)',
].join('|'), 'i');

function anunciaEncaminhamento(texto) {
  return ANUNCIO_DE_ENCAMINHAMENTO.test(String(texto || ''));
}

// À noite a IA responde sozinha: duas afirmações dela precisam de um fato do
// lado de cá antes de chegarem ao cliente — que o acesso foi liberado (só a
// ferramenta pode dizer) e que o atendimento já está na fila (só
// concluir_triagem pode dizer).
const AFIRMA_LIBERACAO = /desbloqueio (em confian[çc]a )?(foi |está )?(realizado|feito|conclu[íi]do)|acesso (foi |está )?liberado|liberei (seu|o) acesso|internet (foi |está )?liberada/i;
// Conclusão do atendimento (04/10/2026, revisão): "entrou na fila" é a frase de fila nova (instrução de sucesso e modelos).
// Avaliação real (04/10/2026, E7 #2): "vou deixar seu pedido registrado para um atendente" depois de uma conclusão que falhou.
// Pendências do atendimento (04/10/2026): a forma negada não é afirmação (NAO_NEGADO, acima).
const AFIRMA_FILA = new RegExp([
  String.raw`${NAO_NEGADO}deixei (seu |o )?(atendimento|caso|pedido) (na|em) fila`,
  String.raw`${NAO_NEGADO}registr(ei|ado) (seu |o )?(atendimento|caso|pedido) para a equipe`,
  String.raw`${NAO_NEGADO}já está na fila`,
  String.raw`${NAO_NEGADO}entrou na fila`,
  String.raw`${NAO_NEGADO}(vou deixar|deixei|deixo) (o |seu |sua |a )?(atendimento|caso|pedido|chamado|solicita[çc][aã]o) registrad[oa]`,
  '(atendimento|caso|pedido|chamado|solicita[çc][aã]o) (fica|ficou|vai ficar|ficar[aá]) registrad[oa]',
].join('|'), 'i');
// Janela em que uma liberação já feita ainda explica um "foi liberado?" do
// cliente: ele volta na mesma madrugada, ou de manhã, para dizer se voltou.
const LIBERACAO_RECENTE_MS = 24 * 60 * 60 * 1000;
function afirmaLiberacao(texto) { return AFIRMA_LIBERACAO.test(String(texto || '')); }

// Regra financeira 0/1/2+ (25/09/2026): pagamento confirmado, liberação e conexão só com FATO do
// sistema no turno (guarda-pagamento.js). A liberação de um turno anterior (o cliente volta e
// pergunta "foi liberado?") é VERDADE: o banco é a segunda fonte, consultado uma vez por turno.
async function violacoesDoPagamentoNoTurno(texto, contexto) {
  let violacoes = violacoesDoPagamento(texto, contexto);
  if (violacoes.includes('liberacao_sem_fato') && !contexto.liberacaoConsultadaNoBanco) {
    contexto.liberacaoConsultadaNoBanco = true;
    // Falha FECHADO: sem conseguir ler o banco, a liberação continua sem fato (também roda depois
    // do laço, fora do try do turno — uma exceção aqui não pode derrubar a resposta).
    let jaLiberado = false;
    try {
      jaLiberado = await hasRecentTrustUnlockByContact(contexto.contact && contexto.contact.id, LIBERACAO_RECENTE_MS);
    } catch (err) {
      console.error(`Liberação recente não lida na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
    }
    if (jaLiberado) {
      contexto.desbloqueioRealizado = true;
      violacoes = violacoesDoPagamento(texto, contexto);
    }
  }
  return violacoes;
}
function afirmaFila(texto) { return AFIRMA_FILA.test(String(texto || '')); }

// C4#3 (03/10/2026): sem a conclusão confirmada, as frases que anunciam o encaminhamento saem da resposta (as demais
// ficam) e entra a frase de que a transferência ainda não foi confirmada.
// Conclusão do atendimento (04/10/2026): com o próximo passo que existe de fato — ele pedir de novo; não há outro canal.
const ENCAMINHAMENTO_NAO_CONFIRMADO = 'Ainda não consegui confirmar a sua transferência para um atendente. Se quiser, pode me pedir de novo por aqui.';
// Autorrevisão (04/10/2026): o prompt do turno como fonte de horário, sem a linha da hora atual e da saudação (fatos.js:
// "agora são 14:05", "até 11:59", "de 12:00 a 17:59") — não é horário de atendimento.
function fonteDeHorarios(sistema) {
  return String(sistema || '').split('\n').filter((l) => !/^Hoje é .* em Brasília\./.test(l)).join('\n');
}

function respostaSemEncaminhamentoNaoConfirmado(texto) {
  const resto = String(texto || '').split(/(?<=[.!?\n])\s*/).map((f) => f.trim()).filter(Boolean)
    .filter((f) => !anunciaEncaminhamento(f) && !afirmaFila(f))
    .join(' ').trim();
  return resto ? `${resto} ${ENCAMINHAMENTO_NAO_CONFIRMADO}` : ENCAMINHAMENTO_NAO_CONFIRMADO;
}

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
// Rodada 10 (G1): por frase, e a frase negada antes do verbo não é anúncio ("Ainda não enviei o PIX.", "Não vou mandar o
// boleto sem o seu pedido.") — a explicação honesta não obriga a ferramenta de entrega.
function afirmaEnvio(texto) {
  return String(texto || '').split(/(?<=[.!?])\s+|\n+/).some((frase) => {
    const m = AFIRMA_ENVIO.exec(frase);
    return Boolean(m) && !/\bn[ãa]o\b/i.test(frase.slice(0, m.index));
  });
}

// Rodada 10 (08/10/2026; ordem, item 3, G1; avaliação real S5 r3 #3): "Vou usar a fatura do endereço…" sem a entrega. A guarda
// acima obriga a ferramenta só para a sua lista de verbos; esta não obriga nada: pelo ESTADO da ação (houve entrega neste turno?
// alguma vez nesta conversa?), a resposta que apresenta a cobrança como feita ou como trabalho que continuará sozinho é corrigida
// uma vez e, se o modelo insistir, a frase sai (anuncio-de-entrega.js).
const CORRECAO_DA_ENTREGA = 'NADA foi enviado ao cliente neste turno. A resposta não pode dizer que a cobrança foi enviada, nem que você vai enviá-la, usá-la, gerá-la ou verificá-la depois: nada continua sozinho depois desta mensagem. Responda de novo, sem anunciar: se o pedido dele já pode ser atendido, atenda agora pelas ferramentas (elas conferem tudo de novo); se falta alguma coisa, pergunte só o que falta; se não dá para enviar, diga com honestidade que não enviou e por quê.';
// A entrega anterior que o histórico do turno mostra: o cartão PIX ou o PDF do boleto que a IA mandou.
const entregaNoHistorico = (historico) => (historico || []).some((m) => m && m.direction === 'outbound' && m.sentBy === 'ai'
  && (m.messageType === 'pix' || m.messageType === 'document'));

// Teste real 2026-09-15 (produção, gpt-5.4-mini): "Boa noite, [nome]! كيف
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
  // Fase 1B (25/09/2026): mensagem automática (disparo do SGP, campanha) é reconhecida pela
  // metadata e vai ao modelo como RESUMO SEGURO — o texto montado do disparo tem nome, valor
  // e link do cliente e nunca entra cru no prompt. Vale para os dois perfis.
  const resumo = resumoParaModelo(m);
  if (resumo) return resumo;
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

// Aviso de cidade (25/09/2026): as falas recentes do CLIENTE — texto ou transcrição —, sem a
// autorresposta provável marcada (Fase 1C). É por elas que o código decide se o aviso ativo
// explica a reclamação (conexão) ou não (equipamento danificado, outro assunto).
function textosRecentesDoCliente(historico) {
  return (Array.isArray(historico) ? historico : [])
    .filter((m) => m && m.direction === 'inbound' && !(m.metadata && m.metadata.autorrespostaProvavel === true))
    .slice(-5)
    .map((m) => (m.messageType === 'audio' ? m.transcription : m.content))
    .filter(Boolean);
}

// Contenções operacionais (25/09/2026): a FONTE contra a qual um fato financeiro da resposta é
// conferido — o que as ferramentas devolveram neste turno e o texto do painel. O prompt montado
// NÃO entra (as regras dele citam "proporcional", "período"…), nem a `instrucao`/`proximoPasso`
// das ferramentas: são texto nosso para o modelo, não dado do SGP.
function fontesOficiaisDoTurno(messages, config) {
  const dasFerramentas = messages.filter((m) => m.role === 'tool').map((m) => {
    try {
      const { instrucao, proximoPasso, ...dado } = JSON.parse(m.content);
      return JSON.stringify(dado);
    } catch (err) {
      return '';
    }
  });
  return [config.triageExtraInstructions, config.systemPrompt, ...dasFerramentas].filter(Boolean).join('\n');
}

async function montarContextoSistema(config, contact, contracts, habilitadas = [], disparoRecente = null) {
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
  // Fase 1B: o mesmo fato do disparo recente que a triagem recebe (só campos seguros).
  if (disparoRecente) linhas.push(...linhasDoDisparoRecente(disparoRecente, new Date()));
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

/**
 * Fase 1B: o disparo automático a que a mensagem mais recente do cliente se relaciona — o
 * que ele citou, senão o último do histórico — reduzido ao fato seguro. A citada pode ter
 * ficado fora das mensagens carregadas: aí ela é buscada pelo id. Nunca derruba o turno.
 */
async function localizarDisparoRecente(historico) {
  const lista = Array.isArray(historico) ? historico : [];
  const ultimaEntrada = [...lista].reverse().find((m) => m && m.direction === 'inbound');
  const idCitado = ultimaEntrada && ultimaEntrada.repliedToMessageId;
  let citada = null;
  if (idCitado && !lista.some((m) => m && m.id === idCitado)) {
    try {
      citada = await findMessageById(idCitado);
    } catch (err) {
      console.error(`Failed to load the quoted message for the AI context: ${mensagemSegura(err)}`);
    }
  }
  return fatoDoDisparo(encontrarDisparoRelacionado(lista, citada));
}

const FERRAMENTAS_TRIAGEM = [
  'buscar_cliente', 'esquecer_identificacao',
  // Comerciais: quem pergunta preço ou cobertura quase nunca é cliente ainda,
  // então elas valem SEM identificação — e são o caminho para o preço vir do
  // cadastro em vez de um texto colado no prompt.
  'consultar_planos', 'verificar_cobertura',
  'consultar_status_contrato', 'consultar_status_conexao',
  'consultar_status_todos_contratos', 'consultar_faturas_todos_contratos',
  // gerar_segunda_via fica de fora de propósito (teste real 2026-09-15): na
  // triagem ela só devolvia linha e link ao modelo, sem enviar, e marcava a
  // conversa como resolvida — o modelo então dizia "enviei acima o boleto"
  // sem nenhum envio. Quem entrega o boleto na triagem é enviar_boleto; a
  // segunda via continua no assistente, com um humano no comando.
  'gerar_pix', 'enviar_boleto', 'concluir_triagem', 'encerrar_atendimento',
  // Regra financeira 0/1/2+ (25/09/2026): a ÚNICA fonte para dizer que um pagamento foi confirmado
  // — relê no SGP a mesma fatura que saiu nesta conversa. Consulta, sem efeito; de dia e de noite.
  'conferir_pagamento',
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

// Rodada 8 (N3): a frase do pedido de documento da resposta curta do worker, conferida pela mesma guarda do documento.
const PEDIDO_DO_DOCUMENTO_DO_TITULAR = 'Se for de outra pessoa, me mande o CPF ou CNPJ do titular.';

// Rodada 9 (N5): os fatos do alvo do turno (fluxos/alvo-financeiro.js); o pedido do documento do titular, conferido pela mesma
// guarda do documento — os fatos não mandam pedir o que a guarda barraria.
function fatosDoAlvo(contexto) {
  return fatosDoAlvoFinanceiro(contexto, {
    pedidoDeDocumentoPermitido: violacoesDoDocumento(PEDIDO_DO_DOCUMENTO_DO_TITULAR, contexto).length === 0,
  });
}

async function runAiTurn({ conversation, contact, perfil = 'assistente', identidade, triagem, origemMensagem, avisoCidade = null, terceiro = null, alvoAmbiguo = false, contratoEscolhido = null, contratosEscolhidos = null, messageId = null, terceiroLocalizadoEm = null, reativacao = null, esperadosDoAlvo = null, duvidaDeEnderecoRespondida = false, falasNovasDoCliente = null, alvoVoltouAoTitular = false, origemDoAlvoNoTurno = null, idsDasFalasNovas = null, falasNovasLidas = true, alvoVoltouDeTerceiro = false, entradasDoTurno = null, desdeDaLeitura = null }) {
  const iniciadoEm = Date.now();
  const config = await getAiConfig();
  // Uma leitura por turno: o nome da empresa é configuração, não constante —
  // o sistema roda em mais de um provedor.
  const empresa = await getCompanyConfig();

  let tools;
  let contexto;
  let systemContent;
  // O estado com que o prompt da triagem foi montado: guardado para a recomposição do meio do
  // turno (aviso de cidade descoberto por uma ferramenta). null no assistente.
  let estadoDoPrompt = null;

  // listRecentMessagesByConversation (não listMessagesByConversation): esta
  // pega as 20 mensagens mais NOVAS, já em ordem cronológica. A outra função
  // ordena por created_at ASC sem paginação — um LIMIT ali devolveria as
  // mensagens mais antigas da conversa, e a IA nunca veria o que o cliente
  // acabou de escrever.
  // Fase 1B: carregado ANTES de montar o prompt, porque o fato do disparo recente sai dele.
  const historico = await listRecentMessagesByConversation(conversation.id, HISTORICO_MAX);
  const disparoRecente = await localizarDisparoRecente(historico);

  if (perfil === 'triagem') {
    tools = toOpenAiTools(ferramentasDaTriagem(triagem, config));
    // Guarda defensiva: um identidade null/undefined não pode derrubar o turno
    // nem deixar contexto.contracts inconsistente com o que o contexto de
    // sistema viu. O compositor (src/ai/prompt) tem o mesmo fallback por
    // dentro, mas a lista de contratos que vai para o prompt é montada aqui.
    const identidadeEfetiva = identidade || { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
    // Contenções operacionais: o que a fala recente do cliente pede (defeito físico, troca do
    // Wi-Fi, explicação financeira), lido em código. Vai para o prompt e para as travas do turno.
    const contencoes = sinaisOperacionais(historico);
    // Documento pendente: o CPF/CNPJ já pedido (marcado na mensagem do pedido) e ainda não
    // informado. O documento de quem fala é o que NÃO responde a um pedido de terceiro.
    let documento = estadoDoDocumento(historico, {
      identidade: identidadeEfetiva,
      documentoDeQuemFala: (contact && contact.sgpDocument) || (identidadeEfetiva.client && identidadeEfetiva.client.document) || null,
      // Fato do sistema: quando o terceiro foi localizado, lido pelo worker do escopo persistido.
      terceiroLocalizadoEm,
    });
    const ultimaFala = textosRecentesDoCliente(historico).slice(-1)[0] || null;
    // Conclusão do atendimento (04/10/2026; avaliação de 01/10, falha 4; micropiloto 2, E3): os resultados de ferramenta de
    // turnos anteriores não voltam ao histórico, e no turno seguinte a um encaminhamento que falhou o modelo não sabia
    // disso. O registro das interações (durável, gravado a cada turno) diz quantas tentativas ficaram sem confirmação
    // (a marca semConfirmacao do executor). A conversa ainda está na triagem, então nenhuma delas concluiu. Falha na
    // leitura: sem o fato (nada é afirmado a partir de uma leitura que não aconteceu).
    let tentativasSemConfirmacao = 0;
    try {
      const anteriores = (await listAiInteractionsByConversation(conversation.id)) || [];
      tentativasSemConfirmacao = anteriores.reduce((n, i) => n + (Array.isArray(i.toolsRefused) ? i.toolsRefused : [])
        .filter((r) => r && r.nome === 'concluir_triagem' && r.semConfirmacao === true).length, 0);
    } catch (err) {
      console.error(`Interações anteriores não lidas na conversa ${conversation.id}: ${mensagemSegura(err)}`);
      tentativasSemConfirmacao = 0;
    }
    const encaminhamentoNaoConcluido = tentativasSemConfirmacao > 0 ? { tentativas: tentativasSemConfirmacao } : null;
    // Perfil fixo: os contratos vêm da identidade já resolvida (Task 2), não
    // de uma nova consulta ao SGP via carregarContratos — o cache do turno
    // (contexto.contracts) é o que tool-executor.js usa para a checagem de
    // propriedade (chaveProprietario).
    contexto = {
      perfil: 'triagem',
      conversationId: conversation.id, contact, contracts: identidadeEfetiva.contracts || [], sgpCache: {},
      identidade: identidadeEfetiva, terceiro, channelId: conversation.channelId, ferramentasPermitidas: ferramentasDaTriagem(triagem, config), registroFerramentas: [],
      // Caso Fulana/Beltrana: a mensagem do cliente não deixou claro de quem é a cobrança (o worker
      // decide, em financial-target.js). O executor trava as ferramentas de cobrança do turno.
      alvoAmbiguo,
      // Pedido por endereço (06/10/2026): o contrato que o cliente escolheu pela rua; as ferramentas de cobrança do turno só
      // agem nele (tool-executor.js).
      contratoEscolhido: contratoEscolhido != null ? String(contratoEscolhido) : null,
      // Dúvida de endereço (07/10/2026): os contratos escolhidos pela rua em falas seguidas; a cobrança fica limitada a eles.
      contratosEscolhidos: Array.isArray(contratosEscolhidos) && contratosEscolhidos.length ? contratosEscolhidos.map(String) : null,
      // Persistência do alvo (03/10/2026): os estados do escopo que este turno conhece (worker). As gravações do
      // escopo pelas ferramentas exigem um deles na própria instrução e atualizam a lista.
      esperadosDoAlvo: Array.isArray(esperadosDoAlvo) ? esperadosDoAlvo.slice() : [],
      // Revisão da rodada 7 (P2-2): a dúvida de endereço foi respondida neste turno e só sai do banco pela limpeza adiada do
      // worker, condicional (nenhuma entrada nova esperando). O documento de quem fala, neste turno, só identifica.
      duvidaDeEnderecoRespondida: duvidaDeEnderecoRespondida === true,
      // Rodada 8 (N1): ver tool-executor.js (documento só do histórico).
      falasNovasDoCliente: Array.isArray(falasNovasDoCliente) ? falasNovasDoCliente.slice() : null,
      alvoVoltouAoTitular: alvoVoltouAoTitular === true,
      // Rodada 9 (N5): a volta tirou um terceiro (fluxos/alvo-financeiro.js); a resposta da dúvida de endereço não.
      alvoVoltouDeTerceiro: alvoVoltouDeTerceiro === true,
      origemDoAlvoNoTurno: typeof origemDoAlvoNoTurno === 'string' ? origemDoAlvoNoTurno : null,
      idsDasFalasNovas: Array.isArray(idsDasFalasNovas) ? idsDasFalasNovas.slice() : null,
      falasNovasLidas: falasNovasLidas !== false,
      // Rodada 9 (N4-C): ver a reserva da entrega (tool-registry.js).
      entradasDoTurno: Array.isArray(entradasDoTurno) ? entradasDoTurno.slice() : null,
      desdeDaLeitura: desdeDaLeitura || null,
      // Conclusão do atendimento: o encaminhamento tentado e não concluído em turno anterior, e as ferramentas pedidas
      // neste turno (concluir_triagem decide a nova tentativa por elas).
      encaminhamentoNaoConcluido,
      ferramentasDoTurno: [],
      // A última fala do cliente: o trecho do pedido renovado (concluir_triagem) é conferido nela.
      ultimaFalaDoCliente: ultimaFala,
      // Pendências do atendimento (04/10/2026): o que o cliente escreveu nesta conversa (a janela do histórico, como o modelo
      // vê) e a última fala da IA. A origem do documento (executor) e o meio de pagamento (gerar_pix/enviar_boleto) são
      // conferidos nelas.
      falasDoCliente: historico.filter((m) => m && m.direction === 'inbound').map((m) => conteudoParaModelo(m, perfil)).filter(Boolean),
      ultimaFalaDaIa: historico.filter((m) => m && m.direction === 'outbound' && m.sentBy === 'ai')
        .map((m) => conteudoParaModelo(m, perfil)).filter(Boolean).slice(-1)[0] || null,
      // Fechamento limitado (04/10/2026): a mesma janela EM ORDEM, com quem falou, o id de cada mensagem e a marca do pedido
      // de documento das respostas da IA. A origem do documento confere o que veio antes de cada fala; a trava do meio
      // separa o que veio depois da entrega de outra fatura.
      mensagensDaJanela: historico.filter((m) => m && (m.direction === 'inbound' || (m.direction === 'outbound' && m.sentBy === 'ai')))
        .map((m) => ({
          id: m.id, de: m.direction === 'inbound' ? 'cliente' : 'ia', texto: conteudoParaModelo(m, perfil) || '',
          pediuDocumento: Boolean(m.metadata && m.metadata.pedidoDeDocumento),
          // Comportamento da IA (05/10/2026): a oferta do boleto marcada na resposta da IA (gerar_pix sem código).
          ofertaDoBoleto: (m.metadata && m.metadata.ofertaDoBoleto) || null,
          // Comportamento da IA (06/10/2026; A6/A7): o estado dos meios que a 2ª via desta conversa comprovou.
          meiosDaFatura: (m.metadata && Array.isArray(m.metadata.meiosDaFatura)) ? m.metadata.meiosDaFatura : null,
        })),
      triagem, origemMensagem, resolvidoPelaIa: false, triagemConcluida: null,
      // Aviso de cidade como FATO do turno: as ferramentas de status e de identificação leem e
      // gravam aqui (buscar_cliente pode descobri-lo no meio do turno).
      avisoCidade,
      contencoes,
      documento, ultimaFala,
      // Regra financeira 0/1/2+: a conversa já marcada para a reativação (fato gravado pelo gate,
      // lido pelo worker). As ferramentas leem daqui antes de ir ao banco.
      reativacao: reativacao || null,
      // A mensagem do cliente que abriu este turno. É a MESMA em todas as tool
      // calls do turno e em todas as voltas internas do laço — é isso que faz a
      // chave de reenvio de enviar_boleto/gerar_pix valer por pedido do
      // cliente, e não por chamada de ferramenta.
      messageId,
    };
    // Setores e motivos em paralelo: são duas consultas independentes e o
    // turno inteiro espera por elas antes da primeira chamada à OpenAI.
    // Rodada 9 (N5; avaliação real r2, S5): o pedido do documento da OUTRA pessoa só é o pedido de agora enquanto há uma outra
    // pessoa no alvo — um terceiro no escopo, ou uma dúvida. Com o alvo confirmado em quem fala (a volta à própria cobrança
    // limpou o escopo, sem dúvida nenhuma), o prompt mandava esperar o documento dela; a guarda lê o mesmo estado.
    if (documento && documento.alvo === 'terceiro' && !contexto.terceiro && typeof contexto.alvoAmbiguo !== 'string') {
      documento = null;
      contexto.documento = null;
    }
    const [setores, motivos] = await Promise.all([listSectors(), listActiveReasons()]);
    // montarContexto é SÍNCRONA — todo o I/O do prompt acontece aqui em cima,
    // no estado que ela recebe pronto.
    estadoDoPrompt = {
      config,
      identidade: identidadeEfetiva,
      contratos: (identidadeEfetiva.contracts || []).map(normalizeContract),
      triagem: triagem || { noturno: { ativo: false }, forcarConclusao: false },
      avisoCidade,
      contencoes,
      documento,
      disparoRecente,
      // A regra dos 90 dias não pode mandar para o financeiro uma conversa marcada para a reativação.
      reativacao: reativacao || null,
      empresa: empresa.name,
      ferramentas: ferramentasDaTriagem(triagem, config),
      setores,
      motivos,
      terceiro,
      // Conclusão do atendimento: o fato do encaminhamento não concluído (fluxos/acoes-pendentes.js).
      acoesPendentes: encaminhamentoNaoConcluido ? { encaminhamento: encaminhamentoNaoConcluido } : null,
      // Comportamento da IA (06/10/2026; A6/A7): os meios que a 2ª via desta conversa comprovou (fatos.js).
      meiosDaFatura: meiosDaJanela(contexto.mensagensDaJanela),
      // Rodada 9 (N5): os fatos do alvo financeiro que o código já decidiu (fluxos/alvo-financeiro.js), do contexto do turno.
      alvoFinanceiro: fatosDoAlvo(contexto),
      agora: new Date(),
    };
    systemContent = montarContexto(estadoDoPrompt);
  } else {
    const permissoes = await listToolPermissions();
    const habilitadas = permissoes.filter((p) => p.enabled).map((p) => p.toolName);
    tools = toOpenAiTools(habilitadas);

    const contracts = await carregarContratos(contact);
    // O perfil é DECLARADO, não inferido. Inferir por `identidade` abriria o
    // buraco de volta: buscar_cliente grava contexto.identidade no meio do
    // turno, e a partir dali o discriminador antigo passaria a ler "triagem"
    // — as ferramentas seguintes escapariam do gate de aprovação humana.
    contexto = { perfil: 'assistente', conversationId: conversation.id, contact, contracts, sgpCache: {} };
    systemContent = await montarContextoSistema(config, contact, contracts, habilitadas, disparoRecente);
  }

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
  // Contenções operacionais: UMA correção por turno. Se o modelo insistir, a troca final (depois
  // do laço) põe a resposta segura no lugar.
  let corrigiuContencao = false;
  // Documento pendente: UMA correção por turno, com a mesma lógica (a troca final segura o resto).
  let corrigiuDocumento = false;
  // Pagamento/liberação/conexão sem fato (regra 0/1/2+): UMA correção por turno; a troca final
  // (depois do laço) tira a frase se o modelo insistir.
  let corrigiuPagamento = false;
  // G1 (rodada 10): o estado da ação — a entrega deste turno (contexto.resolvidoPelaIa, que só a entrega confirmada marca na
  // triagem) e a anterior, no histórico.
  let corrigiuEntrega = false;
  const entregaAnterior = entregaNoHistorico(historico);
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
        // P2-1 (auditoria final): a mesma régua da guarda de pagamento — o desbloqueio, a releitura
        // do contrato e, para o ESTADO ("acesso liberado", "consta ativo"), o status 1 lido no turno.
        if (
          perfil === 'triagem' && conteudo && !corrigiuLiberacao && afirmaLiberacao(conteudo)
          && violacoesDoPagamento(conteudo, contexto).includes('liberacao_sem_fato')
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
          contexto.liberacaoConsultadaNoBanco = true;
          if (jaLiberado) {
            contexto.desbloqueioRealizado = true;
          } else {
            corrigiuLiberacao = true;
            messages.push({ role: 'assistant', content: conteudo });
            messages.push({
              role: 'system',
              content: 'Você afirmou uma liberação que NÃO aconteceu neste atendimento. Responda de novo, sem afirmar liberação: diga que não conseguiu liberar o acesso agora, que o pedido/comprovante fica registrado para a equipe conferir no horário de retorno — sem prometer liberação nem prazo.',
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
              // Conclusão do atendimento (04/10/2026, revisão): conclusão que o CÓDIGO exige — a trava da nova tentativa
              // depois de uma falha (concluir_triagem) não a barra.
              contexto.conclusaoExigidaPeloCodigo = true;
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
        // Regra financeira 0/1/2+ (25/09/2026): "pagamento confirmado/compensado/já baixou",
        // "internet liberada" e "está conectada" sem o fato do sistema neste turno. Comprovante,
        // "paguei" e PIX enviado não são o fato. Uma correção; se insistir, a troca final tira a frase.
        const violacoesPag = perfil === 'triagem' && conteudo && !corrigiuPagamento
          ? await violacoesDoPagamentoNoTurno(conteudo, contexto)
          : [];
        if (violacoesPag.length > 0) {
          corrigiuPagamento = true;
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({ role: 'system', content: correcaoDoPagamento(violacoesPag) });
          continue;
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
        // Contenções operacionais (25/09/2026): equipamento com defeito físico, troca do Wi-Fi e
        // explicação financeira sem fonte. Antes da guarda de anúncio: a correção já exige a
        // conclusão quando o próximo passo não depende de perguntar nada ao cliente, e marca
        // exigiuConclusaoPorAnuncio para a volta forçada não cair no teto de ferramentas nem ser
        // exigida duas vezes.
        const violacoes = perfil === 'triagem' && conteudo && !corrigiuContencao
          ? violacoesDaResposta(conteudo, { contexto, fontes: fontesOficiaisDoTurno(messages, config) })
          : [];
        if (violacoes.length > 0) {
          corrigiuContencao = true;
          const correcao = correcaoDaResposta(violacoes, contexto);
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({ role: 'system', content: correcao.instrucao });
          if (correcao.concluir && !contexto.triagemConcluida && !contexto.atendimentoEncerrado) {
            exigiuConclusaoPorAnuncio = true;
            // Conclusão do atendimento (04/10/2026, revisão): a contenção exige a conclusão — a trava da nova tentativa não a barra.
            contexto.conclusaoExigidaPeloCodigo = true;
            proximoToolChoice = 'concluir_triagem';
          }
          continue;
        }
        // Documento pendente (25/09/2026): pedir de novo o CPF/CNPJ que já foi pedido e não veio,
        // sem nada ter mudado (ou a quem já está identificado, ou depois de encaminhar) é repetição.
        const violacoesDoc = perfil === 'triagem' && conteudo && !corrigiuDocumento
          ? violacoesDoDocumento(conteudo, contexto)
          : [];
        if (violacoesDoc.length > 0) {
          corrigiuDocumento = true;
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({ role: 'system', content: correcaoDoDocumento(violacoesDoc, contexto) });
          continue;
        }
        // G1 (rodada 10): sem a entrega, nem concluída nem por vir — uma correção, sem ferramenta obrigatória (e nenhuma se a
        // guarda acima já exigiu a entrega neste turno: aí só a troca final).
        const violacoesEntrega = perfil === 'triagem' && conteudo && !corrigiuEntrega && !exigiuEntregaPorAnuncio
          ? violacoesDaEntrega(conteudo, { entregaNoTurno: Boolean(contexto.resolvidoPelaIa), entregaAnterior })
          : [];
        if (violacoesEntrega.length > 0) {
          corrigiuEntrega = true;
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({ role: 'system', content: CORRECAO_DA_ENTREGA });
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
      // Conclusão do atendimento: as ferramentas desta volta entram na lista ANTES de qualquer execução — numa volta com
      // duas chamadas em paralelo, concluir_triagem tem de ver a outra.
      if (perfil === 'triagem' && Array.isArray(contexto.ferramentasDoTurno)) {
        contexto.ferramentasDoTurno.push(...chamadas.map((c) => c.function && c.function.name).filter(Boolean));
      }
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
          toolsRefused.push({ nome, motivo: resposta.motivo, detalhe: resposta.detalhe, ...(resposta.semConfirmacao ? { semConfirmacao: true } : {}) });
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

      // Aviso de cidade descoberto NESTE turno (buscar_cliente achou a cidade no SGP): o prompt
      // foi montado sem ele. Recompõe antes da próxima chamada — a resposta final já sai com o
      // fato, e não só com o que a ferramenta devolveu.
      // Mesma recomposição para a reativação marcada pelo gate NESTE turno: a resposta seguinte já
      // sai sem a regra dos 90 dias mandando para o financeiro.
      let recompor = false;
      if (estadoDoPrompt && contexto.avisoCidade && !estadoDoPrompt.avisoCidade) {
        estadoDoPrompt.avisoCidade = contexto.avisoCidade;
        recompor = true;
      }
      if (estadoDoPrompt && contexto.reativacao && !estadoDoPrompt.reativacao) {
        estadoDoPrompt.reativacao = contexto.reativacao;
        recompor = true;
      }
      // Rodada 9 (N5): o estado confirmado do alvo mudou nesta volta (a consulta localizou a outra pessoa, a cobrança travou,
      // a identificação mudou): a próxima chamada recebe os fatos novos — e sem o pedido de documento que a consulta encerrou.
      if (estadoDoPrompt && estadoDoPrompt.alvoFinanceiro) {
        const fatos = fatosDoAlvo(contexto);
        if (JSON.stringify(fatos) !== JSON.stringify(estadoDoPrompt.alvoFinanceiro)) {
          estadoDoPrompt.alvoFinanceiro = fatos;
          recompor = true;
        }
        if (estadoDoPrompt.documento && !pendenteAgora(contexto)) {
          estadoDoPrompt.documento = null;
          recompor = true;
        }
      }
      if (recompor) messages[0] = { role: 'system', content: montarContexto(estadoDoPrompt) };
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

  // Contenções operacionais: o modelo insistiu depois da correção (ou a resposta veio de um
  // caminho sem correção, como o fim por limite de ferramentas). Só os códigos vão ao log.
  const violacoesFinais = perfil === 'triagem' && texto
    ? violacoesDaResposta(texto, { contexto, fontes: fontesOficiaisDoTurno(messages, config) })
    : [];
  if (violacoesFinais.length > 0) {
    console.warn(`Resposta da IA violava contenção operacional (${violacoesFinais.join(', ')}) na conversa ${conversation.id}; trocada pela resposta segura`);
    texto = respostaSeguraDaContencao(violacoesFinais, contexto);
  }

  // Documento pendente: o modelo insistiu em repetir o pedido — sai só a(s) frase(s) do pedido.
  const violacoesDocFinais = perfil === 'triagem' && texto ? violacoesDoDocumento(texto, contexto) : [];
  if (violacoesDocFinais.length > 0) {
    console.warn(`Resposta da IA repetia o pedido de documento (${violacoesDocFinais.join(', ')}) na conversa ${conversation.id}; pedido retirado`);
    texto = respostaSemRepetirDocumento(texto, violacoesDocFinais, contexto);
  }

  // Regra financeira 0/1/2+: o modelo insistiu em afirmar pagamento/liberação/conexão sem fato
  // (ou a resposta veio de um caminho sem correção) — sai só a frase; se nada sobrar, a frase segura.
  const violacoesPagFinais = perfil === 'triagem' && texto ? await violacoesDoPagamentoNoTurno(texto, contexto) : [];
  if (violacoesPagFinais.length > 0) {
    console.warn(`Resposta da IA afirmava sem fato do sistema (${violacoesPagFinais.join(', ')}) na conversa ${conversation.id}; frase retirada`);
    texto = respostaSemAfirmacoes(texto, violacoesPagFinais, contexto);
  }

  // Aviso de cidade como FATO (25/09/2026): com falha regional ativa e o cliente reclamando de
  // conexão, a resposta não pode mandar reiniciar/testar equipamento nem inventar prazo ou
  // atuação que o aviso não traz — o código troca pela resposta segura. Só na triagem (no
  // assistente quem decide é a atendente); equipamento danificado não entra (o aviso não explica).
  // Defeito físico relatado (contenções operacionais): o fato específico do equipamento vence a
  // generalização do aviso — "sem internet, a ONU não acende" não vira a resposta da ocorrência.
  // P1-1 (auditoria final, 25/09/2026): o aviso não explica suspensão — com o contrato da
  // reclamação suspenso (ou, sem alvo determinado, qualquer um suspenso), a resposta sobre a
  // suspensão NUNCA é trocada pela ocorrência regional.
  if (perfil === 'triagem' && texto && contexto.avisoCidade
      && !(contexto.contencoes && contexto.contencoes.defeitoFisico)
      && !suspensaoAfastaOAviso((contexto.contracts || []).map(normalizeContract), contexto.contratoDaReclamacao || null)
      && avisoExplicaReclamacao(contexto.avisoCidade, textosRecentesDoCliente(historico))
      && contradizAviso(texto, contexto.avisoCidade)) {
    console.warn(`Resposta da IA contradizia o aviso de cidade na conversa ${conversation.id}; trocada pela resposta segura`);
    texto = respostaSeguraDoAviso(contexto.avisoCidade);
  }

  // Comportamento da IA (06/10/2026; A6/A7): as guardas restritas aos meios que a 2ª via desta conversa comprovou —
  // a oferta de um meio inexistente sai (e entra o fato com o único próximo passo), e a indisponibilidade afirmada sem
  // resultado sai (e entra que não deu para confirmar). Não interpretam o pedido do cliente (meios-de-pagamento.js).
  if (perfil === 'triagem' && texto) {
    const meios = meiosDoTurno(contexto);
    // Ordem de 06/10/2026 (tarde): o fato é da fatura E do contrato — com mais de um contrato na conversa, a guarda da
    // oferta só age quando o meio foi comprovado inexistente em todos (meios-de-pagamento.js).
    // Pessoa sem contrato conhecido na conversa (terceiro pendente ou sem contrato, alvo ambíguo no turno, cliente sem
    // contratos identificados, como na identificação contestada) conta como mais um contrato, que nunca terá fatura: o fato
    // do contrato do cliente não vira resposta sobre ela.
    const terceiro = contexto.terceiro;
    const pessoaSemContrato = Boolean(contexto.alvoAmbiguo)
      || Boolean(terceiro && (terceiro.pendente || terceiro.alvoPendente || !(terceiro.contratos || []).length))
      || (contexto.contracts || []).length === 0;
    const contratos = [
      ...(contexto.contracts || []), ...((terceiro && terceiro.contratos) || []),
      ...(pessoaSemContrato ? [{ id: 'pessoa-sem-contrato-conhecido' }] : []),
    ];
    const semOferta = respostaSemOfertaDeMeioInexistente(texto, meios, { contratos });
    if (semOferta.alterado) {
      console.warn(`Resposta da IA oferecia meio de pagamento que a 2ª via mostrou inexistente na conversa ${conversation.id}; trocada pelo fato`);
      texto = semOferta.texto;
    }
    const semAfirmacao = respostaSemIndisponibilidadeNaoConfirmada(texto, meios, { cobrancaComResposta: Boolean(contexto.cobrancaComResposta), contratos });
    if (semAfirmacao.alterado) {
      console.warn(`Resposta da IA afirmava meio indisponível sem resultado na conversa ${conversation.id}; frase trocada`);
      texto = semAfirmacao.texto;
    }
  }

  // C4#3 (03/10/2026): encaminhamento só se afirma com a conclusão confirmada. Quando concluir_triagem foi tentada
  // neste turno e NÃO confirmou (erro ou tempo esgotado — o resultado pode ser desconhecido —, ou recusa), a guarda
  // de anúncio exige a conclusão uma vez só, e o texto escrito depois de uma segunda tentativa sem sucesso saía como
  // estava. Sai a frase do anúncio, e entra a de que a transferência ainda não foi confirmada — verdadeira na falha,
  // na recusa e no desconhecido. Sem tentativa no turno, nada muda aqui.
  const tentouConcluir = toolsRequested.some((t) => t.nome === 'concluir_triagem')
    || toolsRefused.some((r) => r.nome === 'concluir_triagem');
  if (
    perfil === 'triagem' && texto && tentouConcluir && !contexto.triagemConcluida && !contexto.atendimentoEncerrado
    && (anunciaEncaminhamento(texto) || afirmaFila(texto))
  ) {
    console.warn(`Resposta da IA afirmava encaminhamento sem conclusão confirmada na conversa ${conversation.id}; frase retirada`);
    texto = respostaSemEncaminhamentoNaoConfirmado(texto);
  }

  // Conclusão do atendimento (04/10/2026; avaliação de 01/10, falhas 1 e 5; micropiloto 2, E3): horário sem fonte e promessa
  // de trabalho futuro (nova tentativa, retorno, acompanhamento) ou de ação da equipe sem encaminhamento confirmado neste
  // turno saem da resposta, frase a frase (promessas-sem-evidencia.js). O único horário com fonte é o retorno da equipe
  // no modo noturno, que vem da configuração. Sem nada que sobre: a frase de transferência não confirmada (se ela foi
  // tentada neste turno) ou a de que não há informação confirmada.
  if (perfil === 'triagem' && texto) {
    const noturno = contexto.triagem && contexto.triagem.noturno;
    // Revisão (04/10/2026): o horário ou prazo escrito no prompt do turno (aviso de cidade, instruções do painel, fatos)
    // também tem fonte.
    const opcoesPromessas = {
      encaminhamentoConfirmado: Boolean(contexto.triagemConcluida),
      horariosConfirmados: noturno && noturno.ativo && noturno.retornoAs ? [noturno.retornoAs] : [],
      textoComFonte: fonteDeHorarios((messages[0] && messages[0].content) || systemContent || ''),
    };
    const motivosPromessas = promessasSemEvidencia(texto, opcoesPromessas);
    if (motivosPromessas.length > 0) {
      console.warn(`Resposta da IA trazia ${motivosPromessas.join(', ')} na conversa ${conversation.id}; frase retirada`);
      texto = respostaSemPromessas(texto, {
        ...opcoesPromessas,
        seNadaSobrar: tentouConcluir && !contexto.triagemConcluida ? ENCAMINHAMENTO_NAO_CONFIRMADO : undefined,
      });
    }
  }

  // G1 (rodada 10): o modelo insistiu depois da correção (ou a resposta veio de um caminho sem correção, como o fim por limite de
  // ferramentas) — sai a frase que apresenta a entrega sem o fato; se nada que pergunte algo sobrar, a frase honesta.
  if (perfil === 'triagem' && texto) {
    const estadoDaEntrega = { entregaNoTurno: Boolean(contexto && contexto.resolvidoPelaIa), entregaAnterior };
    const violacoesEntregaFinais = violacoesDaEntrega(texto, estadoDaEntrega);
    if (violacoesEntregaFinais.length > 0) {
      console.warn(`Resposta da IA apresentava entrega sem o fato (${violacoesEntregaFinais.join(', ')}) na conversa ${conversation.id}; frase retirada`);
      texto = respostaSemEntregaSemFato(texto, estadoDaEntrega);
    }
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
    // O worker precisa saber o que foi RECUSADO, não só o que rodou: uma ação
    // barrada por exigir aprovação humana é justamente o que a atendente tem
    // de ver, e sem isto ela desapareceria quando o modelo não escrevesse nada.
    toolsRecusadas: toolsRefused,
    triagemConcluida: contexto.triagemConcluida || null,
    atendimentoEncerrado: Boolean(contexto.atendimentoEncerrado),
    // O worker usa isto para saber se pode mandar a frase de sucesso por
    // código quando o turno estoura o tempo antes da resposta final.
    desbloqueioRealizado: Boolean(contexto.desbloqueioRealizado),
    // Fechamento limitado (04/10/2026): a liberação confirmada NESTE turno pela ferramenta — a marca gravada só no sucesso e
    // nunca apagada (desbloqueioRealizado também vale para a liberação de um turno anterior, lida do banco).
    desbloqueioNoTurno: contexto.desbloqueioConfirmadoNoTurno === true,
    // Falha de gravação dentro da consulta do documento (30/09/2026): a consulta de terceiro não conseguiu
    // gravar o pendente. O worker o grava e só então marca as entradas do turno como concluídas.
    alvoTerceiroNaoGravado: Boolean(contexto.alvoTerceiroNaoGravado),
    // Persistência do alvo (03/10/2026): a volta ao titular pelo próprio documento não foi gravada (o worker a
    // grava de novo), e os estados do escopo que o turno conhece no fim, para a gravação do worker.
    voltaAoTitularNaoGravada: Boolean(contexto.voltaAoTitularNaoGravada),
    // A identificação pelo próprio documento, com terceiro no contexto, não terminou (SGP falhou ou o executor
    // desistiu): o worker não marca as entradas.
    consultaPropriaPendente: Boolean(contexto.consultaPropriaPendente),
    // A reserva de uma entrega encontrou o alvo mudado por outro processamento: o worker não marca as entradas.
    alvoMudouNaEntrega: Boolean(contexto.alvoMudouNaEntrega),
    // Rodada 8 (N3, revisão, achados 5 e 6): para a resposta curta do worker — a dúvida do alvo no FIM do turno (uma ferramenta
    // pode tê-la resolvido no meio), e se a guarda do documento permitiria, agora, pedir o CPF/CNPJ do titular.
    alvoAmbiguoNoFim: contexto.alvoAmbiguo || false,
    pedidoDeDocumentoDeTerceiroPermitido: perfil === 'triagem' && violacoesDoDocumento(PEDIDO_DO_DOCUMENTO_DO_TITULAR, contexto).length === 0,
    esperadosDoAlvo: Array.isArray(contexto.esperadosDoAlvo) ? contexto.esperadosDoAlvo : null,
    identidade: contexto.identidade || null,
    // O harness de simulação encadeia roteiros e precisa do escopo de saída; o
    // worker ignora este campo, porque quem persiste é a própria ferramenta.
    terceiro: contexto.terceiro || null,
    // Documento pendente: a resposta final pede o CPF/CNPJ? O worker grava isto na metadata da
    // própria mensagem — é o registro do pedido, com DE QUEM é o documento pedido.
    pedidoDeDocumento: perfil === 'triagem' && texto && pedeDocumento(texto) ? { alvo: alvoDoPedido(contexto, texto) } : null,
    // Comportamento da IA (05/10/2026; E15 #1): a oferta do boleto que a ferramenta mandou fazer, só se a resposta final de
    // fato cita o boleto. O worker grava isto na metadata da mensagem; o próximo turno lê na janela.
    ofertaDoBoleto: perfil === 'triagem' && texto && CITA_BOLETO.test(texto) ? ofertaDoBoletoDoTurno(contexto) : null,
    // Comportamento da IA (06/10/2026; A6/A7): o estado dos meios (gravado no turno ou herdado), para a metadata da mensagem.
    meiosDaFatura: perfil === 'triagem' && meiosDoTurno(contexto).length > 0 ? meiosDoTurno(contexto) : null,
  };
}

// A resposta cita o boleto (com os sinônimos da trava do meio).
const CITA_BOLETO = /\bboletos?\b|\bc[oó]digo de barras\b|\blinha digit[aá]vel\b/i;
// A oferta do boleto do turno: a que a ferramenta marcou; null quando o boleto DA FATURA DA OFERTA foi entregue (a ferramenta
// apaga; o de outra fatura não mexe — 06/10/2026); sem nenhuma
// das duas (turno sem ferramenta de cobrança, como "por que não tem PIX?"), a da última resposta da IA, herdada — a resposta
// que cita o boleto de novo continua a mesma oferta (revisão da entrega 1).
function ofertaDoBoletoDoTurno(contexto) {
  if (contexto.ofertaDoBoleto !== undefined) return contexto.ofertaDoBoleto || null;
  const janela = Array.isArray(contexto.mensagensDaJanela) ? contexto.mensagensDaJanela : [];
  const ultima = [...janela].reverse().find((m) => m && m.de === 'ia');
  return (ultima && ultima.ofertaDoBoleto) || null;
}

module.exports = { runAiTurn, FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO, FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA, ferramentasDaTriagem, afirmaLiberacao, afirmaFila, afirmaEnvio };
