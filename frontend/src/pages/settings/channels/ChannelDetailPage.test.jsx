import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ChannelDetailPage from './ChannelDetailPage';
import ChannelConnectionTab from './ChannelConnectionTab';
import ChannelBehaviorTab from './ChannelBehaviorTab';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useBusinessHoursConfig } from '../../../hooks/useBusinessHoursConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useBusinessHoursConfig');
vi.mock('../../../services/api');

// Dados fictícios.
const refresh = vi.fn();
const base = { triageEnabled: false, aiEnabled: false, aiTriageEnabled: false, aiNightModeEnabled: false, welcomeMessage: null, hidden: false };
const suporte = { ...base, id: 'c1', type: 'baileys', name: 'Canal Suporte', phoneNumber: '+5500900000001', status: 'connected', triageEnabled: true };
const vendas = { ...base, id: 'c2', type: 'baileys', name: 'Canal Vendas', phoneNumber: '+5500900000002', status: 'awaiting_qr' };
const loja = { ...base, id: 'c3', type: 'baileys', name: 'Canal Loja', phoneNumber: '+5500900000003', status: 'disconnected' };
const comercial = { ...base, id: 'c4', type: 'meta_cloud', name: 'Canal Comercial', phoneNumber: '+5500900000004', status: 'connected', wabaId: '000000000000001', connection: { state: 'connected', quality: 'YELLOW' } };
const retencao = { ...base, id: 'c5', type: 'meta_cloud', name: 'Canal Retenção', phoneNumber: '+5500900000005', status: 'connected', wabaId: '000000000000001', connection: { state: 'error', motivo: '(190) Token de acesso inválido' } };
const cobranca = { ...base, id: 'c6', type: '360dialog', name: 'Canal Cobrança', phoneNumber: '+5500900000006', status: 'connected', wabaId: '000000000000002' };

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

function Lista() {
  const { state } = useLocation();
  return <p>lista de canais {state && state.aviso ? state.aviso.titulo : ''}</p>;
}

function abrir(canal, aba = 'conexao', { agent = { role: 'admin' }, canais } = {}) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  useChannels.mockReturnValue({ channels: canais || [canal], status: 'ready', refresh });
  return render(
    <MemoryRouter initialEntries={[`/configuracoes/canais/${canal.id}/${aba}`]}>
      <Routes>
        <Route path="/configuracoes/canais/:id" element={<ChannelDetailPage />}>
          <Route path="conexao" element={<ChannelConnectionTab />} />
          <Route path="atendimento" element={<ChannelBehaviorTab />} />
        </Route>
        <Route path="/configuracoes/canais" element={<Lista />} />
      </Routes>
    </MemoryRouter>
  );
}
const area = (nome) => screen.getByRole('heading', { level: 2, name: nome }).closest('section');
const confirmacao = () => screen.getByRole('alertdialog');

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of ['deleteChannel', 'setChannelHidden', 'reconnectChannel', 'setChannelName', 'setChannelWabaId', 'setMetaCloudCredentials', 'setChannelTriageEnabled', 'setChannelAiEnabled', 'setChannelAiTriageEnabled', 'setChannelAiNightModeEnabled', 'fetchChannelQrImage']) api[f].mockReset();
  refresh.mockResolvedValue(undefined);
  useTriage.mockReturnValue({ config: {}, options: [{ id: 'o1' }], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant', model: 'modelo', nightStartTime: null, nightEndTime: null }, status: 'ready', refresh: vi.fn() });
  useBusinessHoursConfig.mockReturnValue({ config: { enabled: false, startTime: '08:00', endTime: '18:00' }, status: 'ready', refresh: vi.fn() });
  api.fetchChannelQrImage.mockResolvedValue('data:image/png;base64,QR');
  for (const f of ['deleteChannel', 'setChannelHidden', 'reconnectChannel', 'setChannelName', 'setChannelWabaId', 'setChannelTriageEnabled', 'setChannelAiEnabled', 'setChannelAiTriageEnabled', 'setChannelAiNightModeEnabled']) api[f].mockResolvedValue({});
});
afterEach(() => { delete window.matchMedia; });

