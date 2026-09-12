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
const { maskDocument } = require('./sgp-normalizer');

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

function papelDaMensagem(message) {
  return message.direction === 'inbound' ? 'user' : 'assistant';
}

async function montarContextoSistema(config, contact, contracts) {
  const [motivos, setores] = await Promise.all([listActiveReasons(), listSectors()]);
  const linhas = [config.systemPrompt, '', 'Motivos de atendimento disponíveis (use o id exato):'];
  for (const m of motivos) linhas.push(`- ${m.id} = ${m.name}`);
  linhas.push('', 'Setores para transferência (use o id exato):');
  for (const s of setores) linhas.push(`- ${s.id} = ${s.name}`);
  linhas.push('');
  if (contact.sgpClientId) {
    linhas.push(`O cliente já está identificado. Contrato selecionado: ${contact.sgpContractId || 'ainda não escolhido'}.`);
    if (contracts.length > 1) {
      linhas.push('O cliente tem mais de um contrato. Não assuma qual é — peça para ele escolher.');
    }
  } else {
    linhas.push('O cliente ainda NÃO foi identificado. Use buscar_cliente com o CPF ou CNPJ dele.');
  }
  return linhas.join('\n');
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

async function runAiTurn({ conversation, contact }) {
  const iniciadoEm = Date.now();
  const config = await getAiConfig();
  const permissoes = await listToolPermissions();
  const habilitadas = permissoes.filter((p) => p.enabled).map((p) => p.toolName);
  const tools = toOpenAiTools(habilitadas);

  const contracts = await carregarContratos(contact);
  const contexto = { conversationId: conversation.id, contact, contracts, sgpCache: {} };

  // listRecentMessagesByConversation (não listMessagesByConversation): esta
  // pega as 20 mensagens mais NOVAS, já em ordem cronológica. A outra função
  // ordena por created_at ASC sem paginação — um LIMIT ali devolveria as
  // mensagens mais antigas da conversa, e a IA nunca veria o que o cliente
  // acabou de escrever.
  const historico = await listRecentMessagesByConversation(conversation.id, HISTORICO_MAX);
  const messages = [
    { role: 'system', content: await montarContextoSistema(config, contact, contracts) },
    ...historico
      .filter((m) => m.messageType === 'text' && m.content)
      .map((m) => ({ role: papelDaMensagem(m), content: m.content })),
  ];

  const toolsRequested = [];
  const toolsExecuted = [];
  const toolsRefused = [];
  let texto = null;
  let erro = null;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    while (true) {
      const { message, usage } = await createChatCompletion({
        apiKey: config.apiKey, model: config.model, messages, tools,
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
    mode: config.mode,
    model: config.model,
    toolsRequested, toolsExecuted, toolsRefused,
    finalResponse: texto,
    error: erro,
    promptTokens: promptTokens || null,
    completionTokens: completionTokens || null,
    durationMs: Date.now() - iniciadoEm,
  });

  return { texto, toolsExecutadas: toolsExecuted, erro };
}

module.exports = { runAiTurn };
