jest.mock('axios');
jest.mock('./sgp-query-config.repository');
const axios = require('axios');
const { getSgpQueryConfig } = require('./sgp-query-config.repository');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
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
          plan: '1GB',
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
});
