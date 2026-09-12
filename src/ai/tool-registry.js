const sgpClient = require('../integrations/sgp-client');
const { normalizeContract, normalizeConnection, normalizeInvoices } = require('./sgp-normalizer');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const { setSuggestedReason, setConversationSector } = require('../conversations/conversation.repository');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { avaliarElegibilidade, MENSAGENS: MENSAGENS_DESBLOQUEIO } = require('./trust-unlock-rules');

function erro(mensagem) {
  return { ok: false, erro: mensagem };
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
      const { client, contracts } = await sgpClient.lookupClientByCpf(args.cpf);
      await setContactSgpLink(contexto.contact.id, {
        sgpClientId: client.id,
        sgpContractId: contracts.length === 1 ? contracts[0].id : null,
        sgpDocument: args.cpf,
      });
      contexto.contracts = contracts;
      // Sem isto, o guard de "troca de cliente" do executor (que lê
      // contexto.contact.sgpDocument) nunca dispara dentro do mesmo turno:
      // duas chamadas com CPFs diferentes na mesma conversa passariam batidas.
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
      const resultados = await Promise.allSettled(
        contratos.map((c) => sgpClient.listInvoices(c.id))
      );
      return {
        contratos: contratos.map((c, i) => {
          const n = normalizeContract(c);
          const base = { contratoId: c.id, endereco: n.endereco, plano: n.plano, status: n.status };
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
    descricao: 'Gera a segunda via do boleto do contrato, com linha digitável e link.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args) {
      const result = await sgpClient.getDuplicateInvoice(args.contratoId);
      if (!result.hasOpenInvoice) return { temFaturaAberta: false, faturas: [] };
      return {
        temFaturaAberta: true,
        faturas: result.duplicates.map((d) => ({
          faturaId: d.id, vencimento: d.dueDate, valor: d.value,
          linhaDigitavel: d.barCode, linkBoleto: d.boletoLink,
        })),
      };
    },
  },
  {
    nome: 'gerar_pix',
    categoria: 'ACAO_SENSIVEL',
    descricao: 'Gera o código PIX copia e cola da fatura em aberto do contrato.',
    chaveProprietario: 'contratoId',
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args) {
      const result = await sgpClient.getDuplicateInvoice(args.contratoId);
      if (!result.hasOpenInvoice) return { sucesso: false, motivo: 'Nenhuma fatura em aberto' };
      const primeira = result.duplicates[0];
      return { sucesso: true, valor: primeira.value, vencimento: primeira.dueDate, pixCopiaCola: primeira.pixCode };
    },
  },
  {
    nome: 'desbloqueio_confianca',
    categoria: 'ACAO_SENSIVEL',
    descricao: 'Libera em confiança (promessa de pagamento) um contrato SUSPENSO por inadimplência, devolvendo a internet por alguns dias até o pagamento. Use só quando o cliente pedir a liberação e o contrato estiver suspenso. Regras da casa: uma liberação a cada 30 dias, e nunca se a liberação anterior não foi paga. Ao responder, informe o prazo devolvido pela ferramenta e que a fatura continua devida.',
    chaveProprietario: 'contratoId',
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

      const status = normalizeContract(contrato).status;
      // A DW não usa velocidade reduzida: só contrato suspenso é elegível.
      if (status !== 'suspenso') {
        return { liberado: false, motivo: `O contrato não está suspenso (status: ${status}). A liberação em confiança só se aplica a contrato suspenso.` };
      }

      // Uma tentativa por contrato por turno. Fecha duas brechas de uma vez:
      // o modelo pedir duas liberações na mesma rodada (as duas leriam o
      // histórico antes de qualquer registro), e o modelo insistir depois de
      // um resultado indeterminado. Síncrono até aqui de propósito — o
      // segundo executar só roda depois que o primeiro já marcou. Entre
      // conversas não há corrida: o worker da IA roda com concorrência 1.
      if (!contexto.desbloqueiosTentados) contexto.desbloqueiosTentados = new Set();
      if (contexto.desbloqueiosTentados.has(args.contratoId)) {
        return { liberado: false, motivo: 'A liberação deste contrato já foi tentada neste atendimento. Encaminhe para um atendente se precisar de nova verificação.' };
      }
      contexto.desbloqueiosTentados.add(args.contratoId);

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
        return resposta;
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
          return {
            liberado: null,
            indeterminado: true,
            motivo: 'Não foi possível confirmar se a liberação foi realizada. Diga ao cliente que a solicitação será verificada por um atendente e encaminhe.',
          };
        }
        throw err;
      }
      if (!resultado.liberado) return { liberado: false, motivo: resultado.motivo };

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
      // Sem prazo devolvido, o modelo não pode inventar um "uns 3 dias".
      if (resposta.dias == null) resposta.prazoDesconhecido = true;
      return resposta;
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

module.exports = { listTools, findTool, toOpenAiTools };
