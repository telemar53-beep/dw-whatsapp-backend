const { parseSgpTemplatePayload, SgpTemplatePayloadError, extrairCamposDoDisparo, TIPOS_DE_DISPARO } = require('./sgp-template-payload-parser');

describe('parseSgpTemplatePayload', () => {
  test('parses variables and template name with no header', () => {
    const result = parseSgpTemplatePayload('variables=João|150,00|10/09/2026|https://boleto.link/xyz||template=aviso_cobranca');
    expect(result).toEqual({
      variables: ['João', '150,00', '10/09/2026', 'https://boleto.link/xyz'],
      templateName: 'aviso_cobranca',
      headerLink: null,
      headerType: null,
    });
  });

  test('parses variables, header, and template name together', () => {
    const result = parseSgpTemplatePayload(
      'variables=João|150,00|10/09/2026||header_link=https://boleto.link/xyz.pdf||header_type=document||template=aviso_cobranca_anexo'
    );
    expect(result).toEqual({
      variables: ['João', '150,00', '10/09/2026'],
      templateName: 'aviso_cobranca_anexo',
      headerLink: 'https://boleto.link/xyz.pdf',
      headerType: 'document',
    });
  });

  test('parses zero variables', () => {
    const result = parseSgpTemplatePayload('variables=||template=boas_vindas');
    expect(result.variables).toEqual([]);
  });

  test('throws when content is empty', () => {
    expect(() => parseSgpTemplatePayload('')).toThrow(SgpTemplatePayloadError);
  });

  test('throws when content does not start with variables=', () => {
    expect(() => parseSgpTemplatePayload('template=aviso_cobranca')).toThrow(SgpTemplatePayloadError);
  });

  test('throws when template= is missing', () => {
    expect(() => parseSgpTemplatePayload('variables=João')).toThrow(SgpTemplatePayloadError);
  });

  test('throws when header_link is present without header_type', () => {
    expect(() =>
      parseSgpTemplatePayload('variables=João||header_link=https://boleto.link/xyz.pdf||template=aviso_cobranca')
    ).toThrow(SgpTemplatePayloadError);
  });

  test('throws when header_type is present without header_link', () => {
    expect(() =>
      parseSgpTemplatePayload('variables=João||header_type=document||template=aviso_cobranca')
    ).toThrow(SgpTemplatePayloadError);
  });

  test('throws when a segment has no "=" at all', () => {
    expect(() => parseSgpTemplatePayload('variables=João||garbage||template=x')).toThrow(SgpTemplatePayloadError);
  });
});

// Fase 1B (25/09/2026): blocos opcionais e ADITIVOS na mensagem da regra do SGP.
// Formato real de hoje:  variables={cliente1}|{valor}|{vencimento}|{link}||template=dw_fatura_mensal
// Formato futuro:        ...||template=dw_fatura_mensal||tipo=fatura_disponivel||vencimento={vencimento}
const ANTIGO = 'variables=Maria|R$ 100,00|30/09/2026|https://boleto.exemplo/abc||template=dw_fatura_mensal';

describe('Fase 1B — o formato antigo continua exatamente igual', () => {
  test('parseSgpTemplatePayload devolve o mesmo objeto de antes, com ou sem os blocos novos', () => {
    const antes = parseSgpTemplatePayload(ANTIGO);
    expect(antes).toEqual({
      variables: ['Maria', 'R$ 100,00', '30/09/2026', 'https://boleto.exemplo/abc'],
      templateName: 'dw_fatura_mensal', headerLink: null, headerType: null,
    });
    expect(parseSgpTemplatePayload(`${ANTIGO}||tipo=fatura_disponivel||vencimento=30/09/2026||fatura=123||contrato=456`)).toEqual(antes);
  });
});

describe('extrairCamposDoDisparo (Fase 1B)', () => {
  test('formato antigo: só o tipo desconhecido, nada inferido das posições', () => {
    // A 3ª variável é o vencimento NO TEMPLATE DE HOJE, mas isso não vira regra: sem bloco
    // `vencimento=`, não há vencimento.
    expect(extrairCamposDoDisparo(ANTIGO)).toEqual({ tipo: 'desconhecido' });
  });

  test('blocos novos válidos entram nomeados', () => {
    expect(extrairCamposDoDisparo(`${ANTIGO}||tipo=fatura_disponivel||vencimento=30/09/2026||fatura=123||contrato=456`))
      .toEqual({ tipo: 'fatura_disponivel', vencimento: '30/09/2026', faturaId: '123', contratoId: '456' });
  });

  test('só existe o tipo confirmado no SGP; qualquer outro vira desconhecido (não inventa tipos)', () => {
    expect(TIPOS_DE_DISPARO).toEqual(['fatura_disponivel']);
    for (const t of ['cobranca_vencida', 'reativacao', 'lembrete_vencimento', 'outro', '', '{tipo}']) {
      expect(extrairCamposDoDisparo(`${ANTIGO}||tipo=${t}`).tipo).toBe('desconhecido');
    }
    expect(extrairCamposDoDisparo(`${ANTIGO}||tipo= FATURA_DISPONIVEL `).tipo).toBe('fatura_disponivel');
  });

  test('vencimento: data válida entra no formato DD/MM/AAAA; inválida é descartada', () => {
    expect(extrairCamposDoDisparo(`${ANTIGO}||vencimento=2026-09-30`).vencimento).toBe('30/09/2026');
    for (const v of ['31/02/2026', '30/13/2026', '{vencimento}', 'amanhã', '2026-02-30', '']) {
      expect(extrairCamposDoDisparo(`${ANTIGO}||vencimento=${v}`)).not.toHaveProperty('vencimento');
    }
  });

  test('fatura e contrato: só dígitos; o resto é descartado', () => {
    const r = extrairCamposDoDisparo(`${ANTIGO}||fatura=12a||contrato={contrato}`);
    expect(r).not.toHaveProperty('faturaId');
    expect(r).not.toHaveProperty('contratoId');
  });

  test('chave desconhecida é ignorada e nada lança, mesmo com lixo', () => {
    expect(extrairCamposDoDisparo(`${ANTIGO}||cor=azul||semigual||link=https://x`)).toEqual({ tipo: 'desconhecido' });
    expect(extrairCamposDoDisparo(null)).toEqual({ tipo: 'desconhecido' });
    expect(extrairCamposDoDisparo('texto livre qualquer')).toEqual({ tipo: 'desconhecido' });
  });
});
