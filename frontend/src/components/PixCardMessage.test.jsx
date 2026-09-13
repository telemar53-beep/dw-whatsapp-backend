import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PixCardMessage from './PixCardMessage';

describe('PixCardMessage', () => {
  test('shows the title, formatted due date and value, and a truncated code', () => {
    const message = {
      content: '000201ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      metadata: { value: 135, dueDate: '2026-09-15' },
    };
    render(<PixCardMessage message={message} />);

    // RTL normaliza espaços (inclusive o nbsp que o Intl usa entre "R$" e o valor)
    // ao ler o texto do DOM, então a expectativa precisa passar pela mesma normalização.
    const expectedValue = Number(135)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      .replace(/ /g, ' ');
    expect(screen.getByText('Pix da fatura')).toBeInTheDocument();
    expect(screen.getByText('15/09/2026')).toBeInTheDocument();
    expect(screen.getByText(expectedValue)).toBeInTheDocument();
    expect(screen.getByText('000201ABCDEFGHIJKL…')).toBeInTheDocument();
    expect(screen.queryByText(message.content)).not.toBeInTheDocument();
    expect(screen.getByText('Cartão com botão Copiar código Pix')).toBeInTheDocument();
  });

  test('omits the due date line when there is none', () => {
    const message = { content: '000201ABC', metadata: { value: 50 } };
    render(<PixCardMessage message={message} />);
    expect(screen.queryByText(/vence/i)).not.toBeInTheDocument();
  });

  test('omits the value when it is not a number', () => {
    const message = { content: '000201ABC', metadata: { value: 'não é número', dueDate: '2026-09-15' } };
    render(<PixCardMessage message={message} />);
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
    expect(screen.getByText('15/09/2026')).toBeInTheDocument();
  });

  test('shows the whole code, un-truncated with an ellipsis, when it is 18 characters or shorter', () => {
    const message = { content: 'codigo-curto-18ch', metadata: {} };
    render(<PixCardMessage message={message} />);
    expect(screen.getByText('codigo-curto-18ch')).toBeInTheDocument();
  });
});
