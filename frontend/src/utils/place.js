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
