const { parseSgpTemplatePayload, SgpTemplatePayloadError } = require('./sgp-template-payload-parser');

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
