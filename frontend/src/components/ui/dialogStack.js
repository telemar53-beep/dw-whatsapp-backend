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
// O passo entre diálogos empilhados mora no CSS, junto da base `--z-dialog`.
// Antes o `10` estava escrito nos dois lugares e só o do JavaScript tinha
// efeito: mexer no token não mudava nada, e a divergência passaria despercebida.
// Agora existe uma fonte de verdade só, e o número daqui é apenas o resgate
// para quando não há CSS (teste em jsdom, render no servidor).
const PASSO_PADRAO = 10;
let passoLido = null;

export function passoDeCamada() {
  if (passoLido !== null) return passoLido;
  let lido = NaN;
  if (typeof window !== 'undefined' && document.documentElement) {
    lido = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--z-dialog-step'), 10);
  }
  passoLido = Number.isFinite(lido) && lido > 0 ? lido : PASSO_PADRAO;
  return passoLido;
}

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

// Trava do fundo. É a pilha que trava e destrava, uma vez só: o segundo e o
// terceiro diálogo não criam travas próprias, e o fundo continua travado
// enquanto qualquer nível existir. O estilo inline anterior do body é devolvido
// exatamente como estava — inclusive quando era vazio.
let fundoTravado = null;

function medirBarraDeRolagem() {
  const raiz = document.documentElement;
  return Math.max(0, window.innerWidth - raiz.clientWidth);
}

function travarFundo() {
  if (pilha.length !== 1 || typeof document === 'undefined' || fundoTravado) return;
  const corpo = document.body;
  fundoTravado = {
    overflow: corpo.style.overflow,
    paddingRight: corpo.style.paddingRight,
  };
  // `overflow:hidden` no body não mexe na posição de rolagem (ao contrário de
  // `position:fixed`), então a página fica onde estava.
  corpo.style.overflow = 'hidden';
  // Compensação só existe se existir barra de verdade. Hoje, nesta aplicação,
  // o documento nunca rola (a casca é h-dvh e toda rolagem é interna), então
  // isto é rede de segurança e não muda nada — foi medido, não suposto.
  const barra = medirBarraDeRolagem();
  if (barra > 0) corpo.style.paddingRight = `${barra}px`;
}

function destravarFundo() {
  if (pilha.length !== 0 || !fundoTravado) return;
  const corpo = document.body;
  corpo.style.overflow = fundoTravado.overflow;
  corpo.style.paddingRight = fundoTravado.paddingRight;
  if (!corpo.getAttribute('style')) corpo.removeAttribute('style');
  fundoTravado = null;
}

export function inscrever(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

// Entra no topo. Devolve a função de saída, que é o único jeito de sair.
export function entrar(entrada) {
  pilha.push(entrada);
  ligarTeclado();
  travarFundo();
  avisar();
  return function sair() {
    const posicao = pilha.indexOf(entrada);
    if (posicao === -1) return;
    pilha.splice(posicao, 1);
    desligarTeclado();
    destravarFundo();
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
