// Configuracao de uma rodada. Tudo vem de variavel de ambiente (que o
// medir.mjs preenche a partir dos argumentos); nenhum caminho absoluto embutido.
//
//   MEDICAO_DIST      build de producao a medir (obrigatorio para as etapas com Chrome)
//   MEDICAO_SAIDA     pasta dos resultados            (padrao: medicao/resultados/avulso)
//   MEDICAO_CHROME    executavel do Chrome            (padrao: procura nos lugares de sempre)
//   MEDICAO_PORTA_H2  porta do servidor HTTP/2+TLS    (padrao 4273; 0 = escolhe uma livre)
//   MEDICAO_PORTA_H1  porta do servidor HTTP/1.1      (padrao 4274; 0 = escolhe uma livre)
//   MEDICAO_RODADAS   rodadas de cada medida de tempo (M7 e M9) — minimo 3, regra do pacote
//   MEDICAO_PERFIS    perfis temporarios do Chrome    (padrao: <tmp do SO>/dw-medicao-perfis)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RODADAS_MINIMAS } from './ociosidade.mjs';

export const RAIZ = path.resolve(import.meta.dirname, '..'); // ferramentas/medicao

export const RES = path.resolve(process.env.MEDICAO_SAIDA || path.join(RAIZ, 'resultados', 'avulso'));
export const PORTA_H2 = Number(process.env.MEDICAO_PORTA_H2 ?? 4273);
export const PORTA_H1 = Number(process.env.MEDICAO_PORTA_H1 ?? 4274);
export const RODADAS = Number(process.env.MEDICAO_RODADAS || RODADAS_MINIMAS);
if (!Number.isInteger(RODADAS) || RODADAS < RODADAS_MINIMAS) {
  throw new Error(`MEDICAO_RODADAS=${process.env.MEDICAO_RODADAS}: tempo so se compara pela mediana de pelo menos ${RODADAS_MINIMAS} rodadas.`);
}
export const PERFIS = path.resolve(process.env.MEDICAO_PERFIS || path.join(os.tmpdir(), 'dw-medicao-perfis'));

export function dist() {
  const d = process.env.MEDICAO_DIST;
  if (!d) throw new Error('MEDICAO_DIST nao definido. Rode pelo medir.mjs (npm run medir -- --dist <pasta>) ou defina a variavel.');
  const abs = path.resolve(d);
  if (!fs.existsSync(path.join(abs, 'index.html'))) throw new Error(`nao ha index.html em ${abs}: isso nao e um build do Vite`);
  return abs;
}

const CANDIDATOS_CHROME = {
  win32: [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

export function chrome() {
  if (process.env.MEDICAO_CHROME) {
    if (!fs.existsSync(process.env.MEDICAO_CHROME)) throw new Error('MEDICAO_CHROME aponta para um arquivo que nao existe: ' + process.env.MEDICAO_CHROME);
    return process.env.MEDICAO_CHROME;
  }
  const achado = (CANDIDATOS_CHROME[process.platform] || []).filter(Boolean).find((c) => fs.existsSync(c));
  if (!achado) throw new Error('Chrome nao encontrado. Passe --chrome <executavel> (ou MEDICAO_CHROME).');
  return achado;
}
