# Redesenho — E0: prova e guardas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o redesenho medível e à prova de regressão antes de qualquer mudança visual: harness versionado, testes que guardam os cinco ganhos publicados, testes de conteúdo da linha compacta, as 5 falhas antigas corrigidas, inventário verificado na base nova e a linha de base registrada.

**Architecture:** A E0 não muda uma linha de runtime. Ela junta a branch de ferramentas (`ferramentas/medicao/` e `ferramentas/inventario/`, fora de `frontend/`), acrescenta testes em `frontend/src/guardas/`, `frontend/src/hooks/` e `frontend/src/pages/`, corrige asserções velhas em dois arquivos de teste e registra medições. Todo teste novo foi escrito e **provado por mutação** numa cópia antes deste plano (o código abaixo é o provado, não uma transcrição).

**Tech Stack:** Vitest 1 + Testing Library + jsdom (frontend); Node 22 + Chrome por CDP (harness); Git.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (seções 10, 12 e 13; Apêndice A).

## Global Constraints

- A E0 **não muda runtime**: só testes, ferramentas e documentos. `git diff --stat` da E0 não pode tocar `frontend/src/**` fora de arquivos `*.test.*`.
- O harness mora em `ferramentas/medicao/`, **fora de `frontend/`** (dentro, o Tailwind v4 lê os arquivos e vaza classes para o CSS de produção: +23 B medidos).
- Medida de tempo (M7, M9) só com a máquina ociosa (CPU ≤ 15%, o `medir` recusa acima) e **mediana de pelo menos 3 rodadas** — regra do pacote, decisão do proprietário.
- Os cinco ganhos publicados não regridem: code splitting (39 rotas lazy), paginação de 50 + sonda, memo da lista (40 → 0/1), AgentsContext, fontes locais.
- Backend intocado (ADR-009): nenhum arquivo fora de `frontend/`, `ferramentas/` e `docs/`.
- Português nos nomes de teste, comentários e mensagens de commit, no estilo do código em volta.
- Suíte do frontend: `cd frontend && npx vitest run`. Hoje na main há **5 falhas antigas** (2 em `src/components/ConversationView.test.jsx`, 3 em `src/services/api.qr.test.js`); a Task 7 as corrige e, dali em diante, a suíte tem de ficar **verde**.

## Review Focus

- **Asserção que o redesenho vai mudar de propósito** (as marcadas [MUDA] na Task 6): não pode quebrar em silêncio nem prender a E2 — está comentada no próprio teste o que muda e para quê.
- **Ordem dentro de `rotasLazy.test.jsx`:** o teste de `/login` roda antes da prova positiva (o registro de módulos vale para o arquivo inteiro). Nunca rodar com `--sequence.shuffle`.
- **Cache frio:** na primeira execução de uma cópia nova, `PlansPage.route.test.jsx` pode estourar 5 s ("Carregando…"); nas seguintes passa em ~1 s. Se aparecer, rode de novo antes de concluir que é regressão.
- **Máquina ocupada na linha de base:** a medição de tempo recusa com CPU > 15%; não force — espere a máquina ociosa (Task 9).
- **Endereços do inventário depois da E1.1:** a E1.1 desloca linhas em `ConversationView.jsx` e `useConversationMessages.js`; o inventário só vale para a E2 depois do remapeamento e do verificador em zero (Task 8).

---

## Base

A E0 parte da **main depois da E1.1** (se o proprietário autorizar a publicação dela); sem a E1.1, parte de `e5236da`. Os testes desta E0 foram provados nas duas: na base com a E1.1 (`c950c37`), a suíte inteira deu **158 arquivos, 1612 testes, 0 falhas**.

```bash
git checkout main && git pull
git checkout -b e0/prova-e-guardas
```

### Task 1: Juntar as ferramentas (harness e verificador do inventário)

**Files:**
- Merge: branch `ferramentas/medicao-e-inventario` (commits `bb6049f`, `2b7a4dc`, `ad5a34e`, `46747c2`, `36e3ce4`, `56f4619`) — traz `ferramentas/medicao/**` (com `linha-de-base/ac334af-estrutural` e `e5236da-estrutural`) e `ferramentas/inventario/**`

**Interfaces:**
- Produces: `node ferramentas/medicao/medir.mjs --dist <build> --saida <pasta>`; `node ferramentas/medicao/diagnostico/{smoke,rolagem-anteriores,rolagem-redimensionar}.mjs` (com `MEDICAO_DIST`); `node ferramentas/inventario/verificar.cjs <apendice-A.md> <copia-da-base> <conferencias...>`.

- [ ] **Step 1: Juntar a branch**

```bash
git merge --no-ff ferramentas/medicao-e-inventario -m "E0: harness de medicao e verificador do inventario"
```

- [ ] **Step 2: Provar a trava "fora de frontend/"** (o harness copiado para dentro tem de recusar)

```bash
cp -r ferramentas/medicao frontend/_trava-teste
node frontend/_trava-teste/medir.mjs --dist /tmp/nada --sem-tempo; echo "saida=$?"
rm -rf frontend/_trava-teste
```
Expected: a mensagem "o harness esta dentro de …/frontend: o Tailwind le estes arquivos e vaza classes para o CSS de producao…" e `saida=1`. `git status` limpo depois do `rm`.

- [ ] **Step 3: Rodar o teste rápido do harness contra o build da base**

```bash
cd frontend && npx vite build --outDir /tmp/dist-base --emptyOutDir --manifest && cd ..
MEDICAO_DIST=/tmp/dist-base node ferramentas/medicao/diagnostico/smoke.mjs; echo "saida=$?"
```
Expected: `saida=0` e o texto da mesa vazia no fim da saída.

- [ ] **Step 4: Commit** — o merge do Step 1 já é o commit desta task.

### Task 2: Guarda do code splitting por rota

**Files:**
- Create: `frontend/src/guardas/rotasLazy.test.jsx`

**Interfaces:**
- Consumes: `frontend/src/App.jsx` (lê o código-fonte e monta o App real com `vi.mock` de armadilha).

O teste lê `App.jsx` (só `./pages/LoginPage` entra por import estático; `AppShell` é lazy; todo `lazyEl(X)` foi declarado com `lazy`; ≥ 39 lazy distintos) **e** prova pelo efeito: cada módulo pesado vira uma armadilha que só dispara se for carregado; com o App real em `/login` nenhuma dispara; com sessão em `/`, AppShell e DashboardPage carregam e Reports e recharts não.

- [ ] **Step 1: Escrever o teste**

```jsx
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
```

- [ ] **Step 2: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/guardas/rotasLazy.test.jsx`
Expected: 6/6 passam.

- [ ] **Step 3: Provar por mutação que ele pega a regressão** (e desfazer)

M1 — trocar o lazy da DashboardPage por import estático em `App.jsx` (`import DashboardPage from './pages/DashboardPage'`): 4 testes falham (`expected 38 to be greater than or equal to 39`, `expected [ 'DashboardPage' ] to deeply equal []`…). M2 — acrescentar `import '../components/ConversationView';` na `LoginPage.jsx`: só o teste de efeito falha (`expected [ 'components/ConversationView' ] to deeply equal []`) — é o caso que só a prova por efeito pega. Desfazer com `git checkout -- frontend/src` e rodar de novo: 6/6.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/guardas/rotasLazy.test.jsx
git commit -m "E0: guarda do code splitting por rota (codigo e efeito)"
```

