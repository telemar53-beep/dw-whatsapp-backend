# E2.1 — Fundação visual — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr no lugar o sistema visual de que toda a mesa depende — tokens em `@theme` com um acento de origem única, contraste validado por teste, guarda do acento único, Inter como fonte única de interface, ícones Tabler fora do caminho do login e estados de interação nos botões — sem redesenhar ainda nenhuma tela.

**Architecture:** `src/estilo/tokens.css` (importado por `index.css`) declara os tokens do spec 5.2–5.5 e passa a ser a ÚNICA fonte da família do acento: o teal do tema claro e as redefinições de acento de `.chat-theme` saem, e os derivados (`strong`, `soft`, `surface`, `line`, `on-accent`, anel de foco) são calculados a partir de `--color-accent` no `:root`. Dois testes estáticos leem o fonte (o Tailwind 4.3 tira do build a variável sem uso): `contraste.test.js` resolve `color-mix` em OKLab e exige os limiares da 5.9; `acentoUnico.test.js` varre `src/` e mantém a lista de pendências por arquivo. Os ícones vêm da entrega Tabler conferida (Apêndice D) em três módulos por camada, e as três importações que puxavam 47 ícones para o login saem.

**Tech Stack:** Tailwind 4.3.3 (`@theme`), Vite 5.4, Vitest 2.1 (ambiente jsdom, `fs` disponível), Node 20 para os scripts de medição.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (seções 5.2–5.9, 12.2) e `docs/superpowers/specs/2026-09-24-redesenho-apendice-D-iconografia.md`. Plano mestre: `docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md`.

> **Provado antes da aprovação (24/09/2026):** as Tasks 1, 2, 3, 5 e 6 foram aplicadas a partir deste texto numa cópia descartável do frontend (`scratchpad/e2-prova/`, fora do repositório). Resultados: tokens e contraste verdes; a guarda do acento passa com a lista abaixo; a da entrada e a de tipografia falham antes e passam depois; estilo computado no Chrome real `rgb(242, 140, 69)` no botão com o `on-accent` preto; login JS 87.605 → 83.128 B e CSS 22.076 → 17.126 B; suíte cheia com só as 5 falhas antigas + as que dependem de tarefa ainda não aplicada. Três erros do plano foram achados assim e corrigidos no texto (grupo "Equipe e permissões" com `IconTeam`; 36 e não 37 arquivos no codemod; o ganho de "/" que só vem com a troca dos SVGs soltos).

## Global Constraints

Valem as do plano mestre. As que mais pesam aqui:

- Os cinco ganhos publicados não regridem; os guardas da E0 (`src/guardas/*.test.*`) ficam verdes em toda tarefa.
- Nenhuma fonte nova, nenhuma biblioteca de runtime nova. `fontes.css` não muda (guarda de fontes locais).
- Tokens antigos (`--chat-*`, `--color-ui-*`, `--color-wa-*`, `--sv-*`, `--rp-*`, tema claro) **convivem** até a E7; esta etapa só tira o que conflita com a origem única do acento.
- Se um valor inicial do spec falhar no teste de contraste, ajusta-se o **valor**, nunca o limiar (spec 5.3). Com os valores do spec, todos passam (prova em `scratchpad/e2-dossie/contraste-prova.mjs`, 24/09: a menor folga é `on-accent` sobre o azul `#1a73e8`, 4,51:1).
- Harness sempre fora de `frontend/` (o Tailwind vaza classe).

## Review Focus

- **Derivado calculado com o acento errado.** Custom property com `var()` é resolvida no elemento onde é declarada; enquanto `.chat-theme` redefinir `--color-accent`, um derivado do `:root` sairia com o valor do `:root`. Teste na Task 1 (nenhuma redefinição da família do acento fora do `tokens.css`) e prova de estilo computado no Step 7 da Task 1.
- **Troca de marca em tempo de execução.** Trocar só `--color-accent` no `:root` precisa mudar botão primário, bolha de saída, anel de foco e texto sobre o acento. Teste na Task 2 (os derivados para as três cores da prova 5.2.4) e rodada do harness na E2.6.
- **Ícone some de uma tela de Configurações.** A troca de imports mexe em 36 arquivos; um nome que não existe num módulo quebra só em tempo de execução. O codemod da Task 6 falha com mensagem se um nome não tiver dono, e o build da Task 6 falha se um import não resolver.
- **Login engordando por um caminho novo.** Um barril ou utilitário novo que importe ícones ou `react-router-dom` no chunk de entrada. Guarda estática na Task 5.
- **Botão pressionado sem movimento reduzido.** `translate-y` precisa desligar com `prefers-reduced-motion`. Teste na Task 7.

---

## Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `frontend/src/estilo/tokens.css` | Criar | tokens da E2 (`@theme`) + derivados do acento |
| `frontend/src/estilo/tokens.test.js` | Criar | tokens declarados e origem única do acento |
| `frontend/src/estilo/cor.js` | Criar | conversões sRGB ↔ OKLab/OKLCH, `color-mix`, contraste (só testes importam) |
| `frontend/src/estilo/contraste.test.js` | Criar | limiares da 5.9 |
| `frontend/src/estilo/acentoUnico.test.js` | Criar | varredura + lista de pendências (5.2.4) |
| `frontend/src/estilo/tipografia.test.js` | Criar | Inter única (sem `font-wa`) |
| `frontend/src/index.css` | Modificar | importa `tokens.css`; tira o teal, o acento de `.chat-theme`, `--font-wa` e `--color-focus-ring` |
| `frontend/src/navigation/rotas.js` | Criar | `hasLevel`, `SETTINGS_BASE`, `LEGACY_REDIRECTS` sem ícone |
| `frontend/src/navigation/navItems.js` | Modificar | reexporta de `rotas.js`; grupos de Configurações sem ícone |
| `frontend/src/App.jsx`, `components/ProtectedRoute.jsx`, `pages/AccessDeniedPage.jsx`, `components/RotaLazy.jsx` | Modificar | tiram os caminhos que levavam ícones e diálogo ao login |
| `frontend/src/guardas/entradaSemIcones.test.js` | Criar | grafo estático da entrada sem ícones nem diálogo |
| `frontend/src/components/icons/IconesEntrada.js`, `IconesTrabalho.js`, `IconesConfig.js`, `LICENSE-Tabler.txt`, `README.md` | Criar | módulos gerados (cópia conferida por hash) |
| `frontend/src/assets/brands/pix.svg` | Criar | marca Pix (Simple Icons, CC0) — referência para o README de marcas |
| `ferramentas/icones/migrar-imports.mjs` | Criar | codemod dos imports |
| `ferramentas/icones/gerador/*` | Criar | gerador e verificação (procedência) |
| `ferramentas/medicao/pesos.mjs` | Criar | gzip do JS/CSS por caminho, pelo manifesto do Vite |
| 36 arquivos que importam `icons/WaIcons` ou `icons/SgpIcons` | Modificar | imports para os módulos novos |
| `frontend/src/components/icons/WaIcons.jsx` | Modificar | só `IconEmptyChat` (sai na E2.3) |
| `frontend/src/components/icons/SgpIcons.jsx` | Apagar | tudo foi para `IconesTrabalho` |
| `frontend/src/components/ui/Button.jsx` | Modificar | variantes em tokens + pressionado |
| `docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md` | Criar | registro S × C da E2 |

## Interfaces

**Produz (para E2.2–E2.5):**

Utilitários Tailwind gerados pelo `@theme` do `tokens.css`:

| Família | Utilitários |
|---|---|
| Superfícies | `bg-fundo`, `bg-painel`, `bg-elevado`, `bg-campo`, `bg-hover`, `bg-selecionado`, `bg-veu`, `bg-bolha-entrada`, `bg-bolha-saida` |
| Linha | `border-linha`, `divide-linha`, `bg-linha` |
| Tinta | `text-tinta`, `text-tinta-2`, `text-tinta-3` (e `bg-`/`border-` equivalentes) |
| Semântica | `text-perigo`, `bg-perigo-fundo`, `text-aviso`, `bg-aviso-fundo`, `border-perigo`, `border-aviso` |
| Acento | `bg-accent`, `hover:bg-accent-strong`, `text-accent-soft`, `bg-accent-surface`, `border-accent-line`, `text-on-accent`, `outline-focus-ring` |
| Raio | `rounded-ui-sm` (6), `rounded-ui-md` (10), `rounded-ui-lg` (16), `rounded-full` |
| Sombra | `shadow-flutuante`, `shadow-dialogo` |
| Tipo | `text-meta` (12/16), `text-rotulo` (13/18), `text-corpo` (14/20), `text-nome` (15/20), `text-titulo` (16/22), `text-pagina` (20/28), `text-numero` (26/32); `font-sans` (Inter), `font-display` (Sora) |
| Movimento | `duration-120`, `duration-180` (números do Tailwind) |

