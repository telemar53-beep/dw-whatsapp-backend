const { findTool, perfilTriagem } = require('./tool-registry');
const { isToolEnabled } = require('./ai-config.repository');
const { mensagemSegura } = require('./safe-error-log');

const TIMEOUT_PADRAO_MS = 15000;

/**
 * `detalhe` é auditoria (pode carregar texto interno bruto: "connect
 * ECONNREFUSED 10.0.0.5:5432", um id de contrato). `instrucao` é o oposto:
 * texto escrito à mão para o MODELO ler — só uma recusa que declara uma
 * chega ao contexto dele. Os dois campos existem separados de propósito; usar
 * `detalhe` para as duas coisas devolveria o endereço do banco ao modelo.
 */
function recusa(motivo, detalhe, instrucao) {
  return {
    ok: false,
    motivo,
    detalhe: detalhe === undefined ? null : detalhe,
    ...(instrucao ? { instrucao } : {}),
  };
}

// Defeito D (teste real 2026-09-14): a recusa chegava ao modelo como
// { erro: 'identity_not_confirmed' } seco e ele improvisava.
const INSTRUCAO_IDENTIDADE = 'Identidade ainda não confirmada. Pergunte a data de nascimento e chame confirmar_nascimento; depois chame esta ferramenta de novo. Não peça o CPF de novo.';

function comTimeout(promise, ms) {
  let timer;
  const estouro = new Promise((resolve) => {
    timer = setTimeout(() => resolve(Symbol.for('timeout')), ms);
  });
  return Promise.race([promise, estouro]).finally(() => clearTimeout(timer));
}

// Nunca loga o objeto de erro inteiro: para chamadas ao SGP, err.cause carrega
// a config do axios (token, cpf/cnpj) e o console imprime a cadeia de causa
// inteira. Mesma disciplina já usada em sgp-client.js (só {status} ou
// {message}); mensagemSegura é a implementação compartilhada, para não
// divergir dela (ver ai-orchestrator.js, que loga a mesma classe de erro).
function logFalha(nome, err) {
  console.error(`AI tool ${nome} failed: ${mensagemSegura(err)}`);
}

/**
 * A ordem destas verificações é parte do design:
 * existe → habilitada → argumentos válidos → o contrato é deste contato →
 * executa com timeout. Nada toca o SGP antes da quarta verificação passar.
 *
 * Tudo fica dentro do try: uma recusa nunca é uma exceção, então qualquer
 * falha inesperada em qualquer um destes passos (inclusive um erro transitório
 * de isToolEnabled, ou um contexto malformado) também vira execution_error
 * em vez de escapar como uma promise rejeitada.
 */
async function executeTool(nome, args, contexto, { timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
  try {
    const tool = findTool(nome);
    if (!tool) return recusa('unknown_tool', nome);

    // Um perfil (a triagem) pode trazer a própria lista fixa de ferramentas:
    // ela substitui a tabela de permissões, que governa só o assistente.
    if (Array.isArray(contexto.ferramentasPermitidas)) {
      if (!contexto.ferramentasPermitidas.includes(nome)) return recusa('tool_not_in_profile', nome);
    } else if (!(await isToolEnabled(nome))) {
      return recusa('tool_disabled', nome);
    }

    const validacao = tool.validar(args);
    if (!validacao.ok) return recusa('invalid_args', validacao.erro);
    const argsValidados = validacao.args;

    if (nome === 'buscar_cliente') {
      // Exceção deliberada, e só para esta ferramenta por nome: é o passo que
      // estabelece a identificação, então não há contrato para conferir. Em
      // troca, trocar de cliente no meio da conversa é proibido — isso exige
      // um atendente humano.
      // Print 2026-09-16: a cliente mandou o CPF do vizinho e a IA respondeu
      // "preciso do CPF do titular novamente" em looping — era esta trava
      // recusando sem o modelo saber por quê. Consultar o CPF de OUTRA pessoa
      // (fatura do amigo, problema do vizinho) é pedido legítimo e não troca
      // o dono da conversa: com a marcação, buscar_cliente não persiste nada.
      const jaIdentificado = contexto.contact && contexto.contact.sgpDocument;
      if (jaIdentificado && jaIdentificado !== argsValidados.cpf && argsValidados.titularEOutraPessoa !== true) {
        return recusa('client_already_identified', null);
      }
    } else if (!tool.isentoDeProprietario) {
      // O padrão é fechado: uma ferramenta só escapa da checagem de propriedade
      // se declarar isentoDeProprietario explicitamente (definir_motivo_atendimento
      // e transferir_atendimento, que só usam contexto.conversationId, nunca um
      // valor vindo do modelo). Uma ferramenta que não declarar nem
      // chaveProprietario nem isentoDeProprietario é recusada — provavelmente um
      // registro incompleto, não uma decisão de segurança que alguém tomou.
      if (typeof tool.chaveProprietario !== 'string') return recusa('tool_misconfigured', nome);
      const valor = argsValidados[tool.chaveProprietario];
      const pertence = (contexto.contracts || []).some((c) => c.id === valor);
      if (!pertence) return recusa('contract_not_owned', valor);
    }

    // Entrega de dado (boleto, PIX) só com identidade forte — regra em código,
    // não em prompt. A marcação vale sempre que o turno usa o perfil de
    // triagem (perfilTriagem: contexto.ferramentasPermitidas fixo OU já existe
    // contexto.identidade); só fica inerte quando nenhum dos dois está
    // presente (o assistente clássico, sem perfil de triagem e sem
    // resolução de identidade — um humano acompanha ali). Mesmo
    // discriminador usado em tool-registry.js, importado em vez de duplicado
    // aqui, para as duas checagens nunca divergirem.
    if (tool.exigeIdentidadeForte && perfilTriagem(contexto)
        && !(contexto.identidade && contexto.identidade.nivel === 'forte')) return recusa('identity_not_confirmed', nome, INSTRUCAO_IDENTIDADE);

    // Uma ferramenta pode declarar o próprio orçamento (tool.timeoutMs): a
    // de liberação em confiança faz duas leituras E uma escrita no SGP, cada
    // uma com 15 s de HTTP. Com o orçamento padrão (igual ao HTTP), o race
    // aqui podia vencer com "timeout" enquanto o SGP ainda liberava o serviço
    // — ação real reportada ao modelo como falha.
    const resultado = await comTimeout(tool.executar(argsValidados, contexto), tool.timeoutMs || timeoutMs);
    if (resultado === Symbol.for('timeout')) return recusa('timeout', nome);
    if (resultado && resultado.ok === false) return recusa('execution_error', resultado.erro);
    return { ok: true, resultado };
  } catch (err) {
    logFalha(nome, err);
    return recusa('execution_error', err && err.message);
  }
}

module.exports = { executeTool };
