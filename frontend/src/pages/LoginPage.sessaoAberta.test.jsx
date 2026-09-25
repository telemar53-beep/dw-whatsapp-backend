import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

// Irmão do PRF-12, pela porta do login: o /login não tem guarda (App.jsx), então
// quem já está logado pode chegar nele pelo "Voltar" ou pela barra de endereço.
// O backend recusa a senha errada com 401 "Invalid credentials"
// (src/auth/auth.routes.js:19), e o apiFetch tratava todo 401 como sessão
// expirada: errar a senha ali apagava a sessão que estava aberta — inclusive a
// de outra aba, porque o token mora no localStorage.
// Aqui AuthContext e API são os REAIS; só o fetch é simulado.
function Sessao() {
  const { token } = useAuth();
  return <p data-testid="sessao">{token ? 'com sessão' : 'sem sessão'}</p>;
}

const resposta = (status, corpo) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(corpo)) });

beforeEach(() => {
  localStorage.setItem('dw_token', 'tok-aberto');
  localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', name: 'Ana', role: 'agent' }));
  global.fetch = vi.fn((url) => {
    if (url.endsWith('/api/auth/login')) return resposta(401, { error: 'Invalid credentials' });
    if (url.endsWith('/api/public/company')) return resposta(200, { name: '' });
    return resposta(404, { error: 'Not found' });
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('errar a senha no /login com uma sessão aberta', () => {
  test('mostra "E-mail ou senha incorretos." e a sessão aberta continua', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Sessao />
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeInTheDocument();
    expect(screen.getByTestId('sessao')).toHaveTextContent('com sessão');
    expect(localStorage.getItem('dw_token')).toBe('tok-aberto');
  });
});