### Task 3: Guarda das fontes locais

**Files:**
- Create: `frontend/src/guardas/fontesLocais.test.js`

**Interfaces:**
- Consumes: `frontend/index.html`, `frontend/src/index.css`, `frontend/src/fontes.css`, `frontend/src/main.jsx`, `frontend/src/assets/fontes/OFL-Sora.txt` e `OFL-Inter.txt`.

Protege a correção do Safari lento no login (a folha do Google bloqueava a pintura: 20,5 s). Genérico quanto à família: exige `@font-face` local para a primeira família de `--font-display` e `--font-sans`, sem exigir o nome Sora. **Muda de propósito na E2** (Inter única): os números 29 e 9 e os dois OFL.

- [ ] **Step 1: Escrever o teste**

```js
import { describe, test, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Guarda das fontes auto-hospedadas.
//
// A folha do fonts.googleapis.com era <link rel="stylesheet"> de terceiro no
// <head> e BLOQUEAVA a primeira pintura: medido na tela de login de produção,
// 20 s de atraso nesse terceiro viravam 20,7 s de tela montada e invisível.
// Sora e Inter passaram a sair deste domínio (src/fontes.css + src/assets/
// fontes). Um redesenho que "só troque a fonte" colando o <link> que o Google
// sugere desfaz isso sem quebrar nada visível — por isso a guarda.
//
// Comentários são removidos antes da busca: o index.html e o fontes.css
// EXPLICAM por que o Google saiu, e citar o nome do host não é pedir a fonte.

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = dirname(SRC);
const HOSTS_DO_GOOGLE = /fonts\.(googleapis|gstatic)\.com/;

function ler(caminho) {
  return readFileSync(caminho, 'utf8');
}

function semComentarios(texto) {
  return texto
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Só comentário de linha INTEIRA: cortar `//` no meio da linha comeria o
    // `https://` de uma URL de verdade e esconderia justamente a regressão.
    .replace(/^\s*\/\/.*$/gm, '');
}

function arquivosDeProducao(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeProducao(caminho);
    if (!/\.(js|jsx|css|html)$/.test(nome) || /\.test\.(js|jsx)$/.test(nome)) return [];
    return [caminho];
  });
}

const FONTES_CSS = semComentarios(ler(join(SRC, 'fontes.css')));
const BLOCOS = [...FONTES_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const URLS = BLOCOS.flatMap((bloco) => [...bloco.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]));

