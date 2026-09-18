const financeiro = require('./financeiro');
const { estadoBase } = require('../estado-de-teste');

describe('módulo financeiro', () => {
  describe('entra()', () => {
    test('NÃO entra sem identidade confirmada', () => {
      expect(financeiro.entra(estadoBase())).toBe(false);
    });

    test('entra com identidade forte', () => {
      expect(financeiro.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const identificado = (extra = {}) => estadoBase({
      identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
      contratos: [{ id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço]', status: 'ativo' }],
      ...extra,
    });
    const texto = (extra) => financeiro.linhas(identificado(extra)).join('\n');

    test('pedido de pagamento tem prioridade sobre diagnóstico', () => {
      const t = texto();
      expect(t).toMatch(/PEDIDO DE PAGAMENTO/);
      expect(t).toMatch(/tem prioridade sobre qualquer roteiro de diagnóstico/);
      expect(t).toMatch(/NUNCA pergunte "você chegou a fazer esse pagamento\?" a quem acabou de dizer que quer pagar/);
    });

    test('identidade já confirmada: não pede CPF, entrega direto por ferramenta', () => {
      const t = texto();
      expect(t).toMatch(/NÃO peça CPF/);
      expect(t).toMatch(/enviar_boleto ou gerar_pix/);
    });

    test('sem motivo de encerramento configurado, sempre conclui para o financeiro depois de entregar', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: null } });
      expect(t).toMatch(/entregue com enviar_boleto ou gerar_pix e depois conclua a triagem para o setor da lista acima que cuidar do financeiro/);
    });

    describe('com motivo de encerramento configurado (triageResolvedReasonId)', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });

      test('não conclui a triagem no momento da entrega', () => {
        expect(t).toMatch(/NÃO conclua a triagem nesse momento/);
      });

      test('a frase de entrega vem do retorno da ferramenta, nunca de um texto fixo do prompt', () => {
        expect(t).toMatch(/responda EXATAMENTE no modelo que a ferramenta devolver no campo instrucao/);
        expect(t).toMatch(/NUNCA diga que enviou o boleto ou o PIX antes de a ferramenta confirmar o envio/);
      });

      test('despedida usa marcador de nome, nunca o nome real', () => {
        expect(t).toMatch(/Imagina, \[nome\]! 😊 Qualquer dúvida/);
        expect(t).toMatch(/Imagina, \[nome\]! Qualquer dúvida…/);
        expect(t).not.toMatch(/Willemberg/);
      });

      test('despedida do boleto não tem emoji; a das demais tem', () => {
        expect(t).toMatch(/No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji/);
      });

      test('encerra também quando o cliente só confirma com "ok" ou joinha', () => {
        expect(t).toMatch(/Se responder só "ok", "certo" ou um joinha: chame encerrar_atendimento/);
      });
    });

    test('pedido de boleto/PIX com mais de um contrato só aparece com mais de um contrato', () => {
      const doisContratos = texto({
        contratos: [
          { id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço 1]', status: 'ativo' },
          { id: 2, plano: '[plano]', velocidade: null, endereco: '[endereço 2]', status: 'suspenso' },
        ],
      });
      expect(doisContratos).toMatch(/Pedido de boleto ou PIX com mais de um contrato/);
      expect(doisContratos).toMatch(/consultar_faturas_todos_contratos ANTES de perguntar qualquer coisa/);

      const umContrato = texto();
      expect(umContrato).not.toMatch(/Pedido de boleto ou PIX com mais de um contrato/);
    });

    test('sem fatura em aberto em nenhum contrato: avisa sem valor e conclui sem perguntar', () => {
      const t = texto();
      expect(t).toMatch(/Se a ferramenta responder que não há fatura em aberto em nenhum contrato/);
      expect(t).toMatch(/não pergunte se ele quer ser encaminhado/);
      expect(t).toMatch(/chame concluir_triagem para o setor da lista acima que cuidar do financeiro/);
    });

    test('cliente suspenso perguntando se a internet volta depois de pagar: confirma sem prometer prazo', () => {
      const t = texto();
      expect(t).toMatch(/assim que o pagamento for confirmado, o acesso é liberado automaticamente/);
      expect(t).toMatch(/NUNCA prometa prazo/);
      expect(t).toMatch(/nunca diga que o pagamento foi confirmado/);
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo) como Financeiro', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
    });

    test('nunca contém nome real de cliente', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/Willemberg/);
    });

    test('nunca cita preço ou velocidade real, nem reintroduz nascimento/identidade fraca/gate de confiança', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/nascimento/i);
      expect(t).not.toMatch(/identidade fraca/i);
      expect(t).not.toMatch(/gate de confiança/i);
    });
  });
});
