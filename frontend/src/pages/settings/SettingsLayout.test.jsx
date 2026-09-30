import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import SettingsLayout from './SettingsLayout';
import SettingsPage from './SettingsPage';
import ChannelsListPage from './channels/ChannelsListPage';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext');
// O trilho é da mesa (tem os próprios testes); aqui só importa o que a área
// passa para ele e onde ele é desenhado.
const trilho = vi.hoisted(() => ({ props: null }));
vi.mock('../../components/TrilhoDaMesa', () => ({
  default: (props) => { trilho.props = props; return <nav aria-label="Navegação principal">trilho</nav>; },
  IconeDoMenu: () => <span>ícone do menu</span>,
}));

function Pagina({ titulo, level = 'admin' }) {
  return <SettingsPage title={titulo} level={level} scope="global"><p>corpo {titulo}</p></SettingsPage>;
}

function renderAt(path, agent, { encaixes = false } = {}) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  const encaixe = document.createElement('div');
  encaixe.setAttribute('data-testid', 'encaixe-do-trilho');
  document.body.appendChild(encaixe);
  const contexto = encaixes ? { encaixeDoTrilho: encaixe, encaixeDoIcone: null, openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, mobileNavOpen: false } : undefined;
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/configuracoes" element={<SettingsLayout />}>
            <Route path="canais" element={<Pagina titulo="Números conectados" />} />
            <Route path="regras/horario" element={<Pagina titulo="Horário de atendimento" />} />
            <Route path="mensagens/*" element={<Pagina titulo="Mensagens" />} />
            <Route path="equipe/setores/*" element={<SettingsPage title="Setores" description="Os times" scope="global"><p>corpo setores</p></SettingsPage>} />
            <Route path="equipe/*" element={<Pagina titulo="Equipe" />} />
            <Route path="automacao/*" element={<Pagina titulo="Automação" />} />
            <Route path="integracoes/*" element={<Pagina titulo="OpenAI" level="integrations" />} />
            <Route path="cadastros/*" element={<Pagina titulo="Cadastros" />} />
            <Route path="empresa" element={<Pagina titulo="Empresa" />} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  );
  return { ...utils, encaixe };
}

const diretorio = () => screen.getByRole('navigation', { name: 'Seções de configurações' });

beforeEach(() => {
  vi.clearAllMocks();
  trilho.props = null;
  document.body.innerHTML = '';
});

