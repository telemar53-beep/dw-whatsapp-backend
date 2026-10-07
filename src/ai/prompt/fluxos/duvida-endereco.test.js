const modulo = require('./duvida-endereco');
const { estadoBase } = require('../estado-de-teste');
const { montarContexto } = require('../montar');

const DUVIDA = (motivo) => ({ nome: null, contratos: [], pendente: true, alvoPendente: motivo });
const texto = (terceiro) => modulo.linhas(estadoBase({ terceiro })).join('\n');

describe('fluxos/duvida-endereco (revisão do v4, 07/10/2026, achado A4)', () => {
  test('só entra com a dúvida de endereço gravada (pendente sem contrato de terceiro)', () => {
    expect(modulo.entra(estadoBase())).toBe(false);
    expect(modulo.entra(estadoBase({ terceiro: DUVIDA('endereco_desconhecido') }))).toBe(true);
    expect(modulo.entra(estadoBase({ terceiro: DUVIDA('endereco_ambiguo') }))).toBe(true);
    expect(modulo.entra(estadoBase({ terceiro: DUVIDA('outra_pessoa_sem_documento') }))).toBe(false);
    expect(modulo.entra(estadoBase({ terceiro: { nome: 'Fulana', contratos: [{ id: 501 }], alvoPendente: 'endereco_desconhecido' } }))).toBe(false);
  });

  test('pergunta o endereço citando os contratos dele, diz que não é pedido de outra pessoa e proíbe pedir CPF ou enviar agora', () => {
    for (const motivo of ['endereco_desconhecido', 'endereco_ambiguo']) {
      const t = texto(DUVIDA(motivo));
      expect(t).toMatch(/de qual endereço/);
      expect(t).toMatch(/NÃO é pedido de outra pessoa/);
      expect(t).toMatch(/NÃO peça CPF ou CNPJ/);
      expect(t).toMatch(/NÃO envie nada/);
      expect(t).toMatch(/Só se ele disser que a cobrança é de outra pessoa/);
    }
  });

  test('entra no prompt montado da triagem só com a dúvida', () => {
    expect(montarContexto(estadoBase({ terceiro: DUVIDA('endereco_desconhecido') }))).toMatch(/DÚVIDA DE ENDEREÇO/);
    expect(montarContexto(estadoBase())).not.toMatch(/DÚVIDA DE ENDEREÇO/);
  });
});
