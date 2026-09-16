import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloseReasonModal from './CloseReasonModal';
import { useReasons } from '../hooks/useReasons';

vi.mock('../hooks/useReasons');

beforeEach(() => {
  vi.clearAllMocks();
  useReasons.mockReturnValue({
    reasons: [
      { id: 'r1', name: 'Troca de senha', active: true },
      { id: 'r2', name: 'Pagamento - sem conexão', active: true },
    ],
    status: 'ready',
    loading: false,
    refresh: vi.fn(),
  });
});

describe('CloseReasonModal', () => {
  test('lists the active reasons as radio options', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Troca de senha')).toBeInTheDocument();
    expect(screen.getByLabelText('Pagamento - sem conexão')).toBeInTheDocument();
  });

  test('the confirm button is disabled until a reason is selected', async () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Troca de senha'));

    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).not.toBeDisabled();
  });

  test('clicking confirm calls onConfirm with the selected reason id', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CloseReasonModal onConfirm={onConfirm} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Pagamento - sem conexão'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(onConfirm).toHaveBeenCalledWith('r2');
  });

  test('shows an inline error and keeps the modal open when onConfirm fails', async () => {
    const onConfirm = vi.fn().mockRejectedValue({ body: { error: 'Conversation is not currently assigned to you, or is closed' } });
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={onConfirm} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(await screen.findByText('Conversation is not currently assigned to you, or is closed')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicking Cancelar calls onClose', async () => {
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onClose).toHaveBeenCalled();
  });

  test('shows an empty-state message and keeps confirm disabled when there are no reasons', () => {
    useReasons.mockReturnValue({ reasons: [], status: 'ready', loading: false, refresh: vi.fn() });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(/nenhum motivo de contato cadastrado ainda/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();
  });

  test('em carregamento não mostra "Nenhum motivo de contato cadastrado"', () => {
    useReasons.mockReturnValue({ reasons: [], status: 'loading', loading: true, refresh: vi.fn() });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText(/nenhum motivo de contato cadastrado/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('pre-selects the reason the AI suggested', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r2" />);

    expect(screen.getByLabelText('Pagamento - sem conexão')).toBeChecked();
    expect(screen.getByLabelText('Troca de senha')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).not.toBeDisabled();
  });

  test('falls back to no selection when the AI suggested nothing, exactly as before this feature existed', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId={null} />);

    expect(screen.getByLabelText('Troca de senha')).not.toBeChecked();
    expect(screen.getByLabelText('Pagamento - sem conexão')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();
  });

  test('the attendant can still change the pre-selected reason before confirming', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CloseReasonModal onConfirm={onConfirm} onClose={vi.fn()} suggestedReasonId="r2" />);

    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(onConfirm).toHaveBeenCalledWith('r1');
  });
});

describe('CloseReasonModal visual', () => {
  test('mostra a legenda do catálogo só para motivos conhecidos', () => {
    useReasons.mockReturnValue({
      reasons: [
        { id: 'r1', name: 'Troca de senha', active: true },
        { id: 'r3', name: 'Visita comercial', active: true },
      ],
      status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Alteração de senha do cliente')).toBeInTheDocument();
    expect(screen.getByLabelText('Troca de senha')).toHaveAccessibleDescription('Alteração de senha do cliente');
    expect(screen.getByLabelText('Visita comercial')).not.toHaveAccessibleDescription();
  });

  test('o botão X do cabeçalho fecha o modal', async () => {
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
