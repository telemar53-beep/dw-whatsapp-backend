import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AiSuggestionCard from './AiSuggestionCard';

describe('AiSuggestionCard', () => {
  const suggestion = { id: 's-1', content: 'Seu plano é 600MB.' };

  test('renders nothing when there is no suggestion', () => {
    const { container } = render(<AiSuggestionCard suggestion={null} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows the suggested text and marks it as coming from the AI', () => {
    render(<AiSuggestionCard suggestion={suggestion} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText('Seu plano é 600MB.')).toBeInTheDocument();
    expect(screen.getByText(/sugestão da ia/i)).toBeInTheDocument();
  });

  test('the three actions call their handlers', async () => {
    const onSend = vi.fn(); const onEdit = vi.fn(); const onDiscard = vi.fn();
    render(<AiSuggestionCard suggestion={suggestion} onSend={onSend} onEdit={onEdit} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(onSend).toHaveBeenCalledWith(suggestion);
    expect(onEdit).toHaveBeenCalledWith(suggestion);
    expect(onDiscard).toHaveBeenCalledWith(suggestion);
  });
});
