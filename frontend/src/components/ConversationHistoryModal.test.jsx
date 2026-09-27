import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import ConversationHistoryModal from './ConversationHistoryModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
// A mídia precisa de um token; aqui a URL chega pronta, como no navegador.
vi.mock('../hooks/useMediaResourceUrl', () => ({
  useMediaResourceUrl: () => ({ url: 'blob:midia', pronto: true, tentarDeNovo: () => false, urlAgora: () => 'blob:midia' }),
}));

// Dados fictícios.
const A = {
  id: 'at-a', status: 'closed', createdAt: '2026-09-21T14:30:00', updatedAt: '2026-09-21T15:10:00',
  closeReasonName: 'Sem conexão', assignedAgentName: 'Atendente C', closedByAgentName: 'Atendente C', channelName: 'Canal Exemplo',
};
const B = {
  id: 'at-b', status: 'closed', createdAt: '2026-09-17T09:10:00', updatedAt: '2026-09-17T09:40:00',
  closeReasonName: 'Segunda via', assignedAgentName: 'Atendente D', closedByAgentName: 'Atendente D', channelName: 'Canal Exemplo',
};
const mensagem = (id, direction, content, extra = {}) => ({ id, direction, content, messageType: 'text', createdAt: '2026-09-21T14:31:00', ...extra });

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

const larguraOriginal = window.innerWidth;
function naLargura(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getConversationHistory.mockReset();
  api.getMessages.mockReset();
  useAuth.mockReturnValue({ token: 'tok-123' });
});
afterEach(() => naLargura(larguraOriginal));

const abrir = (props = {}) => render(<ConversationHistoryModal contactId="contato-1" onClose={vi.fn()} {...props} />);
const lista = () => screen.getByRole('list', { name: 'Atendimentos anteriores' });
const item = (motivo) => within(lista()).getByRole('button', { name: new RegExp(motivo) });
const conversa = () => screen.getByRole('list', { name: 'Mensagens' });

