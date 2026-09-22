import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import App from './App';
import * as api from './services/api';
import { io } from 'socket.io-client';

vi.mock('./services/api');
vi.mock('socket.io-client');

// Este arquivo existe por causa de um bug real: o MediaTokenProvider foi
// importado no App.jsx e NUNCA montado no JSX. Todos os testes passavam — o de
// MediaTokenContext monta o provider ele mesmo —, o build compilava, e o
// frontend foi para produção pedindo mídia pelo caminho legado, sem nunca
// emitir um token. Um `grep` pelo import dava positivo e escondia o problema.
//
// O que se testa aqui é a ÁRVORE REAL do App: se alguém remover o provider do
// JSX de novo, estes testes falham, mesmo com o import intacto.

function logarComo(agent) {
  localStorage.setItem('dw_token', 'tok-123');
  localStorage.setItem('dw_agent', JSON.stringify(agent));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.getQueue.mockResolvedValue([]);
  api.getMyConversations.mockResolvedValue([]);
  api.listChannelsForAgent.mockResolvedValue([]);
  api.listAgents.mockResolvedValue([]);
  api.listSectors.mockResolvedValue([]);
  api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-abc', expiresInSeconds: 1800 });
});

describe('composição de providers do App', () => {
  test('com sessão ativa, o App pede o token de mídia', async () => {
    logarComo({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/');

    render(<App />);

    // Se o MediaTokenProvider não estiver montado no JSX, ninguém pede token e
    // este waitFor estoura — que é exatamente o bug que aconteceu.
    await waitFor(() => expect(api.fetchMediaToken).toHaveBeenCalled());
    expect(api.fetchMediaToken).toHaveBeenCalledWith('tok-123');
  });

  test('pede uma vez só, não uma por recurso', async () => {
    logarComo({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/');

    render(<App />);

    await waitFor(() => expect(api.fetchMediaToken).toHaveBeenCalled());
    expect(api.fetchMediaToken).toHaveBeenCalledTimes(1);
  });

  test('sem sessão, o App não pede token de mídia', async () => {
    window.history.pushState({}, '', '/login');

    render(<App />);

    await waitFor(() => expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument());
    expect(api.fetchMediaToken).not.toHaveBeenCalled();
  });

});
