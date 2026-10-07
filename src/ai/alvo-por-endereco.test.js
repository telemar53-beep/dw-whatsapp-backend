// Pedido por endereço (06/10/2026, noite; autorizado pelo proprietário). Integrado: a regra do alvo como o worker a aplica
// (resolverAlvoDasMensagens com os endereços dos contratos JÁ CONFIRMADOS do cliente), o executor e as ferramentas de
// cobrança reais; SGP, envio e banco simulados. O que se prova é o EFEITO: qual 2ª via foi pedida e o que foi enviado.
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
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { enviarPix, enviarBoleto } = require('../payments/payment-sender');
const { claimDelivery } = require('./billing-delivery.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');
const { executeTool } = require('./tool-executor');
const { resolverAlvoDasMensagens } = require('./financial-target');

const CPF_SICRANO = '12345678909';
const RUA = { id: 301, address: 'Rua de Teste, 300 - Bairro de Teste' };
const AVENIDA = { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' };
const RUA_500 = { id: 303, address: 'Rua de Teste, 500 - Bairro de Teste' };
const BELTRANA = { nome: 'Beltrana', contratos: [{ id: 501 }] };
const TRIAGEM = ['buscar_cliente', 'gerar_pix', 'enviar_boleto', 'gerar_segunda_via', 'consultar_faturas'];

const fatura = (id) => ({
  hasOpenInvoice: true,
  duplicates: [{ id: `F-${id}`, dueDate: '2026-10-10', value: 100, barCode: `LINHA-${id}`, pixCode: `PIX-${id}`, boletoLink: `https://sgp.invalido/boleto/${id}` }],
});
const semFatura = { hasOpenInvoice: false, duplicates: [] };
let faturas;
const viasPedidas = () => sgpClient.getDuplicateInvoice.mock.calls.map(([c]) => Number(c));
const pixEnviado = () => enviarPix.mock.calls.map(([a]) => a.fatura.pixCode);

let turnoN = 0;
// O que o worker faz: aplica a regra do alvo às falas com os endereços dos contratos confirmados e monta o contexto.
function turno(falas, { contratos = [RUA, AVENIDA], terceiro = null } = {}) {
  const alvo = resolverAlvoDasMensagens({ terceiro, textos: falas, enderecos: contratos });
  turnoN += 1;
  return {
    alvo,
    contexto: {
      conversationId: 'conv-sicrano', channelId: 'ch-1', messageId: `msg-${turnoN}`,
      contact: { id: 'ct-sicrano', sgpDocument: CPF_SICRANO },
      contracts: contratos.map((c) => ({ id: c.id, address: c.address })),
      identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'Sicrano', client: { id: 9003, document: CPF_SICRANO }, contestado: false },
      terceiro: alvo.terceiro, alvoAmbiguo: alvo.alvoAmbiguo, contratoEscolhido: alvo.contratoEscolhido || null,
      contratosEscolhidos: alvo.contratosEscolhidos || null,
      ferramentasPermitidas: TRIAGEM, registroFerramentas: [], sgpCache: {},
      falasDoCliente: ['manda o pix', ...falas], ultimaFalaDoCliente: falas[falas.length - 1],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  turnoN = 0;
  faturas = { 301: fatura(301), 302: fatura(302), 303: fatura(303), 501: fatura(501) };
  sgpClient.getDuplicateInvoice.mockImplementation(async (id) => faturas[id] || semFatura);
  sgpClient.listAllInvoices.mockResolvedValue({ faturas: [], total: 0, completo: true, motivo: null });
  sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('pdf'));
  getConversationWithContact.mockResolvedValue({ id: 'conv-sicrano', status: 'waiting', triageState: 'pending', assignedAgentId: null });
  let claim = 0;
  claimDelivery.mockImplementation(async () => ({ obtido: true, registro: { id: `claim-${++claim}` } }));
  enviarPix.mockResolvedValue(undefined);
  enviarBoleto.mockResolvedValue(undefined);
  enqueueOutboundMessage.mockResolvedValue({ id: 'out-1' });
  saveMediaFile.mockResolvedValue('boleto.pdf');
});

test('endereço de contrato do próprio cliente: só esse contrato é cobrado; o outro é recusado sem tocar no SGP', async () => {
  const { contexto } = turno(['manda o pix da Rua de Teste']);
  const errado = await executeTool('gerar_pix', { contratoId: 302 }, contexto);
  expect(errado).toMatchObject({ ok: false, motivo: 'financial_target_address_mismatch' });
  expect(errado.instrucao).toMatch(/contratoId 301/);
  expect(viasPedidas()).toEqual([]);
  const certo = await executeTool('gerar_pix', {}, contexto);
  expect(certo.ok).toBe(true);
  expect(viasPedidas()).toEqual([301]);
  expect(pixEnviado()).toEqual(['PIX-301']);
});

