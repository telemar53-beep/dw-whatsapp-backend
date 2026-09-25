const {
  ORIGENS_AUTOMATICAS, ehMensagemAutomatica, metadataDoDisparoSgp, metadataDaCampanha, resumoParaModelo,
} = require('./automatic-message');

const CORPO = 'Olá, {{1}}! Sua fatura da DW Telecom está disponível.\n\nValor: {{2}}\nVencimento: {{3}}\nBoleto: {{4}}\n\nQualquer dúvida sobre o pagamento, fale com a nossa central de atendimento pelo 0800 445 4546.';
const MONTADO = 'Olá, Maria! Sua fatura da DW Telecom está disponível.\n\nValor: R$ 100,00\nVencimento: 30/09/2026\nBoleto: https://boleto.exemplo/abc123\n\nQualquer dúvida sobre o pagamento, fale com a nossa central de atendimento pelo 0800 445 4546.';

describe('ORIGENS_AUTOMATICAS / ehMensagemAutomatica', () => {
  test('SGP e campanha são origens automáticas; o resto não', () => {
    expect(ORIGENS_AUTOMATICAS).toEqual(expect.arrayContaining(['sgp', 'campanha']));
    expect(ehMensagemAutomatica({ metadata: { origem: 'sgp' } })).toBe(true);
    expect(ehMensagemAutomatica({ metadata: { origem: 'campanha' } })).toBe(true);
    expect(ehMensagemAutomatica({ metadata: { faturaId: '1' } })).toBe(false);
    expect(ehMensagemAutomatica({ metadata: null })).toBe(false);
    expect(ehMensagemAutomatica({})).toBe(false);
    expect(ehMensagemAutomatica(null)).toBe(false);
  });
});

describe('metadataDoDisparoSgp', () => {
  test('template: só campos permitidos e disponíveis — nunca valor, link, nome ou CPF', () => {
    const m = metadataDoDisparoSgp({
      integrationId: 'gw-1', modo: 'template', template: { name: 'dw_fatura_mensal', bodyText: CORPO },
      campos: { tipo: 'fatura_disponivel', vencimento: '30/09/2026', faturaId: '123', contratoId: '456' },
      referenceId: 'ref-9',
    });
    expect(m).toEqual({
      origem: 'sgp', gatewayId: 'gw-1', modo: 'template', template: 'dw_fatura_mensal', textoModelo: CORPO,
      tipo: 'fatura_disponivel', vencimento: '30/09/2026', faturaId: '123', contratoId: '456', referenciaSgp: 'ref-9',
    });
  });

  test('ausentes não viram chave; tipo sempre presente', () => {
    expect(metadataDoDisparoSgp({ integrationId: 'gw-1', modo: 'freetext', campos: { tipo: 'desconhecido' } }))
      .toEqual({ origem: 'sgp', gatewayId: 'gw-1', modo: 'freetext', tipo: 'desconhecido' });
    expect(metadataDoDisparoSgp({ modo: 'template', template: { name: 't', bodyText: 'x' } }).tipo).toBe('desconhecido');
  });
});

describe('metadataDaCampanha', () => {
  test('origem, campanha e template (quando houver)', () => {
    expect(metadataDaCampanha({ campaignId: 'c-1', templateName: 'promo' })).toEqual({ origem: 'campanha', campanhaId: 'c-1', template: 'promo' });
    expect(metadataDaCampanha({ campaignId: 'c-1', templateName: null })).toEqual({ origem: 'campanha', campanhaId: 'c-1' });
  });
});