describe('Histórico — lista', () => {
  test('carregando: estado visível, sem "0 atendimentos"', () => {
    api.getConversationHistory.mockReturnValue(new Promise(() => {}));
    abrir();
    expect(screen.getByRole('dialog', { name: 'Histórico de atendimentos' })).toHaveAttribute('data-dialog', 'history');
    expect(screen.getByRole('status')).toHaveTextContent('Carregando atendimentos…');
    expect(screen.queryByText(/\b0 atendimentos?\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nenhum atendimento anterior/i)).not.toBeInTheDocument();
  });

  test('vazio: diz que não há, sem contagem zero', async () => {
    api.getConversationHistory.mockResolvedValue([]);
    abrir();
    expect(await screen.findByText('Nenhum atendimento anterior encontrado.')).toBeInTheDocument();
    expect(screen.queryByText(/\b0 atendimentos?\b/)).not.toBeInTheDocument();
  });

  test('erro: aviso claro com "Tentar novamente", sem texto técnico; a nova tentativa traz a lista', async () => {
    api.getConversationHistory
      .mockRejectedValueOnce({ status: 500, body: { error: 'Internal server error' } })
      .mockResolvedValueOnce([A]);
    abrir();
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Não foi possível carregar os atendimentos.');
    expect(screen.queryByText(/Internal server error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0 atendimentos?\b/)).not.toBeInTheDocument();

    await userEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('1 atendimento anterior')).toBeInTheDocument();
    expect(api.getConversationHistory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('sem permissão: aviso próprio, sem "Tentar novamente"', async () => {
    api.getConversationHistory.mockRejectedValue({ status: 403, body: { error: 'Forbidden' } });
    abrir();
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão para ver os atendimentos anteriores deste cliente.');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  test('um item: contagem no singular', async () => {
    api.getConversationHistory.mockResolvedValue([A]);
    abrir();
    expect(await screen.findByText('1 atendimento anterior')).toBeInTheDocument();
    expect(within(lista()).getAllByRole('button')).toHaveLength(1);
  });

  test('vários itens: uma data, o motivo, atendente e canal — sem "Finalizado", sem data repetida, sem seta de texto', async () => {
    api.getConversationHistory.mockResolvedValue([A, B]);
    abrir();
    expect(await screen.findByText('2 atendimentos anteriores')).toBeInTheDocument();
    const [primeiro, segundo] = within(lista()).getAllByRole('button');
    // A ordem é a recebida (a rota já devolve do mais novo para o mais antigo).
    expect(primeiro).toHaveAccessibleName(/^21\/09\/2026 Sem conexão/);
    expect(segundo).toHaveAccessibleName(/^17\/09\/2026 Segunda via/);
    expect(primeiro).toHaveTextContent('Sem conexão');
    expect(primeiro).toHaveTextContent('14:30 · Atendente C · Canal Exemplo');
    // O bloco da data (dia e mês) e a hora: a data completa não se repete.
    expect(primeiro.textContent.match(/21\/09\/2026/g)).toHaveLength(1);
    expect(primeiro).not.toHaveTextContent(/Finalizado/);
    expect(primeiro.textContent).not.toMatch(/[›»→]/);
    expect(primeiro.textContent.match(/Atendente C/g)).toHaveLength(1);
  });

  test('até 50 itens: todos na lista, e a contagem diz que são os mais recentes', async () => {
    const cinquenta = Array.from({ length: 50 }, (_, i) => ({ ...B, id: `at-${i}`, closeReasonName: `Motivo ${i + 1}` }));
    api.getConversationHistory.mockResolvedValue(cinquenta);
    abrir();
    expect(await screen.findByText('50 atendimentos mais recentes')).toBeInTheDocument();
    expect(within(lista()).getAllByRole('button')).toHaveLength(50);
  });

  test('motivo ausente, encerrado pela IA, datas e responsáveis ausentes: nada inventado', async () => {
    api.getConversationHistory.mockResolvedValue([
      { id: 'sem-motivo', status: 'closed', createdAt: '2026-09-20T10:00:00', assignedAgentName: 'Atendente C', channelName: 'Canal Exemplo' },
      { id: 'pela-ia', status: 'closed', createdAt: '2026-09-19T11:00:00', closeReasonName: 'Resolvido pela IA', assignedAgentName: null, closedByAgentName: null, channelName: 'Canal Exemplo' },
      { id: 'sem-nada', status: 'closed', updatedAt: '2026-09-18T20:03:00' },
    ]);
    abrir();
    await screen.findByText('3 atendimentos anteriores');
    const [semMotivo, pelaIa, semNada] = within(lista()).getAllByRole('button');
    expect(semMotivo).toHaveTextContent('Sem motivo registrado');
    expect(pelaIa).toHaveTextContent('Resolvido pela IA');
    expect(pelaIa).toHaveTextContent('11:00 · Canal Exemplo');
    expect(pelaIa).not.toHaveTextContent(/Atendente|IA ·/);
    // Sem início, a data não é trocada pela última atualização.
    expect(semNada).toHaveAccessibleName(/Início não informado/);
    expect(semNada).not.toHaveTextContent(/20:03|18\/09/);
    expect(semNada).toHaveTextContent('Sem motivo registrado');
  });

  test('abrir o Histórico só pede a lista: nenhuma mensagem antes da escolha', async () => {
    api.getConversationHistory.mockResolvedValue([A, B]);
    abrir();
    await screen.findByText('2 atendimentos anteriores');
    expect(screen.getByText('Selecione um atendimento para ver a conversa.')).toBeInTheDocument();
    expect(api.getMessages).not.toHaveBeenCalled();
  });
});

describe('Histórico — detalhe no desktop', () => {
  test('mestre–detalhe: a lista continua ao lado e o item escolhido fica marcado', async () => {
    api.getConversationHistory.mockResolvedValue([A, B]);
    api.getMessages.mockResolvedValue([mensagem('m1', 'inbound', 'Boa tarde, minha internet está sem sinal')]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Sem conexão' })).toBeInTheDocument();
    expect(screen.getByText('21 set 2026, 14:30 · Atendente C · Canal Exemplo')).toBeInTheDocument();
    expect(api.getMessages).toHaveBeenCalledWith('at-a', 'tok-123', { limit: 51 });
    expect(lista()).toBeVisible();
    expect(item('Sem conexão')).toHaveAttribute('aria-current', 'true');
    expect(item('Segunda via')).not.toHaveAttribute('aria-current');
    // No desktop não há "voltar": a lista está à vista.
    expect(screen.queryByRole('button', { name: 'Atendimentos anteriores' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  test('mensagens em ordem, cliente e atendente distintos, com horário; sem compositor', async () => {
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockResolvedValue([
      mensagem('m1', 'inbound', 'Boa tarde, minha internet está sem sinal', { createdAt: '2026-09-21T14:30:00' }),
      mensagem('m2', 'outbound', 'Olá! Vou verificar o seu equipamento.', { createdAt: '2026-09-21T14:31:00' }),
      mensagem('m3', 'outbound', 'Pode reiniciar o roteador?', { createdAt: '2026-09-21T14:33:00' }),
      mensagem('m4', 'outbound', 'Resposta automática da triagem', { createdAt: '2026-09-21T14:34:00', sentBy: 'ai' }),
    ]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await screen.findByText('Boa tarde, minha internet está sem sinal');

    const bolhas = within(conversa()).getAllByRole('listitem');
    expect(bolhas.map((b) => b.querySelector('p').textContent)).toEqual([
      'Boa tarde, minha internet está sem sinal',
      'Olá! Vou verificar o seu equipamento.',
      'Pode reiniciar o roteador?',
      'Resposta automática da triagem',
    ]);
    expect(bolhas[0]).toHaveClass('is-entrada');
    expect(bolhas[1]).toHaveClass('is-saida');
    // O autor aparece no começo de cada grupo e só pela origem gravada: nenhum
    // nome de pessoa é deduzido para a mensagem.
    expect(bolhas[0]).toHaveTextContent(/^Cliente/);
    expect(bolhas[1]).toHaveTextContent(/^Atendente/);
    expect(bolhas[2]).not.toHaveTextContent(/^Atendente/);
    expect(bolhas[3]).toHaveTextContent(/^Assistente IA/);
    expect(within(bolhas[1]).getByText('14:31')).toHaveAttribute('datetime', '2026-09-21T14:31:00');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('"Encerrado por" só quando foi outra pessoa', async () => {
    api.getConversationHistory.mockResolvedValue([A, { ...B, closedByAgentName: 'Supervisor E' }]);
    api.getMessages.mockResolvedValue([]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await screen.findByRole('heading', { level: 3, name: 'Sem conexão' });
    expect(screen.queryByText(/Encerrado por/)).not.toBeInTheDocument();

    await userEvent.click(item('Segunda via'));
    await screen.findByRole('heading', { level: 3, name: 'Segunda via' });
    expect(screen.getByText('Encerrado por Supervisor E')).toBeInTheDocument();
  });

  test('trocar de atendimento limpa na hora as mensagens do anterior', async () => {
    const deB = adiado();
    api.getConversationHistory.mockResolvedValue([A, B]);
    api.getMessages.mockImplementation((id) => (id === 'at-a' ? Promise.resolve([mensagem('a1', 'inbound', 'Mensagem de A')]) : deB.promessa));
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    expect(await screen.findByText('Mensagem de A')).toBeInTheDocument();

    await userEvent.click(item('Segunda via'));
    expect(screen.queryByText('Mensagem de A')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando conversa…');

    await act(async () => deB.resolver([mensagem('b1', 'inbound', 'Mensagem de B')]));
    expect(screen.getByText('Mensagem de B')).toBeInTheDocument();
  });

  test('resposta atrasada de A não altera B', async () => {
    const deA = adiado();
    const deB = adiado();
    api.getConversationHistory.mockResolvedValue([A, B]);
    api.getMessages.mockImplementation((id) => (id === 'at-a' ? deA.promessa : deB.promessa));
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await userEvent.click(item('Segunda via'));

    await act(async () => deB.resolver([mensagem('b1', 'inbound', 'Mensagem de B')]));
    await act(async () => deA.resolver([mensagem('a1', 'inbound', 'Mensagem de A')]));

    expect(screen.getByRole('heading', { level: 3, name: 'Segunda via' })).toBeInTheDocument();
    expect(screen.getByText('Mensagem de B')).toBeInTheDocument();
    expect(screen.queryByText('Mensagem de A')).not.toBeInTheDocument();
  });

  test('fechar com as requisições no caminho: nada é atualizado depois', async () => {
    const daLista = adiado();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.getConversationHistory.mockReturnValue(daLista.promessa);
    const { unmount } = abrir();
    unmount();
    await act(async () => daLista.resolver([A]));
    expect(erro).not.toHaveBeenCalled();

    const dasMensagens = adiado();
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockReturnValue(dasMensagens.promessa);
    const segunda = abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    segunda.unmount();
    await act(async () => dasMensagens.resolver([mensagem('a1', 'inbound', 'Mensagem de A')]));
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });

  test('detalhe: carregando, erro sem texto técnico e "Tentar novamente"', async () => {
    const primeira = adiado();
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages
      .mockReturnValueOnce(primeira.promessa)
      .mockResolvedValueOnce([mensagem('a1', 'inbound', 'Mensagem de A')]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Carregando conversa…');

    await act(async () => primeira.rejeitar(new TypeError('Failed to fetch')));
    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('Não foi possível carregar a conversa.');
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();

    await userEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Mensagem de A')).toBeInTheDocument();
    expect(api.getMessages).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('atendimento sem mensagens', async () => {
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockResolvedValue([]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    expect(await screen.findByText('Nenhuma mensagem neste atendimento.')).toBeInTheDocument();
  });

  test('anexos: imagem preguiçosa, áudio e vídeo sem pré-carregar', async () => {
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockResolvedValue([
      mensagem('i1', 'inbound', null, { messageType: 'image', mediaPath: 'x/foto.jpg', mediaFilename: 'foto.jpg' }),
      mensagem('v1', 'inbound', null, { messageType: 'audio', mediaPath: 'x/voz.ogg' }),
      mensagem('f1', 'inbound', null, { messageType: 'video', mediaPath: 'x/video.mp4', mediaFilename: 'video.mp4' }),
    ]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await waitFor(() => expect(conversa().querySelector('img')).not.toBeNull());
    expect(conversa().querySelector('img')).toHaveAttribute('loading', 'lazy');
    expect(conversa().querySelector('audio')).toHaveAttribute('preload', 'none');
    expect(conversa().querySelector('video')).toHaveAttribute('preload', 'none');
  });

  test('Escape no desktop fecha o Histórico, mesmo com um atendimento aberto', async () => {
    const onClose = vi.fn();
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockResolvedValue([]);
    abrir({ onClose });
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await screen.findByRole('heading', { level: 3, name: 'Sem conexão' });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// A rota de mensagens como a real (ADR-010): sem `limit`, a conversa inteira;
// com `limit`, as `limit` mais recentes antes de `before`, em ordem cronológica.
function servidorDeMensagens(todas, { sobreposicao = false } = {}) {
  return (id, token, { limit, before } = {}) => {
    if (!limit) return Promise.resolve(todas);
    const fim = before ? todas.findIndex((m) => m.id === before) : todas.length;
    // `sobreposicao`: a página traz também a própria fronteira, repetida.
    const ate = before && sobreposicao ? fim + 1 : fim;
    return Promise.resolve(todas.slice(Math.max(0, ate - limit), ate));
  };
}
// Uma mensagem a cada 30 minutos a partir de 10/09/2026 00:10 (hora local):
// 48 por dia, e cada página de 50 atravessa um dia.
const doisDigitos = (n) => String(n).padStart(2, '0');
function aos30min(i) {
  const d = new Date(2026, 8, 10, 0, 10 + i * 30);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}T${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:00`;
}
const conversaDe = (total, prefixo = 'Mensagem', id = 'm') =>
  Array.from({ length: total }, (_, i) => mensagem(`${id}${i + 1}`, i % 2 ? 'outbound' : 'inbound', `${prefixo} ${i + 1}`, { createdAt: aos30min(i) }));
const textosDasBolhas = () => within(conversa()).getAllByRole('listitem').map((b) => b.querySelector('p').textContent);
const separadores = () => within(conversa()).queryAllByRole('separator').map((s) => s.textContent);

describe('Histórico — paginação', () => {
  const seiscentas = conversaDe(600);

  async function abrirCom(servidor) {
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockImplementation(servidor);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
  }

  test('a primeira busca pede só as 50 mais recentes e a sentinela (limit=51), nunca a conversa inteira', async () => {
    await abrirCom(servidorDeMensagens(seiscentas));
    expect(await screen.findByText('Mensagem 600')).toBeInTheDocument();
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    expect(api.getMessages).toHaveBeenCalledWith('at-a', 'tok-123', { limit: 51 });
    expect(within(conversa()).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText('Mensagem 551')).toBeInTheDocument();
    expect(screen.queryByText('Mensagem 550')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carregar mensagens anteriores' })).toBeInTheDocument();
  });

  test('a página anterior usa before (a mais antiga mostrada) e limit=51, em ordem, e mantém a rolagem', async () => {
    await abrirCom(servidorDeMensagens(seiscentas));
    await screen.findByText('Mensagem 600');
    const rolagem = conversa().closest('.hi-mensagens');
    // O jsdom não calcula layout: 40 px por linha da conversa.
    Object.defineProperty(rolagem, 'scrollHeight', { configurable: true, get: () => rolagem.querySelectorAll('li').length * 40 });
    let topo = 120;
    Object.defineProperty(rolagem, 'scrollTop', { configurable: true, get: () => topo, set: (valor) => { topo = valor; } });
    const linhasAntes = rolagem.querySelectorAll('li').length;

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByText('Mensagem 501')).toBeInTheDocument();
    expect(api.getMessages).toHaveBeenLastCalledWith('at-a', 'tok-123', { limit: 51, before: 'm551' });
    expect(textosDasBolhas()).toEqual(Array.from({ length: 100 }, (_, i) => `Mensagem ${501 + i}`));
    // O que estava à vista não sai do lugar: a rolagem anda o tanto que entrou por cima.
    expect(topo).toBe(120 + (rolagem.querySelectorAll('li').length - linhasAntes) * 40);
  });

  test('fronteira repetida entre páginas: a mensagem aparece uma vez só, e a ordem se mantém', async () => {
    await abrirCom(servidorDeMensagens(seiscentas, { sobreposicao: true }));
    await screen.findByText('Mensagem 600');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByText('Mensagem 502')).toBeInTheDocument();
    expect(screen.getAllByText('Mensagem 551')).toHaveLength(1);
    expect(textosDasBolhas()).toEqual(Array.from({ length: 99 }, (_, i) => `Mensagem ${502 + i}`));
  });

  // Pede-se uma a mais (limit=51): a mais antiga só diz se há mais para trás.
  // Múltiplo exato de 50 não deixa botão para um clique que volta vazio.
  describe('página com sentinela', () => {
    const faixa = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => `Mensagem ${de + i}`);
    const botao = () => screen.queryByRole('button', { name: 'Carregar mensagens anteriores' });

    test('49 mensagens: tudo na tela, sem botão', async () => {
      await abrirCom(servidorDeMensagens(conversaDe(49)));
      await screen.findByText('Mensagem 49');
      expect(textosDasBolhas()).toEqual(faixa(1, 49));
      expect(botao()).not.toBeInTheDocument();
      expect(api.getMessages.mock.calls.map(([, , opcoes]) => opcoes)).toEqual([{ limit: 51 }]);
    });

    test('exatamente 50: tudo na tela, sem botão e sem clique vazio', async () => {
      await abrirCom(servidorDeMensagens(conversaDe(50)));
      await screen.findByText('Mensagem 50');
      expect(textosDasBolhas()).toEqual(faixa(1, 50));
      expect(botao()).not.toBeInTheDocument();
      expect(api.getMessages.mock.calls.map(([, , opcoes]) => opcoes)).toEqual([{ limit: 51 }]);
    });

    test('51: mostra as 50 mais recentes e mantém o botão; a sentinela volta na página seguinte', async () => {
      await abrirCom(servidorDeMensagens(conversaDe(51)));
      await screen.findByText('Mensagem 51');
      expect(textosDasBolhas()).toEqual(faixa(2, 51));
      expect(screen.queryByText('Mensagem 1')).not.toBeInTheDocument();

      await userEvent.click(botao());
      expect(await screen.findByText('Mensagem 1')).toBeInTheDocument();
      expect(textosDasBolhas()).toEqual(faixa(1, 51));
      expect(botao()).not.toBeInTheDocument();
      expect(api.getMessages.mock.calls.map(([, , opcoes]) => opcoes)).toEqual([{ limit: 51 }, { limit: 51, before: 'm2' }]);
    });

    test('exatamente 100: duas páginas úteis, o botão sai depois da segunda e não há terceira requisição', async () => {
      await abrirCom(servidorDeMensagens(conversaDe(100)));
      await screen.findByText('Mensagem 100');
      expect(textosDasBolhas()).toEqual(faixa(51, 100));
      const rolagem = conversa().closest('.hi-mensagens');
      Object.defineProperty(rolagem, 'scrollHeight', { configurable: true, get: () => rolagem.querySelectorAll('li').length * 40 });
      let topo = 90;
      Object.defineProperty(rolagem, 'scrollTop', { configurable: true, get: () => topo, set: (valor) => { topo = valor; } });
      const linhasAntes = rolagem.querySelectorAll('li').length;

      await userEvent.click(botao());
      expect(await screen.findByText('Mensagem 1')).toBeInTheDocument();
      // Nenhuma perdida, nenhuma repetida, em ordem.
      expect(textosDasBolhas()).toEqual(faixa(1, 100));
      expect(botao()).not.toBeInTheDocument();
      expect(api.getMessages.mock.calls.map(([, , opcoes]) => opcoes)).toEqual([{ limit: 51 }, { limit: 51, before: 'm51' }]);
      expect(topo).toBe(90 + (rolagem.querySelectorAll('li').length - linhasAntes) * 40);
    });
  });

  test('página com menos de 50 encerra a paginação, e o foco fica na conversa', async () => {
    await abrirCom(servidorDeMensagens(conversaDe(80)));
    await screen.findByText('Mensagem 80');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByText('Mensagem 1')).toBeInTheDocument();
    expect(within(conversa()).getAllByRole('listitem')).toHaveLength(80);
    expect(screen.queryByRole('button', { name: 'Carregar mensagens anteriores' })).not.toBeInTheDocument();
    expect(conversa().closest('.hi-mensagens')).toHaveFocus();
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  test('com a página anterior no caminho, não sai uma segunda requisição', async () => {
    const pagina = adiado();
    const servidor = servidorDeMensagens(seiscentas);
    await abrirCom((id, token, opcoes) => (opcoes && opcoes.before ? pagina.promessa : servidor(id, token, opcoes)));
    await screen.findByText('Mensagem 600');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));

    const carregando = screen.getByRole('button', { name: 'Carregando mensagens anteriores…' });
    expect(carregando).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(carregando);
    await userEvent.click(carregando);
    expect(api.getMessages).toHaveBeenCalledTimes(2);

    await act(async () => pagina.resolver(seiscentas.slice(500, 550)));
    expect(within(conversa()).getAllByRole('listitem')).toHaveLength(100);
  });

  test('erro na página anterior: as mensagens ficam e dá para tentar de novo', async () => {
    let falhar = true;
    const servidor = servidorDeMensagens(seiscentas);
    await abrirCom((id, token, opcoes) => {
      if (opcoes && opcoes.before && falhar) return Promise.reject(new TypeError('Failed to fetch'));
      return servidor(id, token, opcoes);
    });
    await screen.findByText('Mensagem 600');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));

    const topo = conversa().closest('.hi-mensagens');
    expect(await within(topo).findByRole('alert')).toHaveTextContent('Não foi possível carregar as mensagens anteriores.');
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(within(conversa()).getAllByRole('listitem')).toHaveLength(50);

    falhar = false;
    await userEvent.click(within(topo).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Mensagem 501')).toBeInTheDocument();
    expect(within(conversa()).getAllByRole('listitem')).toHaveLength(100);
    expect(within(topo).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('página atrasada de A não contamina B, e B pagina normalmente', async () => {
    const deA = conversaDe(80, 'De A', 'a');
    const deB = conversaDe(80, 'De B', 'b');
    const paginaDeA = adiado();
    api.getConversationHistory.mockResolvedValue([A, B]);
    api.getMessages.mockImplementation((id, token, opcoes) => {
      if (id === 'at-a' && opcoes.before) return paginaDeA.promessa;
      return servidorDeMensagens(id === 'at-a' ? deA : deB)(id, token, opcoes);
    });
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await screen.findByText('De A 80');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));

    await userEvent.click(item('Segunda via'));
    expect(await screen.findByText('De B 80')).toBeInTheDocument();
    await act(async () => paginaDeA.resolver(deA.slice(0, 30)));
    expect(screen.queryByText(/^De A/)).not.toBeInTheDocument();
    expect(within(conversa()).getAllByRole('listitem')).toHaveLength(50);

    // A página pendente de A não trava a de B.
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByText('De B 1')).toBeInTheDocument();
    expect(api.getMessages).toHaveBeenLastCalledWith('at-b', 'tok-123', { limit: 51, before: 'b31' });
  });

  test('separadores de data: um por dia, data absoluta, e sem repetir na fronteira das páginas', async () => {
    await abrirCom(servidorDeMensagens(seiscentas));
    await screen.findByText('Mensagem 600');
    expect(separadores()).toEqual(['21 de setembro de 2026', '22 de setembro de 2026']);
    // O dia muda entre a 576 e a 577: o separador vem logo antes da 577.
    const dia22 = within(conversa()).getAllByRole('separator')[1];
    expect(dia22.nextElementSibling).toHaveTextContent('Mensagem 577');
    expect(screen.queryByText(/Hoje|Ontem/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    await screen.findByText('Mensagem 501');
    // A 550 (nova) e a 551 (antiga) são do mesmo dia 21: um separador só.
    expect(separadores()).toEqual(['20 de setembro de 2026', '21 de setembro de 2026', '22 de setembro de 2026']);
  });

  test('abre no fim e continua no fim quando uma foto termina de carregar — até o atendente rolar', async () => {
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockResolvedValue([
      mensagem('m1', 'inbound', 'Mensagem 1'),
      mensagem('i1', 'inbound', null, { messageType: 'image', mediaPath: 'x/foto.jpg', mediaFilename: 'foto.jpg' }),
    ]);
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await waitFor(() => expect(conversa().querySelector('img')).not.toBeNull());
    const rolagem = conversa().closest('.hi-mensagens');
    let altura = 400;
    let topo = 0;
    Object.defineProperty(rolagem, 'scrollHeight', { configurable: true, get: () => altura });
    Object.defineProperty(rolagem, 'scrollTop', { configurable: true, get: () => topo, set: (valor) => { topo = valor; } });

    // A foto chega e a conversa cresce: o fim continua à vista.
    altura = 700;
    conversa().querySelector('img').dispatchEvent(new Event('load'));
    expect(topo).toBe(700);

    // Depois que o atendente rola, ninguém puxa a conversa de volta.
    rolagem.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    altura = 900;
    conversa().querySelector('img').dispatchEvent(new Event('load'));
    expect(topo).toBe(700);
  });
});

describe('Histórico — celular', () => {
  beforeEach(() => naLargura(390));

  test('lista e detalhe em telas separadas; o retorno recebe o foco; sem "Fechar" no detalhe', async () => {
    api.getConversationHistory.mockResolvedValue([A, B]);
    api.getMessages.mockResolvedValue([mensagem('a1', 'inbound', 'Mensagem de A')]);
    abrir();
    await screen.findByText('2 atendimentos anteriores');
    // Na lista, nada do detalhe: nem a orientação do desktop.
    expect(screen.queryByText('Selecione um atendimento para ver a conversa.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();

    await userEvent.click(item('Sem conexão'));
    expect(await screen.findByText('Mensagem de A')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Atendimentos anteriores' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atendimentos anteriores' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    expect(screen.getByText('Somente leitura')).toBeVisible();
  });

  test('voltar mostra a lista sem fechar o Histórico e devolve o foco ao item', async () => {
    const onClose = vi.fn();
    api.getConversationHistory.mockResolvedValue([A, B]);
    api.getMessages.mockResolvedValue([]);
    abrir({ onClose });
    await screen.findByText('2 atendimentos anteriores');
    await userEvent.click(item('Segunda via'));
    await userEvent.click(await screen.findByRole('button', { name: 'Atendimentos anteriores' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(lista()).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    await waitFor(() => expect(item('Segunda via')).toHaveFocus());
  });

  test('Escape: do detalhe volta à lista; da lista fecha', async () => {
    const onClose = vi.fn();
    api.getConversationHistory.mockResolvedValue([A]);
    api.getMessages.mockResolvedValue([]);
    abrir({ onClose });
    await userEvent.click(await screen.findByRole('button', { name: /Sem conexão/ }));
    await screen.findByRole('heading', { level: 3, name: 'Sem conexão' });

    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(lista()).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Histórico — fechar', () => {
  test('"Fechar" no rodapé, sem "×" duplicado, e "Somente leitura"', async () => {
    const onClose = vi.fn();
    api.getConversationHistory.mockResolvedValue([]);
    abrir({ onClose });
    await screen.findByText('Nenhum atendimento anterior encontrado.');
    expect(screen.getAllByRole('button', { name: 'Fechar' })).toHaveLength(1);
    expect(document.querySelector('[data-dialog-close]')).toBeNull();
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// O jsdom não aplica o CSS: as regras da variante são lidas aqui, e as
// capturas medem o resultado no navegador.
describe('Histórico — CSS da variante', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'historico.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  function blocoDaMidia(consulta) {
    const inicio = css.indexOf(`@media ${consulta}`);
    if (inicio < 0) return '';
    let nivel = 0;
    for (let i = css.indexOf('{', inicio); i < css.length; i += 1) {
      if (css[i] === '{') nivel += 1;
      if (css[i] === '}') { nivel -= 1; if (nivel === 0) return css.slice(inicio, i + 1); }
    }
    return '';
  }
  const semMidias = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  const regras = (texto) => [...texto.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, seletor, corpo]) => [seletor.trim(), corpo]);
  const corpoDe = (texto, pedaco) => (regras(texto).find(([seletor]) => seletor.includes(pedaco)) || [, ''])[1];
  const px = (corpo, prop) => Number((corpo.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+)px`)) || [])[1] || 0);

  test('toda regra fica presa à variante history', () => {
    const seletores = regras(css).map(([seletor]) => seletor).filter(Boolean);
    expect(seletores.length).toBeGreaterThan(20);
    seletores.forEach((seletor) => seletor.split(/,(?![^()]*\))/).forEach((parte) => expect(parte, parte).toMatch(/data-dialog='history'/)));
  });

  test('claro, sem desfoque no diálogo nem no fundo, sem gradiente', () => {
    expect(css).not.toMatch(/gradient/);
    const desfoques = [...css.matchAll(/backdrop-filter\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(desfoques.length).toBeGreaterThan(0);
    desfoques.forEach((valor) => expect(valor).toBe('none'));
    expect(semMidias).toMatch(/--hi-papel:\s*#ffffff/);
  });

  test('desktop: lista de 340 px ao lado do detalhe', () => {
    expect(corpoDe(semMidias, '.hi-raiz.is-largo.tem-itens')).toMatch(/grid-template-columns:\s*340px minmax\(0, 1fr\)/);
  });

  test('uma frase só (vazio, erro, sem permissão): sem a largura do mestre–detalhe', () => {
    const compacto = corpoDe(semMidias, ':has(.hi-raiz.is-compacto)');
    expect(compacto).toMatch(/height:\s*auto/);
    expect(px(compacto, 'max-width')).toBeGreaterThan(0);
    expect(px(compacto, 'max-width')).toBeLessThanOrEqual(600);
  });

  test('a foto nunca passa da bolha', () => {
    expect(corpoDe(semMidias, '.hi-msg img')).toMatch(/max-width:\s*100%\s*!important/);
  });

  test('celular: alvos de 44 px e texto de 16 px onde se toca', () => {
    const celular = blocoDaMidia('(max-width: 600px)');
    expect(celular).not.toBe('');
    expect(px(corpoDe(celular, '.hi-fechar'), 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px(corpoDe(celular, '.hi-fechar'), 'font-size')).toBeGreaterThanOrEqual(16);
    for (const acao of ['.hi-aviso-acao', '.hi-anteriores-acao']) {
      expect(px(corpoDe(celular, acao), 'min-height'), acao).toBeGreaterThanOrEqual(44);
      expect(px(corpoDe(celular, acao), 'font-size'), acao).toBeGreaterThanOrEqual(16);
    }
    expect(px(corpoDe(celular, '.hi-motivo'), 'font-size')).toBeGreaterThanOrEqual(16);
    // O retorno só existe no celular e já nasce com 44 px e 16 px.
    expect(px(corpoDe(semMidias, '.hi-voltar'), 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px(corpoDe(semMidias, '.hi-voltar'), 'font-size')).toBeGreaterThanOrEqual(16);
  });

  test('hover só onde há ponteiro que paira', () => {
    expect(blocoDaMidia('(hover: hover)')).toMatch(/:hover/);
    expect(css.replace(blocoDaMidia('(hover: hover)'), '')).not.toMatch(/:hover/);
  });
});
