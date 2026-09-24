import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileModal from './ProfileModal';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

// Diferente de ProfileModal.test.jsx, aqui o AuthContext e a API são os REAIS e
// só o fetch é simulado. O defeito (PRF-12) morava entre os dois: o backend
// recusa a senha atual errada com 401, e o apiFetch tratava todo 401 como sessão
// expirada — chamava o logout do AuthContext, e o atendente caía no login.
function Sessao() {
  const { token } = useAuth();
  return <p data-testid="sessao">{token ? 'com sessão' : 'sem sessão'}</p>;
}

const resposta = (status, corpo) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(corpo)) });

let respostaDaSenha;

beforeEach(() => {
  localStorage.setItem('dw_token', 'tok-123');
  localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', name: 'Ana', role: 'agent' }));
  global.fetch = vi.fn((url, opcoes = {}) => {
    if (url.endsWith('/api/agents/me') && (!opcoes.method || opcoes.method === 'GET')) {
      return resposta(200, { id: 'a1', name: 'Ana', email: 'ana@exemplo.com', phone: null, avatarPath: null });
    }
    if (url.endsWith('/api/auth/password')) return respostaDaSenha();
    return resposta(404, { error: 'Not found' });
  });
});

afterEach(() => {
  localStorage.clear();
});

async function trocarSenha() {
  render(
    <AuthProvider>
      <Sessao />
      <ProfileModal onClose={vi.fn()} onProfileUpdated={vi.fn()} />
    </AuthProvider>
  );
  await screen.findByDisplayValue('Ana');
  await userEvent.click(screen.getByText('Atualize sua senha de acesso.'));
  await userEvent.type(screen.getByLabelText(/senha atual/i), 'errada123');
  await userEvent.type(screen.getByLabelText(/^nova senha/i), 'nova12345');
  await userEvent.type(screen.getByLabelText(/confirmar nova senha/i), 'nova12345');
  await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));
}

describe('trocar a senha com a senha atual errada (PRF-12)', () => {
  test('mostra "A senha atual está incorreta." e a pessoa continua logada', async () => {
    respostaDaSenha = () => resposta(401, { error: 'Current password is incorrect' });

    await trocarSenha();

    expect(await screen.findByText('A senha atual está incorreta.')).toBeInTheDocument();
    expect(screen.getByTestId('sessao')).toHaveTextContent('com sessão');
    expect(localStorage.getItem('dw_token')).toBe('tok-123');
  });

  test('com a sessão expirada no meio, desloga como qualquer outra tela', async () => {
    respostaDaSenha = () => resposta(401, { error: 'Invalid or expired token' });

    await trocarSenha();

    expect(await screen.findByText('sem sessão')).toBeInTheDocument();
    expect(localStorage.getItem('dw_token')).toBeNull();
  });
});
