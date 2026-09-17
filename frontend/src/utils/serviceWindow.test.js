import { describe, test, expect } from 'vitest';
import { isServiceWindowClosed } from './serviceWindow';

const AGORA = new Date('2026-09-17T13:35:00.000Z');

function inbound(isoDate) {
  return { direction: 'inbound', createdAt: isoDate };
}

function outbound(isoDate) {
  return { direction: 'outbound', createdAt: isoDate };
}

describe('isServiceWindowClosed', () => {
  test('canal não oficial não tem janela nenhuma', () => {
    expect(isServiceWindowClosed({ channelType: 'baileys', messages: [], now: AGORA })).toBe(false);
  });

  test('sem nenhuma mensagem do cliente, a janela nunca chegou a abrir', () => {
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages: [], now: AGORA })).toBe(true);
  });

  // O caso do print: a atendente inicia com template e o cliente não responde.
  // Template não abre a janela — só a resposta do cliente abre.
  test('só mensagem nossa não abre a janela', () => {
    const messages = [outbound('2026-09-17T13:30:00.000Z')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(true);
  });

  test('cliente respondeu há 23 horas: janela aberta', () => {
    const messages = [inbound('2026-09-16T14:35:00.000Z')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(false);
  });

  test('cliente respondeu há 25 horas: janela fechada', () => {
    const messages = [inbound('2026-09-16T12:35:00.000Z')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(true);
  });

  test('exatamente 24 horas já conta como fechada', () => {
    const messages = [inbound('2026-09-16T13:35:00.000Z')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(true);
  });

  test('vale a mensagem mais recente do cliente, não a primeira', () => {
    const messages = [inbound('2026-09-15T10:00:00.000Z'), outbound('2026-09-17T13:00:00.000Z'), inbound('2026-09-17T13:00:00.000Z')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(false);
  });

  test('a ordem da lista não importa', () => {
    const messages = [inbound('2026-09-17T13:00:00.000Z'), inbound('2026-09-15T10:00:00.000Z')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(false);
  });

  test('vale também para o 360dialog', () => {
    const messages = [inbound('2026-09-16T12:35:00.000Z')];
    expect(isServiceWindowClosed({ channelType: '360dialog', messages, now: AGORA })).toBe(true);
  });

  // Uma data ilegível não pode virar "janela fechada" num canal que está
  // funcionando: o aviso apareceria sem motivo em cima do atendente.
  test('mensagem sem data legível é ignorada, não conta como janela fechada', () => {
    const messages = [inbound('2026-09-17T13:00:00.000Z'), inbound('data-invalida')];
    expect(isServiceWindowClosed({ channelType: 'meta_cloud', messages, now: AGORA })).toBe(false);
  });
});
