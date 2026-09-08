import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageStatusTicks from './MessageStatusTicks';

describe('MessageStatusTicks', () => {
  test('renders one gray tick for a sent message', () => {
    render(<MessageStatusTicks status="sent" />);
    const indicator = screen.getByTitle('Enviado');
    expect(indicator).toBeInTheDocument();
    expect(indicator.querySelectorAll('svg')).toHaveLength(1);
    expect(indicator.className).toMatch(/text-wa-meta/);
  });

  test('renders two gray ticks for a delivered message', () => {
    render(<MessageStatusTicks status="delivered" />);
    const indicator = screen.getByTitle('Entregue');
    expect(indicator).toBeInTheDocument();
    expect(indicator.querySelectorAll('svg')).toHaveLength(2);
    expect(indicator.className).toMatch(/text-wa-meta/);
  });

  test('renders two teal ticks for a read message', () => {
    render(<MessageStatusTicks status="read" />);
    const indicator = screen.getByTitle('Lido');
    expect(indicator).toBeInTheDocument();
    expect(indicator.querySelectorAll('svg')).toHaveLength(2);
    expect(indicator.className).toMatch(/text-wa-tick/);
  });

  test('renders a failure indicator for a failed message', () => {
    render(<MessageStatusTicks status="failed" />);
    expect(screen.getByTitle('Falha ao enviar')).toBeInTheDocument();
  });

  test('renders nothing for an inbound (received) message', () => {
    const { container } = render(<MessageStatusTicks status="received" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when there is no status yet', () => {
    const { container } = render(<MessageStatusTicks status={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
