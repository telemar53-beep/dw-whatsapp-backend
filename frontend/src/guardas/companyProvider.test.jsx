import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import * as api from '../services/api';
import { io } from 'socket.io-client';

vi.mock('../services/api');
vi.mock('socket.io-client');

// Guarda do CompanyProvider: UMA cópia do nome da empresa por sessão.
//
// O useCompanyName, sem provider acima, cai de propósito no comportamento
// antigo — cada consumidor busca o seu (ver hooks/useCompanyName.js). O preço
// dessa queda é que um provider esquecido NÃO quebra nada: a tela funciona e
// só volta a sair uma requisição por consumidor (duas no login, com dois
// preflights; três ou quatro na mesa de atendimento).
//
// Por isso a prova é por CONTAGEM, na árvore real do App, e não por leitura do
// JSX: import não prova montagem — já foi a produção um provider importado e
// nunca montado (ver App.providers.test.jsx).

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.title = '';
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-abc', expiresInSeconds: 1800 });
  api.getQueue.mockResolvedValue([]);
  api.getMyConversations.mockResolvedValue([]);
  api.listChannels.mockResolvedValue([]);
  api.listChannelsForAgent.mockResolvedValue([]);
  api.listAgents.mockResolvedValue([]);
  api.listSectors.mockResolvedValue([]);
});

describe('nome da empresa: uma requisição por sessão', () => {
  // Consumidores nesta tela: <TituloDaAba /> (fora do <Routes>) e a LoginPage.
  test('na tela de login, título da aba e formulário dividem a mesma busca', async () => {
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByText('Acesso restrito à equipe de atendimento da Provedor X.')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Provedor X · Atendimento'));
    expect(api.getPublicCompany).toHaveBeenCalledTimes(1);
  });

  // Consumidores somados: título da aba, LoginPage, depois SideNav e
  // DashboardPage. A sessão inteira continua com uma busca só.
  test('entrar pelo formulário e chegar ao Atendimento não busca de novo', async () => {
    api.login.mockResolvedValue({ token: 'tok-123', agent: { id: 'agent-1', email: 'a@dw.com', role: 'agent' } });
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByText('Acesso restrito à equipe de atendimento da Provedor X.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    // A tela vazia da mesa cita a empresa: prova que a DashboardPage montou e
    // já leu o nome.
    expect(await screen.findByText('Provedor X · Atendimento')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument();
    expect(api.getPublicCompany).toHaveBeenCalledTimes(1);
  });

  test('com a sessão já aberta, abrir direto no Atendimento faz uma busca só', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'agent-1', role: 'agent' }));
    window.history.pushState({}, '', '/');

    render(<App />);

    expect(await screen.findByText('Provedor X · Atendimento')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Provedor X · Atendimento'));
    expect(api.getPublicCompany).toHaveBeenCalledTimes(1);
  });
});
