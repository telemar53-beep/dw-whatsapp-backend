import { describe, test, expect } from 'vitest';
import { describeReason, normalizeReasonName } from './closeReasonCatalog';

describe('closeReasonCatalog', () => {
  test('acha o motivo pelo nome ignorando acento, caixa e espaços extras', () => {
    expect(normalizeReasonName('  Mudança  de Endereço ')).toBe('mudanca de endereco');
    expect(describeReason('SUPORTE TÉCNICO').hint).toBe('Dúvidas, problemas técnicos');
    expect(describeReason('instalacao').hint).toBe('Nova instalação');
  });

  test('motivo fora do catálogo ganha ícone neutro e nenhuma legenda', () => {
    const look = describeReason('Visita comercial');
    expect(look.hint).toBeNull();
    expect(look.icon).toBeTruthy();
    expect(look.color).toMatch(/^#/);
  });

  test('cada motivo do catálogo tem uma cor própria e uma legenda', () => {
    const names = ['Cancelamento', 'Financeiro', 'Instalação', 'Mudança de endereço', 'Reativação', 'Resolvido pela IA', 'Sem resposta', 'Suporte técnico', 'Troca de senha'];
    for (const name of names) {
      const look = describeReason(name);
      expect(look.hint, name).toBeTruthy();
      expect(look.color, name).not.toBe(describeReason('desconhecido').color);
    }
  });
});

describe('closeReasonCatalog aliases', () => {
  test('nome parecido com o do catálogo ainda acha o ícone certo', () => {
    expect(describeReason('Suporte').hint).toBe('Dúvidas, problemas técnicos');
    expect(describeReason('Senha').hint).toBe('Alteração de senha do cliente');
    expect(describeReason('Endereço').hint).toBe('Alteração de endereço');
    expect(describeReason('Boleto atrasado').hint).toBe('Boletos, pagamentos, faturas');
    expect(describeReason('Resolvido pela IA (triagem)').hint).toBe('Atendimento finalizado pela IA');
  });
});
