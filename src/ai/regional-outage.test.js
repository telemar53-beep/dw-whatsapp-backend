const {
  reclamaDeConexao, contradizAviso, respostaSeguraDoAviso, instrucaoDoAvisoAtivo, avisoExplicaReclamacao,
} = require('./regional-outage');

// Aviso de cidade como FATO operacional (25/09/2026). Tudo aqui é determinístico, sem OpenAI.
const AVISO = { cidade: 'Maracaçumé', mensagem: 'Estamos com instabilidade na rede da cidade.', desde: '2026-09-25T12:00:00.000Z', impacto: null };

describe('reclamaDeConexao', () => {
  test.each([
    'estou sem internet', 'a internet está lenta', 'tá caindo toda hora', 'sem conexão desde cedo',
    'a net tá muito lenta', 'internet oscilando', 'não conecta', 'está sem sinal',
  ])('reclamação de conexão: "%s"', (texto) => {
    expect(reclamaDeConexao([texto])).toBe(true);
  });

  test.each([
    'meu roteador queimou', 'caiu um raio e o roteador não liga mais', 'o cabo foi cortado na rua', 'estou sem internet, o roteador queimou',
  ])('equipamento danificado: o aviso NÃO explica ("%s")', (texto) => {
    expect(reclamaDeConexao([texto])).toBe(false);
  });

  test.each(['quero a segunda via do boleto', 'bom dia', 'qual o valor do plano?'])('outro assunto: "%s"', (texto) => {
    expect(reclamaDeConexao([texto])).toBe(false);
  });
});

describe('contradizAviso', () => {
  test.each([
    'Reinicie o roteador e me avise.', 'Desligue a ONU da tomada por 30 segundos.', 'Faça um teste de velocidade no fast.com.',
    'Testa em outros aparelhos pra gente ver.', 'Verifique o cabo de rede.', 'A luz vermelha da ONU está acesa?',
  ])('diagnóstico individual: "%s"', (texto) => {
    expect(contradizAviso(texto, AVISO)).toBe(true);
  });

  test.each([
    'Deve normalizar em 2 horas.', 'A previsão de normalização é hoje à noite.', 'Volta em breve!', 'Até amanhã deve estar resolvido.',
  ])('prazo inventado (o aviso não tem): "%s"', (texto) => {
    expect(contradizAviso(texto, AVISO)).toBe(true);
  });

  test('"a equipe já está resolvendo" sem o aviso dizer isso: contradiz', () => {
    expect(contradizAviso('Nossa equipe já está trabalhando nisso.', AVISO)).toBe(true);
  });

  test('prazo e atuação que o PRÓPRIO aviso traz podem ser repetidos', () => {
    const comPrazo = { ...AVISO, mensagem: 'Equipe atuando na rede; previsão de normalização às 18h.' };
    expect(contradizAviso('A equipe está atuando e a previsão de normalização é às 18h.', comPrazo)).toBe(false);
  });

  test('resposta que só informa a ocorrência: não contradiz', () => {
    expect(contradizAviso('Há uma ocorrência na rede em Maracaçumé que pode estar afetando sua conexão.', AVISO)).toBe(false);
  });
});

describe('respostaSeguraDoAviso', () => {
  test('cita o lugar, não pede teste, não promete prazo nem atuação', () => {
    const r = respostaSeguraDoAviso(AVISO);
    expect(r).toContain('Maracaçumé');
    expect(contradizAviso(r, AVISO)).toBe(false);
  });
});

describe('instrucaoDoAvisoAtivo', () => {
  test('manda seguir o aviso, proíbe equipamento e previsão, e mantém o resto do atendimento', () => {
    const i = instrucaoDoAvisoAtivo(AVISO);
    expect(i).toContain('Maracaçumé');
    expect(i).toContain(AVISO.mensagem);
    expect(i).toMatch(/NÃO peça reiniciar/);
    expect(i).toMatch(/NÃO prometa previsão/);
    expect(i).toMatch(/atenda normalmente/);
  });
});

describe('avisoExplicaReclamacao', () => {
  test('aviso sem tipo (o modelo de hoje) vale como geral: explica reclamação de conexão', () => {
    expect(avisoExplicaReclamacao(AVISO, ['estou sem internet'])).toBe(true);
    expect(avisoExplicaReclamacao(AVISO, ['meu roteador queimou'])).toBe(false);
    expect(avisoExplicaReclamacao(null, ['estou sem internet'])).toBe(false);
  });
});

// Ajuste (25/09/2026): UM aviso da ocorrência por turno, não dois. Quando o aviso JÁ FOI ENVIADO
// ao cliente neste turno (marca transitória enviadoNesteTurno), a contenção continua vencendo,
// mas sem repetir a ocorrência.
describe('aviso já enviado neste turno', () => {
  const ENVIADO = { ...AVISO, enviadoNesteTurno: true };

  test('resposta segura mínima: não repete a ocorrência, não pede teste, sem prazo nem atuação', () => {
    const r = respostaSeguraDoAviso(ENVIADO);
    expect(r).toBe('Não é necessário fazer nenhum teste no seu equipamento agora.');
    expect(r).not.toMatch(/ocorr[eê]ncia|Maraca/);
    expect(contradizAviso(r, ENVIADO)).toBe(false);
  });

  test('sem a marca, a resposta segura completa continua (informa a ocorrência)', () => {
    expect(respostaSeguraDoAviso(AVISO)).toMatch(/ocorrência registrada pela nossa equipe na rede em Maracaçumé/);
  });

  test('a instrução ao modelo diz que o aviso já foi enviado e não deve ser repetido; o fato continua', () => {
    const i = instrucaoDoAvisoAtivo(ENVIADO);
    expect(i).toContain(AVISO.mensagem);
    expect(i).toMatch(/JÁ FOI ENVIADO ao cliente/);
    expect(instrucaoDoAvisoAtivo(AVISO)).not.toMatch(/JÁ FOI ENVIADO/);
  });

  test('o fato no resultado da ferramenta leva a marca', () => {
    const { avisoParaResultado } = require('./regional-outage');
    expect(avisoParaResultado(ENVIADO).jaEnviadoAoCliente).toBe(true);
    expect(avisoParaResultado(AVISO).jaEnviadoAoCliente).toBeUndefined();
  });
});

// P1-1 da auditoria final (25/09/2026): a regra única de "o aviso não explica suspensão".
describe('suspensaoAfastaOAviso', () => {
  const { suspensaoAfastaOAviso } = require('./regional-outage');
  const suspenso = { id: 3, status: 'suspenso' };
  const ativo = { id: 5, status: 'ativo' };

  test('sem alvo determinado: qualquer contrato suspenso afasta o aviso', () => {
    expect(suspensaoAfastaOAviso([suspenso])).toBe(true);
    expect(suspensaoAfastaOAviso([ativo, suspenso])).toBe(true);
    expect(suspensaoAfastaOAviso([ativo])).toBe(false);
    expect(suspensaoAfastaOAviso([])).toBe(false);
  });

  test('com o alvo determinado: vale o status DELE', () => {
    expect(suspensaoAfastaOAviso([ativo, suspenso], 5)).toBe(false);
    expect(suspensaoAfastaOAviso([ativo, suspenso], 3)).toBe(true);
  });

  test('alvo que não está na lista: volta à regra conservadora (qualquer suspenso)', () => {
    expect(suspensaoAfastaOAviso([ativo, suspenso], 99)).toBe(true);
  });
});
