import { describe, test, expect } from 'vitest';
import { situacaoDaCampanha, campanhaTerminou, processadosDaCampanha } from './campaignStatus';

describe('situacao derivada da campanha', () => {
  test('todo destinatario com estado terminal e "Todos processados"', () => {
    expect(situacaoDaCampanha({ totalRecipients: 10, sentCount: 7, failedCount: 2, skippedCount: 1 })).toBe('Todos processados');
    expect(campanhaTerminou({ totalRecipients: 10, sentCount: 7, failedCount: 2, skippedCount: 1 })).toBe(true);
  });

  test('faltando processar, e "Processando"', () => {
    expect(situacaoDaCampanha({ totalRecipients: 10, sentCount: 4, failedCount: 0, skippedCount: 0 })).toBe('Processando');
  });

  test('sem destinatario nenhum nao existe trabalho concluido', () => {
    expect(situacaoDaCampanha({ totalRecipients: 0, sentCount: 0, failedCount: 0, skippedCount: 0 })).toBe('Sem destinatários');
    expect(campanhaTerminou({ totalRecipients: 0, sentCount: 0, failedCount: 0, skippedCount: 0 })).toBe(false);
  });

  // O backend nao tem status, started_at nem finished_at: nada distingue fila
  // lenta de fila parada. Inventar esses rotulos seria afirmar o que ninguem
  // mediu, e este teste existe para impedir que voltem.
  test('nao existe estado que os dados nao permitam afirmar', () => {
    const casos = [
      { totalRecipients: 10, sentCount: 0, failedCount: 0, skippedCount: 0 },
      { totalRecipients: 10, sentCount: 10, failedCount: 0, skippedCount: 0 },
      { totalRecipients: 0, sentCount: 0, failedCount: 0, skippedCount: 0 },
    ];
    for (const caso of casos) {
      expect(situacaoDaCampanha(caso)).not.toMatch(/travad|pausad|cancelad|atraso|conclu/i);
    }
  });

  test('processados soma os tres estados terminais', () => {
    expect(processadosDaCampanha({ sentCount: 3, failedCount: 2, skippedCount: 1 })).toBe(6);
    expect(processadosDaCampanha({})).toBe(0);
  });
});
