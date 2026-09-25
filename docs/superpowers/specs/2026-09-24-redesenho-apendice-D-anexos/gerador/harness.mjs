// Build REAL de variantes numa copia descartavel do frontend (base = e5236da).
// Uso: node harness.mjs <nome> fam=<atual|ph|ph-adapt|tb|hi|lu> [arq] [split] [fills]
//  arq   : tira navItems/icones do chunk de entrada (hasLevel/SETTINGS_BASE/LEGACY_REDIRECTS
//          vao para navigation/rotas.js; AccessDeniedPage pega o cadeado de icons/Entrada.js)
//  split : icones divididos por camada (Entrada / Trabalho / Config) e grupos de
//          Configuracoes em navItems viram booleano (hoje ja sao so booleano)
//  fills : menu principal usa o preenchido no item ativo (quando a familia tem)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { SP, arquivo } from './familias.mjs';
import { modulo } from './vendor2.mjs';
import { NOME as NOME_ENTREGA } from './gerar-entrega.mjs';

const [, , nome, ...flags] = process.argv;
const opt = Object.fromEntries(flags.map((f) => (f.includes('=') ? f.split('=') : [f, true])));
const fam = opt.fam || 'atual';
const famBase = fam === 'ph-adapt' ? 'ph' : fam;
const DIR = fs.realpathSync.native(SP).split(path.sep).join('/') + '/var/' + nome + '/';
const SRCB = SP + 'base/frontend/';
if (fs.existsSync(DIR)) throw new Error('pasta da variante ja existe (use outro nome; nada e apagado): ' + DIR);
fs.mkdirSync(DIR + 'frontend', { recursive: true });
for (const f of ['index.html', 'package.json', 'vite.config.js']) fs.copyFileSync(SRCB + f, DIR + 'frontend/' + f);
fs.cpSync(SRCB + 'src', DIR + 'frontend/src', { recursive: true });
fs.cpSync(SRCB + 'public', DIR + 'frontend/public', { recursive: true });
fs.symlinkSync('D:/dw-whatsapp-backend/frontend/node_modules', DIR + 'frontend/node_modules', 'junction');
const S = DIR + 'frontend/src/';
const ler = (f) => fs.readFileSync(S + f, 'utf8').replace(/\r\n/g, '\n');
const gravar = (f, s) => fs.writeFileSync(S + f, s);
function trocar(f, de, para) { const s = ler(f); if (!s.includes(de)) throw new Error(`[${f}] trecho nao encontrado: ${de.slice(0, 60)}`); gravar(f, s.replace(de, para)); }

// export atual -> slot (troca 1:1)
const MAPA = {
  IconSearch: 'busca', IconNewChat: 'adicionar', IconChevronDown: 'chevron-baixo', IconArrowLeft: 'voltar', IconHistory: 'historico', IconTransfer: 'transferir',
  IconCheckCircle: 'encerrar', IconClaim: 'assumir', IconClose: 'fechar', IconAttach: 'anexo', IconEmoji: 'emoji', IconQuickReply: 'resposta-rapida', IconMic: 'microfone',
  IconSend: 'enviar', IconTrash: 'lixeira', IconStop: 'parar', IconPlay: 'play', IconPause: 'pause', IconDownload: 'download', IconPin: 'local', IconLock: 'cadeado',
  IconBellOn: 'sino', IconBellOff: 'sino-mudo', IconChart: 'relatorio', IconSettings: 'configuracoes', IconLogout: 'sair', IconTeam: 'equipe', IconWarning: 'alerta',
  IconChats: 'atendimento', IconUser: 'cliente', IconMegaphone: 'campanha', IconChannel: 'canal', IconSpark: 'ia', IconRules: 'regras', IconPlug: 'integracoes',
  IconTags: 'tag', IconBuilding: 'empresa', IconUserPlus: 'adicionar-usuario', IconMore: 'mais-h', IconRefresh: 'atualizar', IconInfo: 'info', IconFile: 'template',
  IconClock: 'relogio', IconServer: 'servidor', IconBrain: 'ia-cerebro', IconEdit: 'editar',
  // SgpIcons
  IconPix: 'pix', IconBarcode: 'codigo-barras', IconQrCode: 'qr', IconPdfFile: 'pdf', IconInvoiceLink: 'link', IconIdCard: 'documento-cpf', IconCheck: 'check',
  // novos (significados que hoje dividem desenho com outro)
  IconSupervisao: 'supervisao', IconEncerrados: 'encerrados',
};
const ATIVOS = { IconChatsAtivo: 'atendimento', IconSupervisaoAtivo: 'supervisao', IconMegaphoneAtivo: 'campanha', IconChartAtivo: 'relatorio', IconSettingsAtivo: 'configuracoes' };
// modo completo: significados que hoje sao SVG solto, glifo ou emoji
const EXTRA = { I_cancelamento: 'cancelamento', I_financeiro: 'financeiro', I_instalacao: 'instalacao', I_reativacao: 'reativacao', I_robo: 'robo', I_sem_resposta: 'sem-resposta', I_suporte: 'suporte', I_senha: 'senha', I_foto: 'foto', I_video: 'video', I_arquivo: 'arquivo', I_figurinha: 'figurinha', I_zoom_mais: 'zoom-mais', I_zoom_menos: 'zoom-menos', I_chevron_direita: 'chevron-direita', I_falha: 'falha', I_seta_direita: 'seta-direita', I_carga: 'carga', I_lido_entregue: 'lido-entregue', I_tag: 'tag' };
if (opt.completo) Object.assign(MAPA, EXTRA);

