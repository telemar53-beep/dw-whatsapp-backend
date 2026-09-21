// IDENTIDADE DESTA INSTALAÇÃO — e só dela.
//
// Este é o único lugar do frontend que sabe de que empresa é o produto. Nenhum
// componente importa um arquivo de marca diretamente: até a Etapa 7, `SideNav`
// importava os PNGs da DW no topo do módulo e os desenhava sempre, então outro
// provedor que instalasse o produto veria a marca da DW no menu, com "DW
// Telecom" no texto alternativo, e o próprio nome só no tooltip.
//
// Para rodar SEM marca própria (o caminho neutro), basta deixar as duas em
// `null`: o menu passa a usar o monograma com as iniciais de `companyName`,
// que vem de `GET /api/public/company`.
//
// LIMITAÇÃO REGISTRADA: o backend não entrega logotipo, símbolo, favicon nem
// cor de marca — `GET /api/public/company` devolve apenas `name`. Enquanto isso
// não existir, a marca é escolhida aqui, no build de cada instalação, e não por
// tenant em tempo de execução. Isto NÃO é white-label completo, e não finge ser.

import compacta from './dw-mark.png';
import horizontal from './dw-telecom-horizontal.png';

export const marcaDaInstalacao = {
  // Quadrada, para o menu recolhido (desenhada a 40×40).
  compacta,
  // Deitada, para o menu expandido (desenhada a ~142×59).
  horizontal,
};

export function instalacaoTemMarca() {
  return Boolean(marcaDaInstalacao.compacta || marcaDaInstalacao.horizontal);
}
