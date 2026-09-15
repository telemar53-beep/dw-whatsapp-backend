import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import MenuTriagePage from './MenuTriagePage';
import { useTriage } from '../../../hooks/useTriage';
import { useSectors } from '../../../hooks/useSectors';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useSectors');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/triagem-menu';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }, { id: 's2', name: 'Suporte' }] });
});

describe('MenuTriagePage', () => {
  test('em carregamento mostra um esqueleto em vez da pergunta de triagem', () => {
    useTriage.mockReturnValue({ config: null, options: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<MenuTriagePage />, { path: PATH });
    expect(screen.queryByLabelText(/tentativas/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('renders the config form fields with the current values', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Escolha uma opção', confirmationText: 'Obrigado', maxAttempts: 2 },
      options: [],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<MenuTriagePage />, { path: PATH });
    expect(screen.getByDisplayValue('Escolha uma opção')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Obrigado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  test('saves the config and calls refresh', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      status: 'ready',
      refresh,
    });
    api.updateTriageConfig.mockResolvedValue({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 3 });
    renderInShell(<MenuTriagePage />, { path: PATH });

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
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<MenuTriagePage />, { path: PATH });
    expect(screen.getByText('1 - Financeiro')).toBeInTheDocument();
    expect(screen.getByText('fatura, boleto')).toBeInTheDocument();
  });

  // O botão de criar agora fica no cabeçalho da página (como nas outras
  // telas de Configurações), controlando o formulário dentro de
  // TriageAdminTab em vez do botão interno "Criar opção".
  test('creates a new option via the header action and calls refresh', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      status: 'ready',
      refresh,
    });
    api.createTriageOption.mockResolvedValue({ id: 'opt-2', optionNumber: 2, sectorId: 's2', sectorName: 'Suporte', keywords: ['internet'] });
    renderInShell(<MenuTriagePage />, { path: PATH });

    expect(screen.queryByLabelText(/número da opção/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /criar opção/i }));
    expect(screen.queryByRole('button', { name: /criar opção/i })).not.toBeInTheDocument();

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
      status: 'ready',
      refresh,
    });
    api.deleteTriageOption.mockResolvedValue(undefined);
    renderInShell(<MenuTriagePage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.deleteTriageOption).toHaveBeenCalledWith('opt-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: [] }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<MenuTriagePage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancelar/i }));

    expect(api.deleteTriageOption).not.toHaveBeenCalled();
  });

  test('shows the new warning when no triage options are configured, without the word "toggle"', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<MenuTriagePage />, { path: PATH });
    expect(
      screen.getByText('Nenhuma opção cadastrada: a triagem por menu não roda em nenhum canal, mesmo com o interruptor ligado.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/toggle/i)).not.toBeInTheDocument();
  });

  test('does not show the no-options warning when at least one option exists', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: [] }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<MenuTriagePage />, { path: PATH });
    expect(screen.queryByText(/nenhuma opção cadastrada/i)).not.toBeInTheDocument();
  });

  test('shows a help popup explaining what triage options are, with an example', async () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<MenuTriagePage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /o que é isso/i }));

    expect(screen.getByText(/exemplo:/i)).toBeInTheDocument();
  });
});
