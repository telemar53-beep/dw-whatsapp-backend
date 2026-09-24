// Entrada unica da medicao. Cada etapa roda num processo proprio (sobe e
// derruba o proprio servidor e o proprio Chrome) e no fim o resumir.mjs
// consolida tudo em <saida>/RESUMO.json.
//
// Roda da raiz do repositorio:
//   node ferramentas/medicao/medir.mjs --dist <build> --saida <pasta>
//   node ferramentas/medicao/medir.mjs --build --saida <pasta>     (gera o build antes, em <saida>/dist)
//   node ferramentas/medicao/medir.mjs --dist <build> --etapas m6,m8,resumir
//   node ferramentas/medicao/medir.mjs --dist <build> --comparar-com <outra-saida>/RESUMO.json
//   node ferramentas/medicao/medir.mjs --dist <build> --sem-tempo   (pula m7 e m9 de proposito)
//
// Opcoes: --chrome <exe>  --porta-h2 <n>  --porta-h1 <n> (0 = livre)  --rodadas <n> (minimo 3)
//         --frontend <pasta> (so para --build fora do repositorio)
//
// REGRA (lib/ociosidade.mjs): as etapas de TEMPO (m7, m9) so rodam com a CPU
// ociosa e com pelo menos 3 rodadas; sem isso a medicao para, em vez de gravar
// um numero que nao se compara com nada.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ocupacaoDaCpu, LIMITE_OCUPACAO_PCT, RODADAS_MINIMAS, ETAPAS_DE_TEMPO } from './lib/ociosidade.mjs';

const AQUI = import.meta.dirname;
const ETAPAS = [
  ['calibrar', 'etapas/calibrar-familias.mjs'],
  ['m1-m5', 'etapas/m1-m5.mjs'],
  ['m6', 'etapas/m6.mjs'],
  ['m7', 'etapas/m7.mjs'],
  ['m8', 'etapas/m8.mjs'],
  ['m9', 'etapas/m9.mjs'],
  ['opcional', 'etapas/opcional.mjs'],
  ['suplementar', 'etapas/suplementar-nao-lidas.mjs'],
  ['resumir', 'etapas/resumir.mjs'],
];

function lerArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error('argumento inesperado: ' + a);
    const chave = a.slice(2);
    const prox = argv[i + 1];
    if (prox === undefined || prox.startsWith('--')) out[chave] = true;
    else {
      out[chave] = prox;
      i++;
    }
  }
  return out;
}

function sair(msg) {
  console.error('medir: ' + msg);
  process.exit(2);
}

const args = lerArgs(process.argv.slice(2));
const conhecidas = new Set(['dist', 'build', 'saida', 'etapas', 'chrome', 'porta-h2', 'porta-h1', 'rodadas', 'comparar-com', 'sem-tempo', 'frontend']);
for (const k of Object.keys(args)) if (!conhecidas.has(k)) sair(`opcao desconhecida --${k}`);

const FRONTEND = path.resolve(typeof args.frontend === 'string' ? args.frontend : path.join(AQUI, '..', '..', 'frontend'));

// ---------- pre-voo ----------
if (typeof WebSocket !== 'function' || typeof zlib.crc32 !== 'function') {
  sair(`precisa de Node 22.2+ (WebSocket nativo e zlib.crc32); este e ${process.version}`);
}
// O harness NAO pode morar dentro de frontend/. O Tailwind v4 varre a pasta do
// frontend inteira atras de nomes de classe: palavras dos comentarios e das
// fixtures daqui (ex.: "ring", "shadow") viram CSS de producao e todos os
// assets mudam de hash. Medido: +23 B no CSS de entrada so por estar la dentro.
// Caminho real dos dois lados: no Windows o mesmo diretorio pode chegar em
// nome longo ou curto (8.3, "WILLEM~1"), e a comparacao crua os trataria como
// pastas diferentes — a trava nao dispararia.
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
const relativo = path.relative(real(FRONTEND), real(AQUI));
if (!relativo.startsWith('..') && !path.isAbsolute(relativo)) {
  sair(`o harness esta dentro de ${FRONTEND}: o Tailwind le estes arquivos e vaza classes para o CSS de producao. Ele mora em ferramentas/medicao/, na raiz do repositorio.`);
}
const rodadas = args.rodadas !== undefined ? Number(args.rodadas) : RODADAS_MINIMAS;
if (!Number.isInteger(rodadas) || rodadas < RODADAS_MINIMAS) {
  sair(`--rodadas precisa ser inteiro >= ${RODADAS_MINIMAS}: tempo so se compara pela mediana de pelo menos ${RODADAS_MINIMAS} rodadas.`);
}
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const SAIDA = path.resolve(typeof args.saida === 'string' ? args.saida : path.join(AQUI, 'resultados', carimbo));
fs.mkdirSync(SAIDA, { recursive: true });