Espaço: só os passos 1, 2, 3, 4, 6, 8, 12 do Tailwind (4, 8, 12, 16, 24, 32, 48 px).

Ícones: `import { IconX } from '…/components/icons/IconesTrabalho'` (casca e mesa), `'…/IconesConfig'` (só Configurações), `'…/IconesEntrada'` (só o cadeado). Nomes na tabela D.9 do Apêndice D. Nenhum `*Fill`.

`ferramentas/medicao/pesos.mjs <dist>` → imprime `{"login":{"js":n,"css":n},"raiz":{"js":n,"css":n}}` (gzip-9, bytes).

---

### Task 1: `tokens.css` e a origem única do acento

**Files:**
- Create: `frontend/src/estilo/tokens.css`
- Create: `frontend/src/estilo/tokens.test.js`
- Modify: `frontend/src/index.css:1-2` (import), `:6-8` (`--font-wa`, sai na Task 4), `:69-92` (teal + anel de foco), `:143-151` (acento em `.chat-theme`)

**Interfaces:** Produces os utilitários da tabela acima.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/estilo/tokens.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// O Tailwind 4.3 tira do build a variável de @theme que nenhum utilitário cita
// (conferido no dist de 24/09): por isso este teste lê o FONTE.
const AQUI = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(join(AQUI, 'tokens.css'), 'utf8');
const INDEX = readFileSync(join(AQUI, '..', 'index.css'), 'utf8');

function blocoTheme(css) {
  const inicio = css.indexOf('@theme {');
  expect(inicio).toBeGreaterThanOrEqual(0);
  let nivel = 0;
  for (let i = inicio; i < css.length; i += 1) {
    if (css[i] === '{') nivel += 1;
    if (css[i] === '}') { nivel -= 1; if (nivel === 0) return css.slice(inicio, i + 1); }
  }
  throw new Error('@theme sem fechamento');
}

function declaracoes(css) {
  const mapa = {};
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) mapa[m[1]] = m[2].trim();
  return mapa;
}

const ESPERADOS = {
  '--color-fundo': '#1b2227',
  '--color-painel': '#222a30',
  '--color-elevado': '#2a333a',
  '--color-campo': '#1b2227',
  '--color-linha': '#343e46',
  '--color-hover': '#283138',
  '--color-selecionado': '#2e3840',
  '--color-tinta': '#eef2f4',
  '--color-tinta-2': '#b3bec5',
  '--color-tinta-3': '#939fa8',
  '--color-bolha-entrada': '#28323a',
  '--color-bolha-saida': 'color-mix(in oklab, var(--color-accent) 16%, #333b41)',
  '--color-perigo': '#ff8a80',
  '--color-perigo-fundo': 'color-mix(in oklab, var(--color-perigo) 14%, var(--color-painel))',
  '--color-aviso': '#f0b65f',
  '--color-aviso-fundo': 'color-mix(in oklab, var(--color-aviso) 14%, var(--color-painel))',
  '--color-veu': 'rgba(9, 12, 15, 0.72)',
  '--color-accent': '#f28c45',
  '--radius-ui-sm': '6px',
  '--radius-ui-md': '10px',
  '--radius-ui-lg': '16px',
  '--shadow-flutuante': '0 8px 24px rgba(0, 0, 0, 0.35)',
  '--shadow-dialogo': '0 24px 64px rgba(0, 0, 0, 0.45)',
  '--text-meta': '12px',
  '--text-rotulo': '13px',
  '--text-corpo': '14px',
  '--text-nome': '15px',
  '--text-titulo': '16px',
  '--text-pagina': '20px',
  '--text-numero': '26px',
};

const FAMILIA_DO_ACENTO = [
  '--color-accent',
  '--color-accent-strong',
  '--color-accent-soft',
  '--color-accent-surface',
  '--color-accent-surface-strong',
  '--color-accent-line',
  '--color-on-accent',
  '--color-focus-ring',
];

