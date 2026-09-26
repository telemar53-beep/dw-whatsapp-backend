import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Icones from './index';
import * as IconesSgp from './sgp';
import * as IconesAntigos from '../icons/WaIcons';
import * as IconesAntigosSgp from '../icons/SgpIcons';

// Os 25 das pranchas 1 e 2, mais Campanhas, Som desativado e Menu (mesa), e
// os cinco do painel SGP (prancha da fatia 3). Qualquer ícone novo entra aqui
// junto, e passa pelas mesmas regras.
const NOMES = [
  'IconeAtendimento',
  'IconeFilas',
  'IconeEquipe',
  'IconeCanais',
  'IconeCampanhas',
  'IconeRelatorios',
  'IconeConfiguracoes',
  'IconeNovaConversa',
  'IconeMaisOpcoes',
  'IconeBuscar',
  'IconeInformacoes',
  'IconeConsultarSgp',
  'IconeTransferir',
  'IconeEncerrar',
  'IconeHistorico',
  'IconeDadosCliente',
  'IconeRecolher',
  'IconeAssumir',
  'IconeAnexar',
  'IconeRespostasRapidas',
  'IconeEmoji',
  'IconeMicrofone',
  'IconeEnviar',
  'IconeSom',
  'IconeSomDesativado',
  'IconeEncerrados',
  'IconeSair',
  'IconeMenu',
  'IconeCodigoPix',
  'IconeQrPix',
  'IconeCodigoBarras',
  'IconeLinkFatura',
  'IconePdfFatura',
];

// Os do painel SGP, desenhados na fatia 3.
const DO_SGP = ['IconeCodigoPix', 'IconeQrPix', 'IconeCodigoBarras', 'IconeLinkFatura', 'IconePdfFatura'];

// A exceção da família: a marca Pix é um sólido. Só estes podem ter traço
// preenchido, e só na cor do texto.
const COM_MARCA_PIX = ['IconeCodigoPix', 'IconeQrPix'];
const CHEIO = { fill: 'currentColor', stroke: 'none' };

// A família inteira: o índice (mesa e demais telas) e o módulo do painel SGP.
const FAMILIA = { ...Icones, ...IconesSgp };

// Só geometria nos traços. Cor, espessura, terminação e preenchimento são da
// moldura, iguais para a família inteira; qualquer atributo fora desta lista
// é um ícone saindo da família.
const GEOMETRIA = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  line: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'width', 'height', 'rx'],
};

const FONTES = import.meta.glob(['./*.js', './*.jsx', '!./*.test.*'], { query: '?raw', import: 'default', eager: true });

function desenhar(Componente, props = {}) {
  const { container } = render(<Componente {...props} />);
  return container.querySelector('svg');
}

