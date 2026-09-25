const { findContactsWithOwnHistoryByPhoneNumbers, findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { brazilianNumberVariants } = require('./phone-variants');

// Fase 1A (25/09/2026). O disparo pela Meta usava o número exatamente como o SGP manda
// (com o 9), e a resposta chega com o wa_id da Meta (no DDD 98, sem o 9): o mesmo celular
// virava dois contatos, a resposta abria conversa nova e a IA respondia sem ver o disparo.
// Fase 0 em produção: 226 pares, 220 exatamente nesse padrão.
//
// Regra aprovada: considerar as duas formas; se só uma existe, usar essa; se as duas
// existem e só uma tem evidência forte de identidade, usar essa; se as duas têm, NÃO unir e
// NÃO escolher — registrar a ambiguidade e manter o comportamento de hoje; se nenhuma tem,
// também manter o número do SGP (não adivinhar por conversa de saída).
//
// Revisão (25/09/2026): a régua da escolha era "histórico próprio", e ele conta qualquer
// conversa não-silent. Os 6 pares ambíguos de produção eram todos o mesmo caso: o lado com 9
// sem nenhuma entrada, preso só por conversas antigas de atendente com saída. A escolha passou
// a usar evidência forte (entrada, vínculo SGP, nota interna); o histórico continua sendo a
// régua da renomeação (renameGhostContactToWaId), que não mudou. Nada existente é movido.

/**
 * Decide qual contato recebe o disparo. Pura: não consulta nada.
 * `existentes`: formas do número que já existem, com a marcação de evidência forte.
 * `motivo` é código estável, nunca frase.
 */
function escolherContatoDoDisparo({ existentes }) {
  if (existentes.length === 0) return { acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_existe' };
  if (existentes.length === 1) return { acao: 'reusar', contatoId: existentes[0].contact.id, motivo: 'unica_forma_existente' };

  const comEvidencia = existentes.filter((e) => e.temEvidenciaForte);
  if (comEvidencia.length === 1) return { acao: 'reusar', contatoId: comEvidencia[0].contact.id, motivo: 'so_uma_forma_com_evidencia_forte' };
  if (comEvidencia.length > 1) return { acao: 'digitado', ambiguo: true, motivo: 'duas_formas_com_evidencia_forte' };
  return { acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_com_evidencia_forte' };
}

const mascarar = (numero) => `${String(numero).slice(0, 4)}…${String(numero).slice(-4)}`;

/**
 * O contato que recebe um disparo de template pela Meta (rota do SGP e campanha).
 * Número fixo ou estrangeiro não tem variante: segue direto para o caminho de sempre.
 */
async function resolverContatoDoDisparo(telefone, displayName = null) {
  const formas = brazilianNumberVariants(telefone);
  if (formas.length > 1) {
    const existentes = await findContactsWithOwnHistoryByPhoneNumbers(formas);
    const escolha = escolherContatoDoDisparo({ digitado: telefone, existentes });
    if (escolha.acao === 'reusar') return existentes.find((e) => e.contact.id === escolha.contatoId).contact;
    if (escolha.ambiguo) {
      // Só o fato e o número mascarado: a revisão dos pares ambíguos é operação separada.
      console.warn(`Dispatch contact ambiguous for ${mascarar(telefone)}: both ninth-digit forms have strong identity evidence; kept the number as sent`);
    }
  }
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(telefone, displayName);
  return contact;
}

module.exports = { escolherContatoDoDisparo, resolverContatoDoDisparo };
