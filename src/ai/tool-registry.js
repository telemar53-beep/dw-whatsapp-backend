const sgpClient = require('../integrations/sgp-client');
const { normalizeContract, normalizeConnection, normalizeInvoices } = require('./sgp-normalizer');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const {
  setSuggestedReason, setConversationSector, concludeAiTriage, getConversationWithContact,
  markPhoneContested, markTriageResolvedByAi, closeConversationByAi, setThirdPartyScope,
  setTriageReactivation, getTriageReactivation, reserveTriageNightInvoice, getTriageNightInvoice,
} = require('../conversations/conversation.repository');
const { montarEscopo, paraContexto } = require('./third-party-scope');
const {
  alvoFinanceiro, ehAlvoTerceiro, contratoNoAlvo, fixarAlvoTerceiro, liberarAlvoTerceiro,
} = require('./financial-target');
const { motivoDeEncerramentoAtivo } = require('./triage-close-reason');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { avaliarElegibilidade, MENSAGENS: MENSAGENS_DESBLOQUEIO, DIAS_ENTRE_LIBERACOES } = require('./trust-unlock-rules');
const { saveMediaFile } = require('../media/media-storage');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { enviarPix, enviarBoleto } = require('../payments/payment-sender');
const { formatarData } = require('../payments/payment-card');
const { broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { primeiroNome } = require('./identity-resolver');
const { preencherCidadePeloSgp } = require('../cities/contact-city.service');
const { enviarAvisoDeCidadeSePreciso, selecionarAvisoDoContato } = require('../city-notices/city-notice.service');
const { instrucaoDoAvisoAtivo, avisoParaResultado, suspensaoAfastaOAviso } = require('./regional-outage');
const { linhaDoWifiNoResumo } = require('./contencoes-operacionais');
const { mensagemSegura } = require('./safe-error-log');
const { findLatestInboundImage } = require('../conversations/message.repository');
const { getAiConfig } = require('./ai-config.repository');
const { analisarComprovante } = require('./receipt-analysis');
const { claimReceipt, releaseReceipt, findReceiptUsage } = require('./receipt-usage.repository');
const {
  claimDelivery, markDeliveryEnqueued, releaseDelivery, findLatestEnqueuedDelivery,
} = require('./billing-delivery.repository');
const {
  hojeEmSaoPaulo, analisarSituacaoFinanceiraContrato, decidirCobranca, pagamentoConfirmadoDoTitulo, descreverReativacao,
} = require('./situacao-financeira');
const { ehSetorDeReativacao, setorDeReativacao } = require('../sectors/reactivation-sector');
const { descreverUsoAnterior } = require('./receipt-usage-text');
const { listarPlanosDisponiveis } = require('../plans/plan.repository');
const { listPlaces, findCityById } = require('../cities/city.repository');
const { encontrarCidade } = require('../cities/city-matcher');

// A imagem só sai do servidor depois de passar por estes dois filtros: o
// que a OpenAI consegue ler de verdade, e um teto de bytes.
const MIMES_COMPROVANTE = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANHO_MAXIMO_COMPROVANTE = 5 * 1024 * 1024;

// Lista FECHADA: só o que o fluxo de pagamento de outra pessoa precisa. Tudo o
// mais no contrato alheio é recusado — plano devolve o login de acesso do
// titular, conexão diz se a casa dele está online, e o desbloqueio executa uma
// ação de serviço no contrato de um estranho.
const FERRAMENTAS_PERMITIDAS_EM_TERCEIRO = ['consultar_faturas', 'enviar_boleto', 'gerar_pix', 'gerar_segunda_via'];

function erro(mensagem) {
  return { ok: false, erro: mensagem };
}

// Perfil noturno do turno (calculado no worker): null de dia.
function noturnoDoContexto(contexto) {
  const t = contexto && contexto.triagem;
  return t && t.noturno && t.noturno.ativo ? t.noturno : null;
}

function horaDeSaoPaulo() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// Mesmo formato usado em conversations.routes.js: exige os hifens nas posições
// certas. /^[0-9a-f-]{36}$/i (a versão antiga aqui) aceitava 36 caracteres hex
// sem hífen nenhum — isso chega ao Postgres e vira erro de cast (22P02) em vez
// de uma recusa limpa. Este validador recebe argumentos gerados pelo modelo.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarContratoId(args) {
  const id = Number(args && args.contratoId);
  if (!Number.isInteger(id) || id <= 0) return erro('contratoId must be a positive integer');
  return { ok: true, args: { contratoId: id } };
}

/**
 * Validador das DUAS ferramentas que entregam a fatura ao cliente. Existe
 * porque validarContratoId devolve só `{ contratoId }`: todo campo a mais é
 * descartado antes de chegar em `executar`, e `reenviar` sumiria em silêncio.
 *
 * `=== true` é estrito de propósito. 'true', 1, 'sim' ou um objeto não abrem o
 * caminho do reenvio: a ausência (e qualquer valor estranho) significa "não é
 * reenvio", que já é o estado seguro. Falha FECHADO.
 */
function validarEntregaDeFatura(args) {
  const base = validarContratoId(args);
  if (!base.ok) return base;
  return { ok: true, args: { ...base.args, reenviar: Boolean(args && args.reenviar === true) } };
}

// Opcional nas duas ferramentas, e não `required` como pendenciasObrigatorias:
// lá a ausência significaria "nada pendente" (permissão) e por isso tinha de
// ser obrigatório; aqui a ausência significa "não é reenvio" (bloqueio), que é
// o estado seguro. Obrigá-lo normalizaria o modelo escrever `reenviar: true`.
const PARAMETRO_REENVIAR = {
  type: 'boolean',
  description: 'Só true quando, NESTA mensagem, o cliente pediu o reenvio com todas as letras ("não recebi, manda de novo", "reenvia por favor"). Confirmar, agradecer ou dizer "pode mandar" NÃO é pedido de reenvio. Em qualquer outro caso, omita.',
};

/** Total informado pela paginação do SGP, ou null quando não há como saber. */
function totalDaPaginacao(paginacao) {
  const total = paginacao && Number(paginacao.total);
  return Number.isInteger(total) ? total : null;
}

/**
 * Categorias que NÃO produzem efeito fora do sistema: só leem. Tudo o mais é
 * ação — inclusive uma categoria nova que alguém invente, ou uma ferramenta
 * que esqueça de declarar a sua.
 *
 * A checagem é por CLASSIFICAÇÃO, não por lista de nomes, de propósito: uma
 * lista de nomes só protege contra o que já existe, e foi exatamente assim que
 * desbloqueio_confianca alterou o serviço de uma cliente sem aprovação humana
 * (22/09/2026). Ferramenta nova com efeito cai na trava sozinha.
 */
const CATEGORIAS_SOMENTE_LEITURA = ['CONSULTA'];

function temEfeitoReal(tool) {
  return !tool || !CATEGORIAS_SOMENTE_LEITURA.includes(tool.categoria);
}

/**
 * True quando o turno usa o perfil de triagem — seja porque o servidor já
 * fixou a lista de ferramentas (contexto.ferramentasPermitidas), seja porque
 * já existe contexto.identidade. Mesmo discriminador usado pelo executor
 * (tool-executor.js, perfilFixo) — manter os dois em sincronia é o que
 * garante que um `identidade: null` (ou qualquer outro valor falsy) não
 * faça buscar_cliente/enviar_boleto cair de volta no ramo assistente (fix
 * round 2: antes bastava contexto.identidade ser truthy, e um null bugado
 * reabriria C1/C2).
 */
function perfilTriagem(contexto) {
  return Array.isArray(contexto.ferramentasPermitidas) || Boolean(contexto.identidade);
}

/**
 * Relê a conversa (não confia no contexto do início do turno) e diz se ela
 * saiu da triagem: um atendente já assumiu, foi fechada/silenciada, ou a
 * triagem já concluiu. Usada por toda ferramenta que EXECUTA de verdade
 * (enviar_boleto, gerar_pix) como última checagem antes de mandar algo real
 * ao cliente — entre o início do turno (a chamada à OpenAI, downloads/consultas
 * ao SGP) e este ponto, o dono da conversa pode ter mudado.
 */
async function saiuDaTriagem(conversationId) {
  const atual = await getConversationWithContact(conversationId);
  return (
    !atual || atual.assignedAgentId
    || atual.status === 'closed' || atual.status === 'silent'
    || atual.triageState !== 'pending'
  );
}

/**
 * Onde este contrato pode ser resolvido. Os contratos do próprio contato e os
 * de um terceiro consultado são dois conjuntos SEPARADOS, e nada — nem o
 * fallback de fatura — atravessa de um para o outro.
 */
function escopoDoContrato(contexto, contratoId) {
  const proprios = (contexto && contexto.contracts) || [];
  if (proprios.some((c) => c.id === contratoId)) return { contratos: proprios, terceiro: false };
  const deTerceiro = (contexto && contexto.terceiro && contexto.terceiro.contratos) || [];
  if (deTerceiro.some((c) => c.id === contratoId)) return { contratos: deTerceiro, terceiro: true };
  return null;
}

/**
 * Procura a fatura em aberto no contrato pedido e, se não houver, nos DEMAIS
 * contratos do cliente. Teste real 2026-09-13: cliente com dois contratos, o
 * modelo chamou gerar_pix no contrato sem fatura e respondeu "não encontrei
 * fatura em aberto" — mesmo com o prompt mandando consultar todos antes. A
 * garantia tem que estar no código, não na obediência do modelo.
 *
 * Propriedade: os contratos alternativos vêm de escopoDoContrato — o mesmo
 * dono do contrato pedido (o próprio contato, ou o terceiro confirmado nesta
 * conversa) — nunca do outro conjunto. Não há id vindo do modelo aqui.
 *
 * Devolve uma de quatro formas:
 * - fatura achada: { resultado, contratoId, trocouContrato, endereco? }
 * - nenhuma em lugar nenhum: { semFaturaEmNenhum: true, consultaIncompleta? }
 * - mais de um outro contrato com fatura: { varios: [{ contratoId, endereco, plano }] }
 */
async function faturaEmAlgumContrato(contratoPedido, contexto) {
  const principal = await sgpClient.getDuplicateInvoice(contratoPedido);
  // O caminho feliz continua sendo UMA chamada só ao SGP: só quem não tem
  // fatura no contrato pedido paga a consulta dos outros.
  if (principal.hasOpenInvoice) {
    return { resultado: principal, contratoId: contratoPedido, trocouContrato: false };
  }

  const escopo = escopoDoContrato(contexto, contratoPedido);
  const outros = ((escopo && escopo.contratos) || []).filter((c) => c.id !== contratoPedido);
  if (outros.length === 0) {
    return { resultado: principal, contratoId: contratoPedido, trocouContrato: false, semFaturaEmNenhum: true };
  }

  // allSettled: um contrato com falha no SGP não pode esconder os outros —
  // mesma escolha de consultar_faturas_todos_contratos. Em paralelo cabe no
  // timeoutMs de 40 s que estas ferramentas já declaram.
  const resultados = await Promise.allSettled(outros.map((c) => sgpClient.getDuplicateInvoice(c.id)));
  let consultaIncompleta = false;
  const comFatura = [];
  resultados.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      consultaIncompleta = true;
      return;
    }
    if (r.value && r.value.hasOpenInvoice) comFatura.push({ contrato: outros[i], resultado: r.value });
  });

  if (comFatura.length === 1) {
    const { contrato, resultado } = comFatura[0];
    return { resultado, contratoId: contrato.id, trocouContrato: true, endereco: normalizeContract(contrato).endereco };
  }
  if (comFatura.length === 0) {
    // consultaIncompleta muda a frase: "não há fatura" e "não consegui olhar
    // um dos contratos" não são a mesma resposta para o cliente.
    return { semFaturaEmNenhum: true, ...(consultaIncompleta ? { consultaIncompleta: true } : {}) };
  }
  return {
    varios: comFatura.map(({ contrato }) => {
      const n = normalizeContract(contrato);
      return { contratoId: contrato.id, endereco: n.endereco, plano: n.plano };
    }),
  };
}

/**
 * Relato do dono 2026-09-17: cliente com duas faturas em aberto (uma vencida e
 * uma a vencer) recebeu a que AINDA ia vencer — o SGP devolve os boletos na
 * ordem dele, e o código pegava o primeiro da lista. A entrega é sempre a mais
 * ANTIGA: é ela que tira o cliente do atraso e destrava o acesso.
 *
 * Aceita 'AAAA-MM-DD' (o que o SGP manda hoje) e 'DD/MM/AAAA'. Fatura sem data
 * legível não é reordenada: fica onde estava, para nunca piorar a ordem que
 * veio.
 */
function emMilissegundos(vencimento) {
  if (typeof vencimento !== 'string') return null;
  const iso = vencimento.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = vencimento.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  return null;
}

function daMaisAntiga(faturas) {
  const lista = Array.isArray(faturas) ? faturas.slice() : [];
  // Ordenação estável (Array.prototype.sort é estável no Node): sem data, o
  // par mantém a ordem original.
  return lista.sort((a, b) => {
    const da = emMilissegundos(a && a.dueDate);
    const db = emMilissegundos(b && b.dueDate);
    if (da === null || db === null) return 0;
    return da - db;
  });
}

/**
 * Print 2026-09-17: a IA entregou o boleto sem chamar a cliente pelo nome,
 * logo depois de identificá-la pelo CPF — o dono: "está muito robô". A
 * instrução da entrega passa a lembrar o nome; sem nome conhecido, some.
 */
function nomeParaTratar(contexto) {
  const nome = contexto && contexto.identidade && contexto.identidade.primeiroNome;
  return nome ? `Comece pelo primeiro nome do cliente ("Prontinho, ${nome}!").` : '';
}

/**
 * Endereço que o modelo de frase da entrega cita ao cliente. Regra do dono:
 * "cite o endereço só quando ele tiver mais de um contrato" — com um ponto
 * só, nada; com vários, o endereço do contrato de onde a fatura saiu (o
 * pedido, ou o outro quando faturaEmAlgumContrato trocou).
 */
function enderecoParaCitar(busca, contexto) {
  const escopo = escopoDoContrato(contexto, busca.contratoId);
  const contratos = (escopo && escopo.contratos) || [];
  if (contratos.length < 2) return null;
  if (busca.endereco) return busca.endereco;
  const usado = contratos.find((c) => c.id === busca.contratoId);
  return usado ? normalizeContract(usado).endereco : null;
}

/** Busca no cache do turno; só chama o SGP se ainda não houver nada. */
async function contratoDoCache(contexto, contratoId) {
  const escopo = escopoDoContrato(contexto, contratoId);
  const achado = ((escopo && escopo.contratos) || []).find((c) => c.id === contratoId);
  if (!achado) throw new Error('contract_not_in_context');
  return achado;
}

/**
 * Derruba a autorização sobre o contrato de terceiro. Falha FECHADO: se o banco
 * não confirmar a limpeza, quem chamou precisa abortar. Um escopo que sobrevive
 * a uma limpeza malsucedida é autorização viva sobre o contrato de um estranho,
 * e reapareceria no próximo turno como se nada tivesse acontecido.
 */
