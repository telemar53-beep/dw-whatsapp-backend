import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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
    // O token próprio de "lido", e nao um hexadecimal solto. O verde de
    // `chat-online` (conexão, status) ficava perto dos cinzas num notebook real.
    expect(lido.className).toMatch(/text-chat-lido/);
    expect(lido.className).not.toMatch(/text-chat-online/);
  });

  test('o azul de "lido" é um token só, azul, que nenhuma folha redefine', () => {
    const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
    const folhas = [];
    (function varrer(pasta) {
      for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (nome.endsWith('.css')) folhas.push(caminho);
      }
    })(RAIZ);
    const definicoes = folhas.flatMap((caminho) =>
      [...readFileSync(caminho, 'utf8').matchAll(/--color-chat-lido:\s*(#[0-9a-f]{6})/gi)].map((m) => ({ caminho, hex: m[1] })));

    // Uma definição, no tema: Mesa, Supervisão e Encerrados leem a mesma.
    expect(definicoes).toHaveLength(1);
    expect(definicoes[0].caminho.endsWith('index.css')).toBe(true);
    // Azul (matiz entre 190° e 220°), nunca o verde de antes.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(definicoes[0].hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const matiz = max === b ? 60 * ((r - g) / (max - min)) + 240 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * (((g - b) / (max - min)) % 6);
    expect(matiz).toBeGreaterThanOrEqual(190);
    expect(matiz).toBeLessThanOrEqual(220);
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
