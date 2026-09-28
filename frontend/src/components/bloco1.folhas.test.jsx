import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// As folhas do Bloco 1 (28/09): claras, sólidas e paradas. Nada de desfoque,
// animação, gradiente, brilho ou laranja; nada de transição em massa; nenhuma
// rolagem lateral forçada; e os diálogos grandes vão para a tela cheia no
// celular. O estilo computado de verdade é conferido no navegador (capturas).

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (arquivo) => readFileSync(join(AQUI, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const FOLHAS = [
  ['ui/dialogo-claro.css', null],
  ['dialogo-equipe.css', 'team'],
  ['dialogo-perfil.css', null],
  ['dialogo-nova-conversa.css', null],
  ['dialogo-template.css', 'send-template'],
  ['encerrados.css', 'closed'],
  ['aviso-de-conexao.css', null],
];

describe.each(FOLHAS)('%s', (arquivo, telaCheia) => {
  test('sem desfoque, animação, transição, gradiente, brilho ou laranja', () => {
    const folha = ler(arquivo);
    expect(folha).not.toMatch(/blur\(|backdrop-filter:(?!\s*none)/);
    expect(folha).not.toMatch(/animation:(?!\s*none)|@keyframes/);
    expect(folha).not.toMatch(/transition:/);
    expect(folha).not.toMatch(/gradient\(/);
    expect(folha).not.toMatch(/drop-shadow|text-shadow/);
    expect(folha).not.toMatch(/#(e5a16d|ff8d40|f5a524|d5a176|c39b75|ff9a6e|f2a93c|f0b65f)\b/i);
    expect(folha).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(folha).not.toMatch(/min-width:\s*\d{3,}px/);
  });

  if (telaCheia) {
    test('no celular, tela cheia', () => {
      expect(ler(arquivo)).toMatch(new RegExp(`\\[data-dialog='${telaCheia}'\\]\\.dw-dialog\\.mc\\.is-celular\\s*\\{[^}]*height:\\s*100dvh`));
    });
  }
});

test('a sombra da moldura é curta e uma só', () => {
  const sombras = [...ler('ui/dialogo-claro.css').matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]).filter((v) => v !== 'none');
  expect(sombras).toEqual(['0 18px 40px -18px rgba(20, 23, 40, 0.24)']);
});
