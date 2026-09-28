import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { VARIANTE_DA_MESA } from './ConversaDaMesa';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { usePlaces } from '../hooks/useCities';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// A conversa da mesa (fatia 2 do novo atendimento): cabeçalho, faixa de
// contexto e ícones DW entram pela VARIANTE que a página passa; sem ela, a
// ConversationView é a de sempre — a do modal da Supervisão e dos Encerrados.

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSgpLookup');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');

const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', assignedAgentName: 'Atendente A', contactDisplayName: 'Cliente 101', contactPhoneNumber: '5500000000017', channelName: 'Canal Teste', channelType: 'baileys', sectorName: 'Suporte', protocolNumber: '20260101-0001' };
const NA_FILA = { id: 'c2', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Cliente 102' };
const DE_OUTRO = { id: 'c3', status: 'assigned', assignedAgentId: 'agent-9', assignedAgentName: 'Atendente B', contactDisplayName: 'Cliente 103' };

function naMesa(conversation, props = {}) {
  return render(<ConversationView conversation={conversation} onTransferClick={vi.fn()} workspace variante={VARIANTE_DA_MESA} {...props} />);
}
function noModal(conversation, props = {}) {
  return render(<ConversationView conversation={conversation} onTransferClick={vi.fn()} {...props} />);
}
// Moldura da família DW (components/icones/Icone.jsx).
const eDaFamiliaDw = (el) => {
  const svg = el && el.querySelector('svg');
  return Boolean(svg) && svg.getAttribute('stroke-width') === '1.75' && svg.getAttribute('viewBox') === '0 0 24 24';
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [{ id: 'm1', direction: 'inbound', content: 'Oi, preciso de ajuda' }], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
  useSgpLookup.mockReturnValue({ client: null, contracts: [], loading: false, error: null, search: vi.fn(), fetchDuplicate: vi.fn(), duplicateState: {} });
  useReasons.mockReturnValue({ reasons: [{ id: 'r1', name: 'Troca de senha', active: true }], loading: false, refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
});

describe('variante da mesa x modal', () => {
  test('sem a variante, o cabeçalho é o do modal: histórico e SGP em ícone, sem faixa', () => {
    const { container } = noModal(MINHA);
    expect(container.querySelector('.mesa-cab')).toBeNull();
    expect(container.querySelector('.mesa-faixa')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver atendimentos anteriores' })).toBeInTheDocument();
    expect(eDaFamiliaDw(screen.getByRole('button', { name: 'Consultar SGP' }))).toBe(false);
    expect(eDaFamiliaDw(screen.getByRole('button', { name: 'Anexar arquivo' }))).toBe(false);
  });

  test('com a variante, cabeçalho e faixa da mesa, com os ícones DW', () => {
    const { container } = naMesa(MINHA);
    expect(container.querySelector('.mesa-cab')).not.toBeNull();
    expect(container.querySelector('.mesa-faixa')).not.toBeNull();
    for (const nome of ['Consultar SGP', 'Transferir atendimento', 'Encerrar atendimento', 'Ver atendimentos anteriores', 'Dados do cliente']) {
      expect(eDaFamiliaDw(screen.getByRole('button', { name: nome })), nome).toBe(true);
    }
  });
});

describe('cabeçalho da mesa', () => {
  test('nome, estado real e canal; o nome continua abrindo a edição do contato', () => {
    naMesa(MINHA);
    const contato = screen.getByRole('button', { name: /^Editar cliente: Cliente 101/ });
    expect(within(contato).getByText('Cliente 101')).toBeInTheDocument();
    expect(within(contato).getByText('Em atendimento')).toBeInTheDocument();
    expect(within(contato).getByText('WhatsApp · Canal Teste')).toBeInTheDocument();
  });

  test('ações com texto à vista: Consultar SGP, Transferir e Encerrar', () => {
    naMesa(MINHA);
    expect(screen.getByRole('button', { name: 'Consultar SGP' })).toHaveTextContent('Consultar SGP');
    expect(screen.getByRole('button', { name: 'Transferir atendimento' })).toHaveTextContent('Transferir');
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toHaveTextContent('Encerrar');
    expect(screen.queryByRole('button', { name: 'Assumir' })).not.toBeInTheDocument();
  });

  test('conversa sem atendente: Assumir aparece e assume', async () => {
    api.claimConversation.mockResolvedValue({});
    naMesa(NA_FILA);
    const assumir = screen.getByRole('button', { name: 'Assumir' });
    expect(eDaFamiliaDw(assumir)).toBe(true);
    await userEvent.click(assumir);
    expect(api.claimConversation).toHaveBeenCalledWith('c2', 'tok-123');
  });

  test('sem permissão, sem Transferir nem Encerrar; SGP continua', () => {
    naMesa(DE_OUTRO);
    expect(screen.queryByRole('button', { name: 'Transferir atendimento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar atendimento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar SGP' })).toBeInTheDocument();
  });

  test('admin transfere e encerra conversa de outro atendente, como hoje', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-2', role: 'admin' } });
    naMesa(DE_OUTRO);
    expect(screen.getByRole('button', { name: 'Transferir atendimento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toBeInTheDocument();
  });

  test('Consultar SGP abre e fecha o painel', async () => {
    const { container } = naMesa(MINHA);
    const sgp = screen.getByRole('button', { name: 'Consultar SGP' });
    expect(sgp).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(sgp);
    expect(sgp).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('#conv-painel-sgp')).not.toBeNull();
    await userEvent.click(sgp);
    expect(container.querySelector('#conv-painel-sgp')).toBeNull();
  });

  test('Dados do cliente abre o painel do cliente', async () => {
    naMesa(MINHA);
    const dados = screen.getByRole('button', { name: 'Dados do cliente' });
    await userEvent.click(dados);
    expect(dados).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' }).parentElement).toHaveClass('conv-painel-slot', 'is-cliente');
  });

  test('voltar para a lista chama quem abriu', async () => {
    const onBack = vi.fn();
    naMesa(MINHA, { onBack });
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('faixa de contexto', () => {
  test('mostra só o que existe: setor, responsável, protocolo e telefone', () => {
    const { container } = naMesa(MINHA);
    const faixa = container.querySelector('.mesa-faixa');
    expect(within(faixa).getByText('Suporte')).toBeInTheDocument();
    expect(within(faixa).getByText('Atendente A')).toBeInTheDocument();
    expect(within(faixa).getByText('20260101-0001')).toBeInTheDocument();
    expect(within(faixa).queryByText(/plano|contrato|fatura/i)).not.toBeInTheDocument();
  });

  test('sem nenhum dado, a faixa fica só com as ações', () => {
    const { container } = naMesa(NA_FILA);
    const faixa = container.querySelector('.mesa-faixa');
    expect(faixa.querySelector('dl')).toBeNull();
    expect(within(faixa).getByRole('button', { name: 'Ver atendimentos anteriores' })).toBeInTheDocument();
  });
});

describe('timeline e avisos na mesa', () => {
  test('os tipos de mensagem continuam renderizados', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        { id: 't1', direction: 'inbound', content: 'Texto do cliente', createdAt: '2026-09-24T12:00:00.000Z' },
        { id: 'i1', direction: 'inbound', messageType: 'image', mediaPath: 'media/x.jpg', mediaMimeType: 'image/jpeg', createdAt: '2026-09-24T12:01:00.000Z' },
        { id: 'a1', direction: 'outbound', sentBy: 'ai', status: 'delivered', content: 'Resposta da IA', createdAt: '2026-09-24T12:02:00.000Z' },
        { id: 'f1', direction: 'outbound', sentBy: 'human', status: 'failed', content: 'Não chegou', metadata: { motivoFalha: '(131047) fora da janela' }, createdAt: '2026-09-24T12:03:00.000Z' },
      ],
      sendMessage: vi.fn(),
    });
    const { container } = naMesa(MINHA);
    expect(container.querySelectorAll('[data-mensagem-id]')).toHaveLength(4);
    expect(screen.getByText('Texto do cliente')).toBeInTheDocument();
    expect(screen.getByText('Resposta da IA')).toBeInTheDocument();
    expect(screen.getByText(/^Não entregue/)).toBeInTheDocument();
    // A primeira de cada grupo marca o início do grupo (canto recortado).
    expect(container.querySelector('[data-mensagem-id="t1"]')).toHaveClass('chat-grupo-inicio');
    expect(container.querySelector('[data-mensagem-id="i1"]')).not.toHaveClass('chat-grupo-inicio');
  });

  test('janela de 24h fechada continua avisada, com Enviar template', () => {
    useConversationMessages.mockReturnValue({ messages: [{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }], sendMessage: vi.fn() });
    naMesa({ ...MINHA, channelType: 'meta_cloud' });
    expect(screen.getByText(/janela de 24h fechada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar template' })).toBeInTheDocument();
  });
});

describe('compositor da mesa', () => {
  test('ícones DW, e Enviar/Gravar áudio continuam alternando', async () => {
    naMesa(MINHA);
    for (const nome of ['Anexar arquivo', 'Respostas rápidas', 'Emojis', 'Gravar áudio']) {
      expect(eDaFamiliaDw(screen.getByRole('button', { name: nome })), nome).toBe(true);
    }
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Digite uma mensagem…'), 'olá');
    expect(eDaFamiliaDw(screen.getByRole('button', { name: 'Enviar' }))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Gravar áudio' })).not.toBeInTheDocument();
  });

  test('quem não é dono não tem compositor, como hoje', () => {
    naMesa(DE_OUTRO);
    expect(screen.queryByPlaceholderText('Digite uma mensagem…')).not.toBeInTheDocument();
  });
});