describe('Detalhe do canal: cabeçalho e áreas (mockup)', () => {
  test('o nome do canal é o título; "Números conectados" é o caminho de volta; sem "Trocar de canal"', () => {
    abrir(suporte, 'conexao', { canais: [suporte, loja] });
    expect(screen.getByRole('heading', { level: 1, name: 'Canal Suporte' })).toBeInTheDocument();
    const voltar = screen.getByRole('link', { name: 'Números conectados' });
    expect(voltar).toHaveAttribute('href', '/configuracoes/canais');
    expect(screen.getByRole('navigation', { name: 'Você está em' })).toHaveTextContent('Configurações›Números conectados›Canal Suporte');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/trocar de canal/i)).not.toBeInTheDocument();
    expect(document.querySelector('.cfg-cabecalho .cfg-emblema')).toHaveTextContent('BL');
    expect(screen.getByText('+55 (00) 90000-0001 · Baileys')).toBeInTheDocument();
  });

  test('áreas: Conexão, Identificação e Ações do canal; Atendimento é a outra aba', () => {
    abrir(suporte);
    for (const nome of ['Conexão', 'Identificação', 'Ações do canal']) expect(screen.getByRole('heading', { level: 2, name: nome })).toBeInTheDocument();
    const abas = screen.getByRole('navigation', { name: 'Seções do canal' });
    expect(within(abas).getByRole('link', { name: 'Conexão' })).toHaveAttribute('aria-current', 'page');
    expect(within(abas).getByRole('link', { name: 'Atendimento' })).toHaveAttribute('href', '/configuracoes/canais/c1/atendimento');
  });

  test('ações por gravidade: organização separada das permanentes, sem caixa dentro de caixa', () => {
    abrir(suporte);
    const acoes = area('Ações do canal');
    const organizacao = within(acoes).getByRole('group', { name: 'Organização' });
    const permanentes = within(acoes).getByRole('group', { name: 'Ações permanentes' });
    expect(within(organizacao).getByRole('button', { name: 'Ocultar na lista' })).toBeInTheDocument();
    expect(within(permanentes).getByRole('button', { name: 'Migrar para Meta Cloud' })).toBeInTheDocument();
    expect(within(permanentes).getByRole('button', { name: 'Excluir canal' })).toBeInTheDocument();
    expect(permanentes.querySelector('section, details')).toBeNull();
    expect(document.querySelector('details')).toBeNull();
  });

  test('canal inexistente: aviso e caminho para a lista', () => {
    abrir({ ...suporte, id: 'nao-existe' }, 'conexao', { canais: [suporte] });
    expect(screen.getByText(/canal não encontrado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voltar para a lista/i })).toHaveAttribute('href', '/configuracoes/canais');
  });
});

