const { findContactsWithOwnHistoryByPhoneNumbers, findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { brazilianNumberVariants } = require('./phone-variants');

// Fase 1A (25/09/2026). O disparo pela Meta usava o número exatamente como o SGP manda
// (com o 9), e a resposta chega com o wa_id da Meta (no DDD 98, sem o 9): o mesmo celular
// virava dois contatos, a resposta abria conversa nova e a IA respondia sem ver o disparo.
// Fase 0 em produção: 226 pares, 220 exatamente nesse padrão.
//
// Regra aprovada: considerar as duas formas; se só uma existe, usar essa; se as duas
// existem e só uma tem histórico próprio, usar essa; se as duas têm, NÃO unir e NÃO
// escolher — registrar a ambiguidade e manter o comportamento de hoje.

/**
 * Decide qual contato recebe o disparo. Pura: não consulta nada.
 * `existentes`: formas do número que já existem, com a marcação de histórico próprio.
 * `motivo` é código estável, nunca frase.
 */
function escolherContatoDoDisparo({ existentes }) {
  if (existentes.length === 0) return { acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_existe' };
  if (existentes.length === 1) return { acao: 'reusar', contatoId: existentes[0].contact.id, motivo: 'unica_forma_existente' };

  const comHistorico = existentes.filter((e) => e.temHistoricoProprio);
  if (comHistorico.length === 1) return { acao: 'reusar', contatoId: comHistorico[0].contact.id, motivo: 'so_uma_forma_com_historico' };
  if (comHistorico.length > 1) return { acao: 'digitado', ambiguo: true, motivo: 'duas_formas_com_historico' };
  return { acao: 'digitado', ambiguo: false, motivo: 'duas_formas_sem_historico' };
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
      console.warn(`Dispatch contact ambiguous for ${mascarar(telefone)}: both ninth-digit forms have their own history; kept the number as sent`);
    }
  }
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(telefone, displayName);
  return contact;
}

module.exports = { escolherContatoDoDisparo, resolverContatoDoDisparo };
