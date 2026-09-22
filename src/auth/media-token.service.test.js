const jwt = require('jsonwebtoken');
const { signMediaToken, verifyMediaToken, MEDIA_TOKEN_EXPIRY_SECONDS } = require('./media-token.service');
const { verifyToken } = require('./auth.service');

describe('media token', () => {
  const SEGREDO_DE_MIDIA = 'segredo-de-midia-para-teste-com-tamanho-suficiente';

  beforeEach(() => {
    process.env.JWT_SECRET = 'segredo-de-sessao-para-teste-com-tamanho';
    process.env.MEDIA_TOKEN_SECRET = SEGREDO_DE_MIDIA;
  });

  test('vale 30 minutos', () => {
    expect(MEDIA_TOKEN_EXPIRY_SECONDS).toBe(1800);
    const { exp, iat } = jwt.verify(signMediaToken({ agentId: 'agent-1' }), SEGREDO_DE_MIDIA);
    expect(exp - iat).toBe(1800);
  });

  test('carrega o minimo: quem, para que, ate quando e uma permissao', () => {
    const payload = jwt.verify(signMediaToken({ agentId: 'agent-1', podeVerSilent: true }), SEGREDO_DE_MIDIA);

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sil', 'sub', 'typ']);
    expect(payload.sub).toBe('agent-1');
    expect(payload.typ).toBe('media');
    expect(payload.sil).toBe(true);
  });

  test('NAO carrega role, documento do SGP nem nota interna', () => {
    const token = signMediaToken({ agentId: 'agent-1', podeVerSilent: true });
    const payload = jwt.verify(token, SEGREDO_DE_MIDIA);

    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('canManageIntegrations');
    expect(payload).not.toHaveProperty('sgpDocument');
    expect(payload).not.toHaveProperty('internalNote');
    // Nem no texto cru do token, que e base64 legivel por qualquer um.
    const corpo = Buffer.from(token.split('.')[1], 'base64').toString();
    for (const proibido of ['admin', 'manager', 'role', 'cpf', 'document']) {
      expect(corpo.toLowerCase()).not.toContain(proibido);
    }
  });

  test('a permissao de silent e booleana e nasce falsa', () => {
    expect(verifyMediaToken(signMediaToken({ agentId: 'a1' })).podeVerSilent).toBe(false);
    expect(verifyMediaToken(signMediaToken({ agentId: 'a1', podeVerSilent: false })).podeVerSilent).toBe(false);
    expect(verifyMediaToken(signMediaToken({ agentId: 'a1', podeVerSilent: true })).podeVerSilent).toBe(true);
  });

  test('sem MEDIA_TOKEN_SECRET falha de forma detectavel, sem cair no segredo de sessao', () => {
    delete process.env.MEDIA_TOKEN_SECRET;

    expect(() => signMediaToken({ agentId: 'a1' })).toThrow(/MEDIA_TOKEN_SECRET/);
    try {
      signMediaToken({ agentId: 'a1' });
    } catch (err) {
      expect(err.code).toBe('MEDIA_TOKEN_SECRET_MISSING');
    }
  });

  describe('os dois tokens nao se cruzam', () => {
    test('token de midia NAO e aceito como token de sessao', () => {
      const deMidia = signMediaToken({ agentId: 'agent-1', podeVerSilent: true });

      // verifyToken usa JWT_SECRET; a assinatura do token de midia e outra.
      expect(() => verifyToken(deMidia)).toThrow();
    });

    test('token de sessao NAO e aceito como token de midia', () => {
      const deSessao = jwt.sign({ agentId: 'agent-1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });

      expect(() => verifyMediaToken(deSessao)).toThrow();
    });

    test('a separacao e criptografica: segredos diferentes, nao so uma claim', () => {
      const deMidia = signMediaToken({ agentId: 'agent-1' });

      // Mesmo ignorando a verificacao, o token de midia nao tem o que uma
      // sessao precisa: nao ha agentId nem role no payload.
      const payload = jwt.verify(deMidia, SEGREDO_DE_MIDIA);
      expect(payload.agentId).toBeUndefined();
      expect(payload.role).toBeUndefined();
    });

    test('um token com o typ certo mas assinado com o segredo de sessao e recusado', () => {
      const forjado = jwt.sign({ typ: 'media', sil: true }, process.env.JWT_SECRET, { subject: 'agent-1', expiresIn: '30m' });

      expect(() => verifyMediaToken(forjado)).toThrow();
    });

    test('um token assinado com o segredo de midia mas sem typ e recusado', () => {
      const semTipo = jwt.sign({ sil: true }, SEGREDO_DE_MIDIA, { subject: 'agent-1', expiresIn: '30m' });

      expect(() => verifyMediaToken(semTipo)).toThrow(/inválido/i);
    });

    test('um token sem sub e recusado', () => {
      const semSub = jwt.sign({ typ: 'media', sil: true }, SEGREDO_DE_MIDIA, { expiresIn: '30m' });

      expect(() => verifyMediaToken(semSub)).toThrow(/inválido/i);
    });
  });

  test('token de midia expirado e recusado', () => {
    const vencido = jwt.sign({ typ: 'media', sil: false }, SEGREDO_DE_MIDIA, { subject: 'a1', expiresIn: -10 });

    expect(() => verifyMediaToken(vencido)).toThrow(/expired/i);
  });

  test('token valido devolve so o que a rota precisa', () => {
    const lido = verifyMediaToken(signMediaToken({ agentId: 'agent-9', podeVerSilent: true }));

    expect(lido).toEqual({ agentId: 'agent-9', podeVerSilent: true });
  });
});
