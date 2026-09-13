jest.mock('axios');
jest.mock('./sgp-query-config.repository');
const axios = require('axios');
const { getSgpQueryConfig } = require('./sgp-query-config.repository');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  downloadBoletoPdf,
  checkConnection,
  listInvoices,
  requestTrustUnlock,
  findClientRecord,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('./sgp-client');

const CONFIG = { baseUrl: 'https://dwtelecom.sgp.tsmx.com.br', app: 'chatmix', token: 'tok-123', enabled: true };

describe('sgp-client', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('lookupClientByCpf', () => {
    test('throws SgpNotConfiguredError when there is no config', async () => {
      getSgpQueryConfig.mockResolvedValue(null);
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpNotConfiguredError);
      expect(axios.post).not.toHaveBeenCalled();
    });

    test('throws SgpDisabledError when the integration is disabled', async () => {
      getSgpQueryConfig.mockResolvedValue({ ...CONFIG, enabled: false });
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpDisabledError);
    });

    test('calls consultacliente and normalizes the response, excluding password fields', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({
        data: {
          msg: 'Contrato(s) Localizado(s)',
          contratos: [
            {
              contratoId: 17402,
              clienteId: 16957,
              cpfCnpj: '036.668.113-37',
              razaoSocial: 'CLIENTE EXEMPLO',
              contratoStatus: 1,
              contratoStatusDisplay: 'Ativo',
              contratoTitulosAReceber: 1,
              contratoValorAberto: 89.9,
              servico_plano: '1GB',
              servico_senha: 'segredo-login',
              contratoCentralSenha: 'segredo-central',
              endereco_logradouro: 'RUA EXEMPLO',
              endereco_numero: 523,
              endereco_bairro: 'CENTRO',
              endereco_cidade: 'CANDIDO MENDES',
              endereco_uf: 'MA',
              telefones: [{ tipoContato: 'WhatsApp Número', contato: '(98) 98512-0338' }],
              emails: [{ tipoContato: 'E-Mail', contato: 'exemplo@dominio.com' }],
            },
          ],
        },
      });

      const result = await lookupClientByCpf('03666811337');

      expect(axios.post).toHaveBeenCalledWith(
        'https://dwtelecom.sgp.tsmx.com.br/api/ura/consultacliente',
        expect.stringContaining('cpfcnpj=03666811337'),
        expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
      );
      expect(result.client).toEqual({ id: 16957, name: 'CLIENTE EXEMPLO', document: '036.668.113-37' });
      expect(result.contracts).toEqual([
        {
          id: 17402,
          status: 'Ativo',
          statusCode: 1,
          statusReason: undefined,
          plan: '1GB',
          internetPlan: undefined,
          tvPlan: undefined,
          login: undefined,
          mac: undefined,
          vlan: undefined,
          grupo: undefined,
          connectionType: undefined,
          popId: undefined,
          popName: undefined,
          openInvoicesCount: 1,
          openAmount: 89.9,
          paymentPromisesThisMonth: 0,
          address: 'RUA EXEMPLO, 523 - CENTRO - CANDIDO MENDES/MA',
          phones: ['(98) 98512-0338'],
          emails: ['exemplo@dominio.com'],
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('segredo');
    });

    test('throws SgpClientNotFoundError when contratos is empty', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({ data: { msg: 'Nada encontrado', contratos: [] } });
      await expect(lookupClientByCpf('00000000000')).rejects.toBeInstanceOf(SgpClientNotFoundError);
    });

    test('throws SgpRequestError when the SGP call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockRejectedValue(new Error('timeout of 15000ms exceeded'));
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpRequestError);
    });

    // Modelado no teste de vazamento de openai-client.test.js: um axios error
    // realista carrega, em config.data, o corpo form-encoded que inclui o
    // token do SGP e o CPF do cliente. A causa anexada ao erro lançado não
    // pode repassar isso adiante — só quem chama console.error aqui dentro
    // (com {status}/{message}) pode ver o valor cru.
    test('does not leak the SGP token or the request body in the error cause', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      const axiosError = {
        response: { status: 500, data: { error: 'server error' } },
        config: {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: `token=${CONFIG.token}&app=chatmix&cpfcnpj=03666811337`,
        },
        message: 'Request failed with status code 500',
      };
      axios.post.mockRejectedValue(axiosError);

      try {
        await lookupClientByCpf('03666811337');
        fail('should have thrown');
      } catch (err) {
        const serialized = JSON.stringify(err) + JSON.stringify(err.cause);
        expect(serialized).not.toContain(CONFIG.token);
        expect(serialized).not.toContain('03666811337');
      }
    });

    test('throws SgpRequestError when SGP returns a malformed/non-object response', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({ data: '<html>login page</html>' });
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpRequestError);
    });
  });

  describe('getDuplicateInvoice', () => {
    test('returns hasOpenInvoice: false when fatura2via has no links', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [] } }) // titulos
        .mockResolvedValueOnce({ data: { status: 0, links: [] } }); // fatura2via

      const result = await getDuplicateInvoice(17402);

      expect(result).toEqual({ hasOpenInvoice: false, duplicates: [] });
    });

    test('uses the codigopix from fatura2via and skips pagamento/pix when it is present', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [{ status: 'aberto' }] } }) // titulos
        .mockResolvedValueOnce({
          data: {
            status: 1,
            links: [
              {
                id: '999',
                fatura: '1',
                vencimento: '2026-09-20',
                valor: 89.9,
                linhadigitavel: '836100000012',
                codigopix: '000201-financeiro-pix',
                link: 'https://dwtelecom.sgp.tsmx.com.br/boleto/999',
              },
            ],
          },
        }); // fatura2via

      const result = await getDuplicateInvoice(17402);

      expect(axios.post).toHaveBeenCalledTimes(2);
      const calledUrls = axios.post.mock.calls.map((call) => call[0]);
      expect(calledUrls.some((url) => url.includes('pagamento/pix'))).toBe(false);
      expect(result).toEqual({
        hasOpenInvoice: true,
        duplicates: [
          {
            id: '999',
            dueDate: '2026-09-20',
            value: 89.9,
            barCode: '836100000012',
            pixCode: '000201-financeiro-pix',
            boletoLink: 'https://dwtelecom.sgp.tsmx.com.br/boleto/999',
          },
        ],
      });
    });

    test('calls pagamento/pix only when fatura2via has no codigopix', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [{ status: 'aberto' }] } }) // titulos
        .mockResolvedValueOnce({
          data: {
            status: 1,
            links: [
              {
                id: '999',
                fatura: '1',
                vencimento: '2026-09-20',
                valor: 89.9,
                linhadigitavel: '836100000012',
                codigopix: '',
                link: 'https://dwtelecom.sgp.tsmx.com.br/boleto/999',
              },
            ],
          },
        }) // fatura2via
        .mockResolvedValueOnce({ data: { status: 1, msg: 'Dados do Pix', pix: '000201-fresh-pix-emv' } }); // pagamento/pix/999

      const result = await getDuplicateInvoice(17402);

      expect(axios.post).toHaveBeenNthCalledWith(
        3,
        'https://dwtelecom.sgp.tsmx.com.br/api/ura/pagamento/pix/999',
        expect.stringContaining('contrato=17402'),
        expect.any(Object)
      );
      expect(result.duplicates[0].pixCode).toBe('000201-fresh-pix-emv');
    });

    test('does not abort when the titulos pre-call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockRejectedValueOnce(new Error('titulos unavailable')) // titulos
        .mockResolvedValueOnce({ data: { status: 0, links: [] } }); // fatura2via

      const result = await getDuplicateInvoice(17402);

      expect(result).toEqual({ hasOpenInvoice: false, duplicates: [] });
    });

    test('returns a null pixCode when there is no codigopix and pagamento/pix fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [] } })
        .mockResolvedValueOnce({
          data: { status: 1, links: [{ id: '999', vencimento: '2026-09-20', valor: 89.9, linhadigitavel: '836...', codigopix: '', link: 'https://x' }] },
        })
        .mockRejectedValueOnce(new Error('timeout'));

      const result = await getDuplicateInvoice(17402);

      expect(result.duplicates[0].pixCode).toBeNull();
    });
  });

  describe('downloadBoletoPdf', () => {
    test('downloads the link and returns a Buffer', async () => {
      axios.get.mockResolvedValue({ data: Buffer.from('%PDF-fake-bytes') });

      const result = await downloadBoletoPdf('https://dwtelecom.sgp.tsmx.com.br/boleto/999');

      expect(axios.get).toHaveBeenCalledWith('https://dwtelecom.sgp.tsmx.com.br/boleto/999', {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('%PDF-fake-bytes');
    });

    test('throws SgpRequestError when the download fails', async () => {
      axios.get.mockRejectedValue(new Error('timeout'));

      await expect(downloadBoletoPdf('https://dwtelecom.sgp.tsmx.com.br/boleto/999')).rejects.toBeInstanceOf(SgpRequestError);
    });
  });

  describe('checkConnection', () => {
    test('maps status 1 to the online payload', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({
        data: { status: 1, msg: 'Serviço Online', contratoId: 17402, cpfCnpj: '529.982.247-25',
                razaoSocial: 'CLIENTE EXEMPLO', login: 'cliente-dw', servico_id: 13169 },
      });

      const result = await checkConnection(17402);

      expect(axios.post).toHaveBeenCalledWith(
        'https://dwtelecom.sgp.tsmx.com.br/api/ura/verificaacesso',
        expect.stringContaining('contrato=17402'),
        expect.objectContaining({ timeout: 15000 })
      );
      expect(result).toEqual({ status: 1, msg: 'Serviço Online', contratoId: 17402, login: 'cliente-dw', servicoId: 13169 });
    });

    test('maps status 2 (offline) without inventing fields', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({
        data: { status: 2, msg: 'Serviço Offline', contratoId: 17405, login: 'outro-dw', servico_id: 13172 },
      });

      const result = await checkConnection(17405);

      expect(result.status).toBe(2);
      expect(result.msg).toBe('Serviço Offline');
    });

    test('throws SgpRequestError when the call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockRejectedValue(new Error('timeout'));
      await expect(checkConnection(17402)).rejects.toBeInstanceOf(SgpRequestError);
    });
  });

  describe('listInvoices', () => {
    test('returns faturas and paginacao from central/titulos', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({
        data: {
          paginacao: { offset: 0, limit: 50, parcial: 2, total: 2 },
          faturas: [
            { id: 999, status: 'Aberto', statusid: 1, numero_documento: 123, valor: 89.9,
              valorcorrigido: 92.1, vencimento: '2026-09-20', vencimento_atualizado: '2026-09-25',
              data_pagamento: null, linhadigitavel: '836100000012', codigopix: '000201-pix',
              gerapix: true, link: 'https://x/boleto/999', link_completo: 'https://x/boleto/999/full' },
          ],
        },
      });

      const result = await listInvoices(17402);

      expect(axios.post).toHaveBeenCalledWith(
        'https://dwtelecom.sgp.tsmx.com.br/api/central/titulos',
        expect.stringContaining('nao_gerar_os=1'),
        expect.any(Object)
      );
      expect(result.faturas).toHaveLength(1);
      expect(result.faturas[0].id).toBe(999);
      expect(result.paginacao.total).toBe(2);
    });

    test('returns an empty list when SGP sends no faturas', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({ data: {} });
      const result = await listInvoices(17402);
      expect(result).toEqual({ faturas: [], paginacao: {} });
    });
  });

  describe('toContract via lookupClientByCpf', () => {
    test('carries the technical fields that used to be dropped', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({
        data: { contratos: [{
          contratoId: 17402, clienteId: 16957, cpfCnpj: '529.982.247-25', razaoSocial: 'CLIENTE',
          contratoStatus: 1, contratoStatusDisplay: 'Ativo', motivo_status: '',
          contratoTitulosAReceber: 2, contratoValorAberto: 89.9,
          servico_plano: '600MB', planointernet: 'FIBRA 600', planotv: '',
          servico_login: 'cliente-dw', servico_mac: 'AA:BB:CC', servico_vlan: '101',
          servico_grupo: 'GRUPO A', servico_tipo_conexao: 'PPPoE',
          popId: 1, popNome: 'POP CENTRO',
          servico_senha: 'segredo-login', contratoCentralSenha: 'segredo-central',
          contratoCentralLogin: 'segredo-user',
          telefones: [], emails: [],
        }] },
      });

      const { contracts } = await lookupClientByCpf('52998224725');

      expect(contracts[0]).toMatchObject({
        id: 17402, statusCode: 1, status: 'Ativo', statusReason: '',
        plan: '600MB', internetPlan: 'FIBRA 600',
        login: 'cliente-dw', mac: 'AA:BB:CC', vlan: '101', grupo: 'GRUPO A',
        connectionType: 'PPPoE', popId: 1, popName: 'POP CENTRO',
      });
      expect(JSON.stringify(contracts)).not.toContain('segredo');
    });
  });
});

