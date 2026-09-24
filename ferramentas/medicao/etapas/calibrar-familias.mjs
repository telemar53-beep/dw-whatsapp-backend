// Calibra as faixas de matiz com os tokens reais do produto (index.css / dashboard.css).
import { lerCor, paraOklch, familiaDe } from '../lib/cores.mjs';
import { salvarJson } from '../lib/harness.mjs';
const tokens = {
  'chat-orange #f28c45': '#f28c45', 'chat-copper #f29a58': '#f29a58', 'accent-soft/focus #e5a16d': '#e5a16d', 'accent-strong #dd7835': '#dd7835',
  'edge-out #d99055': '#d99055', 'estado espera #e0a83c': '#e0a83c', 'warn-text #f0b65f': '#f0b65f', 'link #ffb078': '#ffb078',
  'estado automacao #9b7ae8': '#9b7ae8', 'edge-ai #b9a1d7': '#b9a1d7', 'ink-ai #c4b2dc': '#c4b2dc', 'ai-chip #cbb9e6': '#cbb9e6',
  'online #33d9a6': '#33d9a6', 'presence #65c596': '#65c596', 'estado encerrado #5fb89b': '#5fb89b', 'pix #2fc8b6': '#2fc8b6', 'teal #0d9488': '#0d9488',
  'sgp-blue #7ab0ff': '#7ab0ff', 'edge-in #7f95a3': '#7f95a3', 'glow #8296a4': '#8296a4', 'ink-muted #a9bcc8': '#a9bcc8', 'chip #c2d0d9': '#c2d0d9',
  'sgp-red #ff8d82': '#ff8d82', 'error-text #ff9d93': '#ff9d93', 'red-600 oklch': 'oklch(0.577 0.245 27.325)', 'google red #ea4335': '#ea4335',
  'avatar roxo #7c5cff': '#7c5cff', 'avatar azul #2f7cf6': '#2f7cf6', 'avatar rosa #e0459b': '#e0459b', 'avatar verde #1f9d5a': '#1f9d5a', 'avatar laranja #d97a1f': '#d97a1f', 'avatar ciano #0ea5b7': '#0ea5b7',
  'canvas #20272d': '#20272d', 'text #f4f6f7': '#f4f6f7',
};
const saida = {};
for (const [k, v] of Object.entries(tokens)) { const c = paraOklch(lerCor(v)); saida[k] = { ...c, cromatico: c.C > 0.04, familia: c.C > 0.04 ? familiaDe(c.H) : 'acromatico' }; console.log(k.padEnd(28), JSON.stringify(saida[k])); }
salvarJson('calibracao-familias.json', saida);
