import { describe, test, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import RolesPage from './RolesPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../contexts/AuthContext');

describe('RolesPage', () => {
  test('a matriz reflete hasLevel: Supervisão para gerente sim, Integrações para gerente sem flag não', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    renderInShell(<RolesPage />, { path: '/configuracoes/equipe/perfis' });
    const supervisao = screen.getByRole('row', { name: /supervisão/i });
    expect(within(supervisao).getAllByText('Sim')).toHaveLength(3); // gerente, gerente+flag, admin
    expect(within(supervisao).getAllByText('Não')).toHaveLength(1); // atendente
    const openai = screen.getByRole('row', { name: /SGP: consultas/i });
    const cells = within(openai).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Não', 'Não', 'Sim', 'Sim']);
  });
  test('lista as regras que não dependem de página', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    renderInShell(<RolesPage />, { path: '/configuracoes/equipe/perfis' });
    expect(screen.getByText(/gerente só cria e edita contas de atendente/i)).toBeInTheDocument();
  });
});
