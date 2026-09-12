const {
  normalizeClient, normalizeContract, normalizeConnection, normalizeInvoices,
  maskDocument, CAMPOS_BLOQUEADOS,
} = require('./sgp-normalizer');

const RAW_CONTRACT = {
  id: 17402, status: 'Ativo', statusCode: 1, statusReason: '',
  plan: '600MB', internetPlan: 'FIBRA 600', tvPlan: '',
  login: 'cliente-dw', mac: 'AA:BB:CC', vlan: '101', grupo: 'GRUPO A',
  connectionType: 'PPPoE', popId: 1, popName: 'POP CENTRO',
  openInvoicesCount: 2, openAmount: 89.9,
  address: 'RUA X, 523 - CENTRO - CIDADE/MA', phones: [], emails: [],
};

describe('sgp-normalizer', () => {
  test('maskDocument keeps only the last digits visible', () => {
    expect(maskDocument('529.982.247-25')).toBe('529.***.**7-25');
    expect(maskDocument(null)).toBeNull();
  });

  test('normalizeContract derives the enum from the numeric status, not the text', () => {
    const result = normalizeContract(RAW_CONTRACT);
    expect(result.status).toBe('ativo');
    expect(result.statusLabel).toBe('Ativo');
    expect(result.plano).toBe('600MB');
    expect(result.loginPPPoE).toBe('cliente-dw');
    expect(result.pop).toBe('POP CENTRO');
  });

  test('normalizeContract falls back to desconhecido for an unmapped status code', () => {
    const result = normalizeContract({ ...RAW_CONTRACT, statusCode: 7, status: 'Algo Novo' });
    expect(result.status).toBe('desconhecido');
    expect(result.statusLabel).toBe('Algo Novo');
  });

  test('normalizeConnection maps SGP status 1 to online and 2 to offline', () => {
    expect(normalizeConnection({ status: 1, msg: 'Serviço Online' }).status).toBe('online');
    expect(normalizeConnection({ status: 2, msg: 'Serviço Offline' }).status).toBe('offline');
    expect(normalizeConnection({ status: 9, msg: '???' }).status).toBe('desconhecido');
  });

  test('normalizeConnection stamps the source and the time', () => {
    const result = normalizeConnection({ status: 1, msg: 'Serviço Online' });
    expect(result.fonte).toBe('sgp');
    expect(typeof result.verificadoEm).toBe('string');
  });

  test('normalizeInvoices maps the real field names from central/titulos', () => {
    const result = normalizeInvoices([
      { id: 999, status: 'Aberto', statusid: 1, valor: 89.9, valorcorrigido: 92.1,
        vencimento: '2026-09-20', vencimento_atualizado: '2026-09-25',
        data_pagamento: null, gerapix: true, linhadigitavel: '836', codigopix: 'pix' },
    ]);
    expect(result).toEqual([{
      faturaId: 999, status: 'Aberto', statusCode: 1,
      valorOriginal: 89.9, valorAtualizado: 92.1,
      vencimentoOriginal: '2026-09-20', vencimentoAtualizado: '2026-09-25',
      dataPagamento: null, permiteGerarPix: true,
    }]);
  });

  test('normalizeInvoices never leaks the barcode or the pix code', () => {
    // Linha digitável e PIX só saem pela ferramenta de 2ª via, nunca na listagem.
    const result = normalizeInvoices([{ id: 1, linhadigitavel: '836100000012', codigopix: '000201-pix' }]);
    expect(JSON.stringify(result)).not.toContain('836100000012');
    expect(JSON.stringify(result)).not.toContain('000201-pix');
  });

  test('no normalizer output ever contains a blocked field', () => {
    const poisoned = {
      ...RAW_CONTRACT,
      servico_senha: 'segredo-1', contratoCentralSenha: 'segredo-2',
      contratoCentralLogin: 'segredo-3', servico_wifi_password: 'segredo-4',
      servico_wifi_password_5: 'segredo-5',
    };
    const output = JSON.stringify(normalizeContract(poisoned));
    for (const campo of CAMPOS_BLOQUEADOS) expect(output).not.toContain(campo);
    expect(output).not.toContain('segredo');
  });
});
