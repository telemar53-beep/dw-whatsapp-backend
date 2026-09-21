import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  vi.clearAllMocks();
  // A tela de login le o nome da empresa sem token (rota publica).
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
});

describe('LoginPage: nome da empresa', () => {
  test('mostra o nome cadastrado no titulo e no rodape', async () => {
    useAuth.mockReturnValue({ login: vi.fn() });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Provedor X' })).toBeInTheDocument();
    expect(screen.getByText(/Acesso restrito a equipe de atendimento da Provedor X\.|Acesso restrito à equipe de atendimento da Provedor X\./)).toBeInTheDocument();
  });

  test('sem empresa cadastrada, o titulo cai em Atendimento', async () => {
    api.getPublicCompany.mockResolvedValue({ name: '' });
    useAuth.mockReturnValue({ login: vi.fn() });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Atendimento' })).toBeInTheDocument();
  });

  test('em carregamento não mostra "Atendimento" genérico', () => {
    api.getPublicCompany.mockReturnValue(new Promise(() => {}));
    useAuth.mockReturnValue({ login: vi.fn() });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('heading', { name: 'Atendimento' })).not.toBeInTheDocument();
  });

  test('a rota publica fora do ar nao quebra a tela', async () => {
    api.getPublicCompany.mockRejectedValue(new Error('offline'));
    useAuth.mockReturnValue({ login: vi.fn() });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Atendimento' })).toBeInTheDocument();
  });
});

describe('LoginPage', () => {
  test('submits the form and navigates to the dashboard on success', async () => {
    const login = vi.fn().mockResolvedValue({});
    useAuth.mockReturnValue({ login });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/e-mail/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('a@dw.com', 'secret123'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  test('shows an error message when login fails', async () => {
    const login = vi.fn().mockRejectedValue({ body: { error: 'Invalid credentials' } });
    useAuth.mockReturnValue({ login });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/e-mail/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
