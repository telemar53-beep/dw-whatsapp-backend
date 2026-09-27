import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { AgentsProvider } from './AgentsContext';
import { useAgents } from '../hooks/useAgents';
import TeamPanel from '../components/TeamPanel';
import TransferModal from '../components/TransferModal';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { listAgents } from '../services/api';

// A carga dos atendentes (activeConversations) só é buscada quando alguém a
// MOSTRA: o popup "Nossa equipe" aberto ou a "Transferir atendimento". Evento de
// conversa só marca a lista como desatualizada. Antes, o botão "Equipe" do
// trilho buscava /api/agents a cada evento, com o popup fechado — e era isso
// que mantinha atual a carga da transferência (rodada técnica de 27/09).
vi.mock('./AuthContext');
vi.mock('./SocketContext');
vi.mock('../services/api');
// O hook de verdade, só espionado: cada chamada com `carga: true` é um render
// de quem mostra a carga.
vi.mock('../hooks/useAgents', async (original) => {
  const modulo = await original();
  return { ...modulo, useAgents: vi.fn(modulo.useAgents) };
});

const EVENTOS = ['conversation:assigned', 'conversation:closed', 'queue:removed', 'dashboard:conversation'];

function socketFalso() {
  const ouvintes = {};
  return {
    on: vi.fn((e, fn) => { (ouvintes[e] ||= new Set()).add(fn); }),
    off: vi.fn((e, fn) => { ouvintes[e]?.delete(fn); }),
    emit: vi.fn(),
    quantos: (e) => ouvintes[e]?.size || 0,
    disparar(e, d = { conversation: { id: 'x' } }) { ouvintes[e]?.forEach((fn) => fn(d)); },
  };
}

// Promessas controladas: o teste decide quando cada busca responde.
function pedidosControlados() {
  const fila = [];
  listAgents.mockImplementation(() => new Promise((resolve, reject) => fila.push({ resolve, reject })));
  return fila;
}

const ana = (n) => ({ id: 'a', name: 'Ana', email: 'a@exemplo.test', online: true, activeConversations: n });
const bruno = (n) => ({ id: 'b', name: 'Bruno', email: 'b@exemplo.test', online: true, activeConversations: n });

// Um consumidor "de nome" (como a Supervisão): usa a lista, não a carga.
function SoNomes() {
  const { agents } = useAgents();
  return <span data-testid="nomes">{agents.map((a) => a.name).join(',')}</span>;
}

function Casca() {
  const [transferindo, setTransferindo] = useState(false);
  return (
    <AgentsProvider>
      <SoNomes />
      <TeamPanel />
      <button type="button" onClick={() => setTransferindo(true)}>abrir transferência</button>
      <button type="button" onClick={() => setTransferindo(false)}>fechar transferência</button>
      {transferindo && <TransferModal conversationId="c1" onClose={() => setTransferindo(false)} />}
    </AgentsProvider>
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const esperar = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));
const rajada = (n, e = 'dashboard:conversation') => act(() => { for (let i = 0; i < n; i += 1) socket.disparar(e); });
const abrirEquipe = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Equipe/ })); });
const fecharEquipe = () => act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: /Nossa equipe/ })).getAllByRole('button', { name: 'Fechar' })[0]); });
const abrirTransferencia = () => act(async () => { fireEvent.click(screen.getByText('abrir transferência')); });
const fecharTransferencia = () => act(async () => { fireEvent.click(screen.getByText('fechar transferência')); });
const linhaDaTransferencia = (nome) => screen.getByRole('radio', { name: new RegExp(nome) });
const contarRendersDaTransferencia = () => vi.mocked(useAgents).mock.calls.filter(([opcoes]) => opcoes && opcoes.carga === true).length;

let socket;
let fila;
beforeEach(() => {
  vi.clearAllMocks();
  socket = socketFalso();
  useSocket.mockReturnValue(socket);
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'eu', role: 'admin' } });
  fila = pedidosControlados();
});

// A 1ª carga (a lista que o botão e a Supervisão usam) chega com Ana 1 e Bruno 5.
async function montarComListaInicial() {
  render(<Casca />);
  expect(listAgents).toHaveBeenCalledTimes(1);
  await act(async () => { fila[0].resolve([ana(1), bruno(5)]); });
  expect(screen.getByTestId('nomes')).toHaveTextContent('Ana,Bruno');
}

