import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SettingsLayout from './SettingsLayout';
import SettingsPage from './SettingsPage';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext');

function renderAt(path, agent) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracoes" element={<SettingsLayout />}>
          <Route path="equipe/setores/*" element={<SettingsPage title="Setores" description="Os times" scope="global"><p>corpo setores</p></SettingsPage>} />
          <Route path="integracoes/*" element={<SettingsPage title="OpenAI" level="integrations" scope="global"><p>corpo openai</p></SettingsPage>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('SettingsLayout', () => {
  test('lista os grupos, marca o item ativo e mostra o breadcrumb', () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    const nav = screen.getByRole('navigation', { name: /seções de configurações/i });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByText('Equipe e acesso')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Equipe e acesso' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Setores' })).toBeInTheDocument();
    expect(screen.getByText('Toda a operação')).toBeInTheDocument();
    expect(screen.getByText('corpo setores')).toBeInTheDocument();
  });

  test('gerente sem a flag vê Integrações com cadeado e recebe acesso negado ao entrar', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'manager', canManageIntegrations: false });
    const link = screen.getByRole('link', { name: /integrações/i });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: /sem acesso a openai/i })).toBeInTheDocument();
  });

  test('o select de seção em celular navega', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /seção/i }), '/configuracoes/integracoes');
    expect(await screen.findByText('corpo openai')).toBeInTheDocument();
  });

  test('o select de seção mostra o item certo selecionado numa sub-rota', () => {
    renderAt('/configuracoes/equipe/setores/algum-sub-caminho', { role: 'admin' });
    expect(screen.getByRole('combobox', { name: /seção/i })).toHaveValue('/configuracoes/equipe');
  });
});
