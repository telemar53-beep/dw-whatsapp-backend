const sgpClient = require('../integrations/sgp-client');
const { normalizeContract, normalizeConnection, normalizeInvoices } = require('./sgp-normalizer');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const {
  setSuggestedReason, setConversationSector, concludeAiTriage, getConversationWithContact,
  markPhoneContested, markTriageResolvedByAi, closeConversationByAi, setThirdPartyScope,
} = require('../conversations/conversation.repository');
const { montarEscopo, paraContexto } = require('./third-party-scope');
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
const { enviarAvisoDeCidadeSePreciso } = require('../city-notices/city-notice.service');
const { mensagemSegura } = require('./safe-error-log');
const { findLatestInboundImage } = require('../conversations/message.repository');
const { getAiConfig } = require('./ai-config.repository');
const { analisarComprovante } = require('./receipt-analysis');
const { claimReceipt, releaseReceipt, findReceiptUsage } = require('./receipt-usage.repository');
const { claimDelivery, markDeliveryEnqueued, releaseDelivery } = require('./billing-delivery.repository');
const { descreverUsoAnterior } = require('./receipt-usage-text');

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
  return true;
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

      const { client, contracts } = await sgpClient.lookupClientByCpf(args.cpf);

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
        try {
          await preencherCidadePeloSgp(contexto.contact, contracts);
          await enviarAvisoDeCidadeSePreciso({
            contact: contexto.contact,
            conversationId: contexto.conversationId,
            channelId: contexto.channelId,
          });
        } catch (err) {
          console.error(`City autofill failed for contact ${contexto.contact.id}: ${mensagemSegura(err)}`);
        }
        return {
          cliente: { nome },
          contratos: contracts.map((c) => {
            const n = normalizeContract(c);
            return { id: c.id, status: n.status, endereco: n.endereco };
          }),
          instrucao: 'Cliente identificado. Siga com o pedido. Com um contrato só, use-o sem perguntar; com vários, pergunte pelo endereço.',
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
    async executar(args) {
      const raw = await sgpClient.checkConnection(args.contratoId);
      return normalizeConnection(raw);
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
          return { ...base, faturas, ...(listaParcial ? { listaParcial: true, totalFaturas: total } : {}) };
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
      const semResposta = linhas.filter((l) => l.conexao === null || l.conexao === 'desconhecido');
      const citar = (lista) => lista.map((l) => `${l.contratoId} (${l.endereco})`).join(', ');
      let instrucao;
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
      return {
        contratos: linhas,
        suspensos,
        offline,
        ...(instrucao ? { instrucao } : {}),
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
      const busca = await faturaEmAlgumContrato(args.contratoId, contexto);
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
      const busca = await faturaEmAlgumContrato(args.contratoId, contexto);
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
      const primeira = daMaisAntiga(busca.resultado.duplicates)[0];
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
      contexto.resolvidoPelaIa = true;
      // Grava a entrega: contexto.resolvidoPelaIa nasce false a cada turno, e o
      // "nao preciso de mais nada" do cliente costuma vir no turno SEGUINTE.
      await markTriageResolvedByAi(contexto.conversationId);
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
        instrucao: `O PIX já foi enviado ao cliente nesta conversa (cartão com botão de copiar). ${nomeParaTratar(contexto)} Responda EXATAMENTE no modelo: "Enviei acima o PIX${endereco ? ' referente ao seu contrato do endereço ' + endereco : ''}. É só copiar o código e colar na opção "PIX Copia e Cola" do aplicativo do seu banco. Se tiver alguma dificuldade, me avise que eu te ajudo!" NÃO repita o código nem o valor.`,
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
            ? `Responda EXATAMENTE neste modelo: "Recebi seu comprovante, ${nome}! Seu contrato está ativo, então não há bloqueio para liberar. O pagamento fica registrado para a equipe conferir e dar baixa a partir das ${noturno.retornoAs}." — e chame concluir_triagem para o setor que cuidar de financeiro NA MESMA resposta.`
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
        const paraOCliente = `${nome}, ${comprovante ? 'recebi seu comprovante e ele já está registrado para a equipe conferir' : 'sua solicitação já está registrada para a equipe'} a partir das ${noturno.retornoAs}. ${frase}: ${motivoPontuado} Assim que o pagamento for confirmado, a liberação é automática.`;
        return `Responda EXATAMENTE neste modelo: "${paraOCliente}" — e chame concluir_triagem para o setor que cuidar de financeiro NA MESMA resposta.`;
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
        resposta.instrucao = `Responda EXATAMENTE neste modelo: "Prontinho, ${nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das ${noturno.retornoAs}. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?" — e chame concluir_triagem para o setor que cuidar de financeiro NA MESMA resposta (motivo "Desbloqueio em confiança" se existir).`;
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
      const busca = await faturaEmAlgumContrato(args.contratoId, contexto);
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
      const primeira = daMaisAntiga(busca.resultado.duplicates)[0];
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
      contexto.resolvidoPelaIa = true;
      // Mesma razão de gerar_pix: a flag persistida é o que autoriza
      // encerrar_atendimento num turno posterior à entrega.
      await markTriageResolvedByAi(contexto.conversationId);
      // contratoUsado só aparece quando a fatura veio de OUTRO contrato do
      // mesmo cliente. O modelo de frase do dono sai DAQUI, e só depois do
      // envio real (teste real 2026-09-15: no prompt, o modelo copiava a frase
      // sem chamar a ferramenta e o cliente não recebia nada).
      const endereco = enderecoParaCitar(busca, contexto);
      const frase = `Enviei acima o boleto${endereco ? ' referente ao seu contrato do endereço ' + endereco + ',' : ''} em PDF${linhaDigitavelEnviada ? ' e com a linha digitável' : ''}. É só pagar pelo aplicativo do seu banco${linhaDigitavelEnviada ? ', copiando a linha digitável,' : ''} ou em qualquer lotérica. Se tiver alguma dificuldade, me avise que eu te ajudo!`;
      return {
        enviado: true,
        valor: primeira.value,
        vencimento: primeira.dueDate,
        linhaDigitavelEnviada,
        ...(contratoUsado ? { contratoUsado } : {}),
        instrucao: `O boleto já foi enviado ao cliente nesta conversa em PDF${linhaDigitavelEnviada ? ' e com a linha digitável em mensagem separada' : ''}. ${nomeParaTratar(contexto)} Responda EXATAMENTE no modelo, sem emoji: "${frase}" NÃO repita a linha digitável nem o valor.`,
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
      const resolvidoPelaIa = Boolean(contexto.resolvidoPelaIa) || Boolean(antes && antes.aiTriageResolvedByAi);
      const setor = (await listSectors()).find((s) => s.id === args.setorId);
      if (!setor) return erro('Unknown setorId');
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
      // Só o painel: a conversa nunca apareceu na fila (nasceu 'pending' e
      // morreu 'closed'), então não há queue:removed a emitir.
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
  listTools, findTool, toOpenAiTools, perfilTriagem, FERRAMENTAS_PERMITIDAS_EM_TERCEIRO,
  escopoDoContrato, faturaEmAlgumContrato,
};
