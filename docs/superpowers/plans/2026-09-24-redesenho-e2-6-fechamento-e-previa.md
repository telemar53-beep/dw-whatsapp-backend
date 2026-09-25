# E2.6 — Fechamento da E2 e prévia para o proprietário — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provar a E2 inteira com o harness e com o inventário — contrato dos ganchos, um `role="status"` por tela, rodada de marca alternativa, orçamentos, registro S × C, conferência de cada estado que a E2 possui — e entregar a mesa ao proprietário numa prévia publicada no Render, sem mexer na produção dos atendentes.

**Architecture:** Nada de runtime novo. Mudam: `ferramentas/medicao/` (ganchos que a E2 quebrou, um diagnóstico de papéis, a etapa `marca`), `ferramentas/inventario/` (um conferidor de etapa), o registro da E2 e uma planilha de conferência. A prévia é um site estático separado no Render, construído da branch `redesenho/e2-mesa`, apontando para a API de produção — criado pelo proprietário, com o roteiro da Task 6.

**Tech Stack:** Node 22 (harness por CDP, sem pacote npm), Chrome, Render.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (2, 5.2.4, 9, 11, 12), Apêndice A (inventário), `ferramentas/medicao/README.md`. Plano mestre: `docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md`.

## Global Constraints

- **Regras do pacote do harness** (decisão do proprietário): tempo só com a máquina ociosa (o `medir` recusa acima de 15% de CPU) e mediana de pelo menos 3 rodadas; o `comparar` só compara tempo entre rodadas que cumpriram as duas; o pacote mora fora de `frontend/`.
- **Contrato do harness** (`ferramentas/medicao/README.md`): mudar nome acessível usado por gancho exige mudar o gancho no mesmo commit.
- **Backend intocado.** A prévia é configuração no painel do Render (criar o site; acrescentar uma origem a `FRONTEND_ORIGIN`, que já aceita lista separada por vírgula — `src/config/cors-origins.js`, usada pelo CORS e pelo socket). Os dois passos são do proprietário, autorizados na hora.
- **Nada é publicado em produção nesta etapa.** O merge da E2 na `main` só acontece depois do "ok" do proprietário na prévia.

## Review Focus

- **Gancho que passa a achar outra coisa.** Um gancho alterado que continua "achando" algo, mas o elemento errado, mede outra coisa em silêncio. Cada gancho novo tem a prova de que acha o alvo certo no build da E2 (Task 1) — não só "não deu tempo esgotado".
- **Marca alternativa com isenção larga demais.** Isentar demais esconde laranja de verdade. As únicas isenções são as do teste estático (`acentoUnico.test.js`): a paleta de identidade do `AgentAvatar` e as cores semânticas de aviso e perigo, lidas do próprio build (Task 2).
- **Conferência do inventário preenchida sem olhar o código.** Uma linha "resolvido" sem arquivo que exista, ou com arquivo que não tem nada a ver, passa por um conferidor ingênuo. O conferidor exige arquivo existente, e a revisão por amostragem fica registrada (Task 4).
- **Prévia falando com a produção.** O que o proprietário fizer na prévia acontece de verdade (mensagem vai ao cliente). O roteiro diz isso antes de ele entrar (Task 6).
- **Orçamento que falha.** Se um orçamento da E2 não fecha, a E2 não vai à prévia: a Task 3 diz onde procurar e para.

---

### Task 1: Contrato do harness — ganchos que a E2 mudou e um `role="status"` por tela

**Files:**
- Modify: `ferramentas/medicao/lib/ganchos.mjs`, `ferramentas/medicao/lib/coleta-dom.mjs:55-58`
- Create: `ferramentas/medicao/diagnostico/papeis.mjs`
- Modify: `ferramentas/medicao/README.md`

Três ganchos quebram com a E2 e nenhum subplano os trocou (a E2.3, Task 10, trocou só os seletores da linha):

| Gancho | Hoje procura | Na E2 |
|---|---|---|
| `naoLida` (`exprNaoLidas`) | `[aria-label="Mensagem não lida"]` no `li` | a E2.3 (Task 5) marca com `title="Mensagem não lida"` (ponto `aria-hidden` ou `sr-only`) |
| `exprIndicadorReconectando` | `[role=status]` com "Reconectando" no `aria-label` | o indicador do trilho fica **sem** `role="status"` (E2.3, Task 2), com `aria-label` "Reconectando. As mensagens novas…" |
| `exprFaixaReconectando` | `[role=status]` com o texto "Reconectando… as mensagens" | a frase vai para a região viva da casca (`[data-regiao-viva]`, `aria-live` sem `role`) e, no celular, para a `FaixaDeAviso` (sem `role`) |

- [ ] **Step 1: Trocar os três ganchos**

Em `ferramentas/medicao/lib/ganchos.mjs`:

```js
// Marca de não lida: pelo title (a E2 tirou o aria-label — o nome acessível do
// item já diz "não lida" por texto sr-only).
export const exprNaoLidas = `[...document.querySelectorAll('[role=tabpanel] li')]
  .filter((li) => li.querySelector('[title=${J(NOMES.naoLida)}]'))`;
```

(mantendo o resto da expressão de hoje — o `.map` do nome de cada item — como está.)

```js
// Indicador de reconexão no trilho: SEM role="status" desde a E2 (um só status
// por tela, spec 9). Acha pelo nome acessível, qualquer papel.
export const exprIndicadorReconectando = `[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute('aria-label').includes(${J(TEXTOS.reconectando)}))`;
// A frase da queda: na região viva da casca (aria-live, sem role) e, no
// celular, na faixa de aviso. Qualquer um dos dois vale.
export const exprFaixaReconectando = `[...document.querySelectorAll('[data-regiao-viva], [aria-live]')].some((e) => e.textContent.includes(${J(TEXTOS.faixaReconectando)})) || document.body.innerText.includes(${J(TEXTOS.faixaReconectando)})`;
```

(`exprNaoLidas` inteiro, com o `.map` de hoje:)

```js
export const exprNaoLidas = `[...document.querySelectorAll('[role=tabpanel] li')]
  .filter((li) => li.querySelector('[title=${J(NOMES.naoLida)}]'))
  .map((li) => { const t = li.querySelector('[title]'); return (t && t.getAttribute('title')) || li.textContent.trim().slice(0, 40); })`;
```

E os comentários de `NOMES.naoLida`, `TEXTOS.reconectando` e `TEXTOS.faixaReconectando` passam a dizer onde cada um mora depois da E2.

**Artefatos do socket bloqueado.** `ARTEFATOS` (`ganchos.mjs:69`) diz à coleta de estilos o que só existe porque o socket está bloqueado, para ficar fora de M2/M3/M5 — e hoje só sabe achar por papel (`coleta-dom.mjs:55-58`, que só percorre elementos `[role=…]`). Sem o `role="status"`, o indicador do trilho entraria nas métricas da mesa. A coleta passa a aceitar um seletor:

```js
  for (const a of artefatos) {
    for (const e of document.querySelectorAll(a.sel || `[role=${a.role}]`)) {
      if (((e.getAttribute('aria-label') || '') + ' ' + e.textContent).includes(a.texto)) raizesArtefato.push(e);
    }
  }
```

e `ARTEFATOS` passa a:

```js
// Elementos que só existem porque o socket.io está bloqueado por instrução: o
// indicador do trilho (pelo aria-label, sem role desde a E2) e a frase da queda
// na região viva da casca.
export const ARTEFATOS = [
  { sel: '[aria-label]', texto: TEXTOS.reconectando },
  { sel: '[data-regiao-viva]', texto: TEXTOS.faixaReconectando },
];
```

(`[aria-label]` com "Reconectando" acha só o indicador: nenhum outro controle da mesa tem a palavra no nome.)

- [ ] **Step 2: Provar que cada gancho acha o alvo CERTO**

Build da E2 e o smoke:

Run: `cd frontend && npx vite build --outDir ../ferramentas/medicao/resultados/e2/dist --emptyOutDir --manifest && cd .. && MSYS_NO_PATHCONV=1 MEDICAO_DIST=ferramentas/medicao/resultados/e2/dist node ferramentas/medicao/diagnostico/smoke.mjs atendente /`
Expected: "itens na lista" > 0; nenhum pedido não atendido novo.

E, no mesmo build, a conferência de alvo — um script avulso de uma vez só, em `ferramentas/medicao/resultados/e2/alvos.mjs` (fora do Git, `resultados/` é ignorado):

