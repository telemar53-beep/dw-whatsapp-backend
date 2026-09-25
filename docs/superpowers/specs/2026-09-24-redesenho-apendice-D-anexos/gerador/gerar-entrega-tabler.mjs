// Entrega Tabler 3.48.0 (so contorno, stroke 2 do pacote), mesmos nomes de export
// e mesma divisao por camada da entrega Phosphor. Pix: opcao escolhida por PIX=
// (si = Simple Icons 16.0.0 CC0 [padrao], atual = desenho do SgpIcons, ph = Phosphor
// pix-logo, real = Tabler currency-real, nenhum = sem Pix, so para medir).
import fs from 'fs';
import { SP } from './familias.mjs';
import { NOME } from './gerar-entrega.mjs';
import { TB, arqTb } from './tabler-escolha.mjs';
import { modulo, minificar, extrair, compactar } from './vendor2.mjs';
const ADAPT = JSON.parse(fs.readFileSync(SP + 'prec-tb-adapt.json', 'utf8'));
const PH_ADAPT = JSON.parse(fs.readFileSync(SP + 'prec-ph-adapt64.json', 'utf8'));
const prec = (slot) => { const a = ADAPT[slot]; if (!a) throw new Error('sem precisao verificada: ' + slot); return { prec: a.prec, juntar: a.juntar }; };
const camada = JSON.parse(fs.readFileSync(SP + 'slots-camada.json', 'utf8'));
const PIX = process.env.PIX || 'si';
const OUT = SP + (process.env.OUT_TB || 'entrega-tabler/');
fs.mkdirSync(OUT, { recursive: true });
const LIC = '/** @license Tabler Icons 3.48.0 | MIT | Copyright (c) 2020-2026 Pawel Kuna | ver LICENSE-Tabler.txt */\n';
const cab = (t) => `${LIC}// ${t}\n// GERADO a partir de @tabler/icons 3.48.0 (outline, stroke 2). Caminhos otimizados com SVGO; precisao e\n// uniao de tracos escolhidas icone a icone: a opcao mais curta que nao muda nenhum pixel mais de 64/255\n// a 16/20/24 px contra o SVG do pacote. Nao edite a mao; regenere.\n`;
const grupos = { entrada: [], raiz: [], resto: [] };
for (const [s, c] of Object.entries(camada)) grupos[c].push(s);
const it = (s) => ({ nome: NOME[s], slot: s, variante: 'reg', file: arqTb(s) });
function pixCodigo() {
  if (PIX === 'nenhum') return '';
  if (PIX === 'real') return `export const IconPix=R(${JSON.stringify(compactar(extrair(arqTb('pix') || SP + 'pacotes/tabler-icons-3.48.0/package/icons/outline/currency-real.svg', 'tb', 'reg', 3, true), 'tb', 'reg', true).d)});\n`;
  if (PIX === 'ph') {
    const f = SP + 'pacotes/phosphor-icons-core-2.1.1/package/assets/regular/pix-logo.svg';
    const p = PH_ADAPT['pix|reg'] ?? 2;
    return `// Pix: pix-logo da Phosphor Icons 2.1.1 (MIT, ver LICENSE-Phosphor.txt), excecao unica.\nconst Q=f("0 0 256 256",{"fill":"currentColor"});\nexport const IconPix=Q(${JSON.stringify(compactar(extrair(f, 'ph', 'reg', p, true), 'ph', 'reg', true).d)});\n`;
  }
  const [file, a, nota] = PIX === 'atual'
    ? [SP + 'pix/pix-atual-SgpIcons.svg', ADAPT['pix:atual'], 'desenho proprio atual (SgpIcons.IconPix), 4 losangos']
    : [SP + 'pix/package/icons/pix.svg', ADAPT['pix:simpleicons'], 'marca de terceiro (Pix/Banco Central). Forma da Simple Icons 16.0.0, CC0, ver assets/brands/README.md'];
  return `// Pix: ${nota}.\nconst P=f("0 0 24 24",{"fill":"currentColor"});\nexport const IconPix=P(${JSON.stringify(compactar(extrair(file, 'si', 'reg', a.prec, a.juntar), 'si', 'reg', a.juntar).d)});\n`;
}
const res = {};
function gravar(arq, titulo, itens, extra = '') {
  const { src, avisos } = modulo('tb', itens, (s) => prec(s));
  if (avisos.length) throw new Error(arq + ': ' + avisos.join(';'));
  const final = cab(titulo) + src + extra;
  fs.writeFileSync(OUT + arq, final);
  res[arq] = { exports: itens.length + (extra.match(/export /g) || []).length, ...minificar(final, 'tb-' + PIX + '-' + arq.replace('.js', '')) };
  delete res[arq].arquivo;
}
gravar('IconesEntrada.js', 'Icones do chunk de ENTRADA (login). So o que a AccessDeniedPage usa.', grupos.entrada.map(it));
const trab = grupos.raiz.filter((s) => s !== 'carregando' && s !== 'pix').map(it);
trab.push({ nome: '_spin', slot: 'carregando', variante: 'reg', file: arqTb('carregando') });
gravar('IconesTrabalho.js', 'Icones da casca (menu) e da mesa de atendimento: tudo que "/" baixa. O cadeado vem de IconesEntrada. Sem preenchidos: o ativo do menu e barra de 3 px + fundo.', trab,
  pixCodigo() + `export { IconLock } from './IconesEntrada';\nexport function IconSpinner({ className = '', ...p }) { return _spin({ className: 'motion-safe:animate-spin ' + className, ...p }); }\n`);
gravar('IconesConfig.js', 'Icones so de rotas sob demanda (Configuracoes, Relatorios, Campanhas, Supervisao). Nao entra em "/".', grupos.resto.map(it));
if (!process.env.OUT_TB) {
  fs.copyFileSync(SP + 'pacotes/tabler-icons-3.48.0/package/LICENSE', OUT + 'LICENSE-Tabler.txt');
  fs.copyFileSync(SP + 'pix/package/icons/pix.svg', OUT + 'pix.svg');
  fs.writeFileSync(OUT + 'resumo.json', JSON.stringify({ pix: PIX, escolha: TB, grupos, res }, null, 1));
}
console.log(JSON.stringify({ pix: PIX, res }));
