import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReasonsPage from './ReasonsPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useReasonsAdmin } from '../../../hooks/useReasonsAdmin';
import { useAiConfig } from '../../../hooks/useAiConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useReasonsAdmin');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  useReasonsAdmin.mockReturnValue({ reasons: [{ id: 'r1', name: 'Resolvido pela IA', active: true }, { id: 'r2', name: 'Pagamento', active: true }], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
});

describe('ReasonsPage', () => {
  test('marca o motivo que a IA usa ao encerrar', () => {
    renderInShell(<ReasonsPage />, { path: '/configuracoes/cadastros/motivos' });
    expect(screen.getByText('Usado pela IA ao encerrar')).toBeInTheDocument();
  });
  test('desativar o motivo da IA pede confirmação e explica a consequência', async () => {
    api.updateReason.mockResolvedValue({});
    renderInShell(<ReasonsPage />, { path: '/configuracoes/cadastros/motivos' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0]);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/a ia vai parar de encerrar sozinha/i);
    await userEvent.click(screen.getByRole('button', { name: 'Desativar mesmo assim' }));
    expect(api.updateReason).toHaveBeenCalledWith('r1', { active: false }, 'tok');
  });
  test('desativar outro motivo não pede confirmação', async () => {
    api.updateReason.mockResolvedValue({});
    renderInShell(<ReasonsPage />, { path: '/configuracoes/cadastros/motivos' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[1]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.updateReason).toHaveBeenCalledWith('r2', { active: false }, 'tok');
  });
});
