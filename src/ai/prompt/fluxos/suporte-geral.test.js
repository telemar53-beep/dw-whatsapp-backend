const suporteGeral = require('./suporte-geral');
const { estadoBase } = require('../estado-de-teste');

describe('módulo suporte-geral', () => {
  describe('entra()', () => {
    test('entra com cliente não identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      });
      expect(suporteGeral.entra(estado)).toBe(true);
    });

    test('entra também com cliente identificado (identidade forte)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
        contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
      });
      expect(suporteGeral.entra(estado)).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const texto = () => suporteGeral.linhas(estadoBase()).join('\n');

    test('dúvida não é falha: não chama nem cita status, responde direto', () => {
      const t = texto();
      expect(t).toMatch(/DÚVIDA não é falha/);
      expect(t).toMatch(/NÃO chame status, NÃO cite status/);
    });

    test('alcance do Wi-Fi: perda ao se afastar é normal, nunca promete visita técnica nem equipamento', () => {
      const t = texto();
      expect(t).toMatch(/ALCANCE DO WI-FI/);
      expect(t).toMatch(/é o alcance normal do Wi-Fi/);
      expect(t).toMatch(/Nunca prometa visita técnica nem equipamento\./);
    });

    test('velocidade abaixo da contratada: pede teste perto do equipamento, nunca confirma sem teste', () => {
      const t = texto();
      expect(t).toMatch(/VELOCIDADE ABAIXO DA CONTRATADA/);
      expect(t).toMatch(/você consegue fazer um teste de velocidade perto do equipamento\?/);
      expect(t).toMatch(/NUNCA diga que a velocidade está correta sem teste, nem prometa técnico\./);
    });

    test('o exemplo de reconhecimento de velocidade usa marcador, nunca número real', () => {
      const t = texto();
      expect(t).toContain('contratei [velocidade] e aparece bem menos');
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/contratei 500/);
    });

    test('reembolso, desconto ou abatimento: nunca promete nem recusa, quem decide é a equipe', () => {
      const t = texto();
      expect(t).toMatch(/REEMBOLSO, DESCONTO OU ABATIMENTO/);
      expect(t).toMatch(/nunca prometa e nunca recuse — quem decide é a equipe/);
    });

    test('mudar o equipamento de lugar: cliente mesmo pode fazer, sem consultar status', () => {
      const t = texto();
      expect(t).toMatch(/MUDAR O EQUIPAMENTO DE LUGAR: responda direto, sem consultar status/);
      expect(t).toMatch(/você mesmo pode fazer/);
    });

    test('problema já relatado sem roteiro próprio: parte do que o cliente disse, não usa lista fixa', () => {
      const t = texto();
      expect(t).toMatch(/PROBLEMA JÁ RELATADO SEM ROTEIRO PRÓPRIO/);
      expect(t).toMatch(/NÃO use a lista fixa de diagnóstico/);
    });

    test('senha ou QR code do próprio Wi-Fi: pedido normal, nunca tratado como dado de outra pessoa', () => {
      const t = texto();
      expect(t).toMatch(/SENHA OU QR CODE DO WI-FI DO PRÓPRIO CLIENTE/);
      expect(t).toMatch(/Nunca trate isso como dado de outra pessoa\./);
    });

    test('piora em horário certo: reconhece o padrão, não trata como falha geral', () => {
      const t = texto();
      expect(t).toMatch(/PIORA EM HORÁRIO CERTO/);
      expect(t).toMatch(/não trate como falha geral/);
    });

    test('equipamento na casa de outra pessoa: é alcance de Wi-Fi, não falha', () => {
      const t = texto();
      expect(t).toMatch(/EQUIPAMENTO NA CASA DE OUTRA PESSOA/);
      expect(t).toMatch(/é alcance de Wi-Fi, não falha/);
    });

    test('dados móveis: avisa que não é a internet da casa antes de qualquer diagnóstico', () => {
      const t = texto();
      expect(t).toMatch(/DADOS MÓVEIS \(2G, 3G, 4G, 5G\)/);
      expect(t).toMatch(/teste conectado ao Wi-Fi antes de qualquer diagnóstico/);
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

    test('nunca contém preço real (R$ seguido de número)', () => {
      expect(texto()).not.toMatch(/R\$\s*\d/);
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
