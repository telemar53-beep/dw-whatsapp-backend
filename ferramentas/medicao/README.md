# Medição da interface (build de produção)

Ferramenta de desenvolvimento. Não entra no bundle e **mora fora de
`frontend/`** (em `ferramentas/medicao/`). Mede a tela de Atendimento (e
Supervisão, Relatórios e Canais) de um **build de produção**, dirigindo o
Chrome de verdade por CDP, com a API inteira simulada por interceptação. Não
sobe backend, não toca banco e não fala com a internet.

Rode ao fim de cada etapa do redesenho e compare com a linha de base.

## Regras do pacote (não são recomendações)

Decisão do proprietário, 24/09/2026. O `medir.mjs` e o `comparar.mjs` fazem
cumprir; não há opção para contornar.

1. **Medida de tempo só com a máquina ociosa.** Antes de cada etapa de tempo
   (`m7`, `m9`), o `medir` amostra a CPU por 3 s e **recusa rodar** se ela
   estiver acima de 15% ocupada. Feche o que estiver rodando e repita — ou use
   `--sem-tempo` para medir só o resto. Motivo: numa rodada com outros
   processos pesados, o boot com CPU 4× mediu +24% sem nenhuma mudança de
   código.
2. **Mediana de pelo menos 3 rodadas.** Toda medida de tempo roda no mínimo 3
   vezes e o resumo guarda a mediana (`--rodadas` menor que 3 é recusado).
3. **Tempo só se compara entre rodadas que cumpriram 1 e 2.** O `comparar`
   marca "NÃO COMPARÁVEL" quando um dos lados não passou pela checagem, e trata
   como ruído a variação dentro da faixa medida de cada métrica (seção
   *Ruído*).
4. **O pacote não pode morar dentro de `frontend/`.** O Tailwind v4 varre a
   pasta do frontend inteira atrás de nomes de classe: palavras dos
   comentários e das fixtures daqui viram CSS de produção (medido: +23 B no CSS
   de entrada) e todos os assets mudam de hash. O `medir` recusa rodar se for
   copiado para dentro.

## Pré-requisitos

- Node 22.2 ou mais novo (WebSocket nativo e `zlib.crc32`). Nenhum pacote npm.
- Google Chrome instalado. É achado sozinho nos lugares de sempre; se não,
  passe `--chrome <executável>`.
- Duas portas livres: 4273 (HTTP/2) e 4274 (HTTP/1.1). Ocupadas? Use
  `--porta-h2 0 --porta-h1 0` (escolhe portas livres). A 4173 costuma estar
  com um `vite preview` esquecido.
- Para `--build`: `npm install` feito em `frontend/` (usa o Vite de lá).

## Uso

Da **raiz do repositório**:

```powershell
# gera o build numa pasta da rodada (nunca em frontend/dist) e mede tudo
node ferramentas/medicao/medir.mjs --build --saida ferramentas/medicao/resultados/etapa-1

# mede um build que já existe
node ferramentas/medicao/medir.mjs --dist C:\caminho\do\build --saida ferramentas/medicao/resultados/etapa-1

# máquina ocupada e só quer a parte estrutural? pula m7 e m9 de propósito
node ferramentas/medicao/medir.mjs --dist <build> --saida <pasta> --sem-tempo

# compara com a linha de base
node ferramentas/medicao/comparar.mjs ferramentas/medicao/linha-de-base/RESUMO.json ferramentas/medicao/resultados/etapa-1/RESUMO.json
node ferramentas/medicao/comparar.mjs <antes>/RESUMO.json <depois>/RESUMO.json M3.   # só um prefixo

# só algumas etapas (resumir junta o que já estiver na pasta)
node ferramentas/medicao/medir.mjs --dist <build> --saida <pasta> --etapas m6,m8,resumir
```

`--build` roda `vite build --outDir <saida>/dist --emptyOutDir --manifest`
**sem** `VITE_API_BASE_URL` (a API tem de ficar em `http://localhost:3000`, que
é o que a interceptação atende). Com `--dist`, o `medir` confere isso e recusa
um build que aponte para outro lugar.

Etapas (`--etapas`): `calibrar`, `m1-m5`, `m6`, `m7`, `m8`, `m9`, `opcional`,
`suplementar`, `resumir`. Com 3 rodadas de tempo, tudo junto leva uns 8 a 10
minutos (o M7 sozinho, uns 6).

Antes da rodada completa, quando o redesenho mexer no DOM:

```powershell
$env:MEDICAO_DIST = "<build>"; node ferramentas/medicao/diagnostico/smoke.mjs   # ~10 s
```

Quando a etapa mexer na linha do tempo da conversa (rolagem, lista de
mensagens, bolha), rode também o diagnóstico do "Carregar mensagens
anteriores". O jsdom não calcula layout; só no navegador se prova que a
mensagem que estava no topo continua no lugar depois do clique:

```powershell
$env:MEDICAO_DIST = "<build>"; node ferramentas/medicao/diagnostico/rolagem-anteriores.mjs   # ~40 s, sai 1 se falhar
```

Ele liga um histórico longo só na conversa A (`MEDICAO_HISTORICO_LONGO=60`,
que as etapas oficiais não usam; 1 em cada 4 dessas mensagens é foto) e roda
duas vezes: com o Chrome como ele é, e com `overflow-anchor: none` na linha do
tempo — que é como o Safari se comporta, porque ele não tem ancoragem nativa.
Em cada rodada clica duas vezes (lista no topo; lista rolada 30 px) e só mede
depois de todas as fotos carregadas. Passa se a lista não foi para o fim, a
mensagem-âncora andou no máximo 4 px e a ancoragem nativa voltou depois de uma
rolagem de roda de verdade.

