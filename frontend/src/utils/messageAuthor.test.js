import { describe, expect, test } from 'vitest';
import { rotuloDoAutor } from './messageAuthor';

describe('rotuloDoAutor (Fase 1B)', () => {
  test('disparo do SGP: "Automática · SGP", nunca "Atendente"', () => {
    expect(rotuloDoAutor({ sentBy: 'human', metadata: { origem: 'sgp', modo: 'template' } })).toBe('Automática · SGP');
  });

  test('campanha: "Campanha"', () => {
    expect(rotuloDoAutor({ sentBy: 'human', metadata: { origem: 'campanha', campanhaId: 'c-1' } })).toBe('Campanha');
  });

  test('sem origem automática: como antes — IA ou atendente', () => {
    expect(rotuloDoAutor({ sentBy: 'ai' })).toBe('Assistente IA');
    expect(rotuloDoAutor({ sentBy: 'human' })).toBe('Atendente');
    expect(rotuloDoAutor({ sentBy: 'human', metadata: { motivoFalha: 'x' } })).toBe('Atendente');
    expect(rotuloDoAutor({ sentBy: 'human', metadata: { origem: 'desconhecida' } })).toBe('Atendente');
  });
});