test('dois contratos na mesma rua, sem número: nada sai, a dúvida de qual é gravada, e a pergunta é de endereço (sem pedir documento)', async () => {
  const { alvo, contexto } = turno(['manda o pix da Rua de Teste'], { contratos: [RUA, RUA_500] });
  expect(alvo.gravar).toBe('criar');
  const r = await executeTool('gerar_pix', { contratoId: 301 }, contexto);
  expect(r).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
  expect(r.instrucao).toMatch(/bate com mais de um contrato dele/);
  expect(r.instrucao).toMatch(/ou ele disse que é a dele/);
  expect(r.instrucao).toMatch(/NÃO peça CPF nem CNPJ/);
  expect(viasPedidas()).toEqual([]);
  expect(pixEnviado()).toEqual([]);
});

test('rua que não é de contrato dele: dúvida de endereço gravada; a instrução pergunta o endereço sem pedir documento', async () => {
  const { alvo, contexto } = turno(['manda o pix da Rua Nova']);
  expect(alvo).toMatchObject({ alvoAmbiguo: 'endereco_desconhecido', gravar: 'criar' });
  expect(alvo.contratoEscolhido).toBeUndefined();
  const r = await executeTool('gerar_pix', {}, contexto);
  expect(r).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
  expect(r.instrucao).toMatch(/de qual endereço é a cobrança/);
  expect(r.instrucao).toMatch(/NÃO peça CPF ou CNPJ agora/);
  expect(r.instrucao).toMatch(/não diga que é de outra pessoa/);
  expect(viasPedidas()).toEqual([]);
});

test('a dúvida de endereço entre turnos: "pode mandar" e "obrigado" não liberam; a rua dele na resposta libera só esse contrato', async () => {
  const primeiro = turno(['manda o pix da Rua Nova']);
  let estado = primeiro.alvo.terceiro;
  for (const fala of ['pode mandar', 'obrigado']) {
    const t = turno([fala], { terceiro: estado });
    expect(t.alvo.alvoAmbiguo).toBe('endereco_desconhecido');
    for (const args of [{}, { contratoId: 301 }, { contratoId: 302 }]) {
      expect(await executeTool('gerar_pix', args, t.contexto)).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
    }
    estado = t.alvo.terceiro;
  }
  expect(viasPedidas()).toEqual([]);
  const resposta = turno(['é a da Rua de Teste'], { terceiro: estado });
  expect(resposta.alvo).toMatchObject({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '301' });
  expect((await executeTool('gerar_pix', { contratoId: 302 }, resposta.contexto)).motivo).toBe('financial_target_address_mismatch');
  const r = await executeTool('gerar_pix', {}, resposta.contexto);
  expect(r.ok).toBe(true);
  expect(pixEnviado()).toEqual(['PIX-301']);
});

test('a dúvida de endereço e o esclarecimento de que é de outra pessoa: seguem as regras de terceiro (pede o documento dela)', async () => {
  const primeiro = turno(['manda o pix da Rua Nova']);
  const t = turno(['é da minha mãe'], { terceiro: primeiro.alvo.terceiro });
  expect(t.alvo.alvoAmbiguo).toBe('outra_pessoa_sem_documento');
  const r = await executeTool('gerar_pix', { contratoId: 301 }, t.contexto);
  expect(r).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
  expect(r.instrucao).toMatch(/CPF ou CNPJ do titular/);
  expect(viasPedidas()).toEqual([]);
});

test('duas falas com contratos diferentes: os dois podem ser cobrados, um terceiro contrato dele não', async () => {
  const { alvo, contexto } = turno(['manda o pix da Rua de Teste', 'e o da Avenida de Teste'], { contratos: [RUA, AVENIDA, { id: 304, address: 'Travessa de Teste, 4 - Bairro de Teste' }] });
  expect(alvo.contratosEscolhidos).toEqual(['301', '302']);
  expect(alvo.contratoEscolhido).toBeUndefined();
  expect((await executeTool('gerar_pix', { contratoId: 304 }, contexto)).motivo).toBe('financial_target_address_mismatch');
  expect((await executeTool('gerar_pix', { contratoId: 301 }, contexto)).ok).toBe(true);
  expect((await executeTool('gerar_pix', { contratoId: 302 }, contexto)).ok).toBe(true);
  expect(pixEnviado()).toEqual(['PIX-301', 'PIX-302']);
});

test('pedido explícito de outra pessoa: continua travando como antes (e grava a dúvida de outra pessoa)', async () => {
  for (const fala of ['manda o boleto da Beltrana', 'o pix da Rua de Teste do Fulano']) {
    const { alvo, contexto } = turno([fala]);
    expect(alvo).toMatchObject({ alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: 'criar' });
    const r = await executeTool('gerar_pix', { contratoId: 301 }, contexto);
    expect(r).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
  }
  expect(viasPedidas()).toEqual([]);
});