describe('SettingsLayout: diretório', () => {
  test('lista os grupos, marca o item ativo e mostra a trilha', () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    expect(within(diretorio()).getByRole('button', { name: /Equipe e permissões/i })).toHaveAttribute('aria-expanded', 'true');
    expect(within(diretorio()).getByRole('link', { name: 'Setores' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Setores' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Você está em' })).getByRole('link', { name: 'Configurações' })).toHaveAttribute('href', '/configuracoes');
    expect(screen.getByText('Toda a operação')).toBeInTheDocument();
    expect(screen.getByText('corpo setores')).toBeInTheDocument();
  });

  test('três áreas, na ordem do mockup, com os oito grupos', () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    const areas = within(diretorio()).getAllByRole('group');
    expect(areas.map((area) => area.getAttribute('aria-labelledby') && document.getElementById(area.getAttribute('aria-labelledby')).textContent)).toEqual(['Atendimento', 'Automação', 'Administração']);
    const nomes = (area) => [...area.querySelectorAll(':scope > a, :scope > .cfg-grupo > button')].map((e) => e.textContent.trim());
    expect(nomes(areas[0])).toEqual(['Números conectados', 'Regras e horários', 'Mensagens']);
    expect(nomes(areas[1])).toEqual(['IA e automações', 'Integrações']);
    expect(nomes(areas[2])).toEqual(['Equipe e permissões', 'Cadastros auxiliares', 'Empresa']);
  });

  test('grupo de uma página só é atalho direto, com o nome do grupo', () => {
    renderAt('/configuracoes/regras/horario', { role: 'admin' });
    const regras = within(diretorio()).getByRole('link', { name: 'Regras e horários' });
    expect(regras).toHaveAttribute('href', '/configuracoes/regras/horario');
    expect(regras).toHaveAttribute('aria-current', 'page');
    expect(within(diretorio()).getByRole('link', { name: 'Números conectados' })).toHaveAttribute('href', '/configuracoes/canais');
    expect(within(diretorio()).getByRole('link', { name: 'Empresa' })).toHaveAttribute('href', '/configuracoes/empresa');
  });

  test('Boas-vindas e Abertura e encerramento aparecem em Mensagens', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    await userEvent.click(within(diretorio()).getByRole('button', { name: 'Mensagens' }));
    const grupo = document.getElementById('settings-group-mensagens');
    expect(within(grupo).getAllByRole('link').map((a) => a.textContent.trim())).toEqual(['Boas-vindas', 'Abertura e encerramento', 'Avisos por cidade', 'Respostas rápidas', 'Templates WhatsApp']);
  });

  test('abrir outro grupo fecha o anterior; trocar de página volta ao grupo da página', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    await userEvent.click(within(diretorio()).getByRole('button', { name: 'Cadastros auxiliares' }));
    expect(within(diretorio()).getByRole('button', { name: 'Cadastros auxiliares' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(diretorio()).getByRole('button', { name: /Equipe e permissões/ })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(diretorio()).getByRole('link', { name: 'Cidades' }));
    expect(await screen.findByText('corpo Cadastros')).toBeInTheDocument();
    expect(within(diretorio()).getByRole('link', { name: 'Cidades' })).toHaveAttribute('aria-current', 'page');
  });

  test('cada página e cada grupo têm o ícone da família; a OpenAI é só texto', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    await userEvent.click(within(diretorio()).getByRole('button', { name: 'Integrações' }));
    const grupo = document.getElementById('settings-group-integracoes');
    const openai = within(grupo).getByRole('link', { name: 'OpenAI' });
    expect(openai.querySelector('svg')).toBeNull();
    expect(within(grupo).getByRole('link', { name: 'SGP: consultas' }).querySelector('svg[aria-hidden=true]')).not.toBeNull();
    diretorio().querySelectorAll(':scope .cfg-area > a, :scope .cfg-grupo > button').forEach((item) => {
      expect(item.querySelector('svg'), item.textContent).not.toBeNull();
    });
  });
});

describe('SettingsLayout: permissões', () => {
  test('gerente sem a flag vê Integrações com cadeado e o motivo ao entrar, com volta para a área', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'manager', canManageIntegrations: false });
    const botao = within(diretorio()).getByRole('button', { name: /Integrações/i });
    expect(botao).toHaveClass('is-bloqueado');
    await userEvent.click(botao);
    const link = screen.getByRole('link', { name: 'OpenAI' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('title', 'Requer permissão de Canais e Integrações');
    // O cadeado à vista, no grupo e em cada página bloqueada.
    expect(botao.querySelector('.cfg-cadeado svg')).not.toBeNull();
    expect(link.querySelector('.cfg-cadeado svg')).not.toBeNull();
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: /sem acesso a openai/i })).toBeInTheDocument();
    expect(screen.getByText(/Pode gerenciar Canais e Integrações/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar às Configurações' })).toHaveAttribute('href', '/configuracoes/canais');
    expect(screen.queryByText('corpo OpenAI')).not.toBeInTheDocument();
  });

  test('admin vê Integrações sem cadeado', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    const botao = within(diretorio()).getByRole('button', { name: 'Integrações' });
    expect(botao).not.toHaveClass('is-bloqueado');
    await userEvent.click(botao);
    expect(screen.getByRole('link', { name: 'OpenAI' })).not.toHaveAttribute('aria-disabled');
    expect(diretorio().querySelector('.cfg-cadeado')).toBeNull();
  });
});

