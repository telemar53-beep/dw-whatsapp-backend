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
const MINUTOS_DE_VIDA = 30;

function montarEscopo(nome, contratos, agora = new Date()) {
  return {
    nome: nome || null,
    contratos: (contratos || []).map((c) => c.id),
    expiraEm: new Date(agora.getTime() + MINUTOS_DE_VIDA * 60 * 1000).toISOString(),
  };
}

function escopoValido(escopo, agora = new Date()) {
  if (!escopo || typeof escopo !== 'object') return false;
  if (!Array.isArray(escopo.contratos) || escopo.contratos.length === 0) return false;
  const expira = Date.parse(escopo.expiraEm);
  if (Number.isNaN(expira)) return false;
  return agora.getTime() <= expira;
}

/** O formato que a checagem de propriedade espera: uma lista de { id }. */
function paraContexto(escopo) {
  if (!escopo) return null;
  return { nome: escopo.nome, contratos: escopo.contratos.map((id) => ({ id })) };
}

module.exports = { montarEscopo, escopoValido, paraContexto, MINUTOS_DE_VIDA };
