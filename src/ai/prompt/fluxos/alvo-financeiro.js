// Alvo financeiro (rodada 9, N5; avaliação real r2, S5 0/3): o código decidia o alvo — a volta à própria cobrança, o contrato
// escolhido pela rua — e o prompt não dizia isso; ao contrário, ainda mandava esperar o documento da outra pessoa e perguntar o
// endereço. Aqui vão os FATOS que o sistema já confirmou, do estado do turno (o mesmo que as ferramentas conferem): quem fala,
// o alvo vigente, o contrato escolhido, a dúvida e o que ainda falta saber. O orquestrador recalcula a cada volta do laço, e o
// prompt é recomposto quando o estado muda (uma consulta que localiza a outra pessoa, uma cobrança que trava).
//
// Descreve; não autoriza, não promete envio e não obriga ferramenta nenhuma: as travas (tool-executor.js, tool-registry.js)
// continuam decidindo o que pode ser executado. O número do contrato não aparece (só o endereço, que fatos.js já mostra).
const DUVIDAS_DE_ENDERECO = new Set(['endereco_ambiguo', 'endereco_desconhecido']);
const DUVIDAS_FORTES = new Set(['terceiro_nao_vinculado', 'outra_pessoa_sem_documento', 'terceiro_expirado']);
const DUVIDAS_FRACAS = new Set(['proprio_nao_afirmado', 'dois_lados', 'referencia_incompleta']);
const DUVIDAS_TECNICAS = new Set(['escopo_nao_lido', 'transicao_nao_gravada']);

/**
 * O estado do alvo financeiro, do contexto do turno (mesmas regras de alvoFinanceiro, financial-target.js). Puro.
 * `pedidoDeDocumentoPermitido`: se a guarda do documento deixaria pedir o CPF/CNPJ do titular agora.
 */
function fatosDoAlvoFinanceiro(contexto, { pedidoDeDocumentoPermitido = true } = {}) {
  const c = contexto || {};
  const identidade = c.identidade || {};
  const quemFala = identidade.nivel === 'forte' ? (identidade.contestado ? 'contestado' : 'identificado') : 'nao_identificado';
  const trava = c.alvoTerceiro || null;
  // A dúvida do turno; a gravada só vale enquanto nenhuma consulta deste turno a resolveu (a trava do turno a substitui).
  const duvida = (typeof c.alvoAmbiguo === 'string' ? c.alvoAmbiguo : null)
    || (!trava && c.terceiro && c.terceiro.alvoPendente) || null;
  let alvo;
  if (duvida) alvo = 'indefinido';
  else if (trava) alvo = trava.contratos && trava.contratos.length > 0 ? 'terceiro' : 'travado';
  else if (c.terceiro && Array.isArray(c.terceiro.contratos)) alvo = c.terceiro.contratos.length > 0 ? 'terceiro' : 'travado';
  else alvo = 'titular';
  const contratos = Array.isArray(c.contracts) ? c.contracts : [];
  const ids = Array.isArray(c.contratosEscolhidos) && c.contratosEscolhidos.length ? c.contratosEscolhidos
    : (c.contratoEscolhido != null ? [c.contratoEscolhido] : []);
  const escolhidos = alvo === 'titular'
    ? ids.map((id) => contratos.find((x) => x && String(x.id) === String(id))).filter(Boolean).map((x) => x.address || x.endereco || '')
      .filter(Boolean)
    : [];
  return {
    quemFala,
    primeiroNome: identidade.primeiroNome || null,
    alvo,
    voltouAoTitular: alvo === 'titular' && c.alvoVoltouAoTitular === true,
    // Revisão da rodada 9 (achado 4): a volta tirou um terceiro — só então se fala da outra pessoa.
    voltouDeTerceiro: alvo === 'titular' && c.alvoVoltouAoTitular === true && c.alvoVoltouDeTerceiro === true,
    escolhidos,
    quantosContratos: contratos.length,
    duvida,
    pedidoDeDocumentoPermitido: pedidoDeDocumentoPermitido !== false,
    // Rodada 10 (S5): o meio que ele pediu depois da última entrega (meios-de-pagamento.js, meioCitadoDepoisDaEntrega).
    meio: c.meioDoPedido === 'boleto' || c.meioDoPedido === 'pix' ? c.meioDoPedido : null,
  };
}

function linhaDeQuemFala(f) {
  if (f.quemFala === 'identificado') return `- Quem fala: ${f.primeiroNome || 'o cliente'}, identificado.`;
  if (f.quemFala === 'contestado') return '- Quem fala: identificação contestada (ele disse que não é a pessoa do cadastro); não trate como identificado.';
  return '- Quem fala: ainda não identificado.';
}