test('terceiro autorizado + a rua do próprio, sem afirmar a própria cobrança: nada do terceiro nem do próprio', async () => {
  const { contexto } = turno(['agora o pix da Rua de Teste'], { terceiro: BELTRANA });
  for (const args of [{}, { contratoId: 301 }, { contratoId: 501 }]) {
    const r = await executeTool('gerar_pix', args, contexto);
    expect(r).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
  }
  expect(viasPedidas()).toEqual([]);
});

test('terceiro pendente (dúvida forte) + a rua do próprio: a dúvida forte continua, nada sai', async () => {
  const pendente = { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' };
  const { alvo, contexto } = turno(['manda o pix da Rua de Teste'], { terceiro: pendente });
  expect(alvo.alvoAmbiguo).toBe('outra_pessoa_sem_documento');
  const r = await executeTool('gerar_pix', { contratoId: 301 }, contexto);
  expect(r).toMatchObject({ ok: false, motivo: 'financial_target_ambiguous' });
  expect(viasPedidas()).toEqual([]);
});

test('volta explícita ao próprio com a rua: sai a cobrança desse contrato dele, nunca a do terceiro', async () => {
  const { alvo, contexto } = turno(['agora a minha fatura da Rua de Teste'], { terceiro: BELTRANA });
  expect(alvo).toMatchObject({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '301' });
  expect((await executeTool('gerar_pix', { contratoId: 501 }, contexto)).ok).toBe(false);
  const r = await executeTool('gerar_pix', {}, contexto);
  expect(r.ok).toBe(true);
  expect(pixEnviado()).toEqual(['PIX-301']);
});

test('nenhuma entrega ao contrato errado: sem fatura no contrato escolhido, a cobrança não troca para o outro', async () => {
  faturas[301] = semFatura;
  const { contexto } = turno(['manda o pix da Rua de Teste']);
  const r = await executeTool('gerar_pix', { contratoId: 301 }, contexto);
  expect(viasPedidas()).toEqual([301]);
  expect(pixEnviado()).toEqual([]);
  expect(JSON.stringify(r)).not.toMatch(/PIX-302/);
  // A mensagem não diz "em nenhum contrato": só o do endereço pedido foi consultado.
  expect(JSON.stringify(r)).toMatch(/os outros contratos dele não foram consultados/);
  expect(JSON.stringify(r)).not.toMatch(/em nenhum contrato do cliente/);
});

test('N2: a dedução pelo contrato escolhido é só das ferramentas de cobrança (consulta sem contratoId continua inválida)', async () => {
  const { contexto } = turno(['manda o pix da Rua de Teste']);
  const r = await executeTool('consultar_faturas', {}, contexto);
  expect(r).toMatchObject({ ok: false, motivo: 'invalid_args' });
});

test('N3: com terceiro, o contrato escolhido que sobrou não desliga a busca da fatura nos contratos do terceiro', async () => {
  const BELTRANA2 = { nome: 'Beltrana', contratos: [{ id: 501 }, { id: 502 }] };
  faturas[501] = semFatura;
  faturas[502] = fatura(502);
  const { contexto } = turno(['manda o pix dela'], { terceiro: BELTRANA2 });
  contexto.contratoEscolhido = '301';
  await executeTool('gerar_pix', { contratoId: 501 }, contexto);
  expect(viasPedidas()).toEqual([501, 502]);
});

test.each([['gerar_pix', 'manda o pix da Rua de Teste'], ['gerar_segunda_via', 'manda o boleto da Rua de Teste'], ['enviar_boleto', 'manda o boleto da Rua de Teste']])(
  'sem fatura no contrato escolhido (%s): a mensagem diz que só ele foi consultado, nunca "em nenhum contrato"', async (ferramenta, fala) => {
    faturas[301] = semFatura;
    const { contexto } = turno([fala]);
    const r = await executeTool(ferramenta, { contratoId: 301 }, contexto);
    expect(viasPedidas()).toEqual([301]);
    expect(JSON.stringify(r)).toMatch(/os outros contratos dele não foram consultados/);
    expect(JSON.stringify(r)).not.toMatch(/em nenhum contrato do cliente/);
  });

test('um contrato só, escolhido pela rua e sem fatura: a mensagem de sempre (não há outros contratos)', async () => {
  faturas[301] = semFatura;
  const { contexto } = turno(['manda o pix da Rua de Teste'], { contratos: [RUA] });
  expect(contexto.contratoEscolhido).toBe('301');
  const r = await executeTool('gerar_pix', {}, contexto);
  expect(JSON.stringify(r)).toMatch(/em nenhum contrato do cliente/);
  expect(JSON.stringify(r)).not.toMatch(/não foram consultados/);
});

test('sem a rua citada, nada muda: com dois contratos, o pedido explícito de um deles segue', async () => {
  const { alvo, contexto } = turno(['manda o pix']);
  expect(alvo.contratoEscolhido).toBeUndefined();
  const r = await executeTool('gerar_pix', { contratoId: 302 }, contexto);
  expect(r.ok).toBe(true);
  expect(pixEnviado()).toEqual(['PIX-302']);
});
