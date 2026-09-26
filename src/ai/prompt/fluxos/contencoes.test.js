const contencoes = require('./contencoes');
const { estadoBase } = require('../estado-de-teste');
const { sinaisOperacionais } = require('../../contencoes-operacionais');

// Contenções operacionais (25/09/2026): o fato do turno (defeito físico, pedido de Wi-Fi,
// explicação financeira) vira instrução só quando o sinal existe — o resto do prompt não muda.
const sinais = (...textos) => sinaisOperacionais(textos.map((content) => ({ direction: 'inbound', messageType: 'text', content })));
const TITULAR = { nivel: 'forte', origem: 'phone', primeiroNome: '[nome]', contracts: [{ id: 1 }], contestado: false };
const texto = (estado) => contencoes.linhas(estado).join('\n');

describe('módulo contencoes', () => {
  test('sem sinal nenhum, não entra', () => {
    expect(contencoes.entra(estadoBase())).toBe(false);
    expect(contencoes.entra(estadoBase({ contencoes: sinais('quero o boleto') }))).toBe(false);
  });

  test('defeito físico com titular: nada de roteiro, reparo nem promessa; conclui para suporte', () => {
    const t = texto(estadoBase({ identidade: TITULAR, contencoes: sinais('meu roteador queimou') }));
    expect(t).toMatch(/DEFEITO FÍSICO NO EQUIPAMENTO/);
    expect(t).toMatch(/NÃO siga nenhum roteiro de diagnóstico/);
    expect(t).toMatch(/NUNCA oriente abrir o equipamento, medir tensão/);
    expect(t).toMatch(/Não prometa visita técnica, prazo nem troca de equipamento/);
    expect(t).toMatch(/conclua para o setor da lista acima que cuidar de suporte/);
  });

  test('defeito físico sem identificação: só o CPF ou CNPJ antes de encaminhar', () => {
    const t = texto(estadoBase({ contencoes: sinais('a ONU não liga') }));
    expect(t).toMatch(/peça só o CPF ou CNPJ do titular/);
  });

  test('defeito físico + aviso de cidade: o defeito vence', () => {
    const t = texto(estadoBase({ identidade: TITULAR, contencoes: sinais('meu roteador queimou'), avisoCidade: { cidade: '[cidade]', mensagem: '[mensagem]' } }));
    expect(t).toMatch(/O AVISO ATIVO NÃO explica defeito físico do equipamento/);
  });

  test('defeito físico à noite: o roteiro de conexão da noite não se aplica', () => {
    const t = texto(estadoBase({ identidade: TITULAR, contencoes: sinais('meu roteador queimou'), triagem: { noturno: { ativo: true, retornoAs: '[hora]' }, forcarConclusao: false } }));
    expect(t).toMatch(/CONEXÃO À NOITE não se aplica/);
  });

  test('Wi-Fi do titular: remoto, sem painel, pede só o que falta', () => {
    const t = texto(estadoBase({ identidade: TITULAR, contencoes: sinais('quero mudar a senha do Wi-Fi') }));
    expect(t).toMatch(/ALTERAÇÃO DO WI-FI/);
    expect(t).toMatch(/a empresa faz a alteração remotamente/);
    expect(t).toMatch(/NUNCA ensine o cliente a entrar no roteador/);
    expect(t).toMatch(/Peça só a senha nova/);
    expect(t).toMatch(/Não peça data de nascimento, endereço, modelo do roteador/);
  });

  test('Wi-Fi com o valor já informado: não perguntar de novo, encaminhar', () => {
    const t = texto(estadoBase({ identidade: TITULAR, contencoes: sinais('quero mudar o nome da rede para CASA') }));
    expect(t).toMatch(/Ele já informou o nome novo da rede: NÃO pergunte de novo/);
    expect(t).not.toMatch(/Peça só/);
    expect(t).toMatch(/sem repetir a senha nova/);
  });

  test('Wi-Fi sem identificação: identificar antes', () => {
    const t = texto(estadoBase({ contencoes: sinais('quero trocar a senha do wifi') }));
    expect(t).toMatch(/identifique pelo fluxo normal \(CPF ou CNPJ\) ANTES/);
  });

  test('Wi-Fi de terceiro: recusar, sem usar a exceção de boleto/PIX', () => {
    const t = texto(estadoBase({ contencoes: sinais('quero mudar a senha do wifi dela'), terceiro: { nome: '[nome do titular]', contratos: [{ id: 77 }] } }));
    expect(t).toMatch(/só pode ser pedida pelo próprio titular/);
    expect(t).toMatch(/vale só para boleto e PIX/);
  });

  test('explicação financeira: só fonte oficial, sem cálculo nem previsão', () => {
    const t = texto(estadoBase({ identidade: TITULAR, contencoes: sinais('teve proporcional?') }));
    expect(t).toMatch(/EXPLICAÇÃO FINANCEIRA DO CONTRATO/);
    expect(t).toMatch(/NÃO calcule, NÃO deduza, NÃO preveja/);
    expect(t).toMatch(/não tem essa informação confirmada no sistema/);
    expect(t).toMatch(/conclua para o setor da lista acima que cuidar do financeiro/);
  });
});
