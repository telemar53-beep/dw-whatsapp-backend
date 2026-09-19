const comprovante = require('./comprovante');
const { estadoBase } = require('../estado-de-teste');

describe('módulo comprovante', () => {
  describe('entra()', () => {
    // CORREÇÃO (Rodada de correção 1, coordenador, 2026-09-18): o teste
    // literal do brief/plano original ("só entra quando a ferramenta está
    // na lista") testava a interface ERRADA — o original é um ternário que
    // SEMPRE emite um dos dois textos, nunca nenhum. Gatear entra() pela
    // ferramenta fazia o ramo "sem ferramenta" (o padrão de fábrica, de dia)
    // nunca ser migrado, uma regressão real medida pelo coordenador. entra()
    // agora é sempre true; o que muda com a ferramenta é o CONTEÚDO — ver
    // describe('conteúdo') abaixo.
    test('entra sempre, com ou sem a ferramenta na lista do turno', () => {
      expect(comprovante.entra(estadoBase({ ferramentas: ['buscar_cliente'] }))).toBe(true);
      expect(comprovante.entra(estadoBase({ ferramentas: ['analisar_comprovante'] }))).toBe(true);
      expect(comprovante.entra(estadoBase())).toBe(true);
    });
  });

  describe('conteúdo', () => {
    // Teste literal do brief/plano da Task 17 (Step 1) — continua válido: a
    // orientação de cliente não identificado é comum aos dois ramos.
    test('o comprovante de cliente não identificado pede o documento, nunca outro dado', () => {
      const texto = comprovante.linhas(estadoBase({ ferramentas: ['analisar_comprovante'] })).join('\n');
      expect(texto).toMatch(/CPF ou CNPJ/);
      expect(texto).not.toMatch(/nascimento|titularidade/i);
    });

    // O caso que estava sumindo (achado do coordenador): sem a ferramenta no
    // turno — o padrão de fábrica de dia, já que triageReadReceiptsDaytime
    // sai desligado — o modelo ainda precisa de uma orientação para a
    // imagem, mesmo sem poder analisá-la.
    test('sem a ferramenta na lista do turno, pergunta se é comprovante e classifica sem confirmar pagamento', () => {
      const t = comprovante.linhas(estadoBase({ ferramentas: ['buscar_cliente'] })).join('\n');
      expect(t).toMatch(/Se o cliente enviou uma imagem, pergunte se é um comprovante/);
      expect(t).toMatch(/sem confirmar pagamento/);
      expect(t).not.toMatch(/analisar_comprovante/);
      expect(t).not.toMatch(/COMPROVANTE À NOITE/);
      expect(t).not.toMatch(/^COMPROVANTE:/m);
    });

    test('sem a ferramenta, o texto é o mesmo de dia ou de noite (a distinção só existe com a ferramenta presente)', () => {
      const semFerramentaDia = comprovante.linhas(estadoBase({
        ferramentas: ['buscar_cliente'],
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      const semFerramentaNoite = comprovante.linhas(estadoBase({
        ferramentas: ['buscar_cliente'],
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(semFerramentaDia).toBe(semFerramentaNoite);
    });

    const comFerramenta = (extra = {}) => estadoBase({ ferramentas: ['buscar_cliente', 'analisar_comprovante'], ...extra });

    test('de noite, com a ferramenta, o texto é o COMPROVANTE À NOITE, com desbloqueio em confiança', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/COMPROVANTE À NOITE/);
      expect(t).toMatch(/desbloqueio_confianca/);
      expect(t).not.toMatch(/^COMPROVANTE:/m);
    });

    test('de dia, com a ferramenta, o texto é o COMPROVANTE diurno, sem desbloqueio em confiança', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/COMPROVANTE:/);
      expect(t).not.toMatch(/COMPROVANTE À NOITE/);
      expect(t).not.toMatch(/desbloqueio_confianca/);
    });

    test('a frase pós-execução do desbloqueio (EXATAMENTE) é a exceção legítima — só existe à noite, com a ferramenta', () => {
      const noite = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(noite).toMatch(/responda EXATAMENTE com a frase que ela devolver/);

      const dia = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      expect(dia).not.toMatch(/EXATAMENTE/);

      const semFerramenta = comprovante.linhas(estadoBase({ ferramentas: ['buscar_cliente'] })).join('\n');
      expect(semFerramenta).not.toMatch(/EXATAMENTE/);
    });

    test('nunca diz "pagamento confirmado" ou "acesso liberado" sem a ferramenta confirmar', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/NUNCA diga "pagamento confirmado" nem "acesso liberado" sem a ferramenta ter devolvido liberado: true/);
    });

    test('o motivo de comprovante é referenciado pela lista, nunca como nome fixo "Comprovante"', () => {
      const estados = [
        estadoBase({ ferramentas: ['buscar_cliente'] }),
        comFerramenta({ triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false } }),
        comFerramenta({ triagem: { noturno: { ativo: false }, forcarConclusao: false } }),
      ];
      for (const estado of estados) {
        const t = comprovante.linhas(estado).join('\n');
        expect(t).toMatch(/o motivo da lista acima que falar de comprovante, se houver um/);
        expect(t).not.toMatch(/\bComprovante\b/);
      }
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo) como Financeiro', () => {
      const estados = [
        estadoBase({ ferramentas: ['buscar_cliente'] }),
        comFerramenta({ triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false } }),
        comFerramenta({ triagem: { noturno: { ativo: false }, forcarConclusao: false } }),
      ];
      for (const estado of estados) {
        const t = comprovante.linhas(estado).join('\n');
        expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
        expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
      }
    });

    test('nunca contém nome real de cliente, preço ou velocidade real', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).not.toMatch(/Willemberg/);
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/nascimento/i);
    });

    // Rodada de correção 3 (Task 17, critério nº 9 do dono: toda regra
    // migrada do construtor antigo precisa de um teste comportamental
    // correspondente). Os testes acima de COMPROVANTE À NOITE travam só o
    // RÓTULO da linha — uma cláusula de dentro dela podia ser apagada sem
    // nada ficar vermelho. Este trava a CLÁUSULA.
    test('à noite, se a ferramenta devolver jaUtilizado, o cliente não é informado disso nem de outro contrato', () => {
      // A mais sensível das quatro cláusulas desta rodada: protege a privacidade de OUTRO contrato.
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/jaUtilizado: true/);
      expect(t).toMatch(/NÃO diga isso ao cliente/);
      expect(t).toMatch(/nem cite outro contrato/);
    });

    // Mesmo critério nº 9, para o ramo diurno: trava a cláusula, não só o
    // rótulo "COMPROVANTE:".
    test('de dia, se o comprovante já foi utilizado, o cliente não é informado disso; a equipe confere e dá baixa', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/já foi utilizado/);
      expect(t).toMatch(/NÃO diga isso ao cliente/);
      expect(t).toMatch(/a equipe confere e dá baixa/);
    });

    // ===================================================================
    // Task 18 — asserts migrados de ai-orchestrator.test.js
    // ===================================================================
    // Os testes acima travam o rótulo e o desfecho de cada ramo. Estes três
    // trazem as lições que os asserts do construtor antigo guardavam e que
    // nenhum teste de módulo ainda cobria.

    // Antes: ai-orchestrator.test.js:559 e :624 ("chame analisar_comprovante"),
    // :623 ("COMPROVANTE: se o cliente enviar uma imagem") e :633 (de dia, com
    // a flag ligada, a linha antiga "pergunte se é um comprovante" NÃO
    // aparece). Print 2026-09-17: perguntar antes de ler é exatamente o que a
    // ferramenta elimina — a ordem de ação é ler primeiro, perguntar nunca.
    test('com a ferramenta, a imagem é lida pela ferramenta ANTES de qualquer pergunta (de dia e de noite)', () => {
      for (const triagem of [
        { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
        { noturno: { ativo: false }, forcarConclusao: false },
      ]) {
        const t = comprovante.linhas(comFerramenta({ triagem })).join('\n');
        expect(t).toMatch(/se o cliente enviar uma imagem e disser \(ou parecer\) que é o pagamento, chame analisar_comprovante \(sem perguntar nada antes\)/);
        expect(t).not.toMatch(/pergunte se é um comprovante/);
      }
    });

    // Antes: ai-orchestrator.test.js:625 e :629. De dia há atendente e a
    // liberação em confiança é decisão de gente: o ramo diurno não pode nem
    // prometer liberação nem sequer citar desbloqueio.
    test('de dia, com a ferramenta, não confirma pagamento, não promete liberação e não cita desbloqueio', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/NÃO confirme pagamento nem prometa liberação/);
      expect(t).not.toMatch(/desbloqueio/i);
    });

    // Antes: ai-orchestrator.test.js:1333-1334. Print 2026-09-17 (17:53): o
    // comprovante de cliente não identificado virou pedido de data de
    // nascimento. O documento é o único dado pedido, e a frase diz POR QUÊ —
    // sem cadastro localizado não existe conferência.
    test('cliente não identificado: só o documento é pedido, e a frase diz por que ele é indispensável', () => {
      const t = comprovante.linhas(estadoBase()).join('\n');
      expect(t).toMatch(/COMPROVANTE DE CLIENTE NÃO IDENTIFICADO: peça o CPF ou CNPJ primeiro, nunca outro dado/);
      expect(t).toMatch(/Sem o cadastro localizado não há o que conferir/);
    });
  });
});
