const formato = require('./formato');
const { estadoBase } = require('./estado-de-teste');

describe('módulo formato', () => {
  test('entra sempre, independente do estado', () => {
    expect(formato.entra(estadoBase())).toBe(true);
  });

  test('emite a linha de formatação do WhatsApp uma única vez', () => {
    const linhas = formato.linhas(estadoBase());
    const ocorrencias = linhas.filter((l) => l.includes('Formatação: WhatsApp'));
    expect(ocorrencias).toHaveLength(1);
    expect(ocorrencias[0]).toContain('Negrito com *um asterisco*. Nunca markdown.');
    expect(ocorrencias[0]).toContain('Responda uma vez só: nunca repita uma frase ou parágrafo que você já escreveu.');
  });
});
