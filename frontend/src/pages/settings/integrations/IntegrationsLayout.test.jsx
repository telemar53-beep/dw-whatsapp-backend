import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import IntegrationsLayout from './IntegrationsLayout';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useAiConfig } from '../../../hooks/useAiConfig';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useSgpQueryConfig');
vi.mock('../../../hooks/useSgpIntegrations');
vi.mock('../../../hooks/useAiConfig');

const filha = vi.fn(() => <p>página filha</p>);
function Filha() { return filha(); }

function montar(agent) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  return renderInShell(
    <Routes>
      <Route element={<IntegrationsLayout />}>
        <Route path="sgp/consultas" element={<Filha />} />
      </Route>
    </Routes>,
    { path: '/configuracoes/integracoes/*', initialEntries: ['/configuracoes/integracoes/sgp/consultas'] }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSgpQueryConfig.mockReturnValue({ config: { configured: true, enabled: true }, status: 'ready' });
  useSgpIntegrations.mockReturnValue({ integrations: [] });
  useAiConfig.mockReturnValue({ config: { mode: 'assistant', configured: true }, status: 'ready' });
});

// Auditoria de 29/09: para o gerente sem credenciais, o layout pedia
// sgp-query-config e integrations/sgp (403) e ai/config antes da guarda.
describe('IntegrationsLayout: sem chamadas proibidas', () => {
  test('gerente sem a permissão vê o motivo; nenhum hook de integração nem página filha monta', () => {
    montar({ role: 'manager', canManageIntegrations: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso a Integrações' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar às Configurações' })).toHaveAttribute('href', '/configuracoes/canais');
    expect(useSgpQueryConfig).not.toHaveBeenCalled();
    expect(useSgpIntegrations).not.toHaveBeenCalled();
    expect(useAiConfig).not.toHaveBeenCalled();
    expect(filha).not.toHaveBeenCalled();
  });

  test.each([
    ['admin', { role: 'admin' }],
    ['gerente com a permissão', { role: 'manager', canManageIntegrations: true }],
  ])('%s: a faixa de serviços e a página, como antes', (_, agent) => {
    montar(agent);
    expect(screen.getByRole('heading', { level: 1, name: 'SGP: consultas' })).toBeInTheDocument();
    expect(screen.getByText('página filha')).toBeInTheDocument();
    expect(useSgpQueryConfig).toHaveBeenCalled();
    expect(useSgpIntegrations).toHaveBeenCalled();
    expect(useAiConfig).toHaveBeenCalled();
    expect(screen.getByLabelText('Estado das integrações')).toBeInTheDocument();
  });
});
