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
const {
  escopoValido, paraContexto, montarEscopo, comPendenciaDeAlvo, duvidaSemAutorizacao, CONTEXTO_SEM_AUTORIZACAO, esperadoDoEscopo,
} = require('./third-party-scope');
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
const comContratos = (e) => Boolean(e && Array.isArray(e.contratos) && e.contratos.length > 0);
const boletoEnviado = () => sgpClient.downloadBoletoPdf.mock.calls.map(([link]) => link);

// O que o worker faz a cada turno: carrega o escopo gravado (o que expirou não vale), aplica a
// intenção explícita da mensagem do cliente (resolverAlvoDoTurno) e monta o contexto novo.
// Quando a cliente pede a própria cobrança, o worker limpa o escopo gravado. Revisão da F2: a dúvida
// sobre o alvo (alvoPendente) é gravada no escopo — sem terceiro, num escopo pendente sem contrato.
// Terceira revisão: o escopo expirado COM dúvida não é limpo — vira a dúvida sem autorização (sem contrato).
let escopoPersistido = null;
let numeroDoTurno = 0;
function novoTurno(textoDoCliente, extra = {}) {
  const expiradoComDuvida = duvidaSemAutorizacao(escopoPersistido);
  if (!expiradoComDuvida && !escopoValido(escopoPersistido)) escopoPersistido = null;
  let carregado = escopoPersistido ? paraContexto(escopoPersistido) : null;
  if (expiradoComDuvida) carregado = { ...CONTEXTO_SEM_AUTORIZACAO };
  const alvo = resolverAlvoDoTurno({ terceiro: carregado, texto: textoDoCliente });
  let { terceiro } = alvo;
  if (alvo.voltarAoTitular) escopoPersistido = null;
  else if (alvo.alvoPendente !== ((carregado && carregado.alvoPendente) || null)) {
    escopoPersistido = comPendenciaDeAlvo(escopoPersistido || montarEscopo(null, [], new Date(), { pendente: true }), alvo.alvoPendente);
    terceiro = paraContexto(escopoPersistido);
  }
  numeroDoTurno += 1;
  return contextoDaFulana({ terceiro, alvoAmbiguo: alvo.alvoAmbiguo, messageId: `msg-${numeroDoTurno}`, ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
  armarSgp();
  getConversationWithContact.mockResolvedValue({ id: 'conv-fulana', status: 'waiting', triageState: 'pending', assignedAgentId: null });
  escopoPersistido = null;
  // Persistência do alvo (03/10/2026): a gravação condicional devolve se gravou; só `true` confirma.
  setThirdPartyScope.mockImplementation(async (_conversa, escopo) => { escopoPersistido = escopo; return true; });
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
    // Item 3 (07/10/2026): a 2ª via daqui é pedida sem gerar o PIX (ela entrega linha e link, não o PIX).
    expect(sgpClient.getDuplicateInvoice.mock.calls).toEqual([[N, { gerarPix: false }]]);
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
    expect(daFulana.instrucao).toMatch(/a própria cobrança ou a do titular localizado pelo CPF ou CNPJ já informado/);
    expect(daFulana.instrucao).not.toMatch(/a da outra pessoa/);
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

// F2 (30/09/2026): posse de coisa própria não é terceiro, e pessoa nova não se liga sozinha ao terceiro
// registrado. Executor e registro de ferramentas DE VERDADE; o que se confere é o contrato que sai.
describe('F2 — alvo pelo complemento do possessivo', () => {
  async function pedirBeltrana(texto = 'manda o pix da Beltrana') {
    const t = novoTurno(texto);
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    return t;
  }

  test.each([
    ['quero pagar o boleto da minha internet', 'enviar_boleto'],
    ['manda o pix da minha net', 'gerar_pix'],
    ['me manda a segunda via do meu contrato', 'enviar_boleto'],
  ])('identificada, "%s": sai a cobrança do contrato DELA, sem recusa por alvo', async (texto, ferramenta) => {
    const t = novoTurno(texto);
    const r = await executeTool(ferramenta, {}, t);
    expect(r.ok).toBe(true);
    if (ferramenta === 'gerar_pix') expect(pixEnviado()).toEqual(['PIX-FULANA']);
    else expect(boletoEnviado()).toEqual(['https://sgp/boleto/FULANA']);
    identidadeContinuaFulana(t);
  });

  test('pedido próprio e o modelo sugere o contrato de outra pessoa: recusado, nada sai', async () => {
    const t = novoTurno('quero pagar o boleto da minha internet');
    const r = await executeTool('enviar_boleto', { contratoId: N }, t);
    expect(r.motivo).toBe('contract_not_owned');
    expect(boletoEnviado()).toEqual([]);
  });

  test('terceiro registrado + "manda o boleto da minha internet": volta ao titular, o escopo é limpo e sai o contrato DELA', async () => {
    const t1 = await pedirBeltrana();
    await executeTool('gerar_pix', {}, t1);
    const t2 = novoTurno('manda o boleto da minha internet');
    expect(t2.terceiro).toBeNull();
    expect(escopoPersistido).toBeNull();
    const r = await executeTool('enviar_boleto', {}, t2);
    expect(r.ok).toBe(true);
    expect(boletoEnviado()).toEqual(['https://sgp/boleto/FULANA']);
  });

  test('volta ao titular e o modelo ainda manda o contrato da Beltrana: recusado', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('agora o pix da minha net');
    const r = await executeTool('gerar_pix', { contratoId: N }, t2);
    expect(r.motivo).toBe('contract_not_owned');
    expect(pixEnviado()).toEqual([]);
  });

  test('terceiro registrado + "manda o boleto também": continua a Beltrana, e o contrato DELA sugerido pelo modelo é recusado', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('manda o boleto também');
    const errado = await executeTool('enviar_boleto', { contratoId: L }, t2);
    expect(errado.motivo).toBe('financial_target_mismatch');
    const certo = await executeTool('enviar_boleto', {}, t2);
    expect(certo.ok).toBe(true);
    expect(boletoEnviado()).toEqual(['https://sgp/boleto/BELTRANA']);
  });

  // Decisão 4 do gerente: com a Beltrana registrada, "minha mãe" pode ser outra pessoa. Nada prova que
  // é a Beltrana, e nada autoriza voltar à Fulana: nenhuma cobrança sai, o escopo não é apagado e a
  // identidade de quem fala não muda.
  describe('possível terceiro diferente do registrado', () => {
    const naoVinculado = (r) => {
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe('financial_target_ambiguous');
      expect(r.detalhe).toBe('terceiro_nao_vinculado');
    };

    test('"manda o boleto da minha mãe": nada sai — nem da Beltrana, nem da Fulana — e a instrução pede o documento sem afirmar quem é a pessoa', async () => {
      await pedirBeltrana();
      const t2 = novoTurno('manda o boleto da minha mãe');
      const semContrato = await executeTool('enviar_boleto', {}, t2);
      const daBeltrana = await executeTool('gerar_pix', { contratoId: N }, t2);
      const daFulana = await executeTool('gerar_pix', { contratoId: L }, t2);
      for (const r of [semContrato, daBeltrana, daFulana]) naoVinculado(r);
      expect(semContrato.instrucao).toMatch(/NÃO envie nada/);
      expect(semContrato.instrucao).toMatch(/CPF ou CNPJ/);
      expect(semContrato.instrucao).toMatch(/mesmo que seja o mesmo já informado/);
      expect(semContrato.instrucao).toMatch(/Não diga que sabe quem é essa pessoa/);
      expect(semContrato.instrucao).not.toMatch(/mãe/);
      expect(pixEnviado()).toEqual([]);
      expect(boletoEnviado()).toEqual([]);
      expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
      identidadeContinuaFulana(t2);
    });

    test('"não" no turno seguinte continua sem vínculo; o documento da outra pessoa consultado libera só o contrato DELA', async () => {
      await pedirBeltrana();
      const t2 = novoTurno('manda o boleto da minha mãe');
      naoVinculado(await executeTool('enviar_boleto', {}, t2));

      const t3 = novoTurno('não');
      naoVinculado(await executeTool('gerar_pix', {}, t3));

      await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t3);
      const r = await executeTool('gerar_pix', {}, t3);
      expect(r.ok).toBe(true);
      expect(pixEnviado()).toEqual(['PIX-OUTRA']);
      expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [B] }));
      identidadeContinuaFulana(t3);
    });

    test('a própria cobrança pedida explicitamente continua valendo depois da pessoa nova', async () => {
      await pedirBeltrana();
      novoTurno('manda o boleto da minha mãe');
      const t3 = novoTurno('esquece, quero a minha fatura');
      expect(escopoPersistido).toBeNull();
      const r = await executeTool('enviar_boleto', {}, t3);
      expect(r.ok).toBe(true);
      expect(boletoEnviado()).toEqual(['https://sgp/boleto/FULANA']);
    });
  });

  test('documento de terceiro não encontrado + "então manda o da minha internet": volta ao titular, sem fallback antes disso', async () => {
    const t1 = novoTurno('manda o pix da minha mãe');
    await executeTool('buscar_cliente', { cpf: '99999999999', titularEOutraPessoa: true }, t1);
    const antes = await executeTool('gerar_pix', { contratoId: L }, novoTurno('manda o pix'));
    expect(antes.ok).toBe(false);
    expect(pixEnviado()).toEqual([]);

    const t3 = novoTurno('então manda o da minha internet');
    expect(t3.terceiro).toBeNull();
    const r = await executeTool('gerar_pix', {}, t3);
    expect(r.ok).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-FULANA']);
  });

  test('fragmento incompleto com a Beltrana registrada: nada sai, o escopo fica', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('manda o da minha');
    const r = await executeTool('gerar_pix', {}, t2);
    expect(r.motivo).toBe('financial_target_ambiguous');
    expect(r.detalhe).toBe('referencia_incompleta');
    expect(pixEnviado()).toEqual([]);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
  });
});