describe('tokens da E2', () => {
  test('o @theme do tokens.css declara os tokens do spec com os valores iniciais', () => {
    const theme = declaracoes(blocoTheme(TOKENS));
    for (const [nome, valor] of Object.entries(ESPERADOS)) expect([nome, theme[nome]]).toEqual([nome, valor]);
  });

  test('os derivados do acento vêm de --color-accent, e há resgate fora de @supports', () => {
    const theme = declaracoes(blocoTheme(TOKENS));
    for (const nome of ['--color-accent-strong', '--color-accent-surface', '--color-accent-surface-strong', '--color-accent-line']) {
      expect(theme[nome]).toMatch(/var\(--color-accent\)/);
    }
    expect(theme['--color-on-accent']).toBe('#2a1b12');
    expect(theme['--color-accent-soft']).toBe('#e5a16d');
    expect(theme['--color-focus-ring']).toBe('var(--color-accent-soft)');
    expect(TOKENS).toMatch(/@supports \(color: oklch\(from red l c h\)\)/);
    expect(TOKENS).toContain('--color-on-accent: oklch(from var(--color-accent) clamp(0, (0.62 - l) * 1000, 1) 0 0);');
    expect(TOKENS).toContain('--color-accent-soft: oklch(from var(--color-accent) max(l, 0.8) c h);');
  });

  test('a família do acento é declarada SÓ no tokens.css (origem única)', () => {
    const noIndex = declaracoes(INDEX);
    for (const nome of FAMILIA_DO_ACENTO) expect([nome, noIndex[nome]]).toEqual([nome, undefined]);
  });

  test('o index.css importa o tokens.css logo depois do Tailwind', () => {
    const linhas = INDEX.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(linhas[0]).toBe('@import "tailwindcss";');
    expect(linhas[1]).toBe('@import "./estilo/tokens.css";');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/estilo/tokens.test.js`
Expected: FAIL — `ENOENT … tokens.css`.

- [ ] **Step 3: Criar `tokens.css`**

`frontend/src/estilo/tokens.css`:

```css
/* Tokens da E2 (spec 5.2–5.5). Os VALORES são os do tema grafite e são
   validados por teste (estilo/contraste.test.js): se um falhar, ajusta-se o
   valor, nunca o limiar.

   Origem única do acento: tudo que é acento deriva de --color-accent, no :root.
   Trocar a marca é trocar UM valor. Nenhuma outra folha redefine a família do
   acento (estilo/tokens.test.js) — uma custom property com var() é resolvida no
   elemento onde é declarada, e um derivado do :root sairia com o acento
   errado se .chat-theme redefinisse só a origem. */
@theme {
  /* Marca */
  --color-accent: #f28c45;
  --color-accent-strong: color-mix(in oklab, var(--color-accent) 92%, black);
  --color-accent-surface: color-mix(in oklab, var(--color-accent) 14%, transparent);
  --color-accent-surface-strong: color-mix(in oklab, var(--color-accent) 24%, transparent);
  --color-accent-line: color-mix(in oklab, var(--color-accent) 42%, transparent);
  /* Resgates para navegador sem sintaxe de cor relativa; o @supports abaixo
     calcula os dois a partir do acento. */
  --color-on-accent: #2a1b12;
  --color-accent-soft: #e5a16d;
  --color-focus-ring: var(--color-accent-soft);

  /* Superfícies e tinta */
  --color-fundo: #1b2227;
  --color-painel: #222a30;
  --color-elevado: #2a333a;
  --color-campo: #1b2227;
  --color-linha: #343e46;
  --color-hover: #283138;
  --color-selecionado: #2e3840;
  --color-tinta: #eef2f4;
  --color-tinta-2: #b3bec5;
  --color-tinta-3: #939fa8;
  --color-bolha-entrada: #28323a;
  --color-bolha-saida: color-mix(in oklab, var(--color-accent) 16%, #333b41);
  --color-veu: rgba(9, 12, 15, 0.72);

  /* Semântica (não existe cor de sucesso) */
  --color-perigo: #ff8a80;
  --color-perigo-fundo: color-mix(in oklab, var(--color-perigo) 14%, var(--color-painel));
  --color-aviso: #f0b65f;
  --color-aviso-fundo: color-mix(in oklab, var(--color-aviso) 14%, var(--color-painel));

  /* Raio: 4 passos (6, 10, 16, pílula) */
  --radius-ui-sm: 6px;
  --radius-ui-md: 10px;
  --radius-ui-lg: 16px;

  /* Elevação: uma sombra por papel, só em S2 */
  --shadow-flutuante: 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-dialogo: 0 24px 64px rgba(0, 0, 0, 0.45);

  /* Tipo: escala única, piso de 12 px */
  --text-meta: 12px;
  --text-meta--line-height: 16px;
  --text-rotulo: 13px;
  --text-rotulo--line-height: 18px;
  --text-corpo: 14px;
  --text-corpo--line-height: 20px;
  --text-nome: 15px;
  --text-nome--line-height: 20px;
  --text-titulo: 16px;
  --text-titulo--line-height: 22px;
  --text-pagina: 20px;
  --text-pagina--line-height: 28px;
  --text-numero: 26px;
  --text-numero--line-height: 32px;
}

/* Fora de camada de propósito: vence o @layer theme do :root. */
@supports (color: oklch(from red l c h)) {
  :root {
    /* Branco se o acento for escuro, preto se for claro. */
    --color-on-accent: oklch(from var(--color-accent) clamp(0, (0.62 - l) * 1000, 1) 0 0);
    /* Acento em texto e ícone sobre o escuro: luminosidade mínima para ler. */
    --color-accent-soft: oklch(from var(--color-accent) max(l, 0.8) c h);
  }
}
```

- [ ] **Step 4: Ligar ao `index.css` e tirar a família duplicada**

Em `frontend/src/index.css`:

1. Logo depois da linha 1 (`@import "tailwindcss";`), inserir a linha `@import "./estilo/tokens.css";` (o `@import` precisa vir antes de qualquer regra; importado por JS, não geraria utilitários).
2. Apagar, no `@theme`, o bloco do acento — do comentário `/* ---------- Acento ----------` até a linha `--color-accent-line: rgba(13, 148, 136, 0.4);` (hoje linhas 69-88: `--color-accent`, `--color-accent-strong`, `--color-on-accent`, o comentário da Etapa 7, `--color-accent-soft`, `--color-accent-surface`, `--color-accent-surface-strong`, `--color-accent-line`) — e o bloco do anel de foco (hoje linhas 90-92: comentário + `--color-focus-ring: #e5a16d;`).
3. Apagar, em `.chat-theme`, as linhas da família do acento (hoje 143-151): `--color-accent`, `--color-accent-strong`, `--color-on-accent`, o comentário de duas linhas e `--color-accent-soft`, `--color-accent-surface`, `--color-accent-surface-strong`, `--color-accent-line`.

Conferir que sobrou uma declaração de cada:

Run: `cd frontend && grep -rn "^\s*--color-accent\|^\s*--color-on-accent\|^\s*--color-focus-ring" src --include=*.css`
Expected: só linhas de `src/estilo/tokens.css`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/estilo/tokens.test.js`
Expected: PASS (4).

- [ ] **Step 6: Suíte inteira e build**

Run: `cd frontend && npx vitest run && npx vite build`
Expected: suíte como antes; build sem erro. O jsdom não calcula cor, então nenhum teste de componente muda.

- [ ] **Step 7: Prova de estilo computado (a armadilha do `var()` no `:root`)**

Criar o diagnóstico `ferramentas/medicao/diagnostico/estilo-computado.mjs` (fora de `frontend/`; usa as peças do harness versionado na E0, as mesmas do `smoke.mjs`):

```js
// Estilo computado de um elemento no build de verdade — a prova da armadilha
// do @layer (classe no DOM não prova nada) e da origem única do acento.
//   MEDICAO_DIST=<build> node medicao/diagnostico/estilo-computado.mjs <atendente|admin|nenhum> <rota> <seletor> <propriedade> [...]
import * as H from '../lib/harness.mjs';

const [perfilArg, rota, seletor, ...propriedades] = process.argv.slice(2);
const perfil = perfilArg === 'nenhum' ? null : perfilArg;
const srv = await H.subirServidores();
const ctx = await H.abrirSessao({ nome: 'estilo', servidor: srv.h2, perfil });
try {
  await H.navegar(ctx.page, ctx.origin + rota);
  await ctx.page.waitForExpr(`document.querySelector(${JSON.stringify(seletor)})`, { timeoutMs: 20000 });
  const valores = await ctx.page.eval(
    `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(seletor)})); return ${JSON.stringify(propriedades)}.map((p) => [p, s.getPropertyValue(p)]); })()`,
  );
  for (const [p, v] of valores) console.log(`${p}: ${v}`);
} finally {
  await ctx.close();
  await srv.close();
}
```

Run: `cd frontend && npx vite build && cd .. && MSYS_NO_PATHCONV=1 MEDICAO_DIST=frontend/dist node ferramentas/medicao/diagnostico/estilo-computado.mjs nenhum /login "button[type=submit]" background-color color`
Expected: `background-color: rgb(242, 140, 69)` e `color: oklch(0 0 0)` — o botão Entrar usa `bg-accent` (laranja, **não** o teal `rgb(13, 148, 136)` do `:root` antigo) e `text-on-accent`, que o `@supports` calcula preto a partir do acento. Provado numa cópia descartável em 24/09 com este mesmo `tokens.css`.

(`MSYS_NO_PATHCONV=1`: no Git Bash do Windows, sem isso o argumento `/login` vira `C:/Program Files/Git/login` e o Chrome recusa a URL.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/estilo/tokens.css frontend/src/estilo/tokens.test.js frontend/src/index.css ferramentas/medicao/diagnostico/estilo-computado.mjs
git commit -m "E2.1: tokens.css com a origem unica do acento e os tokens do tema grafite"
```

---

### Task 2: Contraste validado por teste

**Files:**
- Create: `frontend/src/estilo/cor.js`
- Test: `frontend/src/estilo/contraste.test.js`

**Interfaces:**
- Consumes: `tokens.css` (Task 1).
- Produces: `cor.js` → `hexParaRgb(s)`, `rgbParaOklab(c)`, `oklabParaRgb(o)`, `oklch(c)` → `{ L, C, H }`, `oklchParaRgb(L, C, H)`, `misturarOklab(a, b, p)`, `contraste(a, b)`, `compor(frente, fundo)` (alfa sobre opaco). Usado também pela Task 3.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/estilo/contraste.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { hexParaRgb, oklch, oklchParaRgb, misturarOklab, contraste, compor } from './cor';

// Lê os tokens do FONTE e resolve cada valor como o navegador resolveria:
// hex, rgba(), var() e color-mix(in oklab, A p%, B). Os derivados do @supports
// (on-accent, accent-soft) são calculados pela mesma fórmula do CSS.
const AQUI = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(join(AQUI, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const THEME = TOKENS.slice(TOKENS.indexOf('@theme {'), TOKENS.indexOf('@supports'));
const DECL = Object.fromEntries([...THEME.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

function resolver(valor, acento) {
  const v = valor.trim();
  if (v.startsWith('var(')) {
    const nome = v.slice(4, -1).trim();
    if (nome === '--color-accent') return acento;
    if (nome === '--color-accent-soft') return soft(acento);
    return resolver(DECL[nome], acento);
  }
  if (v === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith('#')) return hexParaRgb(v);
  const rgba = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (rgba) return { r: +rgba[1] / 255, g: +rgba[2] / 255, b: +rgba[3] / 255, a: rgba[4] === undefined ? 1 : +rgba[4] };
  const mix = v.match(/^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/);
  if (mix) return misturarOklab(resolver(mix[1], acento), resolver(mix[3], acento), +mix[2] / 100);
  throw new Error(`valor não suportado pelo teste: ${v}`);
}
// Mesma regra do @supports do tokens.css.
function onAccent(acento) {
  return (0.62 - oklch(acento).L) * 1000 > 0 ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
}
function soft(acento) {
  const { L, C, H } = oklch(acento);
  return oklchParaRgb(Math.max(L, 0.8), C, H);
}
function tokens(acentoHex = DECL['--color-accent']) {
  const acento = hexParaRgb(acentoHex);
  const t = (nome) => resolver(DECL[nome], acento);
  return {
    acento,
    fundo: t('--color-fundo'), painel: t('--color-painel'), elevado: t('--color-elevado'),
    linha: t('--color-linha'), hover: t('--color-hover'), selecionado: t('--color-selecionado'),
    tinta: t('--color-tinta'), tinta2: t('--color-tinta-2'), tinta3: t('--color-tinta-3'),
    bolhaEntrada: t('--color-bolha-entrada'), bolhaSaida: t('--color-bolha-saida'),
    perigo: t('--color-perigo'), perigoFundo: t('--color-perigo-fundo'),
    aviso: t('--color-aviso'), avisoFundo: t('--color-aviso-fundo'),
    onAccent: onAccent(acento), accentSoft: soft(acento), focus: soft(acento),
  };
}

const T = tokens();

describe('contraste dos tokens (spec 5.9)', () => {
  test.each([
    ['tinta', 'fundo', 7], ['tinta', 'painel', 7], ['tinta', 'elevado', 7], ['tinta', 'bolhaEntrada', 7], ['tinta', 'bolhaSaida', 7],
    ['tinta2', 'painel', 4.5], ['tinta2', 'elevado', 4.5], ['tinta2', 'bolhaEntrada', 4.5], ['tinta2', 'bolhaSaida', 4.5],
    ['tinta3', 'fundo', 4.5], ['tinta3', 'painel', 4.5], ['tinta3', 'elevado', 4.5],
    ['accentSoft', 'painel', 4.5],
    ['onAccent', 'acento', 4.5],
    ['focus', 'fundo', 3], ['focus', 'painel', 3],
    ['perigo', 'painel', 4.5], ['perigo', 'elevado', 4.5], ['perigo', 'perigoFundo', 4.5],
    ['aviso', 'painel', 4.5], ['aviso', 'elevado', 4.5], ['aviso', 'avisoFundo', 4.5],
    ['tinta', 'perigoFundo', 7], ['tinta', 'avisoFundo', 7],
  ])('%s sobre %s ≥ %s:1', (frente, fundo, minimo) => {
    expect(contraste(T[frente], T[fundo])).toBeGreaterThanOrEqual(minimo);
  });

  test.each([
    ['bolhaSaida', 'bolhaEntrada', 1.3],
    ['selecionado', 'painel', 1.2],
    ['hover', 'painel', 1.08],
    ['linha', 'painel', 1.3],
  ])('%s distingue-se de %s por luminância (≥ %s:1)', (a, b, minimo) => {
    expect(contraste(T[a], T[b])).toBeGreaterThanOrEqual(minimo);
  });

  test('o véu escurece a mesa: o painel sob o véu fica abaixo do fundo', () => {
    const veu = resolver(DECL['--color-veu'], T.acento);
    expect(contraste(compor(veu, T.painel), { r: 1, g: 1, b: 1, a: 1 })).toBeGreaterThan(contraste(T.painel, { r: 1, g: 1, b: 1, a: 1 }));
  });

  // Prova 5.2.4: a marca é um token. Com o acento trocado, o texto sobre ele e o
  // acento em texto continuam legíveis.
  test.each(['#1a73e8', '#f5c518', '#1f3a5f'])('marca alternativa %s: on-accent ≥ 4,5 e accent-soft ≥ 4,5 sobre o painel', (hex) => {
    const alt = tokens(hex);
    expect(contraste(alt.onAccent, alt.acento)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(alt.accentSoft, alt.painel)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/estilo/contraste.test.js`
Expected: FAIL — `Failed to resolve import "./cor"`.

- [ ] **Step 3: Implementar `cor.js`**

`frontend/src/estilo/cor.js`:

```js
// Cor para os testes de estilo (contraste e acento único). Nenhum código de
// produção importa este arquivo. Conversões de Björn Ottosson (OKLab) e
// luminância relativa da WCAG 2.
const limitar = (x) => Math.min(1, Math.max(0, x));
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gama = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexParaRgb(texto) {
  let h = texto.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const canal = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: canal(0), g: canal(2), b: canal(4), a: h.length === 8 ? canal(6) : 1 };
}

export function rgbParaOklab({ r, g, b }) {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabParaRgb({ L, A, B }) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: limitar(gama(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: limitar(gama(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: limitar(gama(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: 1,
  };
}

export function oklch(cor) {
  const { L, A, B } = rgbParaOklab(cor);
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

export function oklchParaRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  return oklabParaRgb({ L, A: C * Math.cos(h), B: C * Math.sin(h) });
}

// color-mix(in oklab, a p, b): com alfa, interpola pré-multiplicado, como o CSS.
export function misturarOklab(a, b, p) {
  const aa = a.a ?? 1;
  const ab = b.a ?? 1;
  const alfa = aa * p + ab * (1 - p);
  if (alfa === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const x = rgbParaOklab(a);
  const y = rgbParaOklab(b);
  const mistura = (u, v) => (u * aa * p + v * ab * (1 - p)) / alfa;
  return { ...oklabParaRgb({ L: mistura(x.L, y.L), A: mistura(x.A, y.A), B: mistura(x.B, y.B) }), a: alfa };
}

// Cor com alfa pintada sobre um fundo opaco (sRGB, como o navegador compõe).
export function compor(frente, fundo) {
  const a = frente.a ?? 1;
  return { r: frente.r * a + fundo.r * (1 - a), g: frente.g * a + fundo.g * (1 - a), b: frente.b * a + fundo.b * (1 - a), a: 1 };
}

const luminancia = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contraste(a, b) {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/estilo/contraste.test.js`
Expected: PASS (24 + 4 + 1 + 3 = 32 casos). Os valores esperados, conferidos na prova de 24/09: tinta/bolha-saída 7,88; tinta-2/bolha-saída 4,69; tinta-3/elevado 4,76; bolha-saída/entrada 1,47; selecionado/painel 1,22; hover/painel 1,10; linha/painel 1,33; on-accent/acento 8,61.

- [ ] **Step 5: Conferir a conversão contra referência publicada**

Acrescentar ao fim de `contraste.test.js`:

```js
describe('conversão OKLCH confere com as referências publicadas', () => {
  test.each([
    ['#ff0000', 0.628, 0.2577, 29.23],
    ['#00ff00', 0.8664, 0.2948, 142.5],
    ['#0000ff', 0.452, 0.3132, 264.05],
  ])('%s', (hex, L, C, H) => {
    const c = oklch(hexParaRgb(hex));
    expect(c.L).toBeCloseTo(L, 3);
    expect(c.C).toBeCloseTo(C, 3);
    expect(c.H).toBeCloseTo(H, 1);
  });
});
```

Run: `cd frontend && npx vitest run src/estilo/contraste.test.js`
Expected: PASS.

- [ ] **Step 6: Provar por mutação**

Trocar temporariamente em `tokens.css` `--color-tinta-3: #939fa8;` por `#7f8b94`. Rodar o teste.
Expected: FAIL em "tinta3 sobre elevado ≥ 4.5:1". Desfazer.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/estilo/cor.js frontend/src/estilo/contraste.test.js
git commit -m "E2.1: contraste dos tokens validado por teste, inclusive com marca alternativa"
```

---

### Task 3: Guarda do acento único

**Files:**
- Test: `frontend/src/estilo/acentoUnico.test.js`

**Interfaces:**
- Consumes: `cor.js` (Task 2).
- Produces: a constante `PENDENCIAS` (lista por arquivo) que cada tarefa da E2 que redesenha um arquivo **encolhe**; a E2.6 confere que os arquivos da mesa saíram.

Regra 5.2.4: varre `src/**/*.{css,js,jsx}` (fora `*.test.*`, `assets/`, `estilo/tokens.css` e `estilo/cor.js`) e falha se achar literal de cor na família do acento (OKLCH, matiz 25°–90°, croma > 0,08), `rgba(242,140,69…)` ou as classes `chat-orange`/`chat-copper` (`chat-orange-ink` é grafite e não conta). A lista de pendências **só encolhe**: um arquivo pendente que ficar limpo faz o teste falhar até sair da lista; um arquivo novo com violação faz falhar até ser corrigido. Isenção por **literal**, nunca por arquivo (o dossiê de 24/09 mostrou arquivos que misturam marca e cor de UI).

- [ ] **Step 1: Escrever o teste**

`frontend/src/estilo/acentoUnico.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { hexParaRgb, oklch } from './cor';

// A marca é UM token (spec 5.2.4). Esta guarda impede que o laranja volte a
// ser espalhado à mão. A lista de pendências começa com os arquivos ainda não
// migrados, só pode ENCOLHER e chega a zero na E7.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORA = [/\.test\.(js|jsx)$/, /^assets\//, /^estilo\/tokens\.css$/, /^estilo\/cor\.js$/];

// Isenção por literal: conteúdo e marca de terceiro, com o porquê.
const ISENCOES = [
  { arquivo: 'components/AgentAvatar.jsx', literal: '#d97a1f', porque: 'paleta de identidade por pessoa (conteúdo)' },
  { arquivo: 'components/MessageAttachment.jsx', literal: '#d93025', porque: 'cor do tipo de arquivo PDF (marca)' },
  { arquivo: 'components/MessageAttachment.jsx', literal: '#d24726', porque: 'cor do tipo de arquivo PPT/PPTX (marca)' },
  { arquivo: 'components/MessageAttachment.jsx', literal: '#ea4335', porque: 'pino do cartão de localização (conteúdo de mapa)' },
  { arquivo: 'pages/reports.css', literal: '#d67231', porque: 'paleta categórica validada, slot 1 (spec 5.2.3)' },
  { arquivo: 'pages/reports.css', literal: '#b9852a', porque: 'paleta categórica validada, slot 6 (spec 5.2.3)' },
];

export const PENDENCIAS = [
  'components/AppShell.jsx',
  'components/ChannelStatusBanner.jsx',
  'components/ContactAvatar.jsx',
  'components/ConversationListItem.jsx',
  'components/ConversationView.jsx',
  'components/MessageAttachment.jsx',
  'components/MessageInput.jsx',
  'components/PixCardMessage.jsx',
  'components/ReasonsAdminTab.jsx',
  'components/SendTemplateModal.jsx',
  'components/TeamModal.jsx',
  'components/TemplatesAdminTab.jsx',
  'components/TransferModal.jsx',
  'components/TransferNotice.jsx',
  'components/TriageAdminTab.jsx',
  'components/closeReasonCatalog.jsx',
  'components/messages/QuickReplyRow.jsx',
  'components/overlays.css',
  'components/recording-preview.css',
  'components/side-nav.css',
  'components/ui/Tabs.jsx',
  'index.css',
  'pages/AccessDeniedPage.jsx',
  'pages/DashboardPage.jsx',
  'pages/LoginPage.jsx',
  'pages/SupervisionPage.jsx',
  'pages/campaigns.css',
  'pages/dashboard.css',
  'pages/reports.css',
  'pages/settings/SettingsLayout.jsx',
  'pages/settings/automation/AiToolsPage.jsx',
  'pages/settings/automation/AiTriagePage.jsx',
  'pages/settings/channels/ChannelsTable.jsx',
  'pages/settings/channels/channels-polish.css',
  'pages/settings/integrations/IntegrationsLayout.jsx',
  'pages/settings/integrations/SgpQueryPage.jsx',
  'pages/settings/messages/CityNoticesPage.jsx',
  'pages/settings/messages/QuickRepliesPage.jsx',
  'pages/settings/messages/WelcomePage.jsx',
  'pages/settings/rules/AssignmentPage.jsx',
  'pages/settings/settings.css',
  'pages/settings/team/RolesPage.jsx',
  'pages/supervision.css',
];

const HEX = /(?<![&0-9A-Za-z#])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9A-Za-z-])/g;
const RGB = /rgba?\(\s*(\d{1,3})\s*[,\s_]\s*(\d{1,3})\s*[,\s_]\s*(\d{1,3})/g;
const CLASSE = /chat-(orange|copper)(?!-ink)/g;

function naFamilia(cor) {
  const { C, H } = oklch(cor);
  return C > 0.08 && H >= 25 && H <= 90;
}

function arquivos(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    if (!/\.(css|js|jsx)$/.test(nome)) return [];
    const rel = relative(SRC, caminho).replace(/\\/g, '/');
    return FORA.some((re) => re.test(rel)) ? [] : [rel];
  });
}

export function violacoes(rel, texto) {
  const achados = [];
  const isento = (literal) => ISENCOES.some((i) => i.arquivo === rel && i.literal.toLowerCase() === literal.toLowerCase());
  for (const m of texto.matchAll(HEX)) {
    // O alfa não conta: vale a matiz da cor-base (hexParaRgb separa o canal a).
    const literal = m[0];
    if (naFamilia(hexParaRgb(literal)) && !isento(literal)) achados.push(literal);
  }
  for (const m of texto.matchAll(RGB)) {
    const cor = { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255 };
    if (naFamilia(cor)) achados.push(m[0]);
  }
  for (const m of texto.matchAll(CLASSE)) achados.push(m[0]);
  return achados;
}

describe('acento único (spec 5.2.4)', () => {
  const porArquivo = Object.fromEntries(arquivos(SRC).map((rel) => [rel, violacoes(rel, readFileSync(join(SRC, rel), 'utf8'))]));

  test('nenhum arquivo fora da lista de pendências tem laranja à mão', () => {
    const novos = Object.entries(porArquivo)
      .filter(([rel, v]) => v.length > 0 && !PENDENCIAS.includes(rel))
      .map(([rel, v]) => `${rel}: ${v.slice(0, 3).join(', ')}`);
    expect(novos).toEqual([]);
  });

  test('a lista só encolhe: arquivo pendente que ficou limpo sai da lista', () => {
    const limpos = PENDENCIAS.filter((rel) => (porArquivo[rel] || []).length === 0);
    expect(limpos).toEqual([]);
  });

  test('a regra pega o acento e deixa passar o que não é da família', () => {
    expect(violacoes('x.css', 'color:#f28c45')).toEqual(['#f28c45']);
    expect(violacoes('x.jsx', 'shadow-[0_6px_16px_-8px_rgba(244,83,31,0.9)]')).toHaveLength(1);
    expect(violacoes('x.jsx', 'bg-chat-orange text-chat-orange-ink')).toEqual(['chat-orange']);
    expect(violacoes('x.css', 'color:#25d366;background:#ffffff;border:#1a73e8')).toEqual([]);
    expect(violacoes('x.jsx', 'href="#main" &#x2014;')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `cd frontend && npx vitest run src/estilo/acentoUnico.test.js`
Expected: PASS. A lista acima é a do dossiê de 24/09 (44 arquivos) **menos** `components/AgentAvatar.jsx`, que só tinha o literal isento. Se o teste disser que um arquivo é novo ou ficou limpo, é porque a base mudou desde o dossiê (a Task 1 tirou literais do `index.css`, mas ele continua com outros): ajustar a lista pelo que o teste disser e registrar a diferença no commit — nunca afrouxar a regra.

- [ ] **Step 3: Provar por mutação**

Acrescentar temporariamente `const x = '#e08a3c';` em `frontend/src/components/ui/Button.jsx`. Rodar.
Expected: FAIL em "nenhum arquivo fora da lista…" citando `components/ui/Button.jsx: #e08a3c`. Desfazer.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/estilo/acentoUnico.test.js
git commit -m "E2.1: guarda do acento unico com lista de pendencias que so encolhe"
```

---

### Task 4: Inter como fonte única de interface

**Files:**
- Test: `frontend/src/estilo/tipografia.test.js`
- Modify: `frontend/src/index.css:6-8` (apagar `--font-wa`), `frontend/src/components/ui/Dialog.jsx:283`, `frontend/src/components/ConversationView.jsx:561`, `frontend/src/components/MessageInput.jsx:390`, `frontend/src/components/SgpLookupPanel.jsx:289`, `frontend/src/components/ChannelStatusBanner.jsx:23`

Regra 5.4: a pilha "Segoe UI" (`--font-wa`) só existia no Windows e caía em Helvetica no Mac e no iPhone. O preflight do Tailwind já aplica `--font-sans` (Inter) à página; tirar `font-wa` devolve Inter a esses cinco lugares. O `ErrorBoundary.jsx:44` e o `index.html:35` ficam: são telas de pane que não dependem do CSS carregado.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/estilo/tipografia.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function arquivos(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(css|js|jsx)$/.test(nome) && !/\.test\./.test(nome) ? [caminho] : [];
  });
}

describe('tipografia (spec 5.4)', () => {
  test('ninguém usa a pilha Segoe UI (font-wa) — Inter é a fonte de interface', () => {
    const culpados = arquivos(SRC)
      .filter((c) => /\bfont-wa\b|--font-wa/.test(readFileSync(c, 'utf8')))
      .map((c) => relative(SRC, c).replace(/\\/g, '/'));
    expect(culpados).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/estilo/tipografia.test.js`
Expected: FAIL listando `components/ChannelStatusBanner.jsx`, `components/ConversationView.jsx`, `components/MessageInput.jsx`, `components/SgpLookupPanel.jsx`, `components/ui/Dialog.jsx`, `index.css`.

- [ ] **Step 3: Implementar**

1. `index.css`: apagar as linhas 6-8 (o comentário "Pilha tipográfica do WhatsApp Web…" e as duas linhas de `--font-wa`).
2. `components/ui/Dialog.jsx:283`: trocar `font-wa` por `font-sans` na classe do véu (se a E2.2 já tiver reescrito o `Dialog`, o `font-sans` já está lá).
3. Nos outros quatro arquivos, apagar a classe `font-wa` da string de classes (sem pôr outra: a fonte herdada é Inter).

- [ ] **Step 4: Rodar e ver passar; suíte e build**

Run: `cd frontend && npx vitest run src/estilo && npx vitest run && npx vite build`
Expected: PASS; build sem a classe `.font-wa` no CSS (`grep -c "font-wa" dist/assets/*.css` = 0).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/estilo/tipografia.test.js frontend/src/index.css frontend/src/components/ui/Dialog.jsx frontend/src/components/ConversationView.jsx frontend/src/components/MessageInput.jsx frontend/src/components/SgpLookupPanel.jsx frontend/src/components/ChannelStatusBanner.jsx
git commit -m "E2.1: Inter como fonte unica de interface (sai a pilha Segoe UI)"
```

---

### Task 5: Arquitetura — o login sem ícones nem diálogo

**Files:**
- Create: `frontend/src/navigation/rotas.js`
- Modify: `frontend/src/navigation/navItems.js:1-19` e os `icon:` de `SETTINGS_SECTIONS` (hoje `:31-95`)
- Modify: `frontend/src/App.jsx:12`, `frontend/src/components/ProtectedRoute.jsx:3`, `frontend/src/components/RotaLazy.jsx:2`, `frontend/src/pages/AccessDeniedPage.jsx:2`
- Test: `frontend/src/guardas/entradaSemIcones.test.js`
- Create: `ferramentas/medicao/pesos.mjs`

**Interfaces:**
- Produces: `navigation/rotas.js` → `hasLevel(agent, level)`, `SETTINGS_BASE`, `LEGACY_REDIRECTS` (mesmos valores de hoje). `navItems.js` continua exportando os três (reexportação), então os 14 importadores de Configurações não mudam.

Apêndice D.4: hoje o chunk de entrada (login, "Sem acesso") carrega 47 dos 48 ícones sem usar nenhum, por três importações — `App.jsx:12` e `ProtectedRoute.jsx:3` via `navItems.js`, e `AccessDeniedPage.jsx:2` via `WaIcons`. E o `RotaLazy.jsx:2` importa `AsyncState` do barril `./ui`, que reexporta o `Dialog` e leva `overlays.css` para o CSS do login (dossiê de casca, 24/09: `.dw-dialog` está no `index-*.css` do `dist`).

- [ ] **Step 0: Criar o script de pesos e medir o "antes"**

Criar `ferramentas/medicao/pesos.mjs` (fora de `frontend/`):

```js
// Soma o gzip-9 do JS e do CSS de cada caminho, pelo manifesto do Vite.
// Uso: node ferramentas/medicao/pesos.mjs frontend/dist
//   login = fecho estático da entrada; raiz ("/") = entrada + AppShell + DashboardPage.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve(process.argv[2] || 'frontend/dist');
const manifesto = JSON.parse(fs.readFileSync(path.join(DIST, '.vite/manifest.json'), 'utf8'));
const gz = (arquivo) => zlib.gzipSync(fs.readFileSync(path.join(DIST, arquivo)), { level: 9 }).length;

function fecho(chaves) {
  const vistos = new Set();
  const pilha = [...chaves];
  while (pilha.length) {
    const chave = pilha.pop();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    for (const i of manifesto[chave].imports || []) pilha.push(i);
  }
  return vistos;
}

function soma(chaves) {
  let js = 0;
  const folhas = new Set();
  for (const chave of fecho(chaves)) {
    js += gz(manifesto[chave].file);
    for (const c of manifesto[chave].css || []) folhas.add(c);
  }
  let css = 0;
  for (const c of folhas) css += gz(c);
  return { js, css };
}

const entrada = Object.keys(manifesto).find((k) => manifesto[k].isEntry);
const achar = (sufixo) => Object.keys(manifesto).find((k) => k.endsWith(sufixo));
console.log(JSON.stringify({
  login: soma([entrada]),
  raiz: soma([entrada, achar('components/AppShell.jsx'), achar('pages/DashboardPage.jsx')]),
}));
```

Run: `cd frontend && npx vite build --manifest && node ../ferramentas/medicao/pesos.mjs dist`
Expected: um JSON com `login` e `raiz`. **Anotar** os quatro números: são o "antes" desta tarefa e da Task 6.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/guardas/entradaSemIcones.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

// Guarda do Apêndice D.4: o grafo ESTÁTICO a partir de main.jsx (o chunk de
// entrada, que o login e a tela "Sem acesso" baixam) não pode alcançar
// módulo de ícones da casca/mesa, a navegação com ícones, nem o diálogo (e o
// overlays.css que ele importa). import() não conta: vira outro chunk.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROIBIDOS = [
  /^components\/icons\/(IconesTrabalho|IconesConfig|WaIcons|SgpIcons)\.jsx?$/,
  /^navigation\/navItems\.js$/,
  /^components\/ui\/Dialog\.jsx$/,
  /^components\/overlays\.css$/,
];

function resolverImport(de, especificador) {
  const base = resolve(dirname(de), especificador);
  const candidatos = [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'), join(base, 'index.jsx')];
  return candidatos.find((c) => existsSync(c) && statSync(c).isFile()) || null;
}

function grafoEstatico(inicio) {
  const vistos = new Set();
  const pilha = [inicio];
  while (pilha.length) {
    const arquivo = pilha.pop();
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    if (!/\.(js|jsx)$/.test(arquivo)) continue;
    const texto = readFileSync(arquivo, 'utf8');
    for (const m of texto.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm)) {
      const alvo = resolverImport(arquivo, m[1] || m[2]);
      if (alvo) pilha.push(alvo);
    }
  }
  return [...vistos].map((a) => relative(SRC, a).replace(/\\/g, '/'));
}

describe('chunk de entrada (login e "Sem acesso")', () => {
  test('não alcança ícones da casca, navegação com ícones nem o diálogo', () => {
    const grafo = grafoEstatico(join(SRC, 'main.jsx'));
    expect(grafo).toContain('pages/LoginPage.jsx');
    const proibidos = grafo.filter((rel) => PROIBIDOS.some((re) => re.test(rel)));
    expect(proibidos).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/guardas/entradaSemIcones.test.js`
Expected: FAIL listando `navigation/navItems.js`, `components/icons/WaIcons.jsx`, `components/ui/Dialog.jsx`, `components/overlays.css` (a ordem pode variar).

- [ ] **Step 3: Implementar**

Criar `frontend/src/navigation/rotas.js` movendo de `navItems.js`, **sem mudar nada**: a função `hasLevel` (hoje `navItems.js:6-17`, com o comentário das `:6-7`), `export const SETTINGS_BASE = '/configuracoes';` e a constante `LEGACY_REDIRECTS` (hoje `navItems.js:97-106`) com o helper `const s = (path) => \`${SETTINGS_BASE}/${path}\`;` de que ela depende. Nenhum import de ícone.

Em `navigation/navItems.js`:
- tirar as definições movidas e, no topo, `import { hasLevel, SETTINGS_BASE, LEGACY_REDIRECTS } from './rotas';` + `export { hasLevel, SETTINGS_BASE, LEGACY_REDIRECTS };`;
- em `SETTINGS_SECTIONS`, trocar o `icon:` de **cada um dos 8 grupos** por `icon: true` (o valor só é lido como booleano em `SettingsLayout.jsx:84,105`; o desenho vem de `SettingsIcon`). Sete usam ícones que só serviam a isso (`IconChannel, IconSpark, IconRules, IconQuickReply, IconPlug, IconTags, IconBuilding`), que saem do import; o oitavo, "Equipe e permissões", usa `IconTeam` — que continua importado porque o `NAV_ITEMS` ainda o usa para Supervisão até a Task 6. Fica o import dos 5 do `NAV_ITEMS`.

`App.jsx:12` → `import { LEGACY_REDIRECTS } from './navigation/rotas';`
`ProtectedRoute.jsx:3` → `import { hasLevel } from '../navigation/rotas';`
`RotaLazy.jsx:2` → `import { AsyncState } from './ui/AsyncState';`
`AccessDeniedPage.jsx:2` → `import { IconLock } from '../components/icons/IconesEntrada';` — **só depois da Task 6** (o módulo ainda não existe). Nesta tarefa, trocar provisoriamente para um ícone local: copiar o `IconLock` de `WaIcons.jsx` para dentro de `AccessDeniedPage.jsx` como função local; a Task 6 troca pelo import de `IconesEntrada` e apaga a cópia.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/guardas src/App.routes.test.jsx src/components/ProtectedRoute.test.jsx src/navigation src/pages/settings`
Expected: PASS (inclui "tem os cinco itens na ordem do menu" e os de acesso negado).

- [ ] **Step 5: Medir o "depois"**

Run: `cd frontend && npx vite build --manifest && node ../ferramentas/medicao/pesos.mjs dist`
Expected, contra o Step 0: `login.js` cai ~4,6 KB (aceitar −4.400 a −4.900 B) e `login.css` cai ~4,9 KB (sai o `overlays.css`); `raiz.js` sobe até ~0,6 KB (a casca ainda importa `WaIcons` inteiro até a Task 6). Prova de 24/09 numa cópia descartável, gzip-9: login JS 87.605 → 82.978, login CSS 22.076 → 17.126, "/" JS 159.501 → 160.104. Se o login cair menos de 4.400 B, há outro caminho puxando ícones: rodar o teste da guarda com um `console.log(grafo)` e achar quem.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/navigation/rotas.js frontend/src/navigation/navItems.js frontend/src/App.jsx frontend/src/components/ProtectedRoute.jsx frontend/src/components/RotaLazy.jsx frontend/src/pages/AccessDeniedPage.jsx frontend/src/guardas/entradaSemIcones.test.js ferramentas/medicao/pesos.mjs
git commit -m "E2.1: login sem icones nem dialogo no chunk de entrada (login -N B gzip)"
```

(trocar `N` pelo número medido; pôr os quatro números antes/depois no corpo da mensagem.)

---

### Task 6: Ícones Tabler

**Files:**
- Create: `frontend/src/components/icons/IconesEntrada.js`, `IconesTrabalho.js`, `IconesConfig.js`, `LICENSE-Tabler.txt`, `README.md` (cópia de `docs/superpowers/specs/2026-09-24-redesenho-apendice-D-anexos/entrega-tabler/`)
- Create: `frontend/src/assets/brands/pix.svg`
- Create: `ferramentas/icones/migrar-imports.mjs`, `ferramentas/icones/gerador/` (cópia de `…/apendice-D-anexos/gerador/`, com `SP` configurável)
- Modify: os arquivos que importam `icons/WaIcons` ou `icons/SgpIcons` (36 de produção + `pages/settings/channels/ChannelsTable.test.jsx`)
- Modify: `frontend/src/components/icons/WaIcons.jsx` (fica só `IconEmptyChat`)
- Delete: `frontend/src/components/icons/SgpIcons.jsx`
- Modify: `frontend/src/navigation/navItems.js` (Supervisão com `IconSupervision`), `frontend/src/pages/AccessDeniedPage.jsx` (import de `IconesEntrada`)

**Interfaces:**
- Produces: os três módulos, com os nomes de export da tabela D.9 do Apêndice D.

- [ ] **Step 1: Copiar a entrega conferindo os bytes**

Run: `cd docs/superpowers/specs/2026-09-24-redesenho-apendice-D-anexos/entrega-tabler && sha256sum -c SHA256SUMS`
Expected: `OK` nos cinco arquivos. Se algum falhar, PARAR: a entrega foi alterada depois da conferência de 24/09.

Copiar `IconesEntrada.js`, `IconesTrabalho.js`, `IconesConfig.js` e `LICENSE-Tabler.txt` para `frontend/src/components/icons/`, e `pix.svg` para `frontend/src/assets/brands/pix.svg`. Criar `frontend/src/components/icons/README.md`:

```markdown
# Ícones

`IconesEntrada.js` (só o cadeado da tela "Sem acesso"), `IconesTrabalho.js` (casca e mesa: tudo que
"/" baixa) e `IconesConfig.js` (só Configurações, lazy) são **gerados** a partir do `@tabler/icons`
3.48.0, contorno de traço 2 — Apêndice D do redesenho (`docs/superpowers/specs/2026-09-24-redesenho-apendice-D-iconografia.md`).
Não se editam à mão: o gerador e a verificação de pixels estão em `ferramentas/icones/gerador/`.
Licença: `LICENSE-Tabler.txt` (MIT). O Pix é a marca oficial da Simple Icons 16.0.0 (CC0), a única
exceção preenchida, como toda marca de terceiro.

Estado ativo não usa ícone preenchido: é barra de 3 px + fundo selecionado (decisão do proprietário,
24/09/2026).

`WaIcons.jsx` guarda só a ilustração `IconEmptyChat` até a mesa vazia ser redesenhada (E2.3).
```

Acrescentar ao README de marcas (`frontend/src/assets/brands/README.md`, ou criar se não existir) a linha: `pix.svg — marca Pix, Simple Icons 16.0.0 (CC0). Monocromática em currentColor; se o manual da marca do Banco Central exigir a cor oficial, usar fill="#32BCAD".`

- [ ] **Step 2: Escrever o codemod**

`ferramentas/icones/migrar-imports.mjs`:

```js
// Troca os imports de icons/WaIcons e icons/SgpIcons pelos módulos Tabler
// (Apêndice D.9). Uso, da raiz do repositório: node ferramentas/icones/migrar-imports.mjs
// Falha, sem gravar nada, se um nome importado não tiver dono num dos três
// módulos. Mantém o nome local (alias) quando o export novo tem outro nome:
// o JSX não muda nesta tarefa.
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('frontend/src');
const ICONES = path.join(SRC, 'components/icons');
const MODULOS = ['IconesEntrada', 'IconesTrabalho', 'IconesConfig'];

const dono = {};
for (const modulo of MODULOS) {
  const texto = fs.readFileSync(path.join(ICONES, `${modulo}.js`), 'utf8');
  for (const m of texto.matchAll(/export (?:const|function) (\w+)/g)) dono[m[1]] ??= modulo;
}
dono.IconLock = 'IconesEntrada';

// Mesmo nome antigo, mesmo novo em todo arquivo.
const RENOMEAR = { IconTags: 'IconTag' };
// O desenho antigo tinha mais de um significado; o novo depende do arquivo (D.9).
const RENOMEAR_NO_ARQUIVO = {
  'components/SideNav.jsx': { IconCheckCircle: 'IconArchive' },
  'components/TemplatesAdminTab.jsx': { IconMore: 'IconMoreVertical', IconFile: 'IconFileText' },
  'pages/settings/SettingsVisuals.jsx': { IconFile: 'IconFileText' },
  'pages/settings/integrations/SgpQueryPage.jsx': { IconFile: 'IconDocument' },
};
// Ilustração, não ícone: fica no módulo antigo até a mesa vazia mudar (E2.3).
const FICA = new Set(['IconEmptyChat']);

const IMPORT = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*icons\/)(WaIcons|SgpIcons)\2;?/g;

function arquivos(pasta) {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(pasta, e.name);
    if (e.isDirectory()) return p === ICONES ? [] : arquivos(p);
    return /\.(js|jsx)$/.test(e.name) ? [p] : [];
  });
}

const mudancas = [];
for (const arquivo of arquivos(SRC)) {
  const rel = path.relative(SRC, arquivo).replace(/\\/g, '/');
  const texto = fs.readFileSync(arquivo, 'utf8');
  const novo = texto.replace(IMPORT, (_, lista, aspas, prefixo, antigo) => {
    const porModulo = {};
    for (const item of lista.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [original, alias] = item.split(/\s+as\s+/).map((x) => x.trim());
      const local = alias || original;
      if (FICA.has(original)) { (porModulo[antigo] ||= []).push(item); continue; }
      const alvo = (RENOMEAR_NO_ARQUIVO[rel] || {})[original] || RENOMEAR[original] || original;
      const modulo = dono[alvo];
      if (!modulo) throw new Error(`${rel}: ${original} → ${alvo} não existe em nenhum módulo`);
      (porModulo[modulo] ||= []).push(alvo === local ? alvo : `${alvo} as ${local}`);
    }
    return Object.entries(porModulo)
      .map(([modulo, nomes]) => `import { ${nomes.join(', ')} } from ${aspas}${prefixo}${modulo}${aspas};`)
      .join('\n');
  });
  if (novo !== texto) mudancas.push([arquivo, novo, rel]);
}
for (const [arquivo, novo] of mudancas) fs.writeFileSync(arquivo, novo);
console.log(`${mudancas.length} arquivos:\n${mudancas.map(([, , rel]) => `  ${rel}`).join('\n')}`);
```

- [ ] **Step 3: Rodar o codemod**

Run: `node ferramentas/icones/migrar-imports.mjs`
Expected: `36 arquivos` (35 de produção + `pages/settings/channels/ChannelsTable.test.jsx`; o `AccessDeniedPage` já saiu na Task 5) e a lista. Se falhar com "não existe em nenhum módulo", o nome falta na tabela D.9: PARAR e comparar com `docs/…/apendice-D-anexos/entrega-tabler/mapeamento-tabler.md`. (Provado numa cópia descartável em 24/09: 36 arquivos, nenhum nome sem dono.)

- [ ] **Step 4: Trocas que o codemod não faz**

- `navigation/navItems.js`: no item `supervisao` de `NAV_ITEMS`, `icon: IconTeam` → `icon: IconSupervision`; no import (que o codemod já apontou para `IconesTrabalho`), trocar `IconTeam` por `IconSupervision` — depois da Task 5 o grupo "Equipe e permissões" é `icon: true`, e `IconTeam` não é mais usado ali.
- `pages/AccessDeniedPage.jsx`: apagar a cópia local do `IconLock` (Task 5) e importar `import { IconLock } from '../components/icons/IconesEntrada';`.
- `components/icons/WaIcons.jsx`: apagar todos os exports menos `IconEmptyChat` (e o helper que ele usar). Conferir que ninguém importa outra coisa dele:

Run: `cd frontend && grep -rn "icons/WaIcons'" src | grep -v "IconEmptyChat }"`
Expected: nada.

- Apagar `components/icons/SgpIcons.jsx` e conferir:

Run: `cd frontend && grep -rn "SgpIcons" src`
Expected: nada.

- Levar o gerador para o repositório: copiar `docs/superpowers/specs/2026-09-24-redesenho-apendice-D-anexos/gerador/*` para `ferramentas/icones/gerador/`, e em `ferramentas/icones/gerador/familias.mjs` trocar a linha `export const SP = 'C:/Users/…/scratchpad/icones/';` por `export const SP = (process.env.ICONES_TRABALHO || path.resolve('ferramentas/icones/.trabalho')).replace(/\\/g, '/') + '/';` (com `import path from 'node:path';` no topo). Acrescentar `ferramentas/icones/.trabalho/` ao `.gitignore` da raiz.

- [ ] **Step 5: Suíte, guardas e build**

Run: `cd frontend && npx vitest run && npx vite build --manifest && node ../ferramentas/medicao/pesos.mjs dist`
Expected: suíte verde (inclui `guardas/entradaSemIcones` — `AccessDeniedPage` agora importa `IconesEntrada`, que não é proibido); build sem import quebrado. Pesos contra o Step 0 da Task 5 (prova de 24/09 numa cópia descartável, em bytes gzip-9: antes login 87.605 / "/" 159.501; depois login 83.128 / "/" 159.023): `login.js` cai 4,4–4,7 KB e `raiz.js` cai 0,3–0,6 KB. O restante do ganho de "/" do Apêndice D.2 (−879 B no total) vem da troca dos SVGs soltos, glifos e emojis da mesa, que acontece nas tarefas que redesenham cada componente (E2.3–E2.5). Anotar os números no commit.

Se o `App.routes.test.jsx` estourar o tempo só na suíte cheia (5 s no "/admin/dashboard redireciona…"), rodar o arquivo sozinho: na prova de 24/09 ele estourou uma vez com 30 arquivos em paralelo e passou 3 de 3 sozinho. Intermitência de máquina, não efeito da tarefa — registrar e seguir.

- [ ] **Step 6: Conferir o desenho no navegador**

Com `npx vite preview`, abrir `/login` e uma rota de Configurações (com a API simulada do harness da E0) e tirar print: os ícones aparecem, todos em contorno, nenhum quadrado vazio. O print vai para `output/uxui/e2/e2-1-icones-configuracoes.png`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/icons frontend/src/assets/brands frontend/src/navigation/navItems.js frontend/src/pages/AccessDeniedPage.jsx ferramentas/icones .gitignore
git add -u frontend/src
git commit -m "E2.1: icones Tabler em tres modulos por camada; sai o SgpIcons e o desenho do WaIcons"
```

---

### Task 7: Estados de interação do botão e o registro da E2

**Files:**
- Modify: `frontend/src/components/ui/Button.jsx:3-21`
- Test: `frontend/src/components/ui/ui.test.jsx`
- Create: `docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md`

Regra 5.7/P9: hover, **pressionado** (hoje não existe em lugar nenhum), foco e desabilitado com estado visível. Variantes passam aos tokens; o `size` (dívida R7) não muda.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao `describe('ui primitives', …)` de `frontend/src/components/ui/ui.test.jsx`:

```jsx
  test('Button tem estado pressionado, que desliga com movimento reduzido', () => {
    render(<Button>Salvar</Button>);
    const classes = screen.getByRole('button', { name: 'Salvar' }).className;
    expect(classes).toMatch(/\bactive:translate-y-px\b/);
    expect(classes).toMatch(/\bmotion-reduce:active:translate-y-0\b/);
    expect(classes).toMatch(/\bmotion-reduce:transition-none\b/);
  });

  test('variantes usam os tokens do tema (sem wa-*)', () => {
    render(
      <>
        <Button variant="secondary">A</Button>
        <Button variant="danger">B</Button>
        <Button variant="ghost">C</Button>
      </>
    );
    for (const nome of ['A', 'B', 'C']) expect(screen.getByRole('button', { name: nome }).className).not.toMatch(/\bwa-/);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/ui.test.jsx`
Expected: FAIL nos dois novos.

- [ ] **Step 3: Implementar**

Em `frontend/src/components/ui/Button.jsx`, trocar `BASE` e `VARIANTS` (linhas 3-4 e 16-21):

```js
const BASE =
  'inline-flex items-center justify-center font-medium transition duration-120 active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0';
```

```js
const VARIANTS = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'border border-linha bg-campo text-tinta hover:bg-hover',
  danger: 'border border-perigo/40 bg-perigo-fundo text-perigo hover:brightness-110',
  ghost: 'text-tinta-2 hover:bg-hover hover:text-tinta',
};
```

(`SIZES` fica como está — dívida R7.)

- [ ] **Step 4: Rodar e ver passar; suíte**

Run: `cd frontend && npx vitest run src/components/ui && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Criar o registro da E2**

`docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md`:

```markdown
# Registro de mudanças da E2 — estrutural × cosmético

> Spec 12.3. Uma linha por mudança visível: elemento, antes, depois, classe **S** (posição, tamanho,
> quantidade ou existência) ou **C** (cor, superfície, raio, sombra). S > C é condição de aprovação.
> Cada subplano acrescenta a sua seção; o total fecha na E2.6.

## E2.1 — fundação

| Elemento | Antes | Depois | Classe |
|---|---|---|---|
| Ícones do produto | 6 espessuras de traço, preenchidos, 5 desenhos para "fechar" | uma família (Tabler, contorno 2), um desenho por significado | C |
| Ícones no login | 47 carregados, 0 usados | só o cadeado da "Sem acesso" | S |
| Fonte de conversa, compositor, SGP e diálogos | Segoe UI (Helvetica no Mac/iPhone) | Inter | C |
| Botão pressionado | sem estado | desce 1 px (desliga com movimento reduzido) | S |
| Cores do botão | tokens `wa-*` | tokens do tema grafite | C |

Total E2.1: 2 S × 3 C (a fundação é pele por definição; a estrutura vem nas áreas — Apêndice E.5).
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/Button.jsx frontend/src/components/ui/ui.test.jsx docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md
git commit -m "E2.1: botao com estado pressionado e variantes em tokens; abre o registro da E2"
```
