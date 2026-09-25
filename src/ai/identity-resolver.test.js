jest.mock('../integrations/sgp-client');
jest.mock('../conversations/contact.repository');
jest.mock('../cities/contact-city.service');
const sgpClient = require('../integrations/sgp-client');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { preencherCidadePeloSgp } = require('../cities/contact-city.service');
const { resolverIdentidade, variantesTelefone, primeiroNome } = require('./identity-resolver');

const CLIENT = { id: 16957, name: 'JOÃO DA SILVA', document: '529.982.247-25' };
const CONTRACTS = [{ id: 17402, statusCode: 1, plan: '600MB', address: 'RUA X' }];

beforeEach(() => jest.clearAllMocks());

describe('variantesTelefone', () => {
  test('tira o 55 e oferece a variante sem o nono dígito', () => {
    expect(variantesTelefone('5598985120338')).toEqual(['98985120338', '9885120338']);
  });
  // Reescrito na Fase 1A (25/09/2026): antes, o número de 8 dígitos ficava como
  // estava. É exatamente a forma do wa_id da Meta fora dos DDDs 11-19/21/22/24/
  // 27/28, e o SGP da DW guarda o celular COM o 9 — a busca por telefone não
  // achava ninguém e a IA pedia CPF (B14 da Fase 0).
  test('celular de 8 dígitos (forma antiga do wa_id) também tenta a forma com o 9', () => {
    expect(variantesTelefone('9885120338')).toEqual(['9885120338', '98985120338']);
  });
  test('wa_id sem o 9, com 55, também tenta a forma com o 9', () => {
    expect(variantesTelefone('559885120338')).toEqual(['9885120338', '98985120338']);
  });
  test('fixo (8 dígitos começando com 2 a 5) nunca ganha variante de celular', () => {
    expect(variantesTelefone('559832345678')).toEqual(['9832345678']);
    expect(variantesTelefone('9853456789')).toEqual(['9853456789']);
  });
  test('lixo vira lista vazia', () => {
    expect(variantesTelefone('')).toEqual([]);
    expect(variantesTelefone('123')).toEqual([]);
  });
});

describe('primeiroNome', () => {
  test('primeiro token, capitalizado', () => {
    expect(primeiroNome('JOÃO DA SILVA')).toBe('João');
    expect(primeiroNome('maria')).toBe('Maria');
    expect(primeiroNome('')).toBeNull();
  });
});

