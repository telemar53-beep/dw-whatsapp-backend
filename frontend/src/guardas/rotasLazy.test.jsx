import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import * as api from '../services/api';
import { io } from 'socket.io-client';

// Guarda do code splitting por rota.
//
// O programa de desempenho tirou do carregamento inicial tudo o que é área
// autenticada: o App declara cada página com `lazy(() => import(...))` e só a
// LoginPage fica estática. Nada no build impede alguém de voltar a escrever
// `import DashboardPage from './pages/DashboardPage'` — o app continua
// funcionando igualzinho, só que quem abre a tela de login volta a baixar a
// mesa de atendimento, Configurações, Relatórios (recharts) e Supervisão.
//
// Duas provas, porque cada uma pega o que a outra não pega:
//  1. LEITURA do App.jsx: nenhuma página além da LoginPage entra por import
//     estático, e cada rota usa um componente declarado com lazy.
//  2. EFEITO: renderizar o App real em /login não avalia nenhum módulo pesado.
//     Isso pega também o import estático INDIRETO — a LoginPage ou um contexto
//     puxando a ConversationView, por exemplo —, que a leitura do App não vê.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const FONTE_APP = readFileSync(join(RAIZ, 'App.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const IMPORTS_ESTATICOS = [...FONTE_APP.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const IMPORTS_LAZY = [...FONTE_APP.matchAll(/lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g)].map((m) => m[1]);
const NOMES_LAZY = new Set([...FONTE_APP.matchAll(/const\s+(\w+)\s*=\s*lazy\(/g)].map((m) => m[1]));

// Cada fábrica abaixo só roda se o módulo for AVALIADO. Com a rota sob demanda,
// isso só acontece quando a rota renderiza; com import estático, acontece no
// instante em que este arquivo importa o App — antes de qualquer teste.
const avaliados = vi.hoisted(() => new Set());

vi.mock('../services/api');
vi.mock('socket.io-client');

vi.mock('../components/AppShell', async () => {
  avaliados.add('components/AppShell');
  const { Outlet } = await vi.importActual('react-router-dom');
  // Renderiza o Outlet para a prova positiva conseguir chegar até a página.
  return { default: () => <Outlet /> };
});
vi.mock('../pages/DashboardPage', () => {
  avaliados.add('pages/DashboardPage');
  return { default: () => <p>mesa de atendimento (falsa)</p> };
});
vi.mock('../pages/ReportsPage', () => {
  avaliados.add('pages/ReportsPage');
  return { default: () => null };
});
vi.mock('../pages/SupervisionPage', () => {
  avaliados.add('pages/SupervisionPage');
  return { default: () => null };
});
vi.mock('../pages/CampaignsPage', () => {
  avaliados.add('pages/CampaignsPage');
  return { default: () => null };
});
vi.mock('../pages/CampaignDetailPage', () => {
  avaliados.add('pages/CampaignDetailPage');
  return { default: () => null };
});
vi.mock('../pages/settings/SettingsLayout', () => {
  avaliados.add('pages/settings/SettingsLayout');
  return { default: () => null };
});
vi.mock('../components/ConversationView', () => {
  avaliados.add('components/ConversationView');
  return { default: () => null };
});
vi.mock('recharts', () => {
  avaliados.add('recharts');
  return {};
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-abc', expiresInSeconds: 1800 });
  api.listAgents.mockResolvedValue([]);
});

describe('code splitting por rota: leitura do App.jsx', () => {
  test('só a LoginPage entra por import estático; nenhuma outra página', () => {
    const paginasEstaticas = IMPORTS_ESTATICOS.filter((caminho) => /(^|\/)pages\//.test(caminho));
    expect(paginasEstaticas).toEqual(['./pages/LoginPage']);
  });

  test('a casca autenticada (AppShell) chega sob demanda, não no carregamento inicial', () => {
    expect(IMPORTS_ESTATICOS).not.toContain('./components/AppShell');
    expect(IMPORTS_LAZY).toContain('./components/AppShell');
  });

  test('todo componente passado para lazyEl(...) foi declarado com lazy', () => {
    // O lookbehind tira a própria declaração, `function lazyEl(Componente)`.
    const usadosEmRota = [...FONTE_APP.matchAll(/(?<!function\s+)lazyEl\(\s*(\w+)\s*\)/g)].map((m) => m[1]);
    expect(usadosEmRota.length).toBeGreaterThan(0);
    expect(usadosEmRota.filter((nome) => !NOMES_LAZY.has(nome))).toEqual([]);
  });

  // Piso, não igualdade: página nova sob demanda só aumenta o número. Se o
  // redesenho JUNTAR ou REMOVER páginas de propósito, este é o número a baixar.
  test('as 39 áreas continuam sob demanda (piso)', () => {
    expect(IMPORTS_LAZY.length).toBeGreaterThanOrEqual(39);
    expect(new Set(IMPORTS_LAZY).size).toBe(IMPORTS_LAZY.length);
  });
});

// A ORDEM destes dois importa: o registro de módulos vale para o arquivo todo,
// então a prova em /login precisa rodar antes da prova positiva, que carrega de
// propósito a casca e a mesa de atendimento.
describe('code splitting por rota: efeito no App real', () => {
  test('abrir /login não avalia nenhum módulo da área autenticada', async () => {
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByRole('button', { name: /entrar/i })).toBeInTheDocument();
    expect([...avaliados]).toEqual([]);
  });

  // Sem esta, o teste de cima passaria também se as armadilhas estivessem
  // desligadas (um vi.mock com caminho errado, por exemplo): ele prova que elas
  // disparam quando a rota de fato pede o trecho.
  test('prova positiva: com sessão, a rota / carrega a casca e a mesa sob demanda', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', role: 'agent' }));
    window.history.pushState({}, '', '/');

    render(<App />);

    expect(await screen.findByText('mesa de atendimento (falsa)')).toBeInTheDocument();
    await waitFor(() => expect(avaliados.has('components/AppShell')).toBe(true));
    expect(avaliados.has('pages/DashboardPage')).toBe(true);
    // E continua sem pedir o que esta rota não usa.
    expect(avaliados.has('pages/ReportsPage')).toBe(false);
    expect(avaliados.has('recharts')).toBe(false);
  });
});