// Onde cada export e usado (para dividir por camada)
const inv = JSON.parse(fs.readFileSync(SP + 'inventario.json', 'utf8'));
function camadaDoExport(n) {
  if (n === 'IconLock') return 'Entrada';
  if (n === 'IconEmptyChat') return 'Ilustracao';
  if (n in ATIVOS || n in EXTRA || n === 'IconSupervisao' || n === 'IconEncerrados' || n === 'IconSpinner') return 'Trabalho';
  const us = inv.filter((u) => u.origem === 'WaIcons.' + n || u.origem === 'SgpIcons.' + n);
  return us.some((u) => u.camada === 'raiz' || u.camada === 'entrada') ? 'Trabalho' : 'Config';
}

// 1) Novos significados no menu (todas as variantes, inclusive 'atual', para comparar igual)
trocar('navigation/navItems.js', "icon: IconTeam, level: 'admin' },", "icon: IconSupervisao, level: 'admin' },");
trocar('navigation/navItems.js', 'IconChats, IconTeam,', 'IconChats, IconTeam, IconSupervisao,');
trocar('components/SideNav.jsx', '<IconCheckCircle size={19} />', '<IconEncerrados size={19} />');
trocar('components/SideNav.jsx', 'IconCheckCircle, IconChevronDown', 'IconCheckCircle, IconEncerrados, IconChevronDown');