async function limparEscopoDeTerceiro(contexto) {
  try {
    await setThirdPartyScope(contexto.conversationId, null);
  } catch (err) {
    console.error(`Failed to clear the third party scope for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
    return false;
  }
  contexto.terceiro = null;
  liberarAlvoTerceiro(contexto);
  return true;
}

/**
 * Aviso de cidade como FATO do turno (25/09/2026): o aviso ativo que vale para este contato —
 * a MESMA seleção do envio automático e do worker (selecionarAvisoDoContato) — no formato que o
 * prompt e as ferramentas usam. Falha na consulta = sem aviso: nunca inventa ocorrência.
 * `impacto` fica null até existir tipo de aviso (Fase 5); null vale como geral.
 */
async function avisoAtivoDoContato(contact) {
  try {
    const escolha = await selecionarAvisoDoContato(contact);
    if (!escolha || !escolha.aviso) return null;
    const lugar = await findCityById(escolha.lugarId);
    const desde = escolha.aviso.activatedAt ? new Date(escolha.aviso.activatedAt).toISOString() : null;
    return { cidade: lugar ? lugar.name : null, mensagem: escolha.aviso.message, desde, impacto: null };
  } catch (err) {
    console.error(`City notice lookup failed for contact ${contact && contact.id}: ${mensagemSegura(err)}`);
    return null;
  }
}

/**
 * CPF/CNPJ de terceiro não encontrado (caso Fulana/Beltrana): grava o pedido de terceiro PENDENTE,
 * sem contrato. Ele não autoriza nada e segura a cobrança de quem fala nos turnos seguintes,
 * até a intenção explícita da própria cobrança, um novo CPF ou o prazo. Se a gravação falhar,
 * a trava do turno continua valendo neste turno.
 */
async function registrarTerceiroPendente(contexto) {
  const escopo = montarEscopo(null, [], new Date(), { pendente: true });
  contexto.terceiro = paraContexto(escopo);
  try {
    await setThirdPartyScope(contexto.conversationId, escopo);
  } catch (err) {
    console.error(`Failed to store the pending third party request for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
  }
}

/**
 * Última conferência antes de entregar (caso Fulana/Beltrana): com pedido de terceiro, a fatura
 * encontrada tem de ter saído de um contrato DO TERCEIRO — o que o SGP devolveu para o
 * documento informado. O SGP não traz o documento no título; o vínculo com o documento é o
 * contrato. Fora do alvo, nada é enviado.
 */
function faturaForaDoAlvo(contexto, busca) {
  return ehAlvoTerceiro(contexto) && !contratoNoAlvo(contexto, busca.contratoId);
}

/**
 * REGRA FINANCEIRA 0 / 1 / 2+ (25/09/2026) — o GATE antes de toda cobrança.
 *
 * Quem decide qual fatura pode sair é o CÓDIGO, a partir dos títulos do SGP (central/titulos,
 * todas as páginas) do contrato que está sendo cobrado — nunca a 2ª via, nunca o modelo:
 * - cancelado → reativação, nada sai;
 * - indeterminado (leitura incompleta, status fora do provado, título estranho) → humano;
 * - 0 vencidas → o fluxo de sempre;
 * - 1 vencida → só ela;
 * - 2+ vencidas → de dia nada sai (reativação); à noite, com o autoatendimento noturno, só a
 *   MAIS ANTIGA pela data ORIGINAL, e a conversa fica marcada para a reativação.
 * A 2ª via só é pedida DEPOIS da decisão, e dela só sai a fatura com o id autorizado. Se ela não
 * vier, nada é improvisado: humano.
 *
 * Cada contrato tem a própria análise. O gate roda DEPOIS do alvo financeiro (o executor já
 * garantiu que o contrato é de quem fala, ou do terceiro confirmado) e não troca de contrato: a
 * troca que já existia (faturaEmAlgumContrato, só no caso de 0 vencidas) leva o outro contrato ao
 * gate DELE.
 */

// Status do contrato como o gate lê: só os contratos de quem fala trazem status (o escopo de
// terceiro guarda só o id — para ele vale só a regra dos títulos).
function contratoParaAnalise(contexto, contratoId) {
  const escopo = escopoDoContrato(contexto, contratoId);
  const achado = escopo && !escopo.terceiro ? escopo.contratos.find((c) => c.id === contratoId) : null;
  return { id: contratoId, statusCode: achado ? achado.statusCode : undefined };
}

/** Situação financeira DESTE contrato, lida agora do SGP. Falha de leitura = indeterminado. */
async function situacaoFinanceira(contexto, contratoId) {
  let leitura = null;
  try {
    leitura = await sgpClient.listAllInvoices(contratoId);
  } catch (err) {
    console.error(`Títulos do contrato ${contratoId} não lidos na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
  }
  if (leitura && leitura.completo !== true) {
    console.warn(`Leitura incompleta dos títulos do contrato ${contratoId} (${leitura.motivo}) na conversa ${contexto.conversationId}`);
  }
  return analisarSituacaoFinanceiraContrato({
    contrato: contratoParaAnalise(contexto, contratoId),
    titulos: leitura ? normalizeInvoices(leitura.faturas) : null,
    hoje: hojeEmSaoPaulo(),
    leituraCompleta: Boolean(leitura && leitura.completo === true),
  });
}

// "Noite" é a janela E o autoatendimento noturno ligado (noturno.ativo, calculado no worker por
// isNightModeActive). Qualquer outra combinação é o dia conservador.
function decisaoDaCobranca(contexto, analise) {
  return decidirCobranca(analise, { noturnoAutoatendimento: Boolean(noturnoDoContexto(contexto)) });
}

/**
 * Marca a conversa para a reativação: no contexto (vale já neste turno) e no banco (vale nos
 * próximos turnos e no timeout). O primeiro motivo fica. Falha ao gravar não é afirmada como
 * gravada: o log diz, e o turno ainda segue marcado.
 */
async function registrarReativacao(contexto, motivo) {
  if (!perfilTriagem(contexto)) return;
  if (!contexto.reativacao) contexto.reativacao = motivo;
  try {
    await setTriageReactivation(contexto.conversationId, motivo);
  } catch (err) {
    console.error(`Falha ao gravar a reativação (${motivo}) na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
  }
}

/** A conversa está marcada para a reativação? O turno primeiro, depois o banco. */
async function reativacaoDaConversa(contexto) {
  if (contexto.reativacao) return contexto.reativacao;
  return (await getTriageReactivation(contexto.conversationId)) || null;
}

async function setorDeReativacaoSeguro() {
  try {
    return await setorDeReativacao();
  } catch (err) {
    console.error(`Setor de reativação não lido: ${mensagemSegura(err)}`);
    return null;
  }
}

// Sem nome de setor no texto (Task 19): o setor é o do painel, pelo id.
function concluirNaReativacao(setor) {
  return setor
    ? `chame concluir_triagem com o setor que cuida de reativação (setorId ${setor.id})`
    : 'chame concluir_triagem para o setor que cuidar de financeiro';
}

// O que a ferramenta diz ao modelo (fato) e o que ele diz ao cliente, por motivo da reativação.
const TEXTOS_DO_BLOQUEIO = {
  contrato_cancelado: {
    fato: 'este contrato não está ativo (consta como cancelado) e a cobrança dele não é feita pela IA',
    paraOCliente: 'o cadastro dele precisa ser tratado pela equipe responsável',
    motivo: 'Contrato cancelado: a cobrança fica com a equipe de reativação.',
  },
  multiplas_vencidas: {
    fato: 'este contrato tem duas ou mais faturas vencidas e, nesse caso, a IA não envia boleto, PIX nem segunda via',
    paraOCliente: 'há mais de uma fatura em atraso e a equipe responsável vai orientar a regularização',
    motivo: 'Duas ou mais faturas vencidas: a cobrança fica com a equipe de reativação.',
  },
  multiplas_vencidas_noturno: {
    fato: 'o contrato com a fatura em aberto entrou no modo noturno com duas ou mais faturas vencidas: dele a IA trata só a fatura vencida mais antiga, que já foi tratada, e nenhuma outra cobrança DESSE contrato sai automaticamente, mesmo que a primeira já tenha sido paga. Outro contrato só se o cliente pedir por ele',
    paraOCliente: 'as demais faturas desse contrato ficam com a equipe responsável, que continua o atendimento',
    motivo: 'Fluxo noturno de duas ou mais vencidas: só a mais antiga sai pela IA; o resto fica com a equipe de reativação.',
  },
};

/** A resposta da ferramenta quando o gate NÃO deixa a cobrança sair. */
async function bloqueioDaCobranca(decisao, contexto) {
  const triagem = perfilTriagem(contexto);
  if (decisao.acao === 'reativacao') {
    await registrarReativacao(contexto, decisao.motivo);
    const setor = await setorDeReativacaoSeguro();
    const { fato, paraOCliente, motivo } = TEXTOS_DO_BLOQUEIO[decisao.motivo] || TEXTOS_DO_BLOQUEIO.multiplas_vencidas;
    return {
      cobrancaBloqueada: 'reativacao',
      motivo,
      ...(setor ? { setorReativacao: { setorId: setor.id } } : {}),
      instrucao: triagem
        ? `NÃO houve envio: ${fato}. Não escolha outra fatura, não negocie, não fale em desconto nem parcelamento, não invente motivo para a situação do contrato e não prometa reativar nem liberar a internet. Diga ao cliente, em uma frase e sem valores, que ${paraOCliente}, e ${concluirNaReativacao(setor)}.`
        : `Pela regra da empresa, ${fato}: não gere a cobrança. Oriente o atendente a tratar como reativação.`,
    };
  }
  return {
    cobrancaBloqueada: 'humano',
    motivo: 'Não foi possível confirmar com segurança a situação das faturas deste contrato.',
    instrucao: triagem
      ? 'NÃO houve envio: não foi possível confirmar com segurança a situação das faturas deste contrato agora. Não envie nada, não diga quantas faturas estão vencidas nem valores, e não tente outro contrato por conta própria. Diga ao cliente que vai encaminhar para um atendente conferir e chame concluir_triagem para o setor que cuidar de financeiro.'
      : 'Não foi possível confirmar com segurança a situação das faturas deste contrato: não gere a cobrança pela IA; o atendente confere no SGP.',
  };
}

/** Da 2ª via, só a fatura com o id AUTORIZADO. Sem ela, nada é improvisado. */
async function casarFaturaAutorizada(busca, decisao, contexto) {
  const duplicatas = (busca.resultado && busca.resultado.duplicates) || [];
  const fatura = duplicatas.find((d) => d && String(d.id) === String(decisao.faturaPermitida));
  if (!fatura) {
    console.error(`A 2ª via do contrato ${busca.contratoId} não trouxe a fatura autorizada pela regra 0/1/2+ na conversa ${contexto.conversationId}; nada enviado.`);
    return { bloqueio: await bloqueioDaCobranca({ acao: 'humano', motivo: 'segunda_via_incompativel' }, contexto) };
  }
  return { busca: { ...busca, resultado: { ...busca.resultado, duplicates: [fatura] } }, fatura, decisao };
}

/** A fatura do fluxo noturno de 2+ DESTE contrato nesta conversa, ou null se ele não entrou nele. */
async function faturaNoturnaDoContrato(contexto, contratoId) {
  const cache = contexto.faturasNoturnas || (contexto.faturasNoturnas = {});
  if (cache[contratoId]) return cache[contratoId];
  const gravada = await getTriageNightInvoice(contexto.conversationId, contratoId);
  if (gravada) cache[contratoId] = gravada;
  return gravada || null;
}

/**
 * O fluxo noturno que COMEÇOU com 2+ é grudento POR CONTRATO (ajustes de 25/09/2026): do contrato
 * que entrou nele sai SÓ a fatura vencida mais antiga escolhida ali. Depois disso — mesmo com ela
 * paga, mesmo sobrando uma vencida, de noite ou de dia — nenhuma OUTRA fatura DESSE contrato sai
 * automaticamente, e a conversa segue na reativação. O reenvio da MESMA fatura passa (a idempotência
 * de sempre decide). Outro contrato é analisado separadamente: quando o cliente pede por ele, segue
 * a regra dele (o alvo financeiro, no executor, já decidiu que ele pode ser cobrado).
 *
 * A entrada no fluxo é uma reserva ATÔMICA no banco, por contrato e com o alvo financeiro, antes de
 * qualquer 2ª via: duas entregas paralelas do mesmo contrato disputam a mesma linha, e só a fatura
 * reservada primeiro sai. Só na triagem: no assistente o humano está no comando.
 */
async function aplicarTravaNoturna(decisao, contexto, contratoId) {
  if (!perfilTriagem(contexto)) return decisao;
  if (decisao.acao === 'reativacao' || decisao.acao === 'humano') return decisao;
  const bloqueada = { acao: 'reativacao', motivo: 'multiplas_vencidas_noturno' };
  if (decisao.acao === 'entregar' && decisao.reativacaoDepois) {
    const reservada = await reserveTriageNightInvoice(contexto.conversationId, {
      contratoId, faturaId: String(decisao.faturaPermitida), alvo: alvoFinanceiro(contexto).tipo,
    });
    if (reservada) (contexto.faturasNoturnas || (contexto.faturasNoturnas = {}))[contratoId] = reservada;
    return reservada && String(reservada) === String(decisao.faturaPermitida) ? decisao : bloqueada;
  }
  const travada = await faturaNoturnaDoContrato(contexto, contratoId);
  if (!travada) return decisao;
  if (decisao.acao === 'entregar' && String(decisao.faturaPermitida) === String(travada)) {
    return { ...decisao, reativacaoDepois: true };
  }
  return bloqueada;
}

/**
 * O gate. Devolve:
 * - { bloqueio } — nada pode sair (reativação ou humano);
 * - { busca, fatura, decisao } — a ferramenta segue com a `busca` de sempre (varios,
 *   semFaturaEmNenhum e fora do alvo continuam respondidos por ela) e entrega `fatura`.
 */
async function cobrancaAutorizada(contratoPedido, contexto) {
  const decisao = await aplicarTravaNoturna(decisaoDaCobranca(contexto, await situacaoFinanceira(contexto, contratoPedido)), contexto, contratoPedido);
  if (decisao.acao === 'reativacao' || decisao.acao === 'humano') {
    return { bloqueio: await bloqueioDaCobranca(decisao, contexto) };
  }
  if (decisao.acao === 'entregar') {
    const resultado = await sgpClient.getDuplicateInvoice(contratoPedido);
    return casarFaturaAutorizada({ resultado, contratoId: contratoPedido, trocouContrato: false }, decisao, contexto);
  }
  // 0 vencidas: o fluxo de sempre, inclusive a troca para outro contrato do MESMO dono.
  const busca = await faturaEmAlgumContrato(contratoPedido, contexto);
  const maisAntigaDaBusca = () => (busca.resultado ? daMaisAntiga(busca.resultado.duplicates)[0] : null);
  if (busca.varios || busca.semFaturaEmNenhum || !busca.trocouContrato || faturaForaDoAlvo(contexto, busca)) {
    return { busca, fatura: maisAntigaDaBusca(), decisao };
  }
  // Contrato do fluxo noturno de 2+ nunca é reserva de outro: a troca automática não cai nele (o
  // pedido de B sem fatura não vira a cobrança de A). O caminho inverso não existe: o pedido em A
  // é decidido pela trava de A antes de qualquer troca.
  if (perfilTriagem(contexto) && await faturaNoturnaDoContrato(contexto, busca.contratoId)) {
    return { bloqueio: await bloqueioDaCobranca({ acao: 'reativacao', motivo: 'multiplas_vencidas_noturno' }, contexto) };
  }
  // A troca achou fatura em OUTRO contrato: ele passa pelo PRÓPRIO gate, com os títulos dele.
  const doOutro = await aplicarTravaNoturna(decisaoDaCobranca(contexto, await situacaoFinanceira(contexto, busca.contratoId)), contexto, busca.contratoId);
  if (doOutro.acao === 'reativacao' || doOutro.acao === 'humano') {
    return { bloqueio: await bloqueioDaCobranca(doOutro, contexto) };
  }
  if (doOutro.acao === 'entregar') return casarFaturaAutorizada(busca, doOutro, contexto);
  return { busca, fatura: maisAntigaDaBusca(), decisao: doOutro };
}

/**
 * Status do contrato RELIDO agora no SGP (consultacliente), como texto ('1', '3', '4'...), ou null
 * quando não dá para saber. O documento nunca vai para log.
 */
async function statusRelidoDoContrato(contexto, contratoId) {
  const documento = contexto.contact && contexto.contact.sgpDocument;
  if (!documento) return null;
  try {
    const { contracts } = await sgpClient.lookupClientByCpf(documento);
    const contrato = (contracts || []).find((c) => c.id === contratoId);
    const codigo = contrato && contrato.statusCode;
    return codigo === undefined || codigo === null || String(codigo).trim() === '' ? null : String(codigo).trim();
  } catch (err) {
    console.error(`Releitura do contrato ${contratoId} falhou na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
    return null;
  }
}

/**
 * Depois de uma entrega: 2+ à noite marca a reativação e NUNCA "resolvido pela IA"; o resto marca
 * resolvido como sempre. contexto.resolvidoPelaIa fica true nos dois casos — ele diz "houve
 * entrega neste turno" (é o que a guarda de anúncio de envio lê); a conclusão é que ignora a
 * marca quando há reativação.
 */
async function marcarDepoisDaEntrega(gate, contexto) {
  contexto.resolvidoPelaIa = true;
  if (gate.decisao && gate.decisao.reativacaoDepois) {
    await registrarReativacao(contexto, 'multiplas_vencidas_noturno');
    return;
  }
  // Conversa já marcada para a reativação (outro contrato com 2+, cancelado...): a entrega não a
  // torna "resolvida pela IA".
  if (await reativacaoDaConversa(contexto)) return;
  await markTriageResolvedByAi(contexto.conversationId);
}

/**
 * Para onde as instruções do desbloqueio mandam concluir: a conversa marcada para a reativação
 * (inclusive a que começou com 2+ à noite) vai para lá mesmo depois de uma liberação em confiança;
 * o resto, como sempre, para o setor que cuidar de financeiro.
 */
async function destinoDaConclusaoFinanceira(contexto) {
  if (await reativacaoDaConversa(contexto)) return concluirNaReativacao(await setorDeReativacaoSeguro());
  return 'chame concluir_triagem para o setor que cuidar de financeiro';
}

// Fecho da frase de entrega no caso noturno de 2+: as demais faturas não somem, e nada é
// prometido sobre a internet.
function fraseDasDemaisVencidas(contexto) {
  const noturno = noturnoDoContexto(contexto);
  return ` As demais faturas em atraso ficam com a nossa equipe, que continua seu atendimento${noturno && noturno.retornoAs ? ` a partir das ${noturno.retornoAs}` : ' no próximo expediente'}.`;
}

/**
 * IDEMPOTÊNCIA DA ENTREGA (boleto e PIX)
 *
 * Simulação real, roteiro 14: a IA entregou o boleto; no turno seguinte, diante
 * de um "Pode mandar" ambíguo, entregou DE NOVO. Em produção isso é o cliente
 * recebendo dois boletos e podendo pagar duas vezes. Nenhuma das duas
 * ferramentas tinha qualquer checagem de já-enviado.
 *
 * A guarda é um claim atômico no banco (ai_billing_deliveries), reivindicado
 * antes de qualquer efeito externo e confirmado só depois que todos voltaram.
 *
 * O DESENHO (v2): a MENSAGEM INBOUND é a identidade da entrega; `reenviar` é
 * só permissão. O desenho anterior punha `reenviar` na identidade ('initial'
 * vs 'resend:<messageId>') e por isso a MESMA mensagem do cliente conseguia
 * produzir duas entregas — uma tool call sem `reenviar` e outra com
 * `reenviar: true` caíam em chaves diferentes. Medido em banco real.
 *
 * As duas propriedades são das DUAS restrições do Postgres, nunca de um
 * SELECT antes do INSERT:
 *   1. UNIQUE (conversa, ferramenta, contrato, fatura, message_id)
 *      → uma entrega por mensagem do cliente, INDEPENDENTE de `reenviar`.
 *   2. índice parcial único WHERE is_resend = false
 *      → um único envio INICIAL, para sempre.
 */

/**
 * A resposta quando o claim NÃO foi obtido. As duas situações não são a mesma
 * coisa, e a diferença é exatamente o que o modelo pode dizer ao cliente:
 * - com `enqueuedAt`: a entrega chegou a ser enfileirada → `jaEnviado`.
 * - só com `claimedAt` (ou registro ilegível): uma tentativa começou e nunca
 *   confirmou → `envioAnteriorIncerto`, e a instrução NÃO pode afirmar que o
 *   cliente recebeu, porque não sabemos.
 */
function respostaDeDuplicata(registro, item) {
  if (registro && registro.enqueuedAt) {
    return {
      enviado: false,
      jaEnviado: true,
      instrucao: `O ${item} desta fatura já foi enviado nesta conversa. Não envie de novo, a menos que o cliente peça o reenvio com todas as letras. Se ele apenas confirmou, agradeceu ou disse "pode mandar", só responda: o ${item} já está com ele, logo acima.`,
    };
  }
  return {
    enviado: false,
    envioAnteriorIncerto: true,
    instrucao: `Uma tentativa anterior de enviar o ${item} desta fatura nesta conversa ficou SEM confirmação. Não afirme que o cliente recebeu, porque não sabemos. Não repita o envio por conta própria: pergunte a ele se o ${item} chegou. Se ele disser que não e pedir o reenvio com todas as letras, aí sim chame esta ferramenta de novo com reenviar: true.`,
  };
}

/**
 * FAIL-CLOSED: sem um identificador ESTÁVEL a guarda inteira deixa de existir,
 * e o jeito de ela deixar de existir é silencioso — cada chamada geraria uma
 * chave nova, tudo passaria, e pareceria que funciona. Então na falta de
 * qualquer um dos dois identificadores a ferramenta NÃO envia. Nunca um
 * fallback genérico, nunca um aleatório, nunca o relógio.
 */
function respostaSemIdentificador(item, campo) {
  return {
    enviado: false,
    entregaSemIdentificador: campo,
    motivo: campo === 'faturaId'
      ? 'A fatura veio sem identificador, e sem ele não há como impedir um segundo envio da mesma cobrança.'
      : 'Este turno não sabe qual mensagem do cliente o originou, e sem isso não há como impedir um segundo envio da mesma cobrança.',
    // Sem nome de setor no texto (Task 19): os setores são cadastrados pelo
    // provedor, e um nome fixo aqui quebraria em qualquer outra instalação.
    instrucao: `NÃO houve envio: o cliente não recebeu nada. Não tente de novo por conta própria e não diga que enviou. Avise que você não conseguiu emitir o ${item} agora e conclua a triagem encaminhando para um atendente humano.`,
  };
}

/** Só vale como identificador de fatura o que é não-nulo e não é string vazia. */
function identificadorDeFatura(fatura) {
  const id = fatura && fatura.id;
  if (id === null || id === undefined) return null;
  const texto = String(id).trim();
  return texto === '' ? null : texto;
}

/**
 * Reivindica a entrega desta fatura. Devolve `{ claimId }` quando a ferramenta
 * pode seguir, ou `{ resposta }` pronta quando não pode.
 *
 * A identidade do claim é (conversa, ferramenta, contrato, fatura, MENSAGEM).
 * `isResend` não entra na identidade: ele só libera a segunda restrição (o
 * índice parcial do envio inicial). É essa separação que faz a mesma mensagem
 * do cliente entregar uma vez só, tenha ela pedido o reenvio ou não.
 *
 * Um claim obtido mas sem id não teria como ser confirmado nem liberado depois:
 * vira duplicata incerta, porque bloquear é mais seguro do que arriscar
 * entregar dinheiro duas vezes.
 */
async function reivindicarEntrega({ tool, item, contratoId, fatura, args, contexto }) {
  const invoiceId = identificadorDeFatura(fatura);
  if (!invoiceId) {
    console.error(`${tool}: fatura sem id na conversa ${contexto.conversationId}; entrega recusada para não arriscar a duplicata.`);
    return { resposta: respostaSemIdentificador(item, 'faturaId') };
  }
  const messageId = contexto && contexto.messageId;
  if (!messageId) {
    console.error(`${tool}: turno sem messageId na conversa ${contexto.conversationId}; entrega recusada para não arriscar a duplicata.`);
    return { resposta: respostaSemIdentificador(item, 'messageId') };
  }

  const { obtido, registro } = await claimDelivery({
    conversationId: contexto.conversationId,
    tool,
    contractId: contratoId,
    invoiceId,
    messageId,
    isResend: args && args.reenviar === true,
  });
  if (!obtido) return { resposta: respostaDeDuplicata(registro, item) };
  if (!registro || !registro.id) return { resposta: respostaDeDuplicata(null, item) };
  return { claimId: registro.id };
}

/**
 * ZONA A — antes de qualquer efeito externo. Nada saiu do sistema, então
 * devolver o claim é correto: a próxima tentativa TEM de poder entregar.
 * Uma falha ao liberar não muda a resposta da ferramenta; no pior caso o claim
 * fica de pé e a próxima chamada lê "incerto", que é o lado seguro.
 */
async function liberarEntrega(claimId, conversationId, onde) {
  try {
    await releaseDelivery(claimId);
  } catch (err) {
    console.error(`Falha ao liberar o claim de entrega (${onde}) na conversa ${conversationId}: ${mensagemSegura(err)}`);
  }
}

/**
 * ZONA C — todos os efeitos externos voltaram. Uma falha aqui não desfaz a
 * entrega e não pode derrubar a ferramenta: o claim fica sem enqueued_at e a
 * próxima chamada lê "incerto" em vez de "já enviado". Nunca o contrário.
 */
async function confirmarEntrega(claimId, conversationId) {
  try {
    await markDeliveryEnqueued(claimId);
  } catch (err) {
    console.error(`Falha ao confirmar a entrega ${claimId} na conversa ${conversationId}: ${mensagemSegura(err)}`);
  }
}

/** Transforma o JSON gravado do resultado numa frase curta para o atendente. */
function legivel(serializado) {
  try {
    const dado = JSON.parse(serializado);
    if (dado && typeof dado === 'object') {
      const partes = Object.entries(dado)
        .filter(([chave]) => chave !== 'instrucao' && chave !== 'proximoPasso')
        .map(([chave, valor]) => `${chave} ${typeof valor === 'object' ? JSON.stringify(valor) : valor}`);
      if (partes.length > 0) return partes.join(', ').slice(0, 160);
    }
  } catch (err) { /* resultado truncado não é JSON válido: cai no texto cru */ }
  return String(serializado).slice(0, 160);
}

// Formatacao deterministica, sem Intl: o valor vai para o MODELO, e o formato
// tem de ser o mesmo em qualquer maquina. Um bug de locale no Intl ja custou
// caro neste projeto, e aqui nao ha nada que justifique o risco.
function reais(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return `R$ ${numero.toFixed(2).replace('.', ',')}`;
}

// Teste real de 2026-09-22: a IA ofereceu "500 Mega — 500 Mbps — R$ 100/mês".
// O nome comercial JÁ diz a velocidade, então repeti-la soa artificial no
// WhatsApp.
//
// A regra é por COMPARAÇÃO, nunca por lista dos planos de hoje: tira os números
// do nome e vê se algum bate com speed_mbps. "500 Mega" bate e a velocidade sai
// da linha; "Plano Gamer" não tem número nenhum, então "800 Mbps" continua
// aparecendo. "Combo 2 Telas" a 500 também mostra, porque 2 ≠ 500.
//
// A unidade do nome conta: "1 Giga" diz a mesma velocidade que speed_mbps 1000,
// só em outra escala — sem isso a linha viraria "1 Giga — 1000 Mbps", que é
// exatamente a duplicidade que esta função existe para tirar.
function nomeJaDizVelocidade(nome, mbps) {
  const velocidade = Number(mbps);
  if (typeof nome !== 'string' || !Number.isFinite(velocidade)) return false;
  const emGiga = /giga|gbps/i.test(nome);
  return (nome.match(/\d+(?:[.,]\d+)?/g) || []).some((bruto) => {
    const n = Number(bruto.replace(',', '.'));
    return n === velocidade || (emGiga && n * 1000 === velocidade);
  });
}

// A condição de instalação quando ela é a MESMA em todos os planos. Nesse caso
// ela é da operação, não do plano: repetir "Instalação grátis" em cada linha
// polui a lista. Condições diferentes devolvem null, e aí cada plano precisa
// mesmo carregar a sua.
//
// Contrato: null ou texto com conteúdo, nunca string vazia. Quem chama testa
// por `!== null`, então catálogo sem condição cadastrada precisa sair daqui
// como null — devolver '' publicaria uma condição de instalação em branco.
function condicaoComumDeInstalacao(planos) {
  const condicoes = planos.map((p) => (p.installCondition || '').trim());
  if (condicoes.length === 0 || condicoes.some((c) => !c)) return null;
  return condicoes.every((c) => c === condicoes[0]) ? condicoes[0] : null;
}

// O que o modelo ve de um plano. A forma e montada AQUI, campo a campo, em vez
// de repassar a linha do cadastro: a observacao interna e os campos
// administrativos nao podem vazar por descuido de um SELECT que cresceu.
//
// `rotulo` vem pronto de proposito. Deixar a montagem da linha para o modelo
// foi o que produziu a velocidade repetida: instrução de formato no prompt é
// palpite, string calculada é fato.
function planoParaModelo(plano) {
  const mensalidadeFormatada = reais(plano.monthlyPrice);
  const velocidade = Number.isFinite(Number(plano.speedMbps)) && !nomeJaDizVelocidade(plano.name, plano.speedMbps)
    ? `${plano.speedMbps} Mbps`
    : null;
  // Centavos zerados saem só da LINHA: "R$ 100/mês" é como se escreve um valor
  // redondo no WhatsApp. `mensalidadeFormatada` continua com os centavos, que
  // é o valor exato — e R$ 99,90 mantém os dele nos dois lugares.
  const naLinha = mensalidadeFormatada && mensalidadeFormatada.replace(/,00$/, '');
  return {
    id: plano.id,
    nome: plano.name,
    velocidadeMbps: plano.speedMbps,
    mensalidade: plano.monthlyPrice,
    mensalidadeFormatada,
    instalacao: plano.installCondition || null,
    rotulo: [plano.name, velocidade, naLinha ? `${naLinha}/mês` : null]
      .filter(Boolean).join(' — '),
  };
}

const TOOLS = [
  {
    nome: 'buscar_cliente',
    categoria: 'CONSULTA',
    descricao: 'Localiza o cliente no sistema a partir do CPF ou CNPJ e retorna os contratos dele. Use quando o cliente ainda não foi identificado.',
    // Isento da checagem de propriedade: é o próprio passo que estabelece a
    // identificação, então ainda não há contrato para conferir. A troca de
    // cliente no meio da conversa é barrada à parte, pelo nome da ferramenta,
    // no executor (client_already_identified).
    isentoDeProprietario: true,
    parametros: {
      type: 'object',
      properties: {
        cpf: { type: 'string', description: 'CPF ou CNPJ do cliente, com ou sem pontuação.' },
        // Print 2026-09-16: "quero a fatura de Jureildson" + o CPF dele fez o
        // contato de quem pediu ficar vinculado ao cadastro do titular.
        titularEOutraPessoa: {
          type: 'boolean',
          description: 'true quando quem está falando disse que o CPF é de OUTRA pessoa (fatura do amigo, do marido, do pai). Nesse caso o cadastro do titular não passa a ser o de quem fala.',
        },
      },
      required: ['cpf'],
    },
    validar(args) {
      const cpf = String((args && args.cpf) || '').replace(/\D/g, '');
      if (!cpf) return erro('cpf is required');
      // Só o booleano puro conta: uma string "sim" vinda do modelo não pode
      // desligar a persistência do vínculo por acidente (nem ligar).
      return { ok: true, args: { cpf, titularEOutraPessoa: (args && args.titularEOutraPessoa) === true } };
    },
    async executar(args, contexto) {
      // No perfil de triagem, um CPF errado é esperado (o cliente pode digitar
      // o número errado uma vez) — mas sem limite, o modelo poderia varrer
      // CPFs até achar um que bata. Dois distintos no mesmo turno é o teto: o
      // terceiro é recusado. O mesmo CPF repetido não conta.
      if (perfilTriagem(contexto)) {
        if (!contexto.cpfsBuscados) contexto.cpfsBuscados = new Set();
        if (!contexto.cpfsBuscados.has(args.cpf) && contexto.cpfsBuscados.size >= 2) {
          return erro('CPF lookup limit reached for this turn');
        }
        contexto.cpfsBuscados.add(args.cpf);
      }

      // Caso Fulana/Beltrana: o pedido passa a ser do terceiro ANTES da resposta do SGP. Se o
      // documento não for encontrado (a consulta lança), a trava fica vazia e nenhuma cobrança
      // sai neste turno — nem a de quem fala. Um novo terceiro substitui o anterior.
      const pedidoDeTerceiro = perfilTriagem(contexto) && args.titularEOutraPessoa;
      if (pedidoDeTerceiro) {
        fixarAlvoTerceiro(contexto, []);
        // O pedido anterior de terceiro não sobrevive a este: a persistência é sobrescrita logo
        // abaixo — pelo escopo do novo terceiro, ou pelo pendente se o documento não existir.
        contexto.terceiro = null;
      }

      let achado;
      try {
        achado = await sgpClient.lookupClientByCpf(args.cpf);
      } catch (err) {
        // Documento de terceiro não encontrado (ou o SGP falhou): o pedido CONTINUA sendo de
        // terceiro, pendente e sem contrato — nos próximos turnos, "manda o pix" não vira o PIX
        // de quem fala. O documento nunca vai a log.
        if (pedidoDeTerceiro) await registrarTerceiroPendente(contexto);
        throw err;
      }
      const { client, contracts } = achado;

      // No perfil de triagem, o CPF digitado já deixa a identidade forte,
      // com a cidade preenchida e o aviso de falha regional disparado aqui
      // mesmo.
      if (perfilTriagem(contexto)) {
        const nome = primeiroNome(client.name);
        // Fatura de outra pessoa (print 2026-09-16): o CPF do titular abre o
        // contrato dele — igual à segunda via do site do SGP —, mas o
        // contato de quem está falando NÃO vira o titular: nada é
        // persistido, a cidade não é sobrescrita e quem fala continua sendo
        // chamado pelo próprio nome.
        if (args.titularEOutraPessoa) {
          // O CPF do titular abre o contrato dele — igual à segunda via do site do SGP —,
          // mas NADA disso vira o contato: sem persistência no contato, sem cidade, sem
          // trocar o nome de quem fala. E, principalmente, SEM MEXER EM
          // contexto.identidade: quem está falando pode não ser cliente nenhum, e digitar
          // o CPF de outra pessoa não pode elevar a identidade de ninguém. A autorização
          // mora no escopo, não na identidade do solicitante.
          const escopo = montarEscopo(nome, contracts);

          // Falha fechado: a gravação vem ANTES de o escopo valer neste turno. Sem
          // persistência não há autorização — nem agora nem no turno seguinte. Deixar o
          // turno seguir com um escopo que o banco não conhece é o começo de um escopo
          // órfão. O documento nunca entra no log.
          try {
            await setThirdPartyScope(contexto.conversationId, escopo);
          } catch (err) {
            console.error(`Failed to store the third party scope for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
            return erro('third_party_scope_not_stored');
          }
          contexto.terceiro = paraContexto(escopo);
          fixarAlvoTerceiro(contexto, contracts);

          return {
            titular: { nome },
            contratos: contracts.map((c) => ({ id: c.id })),
            instrucao: `O CPF é de OUTRA pessoa (${nome}), não de quem está falando. Você pode consultar a fatura e entregar o boleto ou o PIX desse contrato; plano, conexão e status do contrato dela não podem ser consultados. NUNCA diga "seu contrato" nem "sua fatura": diga que localizou o contrato no CPF informado e, ao entregar, diga de quem é ("o boleto do contrato de ${nome}"). Continue chamando quem fala pelo nome dela. Ao concluir, registre no resumo que quem pediu não é o titular.`,
          };
        }
        contexto.contracts = contracts;
        if (!(await limparEscopoDeTerceiro(contexto))) return erro('third_party_scope_not_cleared');
        contexto.identidade = {
          nivel: 'forte', origem: 'cpf', primeiroNome: nome, contracts,
          client: { id: client.id, document: args.cpf }, contestado: false,
        };
        await setContactSgpLink(contexto.contact.id, {
          sgpClientId: client.id,
          sgpContractId: contracts.length === 1 ? contracts[0].id : null,
          sgpDocument: args.cpf,
          // O nome guardado no contato salva o cumprimento quando o SGP não
          // responder no próximo atendimento.
          sgpFirstName: nome,
        });
        contexto.contact.sgpDocument = args.cpf;
        // Try/catch: a identificação já está persistida e não pode virar
        // recusa por causa de um campo acessório. O CPF nunca vai a log.
        let avisoEnviadoAgora = null;
        try {
          await preencherCidadePeloSgp(contexto.contact, contracts);
          avisoEnviadoAgora = await enviarAvisoDeCidadeSePreciso({
            contact: contexto.contact,
            conversationId: contexto.conversationId,
            channelId: contexto.channelId,
          });
        } catch (err) {
          console.error(`City autofill failed for contact ${contexto.contact.id}: ${mensagemSegura(err)}`);
        }
        // Aviso de cidade (25/09/2026): a cidade acabou de ser descoberta aqui, e o prompt deste
        // turno foi montado antes, sem ela. O aviso ativo volta NO RETORNO — e em
        // contexto.avisoCidade, que o orquestrador usa para recompor o prompt antes da resposta
        // final. Sem isso, "Cliente identificado" escondia a falha regional e a IA seguia o
        // roteiro individual.
        const aviso = await avisoAtivoDoContato(contexto.contact);
        // Um aviso por turno: se ele saiu para o cliente NESTE turno — agora, por esta ferramenta,
        // ou no começo do turno, pelo worker —, o fato leva a marca transitória (nada no banco) e
        // a resposta final não repete a ocorrência.
        const jaSaiuNesteTurno = Boolean(avisoEnviadoAgora)
          || Boolean(contexto.avisoCidade && contexto.avisoCidade.enviadoNesteTurno === true);
        if (aviso && jaSaiuNesteTurno) aviso.enviadoNesteTurno = true;
        if (aviso) contexto.avisoCidade = aviso;
        const instrucaoDeSempre = 'Cliente identificado. Siga com o pedido. Com um contrato só, use-o sem perguntar; com vários, pergunte pelo endereço.';
        // P1-1 (auditoria final, 25/09/2026): o aviso não explica suspensão. Sem contrato alvo
        // determinado ainda, qualquer contrato suspenso afasta o aviso como causa — o fato continua
        // no contexto (o prompt traz a exceção), mas a instrução não manda tratar como falha regional.
        const avisoComoCausa = aviso && !suspensaoAfastaOAviso(contracts.map(normalizeContract));
        return {
          cliente: { nome },
          contratos: contracts.map((c) => {
            const n = normalizeContract(c);
            return { id: c.id, status: n.status, endereco: n.endereco };
          }),
          ...(avisoComoCausa ? { avisoAtivo: avisoParaResultado(aviso) } : {}),
          instrucao: avisoComoCausa ? `${instrucaoDeSempre} ${instrucaoDoAvisoAtivo(aviso)}` : instrucaoDeSempre,
        };
      }

      // Perfil assistente: um atendente humano acompanha a conversa, então o
      // vínculo é persistido de imediato — o guard de "troca de cliente" do
      // executor (que lê contexto.contact.sgpDocument) depende disso para
      // disparar dentro do mesmo turno.
      contexto.contracts = contracts;
      await setContactSgpLink(contexto.contact.id, {
        sgpClientId: client.id,
        sgpContractId: contracts.length === 1 ? contracts[0].id : null,
        sgpDocument: args.cpf,
        sgpFirstName: primeiroNome(client.name),
      });
      contexto.contact.sgpDocument = args.cpf;
      return {
        cliente: { nome: client.name },
        contratos: contracts.map((c) => ({
          id: c.id, apelido: c.login, plano: c.plan, status: normalizeContract(c).status,
        })),
      };
    },
  },
  {
    nome: 'consultar_status_contrato',
    categoria: 'CONSULTA',
    descricao: 'Informa se o contrato está ativo, suspenso ou cancelado, e o motivo quando houver. NÃO informa se a internet está funcionando.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args, contexto) {
      const contrato = await contratoDoCache(contexto, args.contratoId);
      const n = normalizeContract(contrato);
      return { status: n.status, statusLabel: n.statusLabel, motivo: n.motivo };
    },
  },
  {
    nome: 'consultar_status_conexao',
    categoria: 'CONSULTA',
    descricao: 'Verifica em tempo real se a conexão de internet do contrato está online ou offline. Diferente do status do contrato.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args, contexto) {
      const raw = await sgpClient.checkConnection(args.contratoId);
      const conexao = normalizeConnection(raw);
      // Fato do turno para a guarda de linguagem (regra 0/1/2+): contrato ativo não é conexão
      // online — só esta verificação autoriza dizer "está online/conectada".
      if (contexto && conexao.status === 'online') contexto.conexaoOnline = true;
      // Aviso de cidade: com falha regional conhecida, o status individual não pode virar roteiro
      // de equipamento. Só na triagem — no assistente, quem decide é a atendente.
      const aviso = contexto && perfilTriagem(contexto) ? contexto.avisoCidade : null;
      // P1-1 (auditoria final): este contrato É o da reclamação — fica determinado para a troca final
      // do orquestrador. Suspenso, o aviso não é a causa: sai só o status, como sem aviso.
      if (contexto && perfilTriagem(contexto)) contexto.contratoDaReclamacao = args.contratoId;
      const contratos = ((contexto && contexto.contracts) || []).map(normalizeContract);
      if (aviso && !suspensaoAfastaOAviso(contratos, args.contratoId)) {
        return { ...conexao, avisoAtivo: avisoParaResultado(aviso), instrucao: instrucaoDoAvisoAtivo(aviso) };
      }
      return conexao;
    },
  },
  {
    nome: 'consultar_plano',
    categoria: 'CONSULTA',
    descricao: 'Informa o plano contratado, a velocidade e o login de acesso do contrato.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args, contexto) {
      const contrato = await contratoDoCache(contexto, args.contratoId);
      const n = normalizeContract(contrato);
      return { plano: n.plano, velocidade: n.velocidade, loginPPPoE: n.loginPPPoE };
    },
  },
  {
    nome: 'consultar_financeiro',
    categoria: 'CONSULTA',
    descricao: 'Resumo financeiro do contrato: valor total em aberto e quantidade de faturas a receber.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args, contexto) {
      const contrato = await contratoDoCache(contexto, args.contratoId);
      return { valorEmAberto: contrato.openAmount, faturasEmAberto: contrato.openInvoicesCount };
    },
  },
  {
    nome: 'consultar_faturas',
    categoria: 'CONSULTA',
    descricao: 'Lista as faturas do contrato com status, valor e vencimento. Use para responder se há conta atrasada, quanto o cliente deve, quando vence ou se já foi paga. NÃO gera boleto nem PIX.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args) {
      const { faturas } = await sgpClient.listInvoices(args.contratoId);
      return { faturas: normalizeInvoices(faturas) };
    },
  },
  {
    nome: 'consultar_faturas_todos_contratos',
    categoria: 'CONSULTA',
    descricao: 'Lista as faturas de TODOS os contratos do cliente identificado, agrupadas por contrato com endereço e plano, numa chamada só. Prefira esta a consultar_faturas quando o cliente tem mais de um contrato e pergunta sobre conta, fatura, atraso ou quanto deve. NÃO gera boleto nem PIX.',
    // Isento: não recebe id nenhum do modelo — percorre contexto.contracts, que
    // o servidor carregou pelo CPF do próprio contato. Existe porque "consulte
    // contrato a contrato" estourava o limite de ferramentas do turno no
    // cliente com vários contratos, que é justamente quem mais precisa.
    isentoDeProprietario: true,
    // Devolve valor em aberto, vencimento e endereço — dado que só deve ir a
    // quem já confirmou quem é (fix round 2). consultar_status_contrato e
    // consultar_status_conexao ficam abertos com identidade fraca de
    // propósito: a triagem de Reativação/Suporte depende deles e nenhum dos
    // dois carrega valor ou endereço.
    exigeIdentidadeForte: true,
    // Além da listagem, consulta a 2ª via de cada contrato (até 3 chamadas ao
    // SGP por contrato, em paralelo): mesmo orçamento de gerar_pix.
    timeoutMs: 40000,
    parametros: { type: 'object', properties: {} },
    validar() {
      return { ok: true, args: {} };
    },
    async executar(args, contexto) {
      const contratos = contexto.contracts || [];
      if (contratos.length === 0) {
        return { sucesso: false, motivo: 'Cliente ainda não identificado. Use buscar_cliente.' };
      }
      // allSettled: um contrato com falha no SGP não pode esconder os outros —
      // a resposta parcial é o objetivo, não a exceção.
      //
      // A 2ª via (fatura2via) entra junto porque é o SGP quem sabe o que está
      // "em aberto ou atrasado" — a listagem traz status em texto livre
      // ("Gerado", "Pago"...) que não dá para interpretar com segurança. É
      // dela que sai a instrução do fim: no 3º teste real do boleto o modelo
      // viu que só um contrato tinha fatura e ainda assim perguntou o
      // endereço; agora a própria ferramenta diz o que fazer.
      const [resultados, segundasVias] = await Promise.all([
        Promise.allSettled(contratos.map((c) => sgpClient.listInvoices(c.id))),
        Promise.allSettled(contratos.map((c) => sgpClient.getDuplicateInvoice(c.id))),
      ]);
      const temAberta = (i) => {
        const r = segundasVias[i];
        return r.status === 'fulfilled' ? Boolean(r.value && r.value.hasOpenInvoice) : null;
      };
      const contratosComFaturaEmAberto = contratos
        .map((c, i) => ({ c, aberta: temAberta(i) }))
        .filter(({ aberta }) => aberta === true)
        .map(({ c }) => {
          const n = normalizeContract(c);
          return { contratoId: c.id, endereco: n.endereco, plano: n.plano };
        });
      let instrucao;
      if (perfilTriagem(contexto)) {
        if (contratosComFaturaEmAberto.length === 1) {
          const unico = contratosComFaturaEmAberto[0];
          instrucao = `Só o contrato ${unico.contratoId} (${unico.endereco}) tem fatura em aberto: se o cliente pediu boleto ou PIX, entregue dele AGORA com enviar_boleto ou gerar_pix (contratoId ${unico.contratoId}), sem perguntar nada.`;
        } else if (contratosComFaturaEmAberto.length > 1) {
          instrucao = 'Mais de um contrato tem fatura em aberto: pergunte de qual endereço ele quer, citando os endereços de contratosComFaturaEmAberto, e entregue na resposta seguinte.';
        } else {
          instrucao = 'Nenhum contrato tem fatura em aberto: diga isso em uma frase (sem valores) e chame concluir_triagem para o setor que cuidar de financeiro.';
        }
      }
      return {
        contratosComFaturaEmAberto,
        ...(instrucao ? { instrucao } : {}),
        contratos: contratos.map((c, i) => {
          const n = normalizeContract(c);
          const base = { contratoId: c.id, endereco: n.endereco, plano: n.plano, status: n.status, temFaturaEmAberto: temAberta(i) };
          const r = resultados[i];
          if (r.status !== 'fulfilled') {
            return { ...base, faturas: null, erro: 'Não foi possível consultar as faturas deste contrato agora.' };
          }
          const faturas = normalizeInvoices(r.value.faturas);
          const total = totalDaPaginacao(r.value.paginacao);
          // O SGP pagina (50 por página). Uma lista parcial precisa dizer que é
          // parcial, senão o modelo afirma "não há outras faturas" sem saber.
          const listaParcial = total != null && total > faturas.length;
          // Regra 0/1/2+ (25/09/2026): quantas estão VENCIDAS é fato do código, contrato a
          // contrato, pela data ORIGINAL — "Gerado" inclui o carnê futuro inteiro. Sem a lista
          // inteira (ou sem o total), a contagem não é afirmada.
          const analise = analisarSituacaoFinanceiraContrato({
            contrato: contratoParaAnalise(contexto, c.id),
            titulos: faturas,
            hoje: hojeEmSaoPaulo(),
            leituraCompleta: total != null && !listaParcial,
          });
          const faturasVencidas = analise.indeterminado || analise.cancelado ? null : analise.quantidadeVencidas;
          return {
            ...base, faturas, faturasVencidas,
            ...(analise.cancelado ? { contratoCancelado: true } : {}),
            ...(listaParcial ? { listaParcial: true, totalFaturas: total } : {}),
          };
        }),
      };
    },
  },
  {
    nome: 'consultar_status_todos_contratos',
    categoria: 'CONSULTA',
    descricao: 'Status do contrato e da conexão de TODOS os contratos do cliente identificado, numa chamada só, com endereço. Use no Suporte quando ele tem mais de um contrato.',
    // Isento: não recebe id nenhum do modelo — percorre contexto.contracts, que
    // o servidor carregou pelo CPF do próprio contato. Existe porque o roteiro
    // de Suporte ("consulte status do contrato E da conexão de cada um") gasta
    // 2N chamadas e estourava o teto do turno no cliente com vários contratos,
    // que é justamente quem mais precisa (teste real 2026-09-13).
    isentoDeProprietario: true,
    // Devolve endereço — dado que só vai a quem já confirmou quem é, mesma
    // regra de consultar_faturas_todos_contratos. consultar_status_contrato e
    // consultar_status_conexao (um contrato por vez, sem endereço) seguem
    // abertos com identidade fraca.
    exigeIdentidadeForte: true,
    // Uma consulta de conexão por contrato, em paralelo: mesmo orçamento de
    // consultar_faturas_todos_contratos.
    timeoutMs: 40000,
    parametros: { type: 'object', properties: {} },
    validar() {
      return { ok: true, args: {} };
    },
    async executar(args, contexto) {
      const contratos = contexto.contracts || [];
      if (contratos.length === 0) {
        return { sucesso: false, motivo: 'Cliente ainda não identificado. Use buscar_cliente.' };
      }
      // allSettled: uma consulta de conexão que falha não pode esconder os
      // outros contratos — a resposta parcial é o objetivo, não a exceção.
      const resultados = await Promise.allSettled(contratos.map((c) => sgpClient.checkConnection(c.id)));
      const linhas = contratos.map((c, i) => {
        const n = normalizeContract(c);
        const r = resultados[i];
        return {
          contratoId: c.id,
          endereco: n.endereco,
          plano: n.plano,
          status: n.status,
          statusLabel: n.statusLabel,
          // null = a consulta falhou; 'desconhecido' = o SGP respondeu algo que
          // não é online nem offline. Os dois viram a mesma instrução: não
          // contar isso ao cliente.
          conexao: r.status === 'fulfilled' ? normalizeConnection(r.value).status : null,
        };
      });
      const suspensos = linhas.filter((l) => l.status === 'suspenso');
      const offline = linhas.filter((l) => l.conexao === 'offline');
      // P2-1 (auditoria final): fato de conexão para a guarda de frases — só com TODOS online (um
      // offline ou sem resposta não autoriza "está online").
      if (perfilTriagem(contexto) && linhas.every((l) => l.conexao === 'online')) contexto.conexaoOnline = true;
      const semResposta = linhas.filter((l) => l.conexao === null || l.conexao === 'desconhecido');
      const citar = (lista) => lista.map((l) => `${l.contratoId} (${l.endereco})`).join(', ');
      let instrucao;
      // Aviso de cidade (25/09/2026): era esta instrução ("siga o roteiro daquele problema",
      // "modelo da conexão offline") que atropelava a falha regional conhecida. Com aviso ativo,
      // ela é a do aviso — menos na suspensão, que o aviso não explica.
      const aviso = perfilTriagem(contexto) ? contexto.avisoCidade : null;
      if (perfilTriagem(contexto)) {
        if (suspensos.length > 0) {
          instrucao = `Contrato(s) suspenso(s): ${citar(suspensos)}. Use o modelo do contrato suspenso por falta de pagamento, citando o endereço se ele tiver mais de um contrato.`;
        } else if (offline.length > 0) {
          instrucao = `Conexão offline em: ${citar(offline)}. Use o modelo da conexão offline, citando o endereço se ele tiver mais de um contrato.`;
        } else if (semResposta.length > 0) {
          // O dono: a empresa É o suporte. "Não consegui verificar" é
          // inaceitável — na dúvida, trate como o caso bom e siga o roteiro.
          instrucao = `A consulta de conexão de ${citar(semResposta)} não respondeu: NÃO diga isso ao cliente. Trate como ativo e online e use o modelo correspondente.`;
        } else {
          // Print 2026-09-16: a cliente disse "contratei 500 mega e aparece
          // 20 no celular" e ouviu "está sem acesso, com lentidão ou caindo?".
          // O modelo "ativo e online" é para quem AINDA não disse o problema.
          instrucao = 'Todos os contratos estão ativos e online. Se o cliente JÁ disse qual é o problema, NÃO pergunte de novo: siga o roteiro daquele problema. Se ele não disse, use o modelo "ativo e online". Se você já mandou esse modelo nesta conversa, NÃO repita: siga a partir do que ele respondeu. Se ele tiver mais de um contrato, pergunte também de qual endereço fala.';
        }
      }
      if (aviso && !suspensaoAfastaOAviso(linhas.map((l) => ({ id: l.contratoId, status: l.status })))) {
        return { contratos: linhas, suspensos, offline, avisoAtivo: avisoParaResultado(aviso), instrucao: instrucaoDoAvisoAtivo(aviso) };
      }
      return {
        contratos: linhas,
        suspensos,
        offline,
        ...(instrucao ? { instrucao } : {}),
      };
    },
  },
  {
    nome: 'consultar_planos',
    categoria: 'CONSULTA',
    descricao: 'Lista os planos que a operação vende hoje, com velocidade, mensalidade e condição de instalação. Use ANTES de falar de preço, de velocidade oferecida ou de condição comercial. Não precisa de CPF, contrato nem identificação.',
    // Catálogo comercial: não há contrato a conferir, e quem pergunta preço
    // quase nunca é cliente ainda. Sem exigeIdentidadeForte de propósito.
    isentoDeProprietario: true,
    parametros: { type: 'object', properties: {}, required: [] },
    validar() { return { ok: true, args: {} }; },
    async executar() {
      const planos = await listarPlanosDisponiveis();
      if (planos.length === 0) {
        return {
          planos: [],
          instrucao: 'Não há plano cadastrado. NÃO invente plano, velocidade nem preço, e não repita valores que você tenha visto antes: encaminhe para o setor da lista acima que cuidar de vendas e contratação.',
        };
      }
      // A condição de instalação comum sai do plano e vira campo do topo: é o
      // que permite escrevê-la uma vez só, no fim da lista. Chave ausente
      // quando as condições divergem — aí o `instalacao` de cada plano manda.
      const instalacaoComum = condicaoComumDeInstalacao(planos);
      return {
        planos: planos.map(planoParaModelo),
        ...(instalacaoComum !== null ? { instalacaoComum } : {}),
        instrucao: `Dados oficiais e atuais do catálogo. Use SOMENTE estes valores para preço, plano e instalação: um valor que o cliente mencionou, ou que apareceu antes na conversa, NÃO os substitui — se divergir, vale este. Apresente apenas o que o turno atual pede: listar todos os planos NÃO é obrigatório. Se ele está escolhendo, comparando ou recebendo uma indicação, cite só o plano de que você for falar. Liste o catálogo inteiro quando ele pedir os planos, pedir para rever ou pedir para comparar as opções. Ao citar um plano, escreva o \`rotulo\` dele EXATAMENTE como veio — ele já traz o nome, a mensalidade e a velocidade só quando o nome não a diz; nunca acrescente a velocidade a um rótulo que não a traz, e nunca monte uma linha juntando pedaços de planos diferentes. ${instalacaoComum !== null ? 'A instalação é a mesma em todos: quando ela fizer parte da resposta, escreva \`instalacaoComum\` UMA vez, em linha própria, nunca dentro das linhas dos planos.' : 'As condições de instalação diferem entre os planos: diga a \`instalacao\` DAQUELE plano ao falar dele.'}`,
      };
    },
  },
  {
    nome: 'verificar_cobertura',
    categoria: 'CONSULTA',
    descricao: 'Verifica se a operação atende a cidade, o povoado ou a localidade que o cliente informou. Use quando ele perguntar se tem internet no lugar dele. Não precisa de CPF, contrato nem identificação.',
    isentoDeProprietario: true,
    parametros: {
      type: 'object',
      properties: {
        local: { type: 'string', description: 'Cidade, povoado ou localidade, como o cliente escreveu.' },
      },
      required: ['local'],
    },
    validar(args) {
      const local = args && typeof args.local === 'string' ? args.local.trim() : '';
      if (!local) return erro('local is required');
      return { ok: true, args: { local } };
    },
    async executar(args) {
      // Mesmo casamento do preenchimento automatico de cidade: tolerante a
      // acento, caixa e espaco, e SEM chute quando ha mais de uma candidata
      // parecida. Ambiguidade cai no mesmo lugar que ausencia — a verificar.
      const lugar = encontrarCidade(args.local, await listPlaces());

      // Ausencia no cadastro NAO e recusa. O cadastro nasceu para localizar
      // contato, nao para desenhar a fronteira comercial: dizer "nao
      // atendemos" com base nele perderia venda por falta de cadastro.
      if (!lugar || !lugar.active || !lugar.served) {
        return {
          situacao: 'precisa_verificar_viabilidade',
          consultado: args.local,
          instrucao: 'NÃO diga que não atendemos e NÃO afirme que atendemos. Diga que a equipe confirma a viabilidade para o endereço dele e conclua para o setor da lista acima que cuidar de vendas e contratação.',
        };
      }

      const pai = lugar.parentId ? await findCityById(lugar.parentId) : null;
      return {
        situacao: 'atendida',
        local: lugar.name,
        municipio: pai ? pai.name : null,
        instrucao: 'Atendemos nesse local: diga isso e siga a conversa de venda. Atender o local NÃO garante instalação em qualquer rua ou endereço — a viabilidade do endereço exato é confirmada pela equipe, então não prometa instalação.',
      };
    },
  },
  {
    nome: 'definir_motivo_atendimento',
    categoria: 'ACAO',
    descricao: 'Registra o motivo do atendimento, escolhido entre os motivos existentes no sistema.',
    // Isento: atua apenas sobre contexto.conversationId, que é fornecido pelo
    // servidor (nunca pelo modelo) — não há contratoId nenhum a conferir aqui.
    isentoDeProprietario: true,
    parametros: {
      type: 'object',
      properties: { motivoId: { type: 'string', description: 'UUID de um motivo existente.' } },
      required: ['motivoId'],
    },
    validar(args) {
      const id = args && args.motivoId;
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return erro('motivoId must be a UUID');
      return { ok: true, args: { motivoId: id } };
    },
    async executar(args, contexto) {
      const motivo = await findReasonById(args.motivoId);
      if (!motivo || !motivo.active) return erro('Invalid or inactive motivoId');
      const conversa = await setSuggestedReason(contexto.conversationId, motivo.id);
      if (!conversa) return erro('Failed to record the conversation reason');
      return { registrado: true, motivo: motivo.name };
    },
  },
  {
    nome: 'transferir_atendimento',
    categoria: 'ACAO',
    descricao: 'Encaminha o atendimento para um setor humano, com um resumo do que já foi apurado. Use quando não for possível resolver com segurança.',
    // Isento: atua apenas sobre contexto.conversationId, que é fornecido pelo
    // servidor (nunca pelo modelo) — não há contratoId nenhum a conferir aqui.
    isentoDeProprietario: true,
    parametros: {
      type: 'object',
      properties: {
        setorId: { type: 'string', description: 'UUID de um setor existente.' },
        resumo: {
          type: 'string',
          description: 'Resumo para o atendente humano, em 2 a 4 frases: o que o cliente pediu COM AS PALAVRAS DELE, o que as consultas mostraram, o que você já resolveu, e o que falta. Bom: "Cliente relata quedas desde cedo. Cadastro localizado, contrato ativo e conexão online na consulta. Diz que acontece em todos os aparelhos." Ruim: "Cliente com problema de internet."',
        },
      },
      required: ['setorId', 'resumo'],
    },
    validar(args) {
      const setorId = args && args.setorId;
      const resumo = args && args.resumo;
      if (typeof setorId !== 'string' || !UUID_PATTERN.test(setorId)) return erro('setorId must be a UUID');
      if (typeof resumo !== 'string' || !resumo.trim()) return erro('resumo is required');
      return { ok: true, args: { setorId, resumo: resumo.trim() } };
    },
    async executar(args, contexto) {
      const setores = await listSectors();
      const setor = setores.find((s) => s.id === args.setorId);
      if (!setor) return erro('Unknown setorId');
      // setConversationSector não tem a guarda de triagem de completeTriage:
      // num canal de IA a conversa nasce com triage_state nulo, então aquele
      // UPDATE nunca casaria linha nenhuma.
      const conversa = await setConversationSector(contexto.conversationId, setor.id);
      if (!conversa) return erro('Failed to set the conversation sector');
      return { transferido: true, setor: setor.name };
    },
  },
  {
    nome: 'gerar_segunda_via',
    categoria: 'ACAO_SENSIVEL',
    // getDuplicateInvoice faz até três chamadas sequenciais de 15 s ao SGP:
    // com o orçamento padrão do executor (15 s) o race podia vencer com
    // "timeout" enquanto a 2ª via já estava emitida. Mesma classe do
    // desbloqueio em confiança.
    timeoutMs: 40000,
    descricao: 'Gera a segunda via do boleto do contrato, com linha digitável e link.',
    chaveProprietario: 'contratoId',
    exigeIdentidadeForte: true,
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args, contexto) {
      // Regra 0/1/2+: o gate decide ANTES de qualquer 2ª via, e dela só sai a fatura autorizada.
      const gate = await cobrancaAutorizada(args.contratoId, contexto);
      if (gate.bloqueio) return { temFaturaAberta: false, faturas: [], ...gate.bloqueio };
      const busca = gate.busca;
      if (busca.varios) {
        return {
          temFaturaAberta: false,
          faturas: [],
          motivo: 'Este contrato não tem fatura em aberto, mas outros têm.',
          contratosComFatura: busca.varios,
          instrucao: 'Pergunte de qual endereço ele quer a segunda via, citando os endereços, e chame gerar_segunda_via de novo com o contratoId escolhido.',
        };
      }
      if (busca.semFaturaEmNenhum) {
        return {
          temFaturaAberta: false,
          faturas: [],
          motivo: busca.consultaIncompleta
            ? 'Nenhuma fatura em aberto encontrada; a consulta de um dos contratos falhou.'
            : 'Nenhuma fatura em aberto em nenhum contrato do cliente.',
        };
      }
      if (faturaForaDoAlvo(contexto, busca)) {
        return { temFaturaAberta: false, faturas: [], motivo: 'A fatura encontrada não é do titular pedido; nada foi gerado.' };
      }
      const result = busca.resultado;
      const resposta = {
        temFaturaAberta: true,
        faturas: daMaisAntiga(result.duplicates).map((d) => ({
          faturaId: d.id, vencimento: d.dueDate, valor: d.value,
          linhaDigitavel: d.barCode, linkBoleto: d.boletoLink,
        })),
        // A fatura pode ter vindo de OUTRO contrato do mesmo cliente: o modelo
        // precisa disso para dizer de qual endereço é o boleto.
        ...(busca.trocouContrato ? { contratoUsado: { contratoId: busca.contratoId, endereco: busca.endereco } } : {}),
      };
      // Mesma marcação de gerar_pix: na triagem, gerar a segunda via já
      // resolve o pedido do cliente sem precisar de um atendente humano.
      if (contexto && contexto.identidade) contexto.resolvidoPelaIa = true;
      return resposta;
    },
  },
  {
    nome: 'gerar_pix',
    categoria: 'ACAO_SENSIVEL',
    // Mesma cadeia de até três chamadas ao SGP de gerar_segunda_via.
    timeoutMs: 40000,
    descricao: 'Gera o código PIX copia e cola da fatura em aberto do contrato. Na triagem, já envia ao cliente o cartão com valor e vencimento e o código em mensagem separada.',
    chaveProprietario: 'contratoId',
    exigeIdentidadeForte: true,
    parametros: {
      type: 'object',
      properties: {
        contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' },
        reenviar: PARAMETRO_REENVIAR,
      },
      required: ['contratoId'],
    },
    validar: validarEntregaDeFatura,
    async executar(args, contexto) {
      // Vale para os DOIS ramos (triagem e assistente): o atendente humano
      // também pedia o PIX do contrato errado e ouvia "não há fatura".
      // Regra 0/1/2+: o gate decide ANTES de qualquer 2ª via, e dela só sai a fatura autorizada.
      const gate = await cobrancaAutorizada(args.contratoId, contexto);
      if (gate.bloqueio) return { sucesso: false, enviado: false, ...gate.bloqueio };
      const busca = gate.busca;
      if (busca.varios) {
        return {
          sucesso: false,
          motivo: 'Este contrato não tem fatura em aberto, mas outros têm.',
          contratosComFatura: busca.varios,
          instrucao: 'Pergunte de qual endereço ele quer o PIX, citando os endereços, e chame gerar_pix de novo com o contratoId escolhido.',
        };
      }
      if (busca.semFaturaEmNenhum) {
        return {
          sucesso: false,
          motivo: busca.consultaIncompleta
            ? 'Nenhuma fatura em aberto encontrada; a consulta de um dos contratos falhou.'
            : 'Nenhuma fatura em aberto em nenhum contrato do cliente.',
        };
      }
      if (faturaForaDoAlvo(contexto, busca)) {
        return { sucesso: false, motivo: 'A fatura encontrada não é do titular pedido; nada foi enviado.' };
      }
      const primeira = gate.fatura;
      const contratoUsado = busca.trocouContrato
        ? { contratoId: busca.contratoId, endereco: busca.endereco }
        : null;

      // Fora da triagem (assistente clássico, humano no comando): mantém o
      // comportamento antigo — só sugere o código para o atendente decidir.
      if (!perfilTriagem(contexto)) {
        const resposta = { sucesso: true, valor: primeira.value, vencimento: primeira.dueDate, pixCopiaCola: primeira.pixCode };
        if (contratoUsado) resposta.contratoUsado = contratoUsado;
        if (contexto && contexto.identidade) contexto.resolvidoPelaIa = true;
        return resposta;
      }

      // Idempotência: o claim vem DEPOIS de faturaEmAlgumContrato (só aqui
      // primeira.id existe) e ANTES de qualquer trabalho externo. Fica também
      // depois do ramo assistente acima de propósito: lá nada é enviado, e
      // reivindicar ali gravaria o envio INICIAL da fatura sem nunca usá-lo —
      // o índice parcial bloquearia a entrega de verdade logo depois.
      const entrega = await reivindicarEntrega({
        tool: 'gerar_pix', item: 'PIX', contratoId: busca.contratoId, fatura: primeira, args, contexto,
      });
      if (entrega.resposta) return entrega.resposta;
      const claimId = entrega.claimId;

      // ---- ZONA A: nada saiu do sistema. Toda saída daqui devolve o claim.
      try {
        // Regra do Financeiro: sem código PIX no SGP, não há o que enviar.
        if (!primeira.pixCode) {
          await liberarEntrega(claimId, contexto.conversationId, 'gerar_pix sem código PIX');
          return { sucesso: false, motivo: 'Fatura sem código PIX no SGP' };
        }

        // Mesma guarda de enviar_boleto: entre a consulta ao SGP e este ponto,
        // um atendente pode ter assumido a conversa, ou ela pode ter sido
        // fechada/silenciada/concluída.
        if (await saiuDaTriagem(contexto.conversationId)) {
          await liberarEntrega(claimId, contexto.conversationId, 'gerar_pix fora da triagem');
          return { enviado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' };
        }
      } catch (err) {
        // A releitura da conversa falhou: nada chegou ao cliente.
        await liberarEntrega(claimId, contexto.conversationId, 'gerar_pix falhou antes do envio');
        throw err;
      }

      // ---- ZONA B: daqui em diante o claim NUNCA é liberado — nem em
      // exceção, nem em timeout, nem em resultado incerto. enviarPix chama
      // enqueueOutboundMessage, que GRAVA a linha da mensagem no banco (já
      // visível na conversa) e só então enfileira: se estourar no meio, a
      // mensagem existe, e devolver o claim autorizaria uma segunda.
      await enviarPix({ conversationId: contexto.conversationId, channelId: contexto.channelId, fatura: primeira, sentBy: 'ai' });
      // ---- ZONA C: o efeito externo voltou. A entrega vira um fato gravado.
      await confirmarEntrega(claimId, contexto.conversationId);
      // Grava a entrega: contexto.resolvidoPelaIa nasce false a cada turno, e o
      // "nao preciso de mais nada" do cliente costuma vir no turno SEGUINTE.
      // 2+ à noite: reativação, nunca "resolvido pela IA".
      await marcarDepoisDaEntrega(gate, contexto);
      const reativacaoDepois = Boolean(gate.decisao && gate.decisao.reativacaoDepois);
      // O modelo de frase do dono sai DAQUI, e só depois do envio real: no
      // prompt, o modelo copiava a frase sem chamar a ferramenta (teste real
      // 2026-09-15, com o boleto).
      const endereco = enderecoParaCitar(busca, contexto);
      return {
        enviado: true,
        valor: primeira.value,
        vencimento: primeira.dueDate,
        ...(contratoUsado ? { contratoUsado } : {}),
        // Print 2026-09-17: entrega inteira sem chamar o cliente pelo nome,
        // logo depois de identificar pelo CPF — "está muito robô".
        ...(reativacaoDepois ? { reativacaoDepois: true } : {}),
        instrucao: `O PIX já foi enviado ao cliente nesta conversa (cartão com botão de copiar). ${nomeParaTratar(contexto)} Responda EXATAMENTE no modelo: "Enviei acima o PIX${reativacaoDepois ? ' da fatura vencida mais antiga' : ''}${endereco ? ' referente ao seu contrato do endereço ' + endereco : ''}. É só copiar o código e colar na opção "PIX Copia e Cola" do aplicativo do seu banco.${reativacaoDepois ? fraseDasDemaisVencidas(contexto) : ''} Se tiver alguma dificuldade, me avise que eu te ajudo!" NÃO repita o código nem o valor.${reativacaoDepois ? ' Não diga que a internet será liberada nem que ficou tudo regularizado.' : ''}`,
      };
    },
  },
  {
    nome: 'conferir_pagamento',
    categoria: 'CONSULTA',
    descricao: 'Confere no sistema se a fatura enviada nesta conversa (boleto ou PIX) já consta como paga, relendo a MESMA fatura. Use quando o cliente disser que pagou ou perguntar se o pagamento caiu. É a única fonte para dizer que um pagamento foi confirmado: comprovante, "já paguei" ou aviso do banco não confirmam.',
    // Sem argumento nenhum do modelo: a fatura é a última cobrança que SAIU nesta conversa
    // (ai_billing_deliveries) e o contrato é o dela — que ainda precisa estar neste atendimento.
    isentoDeProprietario: true,
    exigeIdentidadeForte: true,
    // Até 20 páginas de títulos + a releitura do contrato, 15 s de HTTP cada.
    timeoutMs: 40000,
    parametros: { type: 'object', properties: {} },
    validar() {
      return { ok: true, args: {} };
    },
    async executar(args, contexto) {
      if (!perfilTriagem(contexto)) return erro('conferir_pagamento is only available during AI triage');
      // Marca do turno para a guarda de linguagem: depois de conferir, "está conectado" sem a
      // verificação da conexão é afirmação sem fato.
      contexto.pagamentoConferido = true;
      const naoConferiu = (motivo) => ({
        pagamentoConfirmado: false,
        motivo,
        instrucao: 'Não foi possível conferir o pagamento agora. NÃO diga que o pagamento foi confirmado, compensado ou baixado, nem que a internet foi liberada. Diga que um atendente vai conferir e chame concluir_triagem para o setor que cuidar de financeiro.',
      });

      const entrega = await findLatestEnqueuedDelivery(contexto.conversationId);
      if (!entrega) {
        return {
          pagamentoConfirmado: false,
          motivo: 'Nenhum boleto ou PIX foi enviado nesta conversa.',
          instrucao: 'Não há cobrança enviada nesta conversa para conferir. NÃO diga que o pagamento foi confirmado. Se o cliente pagou por outro meio, diga que a equipe vai conferir e chame concluir_triagem para o setor que cuidar de financeiro.',
        };
      }
      const contratoId = entrega.contractId;
      // O contrato da cobrança tem de estar NESTE atendimento (de quem fala, ou o do terceiro ainda
      // autorizado). Escopo de terceiro expirado não é reaberto por aqui.
      const escopo = escopoDoContrato(contexto, contratoId);
      if (!escopo) return naoConferiu('A cobrança enviada é de um contrato que não está mais neste atendimento.');

      let leitura = null;
      try {
        leitura = await sgpClient.listAllInvoices(contratoId);
      } catch (err) {
        console.error(`Conferência de pagamento: títulos do contrato ${contratoId} não lidos na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
      }
      if (!leitura || leitura.completo !== true) return naoConferiu('Não foi possível ler todas as faturas do contrato agora.');

      const titulos = normalizeInvoices(leitura.faturas);
      // O MESMO título que saiu, pelo id. Sumir da listagem, outro título pago, comprovante ou
      // "paguei" não confirmam nada.
      const mesmo = titulos.find((t) => String(t.faturaId) === String(entrega.invoiceId));
      if (!pagamentoConfirmadoDoTitulo(mesmo)) {
        return {
          pagamentoConfirmado: false,
          motivo: mesmo ? 'A fatura enviada ainda não consta como paga.' : 'A fatura enviada não aparece na listagem; isso não confirma pagamento.',
          instrucao: 'O pagamento desta fatura AINDA NÃO consta como confirmado no sistema. Diga isso de forma natural ("o pagamento ainda não consta como confirmado no sistema"), sem dizer que foi pago, compensado ou baixado e sem prometer liberação nem prazo. Comprovante, "já paguei" ou aviso do banco não mudam isso.',
        };
      }
      contexto.pagamentoConfirmado = true;

      // Pagou: RECONTA pela data original, na leitura de agora — a contagem de antes não vale.
      const analise = analisarSituacaoFinanceiraContrato({
        contrato: { id: contratoId }, titulos, hoje: hojeEmSaoPaulo(), leituraCompleta: true,
      });
      const restantes = analise.indeterminado ? null : analise.quantidadeVencidas;
      // Internet liberada só com a RELEITURA do contrato em status 1 (ou com o desbloqueio em
      // confiança). Só o contrato de quem fala tem releitura: o do terceiro não tem documento aqui.
      const status = escopo.terceiro ? null : await statusRelidoDoContrato(contexto, contratoId);
      const contratoAtivo = status === null ? null : status === '1';
      if (contratoAtivo === true) contexto.contratoAtivoConfirmado = true;
      // P2-1: a releitura que acha o contrato NÃO ativo vence o status lido no começo do turno.
      if (contratoAtivo === false) contexto.contratoAtivoNegado = true;
      if (status === '3') await registrarReativacao(contexto, 'contrato_cancelado');
      if (restantes !== null && restantes >= 2) await registrarReativacao(contexto, 'multiplas_vencidas');

      // A marca pode ser de um turno anterior (2+ à noite, depois da mais antiga): o banco também conta.
      const reativacao = await reativacaoDaConversa(contexto);
      const setor = reativacao ? await setorDeReativacaoSeguro() : null;
      const semLiberacao = contratoAtivo === true ? '' : ' NÃO diga que a internet foi liberada.';
      let instrucao;
      if (restantes === null) {
        instrucao = `O pagamento DESTA fatura foi confirmado no sistema, mas não foi possível conferir as demais faturas do contrato. Pode dizer que o pagamento foi confirmado; não diga que ficou tudo regularizado.${semLiberacao} Diga que um atendente vai conferir o restante e chame concluir_triagem para o setor que cuidar de financeiro.`;
      } else if (reativacao) {
        instrucao = `O pagamento DESTA fatura foi confirmado no sistema, mas o contrato não está regularizado${restantes > 0 ? ' (ainda há outras faturas vencidas)' : ''}. Pode dizer que o pagamento desta fatura foi confirmado; não diga que ficou tudo regularizado.${semLiberacao} Diga que a equipe responsável vai orientar sobre o restante e ${concluirNaReativacao(setor)}.`;
      } else if (restantes === 1) {
        instrucao = `O pagamento DESTA fatura foi confirmado no sistema, mas ainda há uma fatura vencida neste contrato. Pode dizer que o pagamento foi confirmado; não diga que ficou tudo regularizado.${semLiberacao} Se ele quiser, a fatura que falta pode ser enviada com gerar_pix ou enviar_boleto.`;
      } else if (contratoAtivo === true) {
        instrucao = 'O pagamento foi confirmado e, relido agora, o contrato consta ATIVO no sistema. Pode dizer que o pagamento foi confirmado e que o contrato está ativo/liberado. NÃO diga que a internet está conectada ou online: isso só a verificação da conexão mostra. Se ele disser que continua sem internet, siga o atendimento de suporte.';
      } else if (contratoAtivo === false) {
        instrucao = 'O pagamento foi confirmado, mas o contrato ainda NÃO consta ativo no sistema. NÃO diga que a internet foi liberada e não prometa prazo. Diga que o pagamento foi confirmado e que a equipe acompanha a liberação; se ele pedir a liberação, siga as regras de sempre.';
      } else {
        instrucao = 'O pagamento foi confirmado. Não foi possível confirmar agora o estado do contrato: NÃO diga que a internet foi liberada. Diga que o pagamento foi confirmado e que a equipe acompanha.';
      }
      return {
        pagamentoConfirmado: true,
        faturasVencidasRestantes: restantes,
        regularizado: restantes === 0,
        contratoAtivo,
        instrucao,
      };
    },
  },
  {
    nome: 'desbloqueio_confianca',
    categoria: 'ACAO_SENSIVEL',
    descricao: `Libera em confiança (promessa de pagamento) um contrato SUSPENSO por inadimplência, devolvendo a internet por alguns dias até o pagamento. Use só quando o cliente pedir a liberação e o contrato estiver suspenso. Regras da casa: uma liberação a cada ${DIAS_ENTRE_LIBERACOES} dias, e nunca se a liberação anterior não foi paga. Ao responder, informe o prazo devolvido pela ferramenta e que a fatura continua devida.`,
    chaveProprietario: 'contratoId',
    // À noite esta ferramenta entra na lista da triagem: o gate de identidade
    // forte garante que só quem já teve o CPF confirmado pode liberar um
    // contrato — sem ele, o CPF de outra pessoa liberaria o contrato dela. O
    // gate do tool-executor só vale no perfil de triagem, então o assistente
    // clássico (humano no comando) não muda.
    exigeIdentidadeForte: true,
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    // Orçamento próprio: duas leituras + uma escrita no SGP, 15 s de HTTP cada.
    // Com o padrão do executor (15 s), o timeout dele podia vencer enquanto o
    // SGP ainda liberava — ação real reportada como falha.
    timeoutMs: 40000,
    async executar(args, contexto) {
      const contrato = (contexto.contracts || []).find((c) => c.id === args.contratoId);
      // O executor já garante que o contrato é do contato; esta guarda existe
      // para a ferramenta mais perigosa do registro não depender de outro
      // arquivo para não explodir.
      if (!contrato) return { liberado: false, motivo: 'Contrato não encontrado entre os contratos do cliente.' };

      const noturno = noturnoDoContexto(contexto);
      const nome = (contexto.identidade && contexto.identidade.primeiroNome) || 'cliente';
      const comprovante = contexto.comprovante || null;
      // Só o DESTINO da conclusão muda com a regra 0/1/2+ (reativação, se a conversa estiver
      // marcada); as regras do desbloqueio (comprovante, elegibilidade, reserva, aviso) não.
      const concluirPara = noturno ? await destinoDaConclusaoFinanceira(contexto) : null;

      // Com dois contratos, analisar_comprovante devolve o contrato da fatura
      // que bateu — e o modelo podia pedir a liberação do OUTRO. Seria uma
      // liberação no contrato errado, com um comprovante que não é dele. Não
      // é recusa do atendimento: é erro de alvo, então não gasta a tentativa
      // única nem entra no resumo da fila; a instrução diz qual é o certo.
      if (comprovante && comprovante.valido === true && comprovante.contratoId && comprovante.contratoId !== args.contratoId) {
        return {
          liberado: false,
          motivo: `O comprovante conferido é da fatura do contrato ${comprovante.contratoId}, não do contrato ${args.contratoId}.`,
          instrucao: `Chame desbloqueio_confianca de novo com contratoId ${comprovante.contratoId}.`,
        };
      }

      // Toda recusa da noite fica no contexto, não só o sucesso: é isso que o
      // resumo da fila mostra ao atendente de manhã ("RECUSADO: motivo").
      const registrarRecusa = (motivo) => { contexto.desbloqueioResultado = { liberado: false, motivo }; };
      // A reserva do comprovante (mais abaixo, no ramo noturno) vale enquanto a
      // liberação estiver de pé. Se a liberação não acontecer, ela é devolvida:
      // o cliente não pode perder o comprovante dele por uma recusa do SGP.
      let reservaFeita = false;
      const devolverReserva = async () => {
        if (!reservaFeita) return;
        reservaFeita = false;
        try {
          await releaseReceipt(comprovante.idTransacao);
        } catch (err) {
          // A resposta ao cliente não pode virar erro por causa disto: o
          // comprovante fica marcado como usado e o atendente resolve de manhã.
          console.error(`Failed to release receipt for contract ${args.contratoId}: ${mensagemSegura(err)}`);
        }
      };

      const status = normalizeContract(contrato).status;
      // Não usamos velocidade reduzida: só contrato suspenso é elegível.
      if (status !== 'suspenso') {
        const resposta = { liberado: false, motivo: `O contrato não está suspenso (status: ${status}). A liberação em confiança só se aplica a contrato suspenso.` };
        // À noite este desfecho também precisa de frase pronta: quem mandou
        // comprovante de um contrato que já está ativo merece o agradecimento e
        // a baixa na fila do Financeiro; quem só pediu liberação sem pagar nada
        // provavelmente está com problema de conexão, e aí a conversa continua.
        if (noturno) {
          resposta.instrucao = comprovante && comprovante.valido === true
            ? `Responda EXATAMENTE neste modelo: "Recebi seu comprovante, ${nome}! Seu contrato está ativo, então não há bloqueio para liberar. O pagamento fica registrado para a equipe conferir e dar baixa a partir das ${noturno.retornoAs}." — e ${concluirPara} NA MESMA resposta.`
            : `Responda EXATAMENTE neste modelo: "${nome}, seu contrato está ativo, então não há bloqueio para liberar. Se a internet não estiver funcionando, me conta o que está acontecendo." — não conclua ainda.`;
          registrarRecusa('contrato ativo, não há bloqueio para liberar');
        }
        return resposta;
      }

      // Uma tentativa por contrato por turno. Fecha três brechas de uma vez:
      // o modelo pedir duas liberações na mesma rodada (as duas leriam o
      // histórico antes de qualquer registro), o modelo insistir depois de
      // um resultado indeterminado, e o modelo insistir com um comprovante já
      // reprovado. Síncrono até aqui de propósito — o segundo executar só roda
      // depois que o primeiro já marcou. Entre conversas não há corrida: o
      // worker da IA roda com concorrência 1.
      if (!contexto.desbloqueiosTentados) contexto.desbloqueiosTentados = new Set();
      if (contexto.desbloqueiosTentados.has(args.contratoId)) {
        return { liberado: false, motivo: 'A liberação deste contrato já foi tentada neste atendimento. Encaminhe para um atendente se precisar de nova verificação.' };
      }
      contexto.desbloqueiosTentados.add(args.contratoId);

      // Frases do dono para as recusas da noite: acolhem, dizem que o registro
      // já existe e NUNCA afirmam liberação. Uma função só para as três saídas
      // (regra da casa, recusa do SGP e resultado indeterminado) não divergirem.
      // Mesmo formato da instrução de sucesso: a frase do cliente entre aspas,
      // a ordem para a IA FORA delas. No formato antigo (texto corrido, com
      // "Depois disso chame concluir_triagem" grudado na frase) nada impedia o
      // modelo de repassar a ordem ao cliente.
      const instrucaoDeRecusa = (frase, motivo) => {
        // O motivo vem de três fontes (regra da casa, SGP, comprovante) e nem
        // sempre termina em ponto: sem normalizar, "…judicial Assim que…".
        const motivoPontuado = String(motivo).replace(/[.\s]*$/, '.');
        const paraOCliente = `${nome}, ${comprovante ? 'recebi seu comprovante e ele já está registrado para a equipe conferir' : 'sua solicitação já está registrada para a equipe'} a partir das ${noturno.retornoAs}. ${frase}: ${motivoPontuado} Assim que o pagamento constar no sistema, a situação do contrato será verificada.`;
        return `Responda EXATAMENTE neste modelo: "${paraOCliente}" — e ${concluirPara} NA MESMA resposta.`;
      };
      // Comprovante que a visão já reprovou (Task 3): não há o que avaliar nem
      // o que pedir ao SGP — a recusa sai daqui, sem nenhuma chamada externa.
      if (noturno && comprovante && comprovante.valido === false) {
        const motivo = `O comprovante não conferiu: ${(comprovante.motivos || []).join('; ')}.`;
        registrarRecusa(motivo);
        return {
          liberado: false,
          motivo,
          instrucao: instrucaoDeRecusa('Não consegui liberar o acesso em confiança agora', 'o comprovante não conferiu com a fatura em aberto.'),
        };
      }

      const [liberacoes, invoices] = await Promise.all([
        listTrustUnlocksByContract(args.contratoId),
        sgpClient.listInvoices(args.contratoId),
      ]);
      const avaliacao = avaliarElegibilidade({
        liberacoes,
        faturas: normalizeInvoices(invoices.faturas),
        totalFaturas: totalDaPaginacao(invoices.paginacao),
        promessasPagamentoMes: contrato.paymentPromisesThisMonth,
      });
      if (!avaliacao.ok) {
        const resposta = {
          liberado: false,
          motivo: MENSAGENS_DESBLOQUEIO[avaliacao.motivo] || 'Liberação em confiança não permitida para este contrato.',
        };
        if (avaliacao.diasRestantes) resposta.diasRestantes = avaliacao.diasRestantes;
        if (noturno) {
          resposta.instrucao = instrucaoDeRecusa('Não consegui liberar o acesso em confiança agora', resposta.motivo);
          registrarRecusa(resposta.motivo);
        }
        return resposta;
      }

      if (noturno) {
        // Mesma guarda de gerar_pix/enviar_boleto (revisão final do branch):
        // entre o início do turno (a OpenAI, a visão do comprovante, as
        // consultas ao SGP acima) e este ponto, um atendente pode ter assumido
        // a conversa, ou ela pode ter sido fechada/silenciada/concluída. Sem
        // reler agora, o aviso sairia com um humano já no comando — e, pior, a
        // liberação aconteceria de verdade no SGP logo abaixo.
        if (await saiuDaTriagem(contexto.conversationId)) {
          return { liberado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' };
        }
        // Um comprovante desbloqueia UMA vez: emprestado a outra pessoa, ele
        // não pode liberar de novo. A reserva vem ANTES do aviso ao cliente —
        // avisar "vou verificar a possibilidade" para depois recusar por
        // comprovante repetido seria prometer o que não existe. Sem
        // comprovante ("paguei, libera") não há o que reservar.
        if (comprovante) {
          if (!comprovante.idTransacao) {
            const motivo = 'O comprovante não tem um identificador de transação legível.';
            registrarRecusa(motivo);
            return { liberado: false, motivo, instrucao: instrucaoDeRecusa('Não consegui liberar o acesso em confiança agora', motivo) };
          }
          const reservado = await claimReceipt({
            transactionId: comprovante.idTransacao,
            contactId: (contexto.contact && contexto.contact.id) || null,
            contractId: args.contratoId,
          });
          // Só quem reservou devolve: numa recusa por repetição a linha é de
          // outro atendimento.
          reservaFeita = reservado === true;
          if (!reservado) {
            const motivo = 'Este comprovante já foi utilizado.';
            // Onde ele foi usado antes é informação do resumo, para o
            // atendente entender o que aconteceu. O cliente lê a mesma frase
            // de sempre: o contrato e a hora são de OUTRA pessoa, e o `motivo`
            // devolvido aqui é lido pelo modelo, que pode repeti-lo.
            // analisar_comprovante já consultou o uso neste mesmo turno e
            // guardou a descrição: o banco só é consultado quando ela não
            // existe (o cliente pediu a liberação sem a leitura ter rodado).
            let descricao = (comprovante.usoAnterior && comprovante.usoAnterior.descricao) || null;
            if (!descricao) {
              try {
                const uso = await findReceiptUsage(comprovante.idTransacao);
                if (uso) descricao = descreverUsoAnterior(uso);
              } catch (err) {
                console.error(`Failed to look up previous receipt usage for contract ${args.contratoId}: ${mensagemSegura(err)}`);
              }
            }
            registrarRecusa(descricao ? `Este comprovante já foi utilizado (${descricao}).` : motivo);
            return { liberado: false, motivo, instrucao: instrucaoDeRecusa('Não consegui liberar o acesso em confiança agora', motivo) };
          }
        }
        // A frase de aviso sai pelo código, antes da escrita no SGP: assim ela
        // sempre precede a execução, independente do que o modelo faria. E só
        // depois de a regra da casa aprovar — quem foi recusado nunca lê que
        // vamos "verificar a possibilidade".
        const aviso = comprovante
          ? `Recebi seu comprovante, ${nome}! Como nossa equipe retorna a partir das ${noturno.retornoAs}, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.`
          : `${nome}, como nossa equipe retorna a partir das ${noturno.retornoAs}, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.`;
        await enqueueOutboundMessage({ conversationId: contexto.conversationId, channelId: contexto.channelId, content: aviso, sentBy: 'ai' });
      }

      let resultado;
      try {
        resultado = await sgpClient.requestTrustUnlock(args.contratoId);
      } catch (err) {
        // Timeout na escrita: o SGP pode ter liberado e a resposta se perdido.
        // Nem "liberou" nem "não liberou" seriam verdade — o modelo precisa
        // dizer que não conseguiu confirmar e encaminhar.
        if (/timeout|timed out/i.test(String((err && err.cause && err.cause.message) || (err && err.message) || ''))) {
          console.error(`Trust unlock for contract ${args.contratoId} timed out: outcome unknown`);
          const indeterminado = {
            liberado: null,
            indeterminado: true,
            motivo: 'Não foi possível confirmar se a liberação foi realizada. Diga ao cliente que a solicitação será verificada por um atendente e encaminhe.',
          };
          if (noturno) {
            indeterminado.instrucao = instrucaoDeRecusa('Não consegui confirmar a liberação agora', indeterminado.motivo);
            // O resumo não pode dizer "RECUSADO: não foi possível confirmar se
            // a liberação foi realizada" e sugerir que nada aconteceu: o texto
            // curto diz exatamente o que se sabe — nada foi confirmado.
            registrarRecusa('não foi possível confirmar a liberação');
          }
          // A reserva FICA: desfecho desconhecido é liberação possível, e
          // devolver o comprovante deixaria o mesmo comprovante liberar de novo
          // em cima de uma liberação que talvez exista.
          return indeterminado;
        }
        // Erro que não é timeout: a liberação não aconteceu.
        await devolverReserva();
        throw err;
      }
      if (!resultado.liberado) {
        await devolverReserva();
        const recusa = { liberado: false, motivo: resultado.motivo };
        // O SGP pode recusar sem dizer por quê: a frase que o modelo vai
        // repetir ao cliente não pode terminar em "agora: null".
        if (noturno) {
          recusa.instrucao = instrucaoDeRecusa('Não consegui liberar o acesso em confiança agora', recusa.motivo || 'o sistema não autorizou a liberação neste momento.');
          registrarRecusa(recusa.motivo || 'o sistema não autorizou a liberação');
        }
        return recusa;
      }

      // A liberação já aconteceu no SGP. Falhar em registrá-la não pode virar
      // "não liberou" para o modelo — o registro falho vai para o log, e a
      // resposta continua verdadeira.
      try {
        await recordTrustUnlock({
          contactId: contexto.contact && contexto.contact.id,
          contractId: args.contratoId,
          protocolo: resultado.protocolo,
          liberadoDias: resultado.liberadoDias,
        });
      } catch (err) {
        console.error(`Failed to record trust unlock for contract ${args.contratoId}: ${err.message}`);
      }
      const resposta = { liberado: true, dias: resultado.liberadoDias, protocolo: resultado.protocolo };
      if (resultado.dataPromessa) resposta.pagarAte = resultado.dataPromessa;
      // Sem prazo devolvido, o modelo não pode inventar um "uns 3 dias".
      if (resposta.dias == null && !resposta.pagarAte) resposta.prazoDesconhecido = true;
      if (noturno) {
        // A marca é o que autoriza o modelo a dizer "desbloqueio realizado": o
        // verificador do orquestrador lê contexto.desbloqueioRealizado antes de
        // deixar a frase passar. E o resultado vai para o resumo da fila.
        contexto.desbloqueioRealizado = true;
        contexto.desbloqueioResultado = { liberado: true, dias: resposta.dias || null };
        resposta.instrucao = `Responda EXATAMENTE neste modelo: "Prontinho, ${nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das ${noturno.retornoAs}. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?" — e ${concluirPara} NA MESMA resposta (motivo "Desbloqueio em confiança" se existir).`;
      }
      return resposta;
    },
  },
  {
    nome: 'analisar_comprovante',
    categoria: 'CONSULTA',
    // Sem parâmetros de propósito: o modelo NUNCA escolhe qual arquivo ler.
    isentoDeProprietario: true,
    exigeIdentidadeForte: true,
    // Orçamento próprio: leitura do disco + visão da OpenAI (60 s) + as
    // consultas de fatura no SGP. O padrão do executor (15 s) venceria antes.
    timeoutMs: 90000,
    descricao: 'Lê o último comprovante de pagamento (imagem) que o cliente enviou nesta conversa e confere valor, data e favorecido contra as faturas em aberto. Nunca confirma pagamento. Use antes de qualquer desbloqueio em confiança motivado por comprovante.',
    parametros: { type: 'object', properties: {} },
    validar() { return { ok: true, args: {} }; },
    async executar(args, contexto) {
      if (!perfilTriagem(contexto)) return erro('analisar_comprovante is only available during AI triage');
      // A configuração é lida ANTES da porta: de dia a leitura existe só com a
      // flag ligada (é uma chamada de visão paga por imagem), e à noite ela
      // existe sempre. A mesma config alimenta a visão mais abaixo.
      const config = await getAiConfig();
      if (!noturnoDoContexto(contexto) && !(config && config.triageReadReceiptsDaytime)) {
        return { analisado: false, motivo: 'Leitura de comprovante de dia está desligada.' };
      }

      const imagem = await findLatestInboundImage(contexto.conversationId, { withinMs: 24 * 60 * 60 * 1000 });
      if (!imagem) return { analisado: false, motivo: 'Nenhuma imagem recebida do cliente nas últimas 24 horas.' };

      // A leitura e a conferência vivem em receipt-analysis: o atendente humano
      // pede a mesma análise pelo botão do chat, e duplicar a conferência é
      // como as duas versões passam a discordar sem ninguém notar.
      const analise = await analisarComprovante({
        conversationId: contexto.conversationId,
        imagem,
        contratos: contexto.contracts || [],
        config,
      });
      if (!analise.analisado) return { analisado: false, motivo: analise.motivo };

      const { usoAnterior, ...resultado } = analise;

      // O veredito fica no contexto do turno para o desbloqueio em confiança
      // poder consultá-lo sem reler a imagem. O contrato e a hora do uso
      // anterior são de OUTRA pessoa: ficam no contexto, que não vai ao modelo,
      // e só o fato (jaUtilizado) atravessa para ele.
      contexto.comprovante = {
        valido: resultado.valido,
        contratoId: resultado.contratoId,
        faturaId: resultado.faturaId,
        valor: resultado.valor,
        data: resultado.data,
        tipo: resultado.tipo,
        idTransacao: resultado.idTransacao,
        motivos: resultado.motivos,
        usoAnterior,
      };
      return resultado;
    },
  },
  {
    nome: 'esquecer_identificacao',
    categoria: 'ACAO',
    descricao: 'Use quando o cliente disser que o nome pelo qual foi chamado não é dele. Descarta a identificação atual; em seguida peça o CPF.',
    isentoDeProprietario: true,
    parametros: { type: 'object', properties: {} },
    validar() { return { ok: true, args: {} }; },
    async executar(args, contexto) {
      // I6 (revisão final do branch inteiro): sem esta guarda, o cartão de
      // permissões do assistente clássico bastaria para alcançar uma
      // ferramenta pensada só para a recepcionista da triagem.
      if (!perfilTriagem(contexto)) return erro('esquecer_identificacao is only available during AI triage');
      // Antes de concluir/encerrar/esquecer, e não depois: se a limpeza falhar, o
      // atendimento NÃO avança. Concluir com uma autorização de terceiro ainda viva
      // deixaria o escopo válido pelos 30 minutos seguintes numa conversa que já saiu
      // da triagem.
      if (contexto.terceiro && !(await limparEscopoDeTerceiro(contexto))) {
        return erro('third_party_scope_not_cleared');
      }
      contexto.identidade = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, contestado: true };
      contexto.contracts = [];
      if (contexto.contact) {
        contexto.contact.sgpDocument = null;
        contexto.contact.sgpClientId = null;
        contexto.contact.sgpContractId = null;
        contexto.contact.sgpFirstName = null;
        await setContactSgpLink(contexto.contact.id, { sgpClientId: null, sgpContractId: null, sgpDocument: null, sgpFirstName: null });
      }
      // Persiste a contestação na conversa: sem isso, o turno seguinte
      // (resolverIdentidade) buscaria de novo pelo MESMO telefone no SGP e
      // cumprimentaria a mesma pessoa errada de novo. Try/catch de propósito:
      // a limpeza em memória e do vínculo já aconteceu e não pode falhar por
      // causa disto.
      try {
        await markPhoneContested(contexto.conversationId);
      } catch (err) {
        console.error(`Failed to mark phone contested for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
      }
      return { esquecido: true };
    },
  },
  {
    nome: 'enviar_boleto',
    categoria: 'ACAO_SENSIVEL',
    descricao: 'Envia ao cliente, como arquivo PDF nesta conversa, a segunda via do boleto da fatura em aberto do contrato. Só para cliente com identidade confirmada.',
    chaveProprietario: 'contratoId',
    exigeIdentidadeForte: true,
    timeoutMs: 40000,
    parametros: {
      type: 'object',
      properties: {
        contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' },
        reenviar: PARAMETRO_REENVIAR,
      },
      required: ['contratoId'],
    },
    validar: validarEntregaDeFatura,
    async executar(args, contexto) {
      // Fora da triagem não há gate nem instrução própria para o modelo saber
      // quando é seguro entregar — enviar_boleto EXECUTA (entrega um arquivo
      // real ao cliente), então não é uma ferramenta de assistente/
      // humano-no-comando. perfilTriagem (não só contexto.identidade) para
      // não reabrir com um identidade: null bugado.
      if (!perfilTriagem(contexto)) return erro('enviar_boleto is only available during AI triage');
      // Regra 0/1/2+: o gate decide ANTES de qualquer 2ª via, e dela só sai a fatura autorizada.
      const gate = await cobrancaAutorizada(args.contratoId, contexto);
      if (gate.bloqueio) return { enviado: false, ...gate.bloqueio };
      const busca = gate.busca;
      if (busca.varios) {
        return {
          enviado: false,
          motivo: 'Este contrato não tem fatura em aberto, mas outros têm.',
          contratosComFatura: busca.varios,
          instrucao: 'Pergunte de qual endereço ele quer o boleto, citando os endereços, e chame enviar_boleto de novo com o contratoId escolhido.',
        };
      }
      if (busca.semFaturaEmNenhum) {
        return {
          enviado: false,
          motivo: busca.consultaIncompleta
            ? 'Nenhuma fatura em aberto encontrada; a consulta de um dos contratos falhou.'
            : 'Nenhuma fatura em aberto em nenhum contrato do cliente.',
        };
      }
      if (faturaForaDoAlvo(contexto, busca)) {
        return { enviado: false, motivo: 'A fatura encontrada não é do titular pedido; nada foi enviado.' };
      }
      const primeira = gate.fatura;
      const contratoUsado = busca.trocouContrato
        ? { contratoId: busca.contratoId, endereco: busca.endereco }
        : null;
      // Idempotência: o claim vem DEPOIS de faturaEmAlgumContrato (só aqui
      // primeira.id existe) e ANTES de qualquer trabalho externo — antes do
      // download do PDF, antes de gravar o arquivo, antes de enfileirar.
      const entrega = await reivindicarEntrega({
        tool: 'enviar_boleto', item: 'boleto', contratoId: busca.contratoId, fatura: primeira, args, contexto,
      });
      if (entrega.resposta) return entrega.resposta;
      const claimId = entrega.claimId;

      // ---- ZONA A: nada saiu do sistema. Toda saída daqui devolve o claim, e
      // a próxima tentativa tem de poder entregar de verdade.
      let mediaPath;
      try {
        if (!primeira.boletoLink) {
          await liberarEntrega(claimId, contexto.conversationId, 'enviar_boleto sem link');
          return { enviado: false, motivo: 'Boleto sem link para download' };
        }
        const buffer = await sgpClient.downloadBoletoPdf(primeira.boletoLink);
        mediaPath = await saveMediaFile(buffer, '.pdf');

        // I1 (revisão final do branch inteiro): entre o início deste turno (a
        // OpenAI, o download do PDF) e este ponto, um atendente humano pode ter
        // assumido a conversa, ou ela pode ter sido fechada/silenciada — sem
        // reler agora, o PDF sairia mesmo com um humano já no comando.
        if (await saiuDaTriagem(contexto.conversationId)) {
          await liberarEntrega(claimId, contexto.conversationId, 'enviar_boleto fora da triagem');
          return { enviado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' };
        }
      } catch (err) {
        // Download, gravação do arquivo ou releitura da conversa falharam:
        // nada chegou ao cliente, então o claim volta.
        await liberarEntrega(claimId, contexto.conversationId, 'enviar_boleto falhou antes do envio');
        throw err;
      }

      // ---- ZONA B: daqui em diante o claim NUNCA é liberado — nem em
      // exceção, nem em timeout, nem em resultado incerto.
      // enqueueOutboundMessage GRAVA a linha da mensagem no banco (já visível
      // na conversa) e só então enfileira: se estourar no meio, a mensagem
      // existe, e devolver o claim autorizaria uma segunda.
      await enqueueOutboundMessage({
        conversationId: contexto.conversationId, channelId: contexto.channelId,
        content: null, messageType: 'document', mediaPath,
        mediaMimeType: 'application/pdf', mediaFilename: 'boleto.pdf', sentBy: 'ai',
      });
      // Junto com o PDF vai a linha digitável sozinha numa mensagem (cartão em
      // texto + número), igual ao botão "Cód Barras" da atendente: no celular
      // o cliente copia a linha e cola no app do banco sem abrir o PDF.
      // Melhor esforço: o PDF já saiu, uma falha aqui não desfaz a entrega.
      let linhaDigitavelEnviada = false;
      if (primeira.barCode) {
        try {
          await enviarBoleto({ conversationId: contexto.conversationId, channelId: contexto.channelId, fatura: primeira, sentBy: 'ai' });
          linhaDigitavelEnviada = true;
        } catch (err) {
          console.error(`enviar_boleto: linha digitável não enviada na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
        }
      }
      // ---- ZONA C: os dois efeitos externos voltaram. A entrega vira um fato
      // gravado — antes de markTriageResolvedByAi, para que uma falha naquela
      // escrita não deixe esta entrega registrada como incerta.
      await confirmarEntrega(claimId, contexto.conversationId);
      // Mesma razão de gerar_pix: a flag persistida é o que autoriza
      // encerrar_atendimento num turno posterior à entrega. 2+ à noite: reativação.
      await marcarDepoisDaEntrega(gate, contexto);
      const reativacaoDepois = Boolean(gate.decisao && gate.decisao.reativacaoDepois);
      // contratoUsado só aparece quando a fatura veio de OUTRO contrato do
      // mesmo cliente. O modelo de frase do dono sai DAQUI, e só depois do
      // envio real (teste real 2026-09-15: no prompt, o modelo copiava a frase
      // sem chamar a ferramenta e o cliente não recebia nada).
      const endereco = enderecoParaCitar(busca, contexto);
      const frase = `Enviei acima o boleto${reativacaoDepois ? ' da fatura vencida mais antiga' : ''}${endereco ? ' referente ao seu contrato do endereço ' + endereco + ',' : ''} em PDF${linhaDigitavelEnviada ? ' e com a linha digitável' : ''}. É só pagar pelo aplicativo do seu banco${linhaDigitavelEnviada ? ', copiando a linha digitável,' : ''} ou em qualquer lotérica.${reativacaoDepois ? fraseDasDemaisVencidas(contexto) : ''} Se tiver alguma dificuldade, me avise que eu te ajudo!`;
      return {
        enviado: true,
        valor: primeira.value,
        vencimento: primeira.dueDate,
        linhaDigitavelEnviada,
        ...(contratoUsado ? { contratoUsado } : {}),
        ...(reativacaoDepois ? { reativacaoDepois: true } : {}),
        instrucao: `O boleto já foi enviado ao cliente nesta conversa em PDF${linhaDigitavelEnviada ? ' e com a linha digitável em mensagem separada' : ''}. ${nomeParaTratar(contexto)} Responda EXATAMENTE no modelo, sem emoji: "${frase}" NÃO repita a linha digitável nem o valor.${reativacaoDepois ? ' Não diga que a internet será liberada nem que ficou tudo regularizado.' : ''}`,
      };
    },
  },
  {
    nome: 'concluir_triagem',
    categoria: 'ACAO',
    descricao: 'Encerra a triagem: define o setor, o motivo e um resumo para o atendente, e coloca a conversa na fila. Informe a confiança (0 a 1) na classificação.',
    isentoDeProprietario: true,
    parametros: {
      type: 'object',
      properties: {
        setorId: { type: 'string', description: 'UUID de um setor existente.' },
        motivoId: { type: ['string', 'null'], description: 'UUID de um motivo existente, ou null se nenhum se aplica.' },
        resumo: {
          type: 'string',
          description: 'Resumo para o atendente humano, em 2 a 4 frases: o que o cliente pediu COM AS PALAVRAS DELE, o que as consultas mostraram, o que você já resolveu, e o que falta. Bom: "Cliente relata quedas desde cedo. Cadastro localizado, contrato ativo e conexão online na consulta. Diz que acontece em todos os aparelhos." Ruim: "Cliente com problema de internet."',
        },
        confianca: { type: 'number', description: 'Confiança na classificação, de 0 a 1.' },
        pendenciasObrigatorias: {
          type: 'array',
          items: { type: 'string' },
          description: 'O que você AINDA precisa saber DO CLIENTE para resolver ou encaminhar corretamente o que ele pediu POR ÚLTIMO. Só o que é tecnicamente necessário: se o setor consegue agir sem o dado, não entra. Dado que apenas enriquece o resumo, o cadastro ou o relatório NÃO entra. Lista VAZIA quando não falta nada. Recalcule a cada tentativa, olhando a intenção MAIS RECENTE: se o cliente mudou de assunto, pendência do assunto anterior não entra. Uma informação por item, em poucas palavras.',
        },
      },
      required: ['setorId', 'resumo', 'confianca', 'pendenciasObrigatorias'],
    },
    validar(args) {
      const setorId = args && args.setorId;
      const motivoId = args && args.motivoId;
      const resumo = args && args.resumo;
      const confiancaBruta = args && args.confianca;
      const pendenciasBrutas = args && args.pendenciasObrigatorias;
      if (typeof setorId !== 'string' || !UUID_PATTERN.test(setorId)) return erro('setorId must be a UUID');
      if (motivoId != null && (typeof motivoId !== 'string' || !UUID_PATTERN.test(motivoId))) return erro('motivoId must be a UUID or null');
      if (typeof resumo !== 'string' || !resumo.trim()) return erro('resumo is required');
      // Number(true) === 1: sem esta checagem de tipo, um booleano passava
      // pela validação de faixa (0 a 1) como se fosse confiança máxima.
      if (typeof confiancaBruta !== 'number' && typeof confiancaBruta !== 'string') return erro('confianca must be a number');
      const confianca = Number(confiancaBruta);
      if (!Number.isFinite(confianca) || confianca < 0 || confianca > 1) return erro('confianca must be between 0 and 1');
      // SEM default: um argumento ausente é invalid_args como qualquer outro
      // campo obrigatório, e NUNCA `[]`. "Não declarou" não pode significar
      // "não falta nada" — seria exatamente a autorização implícita que esta
      // guarda existe para tirar do caminho.
      // Item vazio também é invalid_args, e não item a descartar: a guarda
      // falha FECHADO. Uma declaração malformada não pode encolher para lista
      // vazia e virar autorização para concluir.
      if (!Array.isArray(pendenciasBrutas)) return erro('pendenciasObrigatorias must be an array of strings');
      const pendenciasObrigatorias = [];
      for (const pendencia of pendenciasBrutas) {
        if (typeof pendencia !== 'string' || !pendencia.trim()) return erro('pendenciasObrigatorias must be an array of strings');
        pendenciasObrigatorias.push(pendencia.trim());
      }
      return { ok: true, args: { setorId, motivoId: motivoId || null, resumo: resumo.trim(), confianca, pendenciasObrigatorias } };
    },
    async executar(args, contexto) {
      // I6 (revisão final do branch inteiro): mesma guarda de
      // esquecer_identificacao — concluir_triagem só existe para a
      // recepcionista da triagem, nunca para o assistente clássico.
      if (!perfilTriagem(contexto)) return erro('concluir_triagem is only available during AI triage');
      // GUARDA ESTRUTURAL (Task 20, cenários 16 e 20 da execução real): a IA
      // identifica SEMANTICAMENTE o que ainda falta; o CÓDIGO decide se a ação
      // terminal pode acontecer. Nada de ler o `resumo` com regex, nada de
      // lista por motivo ou por setor, nada de gate de confiança: a única
      // entrada é o que o próprio modelo declarou em pendenciasObrigatorias.
      //
      // Fica AQUI, no topo, antes de TODO efeito colateral — e por isso ANTES
      // de limparEscopoDeTerceiro, lá embaixo. Uma conclusão recusada significa
      // que a conversa CONTINUA: destruir o escopo temporário do terceiro numa
      // recusa faria quem pediu o boleto do cônjuge perder a autorização no
      // meio do atendimento e ter de informar o CPF do titular de novo. Seria a
      // Fase 2 quebrada por efeito colateral de uma recusa.
      //
      // Incondicional de propósito: não há bypass por forcarConclusao. Quando o
      // limite de perguntas estoura, quem encerra é o CÓDIGO, no worker
      // (ai-worker.js, concluirEmCodigo) — o contador nunca autoriza a IA a
      // concluir, então não existe deadlock.
      //
      // Só uma lista vazia EXPLÍCITA autoriza. Sem `|| []` em lugar nenhum: a
      // ausência já voltou como invalid_args em validar(), e esta segunda
      // leitura mantém a mesma regra caso alguém chame executar() por fora.
      const pendencias = args.pendenciasObrigatorias;
      if (!Array.isArray(pendencias)) return erro('pendenciasObrigatorias is required');
      if (pendencias.length > 0) {
        return {
          concluido: false,
          motivo: 'Há informação obrigatória pendente: sem ela o setor não consegue resolver nem encaminhar o que o cliente pediu.',
          pendenciasObrigatorias: pendencias,
          instrucao: 'NÃO conclua agora. Continue a conversa e pergunte ao cliente o que falta, no máximo UMA pergunta necessária por vez, começando pela primeira da lista.',
        };
      }
      // A entrega (boleto/PIX) pode ter sido num turno ANTERIOR, e
      // contexto.resolvidoPelaIa só conhece este turno. Leitura extra de
      // propósito: a releitura que já existe aqui embaixo acontece DEPOIS do
      // UPDATE, tarde demais para entrar no resumo que vai junto com ele.
      const antes = await getConversationWithContact(contexto.conversationId);
      // Regra 0/1/2+ (25/09/2026): conversa marcada para a reativação (cancelado, 2+ de dia, 2+ à
      // noite depois da mais antiga) vai para o setor de reativação e NUNCA sai como "resolvida
      // pela IA" — nem com o PIX enviado, nem com ele pago.
      const reativacao = await reativacaoDaConversa(contexto);
      const resolvidoPelaIa = !reativacao
        && (Boolean(contexto.resolvidoPelaIa) || Boolean(antes && antes.aiTriageResolvedByAi));
      const setores = await listSectors();
      const setor = setores.find((s) => s.id === args.setorId);
      if (!setor) return erro('Unknown setorId');
      // Sem setor de reativação cadastrado, a conclusão segue no setor escolhido (ainda sem
      // "resolvido"): travar aqui deixaria a conversa sem destino nenhum.
      const setorReativacao = reativacao ? setores.find(ehSetorDeReativacao) : null;
      if (setorReativacao && setor.id !== setorReativacao.id) {
        return {
          concluido: false,
          motivo: 'Este atendimento precisa ir para a equipe de reativação.',
          instrucao: `NÃO conclua para outro setor: ${descreverReativacao(reativacao)}. Chame concluir_triagem de novo com o setor que cuida de reativação (setorId ${setorReativacao.id}), com o mesmo resumo.`,
        };
      }
      let motivo = null;
      if (args.motivoId) {
        motivo = await findReasonById(args.motivoId);
        if (!motivo || !motivo.active) return erro('Invalid or inactive motivoId');
      }
      const t = contexto.triagem || { threshold: 0.8, maxQuestions: 2, attempts: 0 };
      const baixa = args.confianca < t.threshold;
      // A confiança é um palpite do modelo sobre si mesmo. Até 2026-09-17 um
      // palpite baixo RECUSAVA a conclusão e forçava mais uma pergunta ao
      // cliente — um número inventado virava pergunta na tela de quem estava
      // esperando ser atendido. Agora ela só marca o resumo: quem decide se a
      // classificação está ruim é o atendente, que tem a conversa na frente.
      const id = contexto.identidade || { nivel: 'none', origem: 'none' };
      const identifiedBy = id.origem === 'none' ? 'none' : id.origem;
      const rotuloId = { memory: 'memória', phone: 'telefone', cpf: 'CPF (não confirmado)', none: 'não identificado' }[identifiedBy];
      const linhas = [
        `Setor: ${setor.name}`,
        `Motivo: ${motivo ? motivo.name : 'não definido'}`,
        `Cliente: ${id.nome || id.primeiroNome || 'não identificado'}${id.client ? ` (SGP ${id.client.id})` : ''}`,
        `Contratos: ${(contexto.contracts || []).map((c) => `${c.id} — ${c.address || 'sem endereço'}`).join('; ') || 'nenhum'}`,
        `Identificação: ${rotuloId}`,
        `Origem: ${contexto.origemMensagem || 'texto'}`,
        `Confiança: ${Math.round(args.confianca * 100)}%${baixa ? ' (BAIXA)' : ''}`,
      ];
      // O titular aparece pelo primeiro nome e pelo contrato; o documento dele nunca
      // entra no resumo — não está nem guardado.
      if (contexto.terceiro) {
        linhas.push(`Pedido de terceiro: titular ${contexto.terceiro.nome || 'não informado'}, contrato ${contexto.terceiro.contratos.map((c) => c.id).join(', ')}`);
      }
      // Contenções operacionais (25/09/2026): a troca do Wi-Fi é feita pela equipe a partir deste
      // resumo — o código diz se quem pediu é o titular identificado. A senha nova nunca entra aqui.
      const pedidoDeWifi = linhaDoWifiNoResumo(contexto);
      if (pedidoDeWifi) linhas.push(pedidoDeWifi);
      if (reativacao) linhas.push(`Encaminhamento para reativação: ${descreverReativacao(reativacao)}.`);
      if (resolvidoPelaIa) linhas.push('Resolvido pela IA: boleto/PIX enviado — só confirmar.');
      if (Array.isArray(contexto.registroFerramentas) && contexto.registroFerramentas.length > 0) {
        linhas.push(`Ferramentas: ${contexto.registroFerramentas.map((r) => `${r.nome} → ${legivel(r.resultado)}`).join('; ')}`);
      }
      linhas.push('', args.resumo);
      // Quem pega a conversa de manhã precisa ver, na PRIMEIRA linha, que ela
      // foi atendida sozinha de madrugada e a que horas.
      const noturno = noturnoDoContexto(contexto);
      // O que a IA leu do comprovante sobe para o topo do resumo SEMPRE que
      // houver leitura — de dia também, desde a Parte 2: é disso que depende a
      // baixa do pagamento. A marca do turno noturno e a linha do desbloqueio
      // continuam só à noite, que é quando as duas coisas existem.
      const extras = [];
      const comp = contexto.comprovante;
      if (comp) {
        // Valor e data podem vir nulos da visão (Task 3). Nada de toFixed em
        // null: "R$ 0,00" faria o atendente dar baixa num valor inventado.
        const valor = comp.valor == null ? 'valor não lido' : `R$ ${Number(comp.valor).toFixed(2).replace('.', ',')}`;
        const data = comp.data ? formatarData(comp.data) : 'data não lida';
        const conferencia = comp.valido ? 'conferido' : `NÃO conferiu: ${(comp.motivos || []).join('; ')}`;
        // O aviso de uso anterior cita o contrato de OUTRO cliente: ele existe
        // só aqui, no resumo interno, e nunca em nada que vá ao WhatsApp.
        const jaUsado = comp.usoAnterior && comp.usoAnterior.descricao ? ` — ⚠ ${comp.usoAnterior.descricao}` : '';
        extras.push(`Comprovante (visão): ${comp.tipo || 'outro'} ${valor} em ${data} — ${conferencia}${comp.faturaId ? `, fatura ${comp.faturaId}` : ''}${comp.contratoId ? ` do contrato ${comp.contratoId}` : ''}${jaUsado}`);
      }
      const desbloqueio = noturno ? contexto.desbloqueioResultado : null;
      if (desbloqueio) {
        extras.push(`Desbloqueio em confiança: ${desbloqueio.liberado
          ? (desbloqueio.dias ? `REALIZADO (${desbloqueio.dias} dias)` : 'REALIZADO (prazo não informado)')
          : `RECUSADO: ${desbloqueio.motivo}`}`);
      }
      if (comp || desbloqueio) extras.push('Pendente: conferir pagamento e dar baixa');
      if (noturno) linhas.unshift(`Modo noturno · ${horaDeSaoPaulo()}`, ...extras);
      else if (extras.length > 0) linhas.unshift(...extras);
      // Corrigido 2026-09-18: a guarda mora AQUI agora — imediatamente antes da
      // escrita terminal —, não mais logo após o perfil. O resumo (linhas) já
      // está todo montado, inclusive o que uma tarefa futura vai ler de
      // contexto.terceiro para citar o pedido de terceiro no próprio resumo.
      // Montar o resumo não é a ação terminal; concluir é. As saídas
      // antecipadas ACIMA (pendência obrigatória declarada, setor/motivo
      // inválidos) preservam contexto.terceiro de propósito: a triagem
      // continua e a cliente não precisa informar de novo o CPF do titular.
      // Antes de concluir, e não depois: se a limpeza falhar, a triagem NÃO
      // conclui. Concluir com uma autorização de terceiro ainda viva deixaria
      // o escopo válido pelos 30 minutos seguintes numa conversa que já saiu
      // da triagem.
      if (contexto.terceiro && !(await limparEscopoDeTerceiro(contexto))) {
        return erro('third_party_scope_not_cleared');
      }
      const conversa = await concludeAiTriage(contexto.conversationId, {
        sectorId: setor.id, reasonId: motivo ? motivo.id : null, confidence: args.confianca,
        summary: linhas.join('\n'), identifiedBy, lowConfidence: baixa, resolvedByAi: resolvidoPelaIa,
      });
      if (!conversa) return { concluido: false, motivo: 'A conversa já saiu da triagem (um atendente assumiu ou ela já foi concluída).' };
      const completa = await getConversationWithContact(contexto.conversationId);
      broadcast('queue:new', { conversation: completa, message: null });
      broadcastToDashboard('dashboard:conversation', { conversation: completa });
      contexto.triagemConcluida = { setor: setor.name };
      // À noite não há ninguém para "continuar daqui": a frase de desfecho diz
      // a hora em que a equipe volta, sem prometer atendimento imediato.
      const instrucao = noturno
        ? `Responda ao cliente em uma frase: use o primeiro nome se souber, diga que o atendimento ficou registrado para o setor ${setor.name} e que nossa equipe dá continuidade a partir das ${noturno.retornoAs}. Não faça mais perguntas.`
        : `Responda ao cliente em uma frase: use o primeiro nome se souber, diga que o atendimento vai para o setor ${setor.name} e que um atendente continua daqui. Não faça mais perguntas.`;
      return { concluido: true, setor: setor.name, instrucao };
    },
  },
  {
    nome: 'encerrar_atendimento',
    categoria: 'ACAO',
    // Sem contrato nenhum nos argumentos: age só sobre contexto.conversationId.
    isentoDeProprietario: true,
    descricao: 'Encerra o atendimento quando a IA já entregou o boleto/PIX e o cliente disse que não precisa de mais nada. Só na triagem.',
    parametros: { type: 'object', properties: {} },
    validar() {
      return { ok: true, args: {} };
    },
    async executar(args, contexto) {
      if (!perfilTriagem(contexto)) return erro('encerrar_atendimento is only available during AI triage');
      // Sem motivo escolhido pelo admin — ou com o motivo desativado depois de
      // escolhido — o encerramento pela IA simplesmente não existe: tudo
      // segue como hoje (encaminha ao setor).
      const reasonId = await motivoDeEncerramentoAtivo();
      if (!reasonId) {
        return { encerrado: false, motivo: 'Encerramento pela IA não está configurado ou o motivo foi desativado. Conclua a triagem com concluir_triagem.' };
      }
      // Relê: o dono da conversa pode ter mudado durante o turno.
      const atual = await getConversationWithContact(contexto.conversationId);
      if (!atual || atual.status !== 'waiting' || atual.assignedAgentId || atual.triageState !== 'pending') {
        return { encerrado: false, motivo: 'A conversa saiu da triagem; não faça nada.' };
      }
      // Regra 0/1/2+: a conversa marcada para a reativação nunca fecha como resolvida, mesmo que
      // uma entrega (de outro contrato, ou a mais antiga à noite) tenha acontecido.
      if (await reativacaoDaConversa(contexto)) {
        return {
          encerrado: false,
          motivo: 'Este atendimento precisa seguir para a equipe de reativação; não pode ser encerrado como resolvido.',
          instrucao: 'Não encerre: chame concluir_triagem com o setor que cuida de reativação.',
        };
      }
      // Trava dura: a IA nunca encerra um atendimento em que não resolveu
      // nada. A flag é persistida porque a entrega pode ter sido em outro turno.
      if (!atual.aiTriageResolvedByAi) {
        return { encerrado: false, motivo: 'Nada foi entregue neste atendimento. Conclua a triagem com concluir_triagem.' };
      }
      const linhas = ['Resolvido pela IA e encerrado sem atendente.'];
      // Rodada de correção 1 (Task 11): mesma legibilidade de concluir_triagem
      // — este resumo também é lido por gente (auditoria/histórico do
      // atendimento fechado), então não há razão para ficar com JSON cru
      // enquanto concluir_triagem ganhou o formato legível.
      if (Array.isArray(contexto.registroFerramentas) && contexto.registroFerramentas.length > 0) {
        linhas.push(`Ferramentas: ${contexto.registroFerramentas.map((r) => `${r.nome} → ${legivel(r.resultado)}`).join('; ')}`);
      }
      // Corrigido 2026-09-18: a guarda mora AQUI agora — imediatamente antes
      // da escrita terminal —, não mais logo após o perfil. As três saídas
      // antecipadas ACIMA (sem motivo configurado, saiu da triagem, nada
      // entregue) preservam contexto.terceiro de propósito: o atendimento
      // continua na triagem e a cliente não precisa informar de novo o CPF do
      // titular.
      // Antes de encerrar, e não depois: se a limpeza falhar, o encerramento
      // NÃO acontece. Encerrar com uma autorização de terceiro ainda viva
      // deixaria o escopo válido pelos 30 minutos seguintes numa conversa que
      // já saiu da triagem.
      if (contexto.terceiro && !(await limparEscopoDeTerceiro(contexto))) {
        return erro('third_party_scope_not_cleared');
      }
      const conversa = await closeConversationByAi(contexto.conversationId, {
        reasonId, summary: linhas.join('\n'),
      });
      if (!conversa) return { encerrado: false, motivo: 'A conversa já saiu da triagem.' };
      // A conversa em triagem ESTÁ na fila de todo atendente — é a aba Automação (fila
      // filtrada por triageState 'pending'). Sem o queue:removed, o item encerrado ficava lá,
      // como "IA em triagem", até recarregar a página (caso ER, 25/09/2026). Mesmo evento do
      // encerramento pelo atendente de uma conversa sem dono.
      broadcast('queue:removed', { conversationId: contexto.conversationId });
      broadcastToDashboard('dashboard:conversation', {
        conversation: await getConversationWithContact(contexto.conversationId),
        closedAt: new Date().toISOString(),
      });
      contexto.atendimentoEncerrado = true;
      const noturno = noturnoDoContexto(contexto);
      return {
        encerrado: true,
        instrucao: noturno
          ? `Despeça-se: se ele agradeceu, comece com "Imagina, {nome}! 😊"; diga que qualquer dúvida sobre o pagamento ou ajuda com a internet é só chamar por aqui, deseje uma boa noite e, se ele precisar de algo mais, a equipe volta às ${noturno.retornoAs}.`
          : 'Despeça-se: se ele agradeceu, comece com "Imagina, {nome}! 😊"; diga que qualquer dúvida sobre o pagamento ou ajuda com a internet é só chamar por aqui, e deseje um ótimo dia (ou boa noite).',
      };
    },
  },
];

function listTools() {
  return TOOLS;
}

function findTool(nome) {
  return TOOLS.find((t) => t.nome === nome) || null;
}

function toOpenAiTools(nomesHabilitados) {
  // A OpenAI só enxerga nome, descrição e parâmetros. Categoria, validador e
  // executor são nossos e nunca atravessam a fronteira.
  return TOOLS.filter((t) => nomesHabilitados.includes(t.nome)).map((t) => ({
    type: 'function',
    function: { name: t.nome, description: t.descricao, parameters: t.parametros },
  }));
}

module.exports = {
  temEfeitoReal, CATEGORIAS_SOMENTE_LEITURA,
  listTools, findTool, toOpenAiTools, perfilTriagem, FERRAMENTAS_PERMITIDAS_EM_TERCEIRO,
  escopoDoContrato, faturaEmAlgumContrato,
};
