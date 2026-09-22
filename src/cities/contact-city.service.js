const { listCities, findPlaceBySgpPop } = require('./city.repository');
const { setContactCityIfEmpty, setContactLocalityIfEmpty } = require('../conversations/contact.repository');
const { encontrarCidade, normalizar } = require('./city-matcher');
const { mensagemSegura } = require('../ai/safe-error-log');

/**
 * Preenche o MUNICÍPIO do contato com a cidade do contrato que o SGP devolveu.
 *
 * Três recusas de propósito: contato que já tem cidade (a escolha do
 * atendente manda), contratos em cidades diferentes (não dá para saber onde o
 * cliente está) e cidade que não casa com nenhuma cadastrada — preencher a
 * cidade errada mandaria o aviso de falha regional errado para o cliente.
 */
async function preencherMunicipio(contact, contracts) {
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
}

/**
 * Preenche a LOCALIDADE do contato pelo POP da rede que o SGP devolve junto
 * com o contrato. Nenhuma consulta externa nova: usa o que a identificação já
 * trouxe.
 *
 * Recusa em silêncio, e cada recusa tem um motivo próprio:
 *
 * - localidade já preenchida: escolha manual nunca é sobrescrita;
 * - sem município: não há com que conferir o pai, e preencher às cegas poria o
 *   cliente num povoado de outro município;
 * - contratos em POPs diferentes: a localidade fica ambígua, e pegar o primeiro
 *   seria inventar onde o cliente mora;
 * - POP sem cadastro, cadastrado num município, ou numa localidade inativa;
 * - localidade cujo município pai não é o município identificado.
 */
async function preencherLocalidade(contact, contracts) {
  if (!contact || contact.localityId) return { preenchida: false };
  // O município tem de existir ANTES: é ele que valida o pai da localidade.
  // Quando preencherMunicipio acabou de gravá-lo, já está aqui no objeto.
  if (!contact.cityId) return { preenchida: false };

  const pops = [];
  for (const contrato of Array.isArray(contracts) ? contracts : []) {
    const pop = contrato && contrato.popName;
    if (!normalizar(pop)) continue;
    if (!pops.some((p) => normalizar(p) === normalizar(pop))) pops.push(pop);
  }
  if (pops.length === 0) return { preenchida: false };
  if (pops.length > 1) return { preenchida: false, motivo: 'contratos em POPs diferentes' };

  const lugar = await findPlaceBySgpPop(pops[0]);
  if (!lugar) return { preenchida: false };
  if (lugar.kind !== 'locality') return { preenchida: false, motivo: 'POP não é de uma localidade' };
  if (!lugar.active) return { preenchida: false, motivo: 'localidade inativa' };
  if (lugar.parentId !== contact.cityId) {
    return { preenchida: false, motivo: 'localidade de outro município' };
  }

  const atualizado = await setContactLocalityIfEmpty(contact.id, lugar.id);
  if (!atualizado) return { preenchida: false };

  contact.localityId = lugar.id;
  return { preenchida: true, localityId: lugar.id };
}

/**
 * Preenche onde o cliente está, a partir do que o SGP já devolveu na
 * identificação: primeiro o município (pelo endereço), depois a localidade
 * (pelo POP da rede).
 *
 * É melhor esforço: roda no meio da identificação e NUNCA pode derrubá-la —
 * qualquer falha vira log e `{ preenchida: false }`.
 *
 * A ordem importa: a localidade só é aceita quando o município pai dela bate
 * com o município do contato, então o município precisa estar resolvido antes.
 *
 * Atendimento de terceiro não chega aqui, e isso é anterior a esta função: o
 * ramo de terceiro em tool-registry retorna antes, sem tocar o contato.
 */
async function preencherCidadePeloSgp(contact, contracts) {
  let municipio = { preenchida: false };
  let localidade = { preenchida: false };
  try {
    municipio = await preencherMunicipio(contact, contracts);
  } catch (err) {
    console.error(`City autofill failed for contact ${contact && contact.id}: ${mensagemSegura(err)}`);
  }
  try {
    localidade = await preencherLocalidade(contact, contracts);
  } catch (err) {
    console.error(`Locality autofill failed for contact ${contact && contact.id}: ${mensagemSegura(err)}`);
  }
  return { ...municipio, localidade };
}

module.exports = { preencherCidadePeloSgp };
