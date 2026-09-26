const { findTool, perfilTriagem, temEfeitoReal, FERRAMENTAS_PERMITIDAS_EM_TERCEIRO } = require('./tool-registry');
const { FERRAMENTAS_DE_COBRANCA, alvoFinanceiro } = require('./financial-target');
const { minimizarParaTerceiro } = require('./third-party-minimize');
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

// A recusa chegava ao modelo como { erro: 'identity_not_confirmed' } seco e ele
// improvisava (defeito D, teste real 2026-09-14). Era esta linha, e não o
// prompt, que fazia a IA pedir um dado errado em produção: resultado de
// ferramenta o modelo lê como fato apurado.
const INSTRUCAO_IDENTIDADE = 'Ainda não sei quem é o cliente. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo.';
// Documento pendente (25/09/2026): com o documento de quem fala JÁ pedido e ainda não informado, a
// instrução acima fazia o modelo pedir de novo a cada tentativa de consulta (caso real: três
// pedidos seguidos). A ação continua recusada do mesmo jeito.
const INSTRUCAO_IDENTIDADE_JA_PEDIDA = 'Ainda não sei quem é o cliente, e o CPF ou CNPJ JÁ foi pedido: NÃO peça de novo agora. Responda ao que ele disse sem consultar nada; esta ferramenta só funciona depois de buscar_cliente com o documento.';

// Só entra em jogo quando o contrato pedido é o do terceiro (contexto.terceiro)
// e a ferramenta NÃO está em FERRAMENTAS_PERMITIDAS_EM_TERCEIRO — as demais
// recusas (contract_not_owned, identity_not_confirmed) já têm a própria
// instrução, ou não precisam de uma.
const INSTRUCAO_TERCEIRO = 'Este contrato é de outra pessoa. Nesse caso você só pode consultar a fatura e entregar o boleto ou o PIX. Plano, conexão, status e liberação não podem ser consultados nem executados no contrato de terceiro. Se o cliente pediu uma dessas coisas, explique que só o titular pode solicitar.';

// Caso Fulana/Beltrana (25/09/2026): o pedido de cobrança em andamento é de OUTRA pessoa e a
// ferramenta veio com um contrato que não é dela. Nada é enviado.
const INSTRUCAO_ALVO_TERCEIRO = 'O pedido de cobrança em andamento é da OUTRA pessoa (a do CPF/CNPJ informado). Só os contratos dela podem ser usados; o contrato de quem está falando NÃO pode, e nada foi enviado. Se o CPF/CNPJ dela não foi localizado, peça para conferir o número. Se não estiver claro de quem é a cobrança, pergunte, curto: "Você quer a sua cobrança ou a da outra pessoa?". NÃO peça o CPF de quem está falando: ele já está identificado — quando ele disser que quer a própria cobrança, ela volta a ser dele.';

// Decisão do dono (25/09/2026): intenção de alvo dos dois lados na mensagem do cliente (ou
// menção a outra pessoa sem o CPF dela). Nenhuma cobrança sai até ele esclarecer.
const INSTRUCAO_ALVO_AMBIGUO = 'Não está claro de quem é a cobrança. NÃO envie nada. Pergunte, curto: "Você quer a sua cobrança ou a da outra pessoa?". Se for de outra pessoa, peça o CPF ou CNPJ do titular dela.';

const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

// O documento do titular DA CONVERSA: o vínculo gravado no contato, ou o da identidade forte
// resolvida neste turno (a identificação pelo telefone também traz o documento).
function documentoDoTitularDaConversa(contexto) {
  const doContato = soDigitos(contexto && contexto.contact && contexto.contact.sgpDocument);
  if (doContato) return doContato;
  const identidade = contexto && contexto.identidade;
  if (identidade && identidade.nivel === 'forte' && identidade.client) return soDigitos(identidade.client.document);
  return '';
}

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

// CONTENÇÃO (22/09/2026). Caso real: no perfil assistente, o turno executou
// desbloqueio_confianca e o SGP liberou o acesso da cliente por 3 dias ANTES de
// a atendente ver a sugestão. Sugerir não pode agir.
//
// No assistente há uma pessoa no comando, e é ela quem decide o efeito. A
// ferramenta de leitura continua rodando — é o que monta a sugestão. A de ação
// para aqui, antes de tudo: antes da posse, antes da identidade, antes de
// qualquer chamada externa.
//
// Vale por CLASSIFICAÇÃO (tool-registry: temEfeitoReal), nunca por lista de
// nomes. Categoria desconhecida ou ausente também bloqueia — falha fechada.
//
// A triagem não é tocada: lá não há atendente, e a execução automática é o
// desenho. O gate só atua onde o perfil diz, com todas as letras, "assistente".
const INSTRUCAO_ACAO_HUMANA = 'Esta ação NÃO foi executada e NÃO vai acontecer sozinha: neste atendimento quem executa é a atendente. NÃO diga que fez, que liberou, que transferiu, que encerrou nem que está em andamento. Escreva a sugestão explicando à ATENDENTE o que dá para fazer e o que ela precisa confirmar, e deixe a decisão com ela.';

