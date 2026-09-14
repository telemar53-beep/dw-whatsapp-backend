import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderProtected({ requireAdmin = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/target']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/" element={<div>Dashboard Page</div>} />
        <Route
          path="/target"
          element={
            <ProtectedRoute requireAdmin={requireAdmin}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  test('redirects to /login when there is no token', () => {
    useAuth.mockReturnValue({ token: null, agent: null });
    renderProtected();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  test('renders the children when a token is present and requireAdmin is false', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'agent' } });
    renderProtected();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  test('redirects a plain agent to / when requireAdmin is true', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'agent' } });
    renderProtected({ requireAdmin: true });
    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  test('renders the children for an admin when requireAdmin is true', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
    renderProtected({ requireAdmin: true });
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  test('renders the children for a manager when requireAdmin is true', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'manager' } });
    renderProtected({ requireAdmin: true });
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
