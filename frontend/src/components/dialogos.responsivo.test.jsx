import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen } from '@testing-library/react';
import TransferModal from './TransferModal';
import CloseReasonModal from './CloseReasonModal';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useReasons } from '../hooks/useReasons';

// Transferir e Encerrar em desktop, tablet e celular (27/09). O corte de
// celular é o do popup da Supervisão (767 px): acima dele, o desenho do
// desktop com "Fechar"; abaixo, tela cheia, uma coluna e só a seta de voltar.
// O jsdom não mede; a consulta de tela aqui responde pela largura pedida, como
// o navegador responderia. O resto (sem rolagem lateral, alvos de 44 px) é
// medido no navegador de verdade, nas capturas.
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence');
vi.mock('../hooks/useReasons');

const AQUI = dirname(fileURLToPath(import.meta.url));

function largura(px) {
  vi.stubGlobal('innerWidth', px);
  vi.stubGlobal('matchMedia', (consulta) => {
    const max = /max-width:\s*(\d+)px/.exec(consulta);
    const min = /min-width:\s*(\d+)px/.exec(consulta);
    const vale = (!max || px <= Number(max[1])) && (!min || px >= Number(min[1]));
    return { matches: vale, media: consulta, addEventListener() {}, removeEventListener() {} };
  });
}

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'eu' } });
  useAgents.mockReturnValue({ agents: [{ id: 'eu', name: 'Eu' }, { id: 'a', name: 'Atendente A', activeConversations: 3 }], status: 'ready', refresh: vi.fn() });
  usePresence.mockReturnValue(new Set(['a']));
  useReasons.mockReturnValue({ reasons: [{ id: 'r1', name: 'Sem conexão' }, { id: 'r2', name: 'Lentidão' }], status: 'ready', refresh: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

const TELAS = [
  ['desktop 1366', 1366, false],
  ['tablet 1024', 1024, false],
  ['tablet 820', 820, false],
  ['celular 767', 767, true],
  ['celular 390', 390, true],
];
const DIALOGOS = [
  ['Transferir atendimento', () => <TransferModal conversationId="c1" onClose={() => {}} />],
  ['Encerrar atendimento', () => <CloseReasonModal onConfirm={() => {}} onClose={() => {}} />],
];

describe.each(DIALOGOS)('%s nas larguras', (titulo, montar) => {
  test.each(TELAS)('%s: saída certa e um controle só', (_, px, celular) => {
    largura(px);
    render(montar());
    const dialogo = screen.getByRole('dialog', { name: titulo });
    expect(dialogo.classList.contains('is-celular')).toBe(celular);
    expect(Boolean(screen.queryByRole('button', { name: 'Voltar' }))).toBe(celular);
    expect(Boolean(screen.queryByRole('button', { name: 'Fechar' }))).toBe(!celular);
  });
});

describe('as folhas dos dois diálogos cobrem as três larguras', () => {
  test.each([['dialogo-transferir.css', 'transfer'], ['dialogo-encerrar.css', 'close-reason']])('%s: tablet por media query, celular pela classe, sem rolagem lateral forçada', (arquivo, variante) => {
    const folha = readFileSync(join(AQUI, arquivo), 'utf8');
    expect(folha).toMatch(/@media \(max-width: 1023px\)/);
    expect(folha).toMatch(new RegExp(`\\[data-dialog='${variante}'\\]\\.dw-dialog\\.is-celular\\s*\\{[^}]*height:\\s*100dvh`));
    expect(folha).not.toMatch(/min-width:\s*\d{3,}px/);
    expect(folha).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  test('o Encerrar tem duas colunas no desktop e uma no celular', () => {
    const folha = readFileSync(join(AQUI, 'dialogo-encerrar.css'), 'utf8');
    expect(folha).toMatch(/\.en-grade\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(folha).toMatch(/\.is-celular \.en-grade\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});
