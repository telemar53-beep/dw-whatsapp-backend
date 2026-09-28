import { describe, test, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { sobDemanda, useSobDemanda } from './sobDemanda';

// O carregador dos diálogos sob demanda (utils/sobDemanda.js). O que o Bloco 1
// passou a depender dele: nada é pedido antes de ser preciso, a falha avisa
// quem abriu (e não sobe até a rota) e a tentativa seguinte baixa de novo.

function Diálogo() {
  return <p>diálogo aberto</p>;
}

function Abridor({ modulo }) {
  const [aberto, setAberto] = useState(false);
  const [falhou, setFalhou] = useState(0);
  const aoFalhar = useCallback(() => { setAberto(false); setFalhou((n) => n + 1); }, []);
  const Componente = useSobDemanda(modulo, aberto, aoFalhar);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>abrir</button>
      <p data-testid="falhas">{falhou}</p>
      {aberto && (Componente ? <Componente /> : <p>abrindo</p>)}
    </>
  );
}

describe('sobDemanda', () => {
  test('nada é pedido antes de abrir; aberto, chega e fica em memória', async () => {
    const carregar = vi.fn(() => Promise.resolve({ default: Diálogo }));
    const modulo = sobDemanda(carregar);
    render(<Abridor modulo={modulo} />);
    expect(carregar).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: 'abrir' }).click(); });
    expect(await screen.findByText('diálogo aberto')).toBeInTheDocument();
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(modulo.componente).toBe(Diálogo);
  });

  test('a falha avisa quem abriu, e a próxima tentativa baixa de novo', async () => {
    const carregar = vi.fn()
      .mockRejectedValueOnce(new Error('trecho não baixou'))
      .mockResolvedValueOnce({ default: Diálogo });
    const modulo = sobDemanda(carregar);
    render(<Abridor modulo={modulo} />);

    await act(async () => { screen.getByRole('button', { name: 'abrir' }).click(); });
    expect(screen.getByTestId('falhas')).toHaveTextContent('1');
    expect(screen.queryByText('abrindo')).not.toBeInTheDocument();

    await act(async () => { screen.getByRole('button', { name: 'abrir' }).click(); });
    expect(await screen.findByText('diálogo aberto')).toBeInTheDocument();
    expect(carregar).toHaveBeenCalledTimes(2);
  });
});