describe('família de ícones DW', () => {
  test('exporta exatamente os 33 ícones da família: 28 no índice e os 5 do painel SGP no módulo dele', () => {
    const doIndice = Object.keys(Icones).filter((nome) => nome.startsWith('Icone') && nome !== 'Icone');
    const doSgp = Object.keys(IconesSgp).filter((nome) => nome.startsWith('Icone'));
    expect(doIndice.sort()).toEqual(NOMES.filter((nome) => !DO_SGP.includes(nome)).sort());
    expect(doSgp.sort()).toEqual([...DO_SGP].sort());
  });

  // O painel do SGP chega sob demanda; a mesa importa o índice em toda
  // conversa. Se o índice levasse o módulo do SGP, a marca Pix viajaria junto.
  test('o índice da família não leva os desenhos do painel SGP', () => {
    expect(FONTES['./index.jsx']).not.toMatch(/desenhosSgp|['"]\.\/sgp['"]/);
    expect(FONTES['./desenhos.js']).not.toMatch(/codigoPix|qrPix|codigoBarras|linkFatura|pdfFatura/);
  });

  test.each(NOMES)('%s: moldura única da família', (nome) => {
    const svg = desenhar(FAMILIA[nome]);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  });

  test.each(NOMES)('%s: traços só com geometria, sem cor fixa', (nome) => {
    const svg = desenhar(FAMILIA[nome]);
    const tracos = [...svg.children];
    expect(tracos.length).toBeGreaterThan(0);
    tracos.forEach((traco) => {
      const geometria = GEOMETRIA[traco.localName];
      expect(geometria, `<${traco.localName}> não é traço da família`).toBeDefined();
      const cheio = traco.hasAttribute('fill');
      const permitidos = cheio && COM_MARCA_PIX.includes(nome) ? [...geometria, ...Object.keys(CHEIO)] : geometria;
      [...traco.attributes].forEach(({ name, value }) => {
        expect(permitidos, `atributo ${name} em <${traco.localName}>`).toContain(name);
        if (name in CHEIO) expect(value, `${name} em ${nome}`).toBe(CHEIO[name]);
      });
    });
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  test.each(NOMES)('%s: coordenadas absolutas dentro da grade de 24', (nome) => {
    const svg = desenhar(FAMILIA[nome]);
    [...svg.children].forEach((traco) => {
      [...traco.attributes].forEach(({ name, value }) => {
        // Comando em minúscula é relativo: difícil de revisar a olho e de
        // conferir contra a grade.
        if (name === 'd') expect(value, `comando relativo em ${nome}`).not.toMatch(/[a-z]/);
        (value.match(/-?\d*\.?\d+/g) || []).map(Number).forEach((numero) => {
          expect(numero).toBeGreaterThanOrEqual(0);
          expect(numero).toBeLessThanOrEqual(24);
        });
      });
    });
  });

  test('só a marca Pix é preenchida, e na cor do texto', () => {
    NOMES.forEach((nome) => {
      const cheios = [...desenhar(FAMILIA[nome]).children].filter((traco) => traco.hasAttribute('fill'));
      if (COM_MARCA_PIX.includes(nome)) expect(cheios.length, nome).toBeGreaterThan(0);
      else expect(cheios, nome).toEqual([]);
      cheios.forEach((traco) => {
        expect(traco.getAttribute('fill')).toBe('currentColor');
        expect(traco.getAttribute('stroke')).toBe('none');
      });
    });
  });

  // Colisão acidental: dois ícones com o mesmo desenho inteiro. Repetir um
  // traço é permitido de propósito (a moldura de conversa, o sino), mas os do
  // painel SGP são desenhos novos e não herdam traço de ninguém.
  test('nenhum ícone repete o desenho inteiro de outro', () => {
    const vistos = new Map();
    NOMES.forEach((nome) => {
      const desenho = desenhar(FAMILIA[nome]).innerHTML;
      expect(vistos.get(desenho), `${nome} repete ${vistos.get(desenho)}`).toBeUndefined();
      vistos.set(desenho, nome);
    });
  });

  test('os ícones do painel SGP não reaproveitam traço de outro ícone', () => {
    const deOutros = new Set();
    NOMES.filter((nome) => !DO_SGP.includes(nome)).forEach((nome) => {
      [...desenhar(FAMILIA[nome]).children].forEach((traco) => deOutros.add(traco.outerHTML));
    });
    DO_SGP.forEach((nome) => {
      [...desenhar(FAMILIA[nome]).children].forEach((traco) => {
        expect(deOutros.has(traco.outerHTML), nome).toBe(false);
      });
    });
  });

  test.each(DO_SGP)('%s: com título, vira imagem com nome acessível', (nome) => {
    const Componente = FAMILIA[nome];
    render(<Componente titulo="Ação do painel" />);
    const imagem = screen.getByRole('img', { name: 'Ação do painel' });
    expect(imagem.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  test('decorativo por padrão: fora da árvore de acessibilidade', () => {
    const svg = desenhar(Icones.IconeBuscar);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('role')).toBeNull();
  });

  test('com título, vira imagem com nome acessível', () => {
    render(<Icones.IconeBuscar titulo="Buscar conversa" />);
    const imagem = screen.getByRole('img', { name: 'Buscar conversa' });
    expect(imagem.getAttribute('aria-hidden')).toBeNull();
  });

  test('tamanho padrão de 20 px, ajustável', () => {
    const padrao = desenhar(Icones.IconeEnviar);
    expect(padrao.getAttribute('width')).toBe('20');
    expect(padrao.getAttribute('height')).toBe('20');
    const pequeno = desenhar(Icones.IconeEnviar, { tamanho: 16 });
    expect(pequeno.getAttribute('width')).toBe('16');
    expect(pequeno.getAttribute('height')).toBe('16');
  });

  test('props não trocam espessura, cor, preenchimento nem grade da família', () => {
    const svg = desenhar(Icones.IconeBuscar, {
      strokeWidth: 3,
      stroke: 'red',
      fill: 'red',
      viewBox: '0 0 10 10',
      className: 'minha-classe',
    });
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('class')).toBe('minha-classe');
  });

  // Prova só a cópia literal. Semelhança de desenho se julga na prancha.
  test('nenhum traço repete os ícones antigos', () => {
    const antigos = new Set();
    [IconesAntigos, IconesAntigosSgp].forEach((modulo) => {
      Object.values(modulo).forEach((Componente) => {
        if (typeof Componente !== 'function') return;
        const { container } = render(<Componente />);
        container.querySelectorAll('path').forEach((traco) => antigos.add(traco.getAttribute('d')));
      });
    });
    expect(antigos.size).toBeGreaterThan(30);
    NOMES.forEach((nome) => {
      desenhar(FAMILIA[nome]).querySelectorAll('path').forEach((traco) => {
        expect(antigos.has(traco.getAttribute('d')), nome).toBe(false);
      });
    });
  });

  test('o módulo só importa React e arquivos da própria pasta', () => {
    const arquivos = Object.keys(FONTES);
    expect(arquivos).toEqual(expect.arrayContaining(['./Icone.jsx', './desenhos.js', './index.jsx']));
    Object.entries(FONTES).forEach(([arquivo, fonte]) => {
      const origens = [...fonte.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((achado) => achado[1]);
      origens.forEach((origem) => {
        expect(origem === 'react' || origem.startsWith('./'), `${arquivo} importa ${origem}`).toBe(true);
      });
    });
    // Os desenhos são dados puros: a prancha os lê direto no Node, sem React.
    expect(FONTES['./desenhos.js']).not.toMatch(/^\s*import\s/m);
    expect(FONTES['./desenhosSgp.js']).not.toMatch(/^\s*import\s/m);
    expect(FONTES['./desenhoRespostasRapidas.js']).not.toMatch(/^\s*import\s/m);
  });
});
