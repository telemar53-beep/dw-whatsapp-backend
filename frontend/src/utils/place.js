// Como o lugar do cliente aparece na interface.
//
// Com localidade, os DOIS aparecem — "Barão de Tromaí · Cândido Mendes" — porque
// a localidade diz onde a pessoa está e o município é o que o SGP conhece.
// Sem localidade, só o município, exatamente como sempre foi.
//
// Mora num lugar só porque a mesma regra vale na lista, no painel da conversa e
// na Supervisão: com a formatação repetida, uma das três acabaria divergindo.
export function nomeDoLocal(localityName, cityName) {
  const localidade = (localityName || '').trim();
  const municipio = (cityName || '').trim();

  if (localidade && municipio && localidade !== municipio) return `${localidade} · ${municipio}`;
  return localidade || municipio || null;
}

// A fila de espera quer o lugar MAIS ESPECÍFICO, sem o município junto: a linha
// existe para o atendente bater o olho e reconhecer o atendimento, e "Barão de
// Tromaí · Cândido Mendes" gasta a largura repetindo o que a localidade já
// resolve. No painel da conversa e na Supervisão continua valendo nomeDoLocal:
// lá o município importa, porque é o que o SGP conhece.
//
// Mora aqui, coladinha na outra, porque as duas respondem à mesma pergunta
// ("como o lugar do cliente aparece") e separá-las é como uma das duas acabaria
// divergindo.
export function localMaisEspecifico(localityName, cityName) {
  const localidade = (localityName || '').trim();
  const municipio = (cityName || '').trim();

  return localidade || municipio || null;
}
