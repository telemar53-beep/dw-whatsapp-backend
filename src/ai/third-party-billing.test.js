// Cobrança de TERCEIRO (caso de regressão sintético, 25/09/2026): a cliente Fulana, já identificada, informou o
// CPF da Beltrana e pediu o PIX dela — e a IA entregou o PIX da própria Fulana. Aqui o executor e
// o registro de ferramentas são os DE VERDADE; só o SGP, o envio e o banco são simulados.
// Documentos sintéticos.
jest.mock('../integrations/sgp-client');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../payments/payment-sender');
jest.mock('./billing-delivery.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../media/media-storage');
jest.mock('../realtime/socket-server');
jest.mock('./ai-config.repository');
jest.mock('../cities/contact-city.service');
jest.mock('../city-notices/city-notice.service');
jest.mock('./trust-unlock.repository');
jest.mock('../sectors/sector.repository');
jest.mock('../reasons/reason.repository');
jest.mock('./triage-close-reason');
jest.mock('../conversations/message.repository');
jest.mock('./openai-client');
jest.mock('../company/company-config.repository');
jest.mock('./receipt-usage.repository');
jest.mock('../plans/plan.repository');
jest.mock('../cities/city.repository');

const sgpClient = require('../integrations/sgp-client');
const { getConversationWithContact, setThirdPartyScope } = require('../conversations/conversation.repository');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { enviarPix, enviarBoleto } = require('../payments/payment-sender');
const { claimDelivery } = require('./billing-delivery.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');
const { executeTool } = require('./tool-executor');
const { escopoValido, paraContexto, montarEscopo } = require('./third-party-scope');
const { resolverAlvoDoTurno } = require('./financial-target');

// Regra financeira 0/1/2+ (25/09/2026): as ferramentas de cobrança leem os títulos do contrato
// (listAllInvoices) ANTES da 2ª via. Sem títulos vencidos = o fluxo de sempre, que é o que estes
// testes exercitam. Quem testa a regra em si é regra-financeira.test.js.
beforeEach(() => {
  sgpClient.listAllInvoices.mockResolvedValue({ faturas: [], total: 0, completo: true, motivo: null });
});

const CPF_FULANA = '11111111111';
const CPF_BELTRANA = '22222222222';
const CPF_OUTRA = '33333333333';
const L = 1001; // contrato da Fulana
const N = 2002; // contrato da Beltrana
const N2 = 2003; // segundo contrato da Beltrana
const B = 3003; // contrato de outra pessoa (terceiro B)

const fatura = (id, dono) => ({
  hasOpenInvoice: true,
  duplicates: [{ id: `F-${id}`, dueDate: '2026-09-10', value: 100, barCode: `LINHA-${dono}`, pixCode: `PIX-${dono}`, boletoLink: `https://sgp/boleto/${dono}` }],
});
const semFatura = { hasOpenInvoice: false, duplicates: [] };

let faturas;
function armarSgp({ contratosBeltrana = [{ id: N }], faturasPorContrato } = {}) {
  faturas = faturasPorContrato || { [L]: fatura(L, 'FULANA'), [N]: fatura(N, 'BELTRANA'), [N2]: fatura(N2, 'BELTRANA2'), [B]: fatura(B, 'OUTRA') };
  sgpClient.getDuplicateInvoice.mockImplementation(async (id) => faturas[id] || semFatura);
  sgpClient.lookupClientByCpf.mockImplementation(async (cpf) => {
    if (cpf === CPF_BELTRANA) return { client: { id: 'cli-n', name: 'Beltrana Rodrigues Dos Reis', document: CPF_BELTRANA }, contracts: contratosBeltrana };
    if (cpf === CPF_OUTRA) return { client: { id: 'cli-b', name: 'Beatriz Souza', document: CPF_OUTRA }, contracts: [{ id: B }] };
    if (cpf === CPF_FULANA) return { client: { id: 'cli-l', name: 'Fulana Silva', document: CPF_FULANA }, contracts: [{ id: L }] };
    throw new Error('Client not found');
  });
}

const TRIAGEM = ['buscar_cliente', 'gerar_pix', 'enviar_boleto', 'gerar_segunda_via', 'consultar_faturas'];
function contextoDaFulana(extra = {}) {
  return {
    conversationId: 'conv-fulana', channelId: 'ch-1', messageId: 'msg-1',
    contact: { id: 'ct-fulana', sgpDocument: CPF_FULANA },
    contracts: [{ id: L }],
    identidade: { nivel: 'forte', origem: 'cpf', primeiroNome: 'Fulana', contracts: [{ id: L }], client: { id: 'cli-l', document: CPF_FULANA }, contestado: false },
    terceiro: null,
    ferramentasPermitidas: TRIAGEM,
    registroFerramentas: [], sgpCache: {},
    ...extra,
  };
}

