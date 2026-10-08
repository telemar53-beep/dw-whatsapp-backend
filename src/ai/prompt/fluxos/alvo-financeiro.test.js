const alvoFinanceiro = require('./alvo-financeiro');
const { fatosDoAlvoFinanceiro } = alvoFinanceiro;
const { estadoBase } = require('../estado-de-teste');

// Rodada 9 (N5): os fatos do alvo financeiro que o código já decidiu, para o modelo não receber duas ordens contrárias.
// Dados sintéticos.
const SICRANO = { nivel: 'forte', origem: 'phone', primeiroNome: 'Sicrano', contestado: false };
const DOIS = [
  { id: 301, address: 'Rua de Teste, 300 - Bairro de Teste' },
  { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' },
];
const contexto = (extra = {}) => ({ identidade: SICRANO, contracts: DOIS, terceiro: null, alvoAmbiguo: false, contratoEscolhido: null, contratosEscolhidos: null, alvoVoltouAoTitular: false, ...extra });
const linhas = (ctx, opcoes) => alvoFinanceiro.linhas(estadoBase({ alvoFinanceiro: fatosDoAlvoFinanceiro(ctx, opcoes) })).join('\n');

describe('fatos do alvo financeiro (N5)', () => {
  test('a volta à própria cobrança pela rua: o alvo é ele, o contrato é o da rua, sem dúvida e nada a perguntar', () => {
    const t = linhas(contexto({ alvoVoltouAoTitular: true, alvoVoltouDeTerceiro: true, contratoEscolhido: '301', contratosEscolhidos: ['301'] }));
    expect(t).toMatch(/ALVO FINANCEIRO AGORA/);
    expect(t).toMatch(/não autoriza nada, não promete envio e não obriga a chamar ferramenta/);
    expect(t).toMatch(/- Quem fala: Sicrano, identificado\./);
    expect(t).toMatch(/- Alvo da cobrança: a cobrança DELE — ele acabou de dizer que é a dele\. A outra pessoa citada antes não é o alvo agora/);
    expect(t).toMatch(/- Contrato escolhido: o do endereço Rua de Teste, 300 - Bairro de Teste — ele disse a rua\. Não pergunte de novo de qual endereço é\./);
    expect(t).toMatch(/- Dúvida: nenhuma\./);
    expect(t).toMatch(/- Falta saber: nada sobre o alvo\./);
    expect(t).not.toMatch(/\b30[12]\b/);
  });

  // Revisão da rodada 9 (achado 4): a resposta à dúvida de endereço também limpa o escopo, mas não havia outra pessoa — a frase
  // não fala de "outra pessoa citada antes".
  test('a resposta à dúvida de endereço: a cobrança dele, sem falar de outra pessoa', () => {
    const t = linhas(contexto({ alvoVoltouAoTitular: true, alvoVoltouDeTerceiro: false, contratoEscolhido: '301', contratosEscolhidos: ['301'] }));
    expect(t).toMatch(/- Alvo da cobrança: a cobrança dele — ele disse de qual endereço é\./);
    expect(t).not.toMatch(/outra pessoa/);
    expect(t).toMatch(/- Contrato escolhido: o do endereço Rua de Teste, 300/);
  });

  test('dois contratos escolhidos pelas ruas', () => {
    expect(linhas(contexto({ contratosEscolhidos: ['301', '302'] }))).toMatch(/- Contratos escolhidos: os dos endereços Rua de Teste, 300 - Bairro de Teste e Avenida de Teste, 30 - Outro Bairro de Teste/);
  });

  test('dúvida de endereço gravada: alvo indefinido; falta o endereço, sem documento', () => {
    const t = linhas(contexto({ terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'endereco_desconhecido' }, alvoAmbiguo: 'endereco_desconhecido' }));
    expect(t).toMatch(/- Alvo da cobrança: ainda não definido\./);
    expect(t).toMatch(/- Dúvida: de qual endereço dele é a cobrança\./);
    expect(t).toMatch(/- Falta saber: de qual endereço é \(cite os endereços dele\)\. Não peça documento\./);
    expect(t).not.toMatch(/Contrato escolhido/);
  });

  test('a dúvida gravada no escopo vale mesmo que o turno não a repita', () => {
    const t = linhas(contexto({ terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'endereco_desconhecido' }, alvoAmbiguo: false }));
    expect(t).toMatch(/- Alvo da cobrança: ainda não definido\./);
    expect(t).toMatch(/- Dúvida: de qual endereço dele é a cobrança\./);
  });

  test('dúvida forte: falta saber de quem é; o documento só se a guarda permitir pedir', () => {
    const forte = contexto({ terceiro: { nome: 'Fulana', contratos: [{ id: 401 }], alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado' });
    expect(linhas(forte, { pedidoDeDocumentoPermitido: true })).toMatch(/- Falta saber: de quem é a conta; se for de outra pessoa, o CPF ou CNPJ do titular dela\./);
    const barrado = linhas(forte, { pedidoDeDocumentoPermitido: false });
    expect(barrado).toMatch(/- Falta saber: de quem é a conta\. O documento já foi pedido: não peça de novo agora\./);
    expect(barrado).not.toMatch(/o CPF ou CNPJ do titular dela/);
  });

  test('dúvida fraca: se é dele ou da pessoa citada, sem documento', () => {
    const t = linhas(contexto({ terceiro: { nome: 'Fulana', contratos: [{ id: 401 }], alvoPendente: 'proprio_nao_afirmado' }, alvoAmbiguo: 'proprio_nao_afirmado' }));
    expect(t).toMatch(/- Dúvida: se a cobrança é dele ou da pessoa já citada\./);
    expect(t).toMatch(/Não peça documento\./);
  });

  test('terceiro localizado no turno (estado mudado pela consulta): o alvo é a outra pessoa, sem dúvida', () => {
    const t = linhas(contexto({ terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' }, alvoAmbiguo: false, alvoTerceiro: { contratos: [401] } }));
    expect(t).toMatch(/- Alvo da cobrança: a cobrança da outra pessoa, já localizada pelo documento que ele informou\./);
    expect(t).toMatch(/- Dúvida: nenhuma\./);
    expect(t).not.toMatch(/Contrato escolhido/);
  });

  test('cobrança travada no turno (sem contrato liberado): nada a enviar', () => {
    const t = linhas(contexto({ alvoTerceiro: { contratos: [] } }));
    expect(t).toMatch(/- Alvo da cobrança: nenhuma cobrança liberada neste turno\./);
    expect(t).toMatch(/não envie nem prometa cobrança neste turno/);
  });

  test('dúvida técnica e motivo desconhecido não liberam nada', () => {
    expect(linhas(contexto({ alvoAmbiguo: 'escopo_nao_lido' }))).toMatch(/- Dúvida: o sistema não conseguiu confirmar o alvo agora\./);
    expect(linhas(contexto({ alvoAmbiguo: 'motivo_novo' }))).toMatch(/- Dúvida: o alvo da cobrança não está claro agora\./);
  });

  test('identificação contestada e quem fala sem identificação', () => {
    expect(linhas(contexto({ identidade: { ...SICRANO, contestado: true }, alvoAmbiguo: 'dois_lados' }))).toMatch(/- Quem fala: identificação contestada/);
    expect(linhas(contexto({ identidade: { nivel: 'none' }, contracts: [], alvoAmbiguo: 'outra_pessoa_sem_documento' }))).toMatch(/- Quem fala: ainda não identificado\./);
  });

  test('sem contrato escolhido e com mais de um contrato: nenhum ainda', () => {
    const t = linhas(contexto());
    expect(t).toMatch(/- Contrato escolhido: nenhum ainda\./);
    expect(t).toMatch(/- Falta saber: de qual endereço é, quando ele pedir uma cobrança\./);
  });

  test('entra: na triagem com o estado do alvo; não entra sem estado nem com quem fala sem identificação e sem alvo', () => {
    expect(alvoFinanceiro.entra(estadoBase({ alvoFinanceiro: fatosDoAlvoFinanceiro(contexto()) }))).toBe(true);
    expect(alvoFinanceiro.entra(estadoBase())).toBe(false);
    expect(alvoFinanceiro.entra(estadoBase({ alvoFinanceiro: fatosDoAlvoFinanceiro(contexto({ identidade: { nivel: 'none' }, contracts: [] })) }))).toBe(false);
  });
});
