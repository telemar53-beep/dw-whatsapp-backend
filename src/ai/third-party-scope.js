// Pedir o boleto da esposa, do marido ou de um parente é atendimento normal, e
// pode levar mais de um turno: o titular tem duas faturas e o cliente precisa
// escolher uma. O escopo abaixo é o que sobrevive entre os turnos.
//
// Três coisas que ele NÃO faz, de propósito:
// - não substitui contexto.contracts (os contratos do próprio contato);
// - não torna o terceiro dono do contato (nada é persistido no contato);
// - não guarda o documento do terceiro — só os ids de contrato, que é tudo de
//   que as ferramentas de pagamento precisam depois da primeira consulta. O CPF
//   continua no histórico da conversa, onde o cliente o digitou; o que não
//   existe é uma segunda cópia dele aqui.
//
// Os 30 minutos são TTL de AUTORIZAÇÃO, não de retenção: escopoValido() confere
// na leitura, em memória, antes de qualquer uso. Um JSON expirado pode
// continuar na coluna até a próxima leitura daquela conversa — e expirado ele
// não autoriza nada.
const { randomUUID } = require('crypto');

const MINUTOS_DE_VIDA = 30;

// Persistência do alvo (03/10/2026): cada gravação do escopo leva uma `marca` nova, única. Ela não autoriza
// nada; serve para a gravação seguinte exigir, na própria instrução, que o banco ainda tenha o estado que o
// turno conhece (setThirdPartyScope com condição). Valor igual não prova autoria; a marca única prova: só
// quem gravou a conhece. É o que barra o escritor antigo (a consulta que termina depois do tempo esgotado, ou
// outro processamento) e reconhece a própria gravação cuja resposta se perdeu.
const novaMarca = () => randomUUID();
/** O mesmo escopo, como uma gravação nova: marca nova (prazo, contratos e dúvida intactos). */
function comNovaMarca(escopo) {
  return escopo ? { ...escopo, marca: novaMarca() } : null;
}

// `pendente` (caso Fulana/Beltrana, 25/09/2026): o documento do terceiro NÃO foi encontrado. O
// pedido continua sendo de terceiro, sem contrato nenhum — não autoriza nada e segura a
// cobrança de quem fala (sem fallback) até a intenção explícita ou um novo CPF. O prazo não
// resolve (decisão gerencial de 30/09/2026): ver duvidaSemAutorizacao.
function montarEscopo(nome, contratos, agora = new Date(), { pendente = false } = {}) {
  return {
    nome: nome || null,
    contratos: (contratos || []).map((c) => c.id),
    expiraEm: new Date(agora.getTime() + MINUTOS_DE_VIDA * 60 * 1000).toISOString(),
    ...(pendente ? { pendente: true } : {}),
    marca: novaMarca(),
  };
}

/**
 * O que uma gravação condicional exige do banco para este estado conhecido: a coluna vazia, a marca dele, ou —
 * escopo gravado antes desta versão, sem marca — o conteúdo igual (só na transição de versão).
 */
function esperadoDoEscopo(escopo) {
  if (!escopo) return { nulo: true };
  if (typeof escopo.marca === 'string' && escopo.marca) return { marca: escopo.marca };
  return { legado: escopo };
}

// Formato ISO completo, como .toISOString() produz. A checagem de tipo e de
// forma vem ANTES do Date.parse de propósito: Date.parse('12345') não é lixo
// para o V8 — é o ano 12345, uma data válida e distante, que transformaria um
// campo corrompido numa autorização de séculos. Falhar fechado é o ponto
// inteiro desta função.
const ISO_COMPLETO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function escopoValido(escopo, agora = new Date()) {
  if (!escopo || typeof escopo !== 'object') return false;
  if (!Array.isArray(escopo.contratos)) return false;
  // Lista vazia só com a marca de pendente, e só o booleano puro: um JSON corrompido não vira
  // pedido de terceiro por acidente.
  if (escopo.contratos.length === 0 && escopo.pendente !== true) return false;
  if (typeof escopo.expiraEm !== 'string' || !ISO_COMPLETO.test(escopo.expiraEm)) return false;
  const expira = Date.parse(escopo.expiraEm);
  if (Number.isNaN(expira)) return false;
  return agora.getTime() <= expira;
}