```js
import * as H from '../../lib/harness.mjs';
import * as G from '../../lib/ganchos.mjs';

const srv = await H.subirServidores();
const ctx = await H.abrirSessao({ nome: 'alvos', servidor: srv.h2, perfil: 'atendente' });
try {
  const { page } = ctx;
  await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
  await H.esperarLista(page);
  // Com o socket bloqueado, o trilho mostra a reconexão: o gancho tem de achar
  // o INDICADOR (um botão/elemento do menu), não outra coisa com a palavra.
  const indicador = await page.eval(`(() => { const e = [...document.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label').includes(${JSON.stringify(G.TEXTOS.reconectando)})); return e ? { tag: e.tagName, dentroDoMenu: Boolean(e.closest('nav')) } : null; })()`);
  console.log('indicador', indicador);
  console.log('faixa', await page.eval(G.exprFaixaReconectando));
  console.log('esqueleto some', await page.eval(`!${G.exprCarregando}`));
} finally {
  await ctx.close();
  await srv.close();
}
```

Run: `MSYS_NO_PATHCONV=1 MEDICAO_DIST=ferramentas/medicao/resultados/e2/dist node ferramentas/medicao/resultados/e2/alvos.mjs`
Expected: `indicador { tag: …, dentroDoMenu: true }`; `faixa true`; `esqueleto some true`. As não lidas se provam no `suplementar` (socket emulado), na Task 3: ele tem de achar pelo menos uma.

- [ ] **Step 3: Um `role="status"` por tela (spec 9, armadilha 8)**

`ferramentas/medicao/diagnostico/papeis.mjs`:

```js
// Conta role="status" por tela (spec 9: um só por tela; aria-live ≠ status).
// Sai 1 se alguma tela tiver mais de um VISÍVEL ou acessível.
//   MEDICAO_DIST=<build> node ferramentas/medicao/diagnostico/papeis.mjs
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';

const CONTAR = `[...document.querySelectorAll('[role=status]')].filter((e) => !e.closest('[aria-hidden=true],[inert]')).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60))`;

const srv = await H.subirServidores();
const ctx = await H.abrirSessao({ nome: 'papeis', servidor: srv.h2, perfil: 'atendente' });
let falhou = false;
async function registrar(page, tela) {
  await H.esperarEstavel(page);
  const achados = await page.eval(CONTAR);
  const ok = achados.length <= 1;
  if (!ok) falhou = true;
  console.log(`${ok ? 'ok ' : 'FALHA'} ${tela}: ${achados.length} ${JSON.stringify(achados)}`);
}
try {
  const { page } = ctx;
  await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
  await H.esperarLista(page);
  await H.esperarFaixaDeConexaoSumir(page);
  await registrar(page, 'mesa vazia');
  await H.abrirConversa(page, G.CONVERSAS.A);
  await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
  await registrar(page, 'conversa A com SGP');
  await H.clicar(page, H.elBotao(G.NOMES.dadosDoCliente));
  await registrar(page, 'conversa A com o painel Cliente');
  await H.abrirConversa(page, G.CONVERSAS.B);
  await registrar(page, 'conversa B');
} finally {
  await ctx.close();
  await srv.close();
}
process.exit(falhou ? 1 : 0);
```

Run: `MSYS_NO_PATHCONV=1 MEDICAO_DIST=ferramentas/medicao/resultados/e2/dist node ferramentas/medicao/diagnostico/papeis.mjs`
Expected: 4 linhas `ok`, cada uma com 0 ou 1. (Com o socket bloqueado, a queda **não** pode aparecer como `role="status"` — a E2.3 a tirou dali.)

- [ ] **Step 4: Rolagem e redimensionar (a linha do tempo mudou na E2.4)**

Run: `MSYS_NO_PATHCONV=1 MEDICAO_DIST=ferramentas/medicao/resultados/e2/dist node ferramentas/medicao/diagnostico/rolagem-anteriores.mjs && MSYS_NO_PATHCONV=1 MEDICAO_DIST=ferramentas/medicao/resultados/e2/dist node ferramentas/medicao/diagnostico/rolagem-redimensionar.mjs`
Expected: os dois saem 0 — a mensagem do topo fica no lugar (±4 px) com e sem ancoragem nativa, e a âncora sobrevive a 1100/1800/1366 px (os resultados da E1.1, tabela do README).

- [ ] **Step 5: README e commit**

No `README.md` do harness: a lista do contrato ganha "indicador de reconexão pelo `aria-label` (sem `role`)", "frase da queda na região viva `[data-regiao-viva]`", "não lida pelo `title`", e a seção de uso ganha o `papeis.mjs`.

```bash
git add ferramentas/medicao/lib/ganchos.mjs ferramentas/medicao/lib/coleta-dom.mjs ferramentas/medicao/diagnostico/papeis.mjs ferramentas/medicao/README.md
git commit -m "E2.6: ganchos do harness que a E2 mudou e diagnostico de um role=status por tela"
```

---

### Task 2: Rodada de marca alternativa (spec 5.2.4)

**Files:**
- Create: `ferramentas/medicao/etapas/marca.mjs`
- Modify: `ferramentas/medicao/medir.mjs` (a etapa entra na lista `ETAPAS`, antes de `resumir`)
- Modify: `ferramentas/medicao/README.md`

Aceite do spec: com `--color-accent` trocado por azul `#1a73e8`, amarelo `#f5c518` e marinho `#1f3a5f`, **nenhuma cor na família laranja** fora de imagens de conteúdo e marcas de terceiros, e `on-accent` sobre o acento ≥ 4,5:1 nos três. Mede-se sobre a mesma coleta de estilos do M3 (cor declarada de `color`, fundo, borda, `fill`/`stroke`, pseudo-elementos) — imagem de conteúdo não entra nessa coleta. A régua é a do teste estático: matiz OKLCH 25°–90°, croma > 0,08. Isenções — as mesmas do `acentoUnico.test.js` — : a paleta de identidade do `AgentAvatar` (`#d97a1f`, categórica) e as cores semânticas de aviso e perigo, **lidas do próprio build** (`--color-aviso`, `--color-aviso-fundo`, `--color-perigo`, `--color-perigo-fundo`), que caem na régua e não são acento.

- [ ] **Step 1: A etapa**

`ferramentas/medicao/etapas/marca.mjs`:

```js
// Rodada de marca alternativa (spec 5.2.4): troca --color-accent e procura a
// cor da marca antiga que sobrou. Sai 1 se sobrar laranja ou se on-accent
// ficar abaixo de 4,5:1.
//   node etapas/marca.mjs   (com MEDICAO_DIST e MEDICAO_SAIDA, como as outras)
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { coletarEstilos, comoExpressao } from '../lib/coleta-dom.mjs';
import { analisarCores } from '../lib/analise.mjs';
import { lerCor, hex, contraste } from '../lib/cores.mjs';

const MARCAS = ['#1a73e8', '#f5c518', '#1f3a5f'];
const REGUA = { de: 25, ate: 90, croma: 0.08 };
// Paleta de identidade do AgentAvatar (categórica, isenta no acentoUnico.test.js).
const ISENTAS_FIXAS = ['#d97a1f'];

H.garantirPasta(path.join(H.RES, 'marca'));

const trocarAcento = (cor) => `(() => {
  const s = document.createElement('style');
  s.dataset.marca = '';
  s.textContent = ':root{--color-accent:${cor} !important}';
  document.head.appendChild(s);
  return true;
})()`;

// Valor COMPUTADO de cada token (uma custom property sem registro devolve o
// texto com var(); pintar numa sonda devolve a cor resolvida).
const SONDAS = `(() => {
  const p = document.createElement('span');
  p.style.cssText = 'position:absolute;left:-9999px';
  document.body.appendChild(p);
  const ler = (token, prop) => { p.style[prop] = 'var(' + token + ')'; const c = getComputedStyle(p)[prop]; p.style[prop] = ''; return c; };
  const r = {
    accent: ler('--color-accent', 'backgroundColor'),
    onAccent: ler('--color-on-accent', 'color'),
    aviso: ler('--color-aviso', 'color'),
    avisoFundo: ler('--color-aviso-fundo', 'backgroundColor'),
    perigo: ler('--color-perigo', 'color'),
    perigoFundo: ler('--color-perigo-fundo', 'backgroundColor'),
  };
  p.remove();
  return r;
})()`;

function naRegua(o) {
  return o && o.C > REGUA.croma && o.H >= REGUA.de && o.H <= REGUA.ate;
}

async function sobrasDaTela(page, isentas) {
  const coleta = await page.eval(comoExpressao(coletarEstilos, { artefatos: G.ARTEFATOS }));
  const cores = analisarCores(coleta, { semArtefatos: true });
  const sobras = [];
  for (const familia of Object.values(cores.familias)) {
    for (const v of familia.valores) {
      if (!naRegua(v.oklch)) continue;
      if (isentas.has(v.hex.toLowerCase())) continue;
      sobras.push({ hex: v.hex, oklch: v.oklch, n: v.n, props: v.props });
    }
    // Onde a cor aparece (até 8 exemplos por família): ajuda a achar a origem.
    for (const e of familia.exemplos) {
      if (e.cores.some((c) => sobras.some((s) => c.includes(s.hex)))) sobras.push({ elemento: e.elemento, cores: e.cores });
    }
  }
  return sobras;
}

const srv = await H.subirServidores();
const resultado = {};
let falhou = false;
try {
  for (const marca of MARCAS) {
    const ctx = await H.abrirSessao({ nome: `marca-${marca.slice(1)}`, servidor: srv.h2, perfil: 'atendente' });
    try {
      const { page } = ctx;
      await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
      await H.esperarLista(page);
      await page.eval(trocarAcento(marca));
      await H.esperarFaixaDeConexaoSumir(page);
      await H.esperarEstavel(page);
      const tokens = await page.eval(SONDAS);
      const isentas = new Set([...ISENTAS_FIXAS, ...[tokens.aviso, tokens.avisoFundo, tokens.perigo, tokens.perigoFundo].map((c) => { const l = lerCor(c); return l ? hex(l).toLowerCase() : null; }).filter(Boolean)]);
      const razao = contraste(lerCor(tokens.onAccent), lerCor(tokens.accent));
      const telas = {};
      telas.lista = await sobrasDaTela(page, isentas);
      await page.screenshot(path.join(H.RES, 'marca', `${marca.slice(1)}-lista.png`));
      await H.abrirConversa(page, G.CONVERSAS.A);
      await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
      await H.esperarEstavel(page);
      telas.conversaComSgp = await sobrasDaTela(page, isentas);
      await page.screenshot(path.join(H.RES, 'marca', `${marca.slice(1)}-conversa.png`));
      await H.clicar(page, H.elBotao(G.NOMES.dadosDoCliente));
      await H.esperarEstavel(page);
      telas.painelCliente = await sobrasDaTela(page, isentas);
      const sobrou = Object.values(telas).some((s) => s.length > 0);
      const ok = !sobrou && razao >= 4.5;
      if (!ok) falhou = true;
      resultado[marca] = { ok, onAccentSobreAcento: +razao.toFixed(2), tokens, telas };
      console.log(`${ok ? 'ok ' : 'FALHA'} ${marca}: on-accent ${razao.toFixed(2)}:1 | sobras ${Object.entries(telas).map(([t, s]) => `${t} ${s.length}`).join(', ')}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await srv.close();
}
H.salvarJson('MARCA.json', resultado);
process.exit(falhou ? 1 : 0);
```

Em `medir.mjs` (`:25-35`), a lista `ETAPAS` ganha `['marca', 'etapas/marca.mjs']` entre `['suplementar', …]` e `['resumir', 'etapas/resumir.mjs']`. A etapa não mede tempo: não passa pela checagem de ociosidade.

- [ ] **Step 2: Provar que ela pega laranja de verdade (mutação)**

Numa cópia do build, trocar à mão, no CSS de `dist/assets/*.css`, um `var(--color-accent)` qualquer por `#f28c45` (o laranja de hoje). Rodar a etapa contra a cópia.

Run: `MSYS_NO_PATHCONV=1 MEDICAO_DIST=<cópia> MEDICAO_SAIDA=ferramentas/medicao/resultados/e2-mutacao node ferramentas/medicao/etapas/marca.mjs`
Expected: sai 1, com `#f28c45` nas sobras das três marcas. Apagar a cópia.

- [ ] **Step 3: Rodar no build da E2**

Run: `MSYS_NO_PATHCONV=1 MEDICAO_DIST=ferramentas/medicao/resultados/e2/dist MEDICAO_SAIDA=ferramentas/medicao/resultados/e2 node ferramentas/medicao/etapas/marca.mjs`
Expected: três `ok`, on-accent ≥ 4,5 em cada. Se sobrar laranja, o `MARCA.json` diz o valor e os elementos: a origem é um arquivo que ainda está na lista de `PENDENCIAS` do `acentoUnico.test.js` ou uma cor que escapou dela — corrigir no arquivo (é da E2 se o elemento é da mesa) e rodar de novo. Prints em `resultados/e2/marca/` para o registro.

- [ ] **Step 4: README e commit**

No README do harness: a etapa `marca`, o que mede, as isenções e como achar a origem de uma sobra.

```bash
git add ferramentas/medicao/etapas/marca.mjs ferramentas/medicao/medir.mjs ferramentas/medicao/README.md
git commit -m "E2.6: rodada de marca alternativa no harness (spec 5.2.4)"
```

---

### Task 3: Medição completa e orçamentos

**Files:**
- Create: `ferramentas/medicao/linha-de-base/<hash>-e2/` (resumo e JSONs da rodada aprovada)
- Modify: `docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md` (números)

- [ ] **Step 1: Rodada completa com a máquina ociosa**

Fechar tudo que pesa (outros Chromes, builds, o próprio IDE indexando). Da raiz:

Run: `node ferramentas/medicao/medir.mjs --dist ferramentas/medicao/resultados/e2/dist --saida ferramentas/medicao/resultados/e2`
Expected: todas as etapas, inclusive `marca`; tempo pela mediana de 3; nenhuma recusa por ocupação (se recusar, esperar e repetir — **não** usar `--sem-tempo` para a rodada de aceite).

- [ ] **Step 2: Comparar com a linha de base da E0**

Run: `node ferramentas/medicao/comparar.mjs ferramentas/medicao/linha-de-base/<linha-de-base-da-E0>/RESUMO.json ferramentas/medicao/resultados/e2/RESUMO.json`

(A E0, Task 9, registra a linha de base com tempo; o nome da pasta é o que ela criou.)

- [ ] **Step 3: Conferir cada orçamento da E2 (spec 12.2)**

| Orçamento | Chave no RESUMO / fonte | Aceite |
|---|---|---|
| JS de entrada | M6 (entrada do manifesto, gz) | −4,5 KB gz ou mais contra a linha de base |
| CSS de entrada | M6 (CSS de entrada, gz) | não cresce |
| Login, Fast 3G | M7 login | igual ±2% |
| Boot até a lista, CPU 4× | `M9.bootCpu4xMedianaMs` | ≤ linha de base (874 ms em `ac334af`) |
| Elementos com conversa aberta | `DOM.atendente-1366-1-conversa.elementos` | ≤ 800 (era 929) |
| Fundos distintos visíveis (mesa) | `M2.atendente-1366-1-conversa.backgroundColorDistintos` | ≤ 10 (era 28) |
| Famílias de cor ao mesmo tempo | `M3.atendente-1366-1-conversa.familias` | acento + semânticas só com exceção na tela: ≤ 2 na conversa sem aviso aberto |
| Camadas de fundo sob texto (máx.) | `M5.atendente-1366-1-conversa.camadasMax` | ≤ 3 (era 6) |
| Marca alternativa | `MARCA.json` | três `ok` |
| Um `role="status"` por tela | `papeis.mjs` | 4 `ok` |
| Os cinco ganhos | testes de `frontend/src/guardas/` e os da E0 | verdes |

Os mesmos três de superfície (M2, M3, M5) também nas telas `2-conversa-sgp-automatico` e `4-dados-do-cliente` — com painel aberto, fundos ≤ 10 e camadas ≤ 3 continuam valendo.

Se algum orçamento **falhar**: parar. O `M2/M5` de cada tela lista os elementos por fundo e por profundidade (`m1-m5/<tela>.json`, campos `exemplos`); a correção é no arquivo do elemento, dentro da tarefa da E2 que o reescreveu, com o teste dele. Rodar a medição de novo. A E2 não vai à prévia com orçamento vermelho.

- [ ] **Step 4: Registrar a linha de base da E2**

Copiar `RESUMO.json`, `M1.json`…`M9.json`, `MARCA.json` e os prints de `m1-m5/` para `ferramentas/medicao/linha-de-base/<hash-curto-da-branch>-e2/`, com um `LEIA.md` de 5 linhas (build, data, máquina, ociosidade, o que mudou). É a base de comparação da E3.

```bash
git add ferramentas/medicao/linha-de-base
git commit -m "E2.6: linha de base da mesa redesenhada"
```

---

### Task 4: Conferência do inventário — cada estado que a E2 possui

**Files:**
- Create: `ferramentas/inventario/conferir-etapa.cjs`
- Create: `docs/superpowers/specs/2026-09-24-redesenho-conferencia-E2.tsv`

Critério 2 do spec: todo item do Apêndice A tem etapa dona e é **conferido no fim dela**. A E2 é dona da casca (seção 2, a parte da moldura), do Atendimento (seção 3), do Perfil (seção 8) e dos primitivos compartilhados — cerca de 700 estados. O verificador da E0 confere endereços (arquivo:linha), que a E2 inteira desloca; aqui a pergunta é outra: **o que aconteceu com cada estado**.

- [ ] **Step 1: O conferidor**

`ferramentas/inventario/conferir-etapa.cjs`:

```js
#!/usr/bin/env node
// Confere se CADA estado do Apêndice A que pertence a uma etapa tem destino
// registrado numa planilha de conferência (TSV: id, destino, onde, nota).
//   node ferramentas/inventario/conferir-etapa.cjs <apendice-A.md> <conferencia.tsv> <etapa> [--esqueleto]
// Destinos: resolvido | mudou | mantido | saiu | adiado. "resolvido", "mudou" e
// "mantido" exigem `onde` (arquivo[:linha] que exista, ou "teste: <arquivo>");
// "saiu" exige `onde` = para onde foi (Apêndice B) ou "nada"; "adiado" exige a
// etapa na nota (E3…E7). Com --esqueleto, imprime o TSV com todos os ids da
// etapa e destino vazio, para começar.
const fs = require('fs');
const path = require('path');

const [arqA, arqTsv, etapa, opcao] = process.argv.slice(2);
if (!arqA || !arqTsv || !etapa) {
  console.error('uso: conferir-etapa.cjs <apendice-A.md> <conferencia.tsv> <etapa> [--esqueleto]');
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '..', '..');
const ID = /^\|\s*([A-Z]{2,5}(?:-[A-Z0-9]{2,6})*-\d+[a-z]?)\s*\|/;
const DESTINOS = new Set(['resolvido', 'mudou', 'mantido', 'saiu', 'adiado']);

// Dono corrente = a última marcação "**Etapa dona:** X" antes da tabela.
const idsDaEtapa = [];
let dona = '';
for (const linha of fs.readFileSync(arqA, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/\*\*Etapa dona:\*\*\s*(.+)/);
  if (m) dona = m[1].trim();
  const id = linha.match(ID);
  if (id && dona.startsWith(etapa)) idsDaEtapa.push(id[1]);
}

if (opcao === '--esqueleto') {
  process.stdout.write(['id\tdestino\tonde\tnota', ...idsDaEtapa.map((id) => `${id}\t\t\t`)].join('\n') + '\n');
  process.exit(0);
}

const linhas = fs.readFileSync(arqTsv, 'utf8').split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split('\t'));
const porId = new Map(linhas.map(([id, destino = '', onde = '', nota = '']) => [id, { destino: destino.trim(), onde: onde.trim(), nota: nota.trim() }]));
const problemas = [];

for (const id of idsDaEtapa) {
  const r = porId.get(id);
  if (!r) { problemas.push(`${id}: sem linha na conferência`); continue; }
  if (!DESTINOS.has(r.destino)) { problemas.push(`${id}: destino "${r.destino}" inválido`); continue; }
  if (['resolvido', 'mudou', 'mantido'].includes(r.destino)) {
    const alvo = r.onde.replace(/^teste:\s*/, '').split(':')[0];
    if (!alvo) problemas.push(`${id}: ${r.destino} sem "onde"`);
    else if (!fs.existsSync(path.join(RAIZ, alvo))) problemas.push(`${id}: "${alvo}" não existe`);
  }
  if (r.destino === 'saiu' && !r.onde) problemas.push(`${id}: saiu sem dizer para onde ("nada" vale)`);
  if (r.destino === 'adiado' && !/\bE[3-7]\b/.test(r.nota)) problemas.push(`${id}: adiado sem a etapa na nota`);
}
for (const id of porId.keys()) {
  if (!idsDaEtapa.includes(id)) problemas.push(`${id}: não é da ${etapa} no Apêndice A`);
}

