// Desenhos da família DW para os motivos de encerramento (o que levou o
// cliente a falar com o provedor). Moram fora de desenhos.js, como os do SGP e
// os da Supervisão: só o diálogo Encerrar os usará, sob demanda, e o
// empacotador põe um módulo inteiro num trecho só — no índice, viajariam com a
// mesa. Nesta rodada nenhuma tela os importa: estão aqui para aprovação visual.
//
// As regras da grade são as de desenhos.js: 24 × 24, desenho entre 2 e 22 já
// contando o traço, só comandos absolutos, retas a 0°, 90° ou 45°, e a
// linguagem da família — a CONVERSA (moldura interrompida, cauda a 45°) e a
// CONEXÃO (pontos ligados por retas). Cada motivo é uma ideia só, para ser
// lida em 16 px ao lado do nome; nenhum tem letra dentro.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// ── Contrato ────────────────────────────────────────────────────────────────

// O contrato com o × a 45° saindo pelo canto aberto da folha: o vínculo
// desfeito. Não é o Encerrar da família (a parada dentro da conversa).
export const cancelamento = [
  ['path', { d: 'M13.5 20.5 H7 A2 2 0 0 1 5 18.5 V5.5 A2 2 0 0 1 7 3.5 H17 A2 2 0 0 1 19 5.5 V12' }],
  ['path', { d: 'M8.5 8 H15.5 M8.5 11.5 H12.5' }],
  ['path', { d: 'M14.5 14.5 L20.5 20.5 M20.5 14.5 L14.5 20.5' }],
];

// A conversa retomada: é o avesso do Encerrar da família. Lá a cauda fica
// solta e a parada entra na conversa; aqui a cauda volta a terminar no ponto
// ativo (a conexão de volta, como no Atendimento) e a parada vira o seguir, com
// os dois lados a 45°. Não é o símbolo de ligar, nem seta em círculo.
export const reativacao = [
  ['path', { d: 'M8 15 H7 A3 3 0 0 1 4 12 V6.5 A3 3 0 0 1 7 3.5 H17 A3 3 0 0 1 20 6.5 V12 A3 3 0 0 1 17 15 H11 L7.56 18.44' }],
  ['circle', { cx: 6.5, cy: 19.5, r: 1.5 }],
  ['path', { d: 'M11 6 L14.25 9.25 L11 12.5 Z' }],
];

// Informações comerciais mora em desenhoInformacoesComerciais.js: Configurações
// também a usa (Planos) e leva só ela. Reexportada aqui: a fonte é uma só.
export { informacoesComerciais } from './desenhoInformacoesComerciais.js';

// A origem (o ponto) ligada ao destino (o alfinete), com a mudança de rumo a
// 45°: a mesma ideia de Transferir, aplicada ao lugar.
export const mudancaDeEndereco = [
  ['path', { d: 'M15 15.5 L11.46 11.97 A5 5 0 1 1 18.54 11.97 Z' }],
  ['circle', { cx: 15, cy: 8.43, r: 1.5 }],
  ['circle', { cx: 5, cy: 19, r: 1.5 }],
  ['path', { d: 'M6.5 19 H11.5 L14 16.5' }],
];

// Três níveis de serviço em degrau, com o plano de agora (o ponto de baixo)
// ligado ao plano novo (o ponto de cima). O percurso é o degrau, não uma seta;
// o destino é outro nível, não um lugar (Mudança de endereço tem o alfinete).
export const mudancaDePlano = [
  ['circle', { cx: 5, cy: 19, r: 2 }],
  ['path', { d: 'M7 19 H10 V12 H14 V5 H17' }],
  ['circle', { cx: 19, cy: 5, r: 2 }],
];

// ── Dinheiro ────────────────────────────────────────────────────────────────

// A cédula: pagamentos e faturas em geral. Sem marca Pix e sem cifrão.
export const financeiro = [
  ['rect', { x: 3.5, y: 6.5, width: 17, height: 11, rx: 2.5 }],
  ['circle', { cx: 12, cy: 12, r: 2.5 }],
];

// Duas vias: a folha da frente, com as linhas, e a de trás, que só aparece
// onde a da frente não a cobre.
export const segundaVia = [
  ['path', { d: 'M8.5 6.5 V5.5 A2 2 0 0 1 10.5 3.5 H17.5 A2 2 0 0 1 19.5 5.5 V15 A2 2 0 0 1 17.5 17 H15.5' }],
  ['rect', { x: 4.5, y: 6.5, width: 11, height: 14, rx: 2 }],
  ['path', { d: 'M7.5 11 H12.5 M7.5 15 H11' }],
];

// A data combinada para pagar: o calendário com a moeda do Financeiro no
// canto, e a moldura se interrompe para dar lugar a ela. É o acordo sobre a
// dívida, não o pagamento em si (Financeiro). Sem o sinal de porcentagem: é um
// caractere, não um desenho, e em 16 px lia só como "desconto".
export const negociacaoDeDebito = [
  ['path', { d: 'M20.5 12 V7.5 A2.5 2.5 0 0 0 18 5 H6 A2.5 2.5 0 0 0 3.5 7.5 V18 A2.5 2.5 0 0 0 6 20.5 H11' }],
  ['path', { d: 'M8 3 V6.5 M16 3 V6.5 M3.5 9.5 H20.5' }],
  ['circle', { cx: 16.75, cy: 16.75, r: 3 }],
];

