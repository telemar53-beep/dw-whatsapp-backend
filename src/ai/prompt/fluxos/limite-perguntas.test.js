const limitePerguntas = require('./limite-perguntas');
const { estadoBase } = require('../estado-de-teste');

describe('módulo limite-perguntas', () => {
  describe('entra()', () => {
    // Teste literal do brief/plano da Task 17 (Step 1, adaptado do test.each combinado).
    test('entra só com forcarConclusao ativo', () => {
      expect(limitePerguntas.entra(estadoBase())).toBe(false);
      expect(limitePerguntas.entra(estadoBase({ triagem: { noturno: { ativo: false }, forcarConclusao: true } }))).toBe(true);
    });

    test('não entra com forcarConclusao false explícito', () => {
      const estado = estadoBase({ triagem: { noturno: { ativo: false }, forcarConclusao: false } });
      expect(limitePerguntas.entra(estado)).toBe(false);
    });

    test('entra independente do modo noturno', () => {
      const estado = estadoBase({ triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: true } });
      expect(limitePerguntas.entra(estado)).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const base = { triagem: { noturno: { ativo: false }, forcarConclusao: true } };
    const texto = (extra = {}) => limitePerguntas.linhas(estadoBase({ ...base, ...extra })).join('\n');

    test('proíbe qualquer pergunta nova ao cliente', () => {
      const t = texto();
      expect(t).toMatch(/LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente\./);
    });

    test('responde a pergunta pendente do cliente antes de encaminhar', () => {
      const t = texto();
      expect(t).toMatch(/Se ele fez uma pergunta nesta mensagem, responda-a ANTES de dizer que está encaminhando, na mesma mensagem\./);
    });

    test('sem motivo de encerramento configurado: entrega por ferramenta e conclui a triagem', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: null } });
      expect(t).toMatch(/entregue AGORA \(enviar_boleto ou gerar_pix\) e em seguida chame concluir_triagem/);
    });

    test('com motivo de encerramento configurado: entrega e encerra sozinha, sem depender do humano', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).toMatch(/entregue AGORA e chame encerrar_atendimento, dizendo que qualquer outra coisa é só chamar de novo/);
    });

    test('nunca nomeia um setor ou motivo fixo', () => {
      for (const triageResolvedReasonId of [null, 'r1']) {
        const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId } });
        expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
        expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
      }
    });

    test('nunca contém nome real de cliente, preço ou velocidade real', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/Willemberg/);
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
    });
  });
});
