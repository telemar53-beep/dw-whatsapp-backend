import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// O jsdom não aplica CSS: a folha do popup é lida como texto e as regras são
// conferidas uma a uma — sem desfoque, sem animação, overlay sólido, tela
// cheia no celular, nome contido e alvos de 44 px no toque.

const AQUI = dirname(fileURLToPath(import.meta.url));
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '');
const ARQUIVO = join(AQUI, 'popup-da-supervisao.css');
const CSS = existsSync(ARQUIVO) ? semComentarios(readFileSync(ARQUIVO, 'utf8')) : '';
const fonte = (nome) => (existsSync(join(AQUI, nome)) ? readFileSync(join(AQUI, nome), 'utf8') : '');

function declaracoes(corpo) {
  return corpo
    .split(';')
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const i = linha.indexOf(':');
      return [linha.slice(0, i).trim(), linha.slice(i + 1).trim()];
    });
}

function regras(css) {
  const saida = [];
  const pilha = [];
  let buffer = '';
  for (const c of css) {
    if (c === '{') {
      pilha.push(buffer.trim());
      buffer = '';
    } else if (c === '}') {
      const cabeca = pilha.pop();
      if (cabeca && !cabeca.startsWith('@')) {
        saida.push({ midia: pilha.filter((b) => b.startsWith('@')).join(' '), seletor: cabeca, declaracoes: declaracoes(buffer) });
      }
      buffer = '';
    } else {
      buffer += c;
    }
  }
  return saida;
}

const REGRAS = regras(CSS);
const px = (v) => Number(String(v).match(/(-?\d*\.?\d+)px/)?.[1]);
const SEM_MIDIA = (m) => m === '';
const CELULAR = (m) => /max-width:\s*767px/.test(m);
const TOQUE = (m) => /pointer:\s*coarse/.test(m);
function valor(trecho, propriedade, midia = SEM_MIDIA) {
  return REGRAS
    .filter((r) => r.seletor.split(',').some((s) => s.trim() === trecho) && midia(r.midia))
    .flatMap((r) => r.declaracoes)
    .filter(([p]) => p === propriedade)
    .map(([, v]) => v)
    .at(-1);
}
const todas = (propriedade) => REGRAS.flatMap((r) => r.declaracoes.filter(([p]) => p === propriedade).map(([, v]) => ({ seletor: r.seletor, v })));

const DIALOGO = "[data-dialog='supervisao-conversa'].dw-dialog";
const FUNDO = ".chat-theme:has(> [data-dialog='supervisao-conversa'])";

