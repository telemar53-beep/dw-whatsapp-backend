import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Routes, Route, Outlet, useLocation, useParams } from 'react-router-dom';
import ChannelsListPage from './ChannelsListPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

// Dados fictícios.
const suporte = { id: 'c1', type: 'baileys', name: 'Canal Suporte', phoneNumber: '+5500900000001', status: 'connected', triageEnabled: true, aiEnabled: false };
const loja = { id: 'c3', type: 'baileys', name: 'Canal Loja', phoneNumber: '+5500900000003', status: 'disconnected' };
const comercial = { id: 'c2', type: 'meta_cloud', name: 'Canal Comercial', phoneNumber: '+5500900000002', status: 'connected', connection: { state: 'connected', quality: 'GREEN' } };
const refresh = vi.fn();

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

function Detalhe() {
  return <p>detalhe {useParams().id} {useLocation().pathname}</p>;
}

function montar({ channels = [suporte, loja, comercial], status = 'ready', agent = { role: 'admin' }, estado, estrito = false } = {}) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  useChannels.mockReturnValue({ channels, status, refresh });
  const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0 };
  const Moldura = estrito ? StrictMode : ({ children }) => children;
  return render(
    <Moldura>
    <MemoryRouter initialEntries={[{ pathname: '/configuracoes/canais', state: estado }]}>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/configuracoes/canais" element={<ChannelsListPage />} />
          <Route path="/configuracoes/canais/:id/conexao" element={<Detalhe />} />
        </Route>
      </Routes>
    </MemoryRouter>
    </Moldura>
  );
}

const confirmacao = () => screen.getByRole('alertdialog');
const cartao = (nome) => screen.getByRole('link', { name: nome }).closest('li');
async function abrirMenuE(nome, item) {
  await userEvent.click(screen.getByRole('button', { name: `Mais ações para ${nome}` }));
  await userEvent.click(screen.getByRole('button', { name: item }));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of ['deleteChannel', 'setChannelHidden', 'reconnectChannel', 'createChannel']) api[f].mockReset();
  refresh.mockResolvedValue(undefined);
  useTriage.mockReturnValue({ config: {}, options: [{ id: 'o1' }], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant', nightStartTime: '22:00', nightEndTime: '06:00' }, status: 'ready', refresh: vi.fn() });
});

