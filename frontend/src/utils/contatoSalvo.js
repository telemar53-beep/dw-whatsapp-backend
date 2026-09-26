// O que o "Editar cliente" salvou, preso à conversa e ao contato de onde a
// edição saiu.
//
// A rota de edição não emite evento: a lista (e, com ela, o objeto da
// conversa) continua com os valores de antes. A resposta do servidor passa a
// ser o valor efetivo DESTA conversa — no cabeçalho, no painel e ao reabrir a
// edição. Sem isto a nota ficava de fora: o painel mostrava a antiga, reabrir
// a edição carregava a antiga, e salvar de novo a devolvia ao servidor.
//
// O vínculo é o que impede a resposta que chega atrasada (salvou em A, trocou
// para B) de renomear B: ela só vale onde a conversa e o contato batem.
export function contatoSalvoDe(conversation, salvo) {
  return { conversationId: conversation.id, contactId: conversation.contactId, ...salvo };
}

// Os quatro campos da edição andam juntos: nome, município, localidade e nota.
function comDadosDoContato(conversation, salvo) {
  return {
    ...conversation,
    contactDisplayName: salvo.displayName,
    contactCityId: salvo.cityId,
    contactCityName: salvo.cityName,
    contactLocalityId: salvo.localityId,
    contactLocalityName: salvo.localityName,
    contactInternalNote: salvo.internalNote,
  };
}

function jaTemOsDados(conversation, salvo) {
  return conversation.contactDisplayName === salvo.displayName
    && conversation.contactCityId === salvo.cityId
    && conversation.contactCityName === salvo.cityName
    && conversation.contactLocalityId === salvo.localityId
    && conversation.contactLocalityName === salvo.localityName
    && conversation.contactInternalNote === salvo.internalNote;
}

export function comContatoSalvo(conversation, salvo) {
  if (!salvo || salvo.conversationId !== conversation.id || salvo.contactId !== conversation.contactId) return conversation;
  return comDadosDoContato(conversation, salvo);
}

// Nas listas (mesa, Supervisão, Encerrados) o contato é a identidade: toda
// conversa dele recebe os dados, porque o cliente é um só. As outras continuam
// sendo o MESMO objeto, e a lista só vira um array novo quando alguma linha
// mudou de verdade — senão a lista inteira e a conversa aberta redesenhariam
// (BUG-004, achado A2). O conversation.id confere a origem: um salvo que diz
// vir de uma conversa da lista, mas de outro contato, não entra.
export function aplicarContatoSalvo(lista, salvo) {
  if (!salvo || !salvo.contactId || !salvo.conversationId) return lista;
  const origem = lista.find((c) => c.id === salvo.conversationId);
  if (origem && origem.contactId !== salvo.contactId) return lista;
  let mudou = false;
  const nova = lista.map((c) => {
    if (c.contactId !== salvo.contactId || jaTemOsDados(c, salvo)) return c;
    mudou = true;
    return comDadosDoContato(c, salvo);
  });
  return mudou ? nova : lista;
}