function exigeAprovacaoHumana(contexto, tool) {
  return contexto && contexto.perfil === 'assistente' && temEfeitoReal(tool);
}

/**
 * A ordem destas verificações é parte do design:
 * existe → habilitada → precisa de aprovação humana → argumentos válidos →
 * o contrato é deste contato → executa com timeout. Nada toca o SGP antes da
 * quinta verificação passar.
 *
 * Tudo fica dentro do try: uma recusa nunca é uma exceção, então qualquer
 * falha inesperada em qualquer um destes passos (inclusive um erro transitório
 * de isToolEnabled, ou um contexto malformado) também vira execution_error
 * em vez de escapar como uma promise rejeitada.
 */
async function executeTool(nome, args, contexto, { timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
  try {
    // Fica true só quando o contrato pedido é o de contexto.terceiro E a
    // ferramenta está em FERRAMENTAS_PERMITIDAS_EM_TERCEIRO — as duas coisas
    // juntas, decidido mais abaixo. É a marca que abre a exceção estreita ao
    // gate de identidade forte, logo depois. A Task 8 também lê esta marca.
    let emTerceiro = false;
    const tool = findTool(nome);
    if (!tool) return recusa('unknown_tool', nome);

    // Um perfil (a triagem) pode trazer a própria lista fixa de ferramentas:
    // ela substitui a tabela de permissões, que governa só o assistente.
    if (Array.isArray(contexto.ferramentasPermitidas)) {
      if (!contexto.ferramentasPermitidas.includes(nome)) return recusa('tool_not_in_profile', nome);
    } else if (!(await isToolEnabled(nome))) {
      return recusa('tool_disabled', nome);
    }

    // Antes de validar argumento, conferir posse ou tocar em qualquer coisa
    // externa: no assistente, ação é proposta, não execução.
    if (exigeAprovacaoHumana(contexto, tool)) {
      return recusa('action_requires_human_approval', nome, INSTRUCAO_ACAO_HUMANA);
    }

    // Com um contrato só, o contratoId é dedutível — e obrigar o modelo a escolher
    // um número que ele não vê direito é de onde vinham escolhas erradas e
    // perguntas desnecessárias ao cliente.
    //
    // Caso Fulana/Beltrana (25/09/2026): era AQUI que o PIX da Fulana saía no pedido da Beltrana —
    // "manda o pix" sem contrato caía no contrato único DA FULANA. Agora a dedução segue o alvo
    // financeiro: com pedido de terceiro em andamento, nunca o contrato de quem fala; nas
    // ferramentas permitidas em terceiro, o contrato único DO TERCEIRO; nas demais, nada é
    // deduzido (o modelo tem de dizer, explicitamente, qual contrato quer).
    const proprios = (contexto && contexto.contracts) || [];
    const alvo = alvoFinanceiro(contexto);
    if (tool.chaveProprietario === 'contratoId'
        && (!args || args.contratoId === undefined || args.contratoId === null)) {
      if (alvo.tipo === 'terceiro') {
        if (FERRAMENTAS_PERMITIDAS_EM_TERCEIRO.includes(nome) && alvo.contratos.length === 1) {
          args = { ...(args || {}), contratoId: alvo.contratos[0] };
        }
      } else if (proprios.length === 1) {
        args = { ...(args || {}), contratoId: proprios[0].id };
      }
    }

    const validacao = tool.validar(args);
    if (!validacao.ok) return recusa('invalid_args', validacao.erro);
    let argsValidados = validacao.args;

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
      //
      // Caso Fulana/Beltrana (25/09/2026): na triagem, um CPF DIFERENTE do titular da conversa É
      // um pedido de terceiro, com ou sem a marcação do modelo. Antes, sem a marcação, a busca
      // era recusada e o modelo seguia com a cobrança de quem fala. Agora ela vira consulta de
      // terceiro — que nunca troca a identidade, nem grava nada no contato.
      if (perfilTriagem(contexto)) {
        const titular = documentoDoTitularDaConversa(contexto);
        if (titular && titular !== argsValidados.cpf && argsValidados.titularEOutraPessoa !== true) {
          argsValidados = { ...argsValidados, titularEOutraPessoa: true };
        }
      } else {
        const jaIdentificado = contexto.contact && contexto.contact.sgpDocument;
        if (jaIdentificado && jaIdentificado !== argsValidados.cpf && argsValidados.titularEOutraPessoa !== true) {
          return recusa('client_already_identified', null);
        }
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
      const proprio = (contexto.contracts || []).some((c) => c.id === valor);
      if (!proprio) {
        // Não é do contato. Antes de recusar de vez, confere se é o contrato
        // do terceiro registrado nesta conversa (buscar_cliente com
        // titularEOutraPessoa) — e, mesmo assim, só uma lista FECHADA de
        // ferramentas pode tocar nele: o resto (plano, conexão, status,
        // financeiro, desbloqueio) é recusado, mesmo que o contrato exista.
        const deTerceiro = ((contexto.terceiro && contexto.terceiro.contratos) || []).some((c) => c.id === valor);
        if (!deTerceiro) return recusa('contract_not_owned', valor);
        if (!FERRAMENTAS_PERMITIDAS_EM_TERCEIRO.includes(nome)) {
          return recusa('third_party_tool_not_allowed', nome, INSTRUCAO_TERCEIRO);
        }
        emTerceiro = true;
      }
    }

    // Entrega de dado (boleto, PIX) só com identidade forte — regra em código,
    // não em prompt. A marcação vale sempre que o turno usa o perfil de
    // triagem (perfilTriagem: contexto.ferramentasPermitidas fixo OU já existe
    // contexto.identidade); só fica inerte quando nenhum dos dois está
    // presente (o assistente clássico, sem perfil de triagem e sem
    // resolução de identidade — um humano acompanha ali). Mesmo
    // discriminador usado em tool-registry.js, importado em vez de duplicado
    // aqui, para as duas checagens nunca divergirem.
    //
    // A exceção (!emTerceiro) vale EXCLUSIVAMENTE para contrato dentro do
    // escopo de terceiro E ferramenta da lista de permissão — as duas
    // condições juntas são o que emTerceiro significa, porque qualquer outra
    // combinação já voltou acima (contract_not_owned ou
    // third_party_tool_not_allowed). A identidade de quem está falando NÃO é
    // elevada em momento nenhum aqui: a autorização vem do escopo do
    // terceiro, e morre com ele. Quem pede o boleto da esposa pode não ser
    // cliente nenhum, e não pode ser promovido a cliente por digitar o CPF
    // dela.
    if (tool.exigeIdentidadeForte && perfilTriagem(contexto) && !emTerceiro
        && !(contexto.identidade && contexto.identidade.nivel === 'forte')) {
      const jaPedido = contexto.documento && contexto.documento.alvo === 'principal';
      return recusa('identity_not_confirmed', nome, jaPedido ? INSTRUCAO_IDENTIDADE_JA_PEDIDA : INSTRUCAO_IDENTIDADE);
    }

    // GATE DO ALVO FINANCEIRO (caso Fulana/Beltrana): com pedido de terceiro em andamento, uma
    // ferramenta que entrega cobrança só age num contrato DO TERCEIRO — o que o SGP devolveu
    // para o documento informado. Contrato de quem fala, de um terceiro anterior, ou nenhum
    // (documento não encontrado): recusa antes de tocar o SGP. Sem fallback nenhum. Fica depois das
    // checagens de posse e de identidade (que continuam dando os motivos delas) e antes da execução.
    if (FERRAMENTAS_DE_COBRANCA.includes(nome) && contexto.alvoAmbiguo) {
      return recusa('financial_target_ambiguous', null, INSTRUCAO_ALVO_AMBIGUO);
    }
    if (FERRAMENTAS_DE_COBRANCA.includes(nome) && alvo.tipo === 'terceiro'
        && !alvo.contratos.includes(argsValidados.contratoId)) {
      return recusa('financial_target_mismatch', null, INSTRUCAO_ALVO_TERCEIRO);
    }

    // Uma ferramenta pode declarar o próprio orçamento (tool.timeoutMs): a
    // de liberação em confiança faz duas leituras E uma escrita no SGP, cada
    // uma com 15 s de HTTP. Com o orçamento padrão (igual ao HTTP), o race
    // aqui podia vencer com "timeout" enquanto o SGP ainda liberava o serviço
    // — ação real reportada ao modelo como falha.
    const resultado = await comTimeout(tool.executar(argsValidados, contexto), tool.timeoutMs || timeoutMs);
    if (resultado === Symbol.for('timeout')) return recusa('timeout', nome);
    if (resultado && resultado.ok === false) return recusa('execution_error', resultado.erro);
    // Minimização: o resultado de um contrato de terceiro passa pela projeção antes
    // de chegar ao modelo. Aplicada aqui, e não em cada ferramenta, para que uma
    // ferramenta futura na lista de permissão não possa esquecer de aplicá-la.
    if (emTerceiro) return { ok: true, resultado: minimizarParaTerceiro(nome, resultado) };
    return { ok: true, resultado };
  } catch (err) {
    logFalha(nome, err);
    return recusa('execution_error', err && err.message);
  }
}

module.exports = { executeTool };