// Revisão gerencial da F2 (30/09/2026). Executor e registro de ferramentas DE VERDADE; o que se confere é o
// contrato que sai, o que é recusado, a instrução ao modelo e o escopo gravado.
describe('revisão da F2 — segurança do alvo', () => {
  async function pedirBeltrana(texto = 'manda o pix da Beltrana') {
    const t = novoTurno(texto);
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    return t;
  }
  const escopoDaBeltrana = () => expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));

  test('"vou pagar com o meu cartão": sai o PIX da Beltrana, nunca o da Fulana, e o escopo fica', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('vou pagar com o meu cartão');
    const r = await executeTool('gerar_pix', {}, t2);
    expect(r.ok).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
    escopoDaBeltrana();
    expect(escopoPersistido.alvoPendente).toBeUndefined();
  });

  test('"não quero a minha fatura": nada sai, e a dúvida fica gravada sem apagar a Beltrana', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('não quero a minha fatura');
    const semContrato = await executeTool('gerar_pix', {}, t2);
    const daFulana = await executeTool('gerar_pix', { contratoId: L }, t2);
    for (const r of [semContrato, daFulana]) {
      expect(r.motivo).toBe('financial_target_ambiguous');
      expect(r.detalhe).toBe('proprio_nao_afirmado');
    }
    expect(semContrato.instrucao).toMatch(/a própria cobrança ou a do titular localizado/);
    expect(pixEnviado()).toEqual([]);
    escopoDaBeltrana();
    expect(escopoPersistido.alvoPendente).toBe('proprio_nao_afirmado');

    // "o dela" resolve essa dúvida: aponta para o titular localizado.
    const t3 = novoTurno('então manda o dela');
    const r = await executeTool('gerar_pix', {}, t3);
    expect(r.ok).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
    expect(escopoPersistido.alvoPendente).toBeUndefined();
  });

  test('"agora é de outra pessoa": nada sai da Beltrana; 25 turnos depois continua travado; só o documento novo libera', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('agora é de outra pessoa');
    const r2 = await executeTool('gerar_pix', {}, t2);
    expect(r2.detalhe).toBe('terceiro_nao_vinculado');
    expect(escopoPersistido.alvoPendente).toBe('terceiro_nao_vinculado');

    // Mais de 20 mensagens depois: a dúvida vem do escopo, não do histórico lido.
    let t;
    for (let i = 0; i < 25; i += 1) t = novoTurno(i % 2 ? 'ok' : 'pode mandar');
    const r3 = await executeTool('gerar_pix', {}, t);
    expect(r3.detalhe).toBe('terceiro_nao_vinculado');
    expect(pixEnviado()).toEqual([]);

    await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
    const r4 = await executeTool('gerar_pix', {}, t);
    expect(r4.ok).toBe(true);
    expect(pixEnviado()).toEqual(['PIX-OUTRA']);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [B] }));
    expect(escopoPersistido.alvoPendente).toBeUndefined();
    identidadeContinuaFulana(t);
  });

  test('outra pessoa sem documento, sem terceiro: a dúvida é gravada e o próximo "pode mandar" não cobra a Fulana', async () => {
    const t1 = novoTurno('quero o boleto da minha mãe');
    expect((await executeTool('enviar_boleto', {}, t1)).detalhe).toBe('outra_pessoa_sem_documento');
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' }));

    const t2 = novoTurno('pode mandar');
    const r = await executeTool('enviar_boleto', {}, t2);
    expect(r.ok).toBe(false);
    expect(boletoEnviado()).toEqual([]);

    const t3 = novoTurno('na verdade é a minha fatura');
    expect(escopoPersistido).toBeNull();
    expect((await executeTool('enviar_boleto', {}, t3)).ok).toBe(true);
    expect(boletoEnviado()).toEqual(['https://sgp/boleto/FULANA']);
  });

  // Terceira revisão da F2 (30/09/2026): expiração encerra a autorização, não resolve a dúvida.
  describe('dúvida gravada e prazo vencido', () => {
    const vencidoComDuvida = () => comPendenciaDeAlvo(montarEscopo('Beltrana', [{ id: N }], new Date(Date.now() - 31 * 60 * 1000)), 'terceiro_nao_vinculado');

    test('"pode mandar": nada sai — nem o contrato vencido da Beltrana, nem o da Fulana — e a dúvida continua gravada', async () => {
      escopoPersistido = vencidoComDuvida();
      const antes = { ...escopoPersistido };
      const t = novoTurno('pode mandar');
      const semContrato = await executeTool('gerar_pix', {}, t);
      const daFulana = await executeTool('gerar_pix', { contratoId: L }, t);
      const vencido = await executeTool('gerar_pix', { contratoId: N }, t);
      for (const r of [semContrato, daFulana]) {
        expect(r.motivo).toBe('financial_target_ambiguous');
        expect(r.detalhe).toBe('terceiro_expirado');
      }
      expect(semContrato.instrucao).toMatch(/não vale mais/);
      expect(semContrato.instrucao).toMatch(/NÃO envie nada/);
      expect(vencido.ok).toBe(false);
      expect(pixEnviado()).toEqual([]);
      expect(escopoPersistido).toEqual(antes);
    });

    test('a afirmação da própria cobrança resolve: o escopo é limpo e só sai o da Fulana', async () => {
      escopoPersistido = vencidoComDuvida();
      const t = novoTurno('quero a minha fatura');
      expect(escopoPersistido).toBeNull();
      expect((await executeTool('gerar_pix', {}, t)).ok).toBe(true);
      expect(pixEnviado()).toEqual(['PIX-FULANA']);
    });

    test('o documento consultado resolve: só o contrato do titular consultado, com prazo novo e sem a dúvida', async () => {
      escopoPersistido = vencidoComDuvida();
      const t = novoTurno('o cpf dela é esse');
      await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
      expect((await executeTool('gerar_pix', { contratoId: N }, t)).ok).toBe(false);
      expect((await executeTool('gerar_pix', {}, t)).ok).toBe(true);
      expect(pixEnviado()).toEqual(['PIX-OUTRA']);
      expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [B] }));
      expect(escopoPersistido.alvoPendente).toBeUndefined();
      expect(escopoValido(escopoPersistido)).toBe(true);
      identidadeContinuaFulana(t);
    });

    test('vencido SEM dúvida: a regra de 25/09 continua — o escopo morre e volta ao titular', async () => {
      escopoPersistido = montarEscopo('Beltrana', [{ id: N }], new Date(Date.now() - 31 * 60 * 1000));
      const t = novoTurno('manda o pix');
      const r = await executeTool('gerar_pix', {}, t);
      expect(r.ok).toBe(true);
      expect(pixEnviado()).toEqual(['PIX-FULANA']);
    });
  });

  // Decisão gerencial (30/09/2026): o documento de terceiro não localizado também não se resolve pelo prazo.
  describe('documento de terceiro não localizado e prazo vencido', () => {
    async function naoLocalizadoVencido() {
      const t = novoTurno('o cpf é 44444444444');
      await executeTool('buscar_cliente', { cpf: '44444444444', titularEOutraPessoa: true }, t);
      expect(escopoPersistido).toEqual(expect.objectContaining({ nome: null, contratos: [], pendente: true }));
      expect(escopoPersistido.alvoPendente).toBeUndefined();
      escopoPersistido = { ...escopoPersistido, expiraEm: new Date(Date.now() - 60 * 1000).toISOString() };
    }

    test('"pode mandar": nada sai — nem da Fulana — e o pendente continua gravado, sem prazo novo', async () => {
      await naoLocalizadoVencido();
      const antes = { ...escopoPersistido };
      const t = novoTurno('pode mandar');
      const semContrato = await executeTool('gerar_pix', {}, t);
      const daFulana = await executeTool('gerar_pix', { contratoId: L }, t);
      for (const r of [semContrato, daFulana]) {
        expect(r.motivo).toBe('financial_target_ambiguous');
        expect(r.detalhe).toBe('terceiro_expirado');
      }
      expect(pixEnviado()).toEqual([]);
      expect(escopoPersistido).toEqual(antes);
    });

    test('a própria cobrança pedida explicitamente: o escopo é limpo e só sai o contrato da Fulana', async () => {
      await naoLocalizadoVencido();
      const t = novoTurno('quero a minha fatura');
      expect(escopoPersistido).toBeNull();
      expect((await executeTool('gerar_pix', { contratoId: N }, t)).ok).toBe(false);
      expect((await executeTool('gerar_pix', {}, t)).ok).toBe(true);
      expect(pixEnviado()).toEqual(['PIX-FULANA']);
    });

    test('documento de terceiro localizado depois: só o contrato consultado, escopo novo e válido', async () => {
      await naoLocalizadoVencido();
      const t = novoTurno('o cpf certo é esse');
      await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
      expect((await executeTool('gerar_pix', { contratoId: L }, t)).ok).toBe(false);
      expect((await executeTool('gerar_pix', {}, t)).ok).toBe(true);
      expect(pixEnviado()).toEqual(['PIX-BELTRANA']);
      expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
      expect(escopoValido(escopoPersistido)).toBe(true);
      identidadeContinuaFulana(t);
    });
  });

  // Falha de gravação dentro da consulta do documento (30/09/2026): o pendente é gravado ANTES de consultar o SGP.
  describe('falha de gravação dentro da consulta do documento', () => {
    const falhaNaGravacao = (criterio) => {
      let usada = false;
      setThirdPartyScope.mockImplementation(async (_conversa, escopo) => {
        if (!usada && criterio(escopo)) { usada = true; throw new Error('banco fora'); }
        escopoPersistido = escopo;
        return true;
      });
    };
    const PENDENTE = expect.objectContaining({ nome: null, contratos: [], pendente: true });
    let silencio;
    beforeEach(() => { silencio = jest.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => silencio.mockRestore());

    test('o pendente sem contrato é gravado antes de consultar o SGP; no sucesso, o escopo consultado o substitui', async () => {
      const t = novoTurno('22222222222');
      await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
      expect(setThirdPartyScope.mock.calls[0][1]).toEqual(PENDENTE);
      expect(setThirdPartyScope.mock.invocationCallOrder[0]).toBeLessThan(sgpClient.lookupClientByCpf.mock.invocationCallOrder[0]);
      expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
      expect(t.alvoTerceiroNaoGravado).toBe(false);
    });

    test('a gravação prévia falhou: o SGP não é consultado, nada sai no turno e o worker é avisado', async () => {
      escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
      falhaNaGravacao(() => true);
      const t = novoTurno('33333333333');
      const r = await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
      expect(r).toEqual(expect.objectContaining({ ok: false, motivo: 'execution_error', detalhe: 'third_party_scope_not_stored' }));
      expect(sgpClient.lookupClientByCpf).not.toHaveBeenCalled();
      expect(t.alvoTerceiroNaoGravado).toBe(true);
      for (const args of [{}, { contratoId: N }, { contratoId: L }]) expect((await executeTool('gerar_pix', args, t)).ok).toBe(false);
      expect(pixEnviado()).toEqual([]);
    });

    test('a gravação final falhou (documento localizado): fica o pendente — nem o terceiro anterior, nem o titular', async () => {
      escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
      falhaNaGravacao(comContratos);
      const t = novoTurno('33333333333');
      const r = await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
      expect(r.detalhe).toBe('third_party_scope_not_stored');
      expect(escopoPersistido).toEqual(PENDENTE);
      expect(t.alvoTerceiroNaoGravado).toBe(false);
      for (const args of [{}, { contratoId: N }, { contratoId: B }, { contratoId: L }]) expect((await executeTool('gerar_pix', args, t)).ok).toBe(false);

      const seguinte = novoTurno('pode mandar');
      for (const args of [{}, { contratoId: N }, { contratoId: B }, { contratoId: L }]) expect((await executeTool('gerar_pix', args, seguinte)).ok).toBe(false);
      expect(pixEnviado()).toEqual([]);
    });

    test('documento não localizado: uma gravação só (a prévia), sem prazo novo', async () => {
      const t = novoTurno('44444444444');
      await executeTool('buscar_cliente', { cpf: '44444444444', titularEOutraPessoa: true }, t);
      expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
      expect(escopoPersistido).toEqual(PENDENTE);
    });

    test('depois de uma prévia que falhou, uma consulta que grava no mesmo turno tira o aviso ao worker', async () => {
      falhaNaGravacao(() => true);
      const t = novoTurno('33333333333');
      await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
      expect(t.alvoTerceiroNaoGravado).toBe(true);
      await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
      expect(t.alvoTerceiroNaoGravado).toBe(false);
      expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
    });

    // MUDANÇA DELIBERADA (03/10/2026, separação identificar × escolher): antes, o próprio documento depois de uma
    // prévia que falhou voltava ao titular e tirava o aviso. Agora, com o pedido de terceiro pendente, ele só
    // identifica quem fala: o aviso continua (o worker grava o pendente) e nada é cobrado no turno.
    test('depois de uma prévia que falhou, o próprio documento só identifica: o aviso continua e nenhuma cobrança sai', async () => {
      falhaNaGravacao(() => true);
      const t = novoTurno('33333333333');
      await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
      expect(t.alvoTerceiroNaoGravado).toBe(true);
      await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
      expect(t.alvoTerceiroNaoGravado).toBe(true);
      expect(t.identidade.client.document).toBe(CPF_FULANA);
      for (const args of [{}, { contratoId: L }, { contratoId: B }]) expect((await executeTool('gerar_pix', args, t)).ok).toBe(false);
      expect(pixEnviado()).toEqual([]);
    });
  });

  test('escopo que não pôde ser lido: nenhuma cobrança sai, e a instrução não finge que enviou', async () => {
    const t = contextoDaFulana({ alvoAmbiguo: 'escopo_nao_lido' });
    const r = await executeTool('enviar_boleto', {}, t);
    expect(r.motivo).toBe('financial_target_ambiguous');
    expect(r.detalhe).toBe('escopo_nao_lido');
    expect(r.instrucao).toMatch(/Não foi possível confirmar agora de quem é a cobrança/);
    expect(r.instrucao).toMatch(/não diga que enviou/);
    expect(boletoEnviado()).toEqual([]);
  });

  // Segunda revisão: a transição de alvo não foi gravada — nem a pessoa de antes, nem a nova valem.
  test('transição não gravada: nenhuma cobrança sai, nem pelo contrato anterior, e a instrução não finge que enviou', async () => {
    await pedirBeltrana();
    const t = contextoDaFulana({ terceiro: paraContexto(escopoPersistido), alvoAmbiguo: 'transicao_nao_gravada' });
    const semContrato = await executeTool('gerar_pix', {}, t);
    const daBeltrana = await executeTool('gerar_pix', { contratoId: N }, t);
    const daFulana = await executeTool('gerar_pix', { contratoId: L }, t);
    for (const r of [semContrato, daBeltrana, daFulana]) {
      expect(r.motivo).toBe('financial_target_ambiguous');
      expect(r.detalhe).toBe('transicao_nao_gravada');
    }
    expect(semContrato.instrucao).toMatch(/Não foi possível confirmar agora de quem é a cobrança/);
    expect(pixEnviado()).toEqual([]);
  });

  test('contrato errado sugerido pelo modelo com a Beltrana registrada: recusado, e a instrução não oferece "a da outra pessoa"', async () => {
    await pedirBeltrana();
    const t2 = novoTurno('boleto também');
    const r = await executeTool('enviar_boleto', { contratoId: L }, t2);
    expect(r.motivo).toBe('financial_target_mismatch');
    expect(r.instrucao).not.toMatch(/a da outra pessoa/);
    expect(r.instrucao).toMatch(/a do titular localizado/);
  });
});