describe('carga dos atendentes: ninguém mostrando, ninguém busca', () => {
  test('1. popup da equipe fechado + 10 eventos = nenhuma busca', async () => {
    await montarComListaInicial();
    await rajada(10);
    await esperar(120);
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  test('2. transferência fechada + 10 eventos de todos os tipos = nenhuma busca', async () => {
    await montarComListaInicial();
    for (const e of EVENTOS) await rajada(3, e);
    await esperar(120);
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  test('14. um ouvinte só por evento, no provedor; o botão "Equipe" não assina nada', async () => {
    await montarComListaInicial();
    for (const e of EVENTOS) expect(socket.quantos(e)).toBe(1);
  });

  test('14b. abrir e fechar equipe e transferência não duplica ouvinte; sem ninguém usando a lista, não sobra nenhum', async () => {
    await montarComListaInicial();
    await abrirEquipe();
    await abrirTransferencia();
    for (const e of EVENTOS) expect(socket.quantos(e)).toBe(1);
    await fecharTransferencia();
    await fecharEquipe();
    await abrirTransferencia();
    for (const e of EVENTOS) expect(socket.quantos(e)).toBe(1);
    cleanup();
    for (const e of EVENTOS) expect(socket.quantos(e)).toBe(0);
  });
});

describe('carga dos atendentes: ao abrir quem a mostra', () => {
  test('3. abrir a equipe com a lista desatualizada = uma busca, e a carga nova aparece', async () => {
    await montarComListaInicial();
    await rajada(3);
    await abrirEquipe();
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Carregando a equipe…')).toBeInTheDocument();
    await act(async () => { fila[1].resolve([ana(4), bruno(5)]); });
    const dialogo = screen.getByRole('dialog', { name: /Nossa equipe/ });
    expect(within(dialogo).getByLabelText('4 atendimentos ativos')).toBeInTheDocument();
  });

  test('4. abrir a transferência com a lista desatualizada = uma busca, e só então a lista (com a carga nova)', async () => {
    await montarComListaInicial();
    await rajada(3);
    await abrirTransferencia();
    expect(listAgents).toHaveBeenCalledTimes(2);
    // Sem decisão com carga velha: enquanto confere, o "carregando" de sempre.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => { fila[1].resolve([ana(11), bruno(5)]); });
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('11 atendimentos');
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('Carga alta');
  });

  test('5. abrir com a lista atual = nenhuma busca e nenhum "carregando"', async () => {
    await montarComListaInicial();
    await abrirTransferencia();
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('1 atendimento');
    await abrirEquipe();
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  test('6. equipe e transferência abrindo juntas = uma requisição compartilhada', async () => {
    await montarComListaInicial();
    await rajada(2);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Equipe/ }));
      fireEvent.click(screen.getByText('abrir transferência'));
    });
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(2);
    await act(async () => { fila[1].resolve([ana(2), bruno(3)]); });
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('2 atendimentos');
    expect(within(screen.getByRole('dialog', { name: /Nossa equipe/ })).getByLabelText('2 atendimentos ativos')).toBeInTheDocument();
  });

  test('12. "Menor carga" ordena pela carga atualizada', async () => {
    await montarComListaInicial();
    await rajada(1);
    await abrirTransferencia();
    await act(async () => { fila[1].resolve([ana(7), bruno(2)]); });
    const nomes = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(nomes[0]).toMatch(/Bruno/);
    expect(nomes[1]).toMatch(/Ana/);
  });
});

describe('carga dos atendentes: enquanto alguém a mostra', () => {
  test('7. evento com a equipe aberta atualiza a carga (uma busca por rajada)', async () => {
    await montarComListaInicial();
    await abrirEquipe();
    expect(listAgents).toHaveBeenCalledTimes(1);
    await rajada(3);
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(2);
    // Enquanto confere, a lista que já estava na tela continua (sem "carregando").
    expect(screen.queryByText('Carregando a equipe…')).not.toBeInTheDocument();
    await act(async () => { fila[1].resolve([ana(6), bruno(5)]); });
    expect(within(screen.getByRole('dialog', { name: /Nossa equipe/ })).getByLabelText('6 atendimentos ativos')).toBeInTheDocument();
  });

  // Medido no navegador: com a transferência aberta, cada evento redesenhava o
  // modal só porque a lista "deixou de estar atual" — sem nada visível mudar.
  test('7b. evento com a transferência aberta não redesenha o modal antes de a carga nova chegar', async () => {
    await montarComListaInicial();
    await abrirTransferencia();
    const renders = vi.mocked(listAgents).mock.calls.length;
    const antes = contarRendersDaTransferencia();
    await rajada(3);
    expect(contarRendersDaTransferencia()).toBe(antes);
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(renders + 1);
  });

  test('8. evento com a transferência aberta atualiza a carga', async () => {
    await montarComListaInicial();
    await abrirTransferencia();
    await rajada(1);
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('1 atendimento');
    await act(async () => { fila[1].resolve([ana(9), bruno(5)]); });
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('9 atendimentos');
  });

  test('9. muitos eventos com uma busca pendente: no máximo uma busca a seguir, nunca uma por evento', async () => {
    await montarComListaInicial();
    await abrirTransferencia();
    await rajada(1);
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i += 1) { await rajada(4); await esperar(20); }
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(2);
    await act(async () => { fila[1].resolve([ana(3), bruno(5)]); });
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(3);
    await act(async () => { fila[2].resolve([ana(4), bruno(5)]); });
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(3);
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('4 atendimentos');
  });

  test('10. evento depois do início da busca: a resposta antiga não vale como atual', async () => {
    await montarComListaInicial();
    await rajada(1);
    await abrirTransferencia();
    expect(listAgents).toHaveBeenCalledTimes(2);
    // Chega um evento com a busca já em andamento.
    await rajada(1);
    await act(async () => { fila[1].resolve([ana(2), bruno(5)]); });
    await esperar(80);
    // A resposta anterior ao evento não fecha a questão: sai mais uma busca.
    expect(listAgents).toHaveBeenCalledTimes(3);
    await act(async () => { fila[2].resolve([ana(8), bruno(5)]); });
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('8 atendimentos');
    // Agora sim está atual: reabrir não busca.
    await fecharTransferencia();
    await abrirTransferencia();
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(3);
  });

  test('10b. sem ninguém mostrando, a resposta atrasada também não vale como atual', async () => {
    render(<Casca />);
    await rajada(1);
    await act(async () => { fila[0].resolve([ana(1), bruno(5)]); });
    await abrirTransferencia();
    expect(listAgents).toHaveBeenCalledTimes(2);
  });
});