// Dúvida sobre o alvo (revisão da F2, 30/09/2026): quando a mensagem do cliente não permite saber de quem
// é a cobrança, o worker grava o motivo aqui, no mesmo JSON. É o que faz a trava sobreviver aos turnos
// sem depender de a fala que a criou ainda estar entre as mensagens lidas. Não renova o prazo, e um escopo
// novo (documento consultado) nasce sem ela. Terceira revisão: o prazo encerra a AUTORIZAÇÃO, não a
// dúvida — ver duvidaSemAutorizacao. Os valores são os códigos de AMBIGUIDADE (financial-target.js) que
// podem durar mais de um turno.
// Dúvida de endereço (07/10/2026): a rua que não se liga com segurança a um contrato dele, ou a mais de um, também dura entre
// turnos — no mesmo escopo pendente, sem contrato de terceiro.
const PENDENCIAS_DE_ALVO = ['terceiro_nao_vinculado', 'outra_pessoa_sem_documento', 'dois_lados', 'referencia_incompleta', 'proprio_nao_afirmado', 'endereco_ambiguo', 'endereco_desconhecido'];
// Valor desconhecido ou corrompido não pode virar "sem dúvida": vale como a trava mais forte.
const PENDENCIA_MAIS_FORTE = 'terceiro_nao_vinculado';

/** O escopo com a dúvida gravada (ou sem ela, com null). Nunca mexe no prazo nem nos contratos. É uma gravação nova: marca nova. */
function comPendenciaDeAlvo(escopo, motivo) {
  const { alvoPendente, ...resto } = escopo;
  return comNovaMarca(motivo ? { ...resto, alvoPendente: motivo } : resto);
}

// A dúvida de endereço só existe no escopo pendente sem contrato de terceiro (revisão da v4.1, achado B5): num escopo com
// contrato, o valor é corrompido e vale como a trava mais forte — nunca como uma dúvida que "o dela" resolve.
const DUVIDAS_DE_ENDERECO = ['endereco_ambiguo', 'endereco_desconhecido'];
function pendenciaValida(escopo) {
  if (!PENDENCIAS_DE_ALVO.includes(escopo.alvoPendente)) return false;
  return !(DUVIDAS_DE_ENDERECO.includes(escopo.alvoPendente) && escopo.contratos.length > 0);
}

/** O formato que a checagem de propriedade espera: uma lista de { id }. */
function paraContexto(escopo) {
  if (!escopo) return null;
  return {
    nome: escopo.nome,
    contratos: escopo.contratos.map((id) => ({ id })),
    ...(escopo.pendente === true ? { pendente: true } : {}),
    ...(escopo.alvoPendente !== undefined
      ? { alvoPendente: pendenciaValida(escopo) ? escopo.alvoPendente : PENDENCIA_MAIS_FORTE }
      : {}),
  };
}

// Terceira revisão da F2 (30/09/2026): expiração encerra a autorização, não resolve a dúvida. O escopo que
// venceu (ou está ilegível) COM uma dúvida gravada — ou pendente por documento não localizado (decisão
// gerencial de 30/09/2026) — não é limpo: continua na coluna, sem prazo novo, e o turno o lê como este
// contexto — nenhum contrato, nenhum nome, a trava forte. Só a afirmação da própria cobrança (o worker limpa
// a coluna) ou um documento consultado (buscar_cliente grava um escopo novo) resolvem. Conversa nova nasce
// com a coluna vazia. O escopo resolvido (terceiro localizado, sem pendência) vencido segue a regra de sempre.
const CONTEXTO_SEM_AUTORIZACAO = Object.freeze({ nome: null, contratos: Object.freeze([]), pendente: true, alvoPendente: 'terceiro_expirado' });

/** O escopo gravado tem uma pendência (dúvida, mesmo corrompida, ou documento não localizado) e já não autoriza nada. */
function duvidaSemAutorizacao(escopo, agora = new Date()) {
  if (!escopo || typeof escopo !== 'object') return false;
  if (escopo.alvoPendente === undefined && escopo.pendente !== true) return false;
  return !escopoValido(escopo, agora);
}

/** Quando o escopo foi criado: o prazo nunca é renovado, então é expiraEm menos a vida. */
function criadoEm(escopo) {
  if (!escopo || typeof escopo.expiraEm !== 'string' || !ISO_COMPLETO.test(escopo.expiraEm)) return null;
  return new Date(Date.parse(escopo.expiraEm) - MINUTOS_DE_VIDA * 60 * 1000);
}

module.exports = {
  montarEscopo, escopoValido, paraContexto, comPendenciaDeAlvo, criadoEm, duvidaSemAutorizacao, CONTEXTO_SEM_AUTORIZACAO,
  PENDENCIAS_DE_ALVO, MINUTOS_DE_VIDA, comNovaMarca, esperadoDoEscopo,
};
