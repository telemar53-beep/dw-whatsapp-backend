const { temAlfabetoEstranho, semAlfabetoEstranho } = require('./idioma');

// Teste real 2026-09-15 (produção, gpt-5.4-mini): "Boa noite, Willemberg! كيف
// posso ajudar você hoje?" — uma palavra em árabe no meio da saudação. Não foi
// a primeira vez. O prompt-base já pede português; a garantia é aqui.
describe('idioma', () => {
  describe('temAlfabetoEstranho', () => {
    test('acha letra de outro alfabeto no meio do português', () => {
      expect(temAlfabetoEstranho('Boa noite, Willemberg! كيف posso ajudar você hoje?')).toBe(true);
      expect(temAlfabetoEstranho('Seu boleto está 准备好 para pagamento.')).toBe(true);
      expect(temAlfabetoEstranho('Привет! Como posso ajudar?')).toBe(true);
      expect(temAlfabetoEstranho('Olá, Δημήτρης!')).toBe(true);
    });

    test('português com acentos, emoji, números, URL e código PIX passam', () => {
      expect(temAlfabetoEstranho('Boa noite, Willemberg! 😊 Como posso ajudar você hoje?')).toBe(false);
      expect(temAlfabetoEstranho('Ação, coração, pão, Cândido Mendes/MA — R$ 5,00 até 16/09/2026.')).toBe(false);
      expect(temAlfabetoEstranho('00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
      expect(temAlfabetoEstranho('Link: https://sgp.exemplo.com/boleto?x=1_2&y=3')).toBe(false);
      expect(temAlfabetoEstranho('')).toBe(false);
      expect(temAlfabetoEstranho(null)).toBe(false);
    });
  });

  describe('semAlfabetoEstranho', () => {
    test('remove a palavra estranha e ajusta os espaços', () => {
      expect(semAlfabetoEstranho('Boa noite, Willemberg! كيف posso ajudar você hoje?')).toBe('Boa noite, Willemberg! posso ajudar você hoje?');
    });

    test('remove diacríticos que acompanham a letra estranha e não deixa espaço antes da pontuação', () => {
      expect(semAlfabetoEstranho('Seu boleto está 准备好, tudo certo.')).toBe('Seu boleto está, tudo certo.');
      expect(semAlfabetoEstranho('Olá كِيف!')).toBe('Olá!');
    });

    test('texto limpo volta igual', () => {
      const limpo = 'Boa noite, Willemberg! Como posso ajudar você hoje?';
      expect(semAlfabetoEstranho(limpo)).toBe(limpo);
      expect(semAlfabetoEstranho(null)).toBeNull();
    });
  });
});
