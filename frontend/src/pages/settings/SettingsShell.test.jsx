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

// Opcionais da Fatia S2 (detalhe do canal). Sem eles, nada muda (acima).
describe('SettingsShell: trilha própria, voltar, marca e sem acesso (S2)', () => {
  const trilha = [{ label: 'Configurações', to: '/configuracoes' }, { label: 'Números conectados' }, { label: 'Canal Suporte' }];
  const voltar = { to: '/configuracoes/canais', rotulo: 'Números conectados' };

  test('a trilha própria substitui a padrão; o voltar é o único link para a lista', () => {
    montar('/configuracoes/canais/c1/conexao', { level: 'integrations', title: 'Canal Suporte', trilha, voltar });
    const nav = screen.getByRole('navigation', { name: 'Você está em' });
    expect(nav).toHaveTextContent('Configurações›Números conectados›Canal Suporte');
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
    const links = screen.getAllByRole('link', { name: 'Números conectados' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/configuracoes/canais');
    expect(links[0]).toHaveClass('cfg-voltar-link');
  });

  test('a marca toma o lugar do ladrilho do ícone', () => {
    montar('/configuracoes/canais/c1/conexao', { level: 'integrations', title: 'Canal Suporte', iconName: 'canais', marca: <span className="cfg-emblema">BL</span> });
    expect(document.querySelector('.cfg-titulo-marca .cfg-emblema')).toHaveTextContent('BL');
    expect(document.querySelector('.settings-title-mark')).toBeNull();
  });

  test('sem acesso com texto próprio: título, texto, trilha e voltar, e nada do conteúdo', () => {
    montar(
      '/configuracoes/canais/c1/conexao',
      {
        level: 'integrations',
        trilha,
        voltar,
        semAcesso: { titulo: 'Sem acesso a este canal', texto: 'Seu perfil pode ver a lista.', voltar: { to: '/configuracoes/canais', rotulo: 'Voltar aos canais' } },
      },
      { role: 'manager', canManageIntegrations: false }
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso a este canal' })).toBeInTheDocument();
    expect(screen.getByText('Seu perfil pode ver a lista.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar aos canais' })).toHaveAttribute('href', '/configuracoes/canais');
    expect(screen.getByRole('navigation', { name: 'Você está em' })).toBeInTheDocument();
    expect(document.querySelector('.cfg-sem-acesso-topo .cfg-voltar-link')).toHaveAttribute('href', '/configuracoes/canais');
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });
});