describe("requestTrustUnlock (desbloqueio em confiança)", () => {
  const CONFIG = { baseUrl: "https://dwtelecom.sgp.tsmx.com.br", app: "chatmix", token: "tok-123", enabled: true };
  beforeEach(() => { jest.clearAllMocks(); getSgpQueryConfig.mockResolvedValue(CONFIG); });

  test("chama liberacaopromessa só com o contrato — nunca manda data_promessa", async () => {
    axios.post.mockResolvedValue({ data: { status: 1, liberado: true, liberado_dias: 3, protocolo: "9999", razaoSocial: "X", cpfCnpj: "001", msg: "Liberação via URA -\nServiço ID: 999, Login: LOGIN-PPPOE\nMotivo: Promessa de Pagamento\n", contratoId: 26515 } });
    const r = await requestTrustUnlock(26515);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe("https://dwtelecom.sgp.tsmx.com.br/api/ura/liberacaopromessa/");
    const params = new URLSearchParams(body);
    expect(params.get("contrato")).toBe("26515");
    expect(params.get("token")).toBe("tok-123");
    expect(params.has("data_promessa")).toBe(false);
    expect(r).toEqual({ liberado: true, liberadoDias: 3, dataPromessa: null, protocolo: "9999", motivo: null });
  });

  test("a msg de sucesso (com login PPPoE) não sai do módulo", async () => {
    axios.post.mockResolvedValue({ data: { status: 1, liberado: true, liberado_dias: 1, protocolo: "1", msg: "Login: LOGIN-PPPOE" } });
    expect(JSON.stringify(await requestTrustUnlock(1))).not.toContain("LOGIN-PPPOE");
  });

  test("recusa do SGP devolve liberado=false com o motivo legível", async () => {
    axios.post.mockResolvedValue({ data: { status: 2, liberado: false, msg: "O recurso de promessa de pagamento já atingiu quantidade permitida. Recurso não disponível" } });
    const r = await requestTrustUnlock(26515);
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(/quantidade permitida/);
    expect(r.protocolo).toBeNull();
  });

  test("resposta sem corpo vira SgpRequestError", async () => {
    axios.post.mockResolvedValue({ data: "" });
    await expect(requestTrustUnlock(1)).rejects.toBeInstanceOf(SgpRequestError);
  });

  test("falha de rede vira SgpRequestError saneado, sem o token na causa", async () => {
    const err = new Error("Request failed with status code 500"); err.response = { status: 500 }; err.config = { data: "token=tok-123&app=chatmix" };
    axios.post.mockRejectedValue(err);
    let capturado; try { await requestTrustUnlock(1); } catch (e) { capturado = e; }
    expect(capturado).toBeInstanceOf(SgpRequestError);
    expect(JSON.stringify(capturado.cause)).not.toContain("tok-123");
  });
});

