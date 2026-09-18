const noturno = require('./noturno');
const { estadoBase } = require('../estado-de-teste');

describe('módulo noturno', () => {
  describe('entra()', () => {
    // Teste literal do brief/plano da Task 17 (Step 1, adaptado do test.each combinado).
    test('entra só com o modo noturno ativo', () => {
      expect(noturno.entra(estadoBase())).toBe(false);
      expect(noturno.entra(estadoBase({ triagem: { noturno: { ativo: true, retornoAs: '08:00' } } }))).toBe(true);
    });

    test('não entra quando triagem.noturno.ativo é false explicitamente', () => {
      const estado = estadoBase({ triagem: { noturno: { ativo: false }, forcarConclusao: false } });
      expect(noturno.entra(estado)).toBe(false);
    });
  });

  describe('conteúdo', () => {
    const texto = (retornoAs = '08:00') => noturno.linhas(estadoBase({
      triagem: { noturno: { ativo: true, retornoAs }, forcarConclusao: false },
    })).join('\n');

    test('modo noturno avisa que não há atendente e nunca promete solução imediata, técnico ou prazo', () => {
      const t = texto();
      expect(t).toMatch(/MODO NOTURNO: estamos fora do horário comercial e NÃO há atendente agora/);
      expect(t).toMatch(/Nunca prometa solução imediata, técnico ou prazo\./);
    });

    test('a hora de retorno interpolada aparece na frase de "a equipe volta às"', () => {
      const t = texto('09:30');
      expect(t).toMatch(/A equipe volta às 09:30\./);
    });

    test('ao concluir para qualquer setor à noite, usa a frase padrão de continuidade', () => {
      const t = texto('08:00');
      expect(t).toMatch(/diga que "nossa equipe dá continuidade a partir das 08:00" — nunca "um atendente continua daqui"/);
    });

    test('conexão à noite: até duas etapas simples de religar o equipamento', () => {
      const t = texto();
      expect(t).toMatch(/CONEXÃO À NOITE/);
      expect(t).toMatch(/Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo\?/);
      expect(t).toMatch(/A luz voltou a ficar verde\?/);
    });

    test('conexão à noite: contrato suspenso remete ao roteiro do suspenso e do comprovante', () => {
      const t = texto();
      expect(t).toMatch(/Contrato suspenso por pendência: roteiro do suspenso e, se vier comprovante, o roteiro do comprovante\./);
    });

    // Rodada de correção 3 (Task 17, critério nº 9 do dono: toda regra
    // migrada do construtor antigo precisa de um teste comportamental
    // correspondente). O teste acima trava só o RÓTULO "CONEXÃO À NOITE" —
    // uma cláusula de dentro da linha podia ser apagada sem nada ficar
    // vermelho. Este trava as duas cláusulas de desfecho.
    test('conexão à noite: se resolver fica registrado; se não resolver, não promete técnico nem prazo', () => {
      const t = texto();
      expect(t).toMatch(/ficou registrado que a conexão voltou/);
      expect(t).toMatch(/Sem prometer técnico nem prazo/);
    });

    test('o script de fila dirigido ao cliente não nomeia o setor de suporte', () => {
      const t = texto('08:00');
      expect(t).toMatch(/"Vou deixar seu atendimento na fila com tudo o que verificamos\. Nossa equipe dá continuidade a partir das 08:00\."/);
      expect(t).not.toMatch(/fila do Suporte/);
    });

    // Pendência 3, Rodada de correção 1 (coordenador): o encaminhamento
    // comercial noturno SAIU deste módulo — as duas metades (dia e noite)
    // agora moram juntas em comercial-novo.js/comercial-cliente.js. Este
    // teste prova a ausência (ver noturno.js para a justificativa completa;
    // os testes da frase em si estão em comercial-novo.test.js e
    // comercial-cliente.test.js).
    test('não encaminha para vendas — isso mora em comercial-novo.js/comercial-cliente.js', () => {
      const t = texto();
      expect(t).not.toMatch(/Ao encaminhar/);
      expect(t).not.toMatch(/Resumo: plano de interesse/);
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo)', () => {
      const t = texto();
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
    });

    test('nunca contém nome real de cliente, preço ou velocidade real, nem afirma oferta da operação', () => {
      const t = texto();
      expect(t).not.toMatch(/Willemberg/);
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/fibra|óptica|grátis|gratuit|ilimitad/i);
    });
  });
});
