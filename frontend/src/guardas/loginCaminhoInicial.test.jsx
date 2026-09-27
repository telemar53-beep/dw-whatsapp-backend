import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import * as api from '../services/api';

// Guarda do caminho inicial do login.
//
// Quem abre /login sem sessão não precisa de socket, token de mídia nem lista
// de atendentes. Esses provedores — e o socket.io-client, 13 kB gzip — entram
// só na área autenticada, sob demanda. Nada no build impede alguém de voltar a
// importá-los no App.jsx: a tela continuaria funcionando, só mais pesada.
//
// Duas provas, como na guarda das rotas:
//  1. LEITURA: o grafo de imports ESTÁTICOS a partir do main.jsx não alcança
//     nenhum deles (pega também o import indireto, por um utilitário).
//  2. EFEITO: renderizar o App real em /login não avalia nenhum deles e não
//     abre conexão; entrar pelo formulário abre UMA conexão, já com o token.

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

const avaliados = vi.hoisted(() => new Set());
const conexao = vi.hoisted(() => ({ io: null }));

vi.mock('../services/api');
vi.mock('socket.io-client', () => {
  avaliados.add('socket.io-client');
  const io = vi.fn(() => ({ on: vi.fn(), off: vi.fn(), close: vi.fn(), active: true }));
  conexao.io = io;
  return { io, default: io };
});
vi.mock('../contexts/SocketContext', async (importOriginal) => {
  avaliados.add('contexts/SocketContext');
  return importOriginal();
});
vi.mock('../contexts/AgentsContext', async (importOriginal) => {
  avaliados.add('contexts/AgentsContext');
  return importOriginal();
});
vi.mock('../contexts/MediaTokenContext', async (importOriginal) => {
  avaliados.add('contexts/MediaTokenContext');
  return importOriginal();
});
vi.mock('../components/AppShell', async () => {
  avaliados.add('components/AppShell');
  const { Outlet, Link } = await vi.importActual('react-router-dom');
  return {
    default: () => (
      <div>
        <Link to="/relatorios">Relatórios (falso)</Link>
        <Outlet />
      </div>
    ),
  };
});

// As páginas falsas LEEM os provedores: useAgentsContext() quebra sem o
// AgentsProvider, e o texto só diz "com socket" quando o SocketProvider
// entregou a conexão.
function paginaFalsa(rotulo) {
  return async () => {
    const { useSocket } = await import('../contexts/SocketContext');
    const { useAgentsContext } = await import('../contexts/AgentsContext');
    return {
      default: () => {
        const socket = useSocket();
        useAgentsContext();
        return <p>{`${rotulo} ${socket ? 'com socket' : 'sem socket'}`}</p>;
      },
    };
  };
}
vi.mock('../pages/DashboardPage', paginaFalsa('mesa'));
vi.mock('../pages/ReportsPage', paginaFalsa('relatórios'));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor Exemplo' });
  api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-ficticio', expiresInSeconds: 1800 });
  api.listAgents.mockResolvedValue([]);
});

// ---------- 1. leitura ----------

const EXTENSOES = ['', '.jsx', '.js', '/index.jsx', '/index.js'];
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function resolver(origem, especificador) {
  if (!especificador.startsWith('.')) return especificador;
  const base = resolve(dirname(origem), especificador);
  for (const ext of EXTENSOES) {
    const candidato = base + ext;
    if (existsSync(candidato) && /\.(jsx?|mjs)$/.test(candidato)) return candidato;
  }
  return null; // CSS, imagens: fora do grafo de JS
}

// Só `import ... from` e `export ... from` — o import() dinâmico é justamente
// a porta sob demanda e fica de fora.
function grafoEstatico(entrada) {
  const vistos = new Set();
  const fila = [entrada];
  while (fila.length) {
    const arquivo = fila.shift();
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    if (!arquivo.startsWith(SRC)) continue;
    const fonte = semComentarios(readFileSync(arquivo, 'utf8'));
    const especificadores = [...fonte.matchAll(/^\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const esp of especificadores) {
      const destino = resolver(arquivo, esp);
      if (destino) fila.push(destino);
    }
  }
  return [...vistos].map((caminho) => (caminho.startsWith(SRC) ? caminho.slice(SRC.length + 1).replace(/\\/g, '/').replace(/\.jsx?$/, '') : caminho));
}

describe('login sem sessão: leitura do grafo de imports estáticos', () => {
  const alcancados = grafoEstatico(join(SRC, 'main.jsx'));

  test('o grafo alcança o que o login precisa (prova de que a leitura funciona)', () => {
    expect(alcancados).toEqual(expect.arrayContaining(['App', 'pages/LoginPage', 'contexts/AuthContext', 'contexts/CompanyContext', 'services/api']));
  });

  test('não alcança socket.io-client, os provedores autenticados nem a casca', () => {
    const proibidos = ['socket.io-client', 'contexts/SocketContext', 'contexts/AgentsContext', 'contexts/MediaTokenContext', 'components/AppShell'];
    expect(alcancados.filter((modulo) => proibidos.includes(modulo))).toEqual([]);
  });
});

// ---------- 2. efeito ----------
// A ORDEM importa: o registro de módulos vale para o arquivo inteiro, então a
// prova em /login roda antes das que entram na área autenticada.

describe('login sem sessão: efeito no App real', () => {
  test('abrir /login não avalia socket.io-client nem os provedores, e não conecta', async () => {
    window.history.pushState({}, '', '/login');
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Provedor Exemplo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect([...avaliados]).toEqual([]);
    expect(conexao.io).toBeNull();
  });

  test('entrar pelo formulário abre UMA conexão, já autenticada, e a área recebe os provedores', async () => {
    api.login.mockResolvedValue({ token: 'tok-ficticio', agent: { id: 'a1', role: 'agent' } });
    window.history.pushState({}, '', '/login');
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('E-mail'), 'atendente@exemplo.test');
    await user.type(screen.getByLabelText('Senha'), 'senha-ficticia');
    expect([...avaliados]).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('mesa com socket')).toBeInTheDocument();
    expect(conexao.io).toHaveBeenCalledTimes(1);
    expect(conexao.io).toHaveBeenCalledWith(expect.any(String), { auth: { token: 'tok-ficticio' } });
    expect(avaliados).toEqual(
      new Set(['socket.io-client', 'contexts/SocketContext', 'contexts/AgentsContext', 'contexts/MediaTokenContext', 'components/AppShell'])
    );
    await waitFor(() => expect(api.fetchMediaToken).toHaveBeenCalledWith('tok-ficticio'));
  });

  test('com sessão aberta, /login leva para / e não mostra o formulário', async () => {
    localStorage.setItem('dw_token', 'tok-ficticio');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', role: 'agent' }));
    window.history.pushState({}, '', '/login');
    render(<App />);

    expect(await screen.findByText('mesa com socket')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
  });

  test('trocar entre a casca normal e a densa não reconecta o socket', async () => {
    localStorage.setItem('dw_token', 'tok-ficticio');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', role: 'agent' }));
    window.history.pushState({}, '', '/');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('mesa com socket')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Relatórios (falso)' }));
    expect(await screen.findByText('relatórios com socket')).toBeInTheDocument();

    expect(conexao.io).toHaveBeenCalledTimes(1);
    expect(conexao.io.mock.results[0].value.close).not.toHaveBeenCalled();
  });
});
