import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import BusinessHoursPage from './BusinessHoursPage';
import { useBusinessHoursConfig } from '../../../hooks/useBusinessHoursConfig';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../hooks/useBusinessHoursConfig');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
});

describe('BusinessHoursPage', () => {
  test('distingue horário humano da janela noturna da IA', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });
    expect(screen.getByRole('link', { name: /atendimento noturno/i })).toHaveAttribute('href', '/configuracoes/automacao/noturno');
  });

  test('shows a "Criar" button when no config exists yet', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });
    expect(screen.getByRole('button', { name: 'Criar horário de atendimento' })).toBeInTheDocument();
  });

  test('fills the form, saves and shows the closed summary', async () => {
    const refresh = vi.fn();
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh,
    });
    api.updateBusinessHoursConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      startTime: '09:00',
      endTime: '17:00',
      message: 'Atendemos de seg a sex, das 09:00 às 17:00.',
    });
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    await userEvent.click(screen.getByLabelText(/ativo/i));
    fireEvent.change(screen.getByLabelText(/hora de início/i), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fim/i), { target: { value: '17:00' } });
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Atendemos de seg a sex, das 09:00 às 17:00.');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateBusinessHoursConfig).toHaveBeenCalledWith(
        { enabled: true, startTime: '09:00', endTime: '17:00', message: 'Atendemos de seg a sex, das 09:00 às 17:00.' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/09:00.*17:00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar horário de atendimento' })).not.toBeInTheDocument();
  });

  test('canceling while creating does not leave a stale draft on reopen', async () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'rascunho descartado');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('');
  });

  test('shows the closed-state summary with the configured window when a config already exists', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });
    expect(screen.getByText(/08:00.*18:00/)).toBeInTheDocument();
  });

  test('editing an existing config pre-fills the form fields', async () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: 'config-1', enabled: true, startTime: '09:00', endTime: '17:00', message: 'Texto do aviso' },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByLabelText(/hora de início/i)).toHaveValue('09:00');
    expect(screen.getByLabelText(/hora de fim/i)).toHaveValue('17:00');
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('Texto do aviso');
  });
});
