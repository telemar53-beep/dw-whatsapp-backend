import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PopupDaSupervisao from './PopupDaSupervisao';
import { useConversationMessages } from '../../hooks/useConversationMessages';
import { useQuickReplies } from '../../hooks/useQuickReplies';
import { useAiSuggestion } from '../../hooks/useAiSuggestion';
import { useReasons } from '../../hooks/useReasons';
import { useSgpLookup } from '../../hooks/useSgpLookup';
import { usePlaces } from '../../hooks/useCities';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaToken } from '../../contexts/MediaTokenContext';
import * as api from '../../services/api';

// O popup de conversa da Supervisão (2ª fatia). A conversa é a mesma
// ConversationView da mesa; aqui se prova a composição da Supervisão: um
// cabeçalho só, a faixa de acompanhamento, o menu de opções e o celular.
// Só dados fictícios.

vi.mock('../../hooks/useConversationMessages');
vi.mock('../../hooks/useQuickReplies');
vi.mock('../../hooks/useAiSuggestion');
vi.mock('../../hooks/useReasons');
vi.mock('../../hooks/useSgpLookup');
vi.mock('../../hooks/useCities');
vi.mock('../../contexts/AuthContext');
vi.mock('../../contexts/MediaTokenContext');
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getPublicCompany: vi.fn(() => new Promise(() => {})),
  claimConversation: vi.fn(() => Promise.resolve({})),
  closeConversation: vi.fn(() => Promise.resolve({})),
  updateContact: vi.fn(),
  listSectors: vi.fn(() => new Promise(() => {})),
  getConversationHistory: vi.fn(() => new Promise(() => {})),
}));

const EU = { id: 'admin-1', role: 'admin' };
const base = {
  id: 'c1', contactId: 'ct1', contactDisplayName: 'Cliente 101', contactPhoneNumber: '5500000000001',
  channelId: 'chan-1', channelName: 'Canal Exemplo', sectorId: 's1', sectorName: 'Suporte Técnico',
  protocolNumber: '20260927-0031', contactInternalNote: 'Nota do cliente 101',
};
const DE_OUTRO = { ...base, status: 'assigned', assignedAgentId: 'agent-2', assignedAgentName: 'Atendente A' };
const MINHA = { ...base, status: 'assigned', assignedAgentId: EU.id, assignedAgentName: 'Eu Mesmo' };
const SEM_RESPONSAVEL = { ...base, id: 'c3', status: 'waiting', assignedAgentId: null };
const ENCERRADA = { ...DE_OUTRO, id: 'c9', status: 'closed' };