const pixEnviado = () => enviarPix.mock.calls.map(([a]) => a.fatura.pixCode);
const boletoEnviado = () => sgpClient.downloadBoletoPdf.mock.calls.map(([link]) => link);

// O que o worker faz a cada turno: carrega o escopo gravado (o que expirou não vale), aplica a
// intenção explícita da mensagem do cliente (resolverAlvoDoTurno) e monta o contexto novo.
// Quando a cliente pede a própria cobrança, o worker limpa o escopo gravado.
let escopoPersistido = null;
let numeroDoTurno = 0;
function novoTurno(textoDoCliente, extra = {}) {
  const carregado = escopoValido(escopoPersistido) ? paraContexto(escopoPersistido) : null;
  const alvo = resolverAlvoDoTurno({ terceiro: carregado, texto: textoDoCliente });
  if (alvo.voltarAoTitular) escopoPersistido = null;
  numeroDoTurno += 1;
  return contextoDaFulana({ terceiro: alvo.terceiro, alvoAmbiguo: alvo.alvoAmbiguo, messageId: `msg-${numeroDoTurno}`, ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
  armarSgp();
  getConversationWithContact.mockResolvedValue({ id: 'conv-fulana', status: 'waiting', triageState: 'pending', assignedAgentId: null });
  escopoPersistido = null;
  setThirdPartyScope.mockImplementation(async (_conversa, escopo) => { escopoPersistido = escopo; });
  let claim = 0;
  claimDelivery.mockImplementation(async () => ({ obtido: true, registro: { id: `claim-${++claim}` } }));
  enviarPix.mockResolvedValue(undefined);
  enviarBoleto.mockResolvedValue(undefined);
  enqueueOutboundMessage.mockResolvedValue({ id: 'out-1' });
  saveMediaFile.mockResolvedValue('boleto.pdf');
  sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('pdf'));
});

const identidadeContinuaFulana = (contexto) => {
  expect(contexto.identidade.primeiroNome).toBe('Fulana');
  expect(contexto.identidade.client.document).toBe(CPF_FULANA);
  expect(contexto.contracts).toEqual([{ id: L }]);
  expect(setContactSgpLink).not.toHaveBeenCalled();
};

describe('REGRESSÃO REAL — Fulana identificada pede o PIX da Beltrana', () => {
  test('"manda o pix" (sem contrato): sai o PIX da Beltrana, nunca o da Fulana; Fulana continua sendo Fulana', async () => {
    const contexto = contextoDaFulana();

    const busca = await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);
    expect(busca.ok).toBe(true);
    const pix = await executeTool('gerar_pix', {}, contexto);

    expect(pix.ok).toBe(true);
    expect(pix.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(N);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
    identidadeContinuaFulana(contexto);
  });

  test('o modelo esqueceu a marcação de terceiro: CPF diferente do titular da conversa vira pedido de terceiro (nunca troca a identidade)', async () => {
    const contexto = contextoDaFulana();

    const busca = await executeTool('buscar_cliente', { cpf: CPF_BELTRANA }, contexto);
    expect(busca.ok).toBe(true);
    expect(busca.resultado.titular).toBeDefined();
    const pix = await executeTool('gerar_pix', {}, contexto);

    expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
    expect(pix.resultado.enviado).toBe(true);
    identidadeContinuaFulana(contexto);
  });
});