// 2) Modulo(s) de icones
const ILUSTRACAO = ler('components/icons/WaIcons.jsx').match(/function Svg[\s\S]*?\n\}\n/)[0] + ler('components/icons/WaIcons.jsx').match(/export function IconEmptyChat[\s\S]*?\n\}\n/)[0];
if (fam === 'atual') {
  // atual: IconSupervisao = mesmo desenho de IconTeam; IconEncerrados = IconCheckCircle (hoje e assim)
  gravar('components/icons/WaIcons.jsx', ler('components/icons/WaIcons.jsx') + '\nexport { IconTeam as IconSupervisao, IconCheckCircle as IconEncerrados };\n');
} else {
  const prec = fam === 'ph-adapt' ? ((a) => (s, v) => a[s + '|' + v] ?? 2)(JSON.parse(fs.readFileSync(SP + 'prec-ph-adapt.json', 'utf8'))) : famBase === 'ph' ? 2 : 3;
  const todos = { ...MAPA };
  const itens = (nomes) => nomes.flatMap((n) => {
    if (n in ATIVOS) return arquivo(famBase, ATIVOS[n], true) ? [{ nome: n, slot: ATIVOS[n], variante: 'fill' }] : [];
    if (!(n in todos)) return [];
    // sem equivalente na familia: cai para o slot mais proximo que exista (so para medir bytes)
    const s = arquivo(famBase, todos[n]) ? todos[n] : ({ historico: 'relogio', pix: 'financeiro', 'codigo-barras': 'qr', pdf: 'arquivo', 'lido-entregue': 'check', robo: 'ia', suporte: 'cliente', 'sem-resposta': 'sino-mudo', figurinha: 'emoji' })[todos[n]] || 'info';
    return [{ nome: n, slot: s, variante: 'reg' }];
  });
  const nomesTodos = [...Object.keys(MAPA), ...(opt.fills ? Object.keys(ATIVOS) : [])];
  if (!opt.split) {
    const wa = nomesTodos.filter((n) => !['IconPix', 'IconBarcode', 'IconQrCode', 'IconPdfFile', 'IconInvoiceLink', 'IconIdCard', 'IconCheck'].includes(n));
    let src = modulo(famBase, itens(wa), prec).src;
    gravar('components/icons/WaIcons.jsx', src.replace("import{jsx as j}from'react/jsx-runtime';", "import{jsx as j}from'react/jsx-runtime';\n" + jsxDe(ILUSTRACAO)));
    let sgp = modulo(famBase, itens(['IconPix', 'IconBarcode', 'IconQrCode', 'IconPdfFile', 'IconInvoiceLink', 'IconIdCard', 'IconCheck', 'IconClose']), prec).src;
    sgp += `const _sp=${spinnerDe(famBase, prec)};\nexport function IconSpinner({className='',...p}){return _sp({className:'motion-safe:animate-spin '+className,...p})}\n`;
    gravar('components/icons/SgpIcons.jsx', sgp);
  } else {
    const grupos = { Entrada: [], Trabalho: [], Config: [] };
    for (const n of nomesTodos) { const c = camadaDoExport(n); if (grupos[c]) grupos[c].push(n); }
    if (opt.entrega) {
      // Usa os modulos ENTREGUES (IconesEntrada/Trabalho/Config) sem alteracao; os
      // modulos do harness viram so reexportacoes com os nomes internos dele.
      const ENT = SP + opt.entrega.replace(/\/?$/, '/');
      const exportsDe = {};
      for (const f of ['IconesEntrada', 'IconesTrabalho', 'IconesConfig']) {
        fs.copyFileSync(ENT + f + '.js', S + `components/icons/${f}.js`);
        const src = fs.readFileSync(ENT + f + '.js', 'utf8');
        for (const m of src.matchAll(/export (?:const|function) (\w+)/g)) exportsDe[m[1]] ??= f;
        for (const m of src.matchAll(/export \{ (\w+) \} from/g)) exportsDe[m[1]] ??= f;
      }
      const alvo = (n) => {
        if (n === 'IconSpinner') return 'IconSpinner';
        if (n in ATIVOS) return NOME_ENTREGA[ATIVOS[n]] + 'Fill';
        const slot = n === 'IconSupervisao' ? 'supervisao' : n === 'IconEncerrados' ? 'encerrados' : MAPA[n];
        if (!slot || !NOME_ENTREGA[slot]) throw new Error('sem alvo para ' + n);
        return NOME_ENTREGA[slot];
      };
      grupos.Trabalho.push('IconSpinner');
      for (const [g, ns] of Object.entries(grupos)) {
        const por = {};
        for (const n of ns) {
          const a = alvo(n), m = exportsDe[a];
          if (!m) throw new Error(`export ${a} nao existe na entrega`);
          if (g === 'Trabalho' && m === 'IconesConfig') throw new Error(`${n} (Trabalho) viria de IconesConfig: puxaria Config para "/"`);
          if (g === 'Entrada' && m !== 'IconesEntrada') throw new Error(`${n} (Entrada) viria de ${m}`);
          (por[m] ||= []).push(a === n ? n : `${a} as ${n}`);
        }
        fs.writeFileSync(S + `components/icons/${g}.js`, Object.entries(por).map(([m, l]) => `export { ${l.join(', ')} } from './${m}';`).join('\n') + '\n');
      }
    } else for (const [g, ns] of Object.entries(grupos)) {
      let src = modulo(famBase, itens(ns), prec).src;
      if (g === 'Trabalho') src += `const _sp=${spinnerDe(famBase, prec)};\nexport function IconSpinner({className='',...p}){return _sp({className:'motion-safe:animate-spin '+className,...p})}\n`;
      fs.writeFileSync(S + `components/icons/${g}.js`, src);
    }
    fs.writeFileSync(S + 'components/icons/Ilustracao.jsx', ILUSTRACAO);
    reescreverImports(grupos);
    console.log('divisao:', Object.fromEntries(Object.entries(grupos).map(([k, v]) => [k, v.length])));
  }
}
function jsxDe(codigoJsx) {
  // IconEmptyChat fica como esta (ilustracao, nao e icone). Mantem o JSX: o arquivo continua .jsx
  return codigoJsx;
}
function spinnerDe(f, prec) {
  const m = modulo(f, [{ nome: 'X', slot: arquivo(f, 'carregando') ? 'carregando' : 'atualizar', variante: 'reg' }], prec).src;
  return m.match(/export const X=(R\([\s\S]*?\));\n/)[1];
}
function reescreverImports(grupos) {
  const dono = {};
  for (const [g, ns] of Object.entries(grupos)) for (const n of ns) dono[n] = g;
  dono.IconEmptyChat = 'Ilustracao';
  dono.IconSpinner = 'Trabalho';
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|mjs)$/.test(e.name) || /\.test\./.test(e.name) || p.includes(path.join('components', 'icons'))) continue;
      let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      const novo = s.replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]*)icons\/(WaIcons|SgpIcons)['"];?/g, (m, lista, prefixo) => {
        const nomes = lista.split(',').map((x) => x.trim()).filter(Boolean);
        const por = {};
        for (const n of nomes) { const [orig] = n.split(/\s+as\s+/); const g = dono[orig.trim()] || (orig.trim() === 'IconDevice' ? null : 'Config'); if (g) (por[g] ||= []).push(n); }
        return Object.entries(por).map(([g, ns]) => `import { ${ns.join(', ')} } from '${prefixo}icons/${g}';`).join('\n');
      });
      if (novo !== s) fs.writeFileSync(p, novo);
    }
  })(S);
}

