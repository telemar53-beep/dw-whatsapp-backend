const suporteDiagnostico = require('./suporte-diagnostico');
const suporteGeral = require('./suporte-geral');
const { estadoBase } = require('../estado-de-teste');

describe('módulo suporte-diagnostico', () => {
  describe('entra()', () => {
    // Teste literal do brief da Task 15 (Step 1): a dupla de gating dos dois
    // módulos-irmãos, testada junto porque é a interface que a Task 15 produz.
    test('suporte geral entra em qualquer estado; o diagnóstico só com identidade forte', () => {
      expect(suporteGeral.entra(estadoBase())).toBe(true);
      expect(suporteDiagnostico.entra(estadoBase())).toBe(false);
      expect(suporteDiagnostico.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });

    test('NÃO entra com cliente não identificado (nivel none)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      });
      expect(suporteDiagnostico.entra(estado)).toBe(false);
    });

    test('entra com identidade forte por telefone ou por CPF', () => {
      for (const origem of ['phone', 'cpf']) {
        const estado = estadoBase({
          identidade: { nivel: 'forte', origem, primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
        });
        expect(suporteDiagnostico.entra(estado)).toBe(true);
      }
    });

    // Pendência 2 da Task 17 (registrada pela Task 15): entra() agora exclui
    // sgpIndisponivel. Antes desta correção, "identificado pela memória com
    // SGP fora do ar" (nivel 'forte' + sgpIndisponivel: true) fazia este
    // módulo entrar JUNTO com fatos.js, que nesse mesmo estado instrui "NÃO
    // tente... status de conexão" — contradição direta com a primeira linha
    // deste módulo ("ANTES de responder, chame
    // consultar_status_todos_contratos"). Teste dos dois lados: nivel 'forte'
    // sozinho continua entrando (comportamento pré-existente, preservado);
    // nivel 'forte' + sgpIndisponivel passa a NÃO entrar (comportamento novo).
    test('NÃO entra com SGP indisponível, mesmo com identidade forte (Pendência 2 — evita contradizer fatos.js)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(suporteDiagnostico.entra(estado)).toBe(false);
    });

    test('entra com identidade forte quando sgpIndisponivel é false ou ausente', () => {
      const semCampo = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false },
      });
      expect(suporteDiagnostico.entra(semCampo)).toBe(true);
      const comFalse = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: false },
      });
      expect(suporteDiagnostico.entra(comFalse)).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const texto = () => suporteDiagnostico.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');

    // A contradição que fazia a IA perguntar o que o cliente acabou de dizer
    // (teste literal do brief da Task 15, Step 1) — a trava contra o defeito
    // voltar.
    test('o diagnóstico não obriga nenhuma frase exata nem a pergunta de três opções', () => {
      const t = texto();
      expect(t).not.toMatch(/EXATAMENTE/);
      expect(t).not.toMatch(/sem internet, com lentidão ou a conexão está caindo/i);
    });

    test('o diagnóstico diz que online não prova que a internet está boa', () => {
      const t = texto();
      expect(t).toMatch(/online/i);
      expect(t).toMatch(/não (é |significa )?prova|não trate/i);
    });

    // A mesma trava, com mais detalhe: nem o "modelo" fixo antigo nem o rótulo
    // de setor em caixa alta sobrevivem, e o princípio "online não prova"
    // cita explicitamente os cenários que o dono mandou cobrir.
    test('não sobra nenhum fragmento do modelo antigo (aspas de abertura "Entendi." nem a frase de consulta fixa)', () => {
      const t = texto();
      expect(t).not.toMatch(/"Entendi\. Vou verificar isso com você\./);
      expect(t).not.toMatch(/Me diz só uma coisa/i);
    });

    test('o princípio de "online não prova" cita lentidão, Wi-Fi fraco, oscilação, perda de pacotes, alcance e aplicativo', () => {
      const t = texto();
      expect(t).toMatch(/lentidão/);
      expect(t).toMatch(/Wi-Fi fraco/);
      expect(t).toMatch(/oscilação/);
      expect(t).toMatch(/perda de pacotes/);
      expect(t).toMatch(/alcance/);
      expect(t).toMatch(/aplicativo/);
    });

    test('cabeçalho de relato de falha não usa "SUPORTE" como rótulo de setor', () => {
      const t = texto();
      expect(t).toMatch(/RELATO DE FALHA \(internet lenta, caindo, sem acesso/);
      expect(t).not.toMatch(/\bSUPORTE\b/);
    });

    test('já normalizou é acompanhamento de falha, não pergunta de cobertura', () => {
      const t = texto();
      expect(t).toMatch(/JÁ NORMALIZOU\?/);
      expect(t).toMatch(/é ACOMPANHAMENTO de falha, não é pergunta de cobertura nem de contratação/);
    });

    test('relato de falha consulta status ANTES de responder, sem emoji', () => {
      const t = texto();
      expect(t).toMatch(/ANTES de responder, chame consultar_status_todos_contratos/);
      expect(t).toMatch(/Sem emoji\./);
    });

    test('se o cliente já disse qual é o problema, não repete a pergunta de diagnóstico', () => {
      const t = texto();
      expect(t).toMatch(/Se o cliente JÁ disse qual é o problema.*NÃO repita a pergunta de diagnóstico/);
      expect(t).toMatch(/Perguntar o que ele acabou de dizer é o pior erro de atendimento\./);
    });

    test('contrato ativo e online: acolhe, diz o que consultou e faz a próxima pergunta útil (nunca repete)', () => {
      const t = texto();
      expect(t).toMatch(/Contrato ativo e conexão online: acolha o relato em uma frase/);
      expect(t).toMatch(/faça a próxima pergunta útil para o problema que ELE já descreveu/);
      expect(t).toMatch(/NUNCA pergunte o que ele já respondeu/);
    });

    test('só pergunta o problema com as próprias palavras quando ele ainda não disse qual é', () => {
      expect(texto()).toContain('Só quando ele NÃO tiver dito qual é o problema, pergunte o que está acontecendo, com as suas palavras.');
    });

    test('conexão offline pergunta sobre os equipamentos e a luz vermelha', () => {
      const t = texto();
      expect(t).toMatch(/- Conexão offline:/);
      expect(t).toMatch(/Os equipamentos da internet estão ligados\? Tem alguma luz vermelha acesa ou piscando\?/);
    });

    test('contrato suspenso só quando o cliente RELATAR falta de acesso, nunca quando ele pediu para pagar', () => {
      const t = texto();
      expect(t).toMatch(/- Contrato suspenso por falta de pagamento, só quando ele RELATAR falta de acesso \(nunca quando ele pediu para pagar\)/);
    });

    test('contrato suspenso: pagou pede comprovante, não pagou oferece PIX ou boleto', () => {
      const t = texto();
      expect(t).toMatch(/Se ele disser que pagou, peça o comprovante/);
      expect(t).toMatch(/se disser que não pagou, ofereça o PIX ou o boleto \(entregue se ele quiser\)/);
    });

    test('o motivo de comprovante é referenciado pela lista, nunca como nome fixo "Comprovante"', () => {
      const t = texto();
      expect(t).toMatch(/o motivo da lista acima que falar de comprovante, se houver um/);
      expect(t).not.toMatch(/\bComprovante\b/);
    });

    test('depois da resposta, o roteamento segue lentidão/sem acesso/fica caindo sem repetir a pergunta', () => {
      const t = texto();
      expect(t).toMatch(/Quando ele responder à pergunta de diagnóstico/);
      expect(t).toMatch(/"lentidão" ou "está lento" leva ao roteiro de VELOCIDADE ABAIXO DA CONTRATADA/);
      expect(t).toMatch(/Em nenhum caso repita a pergunta\./);
    });

    test('sem identidade confirmada, o fluxo não cita status nenhum', () => {
      const t = texto();
      expect(t).toMatch(/Sem identidade confirmada, este fluxo de diagnóstico não cita status nenhum/);
    });

    test('nunca nomeia um setor fixo como string literal', () => {
      expect(texto()).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
    });

    test('nunca afirma o que a operação oferece (fibra, grátis, ilimitado) — só as instruções do painel podem', () => {
      const t = texto();
      expect(t).not.toMatch(/fibra/i);
      expect(t).not.toMatch(/óptica/i);
      expect(t).not.toMatch(/grátis/i);
      expect(t).not.toMatch(/gratuit/i);
      expect(t).not.toMatch(/ilimitad/i);
    });

    test('nunca contém preço real (R$ seguido de número) nem velocidade real (dígito + mega)', () => {
      const t = texto();
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
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
  });
});
