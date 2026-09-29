import { describe, test, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import SettingsShell from './SettingsShell';
import { renderInShell } from '../../test-utils/renderInShell';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext');

function montar(path, props = {}, agent = { role: 'admin' }) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  return renderInShell(<SettingsShell {...props}><p>conteúdo</p></SettingsShell>, { path });
}

describe('SettingsShell: cabeçalho da página (mockup S1)', () => {
  test('trilha, ladrilho com o ícone da página, título só com o nome e a descrição de navItems', () => {
    montar('/configuracoes/equipe/setores');
    const trilha = screen.getByRole('navigation', { name: 'Você está em' });
    expect(within(trilha).getByRole('link', { name: 'Configurações' })).toHaveAttribute('href', '/configuracoes');
    expect(trilha).toHaveTextContent('Equipe e permissões');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Setores');
    expect(h1.querySelector('svg')).toBeNull();
    const ladrilho = document.querySelector('.settings-title-mark');
    expect(ladrilho.querySelector('svg[aria-hidden=true]')).not.toBeNull();
    expect(screen.getByText('Filas e times de atendimento.')).toBeInTheDocument();
  });

  test('OpenAI é só texto: sem ladrilho de ícone', () => {
    montar('/configuracoes/integracoes/openai', { level: 'integrations' });
    expect(screen.getByRole('heading', { level: 1, name: 'OpenAI' })).toBeInTheDocument();
    expect(document.querySelector('.settings-title-mark')).toBeNull();
  });

  test('a ação e o escopo ficam à direita do título', () => {
    montar('/configuracoes/canais', { scope: 'global', action: <button type="button">Adicionar canal</button> });
    const acao = document.querySelector('.cfg-cabecalho-acao');
    expect(within(acao).getByRole('button', { name: 'Adicionar canal' })).toBeInTheDocument();
    expect(within(acao).getByText('Toda a operação')).toBeInTheDocument();
  });

  test('sem permissão: o motivo, a volta para a primeira página permitida e nada do conteúdo', () => {
    montar('/configuracoes/integracoes/openai', { level: 'integrations' }, { role: 'manager', canManageIntegrations: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso a OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar às Configurações' })).toHaveAttribute('href', '/configuracoes/canais');
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    expect(document.querySelector('.cfg-sem-acesso-icone svg')).not.toBeNull();
  });
});
