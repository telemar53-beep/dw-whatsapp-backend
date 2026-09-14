const fs = require('fs');

const sgpClient = require('../integrations/sgp-client');
const { normalizeContract, normalizeConnection, normalizeInvoices } = require('./sgp-normalizer');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const {
  setSuggestedReason, setConversationSector, concludeAiTriage, getConversationWithContact,
  incrementBirthdateAttempts, markPhoneContested, markTriageResolvedByAi, closeConversationByAi,
  setTriagePendingDocument,
} = require('../conversations/conversation.repository');
const { motivoDeEncerramentoAtivo } = require('./triage-close-reason');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { avaliarElegibilidade, MENSAGENS: MENSAGENS_DESBLOQUEIO } = require('./trust-unlock-rules');
const { saveMediaFile, getMediaFilePath } = require('../media/media-storage');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { enviarPix, enviarBoleto } = require('../payments/payment-sender');
const { formatarData } = require('../payments/payment-card');
const { broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { primeiroNome } = require('./identity-resolver');
const { preencherCidadePeloSgp } = require('../cities/contact-city.service');
const { enviarAvisoDeCidadeSePreciso } = require('../city-notices/city-notice.service');
const { mensagemSegura } = require('./safe-error-log');
const { findLatestInboundImage } = require('../conversations/message.repository');
const { analyzeImage } = require('./openai-client');
const { getAiConfig } = require('./ai-config.repository');
const { conferirComprovante, PROMPT_VISAO } = require('./comprovante');
// Mesmo normalizador que sgp-client.js usa no que vem do cadastro: os dois
// lados da conferência da data precisam concordar sobre o que é uma data.
const { normalizarDataNascimento } = require('./data-nascimento');

// A imagem só sai do servidor depois de passar por estes dois filtros: o
// que a OpenAI consegue ler de verdade, e um teto de bytes.
const MIMES_COMPROVANTE = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANHO_MAXIMO_COMPROVANTE = 5 * 1024 * 1024;

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
 * Procura a fatura em aberto no contrato pedido e, se não houver, nos DEMAIS
 * contratos do cliente. Teste real 2026-09-13: cliente com dois contratos, o
 * modelo chamou gerar_pix no contrato sem fatura e respondeu "não encontrei
 * fatura em aberto" — mesmo com o prompt mandando consultar todos antes. A
 * garantia tem que estar no código, não na obediência do modelo.
 *
 * Propriedade: os contratos alternativos saem de contexto.contracts, que o
 * servidor carregou a partir do CPF do PRÓPRIO contato — a troca de contrato
 * nunca sai do dono, não há id vindo do modelo aqui.
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

  const outros = ((contexto && contexto.contracts) || []).filter((c) => c.id !== contratoPedido);
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

/** Busca no cache do turno; só chama o SGP se ainda não houver nada. */
async function contratoDoCache(contexto, contratoId) {
  const achado = (contexto.contracts || []).find((c) => c.id === contratoId);
  if (!achado) throw new Error('contract_not_in_context');
  return achado;
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
      properties: { cpf: { type: 'string', description: 'CPF ou CNPJ do cliente, com ou sem pontuação.' } },
      required: ['cpf'],
    },
    validar(args) {
      const cpf = String((args && args.cpf) || '').replace(/\D/g, '');
      if (!cpf) return erro('cpf is required');
      return { ok: true, args: { cpf } };
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
      contexto.contracts = contracts;

      // No perfil de triagem, CPF digitado por número desconhecido é identidade
      // FRACA: classifica, mas não entrega nada até confirmar_nascimento. Por
      // isso o vínculo do contato NÃO é persistido aqui — é
      // confirmar_nascimento quem persiste, só depois de bater a data. Sem
      // isso, um CPF errado (ou de outra pessoa) vazaria para o próximo turno
      // como identidade forte via memória (contact.sgpDocument já setado).
      if (perfilTriagem(contexto)) {
        const configIa = await getAiConfig();
        // Decisão do dono (2026-09-14): "o dado mais importante é o CPF; no
        // site do SGP o cliente loga só com ele". Por padrão a confirmação por
        // data de nascimento está DESLIGADA e o CPF digitado já identifica —
        // mesmo caminho do ramo assistente, mais a cidade e o aviso que
        // confirmar_nascimento fazia. Com a flag ligada, o comportamento
        // antigo (identidade fraca até a data bater) volta inteiro.
        if (!(configIa && configIa.triageRequireBirthdate)) {
          const nome = primeiroNome(client.name);
          contexto.identidade = {
            nivel: 'forte', origem: 'cpf', primeiroNome: nome, contracts,
            client: { id: client.id, document: args.cpf }, dataNascimento: null,
            contestado: false, nascimentoTentado: false,
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
          // Sem confirmação pendente não há CPF pendente: um resto na coluna
          // faria o próximo turno reconstruir uma identidade fraca por cima de
          // uma forte já gravada.
          try {
            await setTriagePendingDocument(contexto.conversationId, null);
          } catch (err) {
            console.error(`Failed to clear the pending triage document for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
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

        let dataNascimento = null;
        try {
          const rec = await sgpClient.findClientRecord({ cpfcnpj: args.cpf });
          dataNascimento = rec.cliente ? rec.cliente.dataNascimento : null;
        } catch (err) {
          console.error(`Birth date lookup failed: ${mensagemSegura(err)}`);
        }
        contexto.identidade = {
          nivel: 'fraca', origem: 'cpf', primeiroNome: primeiroNome(client.name), contracts,
          client: { id: client.id, document: args.cpf }, dataNascimento, contestado: false, nascimentoTentado: false,
        };
        // A identidade FRACA precisa sobreviver ao fim do turno: sem isto,
        // resolverIdentidade devolvia 'none' no turno seguinte e o modelo
        // pedia o CPF outra vez (defeito A, teste real 2026-09-14). A coluna
        // é dedicada e fica fora dos resumos.
        //
        // Try/catch: a identidade deste turno já está montada e vale. Perder a
        // persistência é voltar ao comportamento antigo; derrubar o turno
        // inteiro (execution_error) logo depois de o cliente digitar o CPF é
        // pior. O CPF nunca entra na mensagem de log.
        try {
          await setTriagePendingDocument(contexto.conversationId, args.cpf);
        } catch (err) {
          console.error(`Failed to store the pending triage document for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
        }
        // As palavras do modelo vão direto ao cliente na triagem: nunca o
        // sobrenome completo nem o login PPPoE, só o que já se apresentaria
        // por telefone.
        //
        // Defeito C (teste real 2026-09-14): a lista de contratos saía daqui
        // com id e status, e o modelo citava "contrato 2354" ao cliente e
        // perguntava "qual contrato" mesmo com um contrato só. Antes da
        // confirmação ele recebe só a quantidade — os contratos continuam em
        // contexto.identidade.contracts, para o executor e para
        // confirmar_nascimento devolvê-los depois.
        return {
          cliente: { nome: primeiroNome(client.name) },
          quantidadeContratos: contracts.length,
          proximoPasso: 'Identificação por CPF ainda não confirmada. Pergunte a data de nascimento e chame confirmar_nascimento. NÃO cite contrato, endereço nem plano; NÃO pergunte qual contrato.',
        };
      }

      // Perfil assistente: um atendente humano acompanha a conversa, então o
      // vínculo é persistido de imediato — o guard de "troca de cliente" do
      // executor (que lê contexto.contact.sgpDocument) depende disso para
      // disparar dentro do mesmo turno.
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
      properties: { contratoId: { type: 'integer' } },
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
      properties: { contratoId: { type: 'integer' } },
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
      properties: { contratoId: { type: 'integer' } },
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
      properties: { contratoId: { type: 'integer' } },
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
      properties: { contratoId: { type: 'integer' } },
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
          instrucao = 'Nenhum contrato tem fatura em aberto: diga isso em uma frase (sem valores) e chame concluir_triagem para o Financeiro.';
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
          // O dono: a DW Telecom É o suporte. "Não consegui verificar" é
          // inaceitável — na dúvida, trate como o caso bom e siga o roteiro.
          instrucao = `A consulta de conexão de ${citar(semResposta)} não respondeu: NÃO diga isso ao cliente. Trate como ativo e online e use o modelo correspondente.`;
        } else {
          instrucao = 'Todos os contratos estão ativos e online. Use o modelo "ativo e online" e, se ele tiver mais de um contrato, pergunte também de qual endereço fala.';
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
        resumo: { type: 'string', description: 'Resumo do atendimento para o atendente humano.' },
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
      properties: { contratoId: { type: 'integer' } },
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
        faturas: result.duplicates.map((d) => ({
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
      properties: { contratoId: { type: 'integer' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
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
      const primeira = busca.resultado.duplicates[0];
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

      // Regra do Financeiro: sem código PIX no SGP, não há o que enviar.
      if (!primeira.pixCode) return { sucesso: false, motivo: 'Fatura sem código PIX no SGP' };

      // Mesma guarda de enviar_boleto: entre a consulta ao SGP e este ponto,
      // um atendente pode ter assumido a conversa, ou ela pode ter sido
      // fechada/silenciada/concluída.
      if (await saiuDaTriagem(contexto.conversationId)) {
        return { enviado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' };
      }

      await enviarPix({ conversationId: contexto.conversationId, channelId: contexto.channelId, fatura: primeira, sentBy: 'ai' });
      contexto.resolvidoPelaIa = true;
      // Grava a entrega: contexto.resolvidoPelaIa nasce false a cada turno, e o
      // "nao preciso de mais nada" do cliente costuma vir no turno SEGUINTE.
      await markTriageResolvedByAi(contexto.conversationId);
      return {
        enviado: true,
        valor: primeira.value,
        vencimento: primeira.dueDate,
        ...(contratoUsado ? { contratoUsado } : {}),
        instrucao: `O PIX já foi enviado ao cliente nesta conversa (cartão com botão de copiar). Responda dizendo que enviou acima o PIX${contratoUsado ? ' referente ao contrato do endereço ' + contratoUsado.endereco : ''}, que é só copiar o código e colar na opção "PIX Copia e Cola" do aplicativo do banco, e que se tiver dificuldade é só avisar. NÃO repita o código nem o valor.${contratoUsado ? ' Diga ao cliente de qual endereço é a fatura.' : ''}`,
      };
    },
  },
  {
    nome: 'desbloqueio_confianca',
    categoria: 'ACAO_SENSIVEL',
    descricao: 'Libera em confiança (promessa de pagamento) um contrato SUSPENSO por inadimplência, devolvendo a internet por alguns dias até o pagamento. Use só quando o cliente pedir a liberação e o contrato estiver suspenso. Regras da casa: uma liberação a cada 30 dias, e nunca se a liberação anterior não foi paga. Ao responder, informe o prazo devolvido pela ferramenta e que a fatura continua devida.',
    chaveProprietario: 'contratoId',
    // À noite esta ferramenta entra na lista da triagem, e a identidade 'fraca'
    // (CPF digitado, sem data de nascimento confirmada) também carrega
    // contratos: sem este gate, quem digitasse o CPF de outra pessoa liberaria
    // o contrato dela. O gate do tool-executor só vale no perfil de triagem,
    // então o assistente clássico (humano no comando) não muda.
    exigeIdentidadeForte: true,
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer' } },
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

      const status = normalizeContract(contrato).status;
      // A DW não usa velocidade reduzida: só contrato suspenso é elegível.
      if (status !== 'suspenso') {
        const resposta = { liberado: false, motivo: `O contrato não está suspenso (status: ${status}). A liberação em confiança só se aplica a contrato suspenso.` };
        // À noite este desfecho também precisa de frase pronta: quem mandou
        // comprovante de um contrato que já está ativo merece o agradecimento e
        // a baixa na fila do Financeiro; quem só pediu liberação sem pagar nada
        // provavelmente está com problema de conexão, e aí a conversa continua.
        if (noturno) {
          resposta.instrucao = comprovante && comprovante.valido === true
            ? `Responda EXATAMENTE neste modelo: "Recebi seu comprovante, ${nome}! Seu contrato está ativo, então não há bloqueio para liberar. O pagamento fica registrado para a equipe conferir e dar baixa a partir das ${noturno.retornoAs}." — e chame concluir_triagem para o Financeiro NA MESMA resposta.`
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
        return `Responda EXATAMENTE neste modelo: "${paraOCliente}" — e chame concluir_triagem para o Financeiro NA MESMA resposta.`;
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
          return indeterminado;
        }
        throw err;
      }
      if (!resultado.liberado) {
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
        resposta.instrucao = `Responda EXATAMENTE neste modelo: "Prontinho, ${nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das ${noturno.retornoAs}. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?" — e chame concluir_triagem para o Financeiro NA MESMA resposta (motivo "Desbloqueio em confiança" se existir).`;
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
    descricao: 'Lê o último comprovante de pagamento (imagem) que o cliente enviou nesta conversa e confere valor, data e favorecido contra as faturas em aberto. Só no modo noturno. Use antes de qualquer desbloqueio em confiança motivado por comprovante.',
    parametros: { type: 'object', properties: {} },
    validar() { return { ok: true, args: {} }; },
    async executar(args, contexto) {
      if (!perfilTriagem(contexto)) return erro('analisar_comprovante is only available during AI triage');
      if (!noturnoDoContexto(contexto)) return { analisado: false, motivo: 'Leitura de comprovante só no modo noturno.' };

      const imagem = await findLatestInboundImage(contexto.conversationId, { withinMs: 24 * 60 * 60 * 1000 });
      if (!imagem) return { analisado: false, motivo: 'Nenhuma imagem recebida do cliente nas últimas 24 horas.' };
      // MIME e tamanho são conferidos ANTES de qualquer leitura do disco: o que
      // sai daqui para a OpenAI é só imagem, e só imagem pequena.
      if (!MIMES_COMPROVANTE.includes(imagem.mediaMimeType)) {
        return { analisado: false, motivo: 'A última imagem não está num formato que dá para ler (use JPG, PNG ou WEBP).' };
      }
      let buffer;
      try {
        const caminho = getMediaFilePath(imagem.mediaPath);
        const info = await fs.promises.stat(caminho);
        if (info.size > TAMANHO_MAXIMO_COMPROVANTE) return { analisado: false, motivo: 'A imagem é grande demais para ler (limite 5 MB).' };
        buffer = await fs.promises.readFile(caminho);
      } catch (err) {
        // O caminho do arquivo não entra no log nem na resposta.
        console.error(`analisar_comprovante: arquivo indisponível na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
        return { analisado: false, motivo: 'Não foi possível abrir a imagem.' };
      }

      const config = await getAiConfig();
      let leitura;
      try {
        leitura = await analyzeImage({ apiKey: config.apiKey, model: config.model, imageBuffer: buffer, mimeType: imagem.mediaMimeType, prompt: PROMPT_VISAO });
      } catch (err) {
        console.error(`analisar_comprovante: visão falhou na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
        return { analisado: false, motivo: 'Não foi possível ler a imagem agora.' };
      }

      // Faturas em aberto de TODOS os contratos: o comprovante pode ser do outro ponto.
      const contratos = contexto.contracts || [];
      const segundasVias = await Promise.allSettled(contratos.map((c) => sgpClient.getDuplicateInvoice(c.id)));
      const faturas = [];
      segundasVias.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value && r.value.hasOpenInvoice) {
          for (const d of r.value.duplicates) faturas.push({ id: d.id, value: d.value, dueDate: d.dueDate, contratoId: contratos[i].id });
        }
      });
      // O SGP fora do ar aqui não pode derrubar a ferramenta: a chamada de
      // visão já foi paga, e sem o nome cadastrado a conferência ainda
      // funciona com 'DW' — só fica mais estrita.
      let merchant = null;
      try {
        merchant = await sgpClient.getPixMerchant();
      } catch (err) {
        console.error(`analisar_comprovante: recebedor PIX indisponível na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
      }
      const nomesAceitos = ['DW', ...(merchant && merchant.name ? [merchant.name] : [])];
      const conferencia = conferirComprovante({ leitura, faturas, nomesAceitos });
      const fatura = conferencia.faturaId ? faturas.find((f) => f.id === conferencia.faturaId) : null;
      const resultado = { analisado: true, ...conferencia, contratoId: fatura ? fatura.contratoId : null };
      // O veredito fica no contexto do turno para o desbloqueio em confiança
      // poder consultá-lo sem reler a imagem.
      contexto.comprovante = { valido: conferencia.valido, contratoId: resultado.contratoId, faturaId: conferencia.faturaId, valor: conferencia.valor, data: conferencia.data, tipo: conferencia.tipo, motivos: conferencia.motivos };
      return resultado;
    },
  },
  {
    nome: 'confirmar_nascimento',
    categoria: 'CONSULTA',
    descricao: 'Confirma a identidade de um cliente identificado por CPF digitado, comparando a data de nascimento que ele informou. Use SÓ quando o contexto disser que a identificação por CPF ainda não foi confirmada; se o contexto disser que a identidade já está confirmada (telefone ou memória), NÃO use e não peça a data. No máximo duas tentativas por atendimento.',
    isentoDeProprietario: true,
    parametros: { type: 'object', properties: { data: { type: 'string', description: 'Data informada pelo cliente, ex.: 20/05/1990' } }, required: ['data'] },
    validar(args) {
      if (typeof (args && args.data) !== 'string' || !args.data.trim()) return erro('data is required');
      return { ok: true, args: { data: args.data.trim() } };
    },
    async executar(args, contexto) {
      const id = contexto.identidade;
      // Identidade já forte (telefone, memória ou já confirmada): não há o que
      // confirmar. Em código, e não só no prompt — foi o modelo desobedecer o
      // prompt que fez um cliente identificado pelo telefone ser cobrado da
      // data. Não conta tentativa nem sobrescreve a origem.
      if (id && id.nivel === 'forte') return { confirmado: true, jaConfirmada: true, instrucao: 'A identidade já estava confirmada; não pergunte a data de nascimento. Siga o atendimento.' };
      // Defeito B: o retorno seco ("Não há data de nascimento no cadastro")
      // fazia o modelo encaminhar em silêncio, logo depois de o cliente ter
      // informado a data. A instrução diz o que falar E o que chamar na mesma
      // resposta.
      if (!id || !id.dataNascimento) {
        return {
          confirmado: false,
          semDataNoCadastro: true,
          motivo: 'O cadastro não tem data de nascimento para conferir.',
          instrucao: 'Diga ao cliente que não foi possível confirmar a identidade pelo chat e chame concluir_triagem para o Financeiro na mesma resposta, sem entregar dados.',
        };
      }
      // O limite de tentativas é por conversa, gravado no banco — não no
      // objeto de identidade em memória, que zera a cada turno e também com
      // esquecer_identificacao. Sem isso, o cliente podia tentar de novo só
      // chamando esquecer_identificacao e buscar_cliente outra vez.
      const tentativas = await incrementBirthdateAttempts(contexto.conversationId);
      // tentativas === 0 significa que a conversa não foi encontrada (a
      // função devolve 0 nesse caso) — falha fechado: sem contador
      // confiável, não há como saber se o limite já estourou, então trata
      // como recusa em vez de deixar passar (0 > 2 é falso).
      if (tentativas === 0 || tentativas > 2) {
        return {
          confirmado: false,
          motivo: tentativas === 0
            ? 'Não foi possível registrar a tentativa. Encaminhe sem entregar dados.'
            : 'Limite de tentativas de confirmação atingido. Encaminhe sem entregar dados.',
        };
      }
      const informada = normalizarDataNascimento(args.data);
      if (informada && informada === id.dataNascimento) {
        id.nivel = 'forte';
        id.origem = 'cpf_confirmed';
        // Só agora, com a confirmação batida, o vínculo do contato é
        // persistido — antes disso (buscar_cliente) a identidade era só
        // FRACA e não podia vazar como memória para o próximo turno.
        await setContactSgpLink(contexto.contact.id, {
          sgpClientId: id.client.id,
          sgpContractId: id.contracts.length === 1 ? id.contracts[0].id : null,
          sgpDocument: id.client.document,
          // O nome guardado no contato é o que salva o cumprimento quando o
          // SGP não responder no próximo atendimento.
          sgpFirstName: primeiroNome(id.primeiroNome),
        });
        contexto.contact.sgpDocument = id.client.document;
        // Com o vínculo gravado, o endereço do contrato pode preencher a
        // cidade do contato. Try/catch pelo mesmo motivo do bloco abaixo: a
        // confirmação já está persistida e não pode virar recusa por causa de
        // um campo acessório.
        try {
          await preencherCidadePeloSgp(contexto.contact, id.contracts);
          // Com a cidade recém-descoberta, o aviso de falha regional sai neste
          // mesmo turno — quem já recebeu não recebe de novo.
          await enviarAvisoDeCidadeSePreciso({
            contact: contexto.contact,
            conversationId: contexto.conversationId,
            channelId: contexto.channelId,
          });
        } catch (err) {
          console.error(`City autofill failed for contact ${contexto.contact.id}: ${mensagemSegura(err)}`);
        }
        // Confirmada: a identidade passa a viver no vínculo do contato, então
        // o CPF pendente não é mais necessário na conversa. Try/catch porque a
        // confirmação (setContactSgpLink acima) já está persistida: um resto
        // na coluna é inofensivo (a memória tem precedência no resolvedor) e
        // não pode transformar uma confirmação bem-sucedida em recusa.
        try {
          await setTriagePendingDocument(contexto.conversationId, null);
        } catch (err) {
          console.error(`Failed to clear the pending triage document for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
        }
        // Só agora os contratos chegam ao modelo, e com o ENDEREÇO — que é o
        // que o cliente reconhece. O número continua existindo só para as
        // ferramentas.
        return {
          confirmado: true,
          contratos: id.contracts.map((c) => {
            const n = normalizeContract(c);
            return { id: c.id, status: n.status, endereco: n.endereco };
          }),
          instrucao: 'Identidade confirmada. Siga com o pedido. Com um contrato só, use-o sem perguntar; com vários, pergunte pelo endereço.',
        };
      }
      // Ainda há uma tentativa (o teto é 2): pedir a data de novo é melhor do
      // que encaminhar quem só errou de digitar. Na última, encaminha.
      if (tentativas < 2) {
        return {
          confirmado: false,
          tentativasRestantes: 2 - tentativas,
          instrucao: 'Diga que a data não confere e peça a data de nascimento mais uma vez.',
        };
      }
      return {
        confirmado: false,
        instrucao: 'Diga que não foi possível confirmar a identidade e chame concluir_triagem para o Financeiro na mesma resposta, sem entregar dados.',
      };
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
      contexto.identidade = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, dataNascimento: null, contestado: true, nascimentoTentado: false };
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
      // Try/catch PRÓPRIO, e não junto do de cima: depois de buscar_cliente o
      // CPF pendente É a identidade inteira. Se a falha de markPhoneContested
      // levasse esta limpeza junto, o CPF que o cliente acabou de descartar
      // ressuscitaria como identidade fraca no turno seguinte — exatamente o
      // que esquecer_identificacao existe para desfazer.
      try {
        await setTriagePendingDocument(contexto.conversationId, null);
      } catch (err) {
        console.error(`Failed to clear the pending triage document for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
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
    parametros: { type: 'object', properties: { contratoId: { type: 'integer' } }, required: ['contratoId'] },
    validar: validarContratoId,
    async executar(args, contexto) {
      // Fora da triagem não há confirmar_nascimento no meio do caminho, nem
      // instrução para o modelo saber quando é seguro entregar — enviar_boleto
      // EXECUTA (entrega um arquivo real ao cliente), então não é uma
      // ferramenta de assistente/humano-no-comando. perfilTriagem (não só
      // contexto.identidade) para não reabrir com um identidade: null bugado.
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
      const primeira = busca.resultado.duplicates[0];
      const contratoUsado = busca.trocouContrato
        ? { contratoId: busca.contratoId, endereco: busca.endereco }
        : null;
      if (!primeira.boletoLink) return { enviado: false, motivo: 'Boleto sem link para download' };
      const buffer = await sgpClient.downloadBoletoPdf(primeira.boletoLink);
      const mediaPath = await saveMediaFile(buffer, '.pdf');

      // I1 (revisão final do branch inteiro): entre o início deste turno (a
      // OpenAI, o download do PDF) e este ponto, um atendente humano pode ter
      // assumido a conversa, ou ela pode ter sido fechada/silenciada — sem
      // reler agora, o PDF sairia mesmo com um humano já no comando.
      if (await saiuDaTriagem(contexto.conversationId)) {
        return { enviado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' };
      }

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
      contexto.resolvidoPelaIa = true;
      // Mesma razão de gerar_pix: a flag persistida é o que autoriza
      // encerrar_atendimento num turno posterior à entrega.
      await markTriageResolvedByAi(contexto.conversationId);
      // contratoUsado só aparece quando a fatura veio de OUTRO contrato do
      // mesmo cliente — o modelo precisa dizer de qual endereço é o boleto.
      return {
        enviado: true,
        valor: primeira.value,
        vencimento: primeira.dueDate,
        linhaDigitavelEnviada,
        ...(contratoUsado ? { contratoUsado } : {}),
        instrucao: `O boleto já foi enviado ao cliente nesta conversa em PDF${linhaDigitavelEnviada ? ' e com a linha digitável em mensagem separada' : ''}. Responda sem emoji dizendo que enviou acima o boleto${contratoUsado ? ' referente ao contrato do endereço ' + contratoUsado.endereco : ''}, que é só pagar pelo aplicativo do banco${linhaDigitavelEnviada ? ' copiando a linha digitável' : ''} ou em qualquer lotérica, e que se tiver dificuldade é só avisar. NÃO repita a linha digitável nem o valor.`,
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
        resumo: { type: 'string', description: 'Resumo objetivo para o atendente: o que o cliente quer e o que já foi apurado.' },
        confianca: { type: 'number', description: 'Confiança na classificação, de 0 a 1.' },
      },
      required: ['setorId', 'resumo', 'confianca'],
    },
    validar(args) {
      const setorId = args && args.setorId;
      const motivoId = args && args.motivoId;
      const resumo = args && args.resumo;
      const confiancaBruta = args && args.confianca;
      if (typeof setorId !== 'string' || !UUID_PATTERN.test(setorId)) return erro('setorId must be a UUID');
      if (motivoId != null && (typeof motivoId !== 'string' || !UUID_PATTERN.test(motivoId))) return erro('motivoId must be a UUID or null');
      if (typeof resumo !== 'string' || !resumo.trim()) return erro('resumo is required');
      // Number(true) === 1: sem esta checagem de tipo, um booleano passava
      // pela validação de faixa (0 a 1) como se fosse confiança máxima.
      if (typeof confiancaBruta !== 'number' && typeof confiancaBruta !== 'string') return erro('confianca must be a number');
      const confianca = Number(confiancaBruta);
      if (!Number.isFinite(confianca) || confianca < 0 || confianca > 1) return erro('confianca must be between 0 and 1');
      return { ok: true, args: { setorId, motivoId: motivoId || null, resumo: resumo.trim(), confianca } };
    },
    async executar(args, contexto) {
      // I6 (revisão final do branch inteiro): mesma guarda de
      // esquecer_identificacao — concluir_triagem só existe para a
      // recepcionista da triagem, nunca para o assistente clássico.
      if (!perfilTriagem(contexto)) return erro('concluir_triagem is only available during AI triage');
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
      if (baixa && t.attempts < t.maxQuestions) {
        return { concluido: false, motivo: 'baixa_confianca', instrucao: 'Faça UMA pergunta curta de esclarecimento ao cliente e chame concluir_triagem de novo depois da resposta.' };
      }
      const id = contexto.identidade || { nivel: 'none', origem: 'none' };
      const identifiedBy = id.origem === 'none' ? 'none' : id.origem;
      const rotuloId = { memory: 'memória', phone: 'telefone', cpf: 'CPF (não confirmado)', cpf_confirmed: 'CPF + data de nascimento', none: 'não identificado' }[identifiedBy];
      const linhas = [
        `Setor: ${setor.name}`,
        `Motivo: ${motivo ? motivo.name : 'não definido'}`,
        `Cliente: ${id.nome || id.primeiroNome || 'não identificado'}${id.client ? ` (SGP ${id.client.id})` : ''}`,
        `Contratos: ${(contexto.contracts || []).map((c) => `${c.id} — ${c.address || 'sem endereço'}`).join('; ') || 'nenhum'}`,
        `Identificação: ${rotuloId}`,
        `Origem: ${contexto.origemMensagem || 'texto'}`,
        `Confiança: ${Math.round(args.confianca * 100)}%${baixa ? ' (BAIXA)' : ''}`,
      ];
      if (resolvidoPelaIa) linhas.push('Resolvido pela IA: boleto/PIX enviado — só confirmar.');
      if (Array.isArray(contexto.registroFerramentas) && contexto.registroFerramentas.length > 0) {
        linhas.push(`Ferramentas: ${contexto.registroFerramentas.map((r) => `${r.nome} → ${r.resultado}`).join('; ')}`);
      }
      linhas.push('', args.resumo);
      // Quem pega a conversa de manhã precisa ver, na PRIMEIRA linha, que ela
      // foi atendida sozinha de madrugada e a que horas.
      const noturno = noturnoDoContexto(contexto);
      if (noturno) {
        // O que a IA leu do comprovante e o que ela fez com o contrato sobem
        // para o topo do resumo, junto da marca do turno noturno: é disso que
        // depende a baixa do pagamento de manhã.
        const extras = [];
        const comp = contexto.comprovante;
        if (comp) {
          // Valor e data podem vir nulos da visão (Task 3). Nada de toFixed em
          // null: "R$ 0,00" faria o atendente dar baixa num valor inventado.
          const valor = comp.valor == null ? 'valor não lido' : `R$ ${Number(comp.valor).toFixed(2).replace('.', ',')}`;
          const data = comp.data ? formatarData(comp.data) : 'data não lida';
          const conferencia = comp.valido ? 'conferido' : `NÃO conferiu: ${(comp.motivos || []).join('; ')}`;
          extras.push(`Comprovante (visão): ${comp.tipo || 'outro'} ${valor} em ${data} — ${conferencia}${comp.faturaId ? `, fatura ${comp.faturaId}` : ''}${comp.contratoId ? ` do contrato ${comp.contratoId}` : ''}`);
        }
        const desbloqueio = contexto.desbloqueioResultado;
        if (desbloqueio) {
          extras.push(`Desbloqueio em confiança: ${desbloqueio.liberado
            ? (desbloqueio.dias ? `REALIZADO (${desbloqueio.dias} dias)` : 'REALIZADO (prazo não informado)')
            : `RECUSADO: ${desbloqueio.motivo}`}`);
        }
        if (comp || desbloqueio) extras.push('Pendente: conferir pagamento e dar baixa');
        linhas.unshift(`Modo noturno · ${horaDeSaoPaulo()}`, ...extras);
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
      if (Array.isArray(contexto.registroFerramentas) && contexto.registroFerramentas.length > 0) {
        linhas.push(`Ferramentas: ${contexto.registroFerramentas.map((r) => `${r.nome} → ${r.resultado}`).join('; ')}`);
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

module.exports = { listTools, findTool, toOpenAiTools, perfilTriagem };
