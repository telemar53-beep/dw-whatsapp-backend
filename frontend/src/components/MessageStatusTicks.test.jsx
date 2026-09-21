import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageStatusTicks from './MessageStatusTicks';

describe('MessageStatusTicks', () => {
  // Os testes afirmam a SEMANTICA, nao o hexadecimal: enviado e entregue sao o
  // mesmo tratamento discreto, e lido tem que ser visivelmente diferente dos
  // dois. Antes entregue e lido dividiam a mesma cor e, num glifo de 12px, a
  // atendente nao conseguia ver pela lista se o cliente tinha lido.
  function tratamentoDe(status, titulo) {
    const { unmount } = render(<MessageStatusTicks status={status} />);
    const indicador = screen.getByTitle(titulo);
    const dados = { className: indicador.className, tiques: indicador.querySelectorAll('svg').length };
    unmount();
    return dados;
  }

  test('enviado e entregue usam o mesmo tratamento discreto, com 1 e 2 tiques', () => {
    const enviado = tratamentoDe('sent', 'Enviado');
    const entregue = tratamentoDe('delivered', 'Entregue');

    expect(enviado.tiques).toBe(1);
    expect(entregue.tiques).toBe(2);
    expect(enviado.className).toBe(entregue.className);
    // Discreto = tinta esmaecida, nao a cor de destaque.
    expect(enviado.className).not.toMatch(/text-chat-online/);
  });

  test('lido é visualmente distinto de entregue e usa o tratamento aprovado', () => {
    const entregue = tratamentoDe('delivered', 'Entregue');
    const lido = tratamentoDe('read', 'Lido');

    expect(lido.tiques).toBe(2);
    expect(lido.className).not.toBe(entregue.className);
    // O token aprovado para "lido", e nao um hexadecimal solto.
    expect(lido.className).toMatch(/text-chat-online/);
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
