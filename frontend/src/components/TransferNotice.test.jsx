import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferNotice from './TransferNotice';

const NOTICE = { conversationId: 'conv-1', contactName: 'Carlos', byName: 'Maria Souza' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransferNotice', () => {
  test('não mostra nada quando não há aviso', () => {
    const { container } = render(<TransferNotice notice={null} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('diz quem transferiu e de qual cliente é o atendimento', () => {
    render(<TransferNotice notice={NOTICE} onOpen={vi.fn()} onDismiss={vi.fn()} />);

    const aviso = screen.getByRole('status');
    expect(aviso).toHaveTextContent('Maria Souza');
    expect(aviso).toHaveTextContent('Carlos');
  });

  test('clicar no aviso abre a conversa transferida', async () => {
    const onOpen = vi.fn();
    render(<TransferNotice notice={NOTICE} onOpen={onOpen} onDismiss={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /abrir o atendimento/i }));

    expect(onOpen).toHaveBeenCalledWith('conv-1');
  });

  test('fechar dispensa o aviso sem abrir a conversa', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<TransferNotice notice={NOTICE} onOpen={onOpen} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

// O aviso some sozinho: um alerta que fica para sempre na tela vira parte do
// cenário e deixa de ser alerta.
describe('TransferNotice some sozinho', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('dispensa sozinho depois de alguns segundos', () => {
    const onDismiss = vi.fn();
    render(<TransferNotice notice={NOTICE} onOpen={vi.fn()} onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10000));

    expect(onDismiss).toHaveBeenCalled();
  });

  test('uma transferência nova reinicia a contagem', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<TransferNotice notice={NOTICE} onOpen={vi.fn()} onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(5000));
    rerender(
      <TransferNotice
        notice={{ conversationId: 'conv-2', contactName: 'Ana', byName: 'Berg' }}
        onOpen={vi.fn()}
        onDismiss={onDismiss}
      />
    );
    act(() => vi.advanceTimersByTime(5000));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