// 3) Arquitetura: entrada sem navItems e sem o modulo de icones
if (opt.arq || opt.split) {
  const nav = ler('navigation/navItems.js');
  const hasLevel = nav.match(/export function hasLevel[\s\S]*?\n\}\n/)[0];
  const redirects = nav.match(/export const LEGACY_REDIRECTS = \[[\s\S]*?\n\];\n/)[0];
  gravar('navigation/rotas.js', `${hasLevel}\nexport const SETTINGS_BASE = '/configuracoes';\nconst s = (path) => \`\${SETTINGS_BASE}/\${path}\`;\n${redirects}`);
  gravar('navigation/navItems.js', nav.replace(hasLevel, "import { hasLevel, SETTINGS_BASE, LEGACY_REDIRECTS } from './rotas';\nexport { hasLevel, SETTINGS_BASE, LEGACY_REDIRECTS };\n").replace("export const SETTINGS_BASE = '/configuracoes';\n", '').replace(redirects, ''));
  trocar('App.jsx', "import { LEGACY_REDIRECTS } from './navigation/navItems';", "import { LEGACY_REDIRECTS } from './navigation/rotas';");
  trocar('components/ProtectedRoute.jsx', "from '../navigation/navItems';", "from '../navigation/rotas';");
  if (!opt.split) {
    // cadeado da AccessDeniedPage em modulo proprio, com o desenho da variante
    const lockSrc = fam === 'atual'
      ? "import{jsx as j}from'react/jsx-runtime';\nexport function IconLock({size=24,...p}){return j('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':'true',focusable:'false',...p,children:j('path',{d:'M17 9h-1V7a4 4 0 10-8 0v2H7a1.5 1.5 0 00-1.5 1.5v9A1.5 1.5 0 007 21h10a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0017 9zM9.8 7a2.2 2.2 0 114.4 0v2H9.8z'})})}\n"
      : modulo(famBase, [{ nome: 'IconLock', slot: 'cadeado', variante: 'reg' }], famBase === 'ph' ? 2 : 3).src;
    fs.writeFileSync(S + 'components/icons/Entrada.js', lockSrc);
    trocar('pages/AccessDeniedPage.jsx', "import { IconLock } from '../components/icons/WaIcons';", "import { IconLock } from '../components/icons/Entrada';");
  }
}
if (opt.split) {
  // grupos de Configuracoes: o icone em navItems so serve de booleano (GroupIcon &&)
  let nav = ler('navigation/navItems.js');
  for (const n of ['IconChannel', 'IconSpark', 'IconRules', 'IconQuickReply', 'IconPlug', 'IconTags', 'IconBuilding']) nav = nav.replace(new RegExp(`icon: ${n},`), 'icon: true,');
  nav = nav.replace(/import \{([^}]*)\} from '..\/components\/icons\/(Trabalho|Config)';\n?/g, (m, lista, g) => {
    const ns = lista.split(',').map((x) => x.trim()).filter((n) => n && !['IconChannel', 'IconSpark', 'IconRules', 'IconQuickReply', 'IconPlug', 'IconTags', 'IconBuilding'].includes(n));
    return ns.length ? `import { ${ns.join(', ')} } from '../components/icons/${g}';\n` : '';
  });
  gravar('navigation/navItems.js', nav);
}
// 3b) Migracao completa: SVGs soltos da raiz, emoji da previa e glifos viram icone da familia
function importar(arq, nomes) {
  const rel = path.posix.relative(path.posix.dirname(arq), 'components/icons/Trabalho');
  gravar(arq, `import { ${nomes.join(', ')} } from '${rel.startsWith('.') ? rel : './' + rel}';\n` + ler(arq));
}
if (opt.completo) {
  if (!opt.split) throw new Error('completo exige split');
  // motivos de contato
  let cr = ler('components/closeReasonCatalog.jsx');
  const ini = cr.indexOf('const STROKE'), fim = cr.indexOf('// Cores fixas');
  if (ini < 0 || fim < 0) throw new Error('closeReasonCatalog mudou');
  cr = cr.slice(0, ini) + "const icons = {\n  cancel: <I_cancelamento size={22} />, dollar: <I_financeiro size={22} />, wrench: <I_instalacao size={22} />,\n  pin: <IconPin size={22} />, refresh: <I_reativacao size={22} />, robot: <I_robo size={22} />, bellOff: <I_sem_resposta size={22} />,\n  headset: <I_suporte size={22} />, key: <I_senha size={22} />, tag: <I_tag size={22} />,\n};\n\n" + cr.slice(fim);
  const h = cr.indexOf('export const closeReasonHeaderIcon');
  if (h < 0) throw new Error('closeReasonHeaderIcon sumiu');
  cr = cr.slice(0, h) + 'export const closeReasonHeaderIcon = <IconChats size={32} />;\nexport const checkCircleIcon = <IconCheckCircle size={17} />;\n';
  gravar('components/closeReasonCatalog.jsx', cr);
  importar('components/closeReasonCatalog.jsx', ['I_cancelamento', 'I_financeiro', 'I_instalacao', 'IconPin', 'I_reativacao', 'I_robo', 'I_sem_resposta', 'I_suporte', 'I_senha', 'I_tag', 'IconChats', 'IconCheckCircle']);
  // tiques de status
  let mt = ler('components/MessageStatusTicks.jsx');
  mt = mt.replace(/function Tick[\s\S]*?\n\}\n/, '');
  mt = mt.replace(/<Tick className="-mr-\[6px\]" \/>\s*<Tick \/>/, '<I_lido_entregue size={16} />').replace('<Tick />', '<IconCheck size={14} />').replace(/\n\s*!\n/, '\n<I_falha size={13} />\n');
  if (/Tick|\n\s*!\n/.test(mt.replace(/MessageStatusTicks/g, ''))) throw new Error('MessageStatusTicks: sobrou Tick ou !');
  gravar('components/MessageStatusTicks.jsx', mt);
  importar('components/MessageStatusTicks.jsx', ['I_lido_entregue', 'IconCheck', 'I_falha']);
  // TransferModal
  let tm = ler('components/TransferModal.jsx');
  tm = tm.replace(/function IconArrowRight[\s\S]*?\n\}\n\nfunction IconBars[\s\S]*?\n\}\n/, '');
  if (/function IconArrowRight|function IconBars/.test(tm)) throw new Error('TransferModal mudou');
  tm = tm.replace(/<IconArrowRight /g, '<I_seta_direita ').replace(/<IconBars /g, '<I_carga ');
  gravar('components/TransferModal.jsx', tm);
  importar('components/TransferModal.jsx', ['I_seta_direita', 'I_carga']);
  // previa da lista: emoji -> icone + texto
  trocar('components/ConversationListItem.jsx', "image: '📷 Foto',\n  audio: '🎤 Áudio',\n  video: '🎥 Vídeo',\n  document: '📄 Documento',\n  sticker: '😀 Figurinha',\n  location: '📍 Localização',\n  pix: '💠 Pix',",
    "image: <><I_foto size={15} />Foto</>,\n  audio: <><IconMic size={15} />Áudio</>,\n  video: <><I_video size={15} />Vídeo</>,\n  document: <><I_arquivo size={15} />Documento</>,\n  sticker: <><I_figurinha size={15} />Figurinha</>,\n  location: <><IconPin size={15} />Localização</>,\n  pix: <><IconPix size={15} />Pix</>,");
  trocar('components/ConversationListItem.jsx', 'aria-label="Triagem com confiança baixa">⚠</span>', 'aria-label="Triagem com confiança baixa"><IconWarning size={13} /></span>');
  importar('components/ConversationListItem.jsx', ['I_foto', 'IconMic', 'I_video', 'I_arquivo', 'I_figurinha', 'IconPin', 'IconPix', 'IconWarning']);
  trocar('components/AiSuggestionCard.jsx', '<li key={nome}>⚠ {ROTULO_ACAO[nome]}</li>', '<li key={nome}><IconWarning size={13} /> {ROTULO_ACAO[nome]}</li>');
  importar('components/AiSuggestionCard.jsx', ['IconWarning']);
  trocar('components/ConversationView.jsx', 'aria-label="Fechar dados do cliente">×</button>', 'aria-label="Fechar dados do cliente"><IconClose size={16} /></button>');
  importar('components/ConversationView.jsx', ['IconClose']);
  let ma = ler('components/MessageAttachment.jsx');
  for (const [de, para] of [[/\n(\s*)✕\n/, '\n$1<IconClose size={20} />\n'], [/\n(\s*)−\n/, '\n$1<I_zoom_menos size={16} />\n'], [/\n(\s*)\+\n/, '\n$1<I_zoom_mais size={16} />\n']]) { if (!de.test(ma)) throw new Error('MessageAttachment: ' + de); ma = ma.replace(de, para); }
  gravar('components/MessageAttachment.jsx', ma);
  importar('components/MessageAttachment.jsx', ['IconClose', 'I_zoom_menos', 'I_zoom_mais']);
  let mi = ler('components/MessageInput.jsx');
  if (!/\n(\s*)✕\n/.test(mi)) throw new Error('MessageInput ✕');
  gravar('components/MessageInput.jsx', mi.replace(/\n(\s*)✕\n/, '\n$1<IconClose size={18} />\n'));
  importar('components/MessageInput.jsx', ['IconClose']);
  trocar('components/ProfileModal.jsx', 'group-open:rotate-180">⌄</span>', 'group-open:rotate-180"><IconChevronDown size={16} /></span>');
  importar('components/ProfileModal.jsx', ['IconChevronDown']);
  trocar('components/ConversationHistoryModal.jsx', '<span className="dialog-history-go" aria-hidden="true">›</span>', '<span className="dialog-history-go" aria-hidden="true"><I_chevron_direita size={16} /></span>');
  importar('components/ConversationHistoryModal.jsx', ['I_chevron_direita']);
  trocar('pages/settings/SettingsLayout.jsx', "${expanded ? 'rotate-90' : ''}`}>›</span>", "${expanded ? 'rotate-90' : ''}`}><I_chevron_direita size={14} /></span>");
  importar('pages/settings/SettingsLayout.jsx', ['I_chevron_direita']);
  trocar('components/CreateChannelModal.jsx', '← Voltar', '<IconArrowLeft size={14} /> Voltar');
  importar('components/CreateChannelModal.jsx', ['IconArrowLeft']);
  trocar('pages/settings/channels/ChannelDetailPage.jsx', '← Todos os canais', '<IconArrowLeft size={14} /> Todos os canais');
  importar('pages/settings/channels/ChannelDetailPage.jsx', ['IconArrowLeft']);
}
// 4) Ativo preenchido no menu principal
if (opt.fills && fam !== 'atual') {
  const mod = opt.split ? 'Trabalho' : 'WaIcons';
  const disponiveis = Object.keys(ATIVOS).filter((n) => arquivo(famBase, ATIVOS[n], true));
  let nav = ler('navigation/navItems.js');
  const pares = { atendimento: 'IconChatsAtivo', supervisao: 'IconSupervisaoAtivo', campanhas: 'IconMegaphoneAtivo', relatorios: 'IconChartAtivo', configuracoes: 'IconSettingsAtivo' };
  for (const [k, n] of Object.entries(pares)) if (disponiveis.includes(n)) nav = nav.replace(new RegExp(`(\\{ key: '${k}',[^\\n]*?icon: \\w+,)`), `$1 iconAtivo: ${n},`);
  if (disponiveis.length) nav = `import { ${disponiveis.join(', ')} } from '../components/icons/${mod}';\n` + nav;
  gravar('navigation/navItems.js', nav);
  trocar('components/SideNav.jsx', '<Icon size={19} />', '{active && item.iconAtivo ? <item.iconAtivo size={19} /> : <Icon size={19} />}');
}