console.log(`${etapa}: ${idsDaEtapa.length} estados; ${idsDaEtapa.length - problemas.filter((p) => !p.includes('não é da')).length} conferidos`);
for (const p of problemas) console.log('  ' + p);
process.exit(problemas.length ? 1 : 0);
```

Run: `node ferramentas/inventario/conferir-etapa.cjs docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md /dev/null E2 --esqueleto > docs/superpowers/specs/2026-09-24-redesenho-conferencia-E2.tsv && wc -l docs/superpowers/specs/2026-09-24-redesenho-conferencia-E2.tsv`
Expected: por volta de 700 linhas (46 + 610 + 18 + 29 da tabela do A.1, menos as da seção 2 que o texto dá à E3 — a marcação dela começa por "E2", então entram; as que forem do carregamento viram `adiado` com "E3").

- [ ] **Step 2: Preencher por seção, com auditores e um responsável**

Regra do projeto (memória `feedback_subagents_audit_only` e `feedback_verificar_saida_de_subagente`): auditores em paralelo, **um por seção** (casca; Atendimento em 4 fatias — lista, conversa, painéis, overlays; Perfil; primitivos), cada um devolvendo as linhas da sua seção com `destino`, `onde` (o arquivo **novo** que desenha o estado, ou o teste que o prova) e `nota`. Um responsável só junta tudo na planilha. Antes de aceitar a seção:

Run: `node ferramentas/inventario/conferir-etapa.cjs docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md docs/superpowers/specs/2026-09-24-redesenho-conferencia-E2.tsv E2`
Expected: 0 problemas.

E a **amostra humana**: 10% das linhas de cada seção, sorteadas (`shuf -n` sobre a seção), conferidas abrindo o arquivo em `onde` — o estado está lá, com o texto que a linha diz. Anotar a amostra no fim do TSV como comentário não é possível (TSV puro): registrar no registro da E2 ("amostra: 70 linhas, 0 erradas" — ou os erros e a correção). Seção com erro na amostra volta inteira para o auditor.

- [ ] **Step 3: Commit**

```bash
git add ferramentas/inventario/conferir-etapa.cjs docs/superpowers/specs/2026-09-24-redesenho-conferencia-E2.tsv
git commit -m "E2.6: conferencia do inventario - cada estado da E2 com destino"
```

---

### Task 5: Registro S × C consolidado e pendências da mesa zeradas

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md`
- Modify: `frontend/src/estilo/acentoUnico.test.js` (se sobrar arquivo da mesa em `PENDENCIAS`)