describe("requestTrustUnlock — coerção de tipos da API form-encoded", () => {
  const CONFIG = { baseUrl: "https://dwtelecom.sgp.tsmx.com.br", app: "chatmix", token: "tok-123", enabled: true };
  beforeEach(() => { jest.clearAllMocks(); getSgpQueryConfig.mockResolvedValue(CONFIG); });

  test('liberado "true" e liberado_dias "3" como texto contam como liberação de 3 dias', async () => {
    // Ler estrito demais viraria uma liberação REAL em "não liberou", sem registro.
    axios.post.mockResolvedValue({ data: { status: "1", liberado: "true", liberado_dias: "3", protocolo: 9999 } });
    expect(await requestTrustUnlock(1)).toEqual({ liberado: true, liberadoDias: 3, dataPromessa: null, protocolo: "9999", motivo: null });
  });

  test("liberado sem dias devolve liberadoDias nulo, nunca um chute", async () => {
    axios.post.mockResolvedValue({ data: { status: 1, liberado: true, protocolo: "1" } });
    expect((await requestTrustUnlock(1)).liberadoDias).toBeNull();
  });
});

describe("requestTrustUnlock — 'True' capitalizado (Django) também é liberação", () => {
  const CONFIG = { baseUrl: "https://dwtelecom.sgp.tsmx.com.br", app: "chatmix", token: "tok-123", enabled: true };
  test("liberado 'True' é lido como verdadeiro", async () => {
    getSgpQueryConfig.mockResolvedValue(CONFIG);
    axios.post.mockResolvedValue({ data: { status: 1, liberado: "True", liberado_dias: 2, protocolo: "7" } });
    expect((await requestTrustUnlock(1)).liberado).toBe(true);
  });
});

