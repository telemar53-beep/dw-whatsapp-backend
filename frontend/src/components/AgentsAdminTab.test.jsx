import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentsAdminTab from './AgentsAdminTab';
import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useSectors } from '../hooks/useSectors';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useSectors');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
});

describe('AgentsAdminTab', () => {
  test('lists every agent with name, email, role and status', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [] },
        { id: 'a2', name: 'Beto', email: 'beto@dw.com', role: 'admin', active: false, sectors: [] },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/ana@dw.com/)).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Desativado')).toBeInTheDocument();
  });

  test('deactivates an active agent', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [] }],
      refresh,
    });
    api.setAgentActive.mockResolvedValue({});
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /desativar/i }));

    await waitFor(() => expect(api.setAgentActive).toHaveBeenCalledWith('a1', false, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('reactivates a deactivated agent', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: false, sectors: [] }],
      refresh,
    });
    api.setAgentActive.mockResolvedValue({});
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /reativar/i }));

    await waitFor(() => expect(api.setAgentActive).toHaveBeenCalledWith('a1', true, 'tok-123'));
  });

  test('does not show a deactivate button for the currently logged-in admin', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'admin-1', name: 'Você', email: 'voce@dw.com', role: 'admin', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument();
  });

  test('renders the create-agent form', () => {
    useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Cadastrar novo atendente/)).toBeInTheDocument();
  });

  test('shows each agent\'s assigned sectors', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        {
          id: 'a1',
          name: 'Ana',
          email: 'ana@dw.com',
          role: 'agent',
          active: true,
          sectors: [
            { id: 's1', name: 'Financeiro' },
            { id: 's2', name: 'Comercial' },
          ],
        },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Financeiro, Comercial/)).toBeInTheDocument();
  });

  test('shows "Nenhum setor" when an agent has no sectors', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Nenhum setor/)).toBeInTheDocument();
  });

  test('editing sectors: toggling a checkbox and saving calls setAgentSectors and refreshes', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh,
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    api.setAgentSectors.mockResolvedValue({ ok: true });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.setAgentSectors).toHaveBeenCalledWith('a1', ['s1', 's2'], 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling sector edits discards unsaved changes', async () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh: vi.fn(),
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    expect(screen.getByLabelText('Financeiro')).toBeChecked();
    expect(screen.getByLabelText('Comercial')).not.toBeChecked();
  });
});