describe('casos 1 a 12', () => {
  test('1. titular pede o próprio PIX: continua saindo o PIX dela', async () => {
    const contexto = contextoDaFulana();
    const pix = await executeTool('gerar_pix', {}, contexto);
    expect(pix.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-FULANA']);
  });

  test('3. terceiro + boleto: só o boleto da Beltrana', async () => {
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);
    const boleto = await executeTool('enviar_boleto', {}, contexto);
    expect(boleto.resultado.enviado).toBe(true);
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://sgp/boleto/BELTRANA');
    expect(enviarBoleto.mock.calls.map(([a]) => a.fatura.barCode)).toEqual(['LINHA-BELTRANA']);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
  });

  test('4. terceiro + segunda via: só a da Beltrana', async () => {
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);
    const via = await executeTool('gerar_segunda_via', {}, contexto);
    // O retorno de contrato de terceiro chega minimizado ao modelo ({ gerado }): a prova de
    // "só a Beltrana" é o SGP ter sido consultado SÓ no contrato dela.
    expect(via.ok).toBe(true);
    expect(via.resultado.gerado).toBe(true);
    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(N);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
  });

  test('5. CPF do terceiro não encontrado: nenhuma cobrança da Fulana sai, nem sem contrato nem com o dela', async () => {
    const contexto = contextoDaFulana();
    const busca = await executeTool('buscar_cliente', { cpf: '99999999999', titularEOutraPessoa: true }, contexto);
    expect(busca.ok).toBe(false);

    const semContrato = await executeTool('gerar_pix', {}, contexto);
    const comContratoDela = await executeTool('gerar_pix', { contratoId: L }, contexto);

    expect(semContrato.ok).toBe(false);
    expect(comContratoDela.ok).toBe(false);
    expect(comContratoDela.motivo).toBe('financial_target_mismatch');
    expect(enviarPix).not.toHaveBeenCalled();
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
    identidadeContinuaFulana(contexto);
  });

  test('6. terceiro encontrado sem fatura: não cai para a Fulana', async () => {
    armarSgp({ faturasPorContrato: { [L]: fatura(L, 'FULANA') } });
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);

    const pix = await executeTool('gerar_pix', {}, contexto);
    const insistindo = await executeTool('gerar_pix', { contratoId: L }, contexto);

    expect(pix.resultado.enviado).toBe(false); // retorno minimizado de terceiro
    expect(insistindo.motivo).toBe('financial_target_mismatch');
    expect(enviarPix).not.toHaveBeenCalled();
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
  });

  test('7. terceiro com dois contratos: sem escolha não deduz; nunca o contrato da Fulana; escolhe entre os dela', async () => {
    armarSgp({ contratosBeltrana: [{ id: N }, { id: N2 }] });
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);

    const semEscolha = await executeTool('gerar_pix', {}, contexto);
    const daFulana = await executeTool('gerar_pix', { contratoId: L }, contexto);
    const escolhido = await executeTool('gerar_pix', { contratoId: N2 }, contexto);

    expect(semEscolha.motivo).toBe('invalid_args');
    expect(daFulana.motivo).toBe('financial_target_mismatch');
    expect(escolhido.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA2']);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
  });

  test('8. depois da operação de terceiro, "agora quero ver minha fatura" volta à Fulana', async () => {
    const t1 = novoTurno('manda o pix da Beltrana');
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t1);
    await executeTool('gerar_pix', {}, t1);
    // No MESMO turno, o pedido continua sendo da Beltrana: nada da Fulana sai.
    expect((await executeTool('gerar_pix', { contratoId: L }, t1)).motivo).toBe('financial_target_mismatch');

    enviarPix.mockClear();
    const t2 = novoTurno('agora quero ver minha fatura');
    const minha = await executeTool('gerar_pix', {}, t2);
    expect(minha.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-FULANA']);
  });

  test('9. terceiro A e depois terceiro B: cada pedido isolado; B não reaproveita A', async () => {
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);
    await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, contexto);

    const deA = await executeTool('gerar_pix', { contratoId: N }, contexto);
    const deB = await executeTool('gerar_pix', {}, contexto);

    expect(deA.ok).toBe(false);
    expect(deB.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-OUTRA']);
  });

  test('9b. terceiro B não encontrado depois de A: nem A, nem a Fulana', async () => {
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);
    await executeTool('buscar_cliente', { cpf: '99999999999', titularEOutraPessoa: true }, contexto);

    expect((await executeTool('gerar_pix', { contratoId: N }, contexto)).ok).toBe(false);
    expect((await executeTool('gerar_pix', {}, contexto)).ok).toBe(false);
    expect(enviarPix).not.toHaveBeenCalled();
    // E o pedido de A não sobra para o próximo turno: foi trocado pelo pedido PENDENTE de B.
    expect(contexto.terceiro).toEqual({ nome: null, contratos: [], pendente: true });
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [], pendente: true }));
  });

  test.each(['gerar_pix', 'enviar_boleto', 'gerar_segunda_via'])('10. pedido de terceiro e %s com o contrato da Fulana: o gate bloqueia antes de tocar o SGP', async (nome) => {
    const contexto = contextoDaFulana();
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);

    const r = await executeTool(nome, { contratoId: L }, contexto);

    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('financial_target_mismatch');
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
    expect(enviarPix).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  // 11: a fatura que a busca devolveu tem de ser de um contrato do documento pedido. O SGP não
  // devolve o documento no título; o vínculo é o contrato — e se ele cair fora do alvo, nada sai.
  test.each(['gerar_pix', 'enviar_boleto', 'gerar_segunda_via'])('11. %s: fatura encontrada num contrato fora do alvo do terceiro não é enviada', async (nome) => {
    // Cenário forçado: o mesmo id aparece como próprio E de terceiro, e só o da Fulana tem fatura —
    // o fallback de faturaEmAlgumContrato trocaria para ele.
    armarSgp({ faturasPorContrato: { [L]: fatura(L, 'FULANA') } });
    const contexto = contextoDaFulana({ contracts: [{ id: L }, { id: N }] });
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);

    const r = await executeTool(nome, { contratoId: N }, contexto);

    expect(JSON.stringify(r)).not.toContain('FULANA');
    expect(enviarPix).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('12. só o CPF basta: sem pedir nascimento, endereço, telefone ou mãe — e quem fala nem precisa estar identificado', async () => {
    const contexto = contextoDaFulana({
      contact: { id: 'ct-x', sgpDocument: null }, contracts: [],
      identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, contestado: false },
    });
    const busca = await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, contexto);
    const pix = await executeTool('gerar_pix', {}, contexto);

    expect(JSON.stringify(busca)).not.toMatch(/nascimento|endere[cç]o|m[aã]e|telefone/i);
    expect(pix.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
  });
});