// 5) Build e medida
const cfg = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nexport default defineConfig({ cacheDir: '../vite-cache', plugins: [react(), tailwindcss()], build: { manifest: true, outDir: '../dist', emptyOutDir: true } });\n`;
fs.writeFileSync(DIR + 'frontend/vite.config.js', cfg);
try {
  execFileSync('node', ['node_modules/vite/bin/vite.js', 'build'], { cwd: DIR + 'frontend', stdio: 'pipe' });
} catch (e) { console.error(String(e.stdout || ''), String(e.stderr || '')); throw e; }
const D = DIR + 'dist/';
const man = JSON.parse(fs.readFileSync(D + '.vite/manifest.json', 'utf8'));
function clo(k, set = new Set()) { if (set.has(k)) return set; set.add(k); for (const i of man[k].imports || []) clo(i, set); return set; }
const entry = Object.keys(man).find((k) => man[k].isEntry);
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const br = (b, q) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q } }).length;
function soma(keys) {
  let raw = 0, g = 0, b11 = 0, b4 = 0;
  for (const k of keys) { const b = fs.readFileSync(D + man[k].file); raw += b.length; g += gz(b); b11 += br(b, 11); b4 += br(b, 4); }
  return { chunks: keys.length, raw, gzip: g, br11: b11, br4: b4 };
}
const login = [...clo(entry)];
const raiz = [...new Set([...clo(entry), ...clo('src/components/AppShell.jsx'), ...clo('src/pages/DashboardPage.jsx')])];
const cfgKey = 'src/pages/settings/SettingsLayout.jsx';
const res = { nome, fam, opt, login: soma(login), raiz: soma(raiz), config: soma([...new Set([...raiz, ...clo(cfgKey)])]) };
// chunks de icones gerados
res.chunksIcones = Object.values(man).filter((v) => /\/(Trabalho|Config|Entrada|WaIcons|SgpIcons|Ilustracao)-/.test(v.file)).map((v) => path.basename(v.file) + ' ' + fs.statSync(D + v.file).size + 'B gz' + gz(fs.readFileSync(D + v.file)));
res.entrada = path.basename(man[entry].file) + ' ' + fs.statSync(D + man[entry].file).size + 'B';
fs.mkdirSync(SP + 'resultados', { recursive: true });
fs.writeFileSync(SP + `resultados/${nome}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