let sendMessage;
beforeEach(() => {
  vi.clearAllMocks();
  sendMessage = vi.fn(() => Promise.resolve());
  useAuth.mockReturnValue({ token: 'tok-123', agent: EU });
  useMediaToken.mockReturnValue({ obterToken: () => 'media-tok', pronto: true });
  useConversationMessages.mockReturnValue({ messages: [], status: 'ready', sendMessage, appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useReasons.mockReturnValue({ reasons: [{ id: 'r1', name: 'Sem conexão', active: true }], status: 'ready', loading: false, refresh: vi.fn() });
  useSgpLookup.mockReturnValue({ client: null, contracts: [], loading: false, error: null, search: vi.fn(), fetchDuplicate: vi.fn(), duplicateState: {} });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
});

function abrir(conversa = DE_OUTRO, props = {}) {
  const onClose = vi.fn();
  const onTransferClick = vi.fn();
  const onContatoSalvo = vi.fn();
  const utils = render(
    <PopupDaSupervisao conversation={conversa} onClose={onClose} onTransferClick={onTransferClick} onContatoSalvo={onContatoSalvo} {...props} />,
  );
  return { ...utils, onClose, onTransferClick, onContatoSalvo };
}

const dialogo = () => screen.getByRole('dialog', { name: /^Conversa com/ });
const maisOpcoes = () => screen.getByRole('button', { name: 'Mais opções' });
async function abrirMenu(user) {
  await user.click(maisOpcoes());
  return screen.getByRole('menu', { name: 'Mais opções' });
}

// Celular: o jsdom não mede nem avalia media query. A conversa recebe a medida
// por um ResizeObserver de mentira, e o popup, a consulta de tela estreita.
function telaDeCelular(largura = 390) {
  vi.stubGlobal('innerWidth', largura);
  vi.stubGlobal('ResizeObserver', class {
    constructor(aoMedir) { this.aoMedir = aoMedir; }
    observe() { this.aoMedir([{ contentRect: { width: largura } }]); }
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', (consulta) => ({
    matches: /max-width/.test(consulta),
    media: consulta,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('popup da Supervisão no desktop', () => {
  test('abre como diálogo com o nome do cliente e fecha pelo "Fechar"', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    expect(dialogo()).toHaveAccessibleName('Conversa com Cliente 101');
    expect(within(dialogo()).getByRole('heading', { level: 2, name: 'Cliente 101' })).toBeInTheDocument();
    // Um controle de saída só: nada de seta de voltar no desktop, e nada do
    // "×" da base do diálogo.
    expect(screen.queryByRole('button', { name: 'Voltar para a lista' })).not.toBeInTheDocument();
    expect(dialogo().querySelector('[data-dialog-close]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Fechar conversa' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape fecha o popup quando nenhum painel ocupa o lugar da conversa', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('um cabeçalho só: estado, canal, setor, protocolo e responsável, sem o cabeçalho antigo da conversa', () => {
    abrir();
    const cabecalho = dialogo().querySelector('.sp-cab');
    expect(cabecalho).not.toBeNull();
    expect(dialogo().querySelectorAll('.sp-cab')).toHaveLength(1);
    expect(dialogo().querySelector('.chat-workspace-header')).toBeNull();
    // O cabeçalho do popup não é landmark de página (um <header> aqui viraria
    // um segundo "banner").
    expect(cabecalho.tagName).toBe('DIV');
    const c = within(cabecalho);
    expect(c.getByText('Em atendimento')).toBeInTheDocument();
    expect(c.getByText('WhatsApp · Canal Exemplo')).toBeInTheDocument();
    expect(c.getByText('Suporte Técnico')).toBeInTheDocument();
    expect(c.getByText('20260927-0031')).toBeInTheDocument();
    expect(c.getByText('Atendente A')).toBeInTheDocument();
    // Dados do cliente à vista, ao lado, sem fechar nem voltar: o botão que
    // os abriria no celular não aparece aqui.
    const dados = screen.getByRole('complementary', { name: 'Dados do cliente' });
    expect(within(dados).queryByRole('button', { name: /Fechar dados do cliente|Voltar à conversa/ })).not.toBeInTheDocument();
    expect(c.queryByRole('button', { name: 'Dados do cliente' })).not.toBeInTheDocument();
  });

  test('Transferir chama a transferência da página com a conversa aberta', async () => {
    const user = userEvent.setup();
    const { onTransferClick } = abrir();
    await user.click(screen.getByRole('button', { name: 'Transferir atendimento' }));
    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });

  test('Encerrar mora no menu de opções e pede confirmação antes de encerrar', async () => {
    const user = userEvent.setup();
    abrir();
    expect(screen.queryByRole('button', { name: /Encerrar/ })).not.toBeInTheDocument();
    const menu = await abrirMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Encerrar atendimento' }));
    const confirmacao = await screen.findByRole('dialog', { name: 'Encerrar atendimento' });
    expect(api.closeConversation).not.toHaveBeenCalled();
    await user.click(within(confirmacao).getByRole('radio', { name: 'Sem conexão' }));
    await user.click(within(confirmacao).getByRole('button', { name: 'Encerrar atendimento' }));
    expect(api.closeConversation).toHaveBeenCalledWith('c1', 'r1', 'tok-123');
  });

  test('cancelar a confirmação não encerra, e o foco volta ao botão do menu', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    const menu = await abrirMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Encerrar atendimento' }));
    const confirmacao = await screen.findByRole('dialog', { name: 'Encerrar atendimento' });
    await user.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Encerrar atendimento' })).not.toBeInTheDocument();
    expect(api.closeConversation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogo()).toBeInTheDocument();
    await waitFor(() => expect(maisOpcoes()).toHaveFocus());
  });

  test('o menu responde ao teclado e o Escape fecha só o menu', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    maisOpcoes().focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Mais opções' });
    expect(maisOpcoes()).toHaveAttribute('aria-expanded', 'true');
    const itens = within(menu).getAllByRole('menuitem');
    expect(itens.map((i) => i.textContent)).toEqual(['Consultar SGP', 'Encerrar atendimento']);
    expect(itens[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(itens[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(itens[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(itens[1]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(itens[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(itens[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(maisOpcoes()).toHaveAttribute('aria-expanded', 'false');
    expect(maisOpcoes()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicar fora fecha o menu sem fechar o popup', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    await abrirMenu(user);
    await user.click(within(dialogo()).getByRole('heading', { level: 2, name: 'Cliente 101' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Consultar SGP pelo menu troca os dados pelo SGP; fechar o SGP traz os dados de volta', async () => {
    const user = userEvent.setup();
    abrir();
    const menu = await abrirMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar consulta SGP' }));
    expect(screen.queryByRole('region', { name: 'Consulta SGP' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' })).toBeInTheDocument();
    await waitFor(() => expect(maisOpcoes()).toHaveFocus());
  });

  test('Histórico abre por cima do popup e o Escape fecha só ele', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    const historico = within(screen.getByRole('complementary', { name: 'Dados do cliente' })).getByRole('button', { name: 'Histórico' });
    await user.click(historico);
    expect(await screen.findByRole('dialog', { name: 'Histórico de atendimentos' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Histórico de atendimentos' })).not.toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(historico).toHaveFocus();
  });

  test('Tab e Shift+Tab ficam presos dentro do popup', async () => {
    const user = userEvent.setup();
    abrir();
    for (let i = 0; i < 30; i += 1) {
      await user.tab();
      expect(dialogo().contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 30; i += 1) {
      await user.tab({ shift: true });
      expect(dialogo().contains(document.activeElement)).toBe(true);
    }
  });
});

describe('quem pode responder', () => {
  test('conversa de outro atendente: sem compositor, sem envio, e a faixa de acompanhamento', () => {
    abrir(DE_OUTRO);
    expect(screen.queryByPlaceholderText('Digite uma mensagem…')).not.toBeInTheDocument();
    ['Anexar arquivo', 'Respostas rápidas', 'Emojis', 'Gravar áudio', 'Enviar'].forEach((nome) => {
      expect(screen.queryByRole('button', { name: nome })).not.toBeInTheDocument();
    });
    const faixa = dialogo().querySelector('.sp-faixa');
    expect(faixa).toHaveTextContent('Acompanhando atendimento de Atendente A');
    // Nenhuma permissão inventada: sem "Assumir", nem desabilitado.
    expect(screen.queryByRole('button', { name: /Assumir/ })).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('conversa do próprio usuário: o compositor aprovado inteiro, e sem faixa', async () => {
    const user = userEvent.setup();
    abrir(MINHA);
    ['Anexar arquivo', 'Respostas rápidas', 'Emojis', 'Gravar áudio'].forEach((nome) => {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    });
    expect(dialogo().querySelector('.sp-faixa')).toBeNull();
    await user.type(screen.getByPlaceholderText('Digite uma mensagem…'), 'Bom dia');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage.mock.calls[0][0]).toBe('Bom dia');
  });

  test('sem responsável: a faixa oferece o "Assumir" de verdade', async () => {
    const user = userEvent.setup();
    abrir(SEM_RESPONSAVEL);
    expect(screen.queryByPlaceholderText('Digite uma mensagem…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assumir atendimento' }));
    expect(api.claimConversation).toHaveBeenCalledWith('c3', 'tok-123');
  });

  test('encerrada: sem transferir nem encerrar, e a faixa diz que acabou', async () => {
    const user = userEvent.setup();
    abrir(ENCERRADA);
    expect(screen.queryByRole('button', { name: 'Transferir atendimento' })).not.toBeInTheDocument();
    const menu = await abrirMenu(user);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Consultar SGP']);
    expect(dialogo().querySelector('.sp-faixa')).toHaveTextContent('Atendimento encerrado');
  });
});

describe('conteúdo da conversa', () => {
  test('nome longo: inteiro no title e no nome do diálogo', () => {
    const longo = 'Cliente 101 com um nome de cadastro muito longo que não cabe no cabeçalho do popup';
    abrir({ ...DE_OUTRO, contactDisplayName: longo });
    expect(dialogo()).toHaveAccessibleName(`Conversa com ${longo}`);
    expect(within(dialogo()).getByRole('heading', { level: 2, name: longo })).toHaveAttribute('title', longo);
  });

  test('imagem, áudio e documento aparecem com os controles de sempre, no tema claro', () => {
    useConversationMessages.mockReturnValue({
      status: 'ready', sendMessage, appendMessage: vi.fn(),
      messages: [
        { id: 'm1', direction: 'inbound', messageType: 'image', mediaPath: 'foto.jpg', createdAt: '2026-09-27T13:16:00' },
        { id: 'm2', direction: 'inbound', messageType: 'audio', mediaPath: 'voz.ogg', createdAt: '2026-09-27T13:17:00' },
        { id: 'm3', direction: 'outbound', messageType: 'document', mediaPath: 'doc.pdf', mediaFilename: 'contrato-exemplo.pdf', status: 'read', createdAt: '2026-09-27T13:18:00' },
      ],
    });
    abrir(MINHA);
    const d = within(dialogo());
    expect(d.getByRole('button', { name: 'Abrir imagem em tela cheia' })).toBeInTheDocument();
    expect(dialogo().querySelector('audio')).not.toBeNull();
    expect(d.getByRole('button', { name: 'Reproduzir áudio' })).toBeInTheDocument();
    expect(d.getByRole('link', { name: /contrato-exemplo\.pdf/ })).toBeInTheDocument();
    // Tema claro: a bolha é a da conversa aprovada da mesa.
    expect(dialogo().querySelector('.mesa-conversa .conv-raiz')).not.toBeNull();
  });

  test('Editar cliente salva e avisa a página com a conversa de onde saiu', async () => {
    api.updateContact.mockResolvedValue({ id: 'ct1', displayName: 'Cliente 101', cityId: null, localityId: null, internalNote: 'Nota nova' });
    const user = userEvent.setup();
    const { onContatoSalvo } = abrir();
    await user.click(within(screen.getByRole('complementary', { name: 'Dados do cliente' })).getByRole('button', { name: 'Editar cliente' }));
    const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
    const nota = within(edicao).getByLabelText('Nota interna');
    await user.clear(nota);
    await user.type(nota, 'Nota nova');
    await user.click(within(edicao).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(onContatoSalvo).toHaveBeenCalledTimes(1));
    expect(onContatoSalvo.mock.calls[0][0]).toMatchObject({ conversationId: 'c1', contactId: 'ct1' });
    expect(within(screen.getByRole('complementary', { name: 'Dados do cliente' })).getByText('Nota nova')).toBeInTheDocument();
  });
});

describe('popup da Supervisão no celular', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('só a seta de voltar: sem "Fechar", e a seta fecha o popup', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    const { onClose } = abrir();
    expect(screen.queryByRole('button', { name: 'Fechar conversa' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Transferir e Encerrar vão para o menu; Dados do cliente e Histórico ficam à vista', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    const { onTransferClick } = abrir();
    expect(screen.getByRole('button', { name: 'Dados do cliente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Histórico' })).toBeInTheDocument();
    const menu = await abrirMenu(user);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Transferir', 'Consultar SGP', 'Encerrar atendimento']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Transferir' }));
    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });

  test('Dados do cliente no lugar da conversa: o cabeçalho do popup sai e só o voltar do painel fica', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' })).toBeInTheDocument();
    expect(document.querySelector('.conv-raiz')).toHaveClass('is-painel-alternado');
    expect(screen.queryByRole('button', { name: 'Voltar para a lista' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mais opções' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
  });

  test('voltar do painel devolve a conversa e o foco ao botão que abriu', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    await user.click(screen.getByRole('button', { name: 'Voltar à conversa' }));
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para a lista' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dados do cliente' })).toHaveFocus());
  });

  test('Escape com o painel no lugar volta à conversa; o seguinte fecha o popup', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    const { onClose } = abrir();
    await user.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dados do cliente' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('SGP pelo menu segue a mesma regra, e o foco volta ao botão do menu', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    abrir();
    const menu = await abrirMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar para a lista' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Voltar à conversa' }));
    expect(screen.queryByRole('region', { name: 'Consulta SGP' })).not.toBeInTheDocument();
    await waitFor(() => expect(maisOpcoes()).toHaveFocus());
  });

  test('Histórico abre por cima e o Escape devolve o foco ao botão', async () => {
    telaDeCelular();
    const user = userEvent.setup();
    abrir();
    const historico = screen.getByRole('button', { name: 'Histórico' });
    await user.click(historico);
    expect(await screen.findByRole('dialog', { name: 'Histórico de atendimentos' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Histórico de atendimentos' })).not.toBeInTheDocument();
    expect(historico).toHaveFocus();
  });
});

// Achados da revisão de comportamento (27/09), com a prova de cada um.
describe('revisão: compositor, menu e foco dentro do popup', () => {
  afterEach(() => vi.unstubAllGlobals());

  test.each([['Emojis', '#composer-emojis'], ['Respostas rápidas', '#composer-respostas']])(
    'Escape com %s abertos fecha só o popover: o popup e o rascunho ficam',
    async (botao, popover) => {
      const user = userEvent.setup();
      const { onClose } = abrir(MINHA);
      const campo = screen.getByPlaceholderText('Digite uma mensagem…');
      await user.type(campo, 'rascunho importante');
      await user.click(screen.getByRole('button', { name: botao }));
      expect(document.querySelector(popover)).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(document.querySelector(popover)).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Digite uma mensagem…')).toHaveValue('rascunho importante');
    },
  );

  test('com o menu aberto, o foco saindo dele fecha o menu', async () => {
    const user = userEvent.setup();
    abrir();
    await abrirMenu(user);
    act(() => dialogo().focus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(maisOpcoes()).toHaveAttribute('aria-expanded', 'false');
  });

  // No Safari o toque não foca o botão: o foco iria para o diálogo e o menu
  // fecharia antes do clique chegar ao item. O mousedown no menu não tem ação
  // padrão — o mecanismo que segura o foco (o efeito só existe no navegador).
  test('tocar no menu (item ou respiro) não tira o foco dele', async () => {
    const user = userEvent.setup();
    abrir();
    const menu = await abrirMenu(user);
    expect(fireEvent.mouseDown(menu)).toBe(false);
    expect(fireEvent.mouseDown(within(menu).getAllByRole('menuitem')[1])).toBe(false);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  test('Tab dentro do menu fecha o menu e segue para o próximo controle', async () => {
    const user = userEvent.setup();
    const { onClose } = abrir();
    await abrirMenu(user);
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar conversa' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('o menu fecha quando a conversa do popup troca', async () => {
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onTransferClick: vi.fn(), onContatoSalvo: vi.fn() };
    const { rerender } = render(<PopupDaSupervisao conversation={DE_OUTRO} {...props} />);
    await abrirMenu(user);
    rerender(<PopupDaSupervisao conversation={{ ...DE_OUTRO, id: 'c2', contactId: 'ct2', contactDisplayName: 'Cliente 102' }} {...props} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('assumir pelo teclado: quando a conversa passa a ser sua, o foco fica no popup', async () => {
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onTransferClick: vi.fn(), onContatoSalvo: vi.fn() };
    const { rerender } = render(<PopupDaSupervisao conversation={SEM_RESPONSAVEL} {...props} />);
    screen.getByRole('button', { name: 'Assumir atendimento' }).focus();
    await user.keyboard('{Enter}');
    expect(api.claimConversation).toHaveBeenCalledWith('c3', 'tok-123');
    // O evento do painel chega: a conversa agora é de quem assumiu.
    rerender(<PopupDaSupervisao conversation={{ ...SEM_RESPONSAVEL, status: 'assigned', assignedAgentId: EU.id, assignedAgentName: 'Eu Mesmo' }} {...props} />);
    await waitFor(() => expect(dialogo().contains(document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(document.body);
  });

  test('desktop: abrir o SGP pelo menu é anunciado a quem usa leitor de tela', async () => {
    const user = userEvent.setup();
    abrir();
    const menu = await abrirMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    expect(screen.getByText('Consulta SGP aberta ao lado da conversa.')).toHaveAttribute('role', 'status');
  });

  test('entre 721 e 767 px (tela de celular) os painéis também ocupam o lugar da conversa', async () => {
    telaDeCelular(744);
    const user = userEvent.setup();
    abrir();
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    expect(document.querySelector('.conv-raiz')).toHaveClass('is-painel-alternado');
    expect(screen.getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
  });

  test('celular: o canal aparece sem o "WhatsApp ·" (cabe inteiro ao lado do estado)', () => {
    telaDeCelular();
    abrir();
    const cabecalho = dialogo().querySelector('.sp-cab');
    expect(within(cabecalho).getByText('Canal Exemplo')).toBeInTheDocument();
    expect(within(cabecalho).queryByText(/WhatsApp ·/)).not.toBeInTheDocument();
  });

  // O jsdom não tem caixa: a medida de "visível" vem de um getClientRects de
  // mentira, vazio para o que está escondido (cabeçalho com `hidden` e a
  // coluna da conversa quando o painel ocupa o lugar dela).
  test('celular com painel no lugar: Tab e Shift+Tab ficam nos controles visíveis', async () => {
    telaDeCelular();
    const espiao = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function () {
      return this.closest('[hidden], .conv-raiz.is-painel-alternado > div:first-child') ? [] : [{ width: 1, height: 1 }];
    });
    try {
      const user = userEvent.setup();
      abrir();
      await user.click(screen.getByRole('button', { name: 'Dados do cliente' }));
      const escondido = (el) => Boolean(el.closest('[hidden], .conv-raiz.is-painel-alternado > div:first-child'));
      const voltar = screen.getByRole('button', { name: 'Voltar à conversa' });
      voltar.focus();
      await user.tab({ shift: true });
      expect(dialogo().contains(document.activeElement)).toBe(true);
      expect(escondido(document.activeElement)).toBe(false);
      expect(document.activeElement).not.toBe(voltar);
      // Do último visível, o Tab volta ao primeiro visível (o voltar do painel).
      await user.tab();
      expect(document.activeElement).toBe(voltar);
    } finally {
      espiao.mockRestore();
    }
  });
});

describe('fronteira de render', () => {
  test('mesmas props: o popup não desenha de novo', async () => {
    const props = { conversation: DE_OUTRO, onClose: vi.fn(), onTransferClick: vi.fn(), onContatoSalvo: vi.fn() };
    const { rerender } = render(<PopupDaSupervisao {...props} />);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const antes = useQuickReplies.mock.calls.length;
    rerender(<PopupDaSupervisao {...props} />);
    expect(useQuickReplies.mock.calls.length).toBe(antes);
  });
});
