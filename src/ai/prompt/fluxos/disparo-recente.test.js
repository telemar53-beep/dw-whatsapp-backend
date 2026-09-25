const modulo = require('./disparo-recente');
const { estadoBase } = require('../estado-de-teste');

const AGORA = new Date('2026-09-25T15:00:00.000Z');
const FATO = { origem: 'sgp', modo: 'template', template: 'dw_fatura_mensal', tipo: 'desconhecido', enviadoEm: new Date('2026-09-25T14:58:00.000Z'), citado: false };
const texto = (fato) => modulo.linhas(estadoBase({ disparoRecente: fato, agora: AGORA })).join('\n');

describe('fluxos/disparo-recente (Fase 1B)', () => {
  test('só entra quando existe disparo relacionado', () => {
    expect(modulo.entra(estadoBase())).toBe(false);
    expect(modulo.entra(estadoBase({ disparoRecente: null }))).toBe(false);
    expect(modulo.entra(estadoBase({ disparoRecente: FATO }))).toBe(true);
  });

  test('diz que foi mensagem automática, de onde veio, o template e há quanto tempo', () => {
    const t = texto(FATO);
    expect(t).toContain('MENSAGEM AUTOMÁTICA');
    expect(t).toContain('dw_fatura_mensal');
    expect(t).toContain('há 2 minutos');
    expect(t).toContain('pode estar respondendo');
  });

  test('citação: diz que o cliente respondeu citando a mensagem', () => {
    expect(texto({ ...FATO, citado: true })).toContain('citando');
  });

  test('tipo desconhecido: não presume finalidade (não vira cobrança vencida)', () => {
    const t = texto(FATO);
    expect(t).toContain('tipo desconhecido');
    expect(t).toMatch(/não presuma a finalidade/);
    expect(t).not.toMatch(/cobrança vencida|está em atraso|está atrasad/i);
  });

  test('nunca afirmar atraso, dívida, pagamento confirmado ou situação financeira só pelo disparo', () => {
    expect(texto(FATO)).toMatch(/Nunca afirme atraso, dívida, pagamento confirmado/);
  });

  test('D6: sem identificação, só o que o próprio disparo informou; vencimento só se veio nomeado', () => {
    expect(texto(FATO)).toMatch(/Sem o cliente identificado, explique apenas o que a própria mensagem automática informou/);
    expect(texto(FATO)).not.toContain('vencimento informado');
    const comVencimento = texto({ ...FATO, tipo: 'fatura_disponivel', vencimento: '30/09/2026' });
    expect(comVencimento).toContain('vencimento informado 30/09/2026');
    expect(comVencimento).toContain('fatura_disponivel');
  });

  test('a mensagem mais recente continua mandando', () => {
    expect(texto(FATO)).toMatch(/Se ele mudou de assunto, siga o assunto novo/);
  });

  test('campanha: sem tipo, rotulada como campanha', () => {
    const t = texto({ origem: 'campanha', template: 'promo', enviadoEm: new Date('2026-09-24T15:00:00.000Z'), citado: false });
    expect(t).toContain('campanha');
    expect(t).toContain('há 1 dia');
    expect(t).not.toContain('tipo');
  });

  test('nunca carrega conteúdo do cliente, mesmo se o objeto trouxer algo a mais', () => {
    const t = texto({ ...FATO, content: 'Olá, Maria! Valor: R$ 100,00 https://boleto.exemplo/x' });
    for (const proibido of ['Maria', '100,00', 'https://']) expect(t).not.toContain(proibido);
  });
});
