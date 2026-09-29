// POST /api/sgp/contratos/:id/boleto de ponta a ponta, com o sgp-client REAL e só o SGP (axios) e a
// configuração simulados: o bug de 28/09/2026 chega ao painel por esta rota. A resposta antiga
// (hasOpenInvoice + duplicates) segue intacta; a conferência dos títulos vem num bloco à parte.
jest.mock('axios');
jest.mock('../integrations/sgp-query-config.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../media/media-storage');
jest.mock('../payments/payment-sender');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getSgpQueryConfig } = require('../integrations/sgp-query-config.repository');
const sgpQueryRoutes = require('./sgp-query.routes');

const CONFIG = { baseUrl: 'https://sgp.exemplo', app: 'app-teste', token: 'token-teste', enabled: true };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sgp', sgpQueryRoutes);
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));
  return app;
}

const titulo = (id) => ({
  id, status: 'Gerado', statusid: 1, numero_documento: 5000 + id, valor: 100, valorcorrigido: 100,
  vencimento: '2026-09-15', vencimento_atualizado: '2026-09-28', data_pagamento: null,
  linhadigitavel: `LINHA-TITULO-${id}`, codigopix: `PIX-TITULO-${id}`, gerapix: true,
  link: `https://sgp.exemplo/boleto/${id}`, link_completo: `https://sgp.exemplo/boleto/${id}/completo`,
  idtransacao: null, recibo: null, pagarcartao: false, pagarcartaodebito: false, pagarcartaocheckout: false,
});

describe('POST /api/sgp/contratos/:contratoId/boleto — com o cliente SGP de verdade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00-03:00'));
    getSgpQueryConfig.mockResolvedValue(CONFIG);
  });
  afterEach(() => jest.useRealTimers());

  test('duas vencidas e uma 2ª via: a 2ª via como antes e, à parte, as duas pendências com o total R$ 200,00', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { paginacao: { offset: 0, limit: 50, parcial: 2, total: 2 }, faturas: [titulo(101), titulo(102)] } })
      .mockResolvedValueOnce({
        data: {
          status: 1,
          links: [{ id: '900', fatura: '1', vencimento: '2026-09-28', valor: 100, linhadigitavel: 'LINHA-2VIA', codigopix: 'PIX-2VIA', link: 'https://sgp.exemplo/2via/900' }],
        },
      });

    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${jwt.sign({ agentId: 'agent-1', role: 'agent' }, process.env.JWT_SECRET)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      hasOpenInvoice: true,
      duplicates: [{ id: '900', dueDate: '2026-09-28', value: 100, barCode: 'LINHA-2VIA', pixCode: 'PIX-2VIA', boletoLink: 'https://sgp.exemplo/2via/900' }],
      conferencia: {
        estado: 'completa',
        vencidas: [
          { faturaId: 101, vencimentoOriginal: '2026-09-15', vencimentoAtualizado: '2026-09-28', valorOriginal: 100, valorCorrigido: 100, valor: 100 },
          { faturaId: 102, vencimentoOriginal: '2026-09-15', vencimentoAtualizado: '2026-09-28', valorOriginal: 100, valorCorrigido: 100, valor: 100 },
        ],
        venceHoje: [],
        totalVencidas: 200,
      },
    });
    expect(axios.post.mock.calls.map((chamada) => chamada[0])).toEqual([
      'https://sgp.exemplo/api/central/titulos',
      'https://sgp.exemplo/api/ura/fatura2via',
    ]);
  });
});
