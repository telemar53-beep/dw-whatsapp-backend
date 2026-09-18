const comercialCliente = require('./comercial-cliente');
const { estadoBase } = require('../estado-de-teste');

describe('módulo comercial-cliente', () => {
  describe('entra()', () => {
    test('NÃO entra sem identidade confirmada', () => {
      expect(comercialCliente.entra(estadoBase())).toBe(false);
    });

    test('entra com identidade forte', () => {
      expect(comercialCliente.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });

    // Rodada de correção 1 da Task 17 (coordenador, 2026-09-18): mesma
    // correção já aplicada a suporte-diagnostico.js, estendida aqui — com o
    // SGP fora do ar, fatos.js manda não tentar boleto, PIX nem status, e
    // este módulo (upgrade, mudança de endereço) pressupõe justamente isso.
    test('NÃO entra com SGP indisponível, mesmo com identidade forte', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(comercialCliente.entra(estado)).toBe(false);
    });

    test('entra com identidade forte quando sgpIndisponivel é false ou ausente', () => {
      expect(comercialCliente.entra(estadoBase({ identidade: { nivel: 'forte', sgpIndisponivel: false } }))).toBe(true);
      expect(comercialCliente.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const texto = (extra = {}) => comercialCliente.linhas(estadoBase({ identidade: { nivel: 'forte' }, ...extra })).join('\n');

    // Teste literal do brief (task-16-brief.md, Step 1): a trava contra o
    // hardcode mais grave do diagnóstico inteiro voltar.
    test('o comercial de cliente identificado não traz tabela de preços', () => {
      const t = texto();
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d{3}\s*Mega/i);
      expect(t).toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO/);
    });

    // Teste literal do brief.
    test('o comercial manda parar de vender quando o cliente já escolheu', () => {
      const t = texto();
      expect(t).toMatch(/já escolheu|não liste os planos de novo/i);
    });

    // Regressão dedicada: as três linhas reais que existiam no código antigo
    // (500/600/800 Mega, R$ 100/135/185) nunca podem reaparecer, nem por
    // engano numa reescrita futura.
    test('as linhas reais da tabela antiga (500/600/800 Mega, R$ 100/135/185) não existem mais', () => {
      const t = texto();
      expect(t).not.toMatch(/500\s*Mega/i);
      expect(t).not.toMatch(/600\s*Mega/i);
      expect(t).not.toMatch(/800\s*Mega/i);
      expect(t).not.toMatch(/100\/mês|135\/mês|185\/mês/);
    });

    test('planos só aparecem quando o cliente pede preço ou upgrade com todas as letras', () => {
      const t = texto();
      expect(t).toMatch(/pede preço ou upgrade com todas as letras/);
      expect(t).toMatch(/Cliente com contrato nunca recebe a lista de planos, a menos que peça preço ou upgrade com todas as letras/);
    });

    test('cidade e endereço são o ponto que ele já tem, não cobertura nova', () => {
      expect(texto()).toMatch(/cidade e endereço são o ponto que ele já tem, não cobertura nova/);
    });

    test('o bloco de planos é copiado literalmente das instruções do painel', () => {
      expect(texto()).toMatch(/apresente os planos copiando o bloco das INSTRUÇÕES ADICIONAIS DA OPERAÇÃO exatamente como está lá/);
    });

    test('recomendação é consultiva: entende a necessidade antes, nunca empurra o mais caro nem inventa vantagem', () => {
      const t = texto();
      expect(t).toMatch(/Antes de recomendar, entenda a necessidade/);
      expect(t).toMatch(/Nunca empurre o mais caro/);
      expect(t).toMatch(/nunca invente vantagem que não esteja nas instruções/);
    });

    test('mudança de endereço é transferência do ponto; prazo, custo e disponibilidade não são inventados', () => {
      const t = texto();
      expect(t).toMatch(/MUDANÇA DE ENDEREÇO/);
      expect(t).toMatch(/isso é a transferência do ponto/);
      expect(t).toMatch(/Prazo, custo e disponibilidade quem confirma é esse setor: não invente nenhum dos três/);
    });

    test('o script de mudança de endereço dirigido ao cliente não nomeia nenhum setor', () => {
      // "Para o Comercial já adiantar" no original virou "Para já adiantar":
      // nenhuma fala dirigida ao cliente, em nenhum módulo já migrado, cita
      // o nome de um setor.
      const t = texto();
      expect(t).toMatch(/Para já adiantar, me diz o novo endereço/);
    });

    // Rodada de correção 1 da Task 17 (coordenador): este módulo também
    // encaminha para vendas (upgrade, mudança de endereço), então ganhou a
    // mesma frase-modelo dia x noite que comercial-novo.js tem, centralizada
    // nos módulos comerciais em vez de partida com noturno.js.
    describe('frase-modelo de encaminhamento ao setor de vendas (dia x noite)', () => {
      test('de dia, o modelo diz que um atendente continua por aqui, sem menção a horário', () => {
        const t = texto({ triagem: { noturno: { ativo: false }, forcarConclusao: false } });
        expect(t).toMatch(/Vou encaminhar você\. Um atendente continuará o atendimento por aqui\./);
        expect(t).not.toMatch(/fora do horário de atendimento/);
      });

      test('à noite, o modelo avisa que está fora do horário e a conversa fica registrada', () => {
        const t = texto({ triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false } });
        expect(t).toMatch(/No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar\./);
        expect(t).not.toMatch(/Um atendente continuará o atendimento por aqui\./);
      });
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo) como Comercial', () => {
      const t = texto();
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
      // Categoria específica que a guarda geral não cobre (setor em
      // minúscula) — aqui é convenção sancionada ("o setor da lista acima
      // que cuidar de vendas"), não vazamento; ainda assim, a forma
      // problemática citada no achado da Task 16 ("setor comercial", vinda
      // do texto sugerido pelo brief) não pode sobreviver.
      expect(t).not.toMatch(/setor comercial\b/i);
    });

    test('nunca contém nome real de cliente', () => {
      expect(texto()).not.toMatch(/Willemberg/);
    });

    test('nunca reintroduz data de nascimento, identidade fraca ou gate de confiança', () => {
      const t = texto();
      expect(t).not.toMatch(/nascimento/i);
      expect(t).not.toMatch(/identidade fraca/i);
      expect(t).not.toMatch(/gate de confiança/i);
    });

    test('nunca afirma o que a operação oferece (fibra, grátis, ilimitado) — só as instruções do painel podem', () => {
      const t = texto();
      expect(t).not.toMatch(/fibra/i);
      expect(t).not.toMatch(/óptica/i);
      expect(t).not.toMatch(/grátis/i);
      expect(t).not.toMatch(/gratuit/i);
      expect(t).not.toMatch(/ilimitad/i);
    });
  });
});