describe('popup-da-supervisao.css: leve e claro', () => {
  test('a folha existe e vem com o popup, não com a página', () => {
    expect(CSS.length).toBeGreaterThan(0);
    expect(fonte('PopupDaSupervisao.jsx')).toMatch(/import '\.\/popup-da-supervisao\.css'/);
    const pagina = readFileSync(join(AQUI, '..', '..', 'pages', 'SupervisionPage.jsx'), 'utf8');
    expect(pagina).not.toMatch(/popup-da-supervisao\.css/);
  });

  test('sem desfoque, gradiente, animação ou transição em massa', () => {
    todas('backdrop-filter').forEach(({ v }) => expect(v).toBe('none'));
    expect(CSS).not.toMatch(/gradient\(/);
    todas('animation').forEach(({ v }) => expect(v).toBe('none'));
    expect(CSS).not.toMatch(/@keyframes/);
    todas('transition').forEach(({ v }) => expect(v).not.toMatch(/\ball\b/));
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  test('overlay sólido e discreto, sem desfoque, e o diálogo sem a animação da base', () => {
    expect(valor(FUNDO, 'backdrop-filter')).toBe('none');
    expect(valor(FUNDO, 'background')).toMatch(/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0?\.\d+\s*\)$/);
    expect(valor(DIALOGO, 'animation')).toBe('none');
    expect(valor(DIALOGO, 'backdrop-filter')).toBe('none');
    expect(valor(DIALOGO, 'background')).toBe('#ffffff');
  });

  test('sombras curtas: nenhuma com opacidade acima de 0,24', () => {
    todas('box-shadow').forEach(({ v }) => {
      if (v === 'none') return;
      const alfas = [...v.matchAll(/rgba\([^)]*,\s*(0?\.\d+|1|0)\s*\)/g)].map((m) => Number(m[1]));
      alfas.forEach((a) => expect(a).toBeLessThanOrEqual(0.24));
    });
  });

  test('nada do laranja herdado nem do tema escuro antigo', () => {
    expect(CSS).not.toMatch(/orange|#ff8d40|#f97316|#ea580c|#c2410c|--wa-overlay-blur|--wa-dialog-blur/i);
    expect(CSS).not.toMatch(/\[data-dialog=['"]?conversation['"]?\]/);
  });

  test('celular: tela cheia, sem moldura nem margem', () => {
    expect(valor(FUNDO, 'padding', CELULAR)).toBe('0');
    expect(valor(DIALOGO, 'border-radius', CELULAR)).toBe('0');
    expect(valor(DIALOGO, 'height', CELULAR)).toBe('100dvh');
    expect(valor(DIALOGO, 'max-width', CELULAR)).toBe('none');
  });

  test('nome longo não quebra o cabeçalho: uma linha, com reticências', () => {
    expect(valor('.sp-cab-nome', 'white-space')).toBe('nowrap');
    expect(valor('.sp-cab-nome', 'overflow')).toBe('hidden');
    expect(valor('.sp-cab-nome', 'text-overflow')).toBe('ellipsis');
    expect(valor('.sp-cab-nome', 'min-width')).toBe('0');
  });

  test('toque: alvos de 44 px no cabeçalho, no menu e na faixa', () => {
    ['.sp-cab .sp-botao', '.sp-menu .sp-menu-item', '.sp-cab .sp-cab-voltar', '.sp-cab .sp-atalho', '.sp-faixa .sp-faixa-assumir'].forEach((trecho) => {
      const altura = valor(trecho, 'min-height', TOQUE) || valor(trecho, 'height', TOQUE);
      expect(px(altura), trecho).toBeGreaterThanOrEqual(44);
    });
  });
});

// Revisão de 27/09: o diálogo base (overlays.css) e a ordem de carga das
// folhas mexiam na conversa aprovada dentro do popup.
const CONVERSA = "[data-dialog='supervisao-conversa'].dw-dialog.chat-workspace .mesa-conversa";
describe('popup-da-supervisao.css: a conversa igual à da mesa, venha de onde vier', () => {
  test('o anel de foco dos itens do menu fica por dentro (vence a regra geral do tema)', () => {
    expect(valor("[data-dialog='supervisao-conversa'].dw-dialog .sp-menu .sp-menu-item:focus-visible", 'outline-offset')).toBe('-2px');
  });

  test('o diálogo base não encolhe os emojis nem a pílula do compositor', () => {
    expect(valor(`${CONVERSA} .dialog-emoji-picker button`, 'font-size')).toBe('20px');
    expect(valor(`${CONVERSA} .chat-workspace-composer form > div`, 'flex')).toBe('1 1 0%');
    expect(valor(`${CONVERSA} .chat-workspace-composer form > div > button`, 'padding')).toBe('0');
  });

  // A base que a mesa recebe do dashboard.css (só a mesa o carrega): sem ela
  // aqui, o popup mudava conforme a mesa já tivesse sido aberta ou não.
  test('a base da conversa da mesa vale no popup mesmo sem o dashboard.css', () => {
    expect(valor(`${CONVERSA} .chat-workspace-system-note`, 'background')).toBe('none');
    expect(valor(`${CONVERSA} .chat-workspace-system-note`, 'padding')).toBe('3px 0');
    expect(valor(`${CONVERSA} .chat-workspace-bubble:has(.chat-workspace-message-text)`, 'max-width')).toBe('min(85%, 510px)');
    expect(valor(`${CONVERSA} .chat-workspace-bubble:has(.chat-voice-note)`, 'max-width')).toBe('min(90%, 340px)');
    expect(valor(`${CONVERSA} .chat-message-author`, 'display')).toBe('block');
    expect(valor(`${CONVERSA} .chat-workspace-composer textarea`, 'background')).toBe('none');
    expect(valor(`${CONVERSA} .chat-workspace-composer textarea`, 'border')).toBe('0');
    expect(valor(`${CONVERSA} .chat-ai-suggestion`, 'display')).toBe('grid');
  });

  test('ajustes da revisão visual: nome, Fechar e atalhos', () => {
    expect(valor('.sp-cab-nome', 'font-size')).toBe('18px');
    expect(valor('.sp-cab.is-celular .sp-cab-nome', 'font-size')).toBe('16px');
    expect(valor('.sp-cab .sp-botao.is-fechar', 'padding')).toBe('0 10px');
    expect(valor('.sp-cab .sp-atalho', 'border')).toMatch(/var\(--sp-indigo-linha\)/);
  });
});

describe('fontes do popup: só a família DW', () => {
  // O popup não importa o módulo da mesa: se importasse, o empacotador tiraria
  // o ConversaDaMesa do trecho da mesa (2 arquivos a mais na rota /). Ele
  // importa só a folha clara, direto; e a ConversationView (trecho que os
  // Encerrados também baixam) continua sem ela (guardas/mesaSobDemanda).
  test('o popup não puxa o módulo da mesa: só a folha clara, direto', () => {
    ['PopupDaSupervisao.jsx', 'ConversaDaSupervisao.jsx'].forEach((nome) => {
      expect(fonte(nome)).not.toMatch(/ConversaDaMesa'/);
    });
    expect(fonte('PopupDaSupervisao.jsx')).toMatch(/import '\.\.\/conversa-mesa\.css';/);
    const conversa = readFileSync(join(AQUI, '..', 'ConversationView.jsx'), 'utf8');
    expect(conversa).not.toMatch(/conversa-mesa\.css/);
  });

  test('nenhum ícone da família antiga nos arquivos do popup', () => {
    ['PopupDaSupervisao.jsx', 'ConversaDaSupervisao.jsx'].forEach((nome) => {
      const texto = fonte(nome);
      expect(texto.length, nome).toBeGreaterThan(0);
      expect(texto).not.toMatch(/icons\/(WaIcons|SgpIcons)/);
    });
  });
});
