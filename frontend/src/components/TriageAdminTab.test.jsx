import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TriageAdminTab from './TriageAdminTab';
import { useTriage } from '../hooks/useTriage';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useTriage');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }, { id: 's2', name: 'Suporte' }] });
});

describe('TriageAdminTab', () => {
  test('shows a loading message before the config arrives', () => {
    useTriage.mockReturnValue({ config: null, options: [], refresh: vi.fn() });
    render(<TriageAdminTab />);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  test('renders the config form fields with the current values', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Escolha uma opção', confirmationText: 'Obrigado', maxAttempts: 2 },
      options: [],
      refresh: vi.fn(),
    });
    render(<TriageAdminTab />);
    expect(screen.getByDisplayValue('Escolha uma opção')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Obrigado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  test('saves the config and calls refresh', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      refresh,
    });
    api.updateTriageConfig.mockResolvedValue({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 3 });
    render(<TriageAdminTab />);

    await userEvent.clear(screen.getByLabelText(/tentativas/i));
    await userEvent.type(screen.getByLabelText(/tentativas/i), '3');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateTriageConfig).toHaveBeenCalledWith(
        { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 3 },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('lists existing options with their sector and keywords', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: ['fatura', 'boleto'] }],
      refresh: vi.fn(),
    });
    render(<TriageAdminTab />);
    expect(screen.getByText('1 - Financeiro')).toBeInTheDocument();
    expect(screen.getByText('fatura, boleto')).toBeInTheDocument();
  });

  test('creates a new option and calls refresh', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      refresh,
    });
    api.createTriageOption.mockResolvedValue({ id: 'opt-2', optionNumber: 2, sectorId: 's2', sectorName: 'Suporte', keywords: ['internet'] });
    render(<TriageAdminTab />);

    await userEvent.type(screen.getByLabelText(/número da opção/i), '2');
    await userEvent.selectOptions(screen.getByLabelText(/^setor$/i), 's2');
    await userEvent.type(screen.getByLabelText(/frases-gatilho/i), 'internet');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTriageOption).toHaveBeenCalledWith({ optionNumber: 2, sectorId: 's2', keywords: ['internet'] }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('deletes an option after confirmation', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: [] }],
      refresh,
    });
    api.deleteTriageOption.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TriageAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteTriageOption).toHaveBeenCalledWith('opt-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('shows a warning when no triage options are configured', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      refresh: vi.fn(),
    });
    render(<TriageAdminTab />);
    expect(screen.getByText(/nenhuma opção cadastrada/i)).toBeInTheDocument();
  });

  test('does not show the no-options warning when at least one option exists', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: [] }],
      refresh: vi.fn(),
    });
    render(<TriageAdminTab />);
    expect(screen.queryByText(/nenhuma opção cadastrada/i)).not.toBeInTheDocument();
  });
});
