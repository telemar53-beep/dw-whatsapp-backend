// Casa o nome de cidade vindo do SGP com as cidades cadastradas no chat.
// Tolerante a acento, caixa e espaços; erro de digitação de até 2 letras só
// vale quando UMA cidade da lista fica parecida — em dúvida, não chuta.

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein clássico, O(n*m). As listas de cidades aqui têm dezenas de itens
// e os nomes são curtos, então não vale complicar com corte por diferença de
// tamanho.
function distancia(a, b) {
  const origem = String(a == null ? '' : a);
  const destino = String(b == null ? '' : b);
  if (origem === destino) return 0;
  if (!origem.length) return destino.length;
  if (!destino.length) return origem.length;

  let anterior = new Array(destino.length + 1);
  for (let j = 0; j <= destino.length; j += 1) anterior[j] = j;

  for (let i = 1; i <= origem.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= destino.length; j += 1) {
      const custo = origem[i - 1] === destino[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        atual[j - 1] + 1, // inserção
        anterior[j] + 1, // remoção
        anterior[j - 1] + custo // substituição
      );
    }
    anterior = atual;
  }

  return anterior[destino.length];
}

const TOLERANCIA = 2;

function encontrarCidade(nome, cidades) {
  const alvo = normalizar(nome);
  if (!alvo) return null;
  const lista = Array.isArray(cidades) ? cidades : [];
  const exata = lista.find((c) => normalizar(c.name) === alvo);
  if (exata) return exata;
  const proximas = lista.filter((c) => distancia(normalizar(c.name), alvo) <= TOLERANCIA);
  return proximas.length === 1 ? proximas[0] : null;
}

module.exports = { encontrarCidade, normalizar, distancia, TOLERANCIA };