describe("requestTrustUnlock — data_promessa (observada no teste real)", () => {
  const CONFIG = { baseUrl: "https://dwtelecom.sgp.tsmx.com.br", app: "chatmix", token: "tok-123", enabled: true };
  test("repassa a data-limite quando vem no formato AAAA-MM-DD", async () => {
    getSgpQueryConfig.mockResolvedValue(CONFIG);
    axios.post.mockResolvedValue({ data: { status: 1, liberado: true, liberado_dias: 3, data_promessa: "2026-09-15", protocolo: "260912153100" } });
    expect((await requestTrustUnlock(26515)).dataPromessa).toBe("2026-09-15");
  });
  test("ignora data_promessa malformada", async () => {
    getSgpQueryConfig.mockResolvedValue(CONFIG);
    axios.post.mockResolvedValue({ data: { status: 1, liberado: true, liberado_dias: 3, data_promessa: "15/09/2026", protocolo: "1" } });
    expect((await requestTrustUnlock(26515)).dataPromessa).toBeNull();
  });
});

describe('findClientRecord', () => {
  const CONFIG = { baseUrl: 'https://dwtelecom.sgp.tsmx.com.br', app: 'chatmix', token: 'tok-123', enabled: true };
  beforeEach(() => { jest.clearAllMocks(); getSgpQueryConfig.mockResolvedValue(CONFIG); });

  test('busca por telefone com omitir_* e limit 2, e devolve só id, cpfcnpj e dataNascimento', async () => {
    axios.post.mockResolvedValue({ data: { paginacao: { total: 1 }, clientes: [{
      id: 16957, nome: 'CLIENTE EXEMPLO', cpfcnpj: '529.982.247-25', dataNascimento: '1990-05-20',
      contratos: [{ id: 17402, contratoCentralSenha: 'SEGREDO', contratoCentralLogin: 'user' }],
      endereco: { logradouro: 'RUA X' }, contatos: [] } ] } });
    const r = await findClientRecord({ telefone: '98985120338' });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://dwtelecom.sgp.tsmx.com.br/api/ura/clientes/');
    const p = new URLSearchParams(body);
    expect(p.get('telefone')).toBe('98985120338');
    expect(p.get('omitir_titulos')).toBe('1');
    expect(p.get('omitir_contatos')).toBe('1');
    expect(p.get('limit')).toBe('2');
    expect(r).toEqual({ total: 1, cliente: { id: 16957, cpfcnpj: '52998224725', dataNascimento: '1990-05-20' } });
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
    expect(JSON.stringify(r)).not.toContain('RUA X');
  });

  test('busca por cpfcnpj', async () => {
    axios.post.mockResolvedValue({ data: { paginacao: { total: 1 }, clientes: [{ id: 1, cpfcnpj: '52998224725', dataNascimento: null }] } });
    const r = await findClientRecord({ cpfcnpj: '52998224725' });
    expect(new URLSearchParams(axios.post.mock.calls[0][1]).get('cpfcnpj')).toBe('52998224725');
    expect(r.cliente.dataNascimento).toBeNull();
  });

  test('zero ou vários resultados devolvem cliente nulo com o total', async () => {
    axios.post.mockResolvedValue({ data: { paginacao: { total: 3 }, clientes: [{ id: 1, cpfcnpj: '1' }, { id: 2, cpfcnpj: '2' }] } });
    expect(await findClientRecord({ telefone: '00000000000' })).toEqual({ total: 3, cliente: null });
    axios.post.mockResolvedValue({ data: { paginacao: { total: 0 }, clientes: [] } });
    expect(await findClientRecord({ telefone: '1' })).toEqual({ total: 0, cliente: null });
  });

  test('resposta sem corpo vira SgpRequestError', async () => {
    axios.post.mockResolvedValue({ data: '' });
    await expect(findClientRecord({ telefone: '1' })).rejects.toBeInstanceOf(SgpRequestError);
  });
});
