// Consolida resultados/m1-m5/*.json em M1..M5.json e monta RESUMO.json (plano,
// numero a numero) — e o RESUMO que comparar.mjs usa para provar regressao ou nao.
import fs from 'node:fs';
import path from 'node:path';
import { RES, salvarJson } from '../lib/harness.mjs';

const ler = (rel) => {
  const f = path.join(RES, rel);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const CONFIGS = ['atendente-1366', 'atendente-1920', 'admin-1366'];
const ESTADOS = ['0-lista', '1-conversa', '2-conversa-sgp-automatico', '3-conversa-transferencia', '4-dados-do-cliente', '5-sgp', '6-aba-espera', '7-aba-automacao'];
const PRINCIPAL = 'atendente-1366-1-conversa';

const est = {};
for (const c of CONFIGS) for (const e of ESTADOS) {
  const r = ler(`m1-m5/${c}-${e}.json`);
  if (r) est[`${c}-${e}`] = r;
}
const p = est[PRINCIPAL];
if (!p) throw new Error('rode m1-m5.mjs antes');

// ---------- M1 ----------
const m6 = ler('M6.json');
const opc = ler('OPCIONAL.json');
const sup = ler('SUPLEMENTAR-nao-lidas.json');
salvarJson('M1.json', {
  descricao: 'Prints da tela de Atendimento. Estados: 0 lista sem conversa; 1 conversa A aberta sem painel (PRINCIPAL); 2 conversa A com o painel do SGP aberto automaticamente (contato tem CPF); 3 mesma conversa rolada ate a transferencia; 4 painel Dados do cliente; 5 painel Consultar SGP reaberto; 6 aba Espera; 7 aba Automacao.',
  prints: Object.fromEntries(CONFIGS.map((c) => [c, ESTADOS.filter((e) => est[`${c}-${e}`]).map((e) => est[`${c}-${e}`].print)])),
  m6: m6 ? m6.cenarios.map((c) => c.print) : null,
  opcional: opc ? Object.keys(opc).map((k) => `opcional/admin-1366-${k}.png`) : null,
  suplementar: sup ? sup.resumo.map((r) => r.print) : null,
});

// ---------- M2 ----------
const contagensM2 = (r) => {
  const m = r.M2.semArtefato;
  return {
    elementosVisiveis: m.elementosVisiveis,
    pseudoVisiveis: m.pseudoElementosVisiveis,
    comSuperficie: m.comSuperficie,
    backgroundColorDistintos: m.backgroundColor.distintos,
    backgroundImageDistintos: m.backgroundImage.distintos,
    backdropFilterElementos: m.backdropFilter.elementos,
    boxShadowDistintos: m.boxShadow.distintos,
    borderRadiusDistintos: m.borderRadius.distintos,
    borderColorDistintos: m.borderColor.distintos,
  };
};
salvarJson('M2.json', {
  criterio: 'estilo computado de elementos visíveis (caixa > 0, dentro da janela, não recortados por ancestral com overflow, sem sr-only, opacidade efetiva > 0) + ::before/::after pintados. Sem o indicador "Reconectando…" (artefato do socket bloqueado).',
  principal: { estado: PRINCIPAL, ...contagensM2(p), detalhe: p.M2.semArtefato },
  comparativo: Object.fromEntries(Object.entries(est).map(([k, r]) => [k, contagensM2(r)])),
});

// ---------- M3 ----------
const familiasM3 = (r) => ({ familias: r.M3.semArtefato.familiasVisiveis, quais: r.M3.semArtefato.quais, familiasEfetivas: r.M3.semArtefato.familiasVisiveisEfetivas, familiasComArtefato: r.M3.comArtefato.familiasVisiveis, familiasEstendido: r.M3.estendidoSemArtefato.familiasVisiveis });
salvarJson('M3.json', {
  criterio: 'color (só elementos com texto próprio), background-color, border-*-color (lados com largura > 0), fill/stroke de formas SVG, inclusive ::before/::after; OKLCH; cromático se C > 0.04 (alfa ignorado na classificação e reportado); "efetivas" = cor composta sobre o fundo real embaixo; "estendido" = + paradas de gradiente e cores de box-shadow. Famílias por matiz OKLCH: vermelho/rosa 345–45°, laranja/cobre 45–72°, âmbar/amarelo 72–115°, verde/verde-água 115–200°, azul 200–268°, roxo/lilás 268–345° (calibração em calibracao-familias.json).',
  principal: { estado: PRINCIPAL, ...familiasM3(p), detalhe: p.M3.semArtefato, imagens: p.M3.imagens },
  comparativo: Object.fromEntries(Object.entries(est).map(([k, r]) => [k, familiasM3(r)])),
});

// ---------- M4 ----------
const m4 = {};
for (const c of CONFIGS) {
  for (const [aba, e] of [['Atendimento (Andamento)', '1-conversa'], ['Espera', '6-aba-espera'], ['Automação', '7-aba-automacao']]) {
    const r = est[`${c}-${e}`];
    if (r && r.M4) m4[`${c} · ${aba}`] = r.M4;
  }
}
salvarJson('M4.json', {
  seletor: '[role=tabpanel] li (todo item do painel da aba ativa; a linha clicável é o [role=button] dentro dele)',
  criterio: 'peças = nós de texto não vazios e visíveis + <svg> + <img>; linhas visuais = faixas distintas de texto (retângulos de Range agrupados por altura, tolerância 5 px)',
  porLista: m4,
  suplementarNaoLidas: sup ? sup.resumo.filter((r) => r.M4).map((r) => ({ estado: r.estado, ...r.M4 })) : null,
});

// ---------- M5 ----------
const profM5 = (r) => ({ textos: r.M5.semArtefato.textosVisiveis, media: r.M5.semArtefato.media, mediana: r.M5.semArtefato.mediana, maximo: r.M5.semArtefato.maximo, distribuicao: r.M5.semArtefato.distribuicao });
salvarJson('M5.json', {
  criterio: 'para cada nó de texto visível, quantos elementos da cadeia (do pai até html) têm background-color com alfa > 0 ou background-image',
  principal: { estado: PRINCIPAL, ...profM5(p), piorCaso: p.M5.semArtefato.piorCaso, zIndex: p.M5.semArtefato.zIndex },
  comparativo: Object.fromEntries(Object.entries(est).map(([k, r]) => [k, { ...profM5(r), zIndexValores: r.M5.semArtefato.zIndex.map((z) => z.z) }])),
});

// ---------- RESUMO (plano) ----------
const m7 = ler('M7.json');
const m8 = ler('M8.json');
const m9 = ler('M9.json');
const R = {};
const put = (k, v) => {
  if (v !== undefined && v !== null) R[k] = v;
};
for (const [k, r] of Object.entries(est)) {
  const c = contagensM2(r);
  for (const [ck, cv] of Object.entries(c)) put(`M2.${k}.${ck}`, cv);
  put(`M3.${k}.familias`, r.M3.semArtefato.familiasVisiveis);
  put(`M3.${k}.familiasEfetivas`, r.M3.semArtefato.familiasVisiveisEfetivas);
  put(`M5.${k}.camadasMax`, r.M5.semArtefato.maximo);
  put(`M5.${k}.camadasMedia`, r.M5.semArtefato.media);
  put(`M5.${k}.zIndexDistintos`, r.M5.semArtefato.zIndex.length);
  put(`DOM.${k}.elementos`, r.totalElementos);
}
for (const [k, r] of Object.entries(m4)) {
  put(`M4.${k}.elementosMediana`, r.elementosDOM.mediana);
  put(`M4.${k}.elementosMax`, r.elementosDOM.max);
  put(`M4.${k}.pecasMediana`, r.pecasVisiveis.mediana);
  put(`M4.${k}.pecasMax`, r.pecasVisiveis.max);
  put(`M4.${k}.alturaMediana`, r.alturaPx.mediana);
  put(`M4.${k}.linhasMax`, r.linhasVisuais.max);
}
if (m6) for (const c of m6.cenarios) put(`M6.${c.cenario}.contrastePixels`, c.barras[0] && c.barras[0].contrasteWCAG.pixels_do_print);
if (m7) for (const [k, r] of Object.entries(m7.rodadas)) {
  put(`M7.${k}.tempoAteAlvoMs`, r.tempoAteAlvoMs);
  put(`M7.${k}.profundidadeSerial`, r.profundidadeSerialAteAlvo);
  put(`M7.${k}.jsBytesAteAlvo`, r.bytesAteAlvo.js);
  put(`M7.${k}.cssBytesAteAlvo`, r.bytesAteAlvo.css);
}
if (m8) {
  put('M8.totalApi', m8.totais.requisicoesApi);
  put('M8.totalPreflights', m8.totais.preflights);
  for (const l of m8.tabela) {
    put(`M8.${l.padrao}.requisicoes`, l.requisicoes);
    put(`M8.${l.padrao}.preflights`, l.preflights);
  }
}
if (m9) {
  put('M9.elementosComConversaAberta', m9.a_elementosNoDOM.comConversaAberta);
  put('M9.jsBytesAteLista', m9.b_bytesAtePrimeiroItem.js);
  put('M9.cssBytesAteLista', m9.b_bytesAtePrimeiroItem.css);
  for (const [k, v] of Object.entries(m9.c_performanceGetMetrics.comConversaAberta)) put(`M9.conversaAberta.${k}`, v);
  put('M9.bootCpu4xMedianaMs', m9.d_bootAteLista.cpu4x.medianaMs);
  put('M9.bootCpu1xMedianaMs', m9.d_bootAteLista.cpu1x.medianaMs);
}
if (opc) for (const [k, r] of Object.entries(opc)) {
  put(`OPC.${k}.bgDistintos`, r.bgDistintos);
  put(`OPC.${k}.familias`, r.familias);
  put(`OPC.${k}.camadasMax`, r.camadasMax);
  put(`OPC.${k}.elementos`, r.elementos);
}
// A ociosidade de cada etapa de tempo vai junto: o comparar.mjs so compara
// tempo entre dois RESUMOs que passaram pela checagem (regra do pacote).
salvarJson('RESUMO.json', { geradoEm: new Date().toISOString(), ambiente: { ...(ler('ambiente.json') || {}), ociosidade: ler('ociosidade.json') }, metricas: R });
console.log(`RESUMO.json com ${Object.keys(R).length} números`);
