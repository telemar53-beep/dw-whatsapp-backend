jest.mock('../integrations/sgp-client');
jest.mock('../conversations/contact.repository');
const sgpClient = require('../integrations/sgp-client');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { resolverIdentidade, variantesTelefone, primeiroNome } = require('./identity-resolver');

const CLIENT = { id: 16957, name: 'JOÃO DA SILVA', document: '529.982.247-25' };
const CONTRACTS = [{ id: 17402, statusCode: 1, plan: '600MB', address: 'RUA X' }];

beforeEach(() => jest.clearAllMocks());

describe('variantesTelefone', () => {
  test('tira o 55 e oferece a variante sem o nono dígito', () => {
    expect(variantesTelefone('5598985120338')).toEqual(['98985120338', '9885120338']);
  });
  test('número sem 55 e sem nono dígito fica como está', () => {
    expect(variantesTelefone('9885120338')).toEqual(['9885120338']);
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
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    const r = await resolverIdentidade({ contact: { id: 'ct-1', phoneNumber: '5598985120338', sgpDocument: '52998224725' } });
    expect(r.nivel).toBe('forte');
    expect(r.origem).toBe('memory');
    expect(r.primeiroNome).toBe('João');
    expect(r.contracts).toEqual(CONTRACTS);
    expect(sgpClient.findClientRecord).toHaveBeenCalledWith({ cpfcnpj: '52998224725' });
    expect(r.dataNascimento).toBe('1990-05-20');
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
    expect(r.dataNascimento).toBeNull();
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
});
