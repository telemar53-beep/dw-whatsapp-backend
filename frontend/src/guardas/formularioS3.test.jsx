import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Guarda da Fatia S3 (diálogos de formulário de Configurações).
//
// - A base mora na área de Configurações e não mexe no WaDialog global.
// - Os sete diálogos (usuário, setor, motivo, cidade ×2, plano ×2) saíram do
//   WaDialog; Templates e a ajuda da Triagem continuam nele, de propósito.
// - Nada de WaIcons, SVG desenhado à mão, blur, gradiente ou laranja antigo
//   na base; as regras das quatro variantes antigas saíram do overlays.css.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ler = (relativo) => readFileSync(join(RAIZ, relativo), 'utf8');
function importsEstaticos(fonte) {
  const limpa = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...limpa.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

const BASE = 'pages/settings/formulario';
const ARQUIVOS_DA_BASE = readdirSync(join(RAIZ, BASE)).filter((n) => !/\.test\./.test(n)).map((n) => `${BASE}/${n}`);
const FORMULARIOS = ['components/CreateAgentForm.jsx', 'components/CreateSectorForm.jsx', 'components/CreateReasonForm.jsx', 'components/CityForm.jsx', 'components/PlanForm.jsx'];
const ABAS = ['components/AgentsAdminTab.jsx', 'components/SectorsAdminTab.jsx', 'components/ReasonsAdminTab.jsx', 'components/CitiesAdminTab.jsx', 'components/PlansAdminTab.jsx'];

describe('S3: a base e os consumidores', () => {
  test('a base mora em Configurações e é a única a usar a folha dela', () => {
    expect(ARQUIVOS_DA_BASE.sort()).toEqual([
      `${BASE}/CampoDeSenha.jsx`, `${BASE}/DialogoDeFormulario.jsx`, `${BASE}/dialogo-de-formulario.css`, `${BASE}/mensagemSegura.js`,
    ].sort());
    expect(importsEstaticos(ler(`${BASE}/DialogoDeFormulario.jsx`))).toContain('../../../components/ui/DialogoClaro');
    expect(importsEstaticos(ler(`${BASE}/DialogoDeFormulario.jsx`))).toContain('./dialogo-de-formulario.css');
  });

  test('os cinco formulários usam a base; as cinco abas não abrem mais o WaDialog', () => {
    FORMULARIOS.forEach((f) => {
      expect(importsEstaticos(ler(f)).some((i) => i.endsWith('pages/settings/formulario/DialogoDeFormulario')), f).toBe(true);
    });
    ABAS.forEach((f) => {
      const fonte = ler(f);
      expect(fonte, f).not.toMatch(/<WaDialog\b/);
      expect(fonte, f).not.toMatch(/\bembedded\b/);
      expect(fonte, f).toMatch(/comoDialogo/);
    });
  });

  test('Templates e a ajuda da Triagem continuam no WaDialog, sem a base da S3', () => {
    ['components/TemplatesAdminTab.jsx', 'components/SectionHelp.jsx'].forEach((f) => {
      const fonte = ler(f);
      expect(fonte, f).toMatch(/<WaDialog\b/);
      expect(importsEstaticos(fonte).some((i) => i.includes('pages/settings/formulario')), f).toBe(false);
    });
  });
});

describe('S3: aparência', () => {
  test('sem WaIcons, biblioteca de ícones ou SVG à mão na base e nos formulários', () => {
    [...ARQUIVOS_DA_BASE.filter((f) => /\.jsx?$/.test(f)), ...FORMULARIOS].forEach((f) => {
      const fonte = ler(f);
      importsEstaticos(fonte).forEach((i) => expect(i, f).not.toMatch(/icons\/|WaIcons|lucide|components\/icones/));
      expect(fonte, f).not.toMatch(/<svg[\s>]/);
    });
  });

  test('a folha da base não tem blur, gradiente, animação nem o laranja antigo', () => {
    // Sem os comentários: eles citam o que a folha evita.
    const folha = ler(`${BASE}/dialogo-de-formulario.css`).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(folha).not.toMatch(/blur|backdrop-filter|gradient|animation|chat-orange|#a46e45|#ff6b35/i);
  });

  test('o "Mostrar" da senha cobre a altura toda do campo (alvo de 44 px)', () => {
    // No mockup o botão fica 1 px para dentro (42 px de altura). Aqui ele
    // encosta nas bordas do campo; a borda transparente deixa a do campo à vista.
    const folha = ler(`${BASE}/dialogo-de-formulario.css`).replace(/\/\*[\s\S]*?\*\//g, '');
    const regra = folha.match(/button\.cfg-dlg-mostrar\s*\{([^}]*)\}/)[1];
    expect(regra).toMatch(/(^|[\s;])top:\s*0;/);
    expect(regra).toMatch(/(^|[\s;])right:\s*0;/);
    expect(regra).toMatch(/(^|[\s;])bottom:\s*0;/);
    expect(regra).toMatch(/background-clip:\s*padding-box/);
    expect(folha).toMatch(/:is\(input, select, textarea\)\.mc-entrada \{[^}]*height: 44px/);
  });

  test('"Adicionando…"/"Salvando…" fica legível: fundo sólido e branco com 4,5:1', () => {
    // A família apaga o botão ocupado com opacity .55 (branco a 2,6:1). Aqui o
    // botão principal ocupado é sólido, no tom do mockup escurecido até 4,5:1.
    const folha = ler(`${BASE}/dialogo-de-formulario.css`).replace(/\/\*[\s\S]*?\*\//g, '');
    const m = folha.match(/\.mc-botao\.is-principal\[aria-disabled='true'\]\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const regra = m[1];
    expect(regra).toMatch(/opacity:\s*1\b/);
    expect(regra).toMatch(/color:\s*#fff(fff)?\b/i);
    const fundo = regra.match(/background:\s*(#[0-9a-f]{6})/i)[1];
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    expect(1.05 / (lum(fundo) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  test('as regras das variantes antigas (users, city, sector, reason) saíram do overlays.css', () => {
    const overlays = ler('components/overlays.css');
    expect(overlays).not.toMatch(/data-dialog=(users|city|sector|reason)\b/);
    expect(overlays).toMatch(/\[data-dialog=help\] > div:nth-child\(2\)/);
  });
});