describe('resumoParaModelo — o texto montado NUNCA vai cru à IA', () => {
  const disparoTemplate = {
    direction: 'outbound', messageType: 'text', content: MONTADO,
    metadata: { origem: 'sgp', modo: 'template', template: 'dw_fatura_mensal', textoModelo: CORPO, tipo: 'desconhecido' },
  };

  test('template do SGP: rótulo, template, tipo e o texto do MODELO (com {{n}})', () => {
    const r = resumoParaModelo(disparoTemplate);
    expect(r).toContain('mensagem automática do SGP enviada ao cliente');
    expect(r).toContain('template: dw_fatura_mensal');
    expect(r).toContain('tipo: desconhecido');
    expect(r).toContain('{{1}}');
    for (const proibido of ['Maria', 'R$ 100,00', '100,00', 'https://', 'boleto.exemplo']) expect(r).not.toContain(proibido);
  });

  test('vencimento informado entra só quando o disparo trouxe o bloco nomeado', () => {
    expect(resumoParaModelo(disparoTemplate)).not.toContain('vencimento informado');
    const comVencimento = { ...disparoTemplate, metadata: { ...disparoTemplate.metadata, tipo: 'fatura_disponivel', vencimento: '30/09/2026' } };
    const r = resumoParaModelo(comVencimento);
    expect(r).toContain('tipo: fatura_disponivel');
    expect(r).toContain('vencimento informado: 30/09/2026');
    expect(r).not.toContain('Maria');
  });

  test('texto livre do SGP: o conteúdo é omitido (não há como separar nome, valor e link)', () => {
    const r = resumoParaModelo({ direction: 'outbound', content: 'Maria, sua fatura de R$ 100,00: https://boleto.exemplo/x', metadata: { origem: 'sgp', modo: 'freetext', tipo: 'desconhecido' } });
    expect(r).toContain('mensagem automática do SGP enviada ao cliente');
    expect(r).toContain('texto livre');
    for (const proibido of ['Maria', '100,00', 'https://']) expect(r).not.toContain(proibido);
  });

  test('campanha: rotulada como automática, com o texto da campanha (o mesmo para todos os destinatários)', () => {
    const r = resumoParaModelo({ direction: 'outbound', content: 'Promoção de setembro na DW', metadata: { origem: 'campanha', campanhaId: 'c-1', template: 'promo' } });
    expect(r).toBe('[mensagem automática de campanha enviada ao cliente — template: promo: "Promoção de setembro na DW"]');
  });

  test('mensagem que não é automática: null (quem chama segue a regra de sempre)', () => {
    expect(resumoParaModelo({ direction: 'outbound', content: 'oi', metadata: null })).toBeNull();
  });
});

describe('encontrarDisparoRelacionado e fatoDoDisparo', () => {
  const { encontrarDisparoRelacionado, fatoDoDisparo } = require('./automatic-message');
  const auto = (id, template, extra = {}) => ({
    id, direction: 'outbound', messageType: 'text', content: `texto montado ${id}`, createdAt: new Date('2026-09-25T12:00:00Z'),
    metadata: { origem: 'sgp', modo: 'template', template, tipo: 'desconhecido', textoModelo: 'x {{1}}', ...extra },
  });
  const entrada = (id, repliedToMessageId = null) => ({ id, direction: 'inbound', messageType: 'text', content: 'oi', repliedToMessageId });

  test('o disparo citado pelo cliente tem prioridade sobre o último', () => {
    const historico = [auto('a', 'tpl_a'), auto('b', 'tpl_b'), entrada('i', 'a')];
    expect(encontrarDisparoRelacionado(historico)).toEqual({ mensagem: historico[0], citado: true });
  });

  test('sem citação: o último disparo automático do histórico', () => {
    const historico = [auto('a', 'tpl_a'), entrada('i1'), auto('b', 'tpl_b'), entrada('i2')];
    expect(encontrarDisparoRelacionado(historico)).toEqual({ mensagem: historico[2], citado: false });
  });

  test('citação a uma mensagem que não é automática cai no último disparo', () => {
    const humana = { id: 'h', direction: 'outbound', messageType: 'text', content: 'Olá', metadata: null };
    const historico = [auto('a', 'tpl_a'), humana, entrada('i', 'h')];
    expect(encontrarDisparoRelacionado(historico)).toEqual({ mensagem: historico[0], citado: false });
  });

  test('citação a um disparo fora do histórico carregado: usa a mensagem citada que quem chama buscou', () => {
    const antiga = auto('velho', 'tpl_velho');
    const historico = [auto('b', 'tpl_b'), entrada('i', 'velho')];
    expect(encontrarDisparoRelacionado(historico, antiga)).toEqual({ mensagem: antiga, citado: true });
  });

  test('sem disparo nenhum: null', () => {
    expect(encontrarDisparoRelacionado([entrada('i')])).toBeNull();
    expect(encontrarDisparoRelacionado([])).toBeNull();
    expect(encontrarDisparoRelacionado(null)).toBeNull();
  });

  test('fatoDoDisparo leva só campos seguros — nunca o conteúdo montado nem o texto do modelo', () => {
    const m = auto('a', 'dw_fatura_mensal', { tipo: 'fatura_disponivel', vencimento: '30/09/2026', faturaId: '9', contratoId: '8' });
    const fato = fatoDoDisparo({ mensagem: m, citado: true });
    expect(fato).toEqual({
      origem: 'sgp', modo: 'template', template: 'dw_fatura_mensal', tipo: 'fatura_disponivel', vencimento: '30/09/2026',
      enviadoEm: m.createdAt, citado: true,
    });
    expect(JSON.stringify(fato)).not.toContain('texto montado');
    expect(fatoDoDisparo(null)).toBeNull();
  });
});