let DIST = typeof args.dist === 'string' ? path.resolve(args.dist) : null;
if (args.build) {
  if (DIST) sair('use --dist OU --build, nao os dois');
  DIST = path.join(SAIDA, 'dist');
  const vite = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) sair('vite nao instalado em frontend/node_modules (rode npm install no frontend)');
  // Sem VITE_API_BASE_URL: a API tem de ficar em http://localhost:3000, que e o
  // que a interceptacao responde. Nunca escreve em frontend/dist.
  const env = { ...process.env };
  delete env.VITE_API_BASE_URL;
  console.log(`######## build -> ${DIST}`);
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', DIST, '--emptyOutDir', '--manifest'], { cwd: FRONTEND, stdio: 'inherit', env });
  if (r.status !== 0) sair('vite build falhou');
}
if (!DIST) sair('diga qual build medir: --dist <pasta> ou --build');
if (!fs.existsSync(path.join(DIST, 'index.html'))) sair(`nao ha index.html em ${DIST}`);

// O build precisa falar com http://localhost:3000 (o que a interceptacao atende).
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entrada = (html.match(/<script[^>]+type=["']module["'][^>]*src=["']\/?([^"']+)/) || [])[1];
if (entrada) {
  const js = fs.readFileSync(path.join(DIST, entrada), 'utf8');
  if (!js.includes('http://localhost:3000')) {
    sair(`o build ${DIST} nao aponta a API para http://localhost:3000 — foi gerado com VITE_API_BASE_URL? Gere de novo sem ela (ou use --build).`);
  }
}

const env = {
  ...process.env,
  MEDICAO_DIST: DIST,
  MEDICAO_SAIDA: SAIDA,
  ...(typeof args.chrome === 'string' ? { MEDICAO_CHROME: path.resolve(args.chrome) } : {}),
  ...(args['porta-h2'] !== undefined ? { MEDICAO_PORTA_H2: String(args['porta-h2']) } : {}),
  ...(args['porta-h1'] !== undefined ? { MEDICAO_PORTA_H1: String(args['porta-h1']) } : {}),
  MEDICAO_RODADAS: String(rodadas),
};

const pedidas = typeof args.etapas === 'string' ? args.etapas.split(',').map((s) => s.trim()) : null;
if (pedidas) for (const p of pedidas) if (!ETAPAS.some(([n]) => n === p)) sair(`etapa desconhecida: ${p} (use ${ETAPAS.map(([n]) => n).join(', ')})`);
let escolhidas = pedidas ? ETAPAS.filter(([n]) => pedidas.includes(n)) : ETAPAS;
if (args['sem-tempo']) {
  escolhidas = escolhidas.filter(([n]) => !ETAPAS_DE_TEMPO.has(n));
  console.log('--sem-tempo: m7 e m9 ficam de fora; o RESUMO sai sem metricas de tempo.');
}

// Registro da ociosidade de cada etapa de tempo, lido pelo resumir.mjs e
// conferido pelo comparar.mjs.
const arquivoOciosidade = path.join(SAIDA, 'ociosidade.json');
const ociosidade = fs.existsSync(arquivoOciosidade) ? JSON.parse(fs.readFileSync(arquivoOciosidade, 'utf8')) : {};

console.log(`build : ${DIST}\nsaida : ${SAIDA}\nrodadas de tempo: ${rodadas}\netapas: ${escolhidas.map(([n]) => n).join(', ')}`);
const inicio = Date.now();
for (const [nome, arquivo] of escolhidas) {
  const t = Date.now();
  if (ETAPAS_DE_TEMPO.has(nome)) {
    const pct = await ocupacaoDaCpu();
    ociosidade[nome] = { cpuOcupadaPct: pct, limitePct: LIMITE_OCUPACAO_PCT, rodadas, em: new Date().toISOString() };
    fs.writeFileSync(arquivoOciosidade, JSON.stringify(ociosidade, null, 2));
    if (pct > LIMITE_OCUPACAO_PCT) {
      sair(`CPU ${pct}% ocupada antes de ${nome} (limite ${LIMITE_OCUPACAO_PCT}%). Medida de tempo so com a maquina ociosa: feche o que estiver rodando e repita, ou use --sem-tempo para medir o resto.`);
    }
    console.log(`ociosidade antes de ${nome}: CPU ${pct}% ocupada (limite ${LIMITE_OCUPACAO_PCT}%) — ok`);
  }
  console.log(`\n######## ${nome} (${arquivo})`);
  const r = spawnSync(process.execPath, [path.join(AQUI, arquivo)], { cwd: AQUI, stdio: 'inherit', env });
  console.log(`######## ${nome}: saida ${r.status} em ${((Date.now() - t) / 1000).toFixed(0)} s`);
  if (r.status !== 0) sair(`etapa ${nome} falhou; parando.`);
}
console.log(`\nTudo pronto em ${((Date.now() - inicio) / 60000).toFixed(1)} min. Resumo: ${path.join(SAIDA, 'RESUMO.json')}`);

if (typeof args['comparar-com'] === 'string') {
  console.log(`\n######## comparar com ${args['comparar-com']}`);
  spawnSync(process.execPath, [path.join(AQUI, 'comparar.mjs'), path.resolve(args['comparar-com']), path.join(SAIDA, 'RESUMO.json')], { stdio: 'inherit' });
}
