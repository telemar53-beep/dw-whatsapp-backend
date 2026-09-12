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

    test('chains titulos -> fatura2via -> pagamento/pix and normalizes duplicates', async () => {
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
                codigopix: 'stale-pix-from-fatura2via',
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
      expect(result).toEqual({
        hasOpenInvoice: true,
        duplicates: [
          {
            id: '999',
            dueDate: '2026-09-20',
            value: 89.9,
            barCode: '836100000012',
            pixCode: '000201-fresh-pix-emv',
            boletoLink: 'https://dwtelecom.sgp.tsmx.com.br/boleto/999',
          },
        ],
      });
    });

    test('does not abort when the titulos pre-call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockRejectedValueOnce(new Error('titulos unavailable')) // titulos
        .mockResolvedValueOnce({ data: { status: 0, links: [] } }); // fatura2via

      const result = await getDuplicateInvoice(17402);

      expect(result).toEqual({ hasOpenInvoice: false, duplicates: [] });
    });

    test('falls back to fatura2via\'s own codigopix when the dedicated pix call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [] } })
        .mockResolvedValueOnce({
          data: { status: 1, links: [{ id: '999', vencimento: '2026-09-20', valor: 89.9, linhadigitavel: '836...', codigopix: 'fallback-pix', link: 'https://x' }] },
        })
        .mockRejectedValueOnce(new Error('timeout'));

      const result = await getDuplicateInvoice(17402);

      expect(result.duplicates[0].pixCode).toBe('fallback-pix');
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