// ── Técnico ─────────────────────────────────────────────────────────────────

// A ligação da família partida ao meio, com o corte atravessando o vão: os
// dois pontos existem, a conexão entre eles não.
export const semConexao = [
  ['circle', { cx: 5.5, cy: 18.5, r: 2.25 }],
  ['circle', { cx: 18.5, cy: 5.5, r: 2.25 }],
  ['path', { d: 'M7.09 16.91 L9.75 14.25 M14.25 9.75 L16.91 7.09' }],
  ['path', { d: 'M9 9 L15 15' }],
];

// O mostrador com a agulha a 45° do lado lento: há conexão, mas devagar. Outra
// família de forma que a de Sem conexão, para não parecerem o mesmo problema.
// O arco passa do meio círculo (só 8,5 de altura sumia em 16 px) e abre para
// baixo, com o cubo e a agulha na diagonal — não é o anel aberto no alto, com
// haste reta, da Reativação.
export const lentidao = [
  ['path', { d: 'M4.64 17.75 A8.5 8.5 0 1 1 19.36 17.75' }],
  ['circle', { cx: 12, cy: 13.5, r: 1.5 }],
  ['path', { d: 'M10.23 11.73 L7.23 8.73' }],
];

// A ligação chega de fora, entra pela parede e termina no equipamento dentro
// da casa: a internet instalada.
export const instalacao = [
  ['path', { d: 'M7.5 10.5 L14 4 L20.5 10.5' }],
  ['path', { d: 'M9.5 8.5 V12.25 M9.5 16.75 V18.5 A2 2 0 0 0 11.5 20.5 H16.5 A2 2 0 0 0 18.5 18.5 V8.5' }],
  ['circle', { cx: 4.25, cy: 14.5, r: 1.25 }],
  ['path', { d: 'M5.5 14.5 H12.5' }],
  ['circle', { cx: 14.25, cy: 14.5, r: 1.25 }],
];

// A assistência aplicada à conversa: a moldura se abre no canto de cima e por
// ali entra a chave de boca, com o cabo a 45° dentro da conversa. É a mesma
// gramática da Automação (quem atua mora na abertura), com o gesto técnico no
// lugar do brilho. Não é a chave solta, nem os ajustes de Configurações.
export const suporteTecnico = [
  ['path', { d: 'M8 17.5 H6.5 A3 3 0 0 1 3.5 14.5 V10.5 A3 3 0 0 1 6.5 7.5 H9.5 M15.5 13 V14.5 A3 3 0 0 1 12.5 17.5 H10.5 L7.5 20.5' }],
  ['path', { d: 'M20.49 6.69 A3.5 3.5 0 1 1 17.31 3.51 L15.72 5.1 L18.9 8.28 Z' }],
  ['path', { d: 'M14.53 9.47 L10 14' }],
];

// O campo da senha: dois pontos digitados e o cursor. Não são reticências
// numa conversa (Sem resposta).
export const trocaDeSenha = [
  ['rect', { x: 3, y: 7.5, width: 18, height: 9, rx: 3 }],
  ['circle', { cx: 7.5, cy: 12, r: 0.75 }],
  ['circle', { cx: 11.5, cy: 12, r: 0.75 }],
  ['path', { d: 'M16 9.75 V14.25' }],
];

// ── Desfecho ────────────────────────────────────────────────────────────────

// O visto (resolvido) com o brilho da IA na ponta: a resolução vem primeiro,
// a automação é o complemento. Não é a conversa entregue à IA (Automação).
export const resolvidoPelaIa = [
  ['path', { d: 'M3.5 13.5 L8.5 18.5 L16.25 10.75' }],
  ['path', { d: 'M17.75 3 A3.25 3.25 0 0 0 21 6.25 A3.25 3.25 0 0 0 17.75 9.5 A3.25 3.25 0 0 0 14.5 6.25 A3.25 3.25 0 0 0 17.75 3 Z' }],
];

// A nossa conversa com as reticências da resposta que não veio.
export const semResposta = [
  ['path', { d: 'M8.5 16 H7 A3 3 0 0 1 4 13 V8 A3 3 0 0 1 7 5 H17 A3 3 0 0 1 20 8 V13 A3 3 0 0 1 17 16 H11.5 L8 19.5' }],
  ['circle', { cx: 8, cy: 10.5, r: 0.75 }],
  ['circle', { cx: 12, cy: 10.5, r: 0.75 }],
  ['circle', { cx: 16, cy: 10.5, r: 0.75 }],
];

// ── Genérico ────────────────────────────────────────────────────────────────

// Motivo que o catálogo não reconhece: a conversa vazia, sem nada dentro. Não
// sugere motivo nenhum — só que houve um contato.
export const motivoDesconhecido = [
  ['path', { d: 'M8.5 16 H7.5 A3 3 0 0 1 4.5 13 V8 A3 3 0 0 1 7.5 5 H16.5 A3 3 0 0 1 19.5 8 V13 A3 3 0 0 1 16.5 16 H11.5 L8 19.5' }],
];