Referência (24/09/2026):

| Build | Chrome, topo / rolada | "Safari", topo / rolada |
|---|---|---|
| `e5236da` (produção) | −2965 / −7717 px, foi ao fim | igual |
| `d8261d0` (1ª versão da E1.1) | 0 / +214 px | +2568 / +642 px |
| `e57bea6` (E1.1 revisada) | 0 / 0 px | 0 / 0 px |

## O que sai

Em `<saida>/`: `RESUMO.json` (o que o comparar lê, com `ambiente.ociosidade`),
`M1.json` … `M9.json`, `OPCIONAL.json`, `SUPLEMENTAR-nao-lidas.json`,
`ambiente.json` (versões de Chrome e Node), `ociosidade.json` (CPU antes de cada
etapa de tempo), prints e detalhes em `m1-m5/`, `m6/`, `m7/`, `opcional/`,
`suplementar/`, e a coleta crua em `brutos/`. `resultados/` é ignorado pelo Git;
a linha de base de cada etapa aprovada vai para `linha-de-base/`.

## Quando o redesenho mudar a interface

Todos os ganchos (rotas, nomes acessíveis, textos, marcos, chunks do M6) estão
em `lib/ganchos.mjs`. Eles usam papel + nome acessível e texto das fixtures,
não classe CSS. Se um gancho deixar de achar o alvo, a etapa falha por tempo
esgotado mostrando a expressão; ela nunca mede outra coisa em silêncio.

**Os nomes acessíveis abaixo são contrato do redesenho** — mudar qualquer um
exige mudar o gancho no mesmo commit:

- "Consultar SGP", "Fechar consulta SGP", "Dados do cliente",
  "Fechar dados do cliente", região "Consulta SGP", lista "Atendimentos",
  navegação "Navegação principal", marca "Mensagem não lida";
- abas com `role=tab` "Atendimento" / "Espera" / "Automação" e a lista dentro
  de `role=tabpanel` com um `<li>` por conversa;
- o esqueleto do Suspense como `role=status` com "Carregando…" e barras
  `aria-hidden`;
- os avisos de conexão como `role=status` com "Reconectando";
- os chunks do M6 pela fonte (`src/components/AppShell.jsx`,
  `src/pages/DashboardPage.jsx`) no manifesto.

Os rótulos de peça do M4 (`tiposDePeca`: nome, hora, prévia, ficha…) ainda
leem as classes do item da lista; mudaram as classes, eles viram
"outro texto". Os números do M4 no RESUMO não dependem disso.

## Como funciona

- Servidor estático (`lib/static-server.mjs`): fallback de SPA, gzip nível 6,
  `immutable` em `/assets/`. HTTP/2 sobre TLS (certificado autoassinado gerado
  em memória a cada rodada por `lib/cert.mjs`) e HTTP/1.1 para comparação.
- Chrome sem janela, perfil temporário novo por sessão (em `<tmp do SO>/dw-medicao-perfis`),
  e `--host-resolver-rules` que só resolve `localhost`: não há caminho para a internet.
- Interceptação (`lib/session.mjs`): estáticos seguem para o servidor; a API em
  `http://localhost:3000/api/*` é respondida por `lib/mock-api.mjs` com os dados
  de `lib/fixtures.mjs`; o socket.io cai por falha de transporte (nunca recusa,
  que faria logout); qualquer outro host é bloqueado e registrado.
- Sessão semeada no `localStorage` (`dw_token`, `dw_agent`), relógio da página
  fixo em 24/09/2026 14:30 (São Paulo), fuso `America/Sao_Paulo` e `pt-BR`.
- Cliques com mouse de verdade, devolvendo o ponteiro a (2,2).
- "Conversa rolada até o fim" é fixado antes de cada captura da conversa
  (`fixarFimDaConversa`): sem isso a posição dependia de quando a foto terminou
  de carregar, e contagens de elementos visíveis mudavam entre rodadas.

## Limitações

1. A emulação de rede do Chrome não atrasa respostas forjadas: no M7 a
   latência da API é simulada no interceptador (`diagnostico/throttle-fulfill.mjs`
   prova). Fora do M7 a API é instantânea.
2. Com o socket bloqueado aparece "Reconectando…"; as métricas saem sem esse
   artefato. O estado "não lida" só existe no `suplementar` (socket emulado).
3. No M8 a contagem de imagens é de pedidos que saíram do renderer; em
   produção parte viria do cache de disco. Para JSON da API a contagem é exata.
4. HTTP/2 local não é o CDN do Render: os tempos servem para antes/depois,
   não para prever produção.
5. Tempos dependem da máquina e da versão do Chrome: compare só rodadas feitas
   no mesmo computador. O comparar avisa quando o `ambiente` dos dois lados
   difere.

## Ruído entre duas rodadas do mesmo build (máquina ociosa)

Estrutura (DOM, estilos, cores, itens, profundidade, contagem de pedidos):
idêntica — qualquer diferença ali é mudança real. Variam sozinhos, e o
`comparar` trata como ruído dentro destas faixas:

| Métrica | Faixa |
|---|---|
| `M7.*.tempoAteAlvoMs` (mediana de 3) | ±5% (medido ±1,4%) |
| `M9.bootCpu4xMedianaMs` | ±5% (medido −2,2%) |
| `M9.conversaAberta.*Duration`, `*Count`, `JSHeap*` | ±20% (medido até ±15%) |
| `M9.bootCpu1xMedianaMs` | informativo, nunca critério (~20%) |

`M9.conversaAberta.Nodes` fica **fora** de faixa: é contagem de nós do DOM,
estrutural. Bytes de M7/M9 variam ±50 B entre builds por causa dos hashes nos
nomes dos arquivos.