// Decisão do dono (25/09/2026): o alvo de TERCEIRO é GRUDENTO durante o contexto financeiro.
// Entregar, não ter fatura ou não achar o CPF NÃO o encerram. Só terminam: a intenção explícita
// da própria cobrança (sem pedir CPF), um novo CPF de terceiro, o prazo de 30 minutos, ou o
// encerramento/conclusão da conversa. Cada teste roda turno a turno, como o worker.
describe('alvo de terceiro grudento, turno a turno', () => {
  async function pedirBeltrana(texto = 'manda o pix da Beltrana') {
    const t = novoTurno(texto);
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    return t;
  }

  test('FLUXO COMPLETO: Fulana → PIX da Beltrana → boleto da Beltrana → "agora manda o meu pix" → PIX da Fulana, sem pedir o CPF dela', async () => {
    const t1 = await pedirBeltrana();
    await executeTool('gerar_pix', {}, t1);

    const t2 = novoTurno('manda o boleto também');
    await executeTool('enviar_boleto', {}, t2);

    const t3 = novoTurno('agora manda o meu pix');
    await executeTool('gerar_pix', {}, t3);

    expect(pixEnviado()).toEqual(['PIX-BELTRANA', 'PIX-FULANA']);
    expect(boletoEnviado()).toEqual(['https://sgp/boleto/BELTRANA']);
    expect(sgpClient.lookupClientByCpf).toHaveBeenCalledTimes(1); // só o CPF da Beltrana, nunca o da Fulana de novo
    expect(t3.identidade.primeiroNome).toBe('Fulana');
    expect(setContactSgpLink).not.toHaveBeenCalled();
  });

  test('1. PIX da Beltrana e depois "manda boleto também": boleto da Beltrana', async () => {
    const t1 = await pedirBeltrana();
    await executeTool('gerar_pix', {}, t1);
    const t2 = novoTurno('manda boleto também');
    const r = await executeTool('enviar_boleto', {}, t2);
    expect(r.resultado.enviado).toBe(true);
    expect(boletoEnviado()).toEqual(['https://sgp/boleto/BELTRANA']);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
  });

  test('2. boleto da Beltrana e depois "manda pix também": PIX da Beltrana', async () => {
    const t1 = await pedirBeltrana('manda o boleto da Beltrana');
    await executeTool('enviar_boleto', {}, t1);
    const t2 = novoTurno('manda pix também');
    const r = await executeTool('gerar_pix', {}, t2);
    expect(r.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
  });

  test('3. CPF do terceiro não encontrado e, no turno seguinte, "manda o pix": NÃO sai o PIX da Fulana', async () => {
    const t1 = novoTurno('manda o pix dela');
    await executeTool('buscar_cliente', { cpf: '99999999999', titularEOutraPessoa: true }, t1);

    const t2 = novoTurno('manda o pix');
    const semContrato = await executeTool('gerar_pix', {}, t2);
    const comOdaFulana = await executeTool('gerar_pix', { contratoId: L }, t2);

    expect(escopoPersistido).toEqual(expect.objectContaining({ pendente: true, contratos: [] }));
    expect(semContrato.ok).toBe(false);
    expect(comOdaFulana.motivo).toBe('financial_target_mismatch');
    expect(comOdaFulana.instrucao).toMatch(/conferir o número/);
    expect(enviarPix).not.toHaveBeenCalled();
  });

  test('4. terceiro sem fatura e, no turno seguinte, "manda boleto": não usa a Fulana', async () => {
    armarSgp({ faturasPorContrato: { [L]: fatura(L, 'FULANA') } });
    const t1 = await pedirBeltrana();
    await executeTool('gerar_pix', {}, t1);

    const t2 = novoTurno('manda boleto');
    const r = await executeTool('enviar_boleto', {}, t2);
    const insistindo = await executeTool('enviar_boleto', { contratoId: L }, t2);

    expect(r.resultado.enviado).toBe(false);
    expect(insistindo.motivo).toBe('financial_target_mismatch');
    expect(boletoEnviado()).toEqual([]);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(L);
  });

  test('5. terceiro e depois "agora quero minha fatura": muda para a Fulana e entrega a dela', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('agora quero minha fatura');
    const r = await executeTool('gerar_pix', {}, t2);
    expect(r.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-FULANA']);
    expect(escopoPersistido).toBeNull();
  });

  test('6. a volta ao titular NÃO pede o CPF da Fulana: nenhuma busca nova, e a recusa nunca manda pedir', async () => {
    const t1 = await pedirBeltrana();
    const recusa = await executeTool('gerar_pix', { contratoId: L }, t1);
    expect(recusa.instrucao).not.toMatch(/peça o CPF d(e|el)e quem|peça o CPF dele/i);
    expect(recusa.instrucao).toMatch(/NÃO peça o CPF de quem está falando/);

    sgpClient.lookupClientByCpf.mockClear();
    const t2 = novoTurno('manda o meu boleto');
    await executeTool('enviar_boleto', {}, t2);
    expect(sgpClient.lookupClientByCpf).not.toHaveBeenCalled();
    expect(boletoEnviado()).toEqual(['https://sgp/boleto/FULANA']);
  });

  test('7. Beltrana e depois o CPF da Maria: Maria substitui a Beltrana', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('agora a da Maria');
    await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t2);

    const daBeltrana = await executeTool('gerar_pix', { contratoId: N }, t2);
    const daMaria = await executeTool('gerar_pix', {}, t2);

    expect(daBeltrana.ok).toBe(false);
    expect(daMaria.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-OUTRA']);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [B] }));
  });

  test('8. terceiro ativo + pedido financeiro sem alvo explícito: continua o terceiro', async () => {
    const t1 = await pedirBeltrana();
    await executeTool('gerar_pix', {}, t1);
    const t2 = novoTurno('pode mandar de novo');
    await executeTool('gerar_pix', { reenviar: true }, t2);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA', 'PIX-BELTRANA']);
  });

  test('9. terceiro ativo + "manda o meu e o dela": nenhuma cobrança sai até esclarecer', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('manda o meu e o dela');
    const semContrato = await executeTool('gerar_pix', {}, t2);
    const daFulana = await executeTool('gerar_pix', { contratoId: L }, t2);
    const daBeltrana = await executeTool('enviar_boleto', { contratoId: N }, t2);

    for (const r of [semContrato, daFulana, daBeltrana]) {
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe('financial_target_ambiguous');
    }
    expect(daFulana.instrucao).toMatch(/Você quer a sua cobrança ou a da outra pessoa\?/);
    expect(enviarPix).not.toHaveBeenCalled();
    expect(boletoEnviado()).toEqual([]);
  });

  test('9b. sem terceiro + "manda o boleto da minha mãe" (sem CPF): o boleto da Fulana NÃO sai', async () => {
    const t1 = novoTurno('manda o boleto da minha mãe');
    const r = await executeTool('enviar_boleto', {}, t1);
    expect(r.motivo).toBe('financial_target_ambiguous');
    expect(boletoEnviado()).toEqual([]);
  });

  test('10. prazo de 30 minutos vencido: volta ao titular, o terceiro não fica para sempre', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }], new Date(Date.now() - 31 * 60 * 1000));
    const t = novoTurno('manda o pix');
    const r = await executeTool('gerar_pix', {}, t);
    expect(r.resultado.enviado).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-FULANA']);
  });
});