- [ ] **Step 1: Pendências da mesa**

Nenhum arquivo que desenha a mesa pode continuar em `PENDENCIAS` no fim da E2 (é a mesa que vai ao proprietário). Arquivos da mesa: `AppShell`, `SideNav`, `ChannelStatusBanner`, `ConversationListItem`, `DashboardPage`, `ConversationView`, `MessageBubble`, `MessageInput`, `MessageAttachment`, `PixCardMessage`, `SgpLookupPanel`, `PainelCliente`, `AiSuggestionCard`, `CloseReasonModal`, `closeReasonCatalog`, `TransferModal`, `StartConversationModal`, `SendTemplateModal`, `EscolhaDeTemplate`, `ConversationHistoryModal`, `ClosedConversationsModal`, `ConversationModal`, `ProfileModal`, `ContactAvatar`, `recording-preview.css`, `overlays.css` (as regras da base), `dashboard.css`.

Run: `cd frontend && npx vitest run src/estilo && node -e "const t=require('fs').readFileSync('src/estilo/acentoUnico.test.js','utf8');const m=t.match(/PENDENCIAS\s*=\s*\[([\s\S]*?)\]/);console.log(m[1])"`
Expected: a suíte passa, e nenhum dos arquivos acima aparece na lista impressa. Se aparecer: o literal que sobrou é da E2 — trocar pelo token (é troca de cor: vai ao registro como C) e tirar o arquivo da lista. `ContactAvatar.jsx`: se nenhum chamador passa mais `dark` (o gradiente laranja→cobre era do cabeçalho e do `CustomerPanel`, que a E2.4 trocou), a variante colorida sai (`grep -rn "ContactAvatar" src | grep dark` → nada).

