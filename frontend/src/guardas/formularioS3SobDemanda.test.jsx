import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectorsPage from '../pages/settings/team/SectorsPage';
import UsersPage from '../pages/settings/team/UsersPage';
import ReasonsPage from '../pages/settings/registers/ReasonsPage';
import CitiesPage from '../pages/settings/registers/CitiesPage';
import PlansPage from '../pages/settings/registers/PlansPage';
import TemplatesAdminTab from '../components/TemplatesAdminTab';
import SectionHelp from '../components/SectionHelp';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAiConfig } from '../hooks/useAiConfig';
import { usePlaces } from '../hooks/useCities';
import { usePlans } from '../hooks/usePlans';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import * as api from '../services/api';

// Guarda da Fatia S3 sob demanda (29/09): os sete diálogos de formulário de
// Configurações só chegam quando são abertos. Com eles fechados, as cinco
// páginas não executam o formulário, a base (DialogoDeFormulario, o campo de
// senha, a mensagem segura), a moldura clara nem a folha da base. Duas provas,
// como nas outras guardas sob demanda:
//  1. LEITURA: nenhum arquivo do app importa os formulários ou a base de forma
//     estática, e cada aba pede o seu pelo carregador aprovado
//     (utils/sobDemanda.js), sem uma segunda implementação;
//  2. EFEITO: páginas montadas não avaliam nada disso; o primeiro clique mostra
//     o "Abrindo…" enquanto o trecho chega, depois o diálogo com o foco dentro;
//     a reabertura é imediata; a resposta atrasada não abre nada depois de a
//     página sair; abrir não faz pedido à API.
//
// Os testes de efeito dependem da ordem: cada módulo é avaliado uma vez só, e a
// "porta" de um módulo segura só o primeiro carregamento dele.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
function fonteSemComentario(caminho) {
  return readFileSync(caminho, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
// O trecho antes do `from` não atravessa aspas nem ponto e vírgula: assim um
// `import './x.css';` sem `from` não engole o import da linha seguinte.
function importsEstaticos(caminho) {
  return [...fonteSemComentario(caminho).matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
function importsDinamicos(caminho) {
  return [...fonteSemComentario(caminho).matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}
function arquivosDoApp(pasta = RAIZ) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosDoApp(caminho);
    return /\.(js|jsx)$/.test(nome) && !/\.test\./.test(nome) ? [caminho] : [];
  });
}
const doApp = (caminho) => relative(RAIZ, caminho).replace(/\\/g, '/');
// Caminho do app, sem extensão de código, para comparar import com arquivo.
const alvo = (importador, origem) => doApp(resolve(dirname(importador), origem)).replace(/\.(jsx|js)$/, '');

const FORMULARIOS = ['components/CreateAgentForm', 'components/CreateSectorForm', 'components/CreateReasonForm', 'components/CityForm', 'components/PlanForm'];
const BASE = ['pages/settings/formulario/DialogoDeFormulario', 'pages/settings/formulario/CampoDeSenha', 'pages/settings/formulario/mensagemSegura', 'pages/settings/formulario/dialogo-de-formulario.css'];

const { avaliados, portoes, rastrear } = vi.hoisted(() => {
  const avaliados = new Set();
  const portoes = {};
  const rastrear = async (nome, original) => {
    avaliados.add(nome);
    if (portoes[nome]) await portoes[nome].promessa;
    return original();
  };
  return { avaliados, portoes, rastrear };
});
vi.mock('../components/CreateAgentForm', (original) => rastrear('CreateAgentForm', original));
vi.mock('../components/CreateSectorForm', (original) => rastrear('CreateSectorForm', original));
vi.mock('../components/CreateReasonForm', (original) => rastrear('CreateReasonForm', original));
vi.mock('../components/CityForm', (original) => rastrear('CityForm', original));
vi.mock('../components/PlanForm', (original) => rastrear('PlanForm', original));
vi.mock('../pages/settings/formulario/DialogoDeFormulario', (original) => rastrear('DialogoDeFormulario', original));
vi.mock('../pages/settings/formulario/CampoDeSenha', (original) => rastrear('CampoDeSenha', original));
vi.mock('../pages/settings/formulario/mensagemSegura', (original) => rastrear('mensagemSegura', original));
vi.mock('../pages/settings/formulario/dialogo-de-formulario.css', () => {
  avaliados.add('dialogo-de-formulario.css');
  return {};
});
vi.mock('../components/ui/DialogoClaro', (original) => rastrear('DialogoClaro', original));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useSectors');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useReasonsAdmin');
vi.mock('../hooks/useAiConfig');
vi.mock('../hooks/useCities');
vi.mock('../hooks/usePlans');
vi.mock('../hooks/useTemplates');
vi.mock('../hooks/useChannels');
vi.mock('../services/api');

// Dados fictícios.
const MUNICIPIO = { id: 'city-1', name: 'Cidade Exemplo', kind: 'city', parentId: null, sgpPop: null, active: true, served: true, note: '' };
const PLANO = { id: 'plan-1', name: 'Fibra 300', speedMbps: 300, monthlyPrice: 99.9, installCondition: 'Grátis', active: true, sortOrder: 1, note: '' };

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((ok, falha) => { resolver = ok; rejeitar = falha; });
  return { promessa, resolver, rejeitar };
}
const DA_FAMILIA = ['DialogoDeFormulario', 'CampoDeSenha', 'mensagemSegura', 'dialogo-de-formulario.css', 'DialogoClaro'];
const pedidosAApi = () => Object.entries(api).filter(([, f]) => vi.isMockFunction(f) && f.mock.calls.length > 0).map(([nome]) => nome);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [], status: 'ready', refresh: vi.fn() });
  useAgentsAdmin.mockReturnValue({ agents: [], status: 'ready', refresh: vi.fn() });
  useReasonsAdmin.mockReturnValue({ reasons: [], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: null }, status: 'ready', refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [MUNICIPIO], status: 'ready', refresh: vi.fn() });
  usePlans.mockReturnValue({ plans: [PLANO], status: 'ready', refresh: vi.fn() });
  useTemplates.mockReturnValue({ templates: [], status: 'ready', refresh: vi.fn() });
  useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Canal Exemplo', wabaId: '000000000000001' }], status: 'ready', refresh: vi.fn() });
});

