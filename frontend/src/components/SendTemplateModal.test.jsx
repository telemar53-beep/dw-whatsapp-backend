import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendTemplateModal from './SendTemplateModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const SEM_VARIAVEL = { id: 'tpl-1', name: 'aviso_tecnico', bodyText: 'Seu técnico está a caminho.', variableCount: 0, buttons: [] };
const COM_VARIAVEL = { id: 'tpl-2', name: 'confirmar_visita', bodyText: 'Olá {{1}}, podemos agendar para {{2}}?', variableCount: 2, buttons: [] };
const COM_BOTOES = { id: 'tpl-3', name: 'agendar_botao', bodyText: 'Podemos agendar?', variableCount: 0, buttons: ['Sim, pode agendar', 'Prefiro outro dia'] };

function montar(props = {}) {
  return render(<SendTemplateModal conversationId="conv-1" channelId="ch-1" onClose={vi.fn()} onSent={vi.fn()} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  api.listTemplatesForChannel.mockResolvedValue([SEM_VARIAVEL, COM_VARIAVEL, COM_BOTOES]);
  api.sendConversationTemplate.mockResolvedValue({});
});

describe('SendTemplateModal', () => {
  // Numa conversa individual só faz sentido o template de atendimento: os de
  // disparo são do SGP e da campanha.
  test('pede apenas os templates de atendimento do canal', async () => {
    montar();
    await waitFor(() => expect(api.listTemplatesForChannel).toHaveBeenCalledWith('ch-1', 'tok-123', 'atendimento'));
  });

  test('envia o template escolhido', async () => {
    const onSent = vi.fn();
    montar({ onSent });
    await userEvent.click(await screen.findByRole('button', { name: /aviso_tecnico/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(api.sendConversationTemplate).toHaveBeenCalledWith('conv-1', 'tpl-1', [], 'tok-123'));
    expect(onSent).toHaveBeenCalled();
  });

  // Template não dá para corrigir depois: o que sai chega assim ao cliente.
  test('a prévia troca as variáveis pelo que foi digitado', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /confirmar_visita/ }));
    await userEvent.type(screen.getByLabelText('Variável 1'), 'Maria');
    await userEvent.type(screen.getByLabelText('Variável 2'), 'terça');

    expect(screen.getByText('Olá Maria, podemos agendar para terça?')).toBeInTheDocument();
  });

  test('não deixa enviar com variável em branco', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /confirmar_visita/ }));

    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  test('mostra o erro devolvido pela API', async () => {
    api.sendConversationTemplate.mockRejectedValue({ body: { error: 'Template não aprovado' } });
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /aviso_tecnico/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Template não aprovado')).toBeInTheDocument();
  });

  test('avisa quando o canal não tem template de atendimento', async () => {
    api.listTemplatesForChannel.mockResolvedValue([]);
    montar();

    expect(await screen.findByText(/nenhum template de atendimento aprovado/i)).toBeInTheDocument();
  });

  // O atendente precisa saber que este template dá ao cliente um botão: é o que
  // decide se dá para continuar a conversa ou se a mensagem morre ali.
  test('a prévia mostra os botões que o cliente vai receber', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /agendar_botao/ }));

    const previa = within(screen.getByRole('group', { name: /prévia/i }));
    expect(previa.getByText('Sim, pode agendar')).toBeInTheDocument();
    expect(previa.getByText('Prefiro outro dia')).toBeInTheDocument();
  });

  test('explica que a resposta do botão reabre a conversa', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /agendar_botao/ }));

    expect(screen.getByText(/reabre/i)).toBeInTheDocument();
  });
});