- [ ] **Step 2: Consolidar o registro**

O registro (`2026-09-24-redesenho-registro-E2.md`) tem as seções da E2.1 à E2.5. Acrescentar no topo:

- **Totais:** S e C por subplano e no total — contar as linhas da tabela de cada seção (`grep -c "| S |"` e `"| C |"`). Aprovação: **S > C** no total e em cada subplano (critério 1 do spec).
- **Números do harness** que sustentam as linhas estruturais: elementos com conversa aberta (929 → n), fundos distintos (28 → n), camadas máximas (6 → n), itens da lista (elementos por item, M4), linhas do cabeçalho, controles por barra — da Task 3.
- **Marca alternativa** (três prints) e **papéis** (a saída do `papeis.mjs`).
- **Conferência do inventário:** o total por destino (resolvido, mudou, mantido, saiu, adiado) e a amostra humana.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md frontend/src/estilo/acentoUnico.test.js
git commit -m "E2.6: registro S x C consolidado e pendencias da mesa zeradas"
```

---

### Task 6: Prévia no Render — roteiro para o proprietário

**Files:** nenhum (configuração no painel; o roteiro vai na mensagem ao proprietário).

Mecanismo decidido (decisão 2): **site estático separado**, construído da branch `redesenho/e2-mesa`, com a API de produção. Os passos 2 e 3 são no painel do Render e **só o proprietário os autoriza**. O executor prepara a branch (push da `redesenho/e2-mesa` — com autorização, como todo push) e entrega este roteiro.

- [ ] **Step 1: A branch pronta e empurrada**

Suíte verde (salvo as falhas antigas conhecidas), build de produção sem erro, Tasks 1–5 fechadas. Pedir ao proprietário autorização para `git push -u origin redesenho/e2-mesa` — a branch **não** é a `main`: nada vai à produção.

- [ ] **Step 2 (proprietário): Criar o site da prévia**

No Render: **New → Static Site** → o mesmo repositório → **Branch:** `redesenho/e2-mesa`; **Root Directory:** `frontend`; **Build Command:** `npm install && npm run build`; **Publish Directory:** `dist`; **Name:** `dw-chat-previa-e2` (o endereço sai `https://dw-chat-previa-e2.onrender.com`). Em **Environment**, `VITE_API_BASE_URL` com **o mesmo valor** do site de produção (`dw-whatsapp-frontend` → Environment). Em **Redirects/Rewrites**, a mesma regra do `render.yaml`: origem `/*`, destino `/index.html`, ação **Rewrite**. Auto-deploy ligado: cada push na branch atualiza a prévia.

