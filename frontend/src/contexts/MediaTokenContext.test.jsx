import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MediaTokenProvider, useMediaToken } from './MediaTokenContext';
import { useAuth } from './AuthContext';
import * as api from '../services/api';

vi.mock('./AuthContext');
vi.mock('../services/api');

function Espiao({ aoRenderizar }) {
  const { obterToken, pronto } = useMediaToken();
  aoRenderizar();
  return <div data-testid="estado">{pronto ? `pronto:${obterToken()}` : 'esperando'}</div>;
}

describe('MediaTokenProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAuth.mockReturnValue({ token: 'sessao-123' });
    api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-1', expiresInSeconds: 1800 });
  });

  afterEach(() => vi.useRealTimers());

  test('pede um token so, e ele serve para todos os recursos', async () => {
    render(
      <MediaTokenProvider>
        <Espiao aoRenderizar={() => {}} />
        <Espiao aoRenderizar={() => {}} />
        <Espiao aoRenderizar={() => {}} />
      </MediaTokenProvider>
    );

    await waitFor(() => expect(screen.getAllByTestId('estado')[0]).toHaveTextContent('pronto:media-1'));
    // Tres consumidores, UMA chamada.
    expect(api.fetchMediaToken).toHaveBeenCalledTimes(1);
    expect(api.fetchMediaToken).toHaveBeenCalledWith('sessao-123');
  });

  test('autentica a emissao pelo token de sessao, por header', async () => {
    render(<MediaTokenProvider><Espiao aoRenderizar={() => {}} /></MediaTokenProvider>);
    await waitFor(() => expect(api.fetchMediaToken).toHaveBeenCalledWith('sessao-123'));
  });

  // O ponto central: renovar nao pode re-renderizar a arvore, senao o React
  // reescreve o src de toda imagem, audio e video montado.
  test('renovar o token NAO re-renderiza quem consome', async () => {
    const renders = vi.fn();
    render(<MediaTokenProvider><Espiao aoRenderizar={renders} /></MediaTokenProvider>);
    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('pronto:media-1'));
    const antes = renders.mock.calls.length;

    api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-2', expiresInSeconds: 1800 });
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 1000); });

    expect(api.fetchMediaToken).toHaveBeenCalledTimes(2);
    expect(renders.mock.calls.length).toBe(antes);
  });

  test('o token novo fica disponivel para quem pedir depois', async () => {
    let obter;
    function Leitor() {
      obter = useMediaToken().obterToken;
      return null;
    }
    render(<MediaTokenProvider><Leitor /></MediaTokenProvider>);
    await waitFor(() => expect(obter()).toBe('media-1'));

    api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-2', expiresInSeconds: 1800 });
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 1000); });

    expect(obter()).toBe('media-2');
  });

  test('renova aos 25 minutos, nao aos 30', async () => {
    render(<MediaTokenProvider><Espiao aoRenderizar={() => {}} /></MediaTokenProvider>);
    await waitFor(() => expect(api.fetchMediaToken).toHaveBeenCalledTimes(1));

    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 1000); });
    expect(api.fetchMediaToken).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000); });
    expect(api.fetchMediaToken).toHaveBeenCalledTimes(2);
  });

  test('falha de rede nao apaga o token que ainda vale, e tenta de novo', async () => {
    let obter;
    function Leitor() { obter = useMediaToken().obterToken; return null; }
    render(<MediaTokenProvider><Leitor /></MediaTokenProvider>);
    await waitFor(() => expect(obter()).toBe('media-1'));

    api.fetchMediaToken.mockRejectedValue(new Error('rede caiu'));
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 1000); });
    expect(obter()).toBe('media-1');

    api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-3', expiresInSeconds: 1800 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000); });
    expect(obter()).toBe('media-3');
  });

  test('sem sessao, nao pede token nenhum', async () => {
    useAuth.mockReturnValue({ token: null });
    render(<MediaTokenProvider><Espiao aoRenderizar={() => {}} /></MediaTokenProvider>);
    expect(api.fetchMediaToken).not.toHaveBeenCalled();
    expect(screen.getByTestId('estado')).toHaveTextContent('esperando');
  });

  test('o token de midia nunca vai para o localStorage', async () => {
    render(<MediaTokenProvider><Espiao aoRenderizar={() => {}} /></MediaTokenProvider>);
    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('pronto:media-1'));

    const guardado = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('|');
    expect(guardado).not.toContain('media-1');
  });
});
