import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Guarda contra a volta silenciosa das caixas nativas do navegador.
//
// Trocar `window.confirm` e `window.alert` em quatro lugares não resolve nada
// se o quinto aparecer na semana que vem. `window.confirm` congela a aba
// inteira (travou o Chrome headless numa validação desta auditoria), não
// respeita a pilha de diálogos, não devolve o foco e não tem o visual do
// produto. Quem precisar perguntar usa `useConfirm`; quem precisar avisar usa
// `useAlert`. Nenhum dos dois exige Provider: o diálogo vai para o portal, então
// funciona de qualquer ponto da árvore — inclusive de dentro de um item de
// lista, que foi justamente o caso que sobrou por último.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)));
const EXTENSOES = /\.(js|jsx)$/;
const IGNORAR = /\.test\.(js|jsx)$/;

function arquivosDeCodigo(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeCodigo(caminho);
    if (!EXTENSOES.test(nome) || IGNORAR.test(nome)) return [];
    return [caminho];
  });
}

describe('caixas nativas do navegador', () => {
  test('nenhum código de produção chama window.confirm ou window.alert', () => {
    const culpados = arquivosDeCodigo(RAIZ)
      .filter((caminho) => !caminho.endsWith('dialogosNativos.test.js'))
      .filter((caminho) => /window\.(confirm|alert)\s*\(/.test(readFileSync(caminho, 'utf8')))
      .map((caminho) => caminho.slice(RAIZ.length + 1).replace(/\\/g, '/'));

    expect(culpados).toEqual([]);
  });
});
