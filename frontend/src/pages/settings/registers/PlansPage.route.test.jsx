import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../../../App';
import * as api from '../../../services/api';
import { io } from 'socket.io-client';
import { SETTINGS_SECTIONS } from '../../../navigation/navItems';

vi.mock('../../../services/api');
vi.mock('socket.io-client');

// Import não prova montagem: já aconteceu neste projeto de um módulo estar
// importado, passar no grep e nunca ter sido montado — e ir a produção assim.
// Aqui a rota de Planos é alcançada pelo App REAL (que monta o próprio
// BrowserRouter), e o que se prova é o efeito: a página aparece, em vez de a
// rota cair no redirect do índice de Cadastros.
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.listPlansForAdmin.mockResolvedValue([]);
  localStorage.setItem('dw_token', 'tok-123');
  localStorage.setItem('dw_agent', JSON.stringify({ id: 'admin-1', email: 'a@x.com', role: 'admin' }));
});

describe('rota de Planos', () => {
  test('esta declarada no menu de Cadastros auxiliares, com nivel admin', () => {
    const grupo = SETTINGS_SECTIONS.find((g) => g.groupKey === 'cadastros');
    const item = grupo.items.find((i) => i.key === 'planos');

    expect(item).toBeDefined();
    expect(item.to).toBe('/configuracoes/cadastros/planos');
    expect(item.level).toBe('admin');
  });

  test('a pagina aparece ao navegar para o caminho dela', async () => {
    window.history.pushState({}, '', '/configuracoes/cadastros/planos');

    render(<App />);

    expect(await screen.findByRole('button', { name: /novo plano/i })).toBeInTheDocument();
  });
});
