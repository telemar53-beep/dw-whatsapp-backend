// TODOS os ganchos que o roteiro usa para achar coisas na pagina.
// Quando o redesenho mexer na interface, este e o UNICO arquivo a revisar.
//
// Regra: papel (role) + nome acessivel, ou texto das fixtures. Classe CSS nao
// decide nada que entre no RESUMO — so rotula exemplos nos JSON de detalhe
// (lib/coleta-dom.mjs: SEMANTICO/contexto/tipoDaPeca).
//
// Se um gancho deixar de achar o alvo, a etapa falha por tempo esgotado com o
// seletor na mensagem; nunca mede outra coisa em silencio.
import * as F from './fixtures.mjs';

export const ROTAS = {
  atendimento: '/',
  login: '/login',
  supervisao: '/supervisao',
  relatorios: '/relatorios',
  canais: '/configuracoes/canais',
};

// Nomes acessiveis (aria-label ou texto do botao) e rotulos de aba.
export const NOMES = {
  navegacao: 'Navegação principal', // <nav aria-label>
  lista: 'Atendimentos', // <aside aria-label> da coluna da lista
  abas: { andamento: 'Atendimento', espera: 'Espera', automacao: 'Automação' },
  consultarSgp: 'Consultar SGP',
  fecharSgp: 'Fechar consulta SGP',
  regiaoSgp: 'Consulta SGP', // role=region
  dadosDoCliente: 'Dados do cliente', // botao E painel (complementary)
  fecharDadosDoCliente: 'Fechar dados do cliente',
  naoLida: 'Mensagem não lida', // marca de nao lida no item
};

// Textos que vem das fixtures ou da copia do produto.
export const TEXTOS = {
  carregando: 'Carregando', // Skeleton: <div role=status><span class=sr-only>Carregando…</span>
  reconectando: 'Reconectando', // indicador do menu (aria-label) e faixa da casca (texto)
  faixaReconectando: 'Reconectando… as mensagens',
  sgpCarregado: 'MARIA JOSE', // nome do cliente devolvido pelo SGP simulado
  transferencia: 'Meu nome é Carla', // mensagem de abertura do atendente
  relatoriosPronto: 'Atendimentos encerrados',
  canaisPronto: 'DW Comercial',
};

// Conversas do roteiro: nome no item da lista + 1a e ultima mensagem (se as
// duas estao no <main>, a conversa inteira foi pintada no mesmo commit).
const textos = (msgs) => {
  const t = msgs.filter((m) => m.content).map((m) => m.content);
  return [t[0], t[t.length - 1]];
};
export const CONVERSAS = {
  A: { nome: 'Maria José', textos: textos(F.mensagensDaConversaA('x')) },
  B: { nome: 'Antônio Carlos', textos: textos(F.mensagensDaConversaB('x')) },
};

// Marcos gravados por MutationObserver (performance.now()). `sel` e um
// seletor; com `texto`, algum elemento do seletor precisa conter o texto.
export const MARCOS = {
  raiz: { sel: '#root > *' },
  esqueleto: { sel: '[role=status]', texto: TEXTOS.carregando },
  casca: { sel: `nav[aria-label="${NOMES.navegacao}"]` },
  mesa: { sel: `[aria-label="${NOMES.lista}"]` },
  primeiroItem: { sel: '[role=tabpanel] li' },
  formLogin: { sel: 'form input[type=email]' },
};

// Elementos que so existem porque o socket.io esta bloqueado por instrucao:
// o indicador fixo do menu e a faixa de 3 s da casca. Ambos sao role=status
// com "Reconectando" no nome acessivel ou no texto.
export const ARTEFATOS = [{ role: 'status', texto: TEXTOS.reconectando }];

// Chunks que o M6 segura para fotografar o esqueleto do Suspense. Achados pelo
// manifesto do Vite (build com --manifest) pela fonte; sem manifesto, pelo nome.
export const CHUNKS_M6 = [
  { id: 'appshell', fonte: 'src/components/AppShell.jsx', nome: 'AppShell' },
  { id: 'dashboardpage', fonte: 'src/pages/DashboardPage.jsx', nome: 'DashboardPage' },
];

// ---------- expressoes avaliadas na pagina ----------
const J = JSON.stringify;

// Nome acessivel "suficiente" para o que o produto usa: aria-label, senao texto.
const NOME_JS = `(e) => (e.getAttribute('aria-label') || e.textContent || '').trim()`;
const VISIVEL_JS = `(e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }`;

export const exprItens = `document.querySelectorAll('[role=tabpanel] li')`;
export const exprTemItem = `document.querySelector('[role=tabpanel] li')`;