describe('Detalhe do canal: estados reais', () => {
  test('Baileys conectado: conexão normal e Reconectar na área Conexão', () => {
    abrir(suporte);
    expect(area('Conexão')).toHaveTextContent('Conexão normal');
    expect(within(area('Conexão')).getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
  });

  test('Baileys aguardando: o QR na área Conexão', async () => {
    abrir(vendas);
    expect(await within(area('Conexão')).findByRole('img', { name: 'QR code para conectar Canal Vendas' })).toBeInTheDocument();
  });

  test('Baileys desconectado: diz que não está ligado e como religar', () => {
    abrir(loja);
    expect(area('Conexão')).toHaveTextContent('Desconectado');
    expect(area('Conexão')).toHaveTextContent('Use Reconectar para gerar um novo QR code.');
  });

  test('Meta Cloud com qualidade média: a qualidade à vista, credenciais e sem Reconectar nem Migrar', () => {
    abrir(comercial);
    expect(area('Conexão')).toHaveTextContent('Qualidade média');
    expect(within(area('Conexão')).getByRole('button', { name: 'Atualizar credenciais' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconectar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Migrar para Meta Cloud' })).not.toBeInTheDocument();
  });

  test('Meta Cloud com erro: o motivo da Meta e o que fazer', () => {
    abrir(retencao);
    expect(area('Conexão')).toHaveTextContent('(190) Token de acesso inválido');
    expect(area('Conexão')).toHaveTextContent('Atualize as credenciais');
  });

  test('360dialog: não verificada por este sistema, com Migrar', () => {
    abrir(cobranca);
    expect(area('Conexão')).toHaveTextContent('Não verificada');
    expect(screen.getByRole('button', { name: 'Migrar para Meta Cloud' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atualizar credenciais' })).not.toBeInTheDocument();
  });

  test('canal oculto: diz que está oculto e oferece Reexibir', () => {
    abrir({ ...suporte, hidden: true });
    expect(screen.getByText('Este canal está oculto da lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reexibir na lista' })).toBeInTheDocument();
  });
});

describe('Detalhe do canal: gerente sem integrações', () => {
  test('mostra o estado sem acesso e não faz pedido proibido (nem o QR)', () => {
    abrir(vendas, 'conexao', { agent: { role: 'manager', canManageIntegrations: false } });
    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso a este canal' })).toBeInTheDocument();
    expect(screen.getByText('Seu perfil pode ver a lista, mas não pode consultar credenciais, QR code nem configurações de integração.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar aos canais' })).toHaveAttribute('href', '/configuracoes/canais');
    expect(api.fetchChannelQrImage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /reconectar|ocultar|excluir|migrar/i })).not.toBeInTheDocument();
  });

  test('na aba Atendimento também: nada das configurações de automação é pedido', () => {
    abrir(suporte, 'atendimento', { agent: { role: 'manager', canManageIntegrations: false } });
    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso a este canal' })).toBeInTheDocument();
    expect(useTriage).not.toHaveBeenCalled();
    expect(useAiConfig).not.toHaveBeenCalled();
  });
});

describe('Detalhe do canal: excluir, ocultar e reconectar', () => {
  test('excluir espera a resposta e, concluído, volta à lista com a confirmação', async () => {
    const pedido = adiado();
    api.deleteChannel.mockReturnValue(pedido.promessa);
    abrir(suporte);
    await userEvent.click(screen.getByRole('button', { name: 'Excluir canal' }));
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Excluir canal' }));
    expect(within(confirmacao()).getByRole('button', { name: 'Excluindo…' })).toBeInTheDocument();
    await act(async () => { pedido.resolver(null); });
    expect(await screen.findByText('lista de canais Canal excluído')).toBeInTheDocument();
    expect(screen.queryByText(/canal não encontrado/i)).not.toBeInTheDocument();
  });

  test('ocultar na lista pede confirmação e chama a API de sempre', async () => {
    abrir(suporte);
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar na lista' }));
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Ocultar canal' }));
    await waitFor(() => expect(api.setChannelHidden).toHaveBeenCalledWith('c1', true, 'tok'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  test('reexibir chama setChannelHidden com false', async () => {
    abrir({ ...suporte, hidden: true });
    await userEvent.click(screen.getByRole('button', { name: 'Reexibir na lista' }));
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Reexibir canal' }));
    await waitFor(() => expect(api.setChannelHidden).toHaveBeenCalledWith('c1', false, 'tok'));
  });

  test('reconectar um canal conectado confirma; cancelar não chama nada e devolve o foco', async () => {
    abrir(suporte);
    const botao = screen.getByRole('button', { name: 'Reconectar' });
    await userEvent.click(botao);
    expect(within(confirmacao()).getByRole('heading', { name: 'Reconectar este canal?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(api.reconnectChannel).not.toHaveBeenCalled();
    expect(botao).toHaveFocus();
    await userEvent.click(botao);
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Reconectar' }));
    await waitFor(() => expect(api.reconnectChannel).toHaveBeenCalledWith('c1', 'tok'));
  });

  test('reconectar um canal desconectado não pergunta; o erro fica na área de onde saiu', async () => {
    api.reconnectChannel.mockRejectedValue({ status: 500, body: { error: 'Internal server error' } });
    abrir(loja);
    await userEvent.click(within(area('Conexão')).getByRole('button', { name: 'Reconectar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await within(area('Conexão')).findByRole('alert')).toHaveTextContent('O servidor encontrou um erro');
  });
});

describe('Detalhe do canal: migrar para Meta Cloud exige confirmação', () => {
  async function abrirMigracao() {
    await userEvent.click(screen.getByRole('button', { name: 'Migrar para Meta Cloud' }));
    return screen.findByRole('dialog', { name: 'Migrar para Meta Cloud?' });
  }
  async function preencher(d) {
    await userEvent.type(within(d).getByLabelText('Phone Number ID'), '000000000000099');
    await userEvent.type(within(d).getByLabelText('Access Token'), 'token-ficticio');
    await userEvent.type(within(d).getByLabelText('WABA ID'), '000000000000001');
  }

  test('o clique abre a confirmação, que identifica o canal e diz a consequência; nada é chamado antes', async () => {
    abrir(cobranca);
    const d = await abrirMigracao();
    expect(d).toHaveTextContent('Canal Cobrança');
    expect(d).toHaveTextContent('O número continuará sendo o mesmo, mas o provedor da conexão será alterado.');
    expect(within(d).getByLabelText('Access Token')).toHaveAttribute('type', 'password');
    expect(api.setMetaCloudCredentials).not.toHaveBeenCalled();
  });

  test('"Continuar migração" chama a API de sempre com o diálogo aberto e bloqueado', async () => {
    const pedido = adiado();
    api.setMetaCloudCredentials.mockReturnValue(pedido.promessa);
    abrir(cobranca);
    const d = await abrirMigracao();
    await preencher(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Continuar migração' }));
    expect(api.setMetaCloudCredentials).toHaveBeenCalledWith('c6', { phoneNumberId: '000000000000099', accessToken: 'token-ficticio', wabaId: '000000000000001' }, 'tok');
    // Segura o foco (aria-disabled): desativado, ele jogaria o foco no <body>.
    const migrando = within(d).getByRole('button', { name: 'Migrando…' });
    expect(migrando).toHaveAttribute('aria-disabled', 'true');
    expect(migrando).not.toBeDisabled();
    expect(migrando).toHaveFocus();
    await userEvent.click(migrando);
    expect(api.setMetaCloudCredentials).toHaveBeenCalledTimes(1);
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(within(d).getByRole('button', { name: 'Fechar' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Migrar para Meta Cloud?' })).toBeInTheDocument();
    await act(async () => { pedido.resolver({ ...cobranca, type: 'meta_cloud' }); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Migrar para Meta Cloud?' })).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  test('enviar com o foco num campo (Enter) leva o foco ao botão de envio', async () => {
    const pedido = adiado();
    api.setMetaCloudCredentials.mockReturnValue(pedido.promessa);
    abrir(cobranca);
    const d = await abrirMigracao();
    await preencher(d);
    // O Enter do navegador submete o formulário com o foco no campo (o jsdom
    // não faz a submissão implícita com o botão fora do <form>).
    fireEvent.submit(d.querySelector('#cfg-form-credenciais'));
    expect(within(d).getByRole('button', { name: 'Migrando…' })).toHaveFocus();
    await act(async () => { pedido.resolver({ ...cobranca, type: 'meta_cloud' }); });
  });

  test('falha: o motivo da Meta aparece no diálogo e os dados ficam', async () => {
    api.setMetaCloudCredentials.mockRejectedValue({ status: 400, body: { error: 'Esse Phone Number ID não pertence à WABA informada — confira os dois no painel da Meta.' } });
    abrir(cobranca);
    const d = await abrirMigracao();
    await preencher(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Continuar migração' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Esse Phone Number ID não pertence à WABA informada');
    expect(within(d).getByLabelText('Phone Number ID')).toHaveValue('000000000000099');
    expect(within(d).getByRole('button', { name: 'Continuar migração' })).toHaveFocus();
  });

  test('num Meta Cloud é "Atualizar credenciais", pelo mesmo endpoint', async () => {
    api.setMetaCloudCredentials.mockResolvedValue(comercial);
    abrir(comercial);
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar credenciais' }));
    const d = await screen.findByRole('dialog', { name: 'Atualizar credenciais da Meta' });
    await preencher(d);
    await userEvent.click(within(d).getByRole('button', { name: 'Salvar credenciais' }));
    await waitFor(() => expect(api.setMetaCloudCredentials).toHaveBeenCalledWith('c4', { phoneNumberId: '000000000000099', accessToken: 'token-ficticio', wabaId: '000000000000001' }, 'tok'));
  });
});

describe('Detalhe do canal: nome', () => {
  test('editar leva o foco ao campo; salvar envia, fecha e devolve o foco a "Editar"', async () => {
    abrir(suporte);
    await userEvent.click(within(area('Identificação')).getByRole('button', { name: 'Editar nome' }));
    const campo = screen.getByLabelText('Nome do canal');
    expect(campo).toHaveFocus();
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Canal Atendimento');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    await waitFor(() => expect(api.setChannelName).toHaveBeenCalledWith('c1', 'Canal Atendimento', 'tok'));
    await waitFor(() => expect(within(area('Identificação')).getByRole('button', { name: 'Editar nome' })).toHaveFocus());
  });

  test('falha: o editor fica aberto, o texto fica, a mensagem é em português e o foco volta ao campo', async () => {
    api.setChannelName.mockRejectedValue({ status: 400, body: { error: 'name must be 120 characters or fewer' } });
    abrir(suporte);
    await userEvent.click(within(area('Identificação')).getByRole('button', { name: 'Editar nome' }));
    const campo = screen.getByLabelText('Nome do canal');
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Nome longo demais');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    expect(await within(area('Identificação')).findByRole('alert')).toHaveTextContent('Use no máximo 120 caracteres no nome do canal.');
    expect(screen.getByLabelText('Nome do canal')).toHaveValue('Nome longo demais');
    expect(screen.getByLabelText('Nome do canal')).toHaveFocus();
    expect(area('Identificação')).not.toHaveTextContent(/characters/);
  });

  test('enquanto salva: "Salvando…", sem segundo envio', async () => {
    const pedido = adiado();
    api.setChannelName.mockReturnValue(pedido.promessa);
    abrir(suporte);
    await userEvent.click(within(area('Identificação')).getByRole('button', { name: 'Editar nome' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    const salvando = screen.getByRole('button', { name: 'Salvando…' });
    expect(salvando).toBeDisabled();
    await userEvent.click(salvando);
    expect(api.setChannelName).toHaveBeenCalledTimes(1);
    await act(async () => { pedido.resolver({}); });
  });

  test('nome vazio não salva; cancelar não chama a API', async () => {
    abrir(suporte);
    await userEvent.click(within(area('Identificação')).getByRole('button', { name: 'Editar nome' }));
    await userEvent.clear(screen.getByLabelText('Nome do canal'));
    expect(screen.getByRole('button', { name: 'Salvar nome' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.setChannelName).not.toHaveBeenCalled();
  });

  test('"Renomear" em Ações do canal abre o mesmo editor', async () => {
    abrir(suporte);
    await userEvent.click(within(area('Ações do canal')).getByRole('button', { name: 'Renomear' }));
    expect(screen.getByLabelText('Nome do canal')).toHaveFocus();
  });

  test('WABA ID do oficial: editar e salvar pelo endpoint de sempre', async () => {
    abrir(comercial);
    await userEvent.click(within(area('Identificação')).getByRole('button', { name: 'Editar WABA ID' }));
    const campo = screen.getByLabelText('Identificador da conta (WABA ID)');
    await userEvent.clear(campo);
    await userEvent.type(campo, '000000000000009');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar WABA ID' }));
    await waitFor(() => expect(api.setChannelWabaId).toHaveBeenCalledWith('c4', '000000000000009', 'tok'));
  });
});

describe('Detalhe do canal: interruptores do Atendimento', () => {
  test('envio em andamento: "Salvando…", sem duplicar, e a releitura no fim', async () => {
    const pedido = adiado();
    api.setChannelTriageEnabled.mockReturnValue(pedido.promessa);
    abrir(suporte, 'atendimento');
    const triagem = screen.getByRole('switch', { name: 'Triagem por menu' });
    expect(triagem).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(triagem);
    expect(triagem).toHaveAttribute('aria-checked', 'false');
    expect(triagem).toHaveAttribute('aria-disabled', 'true');
    expect(triagem.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Salvando…')).toBeInTheDocument();
    await userEvent.click(triagem);
    expect(api.setChannelTriageEnabled).toHaveBeenCalledTimes(1);
    await act(async () => { pedido.resolver({}); });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText('Salvando…')).not.toBeInTheDocument();
  });

  test('falha: volta ao estado anterior e o erro fica junto do interruptor', async () => {
    api.setChannelTriageEnabled.mockRejectedValue({ status: 500, body: { error: 'Internal server error' } });
    abrir(suporte, 'atendimento');
    const triagem = screen.getByRole('switch', { name: 'Triagem por menu' });
    await userEvent.click(triagem);
    const linha = triagem.closest('.cfg-interruptor');
    expect(await within(linha).findByRole('alert')).toHaveTextContent('O servidor encontrou um erro');
    expect(triagem).toHaveAttribute('aria-checked', 'true');
    expect(triagem).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('ligar a IA: primeiro a IA, depois desliga a triagem, e relê', async () => {
    abrir({ ...suporte, aiEnabled: false }, 'atendimento');
    await userEvent.click(screen.getByRole('switch', { name: 'Atendimento com IA' }));
    await waitFor(() => expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('c1', false, 'tok'));
    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('c1', true, 'tok');
    expect(api.setChannelAiEnabled.mock.invocationCallOrder[0]).toBeLessThan(api.setChannelTriageEnabled.mock.invocationCallOrder[0]);
    expect(refresh).toHaveBeenCalled();
  });

  test('sem IA, a Triagem com IA fica indisponível com o motivo', () => {
    abrir(suporte, 'atendimento');
    expect(screen.getByRole('switch', { name: 'Triagem com IA' })).toBeDisabled();
    expect(screen.getByText('Precisa de Atendimento com IA ligado')).toBeInTheDocument();
  });

  test('noturno: indisponível sem a triagem com IA, e sem a janela aponta onde defini-la', () => {
    abrir({ ...suporte, aiEnabled: true, aiTriageEnabled: true }, 'atendimento');
    expect(screen.getByRole('switch', { name: 'Atendimento noturno' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /defina a janela/i })).toHaveAttribute('href', '/configuracoes/automacao/noturno');
  });

  test('noturno já ligado continua desligável mesmo sem a janela', async () => {
    abrir({ ...suporte, aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: true }, 'atendimento');
    const noturno = screen.getByRole('switch', { name: 'Atendimento noturno' });
    expect(noturno).toBeEnabled();
    await userEvent.click(noturno);
    await waitFor(() => expect(api.setChannelAiNightModeEnabled).toHaveBeenCalledWith('c1', false, 'tok'));
  });

  test('regras relacionadas com atalhos', () => {
    abrir(suporte, 'atendimento');
    const regras = area('Regras relacionadas');
    expect(within(regras).getByRole('link', { name: 'Boas-vindas' })).toHaveAttribute('href', '/configuracoes/mensagens/boas-vindas');
    expect(within(regras).getByRole('link', { name: 'Horário de atendimento' })).toHaveAttribute('href', '/configuracoes/regras/horario');
    expect(regras).toHaveTextContent('1 opção');
  });
});

describe('Detalhe do canal: celular', () => {
  test('o mesmo fluxo de excluir no celular: confirmação bloqueada até a resposta', async () => {
    window.matchMedia = (q) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} });
    const pedido = adiado();
    api.deleteChannel.mockReturnValue(pedido.promessa);
    abrir(suporte);
    expect(screen.getByRole('link', { name: 'Números conectados' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir canal' }));
    await userEvent.click(within(confirmacao()).getByRole('button', { name: 'Excluir canal' }));
    await userEvent.keyboard('{Escape}');
    expect(within(confirmacao()).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => { pedido.resolver(null); });
    expect(await screen.findByText('lista de canais Canal excluído')).toBeInTheDocument();
  });
});