describe('S3 sob demanda: leitura dos imports', () => {
  test('nenhum arquivo do app importa os formulários ou a base da S3 de forma estática (só eles entre si)', () => {
    const donosDaBase = new Set([...FORMULARIOS, ...BASE]);
    const violacoes = arquivosDoApp().flatMap((caminho) => {
      const importador = doApp(caminho).replace(/\.(jsx|js)$/, '');
      return importsEstaticos(caminho)
        .filter((origem) => origem.startsWith('.'))
        .map((origem) => alvo(caminho, origem))
        .filter((destino) => FORMULARIOS.includes(destino) || (BASE.includes(destino) && !donosDaBase.has(importador)))
        .map((destino) => `${importador} → ${destino}`);
    });
    expect(violacoes).toEqual([]);
  });

  test.each([
    ['components/AgentsAdminTab.jsx', './CreateAgentForm'],
    ['components/SectorsAdminTab.jsx', './CreateSectorForm'],
    ['components/ReasonsAdminTab.jsx', './CreateReasonForm'],
    ['components/CitiesAdminTab.jsx', './CityForm'],
    ['components/PlansAdminTab.jsx', './PlanForm'],
  ])('%s pede %s pelo carregador aprovado', (arquivo, modulo) => {
    const caminho = join(RAIZ, arquivo);
    expect(importsDinamicos(caminho)).toEqual([modulo]);
    const fonte = fonteSemComentario(caminho);
    const escapado = modulo.replace(/[./]/g, '\\$&');
    expect(fonte).toMatch(new RegExp(`sobDemanda\\(\\(\\) => import\\('${escapado}'\\)\\)`));
    expect(fonte).not.toMatch(/\blazy\(/);
    expect(importsEstaticos(caminho)).toContain('../utils/sobDemanda');
  });

  test('Templates e a ajuda da Triagem ficam fora da família (nem estático nem sob demanda)', () => {
    ['components/TemplatesAdminTab.jsx', 'components/SectionHelp.jsx'].forEach((arquivo) => {
      const caminho = join(RAIZ, arquivo);
      const destinos = [...importsEstaticos(caminho), ...importsDinamicos(caminho)].filter((o) => o.startsWith('.')).map((o) => alvo(caminho, o));
      expect(destinos.filter((d) => FORMULARIOS.includes(d) || BASE.includes(d) || d.startsWith('pages/settings/formulario/')), arquivo).toEqual([]);
    });
  });
});

describe('S3 sob demanda: efeito nas páginas', () => {
  test('fechadas, as cinco páginas não executam a família; Templates e a ajuda da Triagem abrem sem ela', async () => {
    for (const Pagina of [SectorsPage, UsersPage, ReasonsPage, CitiesPage, PlansPage]) {
      const { unmount } = render(<Pagina />);
      unmount();
    }
    expect([...avaliados]).toEqual([]);

    const templates = render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /Cadastrar novo template|Novo template/ }));
    expect(screen.getByRole('dialog', { name: 'Novo template' })).toBeInTheDocument();
    templates.unmount();
    const ajuda = render(<SectionHelp label="Triagem" title="Triagem">Texto de ajuda.</SectionHelp>);
    await userEvent.click(screen.getByRole('button', { name: 'O que é isso: Triagem' }));
    expect(screen.getByRole('dialog', { name: 'Triagem' })).toBeInTheDocument();
    ajuda.unmount();
    expect([...avaliados]).toEqual([]);
    expect(pedidosAApi()).toEqual([]);
  });

  test('Adicionar setor: "Abrindo…" no primeiro clique, foco no campo, Cancelar devolve o foco; reabrir é imediato', async () => {
    portoes.CreateSectorForm = adiado();
    render(<SectorsPage />);
    const abridor = screen.getByRole('button', { name: 'Adicionar setor' });
    await userEvent.click(abridor);

    // O trecho ainda não chegou: nada de diálogo, da base ou da folha.
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo o Adicionar setor…');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(avaliados.has('CreateSectorForm')).toBe(true);
    DA_FAMILIA.forEach((m) => expect(avaliados.has(m), m).toBe(false));

    await act(async () => { portoes.CreateSectorForm.resolver(); });
    const d = await screen.findByRole('dialog', { name: 'Adicionar setor' });
    expect(within(d).getByLabelText('Nome do setor')).toHaveFocus();
    expect(screen.queryByText('Abrindo o Adicionar setor…')).not.toBeInTheDocument();
    ['DialogoDeFormulario', 'dialogo-de-formulario.css', 'DialogoClaro'].forEach((m) => expect(avaliados.has(m), m).toBe(true));
    expect(avaliados.has('CampoDeSenha')).toBe(false);

    await userEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abridor).toHaveFocus();

    // Reabrir: o trecho já está em memória, o diálogo vem no mesmo clique.
    await userEvent.click(abridor);
    expect(screen.getByRole('dialog', { name: 'Adicionar setor' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abridor).toHaveFocus();
    expect(pedidosAApi()).toEqual([]);
  });

  test('Adicionar usuário: "Abrindo…", depois o diálogo com o foco no nome; só ele e o campo de senha chegam', async () => {
    portoes.CreateAgentForm = adiado();
    render(<UsersPage />);
    const abridor = screen.getByRole('button', { name: /Adicionar usuário/ });
    await userEvent.click(abridor);
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo o Adicionar usuário…');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(avaliados.has('CampoDeSenha')).toBe(false);

    await act(async () => { portoes.CreateAgentForm.resolver(); });
    const d = await screen.findByRole('dialog', { name: 'Adicionar usuário' });
    expect(within(d).getByLabelText('Nome')).toHaveFocus();
    expect(avaliados.has('CampoDeSenha')).toBe(true);
    await userEvent.click(within(d).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abridor).toHaveFocus();
    await userEvent.click(abridor);
    expect(screen.getByRole('dialog', { name: 'Adicionar usuário' })).toBeInTheDocument();
    expect(pedidosAApi()).toEqual([]);
  });

  test('Novo motivo: se o trecho não baixar, avisa na página e o clique seguinte tenta de novo', async () => {
    portoes.CreateReasonForm = adiado();
    render(<ReasonsPage />);
    const abridor = screen.getByRole('button', { name: /Novo motivo/ });
    await userEvent.click(abridor);
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo o Novo motivo…');

    await act(async () => { portoes.CreateReasonForm.rejeitar(new Error('rede fora')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir o Novo motivo. Verifique a conexão e tente de novo.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Abrindo o Novo motivo…')).not.toBeInTheDocument();

    delete portoes.CreateReasonForm;
    await userEvent.click(abridor);
    const d = await screen.findByRole('dialog', { name: 'Novo motivo' });
    expect(within(d).getByLabelText('Nome do motivo')).toHaveFocus();
    expect(screen.queryByText(/Não foi possível abrir o Novo motivo/)).not.toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    expect(abridor).toHaveFocus();
    expect(pedidosAApi()).toEqual([]);
  });

  test('Editar plano no primeiro carregamento; Novo plano reaproveita o trecho', async () => {
    portoes.PlanForm = adiado();
    render(<PlansPage />);
    const editar = screen.getByRole('button', { name: 'Editar Fibra 300' });
    await userEvent.click(editar);
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo o cadastro de plano…');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => { portoes.PlanForm.resolver(); });
    const d = await screen.findByRole('dialog', { name: 'Editar plano' });
    expect(within(d).getByLabelText('Nome')).toHaveFocus();
    expect(within(d).getByLabelText('Nome')).toHaveValue('Fibra 300');
    await userEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    expect(editar).toHaveFocus();

    const novo = screen.getByRole('button', { name: /Novo plano/ });
    await userEvent.click(novo);
    expect(screen.getByRole('dialog', { name: 'Novo plano' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(novo).toHaveFocus();
    expect(pedidosAApi()).toEqual([]);
  });

  test('Nova cidade: a resposta atrasada não abre nada depois de a página sair; Editar e Nova abrem depois', async () => {
    portoes.CityForm = adiado();
    const primeira = render(<CitiesPage />);
    await userEvent.click(screen.getByRole('button', { name: /Nova cidade/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo o cadastro de cidade…');
    primeira.unmount();

    await act(async () => {
      portoes.CityForm.resolver();
      await portoes.CityForm.promessa;
    });
    await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByText('Abrindo o cadastro de cidade…')).not.toBeInTheDocument();

    // A página de volta começa fechada; o trecho que chegou serve aos dois.
    render(<CitiesPage />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const editar = screen.getByRole('button', { name: 'Editar Cidade Exemplo' });
    await userEvent.click(editar);
    const d = await screen.findByRole('dialog', { name: 'Editar cadastro' });
    expect(within(d).getByLabelText('Nome')).toHaveFocus();
    await userEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    expect(editar).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /Nova cidade/ }));
    expect(screen.getByRole('dialog', { name: 'Nova cidade ou localidade' })).toBeInTheDocument();
    expect(pedidosAApi()).toEqual([]);
  });
});