describe('fontes auto-hospedadas', () => {
  test('o index.html não carrega folha nem fonte do Google', () => {
    const html = semComentarios(ler(join(FRONTEND, 'index.html')));
    expect(html).not.toMatch(HOSTS_DO_GOOGLE);
  });

  test('o index.html não tem folha de estilo de terceiro no <head>', () => {
    const html = semComentarios(ler(join(FRONTEND, 'index.html')));
    const folhasExternas = [...html.matchAll(/<link[^>]*rel=["']?stylesheet[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /href=["']?(https?:)?\/\//i.test(tag));
    expect(folhasExternas).toEqual([]);
  });

  test('nenhum arquivo de produção em src pede fonte ao Google', () => {
    const culpados = arquivosDeProducao(SRC)
      .filter((caminho) => HOSTS_DO_GOOGLE.test(semComentarios(ler(caminho))))
      .map((caminho) => caminho.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(culpados).toEqual([]);
  });

  test('o fontes.css declara os 29 @font-face, todos com arquivo local woff2', () => {
    expect(BLOCOS).toHaveLength(29);
    expect(URLS).toHaveLength(29);
    expect(URLS.filter((url) => !/^\.\/assets\/fontes\/[\w-]+\.woff2$/.test(url))).toEqual([]);
  });

  test('todo @font-face usa font-display: swap (texto aparece antes da fonte chegar)', () => {
    expect(BLOCOS.filter((bloco) => !/font-display:\s*swap/.test(bloco))).toEqual([]);
  });

  test('os arquivos citados existem, e são exatamente os 9 woff2 da pasta', () => {
    const citados = [...new Set(URLS.map((url) => resolve(SRC, url)))];
    expect(citados.filter((caminho) => !existsSync(caminho))).toEqual([]);

    const naPasta = readdirSync(join(SRC, 'assets', 'fontes')).filter((nome) => nome.endsWith('.woff2')).sort();
    expect(naPasta).toHaveLength(9);
    expect(citados.map((caminho) => caminho.split(/[\\/]/).pop()).sort()).toEqual(naPasta);
  });

  test('a licença OFL das duas famílias acompanha os arquivos', () => {
    for (const nome of ['OFL-Sora.txt', 'OFL-Inter.txt']) {
      const caminho = join(SRC, 'assets', 'fontes', nome);
      expect(existsSync(caminho), nome).toBe(true);
      expect(ler(caminho)).toMatch(/SIL OPEN FONT LICENSE/i);
    }
  });

  // Se o redesenho TROCAR a tipografia, a regra continua: a família nova
  // precisa de @font-face local. É o que este teste cobra, e não o nome Sora.
  test('a família principal de cada token de fonte tem @font-face local', () => {
    const tokens = ler(join(SRC, 'index.css'));
    const familiasDosTokens = ['--font-display', '--font-sans'].map((token) => {
      const valor = tokens.match(new RegExp(`${token}:\\s*([^;]+);`));
      expect(valor, token).not.toBeNull();
      return valor[1].split(',')[0].trim().replace(/^["']|["']$/g, '');
    });
    const declaradas = new Set(BLOCOS.map((bloco) => bloco.match(/font-family:\s*['"]?([^'";]+)['"]?/)[1]));
    expect(familiasDosTokens.filter((familia) => !declaradas.has(familia))).toEqual([]);
  });

  // Sem este import o CSS local simplesmente não entra, e a tela cai em
  // silêncio para a fonte do sistema.
  test('o ponto de entrada importa o fontes.css', () => {
    expect(semComentarios(ler(join(SRC, 'main.jsx')))).toMatch(/import\s+['"]\.\/fontes\.css['"]/);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/guardas/fontesLocais.test.js`
Expected: 9/9 passam.

- [ ] **Step 3: Provar por mutação** (e desfazer)

M1 — link do Google + preconnect ao gstatic no `<head>` do `index.html`: 2 falham. M2 — `@import url("https://fonts.googleapis.com/...")` no `index.css`: 1 falha (`expected [ 'index.css' ] to deeply equal []`). M3 — tirar `import './fontes.css'` do `main.jsx`: 1 falha. M4 — um `@font-face` apontando para o gstatic: 3 falham. Desfazer: `git checkout -- frontend`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/guardas/fontesLocais.test.js
git commit -m "E0: guarda das fontes locais (nenhum pedido ao Google)"
```

### Task 4: Guarda do CompanyProvider (um pedido do nome da empresa por sessão)

**Files:**
- Create: `frontend/src/guardas/companyProvider.test.jsx`

Conta `getPublicCompany` na árvore real do App em três cenários (`/login`; login pelo formulário até o Atendimento; sessão já aberta em `/`) e espera **1** chamada em cada. Registro no Obsidian: um provider nunca montado já foi a produção ("import não prova montagem") — por isso a prova é pelo efeito.

- [ ] **Step 1: Escrever o teste**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import * as api from '../services/api';
import { io } from 'socket.io-client';

vi.mock('../services/api');
vi.mock('socket.io-client');

// Guarda do CompanyProvider: UMA cópia do nome da empresa por sessão.
//
// O useCompanyName, sem provider acima, cai de propósito no comportamento
// antigo — cada consumidor busca o seu (ver hooks/useCompanyName.js). O preço
// dessa queda é que um provider esquecido NÃO quebra nada: a tela funciona e
// só volta a sair uma requisição por consumidor (duas no login, com dois
// preflights; três ou quatro na mesa de atendimento).
//
// Por isso a prova é por CONTAGEM, na árvore real do App, e não por leitura do
// JSX: import não prova montagem — já foi a produção um provider importado e
// nunca montado (ver App.providers.test.jsx).

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.title = '';
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.fetchMediaToken.mockResolvedValue({ mediaToken: 'media-abc', expiresInSeconds: 1800 });
  api.getQueue.mockResolvedValue([]);
  api.getMyConversations.mockResolvedValue([]);
  api.listChannels.mockResolvedValue([]);
  api.listChannelsForAgent.mockResolvedValue([]);
  api.listAgents.mockResolvedValue([]);
  api.listSectors.mockResolvedValue([]);
});

describe('nome da empresa: uma requisição por sessão', () => {
  // Consumidores nesta tela: <TituloDaAba /> (fora do <Routes>) e a LoginPage.
  test('na tela de login, título da aba e formulário dividem a mesma busca', async () => {
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByText('Acesso restrito à equipe de atendimento da Provedor X.')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Provedor X · Atendimento'));
    expect(api.getPublicCompany).toHaveBeenCalledTimes(1);
  });

  // Consumidores somados: título da aba, LoginPage, depois SideNav e
  // DashboardPage. A sessão inteira continua com uma busca só.
  test('entrar pelo formulário e chegar ao Atendimento não busca de novo', async () => {
    api.login.mockResolvedValue({ token: 'tok-123', agent: { id: 'agent-1', email: 'a@dw.com', role: 'agent' } });
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByText('Acesso restrito à equipe de atendimento da Provedor X.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    // A tela vazia da mesa cita a empresa: prova que a DashboardPage montou e
    // já leu o nome.
    expect(await screen.findByText('Provedor X · Atendimento')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument();
    expect(api.getPublicCompany).toHaveBeenCalledTimes(1);
  });

  test('com a sessão já aberta, abrir direto no Atendimento faz uma busca só', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'agent-1', role: 'agent' }));
    window.history.pushState({}, '', '/');

    render(<App />);

    expect(await screen.findByText('Provedor X · Atendimento')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Provedor X · Atendimento'));
    expect(api.getPublicCompany).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/guardas/companyProvider.test.jsx`
Expected: 3/3 passam.

- [ ] **Step 3: Provar por mutação** (e desfazer)

M1 — tirar `<CompanyProvider>` do `App.jsx`: 3 falham, com 2, 4 e 3 chamadas em vez de 1. M2 — `enabled: true` no `useCompanyName`, ignorando o provider: 3 falham (3, 5 e 4 chamadas). Desfazer.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/guardas/companyProvider.test.jsx
git commit -m "E0: guarda do CompanyProvider (um pedido por sessao, provado pelo efeito)"
```

### Task 5: Guarda do memo da lista e da paginação com o segundo clique

**Files:**
- Create: `frontend/src/guardas/memoLista.test.jsx`
- Create: `frontend/src/hooks/useConversationMessages.anteriores.test.jsx`

O memo: aba Atendimento com 40 conversas — um evento que não muda nada dá **0** re-renders; uma conversa que muda dá exatamente **1**; o mesmo na Espera; digitar na busca dá 0. Conta pelo `ContactAvatar` trocado por um contador. **Se a E2 tirar o avatar da linha, o contador vai para outro filho.**

A paginação: servidor falso com 120 mensagens que responde a `limit` e `before` como a rota real; dois cliques trazem a conversa inteira, na ordem, e o botão some no fim. É o teste que faltou quando o "Carregar mensagens anteriores" foi publicado quebrado (BUG-006).

- [ ] **Step 1: Escrever os dois testes**

```jsx
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from '../pages/DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

// Guarda da memoização da lista de atendimentos.
//
// Medido no programa de desempenho: com 40 conversas, cada evento de socket
// re-renderizava os 40 itens, inclusive quando nada tinha mudado para eles.
// Hoje: nada muda → 0 re-renders; uma conversa muda → 1.
//
// Isso depende de TRÊS peças ao mesmo tempo, e basta perder uma para voltar
// aos 40: o memo do ConversationListItem e o useCallback de `onSelect` e de
// `onQuickClose` no DashboardPage. Nenhuma delas muda o que aparece na tela,
// então nenhum outro teste percebe. (O useMemo das listas filtradas NÃO entra
// na conta: QueueList e MyConversationsList não são memo, e o item compara
// conversa por conversa — tirá-lo não muda estes números.)
//
// O CONTADOR é o ContactAvatar: todo render do item chama o avatar uma vez (o
// stub abaixo não é memo, então não esconde nada). Se o redesenho tirar o
// avatar da linha, troque o contador por outro filho que a linha sempre monte.

const controle = vi.hoisted(() => ({
  minhasIniciais: [],
  filaInicial: [],
  definirMinhas: null,
  definirFila: null,
  renders: new Map(),
}));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready' }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');

// As duas listas viram estado de verdade, como no hook real: um evento de
// socket troca o array, e quem não mudou mantém a referência.
vi.mock('../hooks/useMyConversations', async () => {
  const { useState } = await import('react');
  return {
    useMyConversations: () => {
      const [conversations, definir] = useState(controle.minhasIniciais);
      controle.definirMinhas = definir;
      return { conversations, status: 'ready' };
    },
  };
});
vi.mock('../hooks/useQueue', async () => {
  const { useState } = await import('react');
  return {
    useQueue: () => {
      const [queue, definir] = useState(controle.filaInicial);
      controle.definirFila = definir;
      return { queue, status: 'ready' };
    },
  };
});

vi.mock('../components/ContactAvatar', () => ({
  default: ({ contactId }) => {
    controle.renders.set(contactId, (controle.renders.get(contactId) || 0) + 1);
    return null;
  },
}));

function conversas(prefixo, quantidade) {
  return Array.from({ length: quantidade }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `${prefixo}-${n}`,
      contactId: `${prefixo}-contato-${n}`,
      contactDisplayName: `Cliente ${prefixo} ${n}`,
      contactPhoneNumber: `+55989990000${n}`,
      contactCityName: 'Cândido Mendes',
      sectorName: 'Suporte',
      lastMessageContent: `mensagem ${n}`,
      lastMessageAt: '2026-09-24T12:00:00.000Z',
      createdAt: '2026-09-24T11:00:00.000Z',
      status: prefixo === 'minha' ? 'assigned' : 'waiting',
      assignedAgentId: prefixo === 'minha' ? 'agent-1' : null,
    };
  });
}

function totalDeRenders() {
  return [...controle.renders.values()].reduce((soma, n) => soma + n, 0);
}

const LARGURA_PADRAO = window.innerWidth;
function larguraDaJanela(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Janela larga: lista expandida (a variante compact), não o rail.
  larguraDaJanela(1600);
  controle.minhasIniciais = conversas('minha', 40);
  controle.filaInicial = conversas('fila', 40);
  controle.renders.clear();
  // mockReturnValue devolve o MESMO objeto a cada render: token, clearUnread e
  // o Set de não lidas ficam estáveis, como nos hooks reais.
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Net Fibra', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
});
afterEach(() => larguraDaJanela(LARGURA_PADRAO));

describe('lista de atendimentos: só re-renderiza o item que mudou', () => {
  test('aba Atendimento, 40 conversas: nada muda → 0; uma muda → 1', () => {
    renderInShell(<DashboardPage />);
    expect(screen.getByText('Cliente minha 40')).toBeInTheDocument();
    expect(controle.renders.size).toBe(40);

    // Evento que troca o array sem mudar item nenhum (o caso de todo evento
    // que diz respeito a OUTRA conversa).
    controle.renders.clear();
    act(() => controle.definirMinhas((anteriores) => [...anteriores]));
    expect(totalDeRenders()).toBe(0);

    // Uma conversa recebe mensagem nova.
    act(() =>
      controle.definirMinhas((anteriores) =>
        anteriores.map((c) => (c.id === 'minha-07' ? { ...c, lastMessageContent: 'chegou agora' } : c))
      )
    );
    expect(screen.getByText('chegou agora')).toBeInTheDocument();
    expect(Object.fromEntries(controle.renders)).toEqual({ 'minha-contato-07': 1 });
  });

  // Espera usa também `onQuickClose`: o useCallback dele só é provado aqui.
  test('aba Espera, 40 conversas: nada muda → 0; uma muda → 1', async () => {
    renderInShell(<DashboardPage />);
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.getByText('Cliente fila 40')).toBeInTheDocument();

    controle.renders.clear();
    act(() => controle.definirFila((anteriores) => [...anteriores]));
    expect(totalDeRenders()).toBe(0);

    act(() =>
      controle.definirFila((anteriores) =>
        anteriores.map((c) => (c.id === 'fila-13' ? { ...c, lastMessageContent: 'alguém aí?' } : c))
      )
    );
    expect(screen.getByText('alguém aí?')).toBeInTheDocument();
    expect(Object.fromEntries(controle.renders)).toEqual({ 'fila-contato-13': 1 });
  });

  // Estado do próprio DashboardPage (a busca) também não pode arrastar a lista.
  test('digitar na busca, com todos continuando visíveis, não re-renderiza itens', async () => {
    renderInShell(<DashboardPage />);
    controle.renders.clear();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar conversa' }), 'cli');

    expect(screen.getByText('Cliente minha 40')).toBeInTheDocument();
    expect(totalDeRenders()).toBe(0);
  });
});
```

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConversationMessages } from './useConversationMessages';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

// "Carregar mensagens anteriores" (cursor `before`), com o SEGUNDO clique.
//
// Este botão foi publicado quebrado e ficou assim até a E1 (24/09/2026, BUG-006
// no Obsidian): `carregarAnteriores` lia o cursor de dentro de um updater de
// setMessages, logo depois de outro setState. Com uma atualização já pendente na
// fibra, o React 18 não executa esse updater na hora; o cursor saía `undefined`,
// a requisição ia sem `before`, voltavam as 51 mais novas, o merge por id
// descartava tudo — e o botão ficava na tela sem trazer nada. O que faltou na
// época foi exatamente isto: um teste que clica duas vezes e confere que a
// conversa inteira chega, na ordem, e que o botão some no fim.

// Servidor falso com 120 mensagens, m001 (a mais antiga) a m120. Responde como
// a rota real: sem `before`, as `limit` mais novas; com `before`, as `limit`
// imediatamente anteriores ao id dado. Sempre em ordem crescente.
const HISTORICO = Array.from({ length: 120 }, (_, i) => ({
  id: `m${String(i + 1).padStart(3, '0')}`,
  content: `mensagem ${i + 1}`,
}));

function servidorFalso(_conversationId, _token, { limit, before } = {}) {
  const fim = before ? HISTORICO.findIndex((m) => m.id === before) : HISTORICO.length;
  return Promise.resolve(HISTORICO.slice(Math.max(0, fim - limit), fim));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue({ on: vi.fn(), off: vi.fn() });
  api.getMessages.mockImplementation(servidorFalso);
});

async function abrirConversa() {
  const hook = renderHook(() => useConversationMessages('conv-1'));
  await waitFor(() => expect(hook.result.current.messages).toHaveLength(50));
  return hook;
}

describe('useConversationMessages: carregar mensagens anteriores', () => {
  // Pré-condição, e passa hoje: é o ponto de partida dos testes abaixo.
  test('a conversa abre com as 50 mais novas e sabe que existe trecho anterior', async () => {
    const { result } = await abrirConversa();

    expect(result.current.messages[0].id).toBe('m071');
    expect(result.current.messages[49].id).toBe('m120');
    expect(result.current.temAnteriores).toBe(true);
    expect(api.getMessages).toHaveBeenCalledWith('conv-1', 'tok-123', { limit: 51 });
  });

  test('pede o trecho ANTES da mensagem mais antiga da tela (cursor before)', async () => {
    const { result } = await abrirConversa();

    await act(async () => {
      await result.current.carregarAnteriores();
    });

    expect(api.getMessages).toHaveBeenCalledTimes(2);
    expect(api.getMessages).toHaveBeenLastCalledWith('conv-1', 'tok-123', { limit: 51, before: 'm071' });
  });

  test('o trecho anterior entra antes do que já estava, até o começo da conversa', async () => {
    const { result } = await abrirConversa();

    await act(async () => {
      await result.current.carregarAnteriores();
    });
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.messages[0].id).toBe('m021');
    expect(result.current.messages[99].id).toBe('m120');
    expect(result.current.temAnteriores).toBe(true);

    await act(async () => {
      await result.current.carregarAnteriores();
    });
    expect(result.current.messages).toHaveLength(120);
    expect(result.current.messages.map((m) => m.id)).toEqual(HISTORICO.map((m) => m.id));
    // A sonda não veio: acabou o histórico, o botão some.
    expect(result.current.temAnteriores).toBe(false);
    expect(result.current.carregandoAnteriores).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/guardas/memoLista.test.jsx src/hooks/useConversationMessages.anteriores.test.jsx`
Expected: 3/3 e 3/3.

- [ ] **Step 3: Provar por mutação** (e desfazer)

Memo — M1 sem `memo` no item: 3 falham (`expected 40 to be +0`; 120 na busca). M2 `selectConversation` sem `useCallback`: 3 falham. M3 `quickCloseConversation` sem `useCallback`: só o teste da Espera falha. Paginação — trocar `frontend/src/hooks/useConversationMessages.js` pela versão de `ac334af` (`git show ac334af:frontend/src/hooks/useConversationMessages.js > frontend/src/hooks/useConversationMessages.js`): 2 falham, com `expected last "getMessages" call…` (`before` undefined) e `expected … to have a length of 100 but got 50`. Desfazer com `git checkout -- frontend/src`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/guardas/memoLista.test.jsx frontend/src/hooks/useConversationMessages.anteriores.test.jsx
git commit -m "E0: guardas do memo da lista e da paginacao com o segundo clique"
```

### Task 6: Conteúdo da linha compacta (Atendimento, Espera e Supervisão)

**Files:**
- Create: `frontend/src/pages/DashboardPage.linhaCompacta.test.jsx`
- Create: `frontend/src/pages/SupervisionPage.linhaCompacta.test.jsx`

Rodam no nível da página e leem por nome acessível, texto e role — não dependem das props internas que a E2 vai mexer. As asserções marcadas **[MUDA]** mudam de propósito na E2 (cada uma diz para quê); as **[FICA]** são o contrato: cidade, setor, estado da IA e "não lida" continuam no nome acessível da linha (Apêndice B).

- [ ] **Step 1: Escrever os dois testes**

```jsx
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from './DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

// O QUE a linha compacta da mesa de atendimento informa — a lista real das
// abas Atendimento, Espera e Automação.
//
// Escrito ANTES do redesenho da linha, para fixar a informação que ele precisa
// preservar. Tudo é lido pelo nome acessível, por texto e por role; nada por
// classe, nem pela quantidade de linhas visuais (o redesenho passa a linha
// para 2 linhas).
//
// Legenda:
//   [FICA]  o redesenho precisa manter esta asserção passando como está.
//   [MUDA]  o redesenho muda isto DE PROPÓSITO; o comentário diz para quê.

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready' }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');

const ULTIMA = '2026-09-24T15:42:00.000Z';
const CHEGADA = '2026-09-24T13:05:00.000Z';

// Mesma formatação do componente: o teste não depende do fuso da máquina.
function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const BASE = {
  contactPhoneNumber: '+5598988887777',
  contactCityName: 'Cândido Mendes',
  contactLocalityName: 'Barão de Tromaí',
  sectorName: 'Financeiro',
  lastMessageContent: 'Minha internet caiu de novo',
  lastMessageDirection: 'inbound',
  lastMessageAt: ULTIMA,
  createdAt: CHEGADA,
};

const MINHA = {
  ...BASE,
  id: 'c-minha',
  contactId: 'k-minha',
  contactDisplayName: 'Raimunda Nonata',
  status: 'assigned',
  assignedAgentId: 'agent-1',
  assignedAgentName: 'Ana Souza',
  aiTriageCompletedAt: '2026-09-24T13:06:00.000Z',
  aiTriageReasonName: 'Sem conexão',
  aiTriageLowConfidence: true,
};

const NA_ESPERA = {
  ...BASE,
  id: 'c-espera',
  contactId: 'k-espera',
  contactDisplayName: 'Joaquim Pereira',
  status: 'waiting',
  assignedAgentId: null,
  aiTriageCompletedAt: '2026-09-24T13:06:00.000Z',
  aiTriageReasonName: 'Segunda via',
  aiTriageResolvedByAi: true,
};

const EM_AUTOMACAO = {
  ...BASE,
  id: 'c-automacao',
  contactId: 'k-automacao',
  contactDisplayName: 'Francisca Lima',
  status: 'waiting',
  assignedAgentId: null,
  triageState: 'pending',
  sectorName: null,
};

const LARGURA_PADRAO = window.innerWidth;
function larguraDaJanela(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Janela larga: a lista expandida (variante compact), e não o rail.
  larguraDaJanela(1600);
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useQueue.mockReturnValue({ queue: [NA_ESPERA, EM_AUTOMACAO], status: 'ready' });
  useMyConversations.mockReturnValue({ conversations: [MINHA], status: 'ready' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c-minha', 'c-espera']), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Net Fibra', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
});
afterEach(() => larguraDaJanela(LARGURA_PADRAO));

// A linha é o elemento que abre a conversa; o <li> em volta dela é o que
// também guarda o "Finalizar sem motivo". Os dois achados por role.
function linhaDe(nome) {
  return screen.getByRole('button', { name: new RegExp(`^${nome}`) });
}
function itemDe(linha) {
  return screen.getAllByRole('listitem').filter((li) => li.contains(linha)).pop();
}

describe('linha compacta — aba Atendimento (meus atendimentos)', () => {
  test('[FICA] nome, hora da última mensagem e prévia', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(within(linha).getByText('Raimunda Nonata')).toBeInTheDocument();
    expect(within(linha).getByText(hora(ULTIMA))).toBeInTheDocument();
    expect(within(linha).queryByText(hora(CHEGADA))).not.toBeInTheDocument();
    expect(within(linha).getByText('Minha internet caiu de novo')).toBeInTheDocument();
  });

  test('[FICA] mensagem não lida é anunciada no nome da linha', () => {
    renderInShell(<DashboardPage />);
    expect(linhaDe('Raimunda Nonata')).toHaveAccessibleName(/Mensagem não lida/);
  });

  // O redesenho tira cidade e setor da VISTA nesta aba — mas quem usa leitor
  // de tela continua precisando deles para distinguir dois clientes.
  test('[FICA] localidade · município e setor continuam no nome acessível da linha', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(linha).toHaveAccessibleName(/Barão de Tromaí · Cândido Mendes/);
    expect(linha).toHaveAccessibleName(/Financeiro/);
  });

  // [MUDA] Hoje são chips visíveis. No redesenho saem da vista nesta aba: esta
  // asserção é a que sai (ou vira "não aparece como texto visível"), e a de
  // cima, do nome acessível, é a que segura a informação.
  test('[MUDA] hoje localidade · município e setor aparecem como texto na linha', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(within(linha).getByText('Barão de Tromaí · Cândido Mendes')).toBeInTheDocument();
    expect(within(linha).getByText('Financeiro')).toBeInTheDocument();
  });

  // [MUDA] Nesta aba todas as conversas são do próprio atendente: o chip com o
  // nome dele não informa nada. No redesenho vira
  // `expect(within(linha).queryByText('Ana Souza')).not.toBeInTheDocument()`.
  test('[MUDA] hoje o nome do próprio responsável aparece como chip', () => {
    renderInShell(<DashboardPage />);
    expect(within(linhaDe('Raimunda Nonata')).getByText('Ana Souza')).toBeInTheDocument();
  });

  test('[FICA] estado da IA: "IA · motivo" e o ⚠ de confiança baixa com nome acessível', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(within(linha).getByText('IA · Sem conexão')).toBeInTheDocument();
    const alerta = within(linha).getByLabelText('Triagem com confiança baixa');
    expect(alerta).toHaveTextContent('⚠');
    expect(linha).toHaveAccessibleName(/Triagem com confiança baixa/);
  });

  test('[FICA] sem "Finalizar sem motivo" na aba Atendimento', () => {
    renderInShell(<DashboardPage />);
    expect(screen.queryByRole('button', { name: 'Finalizar sem motivo' })).not.toBeInTheDocument();
  });
});

describe('linha compacta — aba Espera', () => {
  async function abrirEspera() {
    renderInShell(<DashboardPage />);
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    return linhaDe('Joaquim Pereira');
  }

  test('[FICA] nome, hora de CHEGADA (não a da última mensagem) e prévia', async () => {
    const linha = await abrirEspera();

    expect(within(linha).getByText('Joaquim Pereira')).toBeInTheDocument();
    expect(within(linha).getByText(hora(CHEGADA))).toBeInTheDocument();
    expect(within(linha).queryByText(hora(ULTIMA))).not.toBeInTheDocument();
    expect(within(linha).getByText('Minha internet caiu de novo')).toBeInTheDocument();
  });

  test('[FICA] só a localidade, sem o município; setor e não lida no nome da linha', async () => {
    const linha = await abrirEspera();

    expect(within(linha).getByText('Barão de Tromaí')).toBeInTheDocument();
    expect(linha).not.toHaveAccessibleName(/Cândido Mendes/);
    expect(linha).toHaveAccessibleName(/Financeiro/);
    expect(linha).toHaveAccessibleName(/Mensagem não lida/);
  });

  test('[FICA] "IA · motivo" e "Resolvido pela IA"', async () => {
    const linha = await abrirEspera();

    expect(within(linha).getByText('IA · Segunda via')).toBeInTheDocument();
    expect(within(linha).getByText('Resolvido pela IA')).toBeInTheDocument();
  });

  // Dois elementos, duas ações: abrir a conversa (a linha) e finalizar sem
  // motivo (o botão). Botão DENTRO de role="button" é semântica inválida e
  // levava "Finalizar sem motivo" para o nome da linha.
  test('[FICA] "Finalizar sem motivo" é irmão da linha, no mesmo item, fora do nome dela', async () => {
    const linha = await abrirEspera();
    const item = itemDe(linha);
    const finalizar = within(item).getByRole('button', { name: 'Finalizar sem motivo' });

    expect(linha).not.toContainElement(finalizar);
    expect(linha).not.toHaveAccessibleName(/Finalizar/);
  });

  // [MUDA] No redesenho a 2ª linha da Espera COMEÇA pela localidade. Hoje a
  // prévia vem antes dela na leitura. Vira:
  // `expect(linha).toHaveAccessibleName(/Barão de Tromaí.*Minha internet caiu de novo/)`.
  test('[MUDA] hoje a prévia é lida antes da localidade', async () => {
    const linha = await abrirEspera();
    expect(linha).toHaveAccessibleName(/Minha internet caiu de novo.*Barão de Tromaí/);
  });
});

describe('linha compacta — aba Automação', () => {
  async function abrirAutomacao() {
    renderInShell(<DashboardPage />);
    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    return linhaDe('Francisca Lima');
  }

  test('[FICA] "IA em triagem", hora de chegada, localidade · município', async () => {
    const linha = await abrirAutomacao();

    expect(within(linha).getByText('IA em triagem')).toBeInTheDocument();
    expect(within(linha).getByText(hora(CHEGADA))).toBeInTheDocument();
    expect(linha).toHaveAccessibleName(/Barão de Tromaí · Cândido Mendes/);
  });

  test('[FICA] "Finalizar sem motivo" também na Automação, fora da linha', async () => {
    const linha = await abrirAutomacao();
    const finalizar = within(itemDe(linha)).getByRole('button', { name: 'Finalizar sem motivo' });
    expect(linha).not.toContainElement(finalizar);
  });
});
```

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from './SupervisionPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday, closeConversation, getPublicCompany } from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';

// O QUE a linha compacta informa DENTRO da Supervisão. Lá ela é a célula de
// contato de cada registro: cidade, setor e responsável saem dela (a página
// zera esses campos) porque têm colunas próprias no registro. Fica na linha o
// que identifica o atendimento e o estado da IA, e o "Finalizar sem motivo".
//
// Escrito antes do redesenho da linha compacta; ver a legenda [FICA]/[MUDA]
// em DashboardPage.linhaCompacta.test.jsx. Aqui tudo é [FICA].

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const ULTIMA = '2026-09-24T15:42:00.000Z';

function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const LUGAR = { contactCityName: 'Cândido Mendes', contactLocalityName: 'Barão de Tromaí', sectorName: 'Financeiro' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Ana Souza', email: 'ana@dw.com' }], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  getPublicCompany.mockResolvedValue({ name: '' });
  closeConversation.mockResolvedValue({ id: 'c2', status: 'closed' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{
      id: 'c1', contactDisplayName: 'Raimunda Nonata', channelId: 'chan-1', status: 'assigned',
      assignedAgentId: 'agent-1', assignedAgentName: 'Ana Souza', sectorId: 'sector-1', ...LUGAR,
      lastMessageContent: 'Minha internet caiu de novo', lastMessageAt: ULTIMA,
      aiTriageCompletedAt: ULTIMA, aiTriageReasonName: 'Sem conexão', aiTriageLowConfidence: true,
    }],
    waiting: [{
      id: 'c2', contactDisplayName: 'Joaquim Pereira', channelId: 'chan-1', status: 'waiting',
      assignedAgentId: null, sectorId: 'sector-1', ...LUGAR,
      lastMessageContent: 'Quero a segunda via', lastMessageAt: ULTIMA,
      aiTriageCompletedAt: ULTIMA, aiTriageReasonName: 'Segunda via', aiTriageResolvedByAi: true,
    }],
    inAutomation: [{
      id: 'c3', contactDisplayName: 'Francisca Lima', channelId: 'chan-1', status: 'waiting',
      assignedAgentId: null, sectorId: null, triageState: 'pending', ...LUGAR,
      lastMessageContent: 'Oi', lastMessageAt: ULTIMA,
    }],
    closedTodayCount: 0,
    status: 'ready',
    loading: false,
    refresh: vi.fn(),
  });
});

// Na Supervisão existem DOIS botões por atendimento: a linha (nome acessível
// começa pelo nome do contato) e o "Abrir conversa de …" do registro.
function linhaDe(nome) {
  return screen.getByRole('button', { name: new RegExp(`^${nome}`) });
}
function itemDe(linha) {
  return screen.getAllByRole('listitem').filter((li) => li.contains(linha)).pop();
}

describe('linha compacta — Supervisão', () => {
  test('[FICA] nome, hora e prévia na linha', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const linha = await screen.findByRole('button', { name: /^Raimunda Nonata/ });

    expect(within(linha).getByText('Raimunda Nonata')).toBeInTheDocument();
    expect(within(linha).getByText(hora(ULTIMA))).toBeInTheDocument();
    expect(within(linha).getByText('Minha internet caiu de novo')).toBeInTheDocument();
  });

  test('[FICA] estado da IA: "IA · motivo", ⚠ com nome acessível, "Resolvido pela IA", "IA em triagem"', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const andamento = await screen.findByRole('button', { name: /^Raimunda Nonata/ });

    expect(within(andamento).getByText('IA · Sem conexão')).toBeInTheDocument();
    expect(within(andamento).getByLabelText('Triagem com confiança baixa')).toHaveTextContent('⚠');
    expect(andamento).toHaveAccessibleName(/Triagem com confiança baixa/);

    const espera = linhaDe('Joaquim Pereira');
    expect(within(espera).getByText('IA · Segunda via')).toBeInTheDocument();
    expect(within(espera).getByText('Resolvido pela IA')).toBeInTheDocument();

    expect(within(linhaDe('Francisca Lima')).getByText('IA em triagem')).toBeInTheDocument();
  });

  // O lugar e o setor aparecem UMA vez por registro, na coluna própria — a
  // página zera esses campos antes de passar a conversa para a linha.
  test('[FICA] lugar e setor ficam na coluna do registro, não duplicados na linha', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const linha = await screen.findByRole('button', { name: /^Raimunda Nonata/ });
    const registro = screen.getAllByRole('listitem').find((li) => li.contains(linha));

    expect(within(registro).getAllByText('Barão de Tromaí · Cândido Mendes')).toHaveLength(1);
    expect(linha).not.toHaveAccessibleName(/Cândido Mendes/);
    expect(linha).not.toHaveAccessibleName(/Financeiro/);
    expect(linha).not.toHaveAccessibleName(/Ana Souza/);
  });

  test('[FICA] "Finalizar sem motivo" é irmão da linha em Espera e Automação, e não existe em Andamento', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const andamento = await screen.findByRole('button', { name: /^Raimunda Nonata/ });

    expect(within(itemDe(andamento)).queryByRole('button', { name: 'Finalizar sem motivo' })).not.toBeInTheDocument();
    for (const nome of ['Joaquim Pereira', 'Francisca Lima']) {
      const linha = linhaDe(nome);
      const finalizar = within(itemDe(linha)).getByRole('button', { name: 'Finalizar sem motivo' });
      expect(linha).not.toContainElement(finalizar);
      expect(linha).not.toHaveAccessibleName(/Finalizar/);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.linhaCompacta.test.jsx src/pages/SupervisionPage.linhaCompacta.test.jsx`
Expected: 14/14 e 4/4.

- [ ] **Step 3: Provar por mutação** (e desfazer)

Na `ConversationListItem.jsx`: m1 tirar o `aria-label` de não lida → 2 falham; m2 pôr "Finalizar sem motivo" dentro da linha (o bug antigo) → 2 falham (e 1 na Supervisão); m3 tirar o `aria-label` do ⚠ → 1 falha (e 1 na Supervisão); m4 tirar o chip de setor → 3 falham; m5 ignorar `soLocalidade` → 1 falha; m6 ignorar a hora de chegada → 2 falham. A `SupervisionPage` passar a conversa inteira para a linha (lugar duplicado) → 1 falha. Desfazer.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DashboardPage.linhaCompacta.test.jsx frontend/src/pages/SupervisionPage.linhaCompacta.test.jsx
git commit -m "E0: conteudo da linha compacta pelo nome acessivel ([FICA] e [MUDA])"
```

### Task 7: As 5 falhas antigas (asserções que envelheceram)

**Files:**
- Modify: `frontend/src/components/ConversationView.test.jsx` (2 testes)
- Modify: `frontend/src/services/api.qr.test.js` (3 testes quebrados + 2 que passavam por acidente)

Nenhuma é defeito do código. `ConversationView.test.jsx` procurava o texto "Motivo do contato", que virou nome do `radiogroup` — e a asserção negativa passava sem testar nada. `api.qr.test.js` ainda simulava a resposta em HTML; desde `83a208a` a tela pede JSON e lê o campo `image`. Dois testes do QR passavam **por acidente** (o corpo HTML nunca vira JSON) e não pegavam a retirada da checagem do prefixo `data:image`.

- [ ] **Step 1: Confirmar as 5 falhas**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx src/services/api.qr.test.js`
Expected: 5 falhas — "Unable to find an element with the text: Motivo do contato" (2) e "A resposta do QR code não veio no formato esperado" (3).

- [ ] **Step 2: Aplicar as correções**

```diff
--- a/frontend/src/components/ConversationView.test.jsx
+++ b/frontend/src/components/ConversationView.test.jsx
@@ -257,7 +257,7 @@ describe('ConversationView', () => {
     );
     await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
 
-    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();
+    expect(screen.getByRole('radiogroup', { name: 'Motivo do contato' })).toBeInTheDocument();
     await userEvent.click(screen.getByLabelText('Troca de senha'));
     await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i }));
 
@@ -830,10 +830,10 @@ describe('SGP lookup panel', () => {
     const CONVERSATION_B = { id: 'c2', status: 'waiting', assignedAgentId: null };
     const { rerender } = render(<ConversationView conversation={CONVERSATION_A} onTransferClick={vi.fn()} onBack={vi.fn()} />);
     await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
-    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();
+    expect(screen.getByRole('radiogroup', { name: 'Motivo do contato' })).toBeInTheDocument();
 
     rerender(<ConversationView conversation={CONVERSATION_B} onTransferClick={vi.fn()} onBack={vi.fn()} />);
-    expect(screen.queryByText('Motivo do contato')).not.toBeInTheDocument();
+    expect(screen.queryByRole('radiogroup', { name: 'Motivo do contato' })).not.toBeInTheDocument();
   });
 });
```

```diff
--- a/frontend/src/services/api.qr.test.js
+++ b/frontend/src/services/api.qr.test.js
@@ -1,25 +1,23 @@
 import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
 import { fetchChannelQrImage } from './api';
 
-// O endpoint devolve um documento HTML. Este arquivo trava o contrato da
-// leitura: o que a tela aceita, o que ela recusa, e como ela recusa.
-const HTML_REAL = `<!DOCTYPE html>
-<html>
-<head>
-<title>QR - Berg</title>
-<style>
-  html, body { margin: 0; height: 100%; }
-  body { display: flex; align-items: center; justify-content: center; }
-  img { max-width: 100%; max-height: 100%; }
-</style>
-</head>
-<body>
-<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" alt="QR code - Berg" />
-</body>
-</html>`;
+// Desde 83a208a a tela pede JSON (Accept: application/json) e lê o campo
+// `image`. Este arquivo trava o contrato da leitura: o que a tela aceita, o
+// que ela recusa, e como ela recusa.
+const RESPOSTA_REAL = JSON.stringify({
+  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
+  channelId: 'ch1',
+  channelName: 'Berg',
+});
 
 function responde({ status = 200, corpo = '' } = {}) {
-  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(corpo) });
+  return Promise.resolve({
+    ok: status >= 200 && status < 300,
+    status,
+    text: () => Promise.resolve(corpo),
+    // Como o Response de verdade: corpo que não é JSON rejeita.
+    json: () => Promise.resolve().then(() => JSON.parse(corpo)),
+  });
 }
 
 beforeEach(() => {
@@ -30,15 +28,15 @@ afterEach(() => {
 });
 
 describe('fetchChannelQrImage', () => {
-  test('extrai a imagem do HTML que o endpoint devolve hoje', async () => {
-    global.fetch.mockReturnValue(responde({ corpo: HTML_REAL }));
+  test('extrai a imagem do campo image da resposta JSON', async () => {
+    global.fetch.mockReturnValue(responde({ corpo: RESPOSTA_REAL }));
     const src = await fetchChannelQrImage('ch1', 'tok');
     expect(src.startsWith('data:image/png;base64,')).toBe(true);
   });
 
   // O token vai no header. A URL não pode carregar credencial nenhuma.
   test('autentica pelo header e não põe token na URL', async () => {
-    global.fetch.mockReturnValue(responde({ corpo: HTML_REAL }));
+    global.fetch.mockReturnValue(responde({ corpo: RESPOSTA_REAL }));
     await fetchChannelQrImage('ch1', 'tok');
 
     const [url, opcoes] = global.fetch.mock.calls[0];
@@ -69,26 +67,29 @@ describe('fetchChannelQrImage', () => {
     await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'erro' });
   });
 
-  // Se o backend mudar o template, a leitura precisa falhar ALTO — é essa
+  // Se o backend mudar o formato, a leitura precisa falhar ALTO — é essa
   // falha que impede a tela de voltar ao iframe com token na URL.
-  test('HTML sem imagem vira motivo "formatoInesperado"', async () => {
-    global.fetch.mockReturnValue(responde({ corpo: '<html><body><p>sem imagem</p></body></html>' }));
+  test('resposta sem o campo image vira motivo "formatoInesperado"', async () => {
+    global.fetch.mockReturnValue(responde({ corpo: JSON.stringify({ channelId: 'ch1' }) }));
     await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
   });
 
   test('src que não é data:image é recusado', async () => {
     for (const src of ['https://exemplo.com/qr.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) {
-      global.fetch.mockReturnValue(responde({ corpo: `<html><body><img src="${src}" /></body></html>` }));
+      global.fetch.mockReturnValue(responde({ corpo: JSON.stringify({ image: src }) }));
       await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
     }
   });
 
-  // O HTML é lido com DOMParser, que não executa script nem carrega recurso.
-  test('script no HTML não é executado ao ler a resposta', async () => {
+  // A resposta é lida como JSON: um <script> dentro dela é só texto.
+  test('script dentro da resposta não é executado ao ler a resposta', async () => {
     const espiao = vi.fn();
     vi.stubGlobal('__qrEspiao', espiao);
     global.fetch.mockReturnValue(responde({
-      corpo: '<html><body><script>window.__qrEspiao && window.__qrEspiao()</script><img src="data:image/png;base64,iVBORw0KGgo=" /></body></html>',
+      corpo: JSON.stringify({
+        image: 'data:image/png;base64,iVBORw0KGgo=',
+        channelName: '<script>window.__qrEspiao && window.__qrEspiao()</script>',
+      }),
     }));
 
     await fetchChannelQrImage('ch1', 'tok');
```

- [ ] **Step 3: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx src/services/api.qr.test.js`
Expected: todos passam (104/104 na conferência).

- [ ] **Step 4: Provar por mutação** (e desfazer)

g1 — o modal de motivo não fecha ao trocar de conversa: "the close-reason popup closes…" falha (a asserção negativa deixou de ser vazia). g2 — ler `corpo.img` em vez de `corpo.image` no `fetchChannelQrImage`: 3 falham. g3 — trocar `!PREFIXO_DE_IMAGEM.test(src)` por `false` em `frontend/src/services/api.js`: "src que não é data:image é recusado" falha. Desfazer.

- [ ] **Step 5: Suíte inteira verde**

Run: `cd frontend && npx vitest run`
Expected: **0 falhas** (na conferência, com a E1.1: 158 arquivos, 1612 testes, 5 pulados).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ConversationView.test.jsx frontend/src/services/api.qr.test.js
git commit -m "E0: as 5 falhas antigas eram assercoes envelhecidas; e 2 testes do QR que passavam por acidente"
```

### Task 8: Inventário na base nova

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md` (só endereços de `components/ConversationView.jsx` e `hooks/useConversationMessages.js`, se a base tiver a E1.1)

O Apêndice A foi verificado em `e5236da`. A E1.1 acrescenta linhas nesses dois arquivos. Sem ela na base, pule para o Step 3.

- [ ] **Step 1: Listar os trechos que mudaram de lugar**

```bash
git diff e5236da HEAD -U0 -- frontend/src/components/ConversationView.jsx frontend/src/hooks/useConversationMessages.js | grep '^@@'
```
Cada `@@ -a,b +c,d @@` diz: linhas depois de `a+b` no arquivo antigo andaram `(c+d)-(a+b)`.

- [ ] **Step 2: Remapear os endereços** desses dois arquivos no Apêndice A com essa tabela (script pequeno, ou à mão para poucos trechos) — nunca por palpite.

- [ ] **Step 3: Rodar o verificador contra uma cópia da base**

```bash
rm -rf /tmp/base-e0 && mkdir -p /tmp/base-e0
git archive HEAD frontend/src frontend/index.html src | tar -x -C /tmp/base-e0
node ferramentas/inventario/verificar.cjs docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md /tmp/base-e0 ferramentas/inventario/conferencias/2026-09-24-conferencia-auditor.tsv ferramentas/inventario/conferencias/2026-09-24-conferencia-propria.tsv
```
Expected: `"falha": 0` e `"semProvaESemConferencia": 0`. Qualquer falha é endereço remapeado errado: corrija o endereço, nunca o verificador.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md
git commit -m "E0: inventario remapeado para a base com a E1.1 (verificador em zero)"
```

### Task 9: Linha de base

**Files:**
- Create: `ferramentas/medicao/linha-de-base/<commit-da-base>/` (RESUMO.json, M1–M9, ambiente.json, ociosidade.json, prints)

- [ ] **Step 1: Máquina ociosa.** Feche o que puder; a medição de tempo recusa com CPU > 15%.

- [ ] **Step 2: Medir tudo com 3 rodadas de tempo**

```bash
node ferramentas/medicao/medir.mjs --build --saida ferramentas/medicao/linha-de-base/$(git rev-parse --short HEAD) --rodadas 3
```
Expected: termina sem "NAO COMPARAVEL"; `ociosidade.json` com todas as amostras ≤ 15%.

- [ ] **Step 3: Conferir a estrutura contra a de `e5236da`** (versionada na Task 1)

```bash
node ferramentas/medicao/comparar.mjs ferramentas/medicao/linha-de-base/e5236da-estrutural/RESUMO.json ferramentas/medicao/linha-de-base/$(git rev-parse --short HEAD)/RESUMO.json
```
Expected: as métricas de estrutura iguais, salvo o que a E1.1 mudou de propósito na conversa aberta (`data-mensagem-id` nas linhas não muda contagem de elementos; se o M9 acusar diferença de nós, ela tem de ser explicada pelo diff da E1.1 antes de seguir). Entre `ac334af` e `e5236da` foram 0 de 456. O tempo não se compara aqui: a de `e5236da` é só estrutural.

- [ ] **Step 4: Commit**

```bash
git add ferramentas/medicao/linha-de-base
git commit -m "E0: linha de base de $(git rev-parse --short HEAD) (ociosa, mediana de 3)"
```

### Task 10: Revisão, registro e publicação

- [ ] **Step 1:** revisão independente do branch inteiro (subagente revisor; nada de implementar) — o E1 e a E1.1 acharam defeitos reais só na revisão do branch inteiro.
- [ ] **Step 2:** `git diff --stat main...HEAD` confirma: nada fora de `*.test.*`, `ferramentas/` e `docs/`.
- [ ] **Step 3:** registro no Obsidian (`Próximos Passos`, `Histórico do Projeto`): o que a E0 passa a proteger e a linha de base.
- [ ] **Step 4:** trazer ao proprietário para **autorização de publicação**. Só com ela: `git checkout main && git merge --no-ff e0/prova-e-guardas && git push`. Sem runtime: o deploy do Render republica o mesmo site.
