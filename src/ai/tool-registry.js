const sgpClient = require('../integrations/sgp-client');
const { normalizeContract, normalizeConnection, normalizeInvoices } = require('./sgp-normalizer');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const {
  setSuggestedReason, setConversationSector, concludeAiTriage, getConversationWithContact,
  incrementBirthdateAttempts,
} = require('../conversations/conversation.repository');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { avaliarElegibilidade, MENSAGENS: MENSAGENS_DESBLOQUEIO } = require('./trust-unlock-rules');
const { saveMediaFile } = require('../media/media-storage');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { primeiroNome } = require('./identity-resolver');
const { mensagemSegura } = require('./safe-error-log');

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

/** '20/05/1990', '20/5/90', '1990-05-20' → '1990-05-20'; senão null. */
function normalizarDataNascimento(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
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
      // CPFs até achar um que bata. Três distintos no mesmo turno é o teto;
      // o mesmo CPF repetido não conta.
      if (contexto.identidade) {
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
      if (contexto.identidade) {
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
        // As palavras do modelo vão direto ao cliente na triagem: nunca o
        // sobrenome completo nem o login PPPoE, só o que já se apresentaria
        // por telefone.
        return {
          cliente: { nome: primeiroNome(client.name) },
          contratos: contracts.map((c) => ({
            id: c.id, plano: c.plan, status: normalizeContract(c).status,
          })),
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
    // Mesma cadeia de até três chamadas ao SGP de gerar_segunda_via.
    timeoutMs: 40000,
    descricao: 'Gera o código PIX copia e cola da fatura em aberto do contrato.',
    chaveProprietario: 'contratoId',
    exigeIdentidadeForte: true,
    parametros: {
      type: 'object',
      properties: { contratoId: { type: 'integer' } },
      required: ['contratoId'],
    },
    validar: validarContratoId,
    async executar(args, contexto) {
      const result = await sgpClient.getDuplicateInvoice(args.contratoId);
      if (!result.hasOpenInvoice) return { sucesso: false, motivo: 'Nenhuma fatura em aberto' };
      const primeira = result.duplicates[0];
      const resposta = { sucesso: true, valor: primeira.value, vencimento: primeira.dueDate, pixCopiaCola: primeira.pixCode };
      if (contexto && contexto.identidade) contexto.resolvidoPelaIa = true;
      return resposta;
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
      if (resultado.dataPromessa) resposta.pagarAte = resultado.dataPromessa;
      // Sem prazo devolvido, o modelo não pode inventar um "uns 3 dias".
      if (resposta.dias == null && !resposta.pagarAte) resposta.prazoDesconhecido = true;
      return resposta;
    },
  },
  {
    nome: 'confirmar_nascimento',
    categoria: 'CONSULTA',
    descricao: 'Confirma a identidade do cliente identificado por CPF comparando a data de nascimento que ele informou. Use antes de entregar boleto ou PIX quando a identificação for por CPF. Uma tentativa só.',
    isentoDeProprietario: true,
    parametros: { type: 'object', properties: { data: { type: 'string', description: 'Data informada pelo cliente, ex.: 20/05/1990' } }, required: ['data'] },
    validar(args) {
      if (typeof (args && args.data) !== 'string' || !args.data.trim()) return erro('data is required');
      return { ok: true, args: { data: args.data.trim() } };
    },
    async executar(args, contexto) {
      const id = contexto.identidade;
      if (!id || !id.dataNascimento) return { confirmado: false, motivo: 'Não há data de nascimento no cadastro para confirmar. Encaminhe sem entregar dados.' };
      // O limite de tentativas é por conversa, gravado no banco — não no
      // objeto de identidade em memória, que zera a cada turno e também com
      // esquecer_identificacao. Sem isso, o cliente podia tentar de novo só
      // chamando esquecer_identificacao e buscar_cliente outra vez.
      const tentativas = await incrementBirthdateAttempts(contexto.conversationId);
      if (tentativas > 2) {
        return { confirmado: false, motivo: 'Limite de tentativas de confirmação atingido. Encaminhe sem entregar dados.' };
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
        });
        contexto.contact.sgpDocument = id.client.document;
        return { confirmado: true };
      }
      return { confirmado: false, motivo: 'Data não confere. Não entregue dados; encaminhe para o setor.' };
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
      contexto.identidade = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, dataNascimento: null, contestado: true, nascimentoTentado: false };
      contexto.contracts = [];
      if (contexto.contact) {
        contexto.contact.sgpDocument = null;
        contexto.contact.sgpClientId = null;
        contexto.contact.sgpContractId = null;
        await setContactSgpLink(contexto.contact.id, { sgpClientId: null, sgpContractId: null, sgpDocument: null });
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
      // Fora da triagem (contexto.identidade ausente) não há confirmar_nascimento
      // no meio do caminho, nem instrução para o modelo saber quando é seguro
      // entregar — enviar_boleto EXECUTA (entrega um arquivo real ao cliente),
      // então não é uma ferramenta de assistente/humano-no-comando.
      if (!contexto.identidade) return erro('enviar_boleto is only available during AI triage');
      const result = await sgpClient.getDuplicateInvoice(args.contratoId);
      if (!result.hasOpenInvoice) return { enviado: false, motivo: 'Nenhuma fatura em aberto' };
      const primeira = result.duplicates[0];
      if (!primeira.boletoLink) return { enviado: false, motivo: 'Boleto sem link para download' };
      const buffer = await sgpClient.downloadBoletoPdf(primeira.boletoLink);
      const mediaPath = await saveMediaFile(buffer, '.pdf');
      await enqueueOutboundMessage({
        conversationId: contexto.conversationId, channelId: contexto.channelId,
        content: null, messageType: 'document', mediaPath,
        mediaMimeType: 'application/pdf', mediaFilename: 'boleto.pdf', sentBy: 'ai',
      });
      contexto.resolvidoPelaIa = true;
      return { enviado: true, valor: primeira.value, vencimento: primeira.dueDate };
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
        `Cliente: ${id.primeiroNome || 'não identificado'}${id.client ? ` (SGP ${id.client.id})` : ''}`,
        `Contratos: ${(contexto.contracts || []).map((c) => `${c.id} — ${c.address || 'sem endereço'}`).join('; ') || 'nenhum'}`,
        `Identificação: ${rotuloId}`,
        `Origem: ${contexto.origemMensagem || 'texto'}`,
        `Confiança: ${Math.round(args.confianca * 100)}%${baixa ? ' (BAIXA)' : ''}`,
      ];
      if (contexto.resolvidoPelaIa) linhas.push('Resolvido pela IA: boleto/PIX enviado — só confirmar.');
      linhas.push('', args.resumo);
      const conversa = await concludeAiTriage(contexto.conversationId, {
        sectorId: setor.id, reasonId: motivo ? motivo.id : null, confidence: args.confianca,
        summary: linhas.join('\n'), identifiedBy, lowConfidence: baixa, resolvedByAi: Boolean(contexto.resolvidoPelaIa),
      });
      if (!conversa) return { concluido: false, motivo: 'A conversa já saiu da triagem (um atendente assumiu ou ela já foi concluída).' };
      const completa = await getConversationWithContact(contexto.conversationId);
      broadcast('queue:new', { conversation: completa, message: null });
      broadcastToDashboard('dashboard:conversation', { conversation: completa });
      contexto.triagemConcluida = { setor: setor.name };
      return { concluido: true, setor: setor.name, instrucao: `Responda ao cliente em uma frase: use o primeiro nome se souber, diga que o atendimento vai para o setor ${setor.name} e que um atendente continua daqui. Não faça mais perguntas.` };
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
