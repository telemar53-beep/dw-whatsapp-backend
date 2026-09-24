import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';

vi.mock('../services/api', () => ({ listAgents: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));

import { listAgents } from '../services/api';
import { useAuth } from './AuthContext';
import { AgentsProvider } from './AgentsContext';
import { useAgents } from '../hooks/useAgents';

const LISTA = [{ id: 'a1', name: 'Ana' }, { id: 'a2', name: 'Bruno' }];

// A janela de coalescência do provider é de 50ms; esperar um pouco mais que
// isso é o que faz a requisição agrupada sair.
const passarAJanela = () => act(async () => { await new Promise((r) => setTimeout(r, 90)); });

function Consumidor({ rotulo = 'c' }) {
  const { agents, status, refresh } = useAgents();
  return (
    <div>
      <span data-testid={`${rotulo}-status`}>{status}</span>
      <span data-testid={`${rotulo}-nomes`}>{agents.map((a) => a.name).join(',')}</span>
      <button type="button" onClick={() => refresh()}>{`${rotulo}-refresh`}</button>
    </div>
  );
}

function SemConsumidor() {
  return <span>nada aqui</span>;
}

describe('AgentsProvider', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ token: 'tok', agent: { id: 'a1' } });
    listAgents.mockReset();
    listAgents.mockResolvedValue(LISTA);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('não busca nada enquanto nenhum consumidor estiver montado', async () => {
    render(<AgentsProvider><SemConsumidor /></AgentsProvider>);
    await passarAJanela();
    expect(listAgents).not.toHaveBeenCalled();
  });

  test('dois consumidores montados juntos fazem uma requisição só', async () => {
    render(
      <AgentsProvider>
        <Consumidor rotulo="um" />
        <Consumidor rotulo="dois" />
      </AgentsProvider>
    );
    await waitFor(() => expect(screen.getByTestId('um-status')).toHaveTextContent('ready'));
    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dois-nomes')).toHaveTextContent('Ana,Bruno');
  });

  test('consumidor que monta depois reaproveita a lista já em memória, sem nova requisição', async () => {
    function Casca() {
      const [aberto, setAberto] = useState(false);
      return (
        <AgentsProvider>
          <Consumidor rotulo="fixo" />
          <button type="button" onClick={() => setAberto(true)}>abrir</button>
          {aberto && <Consumidor rotulo="modal" />}
        </AgentsProvider>
      );
    }
    render(<Casca />);
    await waitFor(() => expect(screen.getByTestId('fixo-status')).toHaveTextContent('ready'));
    expect(listAgents).toHaveBeenCalledTimes(1);

    act(() => { screen.getByText('abrir').click(); });

    // O modal nasce com a lista pronta: nem 'loading', nem requisição nova.
    expect(screen.getByTestId('modal-nomes')).toHaveTextContent('Ana,Bruno');
    expect(screen.getByTestId('modal-status')).toHaveTextContent('ready');
    await passarAJanela();
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  test('uma rajada de refresh vira uma requisição só', async () => {
    render(<AgentsProvider><Consumidor /></AgentsProvider>);
    await waitFor(() => expect(screen.getByTestId('c-status')).toHaveTextContent('ready'));
    expect(listAgents).toHaveBeenCalledTimes(1);

    // É o que uma única ação na fila provoca hoje: o backend emite 3 eventos
    // no mesmo handler e o TeamPanel chama refresh uma vez por evento.
    act(() => {
      screen.getByText('c-refresh').click();
      screen.getByText('c-refresh').click();
      screen.getByText('c-refresh').click();
    });
    await passarAJanela();
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  test('refresh depois da janela gera requisição nova — agrupar não engole pedido legítimo', async () => {
    render(<AgentsProvider><Consumidor /></AgentsProvider>);
    await waitFor(() => expect(screen.getByTestId('c-status')).toHaveTextContent('ready'));

    act(() => { screen.getByText('c-refresh').click(); });
    await passarAJanela();
    expect(listAgents).toHaveBeenCalledTimes(2);

    act(() => { screen.getByText('c-refresh').click(); });
    await passarAJanela();
    expect(listAgents).toHaveBeenCalledTimes(3);
  });

  test('busca de novo quando um consumidor volta a montar depois de todos saírem', async () => {
    function Casca() {
      const [visivel, setVisivel] = useState(true);
      return (
        <AgentsProvider>
          <button type="button" onClick={() => setVisivel((v) => !v)}>alternar</button>
          {visivel && <Consumidor />}
        </AgentsProvider>
      );
    }
    render(<Casca />);
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(1));

    await act(async () => { screen.getByText('alternar').click(); });
    await act(async () => { screen.getByText('alternar').click(); });

    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2));
  });

  test('não busca nada sem token', async () => {
    vi.mocked(useAuth).mockReturnValue({ token: null, agent: null });
    render(<AgentsProvider><Consumidor /></AgentsProvider>);
    await passarAJanela();
    expect(listAgents).not.toHaveBeenCalled();
  });

  test('useAgents fora do provider estoura, em vez de devolver lista vazia', () => {
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumidor />)).toThrow(/AgentsProvider/);
    silencio.mockRestore();
  });
});