// Persistência do alvo (03/10/2026): as gravações do escopo pelas ferramentas exigem o estado que o turno conhece
// (contexto.esperadosDoAlvo). Aqui a gravação aplica a mesma condição de conversation.repository.js sobre o escopo
// em memória, e devolve se gravou.
describe('persistência do alvo: gravação condicional nas ferramentas (03/10/2026)', () => {
  const confere = (atual, condicao) => {
    const esperados = (condicao.esperados || []).filter(Boolean);
    if (atual === null) return Boolean(condicao.aceitaNulo) || esperados.some((e) => e.nulo === true);
    return esperados.some((e) => (typeof e.marca === 'string' && atual.marca === e.marca)
      || (e.legado && JSON.stringify(e.legado) === JSON.stringify(atual)));
  };
  const gravarComCondicao = () => setThirdPartyScope.mockImplementation(async (_conversa, escopo, condicao) => {
    if (condicao && !confere(escopoPersistido, condicao)) return false;
    escopoPersistido = escopo;
    return true;
  });
  /** O turno como o worker o monta: com o estado do escopo que ele leu. */
  const turnoComEstado = (texto) => {
    const t = novoTurno(texto);
    t.esperadosDoAlvo = [esperadoDoEscopo(escopoPersistido)];
    return t;
  };
  const nadaSai = async (t) => {
    for (const args of [{}, { contratoId: L }, { contratoId: N }, { contratoId: B }]) expect((await executeTool('gerar_pix', args, t)).ok).toBe(false);
  };
  let silencio;
  beforeEach(() => { silencio = jest.spyOn(console, 'error').mockImplementation(() => {}); gravarComCondicao(); });
  afterEach(() => silencio.mockRestore());

  test('o escopo consultado só é gravado por cima do pendente desta consulta: decisão mais nova no meio vence', async () => {
    const sgpReal = sgpClient.lookupClientByCpf.getMockImplementation();
    // Enquanto o SGP responde, outro processamento grava a volta ao titular.
    sgpClient.lookupClientByCpf.mockImplementation(async (cpf) => { escopoPersistido = null; return sgpReal(cpf); });
    const t = turnoComEstado('22222222222');
    const r = await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    expect(r.detalhe).toBe('third_party_scope_not_stored');
    expect(escopoPersistido).toBeNull();
    await nadaSai(t);
    expect(pixEnviado()).toEqual([]);
  });

  test('a volta pelo próprio documento não é gravada (erro): nem o terceiro anterior nem o titular no turno; o worker é avisado', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    setThirdPartyScope.mockImplementationOnce(async () => { throw new Error('banco fora'); });
    const r = await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(r.detalhe).toBe('third_party_scope_not_cleared');
    expect(t.voltaAoTitularNaoGravada).toBe(true);
    await nadaSai(t);
    expect(pixEnviado()).toEqual([]);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
    // A limpeza pode ter sido efetivada: a coluna vazia passa a ser esperada também (o worker regrava a volta).
    expect(t.esperadosDoAlvo).toEqual(expect.arrayContaining([{ nulo: true }]));
  });

  test('a volta pelo próprio documento encontra outro estado (mudou): a mesma trava, o mesmo aviso, e o estado novo fica', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    escopoPersistido = montarEscopo('Outra', [{ id: B }]);
    const r = await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(r.detalhe).toBe('third_party_scope_not_cleared');
    expect(t.voltaAoTitularNaoGravada).toBe(true);
    await nadaSai(t);
    expect(escopoPersistido.contratos).toEqual([B]);
  });

  test('a volta pelo próprio documento gravada: os avisos saem e só o contrato de quem fala vale', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(escopoPersistido).toBeNull();
    expect(t.voltaAoTitularNaoGravada).toBe(false);
    expect(t.esperadosDoAlvo).toEqual([{ nulo: true }]);
    expect((await executeTool('gerar_pix', { contratoId: N }, t)).ok).toBe(false);
    expect((await executeTool('gerar_pix', {}, t)).ok).toBe(true);
  });

  test('o pendente prévio efetivado com a resposta perdida entra nos estados esperados (a recuperação do worker o reconhece)', async () => {
    const t = turnoComEstado('22222222222');
    setThirdPartyScope.mockImplementationOnce(async (_conversa, escopo) => { escopoPersistido = escopo; throw new Error('resposta perdida'); });
    const r = await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    expect(r.detalhe).toBe('third_party_scope_not_stored');
    expect(sgpClient.lookupClientByCpf).not.toHaveBeenCalled();
    expect(t.alvoTerceiroNaoGravado).toBe(true);
    expect(t.esperadosDoAlvo).toEqual([{ nulo: true }, { marca: escopoPersistido.marca }]);
  });

  // Achados da revisão independente de 03/10/2026.
  test('achado 1: a volta pelo documento falha e uma gravação confirmada depois (consulta de terceiro) desliga o aviso', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    setThirdPartyScope.mockImplementationOnce(async () => { throw new Error('banco fora'); });
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(t.voltaAoTitularNaoGravada).toBe(true);
    await executeTool('buscar_cliente', { cpf: CPF_OUTRA, titularEOutraPessoa: true }, t);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [B] }));
    expect(t.voltaAoTitularNaoGravada).toBe(false);
  });

  test('achado 2: a falha da volta pelo documento trava o turno sem zerar a dúvida do turno', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    setThirdPartyScope.mockImplementationOnce(async () => { throw new Error('banco fora'); });
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(t.alvoTerceiro).toEqual({ contratos: [] });
    const comDuvida = turnoComEstado(CPF_FULANA);
    comDuvida.alvoAmbiguo = 'dois_lados';
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, comDuvida);
    expect(comDuvida.alvoAmbiguo).toBe('dois_lados');
  });

  test('achado 4: com dúvida ou pendente, o próprio documento só identifica — nada é gravado e nada sai', async () => {
    for (const estado of [
      { escopo: montarEscopo('Beltrana', [{ id: N }]), duvida: 'dois_lados' },
      { escopo: comPendenciaDeAlvo(montarEscopo('Beltrana', [{ id: N }]), 'terceiro_nao_vinculado'), duvida: false },
      { escopo: montarEscopo(null, [], new Date(), { pendente: true }), duvida: false },
    ]) {
      escopoPersistido = estado.escopo;
      const t = turnoComEstado(CPF_FULANA);
      if (estado.duvida) t.alvoAmbiguo = estado.duvida;
      setThirdPartyScope.mockClear();
      const r = await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
      expect(r.ok).toBe(true);
      expect(t.identidade.client.document).toBe(CPF_FULANA);
      expect(setThirdPartyScope).not.toHaveBeenCalled();
      expect(escopoPersistido).toBe(estado.escopo);
      expect(t.voltaAoTitularNaoGravada).toBeFalsy();
      await nadaSai(t);
    }
  });

  test('achado 3a: a consulta do próprio documento falha no SGP com terceiro no contexto: trava e avisa o worker', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    sgpClient.lookupClientByCpf.mockRejectedValueOnce(new Error('SGP fora'));
    const r = await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(r.ok).toBe(false);
    expect(t.consultaPropriaPendente).toBe(true);
    await nadaSai(t);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
  });

  test('achado 3a: sem terceiro no contexto, a identificação pelo próprio documento não trava nada', async () => {
    const t = turnoComEstado(CPF_FULANA);
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(t.consultaPropriaPendente).toBeFalsy();
    expect((await executeTool('gerar_pix', {}, t)).ok).toBe(true);
  });

  test('achado 3b: enquanto a gravação prévia não confirma, o aviso ao worker já vale (o executor pode desistir no meio)', async () => {
    const t = turnoComEstado('22222222222');
    let liberar;
    let avisoDuranteAGravacao = null;
    setThirdPartyScope.mockImplementationOnce(async (_conversa, escopo) => {
      avisoDuranteAGravacao = t.alvoTerceiroNaoGravado;
      await new Promise((r) => { liberar = r; setImmediate(r); });
      escopoPersistido = escopo;
      return true;
    });
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    expect(avisoDuranteAGravacao).toBe(true);
    expect(t.alvoTerceiroNaoGravado).toBe(false);
    expect(typeof liberar).toBe('function');
  });

  // Segurança final (03/10/2026, v2): a reserva da entrega leva a condição do alvo; com o alvo mudado, nada é enviado.
  test('a reserva leva os estados conhecidos pelo turno; com o alvo mudado, nada é enviado e o resto do turno trava', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado('pode mandar');
    claimDelivery.mockImplementationOnce(async () => ({ obtido: false, registro: null, alvoMudou: true }));
    const r = await executeTool('gerar_pix', { contratoId: N }, t);
    expect(claimDelivery.mock.calls[0][0].condicaoDoAlvo).toEqual({ esperados: [{ marca: escopoPersistido.marca }] });
    expect(r.ok).toBe(true);
    expect(r.resultado.instrucao).toMatch(/NÃO foi enviado/);
    expect(pixEnviado()).toEqual([]);
    expect(t.alvoMudouNaEntrega).toBe(true);
    await nadaSai(t);
  });

  test('falha fechado por construção: na triagem sem estados conhecidos, a reserva leva a condição vazia (recusa)', async () => {
    const t = novoTurno('pode mandar');
    delete t.esperadosDoAlvo;
    await executeTool('gerar_pix', { contratoId: L }, t);
    expect(claimDelivery.mock.calls[0][0].condicaoDoAlvo).toEqual({ esperados: [] });
  });

  // Ressalvas da segunda conferência (03/10/2026).
  test('ressalva: terceiro consultado neste turno e depois o próprio documento — o terceiro fica, e só ele pode ser cobrado', async () => {
    const t = turnoComEstado('22222222222');
    await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
    setThirdPartyScope.mockClear();
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(setThirdPartyScope).not.toHaveBeenCalled();
    expect(escopoPersistido).toEqual(expect.objectContaining({ contratos: [N] }));
    expect((await executeTool('gerar_pix', { contratoId: L }, t)).ok).toBe(false);
    expect((await executeTool('gerar_pix', { contratoId: N }, t)).ok).toBe(true);
  });

  test('ressalva 3a: o aviso da identificação própria continua até a volta pelo documento retornar', async () => {
    escopoPersistido = montarEscopo('Beltrana', [{ id: N }]);
    const t = turnoComEstado(CPF_FULANA);
    setThirdPartyScope.mockImplementationOnce(async () => { throw new Error('banco fora'); });
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(t.voltaAoTitularNaoGravada).toBe(true);
    expect(t.consultaPropriaPendente).toBe(true);
    const ok = turnoComEstado(CPF_FULANA);
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, ok);
    expect(ok.consultaPropriaPendente).toBe(false);
  });

  test('ressalva: dúvida só no turno, sem terceiro — a identificação não trava a dedução de contrato das outras ferramentas', async () => {
    const t = turnoComEstado(CPF_FULANA);
    t.alvoAmbiguo = 'dois_lados';
    await executeTool('buscar_cliente', { cpf: CPF_FULANA }, t);
    expect(t.alvoTerceiro == null).toBe(true);
    expect(t.alvoAmbiguo).toBe('dois_lados');
    await nadaSai(t);
  });

  test('sem estado conhecido (lista vazia): nenhuma gravação tem efeito e o SGP não é consultado com o documento', async () => {
    const t = novoTurno('22222222222');
    t.esperadosDoAlvo = [];
    const r = await executeTool('buscar_cliente', { cpf: CPF_BELTRANA, titularEOutraPessoa: true }, t);
    expect(r.detalhe).toBe('third_party_scope_not_stored');
    expect(sgpClient.lookupClientByCpf).not.toHaveBeenCalled();
    expect(escopoPersistido).toBeNull();
  });
});
