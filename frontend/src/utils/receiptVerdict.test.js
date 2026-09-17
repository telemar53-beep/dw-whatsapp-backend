import { describe, test, expect } from 'vitest';
import { receiptVerdict } from './receiptVerdict';

describe('receiptVerdict', () => {
  test('comprovante que confere sai como aprovado', () => {
    const v = receiptVerdict({ analisado: true, valido: true, valor: 100, data: '2026-09-17', tipo: 'pix', motivos: [] });

    expect(v.tone).toBe('ok');
    expect(v.title).toMatch(/confere/i);
  });

  // O ponto que mais importa para o atendente: o mesmo comprovante reenviado.
  // Ele vem na frente até de "confere", porque muda a decisão.
  test('comprovante já usado avisa mesmo quando o resto confere', () => {
    const v = receiptVerdict({ analisado: true, valido: true, valor: 100, jaUtilizado: true, motivos: [] });

    expect(v.tone).toBe('warn');
    expect(v.title).toMatch(/já foi usado/i);
  });

  test('comprovante que não confere lista os motivos', () => {
    const v = receiptVerdict({
      analisado: true,
      valido: false,
      motivos: ['favorecido não confere com os nomes cadastrados da empresa', 'data do pagamento fora dos últimos 15 dias'],
    });

    expect(v.tone).toBe('error');
    expect(v.details).toHaveLength(2);
    expect(v.details[0]).toMatch(/favorecido/);
  });

  test('quando não deu para analisar, mostra o motivo e não inventa veredito', () => {
    const v = receiptVerdict({ analisado: false, motivo: 'Não foi possível ler a imagem agora.' });

    expect(v.tone).toBe('error');
    expect(v.title).toBe('Não foi possível ler a imagem agora.');
    expect(v.details).toEqual([]);
  });

  test('mostra valor e data quando a leitura os trouxe', () => {
    const v = receiptVerdict({ analisado: true, valido: true, valor: 149.9, data: '2026-09-17', tipo: 'pix', motivos: [] });

    expect(v.details.join(' ')).toMatch(/149,90/);
    expect(v.details.join(' ')).toMatch(/17\/09\/2026/);
  });

  // Sem cliente identificado no SGP não há fatura para casar — o atendente
  // precisa saber que essa parte não foi conferida, em vez de supor que foi.
  test('avisa quando não havia fatura para comparar', () => {
    const v = receiptVerdict({ analisado: true, valido: false, faturaId: null, motivos: ['nenhuma fatura em aberto com esse valor'] });

    expect(v.details.join(' ')).toMatch(/fatura/i);
  });
});
