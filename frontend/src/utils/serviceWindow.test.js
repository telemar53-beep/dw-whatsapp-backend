import { describe, test, expect } from 'vitest';
import { estadoDaJanela, JANELA_ABERTA, JANELA_FECHADA, JANELA_INDETERMINADA } from './serviceWindow';

const AGORA = new Date('2026-09-17T13:35:00.000Z');

function inbound(isoDate) {
  return { direction: 'inbound', createdAt: isoDate };
}

function outbound(isoDate) {
  return { direction: 'outbound', createdAt: isoDate };
}

describe('estadoDaJanela', () => {
  test('canal não oficial não tem janela nenhuma', () => {
    expect(estadoDaJanela({ channelType: 'baileys', messages: [], now: AGORA })).toBe(JANELA_ABERTA);
  });

  test('sem nenhuma mensagem do cliente, a janela nunca chegou a abrir', () => {
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages: [], now: AGORA })).toBe(JANELA_FECHADA);
  });

  // O caso do print: a atendente inicia com template e o cliente não responde.
  // Template não abre a janela — só a resposta do cliente abre.
  test('só mensagem nossa não abre a janela', () => {
    const messages = [outbound('2026-09-17T13:30:00.000Z')];
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_FECHADA);
  });

  test('cliente respondeu há 23 horas: janela aberta', () => {
    const messages = [inbound('2026-09-16T14:35:00.000Z')];
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_ABERTA);
  });

  test('cliente respondeu há 25 horas: janela fechada', () => {
    const messages = [inbound('2026-09-16T12:35:00.000Z')];
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_FECHADA);
  });

  test('exatamente 24 horas já conta como fechada', () => {
    const messages = [inbound('2026-09-16T13:35:00.000Z')];
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_FECHADA);
  });

  test('vale a mensagem mais recente do cliente, não a primeira', () => {
    const messages = [inbound('2026-09-15T10:00:00.000Z'), outbound('2026-09-17T13:00:00.000Z'), inbound('2026-09-17T13:00:00.000Z')];
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_ABERTA);
  });

  test('a ordem da lista não importa entre datas legíveis', () => {
    const messages = [inbound('2026-09-17T13:00:00.000Z'), inbound('2026-09-15T10:00:00.000Z')];
    expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_ABERTA);
  });

  test('vale também para o 360dialog', () => {
    const messages = [inbound('2026-09-16T12:35:00.000Z')];
    expect(estadoDaJanela({ channelType: '360dialog', messages, now: AGORA })).toBe(JANELA_FECHADA);
  });

  // O defeito: a inbound mais recente com data ilegível era descartada em
  // silêncio e a conta caía numa inbound ANTERIOR — de onde saía um "fechada"
  // com cara de certeza. "Não sei" é a única resposta honesta aqui.
  describe('inbound mais recente com data ilegível', () => {
    test('data ilegível na mensagem mais recente: indeterminada, nunca fechada', () => {
      const messages = [inbound('2026-09-15T10:00:00.000Z'), inbound('data-invalida')];
      const estado = estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA });
      expect(estado).toBe(JANELA_INDETERMINADA);
      expect(estado).not.toBe(JANELA_FECHADA);
    });

    test('não usa a inbound anterior nem quando ela diria "aberta"', () => {
      const messages = [inbound('2026-09-17T13:00:00.000Z'), inbound('data-invalida')];
      expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_INDETERMINADA);
    });

    test('única inbound da conversa ilegível também é indeterminada', () => {
      expect(estadoDaJanela({ channelType: 'meta_cloud', messages: [inbound('lixo')], now: AGORA })).toBe(
        JANELA_INDETERMINADA
      );
    });

    // new Date(null) devolve 1970 — data válida e absurda, que fecharia
    // qualquer conversa. Ausente é ilegível, não "muito antiga".
    test('createdAt nulo, ausente ou vazio conta como ilegível, não como 1970', () => {
      for (const ruim of [null, undefined, '']) {
        expect(estadoDaJanela({ channelType: 'meta_cloud', messages: [inbound(ruim)], now: AGORA })).toBe(
          JANELA_INDETERMINADA
        );
      }
    });

    // O oposto: uma ilegível ANTIGA não pode envenenar a conversa inteira para
    // sempre. A conta que interessa é a da mais recente, e essa nós temos.
    test('ilegível anterior à última legível não atrapalha', () => {
      const messages = [inbound('data-invalida'), inbound('2026-09-17T13:00:00.000Z')];
      expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_ABERTA);
    });

    test('outbound ilegível não diz nada sobre a janela', () => {
      const messages = [inbound('2026-09-17T13:00:00.000Z'), outbound('data-invalida')];
      expect(estadoDaJanela({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(JANELA_ABERTA);
    });

    test('canal não oficial ignora tudo isso', () => {
      const messages = [inbound('data-invalida')];
      expect(estadoDaJanela({ channelType: 'baileys', messages, now: AGORA })).toBe(JANELA_ABERTA);
    });
  });
});
