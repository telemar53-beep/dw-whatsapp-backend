import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

function renderAt(level, agent, areaLabel = 'Supervisão') {
  useAuth.mockReturnValue({ token: agent ? 'tok' : null, agent });
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <Routes>
        <Route path="/login" element={<p>Login</p>} />
        <Route
          path="/x"
          element={
            <ProtectedRoute level={level} areaLabel={areaLabel}>
              <p>Conteúdo protegido</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ProtectedRoute', () => {
  test('sem token manda para /login', () => {
    renderAt('auth', null);
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  test('atendente entra em nível auth', () => {
    renderAt('auth', { role: 'agent' });
    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
  });

  test('atendente em nível admin vê a página de acesso negado com o nome da área', () => {
    renderAt('admin', { role: 'agent' });
    expect(screen.getByRole('heading', { name: /sem acesso a supervisão/i })).toBeInTheDocument();
    expect(screen.getByText(/administradores e gerentes/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir para o atendimento/i })).toHaveAttribute('href', '/');
  });

  test('gerente sem a flag em nível integrations vê a explicação da permissão', () => {
    renderAt('integrations', { role: 'manager', canManageIntegrations: false }, 'OpenAI');
    expect(screen.getByRole('heading', { name: /sem acesso a openai/i })).toBeInTheDocument();
    expect(screen.getByText(/canais e integrações/i)).toBeInTheDocument();
  });

  test('gerente com a flag entra em nível integrations', () => {
    renderAt('integrations', { role: 'manager', canManageIntegrations: true });
    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
  });

  test('requireAdmin ainda funciona como alias de level admin', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager' } });
    render(
      <MemoryRouter>
        <ProtectedRoute requireAdmin><p>ok</p></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