describe('carga dos atendentes: falha', () => {
  test('11. a busca falha: ficam os últimos dados (nunca zero), a tela não cai e a próxima abertura tenta de novo', async () => {
    await montarComListaInicial();
    await rajada(1);
    await abrirTransferencia();
    await act(async () => { fila[1].reject(new Error('rede')); });
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('1 atendimento');
    expect(linhaDaTransferencia('Bruno')).toHaveTextContent('5 atendimentos');
    expect(screen.getByTestId('nomes')).toHaveTextContent('Ana,Bruno');
    await fecharTransferencia();
    await abrirTransferencia();
    expect(listAgents).toHaveBeenCalledTimes(3);
    await act(async () => { fila[2].resolve([ana(2), bruno(5)]); });
    expect(linhaDaTransferencia('Ana')).toHaveTextContent('2 atendimentos');
  });

  test('11b. a 1ª carga falha: abrir tenta de novo; falhando, erro (e não lista vazia) e "Tentar de novo" busca outra vez', async () => {
    render(<Casca />);
    await act(async () => { fila[0].reject(new Error('rede')); });
    await abrirEquipe();
    expect(listAgents).toHaveBeenCalledTimes(2);
    await act(async () => { fila[1].reject(new Error('rede')); });
    expect(screen.getByText('Não foi possível carregar a equipe.')).toBeInTheDocument();
    expect(screen.queryByText(/0 integrantes/)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })); });
    await esperar(80);
    expect(listAgents).toHaveBeenCalledTimes(3);
  });
});