describe('Números conectados: estados da lista', () => {
  test('vazia: convida a adicionar o primeiro canal', async () => {
    montar({ channels: [] });
    expect(screen.getByRole('heading', { name: 'Nenhum canal conectado' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar primeiro canal' }));
    expect(await screen.findByRole('dialog', { name: 'Adicionar canal' })).toBeInTheDocument();
  });

  test('vazia para quem não pode adicionar: diz a quem pedir', () => {
    montar({ channels: [], agent: { role: 'manager', canManageIntegrations: false } });
    expect(screen.queryByRole('button', { name: /adicionar/i })).not.toBeInTheDocument();
    expect(screen.getByText('Peça a um administrador para adicionar o primeiro número.')).toBeInTheDocument();
  });

  test('falha ao carregar: explica e oferece "Tentar novamente" sem sair da página', async () => {
    montar({ channels: [], status: 'error' });
    const falha = screen.getByRole('alert');
    expect(within(falha).getByRole('heading', { name: 'Não foi possível carregar os canais' })).toBeInTheDocument();
    await userEvent.click(within(falha).getByRole('button', { name: 'Tentar novamente' }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('Números conectados: Adicionar canal', () => {
  test('o diálogo só chega no clique', async () => {
    montar();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    expect(await screen.findByRole('dialog', { name: 'Adicionar canal' })).toBeInTheDocument();
  });

  test('Baileys criado segue direto para o QR do canal novo', async () => {
    api.createChannel.mockResolvedValue({ id: 'novo', type: 'baileys', name: 'Canal Exemplo' });
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Baileys/ }));
    await userEvent.type(screen.getByLabelText('Nome do canal'), 'Canal Exemplo');
    await userEvent.type(screen.getByLabelText('Telefone'), '+5500900000099');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar' }));
    expect(await screen.findByText('detalhe novo /configuracoes/canais/novo/conexao')).toBeInTheDocument();
  });

  test('canal oficial criado fecha o diálogo, relê a lista e avisa', async () => {
    api.createChannel.mockResolvedValue({ id: 'novo', type: '360dialog', name: 'Canal Exemplo' });
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    await userEvent.click(await screen.findByRole('button', { name: /^360dialog/ }));
    await userEvent.type(screen.getByLabelText('Nome do canal'), 'Canal Exemplo');
    await userEvent.type(screen.getByLabelText('Telefone'), '+5500900000099');
    await userEvent.type(screen.getByLabelText('API Key'), 'chave-ficticia');
    await userEvent.type(screen.getByLabelText('WABA ID'), '000000000000002');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Adicionar canal' })).getByRole('button', { name: 'Adicionar canal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Canal adicionado');
  });
});

describe('Números conectados: excluir espera a resposta', () => {
  test('confirmação clara, bloqueada enquanto aguarda, com andamento no cartão; sucesso discreto', async () => {
    const pedido = adiado();
    api.deleteChannel.mockReturnValue(pedido.promessa);
    montar();
    await abrirMenuE('Canal Loja', 'Excluir');

    const d = confirmacao();
    expect(within(d).getByRole('heading', { name: 'Excluir este canal?' })).toBeInTheDocument();
    expect(d).toHaveTextContent('Canal Loja');
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(api.deleteChannel).not.toHaveBeenCalled();

    await userEvent.click(within(d).getByRole('button', { name: 'Excluir canal' }));
    expect(api.deleteChannel).toHaveBeenCalledWith('c3', 'tok');
    expect(within(confirmacao()).getByRole('button', { name: 'Excluindo…' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(confirmacao()).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(confirmacao()).toBeInTheDocument();
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Excluindo…' }));
    expect(api.deleteChannel).toHaveBeenCalledTimes(1);
    expect(cartao('Canal Loja')).toHaveAttribute('aria-busy', 'true');
    expect(within(cartao('Canal Loja')).getByText('Excluindo canal…')).toBeInTheDocument();

    await act(async () => { pedido.resolver(null); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Canal excluído');
  });

  test('recusa (409): motivo seguro no mesmo diálogo e "Ocultar em vez de excluir"', async () => {
    api.deleteChannel.mockRejectedValue({ status: 409, body: { error: 'Este canal já tem conversas ou uma integração SGP e não pode ser excluído sem perder esse histórico. Use Ocultar.' } });
    api.setChannelHidden.mockResolvedValue({});
    montar();
    await abrirMenuE('Canal Loja', 'Excluir');
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Excluir canal' }));

    const d = confirmacao();
    expect(within(d).getByRole('alert')).toHaveTextContent('Este canal já tem atendimentos ou uma integração SGP e não pode ser excluído sem perder esse histórico. Oculte o canal para tirá-lo da lista.');
    const alternativa = within(d).getByRole('button', { name: 'Ocultar em vez de excluir' });
    expect(alternativa).toHaveFocus();
    await userEvent.click(alternativa);
    expect(api.setChannelHidden).toHaveBeenCalledWith('c3', true, 'tok');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Canal ocultado');
  });

  test('outra falha: erro no diálogo e "Tentar novamente"', async () => {
    api.deleteChannel.mockRejectedValueOnce({ status: 500, body: { error: 'Internal server error' } }).mockResolvedValueOnce(null);
    montar();
    await abrirMenuE('Canal Loja', 'Excluir');
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Excluir canal' }));
    expect(within(confirmacao()).getByRole('alert')).toHaveTextContent('O servidor encontrou um erro');
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.deleteChannel).toHaveBeenCalledTimes(2);
  });
});

describe('Números conectados: ocultar e reconectar', () => {
  test('ocultar um Baileys avisa que a sessão é encerrada e espera a resposta', async () => {
    api.setChannelHidden.mockResolvedValue({});
    montar();
    await abrirMenuE('Canal Suporte', 'Ocultar');
    const d = confirmacao();
    expect(within(d).getByRole('heading', { name: 'Ocultar este canal?' })).toBeInTheDocument();
    expect(d).toHaveTextContent('A sessão do WhatsApp deste número é encerrada');
    await userEvent.click(within(d).getByRole('button', { name: 'Ocultar canal' }));
    expect(api.setChannelHidden).toHaveBeenCalledWith('c1', true, 'tok');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  test('ocultar um canal oficial não fala de sessão', async () => {
    montar();
    await abrirMenuE('Canal Comercial', 'Ocultar');
    expect(confirmacao()).not.toHaveTextContent(/sessão/i);
  });

  test('reconectar um Baileys desconectado: sem diálogo, andamento e erro no próprio cartão', async () => {
    const pedido = adiado();
    api.reconnectChannel.mockReturnValue(pedido.promessa);
    montar();
    await abrirMenuE('Canal Loja', 'Reconectar');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(cartao('Canal Loja')).getByText('Reconectando…')).toBeInTheDocument();
    await act(async () => { pedido.rejeitar({ status: 500, body: { error: 'Internal server error' } }); });
    const alerta = within(cartao('Canal Loja')).getByRole('alert');
    expect(alerta).toHaveTextContent('O servidor encontrou um erro');
    api.reconnectChannel.mockResolvedValue({});
    await userEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    expect(api.reconnectChannel).toHaveBeenCalledTimes(2);
  });
});

describe('Números conectados: foco', () => {
  test('fechar a confirmação devolve o foco ao "⋯" que abriu o menu', async () => {
    montar();
    await abrirMenuE('Canal Loja', 'Excluir');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais ações para Canal Loja' })).toHaveFocus();
  });

  test('Cancelar também devolve o foco', async () => {
    montar();
    await abrirMenuE('Canal Loja', 'Excluir');
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Mais ações para Canal Loja' })).toHaveFocus();
  });
});

describe('Números conectados: aviso vindo do detalhe', () => {
  test('exclusão concluída no detalhe aparece como aviso discreto na lista', () => {
    montar({ estado: { aviso: { titulo: 'Canal excluído', texto: '“Canal Teste” foi removido da lista.' } } });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Canal excluído');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('“Canal Teste” foi removido da lista.');
  });

  // O detalhe de onde se veio não existe mais: o foco não fica no <body>
  // (medido no navegador), vai para a busca, ou para a ação da lista vazia.
  test('chegando do detalhe depois de excluir, o foco vai para a busca', async () => {
    montar({ estado: { aviso: { titulo: 'Canal excluído', texto: '“Canal Teste” foi removido da lista.' } } });
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' })).toHaveFocus());
  });

  test('se a lista ficou vazia, o foco vai para "Adicionar primeiro canal"', async () => {
    montar({ channels: [], estado: { aviso: { titulo: 'Canal excluído', texto: '“Canal Teste” foi removido da lista.' } } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar primeiro canal' })).toHaveFocus());
  });

  // O app roda em StrictMode: o efeito roda duas vezes em desenvolvimento.
  test('no StrictMode também: o foco vai para a busca', async () => {
    montar({ estrito: true, estado: { aviso: { titulo: 'Canal excluído', texto: '“Canal Teste” foi removido da lista.' } } });
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' })).toHaveFocus());
  });

  test('entrada comum na lista não mexe no foco', async () => {
    montar();
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
    expect(document.body).toHaveFocus();
  });
});

describe('Números conectados: comportamento de antes', () => {
  test('"Mostrar ocultos" pede os ocultos ao hook', async () => {
    montar();
    await userEvent.click(screen.getByRole('checkbox', { name: /mostrar ocultos/i }));
    expect(useChannels).toHaveBeenLastCalledWith(true, true);
  });

  test('em carregamento não diz que está vazio', () => {
    montar({ channels: [], status: 'loading' });
    expect(screen.queryByText(/nenhum canal/i)).not.toBeInTheDocument();
  });
});

describe('Números conectados: permissões', () => {
  test('gerente sem a flag vê a lista, sem "Adicionar canal" e sem "⋯"', () => {
    montar({ agent: { role: 'manager', canManageIntegrations: false } });
    expect(screen.getByRole('link', { name: 'Canal Suporte' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adicionar canal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mais ações/i })).not.toBeInTheDocument();
  });
});
