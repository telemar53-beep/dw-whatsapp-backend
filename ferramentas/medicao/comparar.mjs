// Compara dois RESUMO.json (antes x depois de uma etapa), metrica a metrica.
//   node ferramentas/medicao/comparar.mjs <RESUMO-antes.json> <RESUMO-depois.json> [filtro]
// Lista so o que mudou: "chave: antes -> depois (delta, %)"; "—" = metrica que
// nao existe naquele lado (ex.: o M6 nao achou barras, o M4 nao achou itens).
//
// Metricas de TEMPO seguem a regra do pacote (lib/ociosidade.mjs):
// - so se comparam se os DOIS lados passaram pela checagem de maquina ociosa
//   com pelo menos 3 rodadas; senao aparecem como "NAO COMPARAVEL";
// - variacao dentro da faixa de ruido DA METRICA conta como ruido, nao mudanca.
//   As faixas foram medidas: duas rodadas completas da mesma build, maquina
//   ociosa, deram M7 ate ±1,4%, boot com CPU 4x −2,2%, e as duracoes de
//   Performance.getMetrics ate ±15%. O boot com CPU 1x variou ~20%: e so
//   informativo, nunca criterio.
import fs from 'node:fs';
import { LIMITE_OCUPACAO_PCT, RODADAS_MINIMAS } from './lib/ociosidade.mjs';

// `M9.conversaAberta.Nodes` NAO entra em faixa nenhuma: e contagem de nos do
// DOM, estrutural e deterministica — uma faixa ali esconderia regressao real.
const FAIXAS = [
  { re: /tempoAteAlvoMs$/, pct: 5 },
  { re: /bootCpu4xMedianaMs$/, pct: 5 },
  { re: /^M9\.conversaAberta\.(\w+Duration|\w+Count|JSHeap\w+)$/, pct: 20 },
];
const INFORMATIVAS = /bootCpu1xMedianaMs$/;
const faixaDe = (k) => (FAIXAS.find((f) => f.re.test(k)) || {}).pct;
const etapaDaMetrica = (k) => (k.startsWith('M7.') ? 'm7' : k.startsWith('M9.') ? 'm9' : null);

const [a, b, filtro] = process.argv.slice(2);
if (!a || !b) {
  console.log('uso: node ferramentas/medicao/comparar.mjs <RESUMO-antes.json> <RESUMO-depois.json> [filtro]');
  process.exit(1);
}
const RA = JSON.parse(fs.readFileSync(a, 'utf8'));
const RB = JSON.parse(fs.readFileSync(b, 'utf8'));
const A = RA.metricas;
const B = RB.metricas;

const ea = RA.ambiente || {};
const eb = RB.ambiente || {};
for (const k of ['chrome', 'node', 'plataforma']) {
  if (ea[k] && eb[k] && ea[k] !== eb[k]) console.log(`AVISO: ${k} diferente (${ea[k]} x ${eb[k]}) — tempo (M7, M9) nao se compara entre ambientes diferentes.`);
}

function ociosa(amb, etapa) {
  const o = amb.ociosidade && amb.ociosidade[etapa];
  return Boolean(o && typeof o.cpuOcupadaPct === 'number' && o.cpuOcupadaPct <= LIMITE_OCUPACAO_PCT && o.rodadas >= RODADAS_MINIMAS);
}

const chaves = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => !filtro || k.includes(filtro)).sort();
let mudou = 0;
let ruido = 0;
let naoComparavel = 0;
let informativas = 0;
for (const k of chaves) {
  const va = A[k];
  const vb = B[k];
  if (va === vb) continue;
  if (INFORMATIVAS.test(k)) {
    informativas++;
    continue;
  }
  const faixa = faixaDe(k);
  if (faixa !== undefined) {
    const etapa = etapaDaMetrica(k);
    if (etapa && !(ociosa(ea, etapa) && ociosa(eb, etapa))) {
      naoComparavel++;
      console.log(`${k}: ${va ?? '—'} -> ${vb ?? '—'}  NAO COMPARAVEL (um dos lados nao passou pela checagem de maquina ociosa com >= ${RODADAS_MINIMAS} rodadas)`);
      continue;
    }
    if (typeof va === 'number' && typeof vb === 'number' && va && Math.abs(((vb - va) / va) * 100) <= faixa) {
      ruido++;
      continue;
    }
  }
  mudou++;
  const delta = typeof va === 'number' && typeof vb === 'number' ? ` (${vb - va >= 0 ? '+' : ''}${+(vb - va).toFixed(3)}${va ? `, ${(((vb - va) / va) * 100).toFixed(1)}%` : ''})` : '';
  console.log(`${k}: ${va ?? '—'} -> ${vb ?? '—'}${delta}`);
}
console.log(`\n${mudou} de ${chaves.length} métricas mudaram; ${ruido} de tempo ficaram dentro da faixa de ruído; ${naoComparavel} de tempo não comparáveis; ${informativas} informativas ignoradas (boot CPU 1x).`);
