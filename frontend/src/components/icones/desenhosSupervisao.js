// Desenhos da família DW para a Supervisão (visão geral). Moram fora de
// desenhos.js, como os do painel SGP: só a Supervisão os usará, e o empacotador
// põe um módulo inteiro num trecho só — no índice, viajariam com a mesa. Nesta
// rodada nenhuma tela os importa: estão aqui para aprovação visual.
//
// As regras da grade são as de desenhos.js: 24 × 24, desenho entre 2 e 22 já
// contando o traço, só comandos absolutos, diagonais a 45°, e a linguagem da
// família — a CONVERSA (moldura interrompida, cauda a 45°) e a CONEXÃO (pontos
// ligados por retas).
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// Funil: a borda larga recebe tudo, as paredes descem a 45° e o gargalo aberto
// deixa passar um só — que cai como o ponto da família, o resultado.
export const filtros = [
  ['path', { d: 'M9.5 13.75 V11 L4 5.5 H20 L14.5 11 V13.75' }],
  ['circle', { cx: 12, cy: 18.25, r: 1.5 }],
];

// Remover um filtro do chip: o × pequeno, com 8 de lado e respiro largo na
// grade. Em 16 px ocupa 6 px, o tamanho de uma ação dentro do chip, e não a
// cruz de canto a canto de um "fechar janela".
export const removerFiltro = [['path', { d: 'M8 8 L16 16 M16 8 L8 16' }]];

// Ampulheta a 45°: o filete que liga as duas metades pela cintura é a ligação
// da família, e o grão que já caiu está pousado no fundo — o tempo que o
// cliente está esperando. O filete para na cintura: descendo até o fundo, em
// 24 px virava uma coluna dentro da metade de baixo.
export const espera = [
  ['path', { d: 'M6 4 H18 L12 10 Z M6 20 H18 L12 14 Z' }],
  ['path', { d: 'M12 10 V14' }],
  ['circle', { cx: 12, cy: 18, r: 0.9 }],
];

// Automação mora em desenhoAutomacao.js: Configurações também a usa (grupo IA
// e automações e página Atendimento com IA) e leva só ela. Reexportada aqui:
// a fonte é uma só.
export { automacao } from './desenhoAutomacao.js';

// Sem responsável: a vaga do responsável ainda vazia. O contorno do retrato é
// tracejado (oito arcos, metade traço e metade vão, com os vãos nos eixos e nas
// diagonais) — o lugar existe, ninguém o ocupa. Com vão menor, em 16 px o
// tracejado fechava e o anel virava um retrato comum. Uma pessoa só, sem
// cadeado nem corte: não é equipe, nem perfil bloqueado. A cabeça fica solta
// dos ombros para não virar um borrão em 16 px.
export const semResponsavel = [
  [
    'path',
    {
      d: 'M13.66 3.66 A8.5 8.5 0 0 1 16.72 4.93 M19.07 7.28 A8.5 8.5 0 0 1 20.34 10.34 M20.34 13.66 A8.5 8.5 0 0 1 19.07 16.72 M16.72 19.07 A8.5 8.5 0 0 1 13.66 20.34 M10.34 20.34 A8.5 8.5 0 0 1 7.28 19.07 M4.93 16.72 A8.5 8.5 0 0 1 3.66 13.66 M3.66 10.34 A8.5 8.5 0 0 1 4.93 7.28 M7.28 4.93 A8.5 8.5 0 0 1 10.34 3.66',
    },
  ],
  ['circle', { cx: 12, cy: 8.75, r: 2.25 }],
  ['path', { d: 'M8.25 17 A3.75 3.75 0 0 1 15.75 17' }],
];
