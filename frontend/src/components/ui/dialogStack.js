// Uma pilha só para todos os diálogos modais do produto.
//
// Antes cada diálogo tinha o próprio listener de ESC no `document` e o próprio
// z-index escrito à mão. O preço era visível: em "Encerrados → conversa" um
// único ESC fechava os dois de uma vez, e a conversa só aparecia na frente
// porque alguém descobriu na marra que precisava de um número maior que o do
// diálogo que a abriu.
//
// É um módulo, e não um Provider, de propósito: diálogo montado fora do
// AppShell — um teste, um fluxo que ainda não passa pela casca — continua
// entrando na pilha. Não existe caminho em que "faltou o Provider" degrade o
// comportamento em silêncio.

const pilha = [];
const ouvintes = new Set();

// Passo entre camadas. A base (--z-dialog) mora no CSS; a multiplicação por
// profundidade acontece aqui, em JavaScript, e o que vai para o style é sempre
// um valor CSS válido.
export const PASSO_DE_CAMADA = 10;

function avisar() {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

function aoTeclar(evento) {
  if (evento.key !== 'Escape' || evento.defaultPrevented) return;
  const topo = pilha[pilha.length - 1];
  if (!topo || !topo.fecharComEsc) return;
  // Só o topo responde. Sem isto, dois níveis abertos somem com um ESC só.
  evento.preventDefault();
  evento.stopPropagation();
  topo.fechar();
}

function ligarTeclado() {
  if (pilha.length !== 1) return;
  document.addEventListener('keydown', aoTeclar);
}

function desligarTeclado() {
  if (pilha.length !== 0) return;
  document.removeEventListener('keydown', aoTeclar);
}

export function inscrever(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

// Entra no topo. Devolve a função de saída, que é o único jeito de sair.
export function entrar(entrada) {
  pilha.push(entrada);
  ligarTeclado();
  avisar();
  return function sair() {
    const posicao = pilha.indexOf(entrada);
    if (posicao === -1) return;
    pilha.splice(posicao, 1);
    desligarTeclado();
    avisar();
  };
}

export function posicaoDe(entrada) {
  const profundidade = pilha.indexOf(entrada);
  return {
    profundidade: profundidade < 0 ? 0 : profundidade,
    topo: profundidade === -1 || profundidade === pilha.length - 1,
  };
}

export function topoDaPilha() {
  return pilha[pilha.length - 1] || null;
}

export function altura() {
  return pilha.length;
}