describe('resolverIdentidade', () => {
  test('memória: contato já vinculado não consulta telefone', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725' } });
    expect(r.nivel).toBe('forte');
    expect(r.origem).toBe('memory');
    expect(r.primeiroNome).toBe('João');
    expect(r.contracts).toEqual(CONTRACTS);
  });

  test('telefone: exatamente um cliente identifica, grava o vínculo e vira forte', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'forte', origem: 'phone', primeiroNome: 'João' });
    expect(sgpClient.findClientRecord).toHaveBeenCalledWith({ telefone: '98985120338' });
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', expect.objectContaining({ sgpClientId: 16957, sgpDocument: '52998224725' }));
  });

  test('telefone: grava também o primeiro nome no contato', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', expect.objectContaining({ sgpFirstName: 'João' }));
  });

  test('memória: com o SGP fora, o vínculo gravado ainda identifica pelo nome guardado', async () => {
    sgpClient.lookupClientByCpf.mockRejectedValueOnce(new Error('SGP down'));
    const r = await resolverIdentidade({
      contact: {
        id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725',
        sgpFirstName: 'João', sgpClientId: 16957, sgpContractId: 17402,
      },
    });
    expect(r).toMatchObject({
      nivel: 'forte', origem: 'memory', primeiroNome: 'João', contracts: [], sgpIndisponivel: true,
    });
    expect(r.client).toEqual({ id: 16957, document: '52998224725' });
  });

  test('memória: com o SGP fora e sem nome guardado, ainda identifica (sem nome)', async () => {
    sgpClient.lookupClientByCpf.mockRejectedValueOnce(new Error('SGP down'));
    const r = await resolverIdentidade({
      contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725', sgpFirstName: null },
    });
    expect(r).toMatchObject({ nivel: 'forte', origem: 'memory', primeiroNome: null, sgpIndisponivel: true });
  });

  test('memória: contato antigo sem nome guardado recebe o backfill quando o SGP responde', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    const r = await resolverIdentidade({
      contact: {
        id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725',
        sgpFirstName: null, sgpClientId: 16957, sgpContractId: 17402,
      },
    });
    expect(r.primeiroNome).toBe('João');
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', {
      sgpClientId: 16957, sgpContractId: 17402, sgpDocument: '52998224725', sgpFirstName: 'João',
    });
  });

  test('memória: contato que já tem o nome guardado não regrava nada', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: null } });
    await resolverIdentidade({
      contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725', sgpFirstName: 'João' },
    });
    expect(setContactSgpLink).not.toHaveBeenCalled();
  });

  test('memória: backfill que falha não derruba a identificação', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: null } });
    // Once de propósito: jest.clearAllMocks() não apaga implementações, e uma
    // rejeição permanente vazaria para os testes seguintes.
    setContactSgpLink.mockRejectedValueOnce(new Error('banco fora'));
    const r = await resolverIdentidade({
      contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725', sgpFirstName: null },
    });
    expect(r).toMatchObject({ nivel: 'forte', origem: 'memory', primeiroNome: 'João' });
    expect(r.sgpIndisponivel).toBeUndefined();
  });

  test('sem vínculo nenhum, SGP fora continua none (não inventa memória)', async () => {
    // Once: a primeira variante de telefone já cai no catch, e uma rejeição
    // permanente vazaria para os testes seguintes (clearAllMocks não apaga
    // implementações).
    sgpClient.findClientRecord.mockRejectedValueOnce(new Error('SGP down'));
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'none', origem: 'none' });
    expect(r.sgpIndisponivel).toBeUndefined();
  });

  test('telefone: sem resultado tenta sem o nono dígito', async () => {
    sgpClient.findClientRecord
      .mockResolvedValueOnce({ total: 0, cliente: null })
      .mockResolvedValueOnce({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: null } });
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(r.origem).toBe('phone');
    expect(sgpClient.findClientRecord).toHaveBeenNthCalledWith(2, { telefone: '9885120338' });
  });

  test('telefone: wa_id sem o 9 acha o cliente cadastrado com o 9 no SGP', async () => {
    sgpClient.findClientRecord
      .mockResolvedValueOnce({ total: 0, cliente: null })
      .mockResolvedValueOnce({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725' } });
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '559885120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'forte', origem: 'phone', primeiroNome: 'João' });
    expect(sgpClient.findClientRecord).toHaveBeenNthCalledWith(1, { telefone: '9885120338' });
    expect(sgpClient.findClientRecord).toHaveBeenNthCalledWith(2, { telefone: '98985120338' });
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', expect.objectContaining({ sgpClientId: 16957 }));
  });

  test('telefone: as duas formas achando clientes DIFERENTES não identifica ninguém', async () => {
    sgpClient.findClientRecord
      .mockResolvedValueOnce({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725' } })
      .mockResolvedValueOnce({ total: 1, cliente: { id: 20001, cpfcnpj: '11144477735' } });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '559885120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] });
    expect(sgpClient.lookupClientByCpf).not.toHaveBeenCalled();
    expect(setContactSgpLink).not.toHaveBeenCalled();
    // Registra o fato sem dado do cliente: nem CPF, nem telefone.
    const log = spy.mock.calls.flat().join(' ');
    expect(log).toContain('different SGP clients');
    expect(log).not.toMatch(/52998224725|11144477735|9885120338/);
    spy.mockRestore();
  });

  test('telefone: as duas formas achando o MESMO cliente identifica normalmente', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725' } });
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '559885120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'forte', origem: 'phone' });
    expect(sgpClient.lookupClientByCpf).toHaveBeenCalledTimes(1);
  });

  test('telefone: uma forma com vários cadastros não identifica, mesmo que a outra ache um só', async () => {
    sgpClient.findClientRecord
      .mockResolvedValueOnce({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725' } })
      .mockResolvedValueOnce({ total: 2, cliente: null });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '559885120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'none', origem: 'none' });
    expect(setContactSgpLink).not.toHaveBeenCalled();
  });

  test('telefone: fixo consulta só a própria forma', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 0, cliente: null });
    await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '559832345678', sgpDocument: null } });
    expect(sgpClient.findClientRecord).toHaveBeenCalledTimes(1);
    expect(sgpClient.findClientRecord).toHaveBeenCalledWith({ telefone: '9832345678' });
  });

  test('telefone: vários resultados não identificam', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 3, cliente: null });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(r).toMatchObject({ nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] });
    expect(setContactSgpLink).not.toHaveBeenCalled();
  });

  test('SGP fora vira none, sem lançar', async () => {
    sgpClient.findClientRecord.mockRejectedValue(new Error('SGP down'));
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(r.nivel).toBe('none');
  });

  test('o objeto devolvido nunca carrega o nome completo', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: null } });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '55', sgpDocument: '52998224725' } });
    expect(JSON.stringify({ ...r, contracts: [] })).not.toContain('SILVA');
  });

  test('ignorarTelefone: true pula a busca por telefone quando não há memória (contestação persiste)', async () => {
    // Ruling da Task 4: depois de esquecer_identificacao, o vínculo do
    // contato é limpo, mas buscar pelo MESMO telefone de novo cumprimentaria
    // a mesma pessoa errada outra vez.
    const r = await resolverIdentidade({
      contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null },
      ignorarTelefone: true,
    });
    expect(r).toMatchObject({ nivel: 'none', origem: 'none' });
    expect(sgpClient.findClientRecord).not.toHaveBeenCalled();
  });

  test('memória: aproveita os contratos para preencher a cidade do contato', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    const contact = { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725' };

    await resolverIdentidade({ contact });

    expect(preencherCidadePeloSgp).toHaveBeenCalledWith(contact, CONTRACTS);
  });

  test('telefone: aproveita os contratos para preencher a cidade do contato', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    const contact = { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null };

    await resolverIdentidade({ contact });

    expect(preencherCidadePeloSgp).toHaveBeenCalledWith(contact, CONTRACTS);
  });

  test('sem identidade nenhuma, nada de cidade', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 0, cliente: null });
    await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: null } });
    expect(preencherCidadePeloSgp).not.toHaveBeenCalled();
  });

  test('uma falha do preenchimento de cidade não derruba a identificação', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    preencherCidadePeloSgp.mockRejectedValueOnce(new Error('banco fora'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725' } });

    // Não pode cair no caminho de "SGP fora" (que devolveria contracts vazio).
    expect(r).toMatchObject({ nivel: 'forte', origem: 'memory' });
    expect(r.contracts).toEqual(CONTRACTS);
    spy.mockRestore();
  });

  test('ignorarTelefone: true não afeta a memória (sgpDocument já vinculado continua identificando)', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: CLIENT, contracts: CONTRACTS });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    const r = await resolverIdentidade({
      contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725' },
      ignorarTelefone: true,
    });
    expect(r.nivel).toBe('forte');
    expect(r.origem).toBe('memory');
  });

  // A ferramenta confirmar_nascimento e o nível 'fraca' foram removidos: o
  // resolvedor só devolve 'forte' ou 'none' agora, em qualquer combinação de
  // parâmetros.
  test('a identidade nunca volta como fraca', async () => {
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 9, cpfcnpj: '52998224725' } });
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 9, name: 'MARIA SILVA', document: '52998224725' },
      contracts: [{ id: 1, status: 1, address: 'Rua A' }],
    });
    const id = await resolverIdentidade({ contact: { id: 'ct1', phoneNumber: '5598985120338' } });
    expect(['forte', 'none']).toContain(id.nivel);
    expect(id).not.toHaveProperty('dataNascimento');
    expect(id).not.toHaveProperty('nascimentoTentado');
  });
});