function linhaDoAlvo(f) {
  if (f.alvo === 'indefinido') return '- Alvo da cobrança: ainda não definido.';
  if (f.alvo === 'travado') return '- Alvo da cobrança: nenhuma cobrança liberada neste turno.';
  if (f.alvo === 'terceiro') return '- Alvo da cobrança: a cobrança da outra pessoa, já localizada pelo documento que ele informou.';
  if (f.voltouDeTerceiro) {
    return '- Alvo da cobrança: a cobrança DELE — ele acabou de dizer que é a dele. A outra pessoa citada antes não é o alvo agora: não peça o documento dela nem fale da cobrança dela.';
  }
  if (f.voltouAoTitular) return '- Alvo da cobrança: a cobrança dele — ele disse de qual endereço é.';
  return f.quemFala === 'identificado' ? '- Alvo da cobrança: a cobrança dele.' : '- Alvo da cobrança: a de quem fala, que ainda não está identificado.';
}

function linhaDoContrato(f) {
  if (f.alvo !== 'titular' || f.quemFala !== 'identificado') return null;
  if (f.escolhidos.length === 1) return `- Contrato escolhido: o do endereço ${f.escolhidos[0]} — ele disse a rua. Não pergunte de novo de qual endereço é.`;
  if (f.escolhidos.length > 1) {
    return `- Contratos escolhidos: os dos endereços ${f.escolhidos.slice(0, -1).join(', ')} e ${f.escolhidos[f.escolhidos.length - 1]} — ele disse as ruas.`;
  }
  if (f.quantosContratos === 1) return '- Contrato escolhido: o único contrato dele.';
  if (f.quantosContratos > 1) return '- Contrato escolhido: nenhum ainda.';
  return null;
}

// Rodada 10 (S5): só com a cobrança liberada (dele ou da outra pessoa já localizada) e sem dúvida.
function linhaDoMeio(f) {
  if (!f.meio || f.duvida || (f.alvo !== 'titular' && f.alvo !== 'terceiro')) return null;
  const nome = f.meio === 'pix' ? 'PIX' : 'boleto';
  return `- Meio de pagamento: ${nome} — ele pediu o ${nome} nesta conversa depois da última cobrança entregue, e o sistema aceita esse meio para a cobrança atual. Não pergunte o meio de novo, salvo se a fala atual pedir outro.`;
}

function linhaDaDuvida(f) {
  if (!f.duvida) return '- Dúvida: nenhuma.';
  if (DUVIDAS_DE_ENDERECO.has(f.duvida)) return '- Dúvida: de qual endereço dele é a cobrança.';
  if (DUVIDAS_FORTES.has(f.duvida)) return '- Dúvida: de quem é a cobrança — ele citou outra pessoa que ainda não foi identificada por aqui.';
  if (DUVIDAS_FRACAS.has(f.duvida)) return '- Dúvida: se a cobrança é dele ou da pessoa já citada.';
  if (DUVIDAS_TECNICAS.has(f.duvida)) return '- Dúvida: o sistema não conseguiu confirmar o alvo agora.';
  return '- Dúvida: o alvo da cobrança não está claro agora.';
}

function linhaDoQueFalta(f) {
  if (f.duvida) {
    if (DUVIDAS_DE_ENDERECO.has(f.duvida)) return '- Falta saber: de qual endereço é (cite os endereços dele). Não peça documento.';
    if (DUVIDAS_FORTES.has(f.duvida)) {
      return f.pedidoDeDocumentoPermitido
        ? '- Falta saber: de quem é a conta; se for de outra pessoa, o CPF ou CNPJ do titular dela.'
        : '- Falta saber: de quem é a conta. O documento já foi pedido: não peça de novo agora.';
    }
    if (DUVIDAS_FRACAS.has(f.duvida)) return '- Falta saber: só se a cobrança é dele ou da pessoa já citada. Não peça documento.';
    if (DUVIDAS_TECNICAS.has(f.duvida)) return '- Falta saber: nada dele agora; não envie nem prometa cobrança neste turno.';
    return '- Falta saber: se ele ainda quer a cobrança, e de qual. Não envie nem prometa cobrança neste turno.';
  }
  if (f.alvo === 'travado') return '- Falta saber: nada agora; não envie nem prometa cobrança neste turno.';
  if (f.alvo === 'titular' && f.quemFala === 'identificado' && f.escolhidos.length === 0 && f.quantosContratos > 1) {
    return '- Falta saber: de qual endereço é, quando ele pedir uma cobrança.';
  }
  return '- Falta saber: nada sobre o alvo.';
}

module.exports = {
  nome: 'alvo-financeiro',
  fatosDoAlvoFinanceiro,
  // Só na triagem (o orquestrador põe o estado) e quando há o que dizer: quem fala identificado, ou um alvo que não é o de
  // sempre (dúvida, outra pessoa, cobrança travada).
  entra(estado) {
    const f = estado.alvoFinanceiro;
    return Boolean(f) && (f.quemFala === 'identificado' || f.alvo !== 'titular');
  },
  linhas(estado) {
    const f = estado.alvoFinanceiro;
    return [
      '',
      'ALVO FINANCEIRO AGORA (estado que o sistema já confirmou; descreve o que foi decidido — não autoriza nada, não promete envio e não obriga a chamar ferramenta: as ferramentas conferem tudo de novo):',
      linhaDeQuemFala(f),
      linhaDoAlvo(f),
      linhaDoContrato(f),
      linhaDoMeio(f),
      linhaDaDuvida(f),
      linhaDoQueFalta(f),
    ].filter((l) => l !== null);
  },
};