// Revisão da S1 (29/09): no desktop a busca filtra só o diretório. A página
// aberta — aqui a real, Números conectados, com os hooks de verdade e só o
// fetch simulado — continua montada, visível e sem pedir nada de novo.
describe('SettingsLayout: a busca não mexe na página aberta (desktop)', () => {
  // Dados fictícios.
  const RESPOSTAS = {
    '/api/admin/channels': [
      { id: 'c1', type: 'baileys', name: 'Canal Suporte', phoneNumber: '+5500900000001', status: 'connected' },
      { id: 'c2', type: 'meta_cloud', name: 'Canal Comercial', phoneNumber: '+5500900000002', status: 'connected' },
    ],
    '/api/admin/triage': { questionText: '', confirmationText: '', maxAttempts: 2, options: [] },
    '/api/admin/ai/config': { configured: true, mode: 'assistant', model: 'modelo-exemplo' },
  };
  let pedidos;

  function Onde() {
    return <span data-testid="rota-atual">{useLocation().pathname}</span>;
  }

  beforeEach(() => {
    pedidos = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const caminho = new URL(url).pathname;
      pedidos.push(caminho);
      return { ok: true, status: 200, text: async () => JSON.stringify(RESPOSTAS[caminho] ?? {}) };
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('pesquisar "pix" e limpar: dois resultados no diretório; Números conectados segue montado, visível, na mesma rota e sem requisição nova', async () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    render(
      <MemoryRouter initialEntries={['/configuracoes/canais']}>
        <Routes>
          <Route path="/configuracoes" element={<SettingsLayout />}>
            <Route path="canais" element={<ChannelsListPage />} />
          </Route>
        </Routes>
        <Onde />
      </MemoryRouter>
    );

    // 1. Números conectados aberto, com os dados da página carregados.
    const titulo = screen.getByRole('heading', { level: 1, name: 'Números conectados' });
    const cartao = await screen.findByRole('link', { name: 'Canal Suporte' });
    const pedidosDaPagina = [...pedidos].sort();
    expect(pedidosDaPagina).toEqual(['/api/admin/ai/config', '/api/admin/channels', '/api/admin/triage']);

    // 2. Pesquisa "pix".
    const campo = screen.getByRole('searchbox', { name: 'Buscar configuração' });
    await userEvent.type(campo, 'pix');

    // 3. Os dois resultados, no diretório.
    const resultados = screen.getByRole('navigation', { name: 'Resultados da busca em configurações' });
    expect(within(resultados).getByRole('status')).toHaveTextContent('2 resultados');
    expect(within(resultados).getAllByRole('link').map((a) => a.textContent)).toEqual([
      expect.stringContaining('Ações permitidas à IA'),
      expect.stringContaining('SGP: Pix e boleto'),
    ]);

    // 4. Título e conteúdo continuam os mesmos nós, montados e visíveis.
    expect(screen.getByRole('heading', { level: 1, name: 'Números conectados' })).toBe(titulo);
    expect(titulo).toBeVisible();
    expect(screen.getByRole('link', { name: 'Canal Suporte' })).toBe(cartao);
    expect(cartao).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByTestId('rota-atual')).toHaveTextContent('/configuracoes/canais');

    // 5. Nenhuma requisição por digitar.
    expect([...pedidos].sort()).toEqual(pedidosDaPagina);

    // Esc limpa, o foco fica no campo e o diretório completo volta; a página
    // continua a mesma e nada é pedido.
    expect(campo).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(campo).toHaveValue('');
    expect(campo).toHaveFocus();
    expect(screen.getByRole('navigation', { name: 'Seções de configurações' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Canal Suporte' })).toBe(cartao);

    // Limpar pelo botão faz o mesmo.
    await userEvent.type(campo, 'pix');
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(campo).toHaveValue('');
    expect(screen.getByRole('heading', { level: 1, name: 'Números conectados' })).toBe(titulo);
    expect(cartao).toBeVisible();
    expect(screen.getByTestId('rota-atual')).toHaveTextContent('/configuracoes/canais');
    expect([...pedidos].sort()).toEqual(pedidosDaPagina);
  });
});

describe('SettingsLayout: busca', () => {
  test('encontra Pix, diz quantos achou e some com a navegação até limpar', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar configuração' }), 'pix');
    const results = screen.getByRole('navigation', { name: 'Resultados da busca em configurações' });
    // Como no mockup: SGP: Pix e boleto e Ações permitidas à IA (que tem pix nos termos).
    expect(within(results).getByRole('status')).toHaveTextContent('2 resultados');
    expect(within(results).getByRole('link', { name: 'Ações permitidas à IA' })).toBeInTheDocument();
    expect(within(results).getByRole('link', { name: 'SGP: Pix e boleto' })).toHaveAttribute('href', '/configuracoes/integracoes/sgp/envios');
    expect(within(results).getByText('Integrações')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Seções de configurações' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByRole('searchbox', { name: 'Buscar configuração' })).toHaveValue('');
    expect(diretorio()).toBeInTheDocument();
  });

  test('Esc no campo limpa a busca', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    const campo = screen.getByRole('searchbox', { name: 'Buscar configuração' });
    await userEvent.type(campo, 'cidade');
    await userEvent.keyboard('{Escape}');
    expect(campo).toHaveValue('');
  });

  test('a busca por desbloqueio aponta para as ações permitidas à IA', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar configuração' }), 'desbloqueio');
    expect(screen.getByRole('link', { name: 'Ações permitidas à IA' })).toHaveAttribute('href', '/configuracoes/automacao/ferramentas');
  });

  test('ignora acento e maiúscula: "HORARIO" acha Horário de atendimento', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar configuração' }), 'HORARIO');
    expect(screen.getByRole('link', { name: 'Horário de atendimento' })).toHaveAttribute('href', '/configuracoes/regras/horario');
  });

  test('sem resultado, diz que não achou', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar configuração' }), 'xyzw');
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma configuração encontrada.');
  });

  test('para o gerente sem a flag, o resultado de integração vem bloqueado', async () => {
    renderAt('/configuracoes/canais', { role: 'manager', canManageIntegrations: false });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar configuração' }), 'openai');
    expect(screen.getByRole('link', { name: 'OpenAI' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('escolher um resultado limpa a busca e abre a página', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar configuração' }), 'horário');
    await userEvent.click(screen.getByRole('link', { name: 'Horário de atendimento' }));
    expect(await screen.findByText('corpo Horário de atendimento')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar configuração' })).toHaveValue('');
  });
});

describe('SettingsLayout: celular (tela das Áreas)', () => {
  const workspace = () => document.querySelector('.settings-workspace');

  test('sem o seletor antigo: o botão Áreas abre a tela e leva o foco à página ativa', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    expect(screen.queryByRole('combobox', { name: /seção/i })).not.toBeInTheDocument();
    const areas = screen.getByRole('button', { name: 'Áreas' });
    expect(areas).toHaveAttribute('aria-expanded', 'false');
    expect(areas).toHaveAttribute('aria-controls', 'cfg-diretorio');
    await userEvent.click(areas);
    expect(areas).toHaveAttribute('aria-expanded', 'true');
    expect(workspace()).toHaveClass('cfg-areas-abertas');
    expect(document.activeElement).toBe(within(diretorio()).getByRole('link', { name: 'Setores' }));
  });

  test('Voltar fecha e devolve o foco ao botão Áreas', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    const areas = screen.getByRole('button', { name: 'Áreas' });
    await userEvent.click(areas);
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(workspace()).not.toHaveClass('cfg-areas-abertas');
    expect(document.activeElement).toBe(areas);
  });

  test('Esc fecha e devolve o foco; com texto na busca, o primeiro Esc só limpa', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    const areas = screen.getByRole('button', { name: 'Áreas' });
    await userEvent.click(areas);
    const campo = screen.getByRole('searchbox', { name: 'Buscar configuração' });
    await userEvent.type(campo, 'pix');
    await userEvent.keyboard('{Escape}');
    expect(campo).toHaveValue('');
    expect(workspace()).toHaveClass('cfg-areas-abertas');
    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(workspace()).not.toHaveClass('cfg-areas-abertas');
    expect(document.activeElement).toBe(areas);
  });

  test('escolher uma página fecha a tela, abre a página e devolve o foco', async () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    const areas = screen.getByRole('button', { name: 'Áreas' });
    await userEvent.click(areas);
    await userEvent.click(within(diretorio()).getByRole('link', { name: 'Empresa' }));
    expect(await screen.findByText('corpo Empresa')).toBeInTheDocument();
    expect(workspace()).not.toHaveClass('cfg-areas-abertas');
    expect(document.activeElement).toBe(areas);
  });

  test('o cabeçalho compacto diz a página em que se está', () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    expect(document.querySelector('.cfg-topo-titulo')).toHaveTextContent('Setores');
  });
});

describe('SettingsLayout: trilho', () => {
  test('desenha o trilho no encaixe da casca, sem o botão Equipe', () => {
    const { encaixe } = renderAt('/configuracoes/canais', { role: 'admin' }, { encaixes: true });
    expect(within(encaixe).getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(trilho.props.semEquipe).toBe(true);
  });

  test('fora da casca (sem encaixe), não desenha trilho', () => {
    renderAt('/configuracoes/canais', { role: 'admin' });
    expect(trilho.props).toBeNull();
  });
});
