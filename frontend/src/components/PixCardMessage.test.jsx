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

  test('diz que o Pix saiu como texto porque o código não traz a chave, mantendo vencimento e valor', () => {
    const message = {
      content: '000201ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      metadata: { value: 135, dueDate: '2026-09-15', fallbackTextoEnviado: true, motivoTexto: 'codigo_sem_chave' },
    };
    render(<PixCardMessage message={message} />);

    expect(screen.getByText('Pix enviado como texto')).toBeInTheDocument();
    expect(screen.queryByText('Pix da fatura')).not.toBeInTheDocument();
    expect(screen.queryByText('Cartão com botão Copiar código Pix')).not.toBeInTheDocument();
    expect(screen.getByText('15/09/2026')).toBeInTheDocument();
    expect(screen.getByText('000201ABCDEFGHIJKL…')).toBeInTheDocument();
    expect(screen.queryByText(message.content)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'O código Pix deste boleto não traz a chave do recebedor, que o WhatsApp oficial exige no cartão: o cliente recebeu o código em texto.'
      )
    ).toBeInTheDocument();
  });

  test('diz quando foi o WhatsApp oficial que recusou o cartão', () => {
    const message = {
      content: '000201ABC',
      metadata: { fallbackTextoEnviado: true, motivoTexto: 'cartao_recusado' },
    };
    render(<PixCardMessage message={message} />);
    expect(screen.getByText('Pix enviado como texto')).toBeInTheDocument();
    expect(
      screen.getByText('O WhatsApp oficial recusou o cartão: o cliente recebeu o código em texto.')
    ).toBeInTheDocument();
  });

  test('diz quando o cartão não chegou ao cliente', () => {
    const message = {
      content: '000201ABC',
      metadata: { fallbackTextoEnviado: true, motivoTexto: 'cartao_nao_entregue' },
    };
    render(<PixCardMessage message={message} />);
    expect(
      screen.getByText('O cartão não chegou ao cliente: o código foi reenviado em texto.')
    ).toBeInTheDocument();
  });

  test('sem motivo conhecido, diz só que o cliente recebeu o código em texto', () => {
    const message = { content: '000201ABC', metadata: { fallbackTextoEnviado: true } };
    render(<PixCardMessage message={message} />);
    expect(screen.getByText('O cliente recebeu o código em texto.')).toBeInTheDocument();

    const desconhecido = { content: '000201ABC', metadata: { fallbackTextoEnviado: true, motivoTexto: 'outro' } };
    render(<PixCardMessage message={desconhecido} />);
    expect(screen.getAllByText('O cliente recebeu o código em texto.')).toHaveLength(2);
  });

  test('shows the whole code, un-truncated with an ellipsis, when it is 18 characters or shorter', () => {
    const message = { content: 'codigo-curto-18ch', metadata: {} };
    render(<PixCardMessage message={message} />);
    expect(screen.getByText('codigo-curto-18ch')).toBeInTheDocument();
  });
});
