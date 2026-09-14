const { listCities } = require('./city.repository');
const { setContactCityIfEmpty } = require('../conversations/contact.repository');
const { encontrarCidade, normalizar } = require('./city-matcher');
const { mensagemSegura } = require('../ai/safe-error-log');

/**
 * Preenche a cidade do contato com a cidade do contrato que o SGP devolveu.
 * É melhor esforço: roda no meio da identificação e NUNCA pode derrubá-la —
 * qualquer falha vira log e `{ preenchida: false }`.
 *
 * Três recusas de propósito: contato que já tem cidade (a escolha do
 * atendente manda), contratos em cidades diferentes (não dá para saber onde o
 * cliente está) e cidade que não casa com nenhuma cadastrada — preencher a
 * cidade errada mandaria o aviso de falha regional errado para o cliente.
 */
async function preencherCidadePeloSgp(contact, contracts) {
  try {
    if (!contact || contact.cityId) return { preenchida: false };

    const cidades = [];
    for (const contrato of Array.isArray(contracts) ? contracts : []) {
      const nome = contrato && contrato.city;
      if (!normalizar(nome)) continue;
      // Compara normalizado (o SGP varia caixa e acento entre contratos do
      // mesmo cliente), mas guarda o nome cru para o casamento.
      if (!cidades.some((c) => normalizar(c) === normalizar(nome))) cidades.push(nome);
    }
    if (cidades.length === 0) return { preenchida: false };
    if (cidades.length > 1) return { preenchida: false, motivo: 'contratos em cidades diferentes' };

    const cidade = encontrarCidade(cidades[0], await listCities());
    if (!cidade) return { preenchida: false };

    const atualizado = await setContactCityIfEmpty(contact.id, cidade.id);
    if (!atualizado) return { preenchida: false };

    // Muta o contato em memória: quem chamou segue o turno com este mesmo
    // objeto (o aviso de cidade e o prompt da triagem leem contact.cityId).
    contact.cityId = cidade.id;
    return { preenchida: true, cityId: cidade.id };
  } catch (err) {
    console.error(`City autofill failed for contact ${contact && contact.id}: ${mensagemSegura(err)}`);
    return { preenchida: false };
  }
}

module.exports = { preencherCidadePeloSgp };