// Linha clicavel do item cuja conversa contem o nome (role=button dentro do <li>;
// na variante rail o nome esta so no aria-label).
export const elConversa = (nome) =>
  `[...document.querySelectorAll('[role=tabpanel] li [role=button]')].find((r) => ((r.getAttribute('aria-label') || '') + ' ' + r.textContent).includes(${J(nome)}))`;

export const elAba = (rotulo) => `[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim().startsWith(${J(rotulo)}))`;

// Botao (nativo ou role=button) pelo nome acessivel; prefere o visivel.
export const elBotao = (nome) => `(() => {
  const nomeDe = ${NOME_JS};
  const visivel = ${VISIVEL_JS};
  const achados = [...document.querySelectorAll('button, [role=button]')].filter((b) => nomeDe(b) === ${J(nome)});
  return achados.find(visivel) || achados[0] || null;
})()`;

export const exprConversaAberta = (conv) =>
  `(() => { const m = document.querySelector('main'); if (!m) return false; const t = m.textContent;
     return t.includes(${J(conv.nome)}) && ${J(conv.textos)}.every((x) => t.includes(x)); })()`;

export const exprSgpCarregado = `[...document.querySelectorAll('[aria-label=${J(NOMES.regiaoSgp)}]')].some((e) => e.textContent.includes(${J(TEXTOS.sgpCarregado)}))`;
export const exprSgpFechado = `!document.querySelector('[aria-label=${J(NOMES.regiaoSgp)}]')`;

export const exprDadosDoClienteAbertos = `(() => {
  const nomeDe = ${NOME_JS};
  const botao = [...document.querySelectorAll('button, [role=button]')].find((b) => nomeDe(b) === ${J(NOMES.dadosDoCliente)});
  const painel = document.querySelector('[aria-label=${J(NOMES.dadosDoCliente)}]:not(button)');
  return Boolean(botao && botao.getAttribute('aria-expanded') === 'true' && painel);
})()`;

export const exprIndicadorReconectando = `[...document.querySelectorAll('[role=status]')].some((e) => (e.getAttribute('aria-label') || '').includes(${J(TEXTOS.reconectando)}))`;
export const exprFaixaReconectando = `[...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes(${J(TEXTOS.faixaReconectando)}))`;
export const exprCarregando = `[...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes(${J(TEXTOS.carregando)}))`;

// Contêiner que rola a linha do tempo: o ancestral rolavel do texto dado.
export const exprRolagemDe = (texto) => `(() => {
  const m = document.querySelector('main');
  const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent.includes(${J(texto)})) continue;
    for (let a = n.parentElement; a && a !== m; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) return a;
    }
  }
  return null;
})()`;

// A bolha de uma mensagem: o menor ancestral PINTADO (fundo ou borda) do texto.
export const exprBolhaCom = (texto) => `(() => {
  const m = document.querySelector('main');
  const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent.includes(${J(texto)})) continue;
    for (let a = n.parentElement; a && a !== m; a = a.parentElement) {
      const s = getComputedStyle(a);
      const fundo = s.backgroundColor !== 'transparent' && !/rgba\\([^)]*,\\s*0\\)$/.test(s.backgroundColor) && !/\\/\\s*0\\)$/.test(s.backgroundColor);
      const borda = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none';
      if (fundo || borda) return a;
    }
    return n.parentElement;
  }
  return null;
})()`;

// Itens com a marca de nao lida e o nome de cada um (para o suplementar).
export const exprNaoLidas = `[...document.querySelectorAll('[role=tabpanel] li')]
  .filter((li) => li.querySelector('[aria-label=${J(NOMES.naoLida)}]'))
  .map((li) => { const t = li.querySelector('[title]'); return (t && t.getAttribute('title')) || li.textContent.trim().slice(0, 40); })`;

// M6: esqueleto do Suspense = role=status com "Carregando"; barras = filhos aria-hidden.
export const exprBarrasDoEsqueleto = `[...document.querySelectorAll('[role=status]')]
  .filter((s) => s.textContent.includes(${J(TEXTOS.carregando)}))
  .flatMap((s) => [...s.querySelectorAll('[aria-hidden="true"]')])`;
export const exprCascaMontada = `Boolean(document.querySelector(${J(MARCOS.casca.sel)}))`;

// Pronto das rotas do opcional (admin).
export const PRONTO_OPCIONAL = {
  supervisao: `document.querySelectorAll('li, table tbody tr, [role=row]').length > 5`,
  relatorios: `document.body.innerText.includes(${J(TEXTOS.relatoriosPronto)})`,
  canais: `document.body.innerText.includes(${J(TEXTOS.canaisPronto)})`,
};
