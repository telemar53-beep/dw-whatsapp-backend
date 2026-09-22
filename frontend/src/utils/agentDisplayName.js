// Relatórios compara quase 20 atendentes lado a lado. Nome completo rouba a
// largura que a barra de comparação precisa, então a lista mostra só o primeiro
// nome — e acrescenta o MÍNIMO para desempatar quem repete: primeiro a inicial
// do sobrenome ("Ana P."), depois o sobrenome inteiro, e só em último caso o
// nome completo. Cidade nunca entra: não é informação dessa análise.

const SEM_NOME = 'Sem nome';
const NIVEL_MAXIMO = 3;

function partesDoNome(nomeCompleto) {
  return String(nomeCompleto ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Níveis de desempate, do mais curto ao mais completo. Nome de uma palavra só
// devolve sempre a mesma coisa — é o que impede a escalada de girar em falso.
function rotuloNoNivel(partes, nivel) {
  if (partes.length === 0) return SEM_NOME;
  const primeiro = partes[0];
  if (nivel <= 0 || partes.length === 1) return primeiro;
  const ultimo = partes[partes.length - 1];
  if (nivel === 1) return `${primeiro} ${ultimo.slice(0, 1).toUpperCase()}.`;
  if (nivel === 2) return `${primeiro} ${ultimo}`;
  return partes.join(' ');
}

// Recebe a lista inteira porque desempate é uma propriedade do conjunto: só dá
// para saber que "Ana" precisa virar "Ana P." olhando as outras linhas.
export function shortenAgentNames(nomes) {
  const partes = nomes.map(partesDoNome);
  const niveis = partes.map(() => 0);

  for (let rodada = 0; rodada < NIVEL_MAXIMO; rodada += 1) {
    const rotulos = partes.map((p, i) => rotuloNoNivel(p, niveis[i]));
    const ocorrencias = new Map();
    rotulos.forEach((rotulo) => ocorrencias.set(rotulo, (ocorrencias.get(rotulo) || 0) + 1));

    let escalou = false;
    rotulos.forEach((rotulo, i) => {
      if (ocorrencias.get(rotulo) < 2) return;
      // Quem não tem mais o que acrescentar (nome de uma palavra, ou dois
      // homônimos exatos) para aqui em vez de escalar para sempre.
      if (rotuloNoNivel(partes[i], niveis[i] + 1) === rotulo) return;
      niveis[i] += 1;
      escalou = true;
    });
    if (!escalou) break;
  }

  return partes.map((p, i) => rotuloNoNivel(p, niveis[i]));
}

// A inicial do avatar acompanha o rótulo mostrado, não o nome completo.
export function agentInitial(rotulo) {
  const texto = String(rotulo ?? '').trim();
  return texto ? texto.slice(0, 1).toUpperCase() : '?';
}