- [ ] **Step 3 (proprietário): Liberar a origem da prévia na API**

No serviço do backend → **Environment** → `FRONTEND_ORIGIN`: acrescentar **no fim**, depois de uma vírgula, `https://dw-chat-previa-e2.onrender.com` (sem barra no fim). **Não** apagar o que já está lá — a variável aceita lista (`src/config/cors-origins.js`), e a origem de produção tem de continuar. Salvar reinicia o backend (alguns segundos; o socket dos atendentes reconecta sozinho, com o aviso "Reconectando…").

- [ ] **Step 4: Conferir a prévia**

Com o proprietário: abrir a prévia, entrar com a conta dele, e conferir que (a) a lista carrega e as mensagens chegam em tempo real (socket), (b) o console do navegador não mostra CORS recusado, (c) a produção (`dw-whatsapp-frontend`) continua igual para os atendentes.

**Aviso a dar antes, com estas palavras:** "A prévia usa os dados e a API de verdade. Tudo que você fizer nela acontece de verdade: mensagem enviada chega ao cliente, atendimento encerrado fica encerrado, cobrança do SGP vai para o WhatsApp dele. Ela só muda a tela, não o sistema."

- [ ] **Step 5: Depois do veredito**

- **Aprovada:** merge da `redesenho/e2-mesa` na `main` (com autorização — é a publicação da E2); depois, o proprietário **apaga o site da prévia** e **tira a origem dela** de `FRONTEND_ORIGIN` (a origem órfã não quebra nada, mas é uma porta aberta sem uso).
- **Com correções:** as correções entram na mesma branch (a prévia atualiza sozinha a cada push) e a conferência se repete. Nenhuma outra etapa visual começa antes do "ok" (spec 11).

---

### Task 7: Entrega ao proprietário (checkpoint)

- [ ] **Step 1: A mensagem do checkpoint**

Em português, curta, com: o link da prévia; o que mudou em 10 linhas (as maiores mudanças estruturais do registro); os números da Task 3 (antes → depois) e o S × C; o que **não** mudou de propósito (o que ficou para E3–E7, com a etapa); o aviso da Task 6 Step 4; e a pergunta: "a direção é esta?". Anexar os prints do M1 da mesa (1366 e 1920) e os três da marca alternativa.

- [ ] **Step 2: Atualizar a memória e o Obsidian**

Memória do projeto: um arquivo novo `project_redesign_e2_checkpoint.md` (estado da E2, link da prévia, o que falta para publicar) e a linha dele no `MEMORY.md`. Obsidian (`D:\Projetos\DW - Base de Conhecimento`): a nota do redesenho ganha a E2 com o link do registro e da conferência.
