// Desenhos da família DW usados só pelo painel do SGP (fatia 3). Moram fora de
// desenhos.js de propósito: o painel é carregado sob demanda, e o empacotador
// põe um módulo inteiro num trecho só — juntos, a marca Pix viajaria com a mesa
// em toda conversa. As regras da grade são as de desenhos.js.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// Exceção deliberada da família: a marca Pix é preenchida. A marca oficial é
// um sólido — losango de pontas arredondadas cortado por duas faixas em
// chevron —, e a traço ela deixaria de ser a marca. O terceiro item, 'cheio',
// pede à moldura preenchimento na cor do texto e nenhum traço; a cor continua
// sendo a de quem usa. Construída na grade, não copiada: as faixas de corte
// ficam um pouco mais largas que na proporção oficial para aparecerem em 16 px.
export const codigoPix = [
  [
    'path',
    {
      d: 'M14.1 3.12 L17.61 6.64 L17.09 6.64 A3.06 3.06 0 0 0 14.92 7.53 L12.31 10.15 A0.44 0.44 0 0 1 11.69 10.15 L9.08 7.53 A3.06 3.06 0 0 0 6.91 6.64 L6.39 6.64 L9.9 3.12 A2.96 2.96 0 0 1 14.1 3.12 Z M3.12 9.9 L5.14 7.89 L6.91 7.89 A1.81 1.81 0 0 1 8.19 8.42 L10.81 11.03 A1.69 1.69 0 0 0 13.19 11.03 L15.81 8.42 A1.81 1.81 0 0 1 17.09 7.89 L18.86 7.89 L20.88 9.9 A2.96 2.96 0 0 1 20.88 14.1 L18.86 16.11 L17.09 16.11 A1.81 1.81 0 0 1 15.81 15.58 L13.19 12.97 A1.69 1.69 0 0 0 10.81 12.97 L8.19 15.58 A1.81 1.81 0 0 1 6.91 16.11 L5.14 16.11 L3.12 14.1 A2.96 2.96 0 0 1 3.12 9.9 Z M6.39 17.36 L6.91 17.36 A3.06 3.06 0 0 0 9.08 16.47 L11.69 13.85 A0.44 0.44 0 0 1 12.31 13.85 L14.92 16.47 A3.06 3.06 0 0 0 17.09 17.36 L17.61 17.36 L14.1 20.88 A2.96 2.96 0 0 1 9.9 20.88 L6.39 17.36 Z',
    },
    'cheio',
  ],
];

// Os três cantos de leitura do QR e, no quarto, a marca Pix pequena. O ponto
// de cada canto é um traço de 0,01: o Safari antigo não desenha traço de
// comprimento zero.
export const qrPix = [
  ['rect', { x: 3.5, y: 3.5, width: 6, height: 6, rx: 1 }],
  ['rect', { x: 14.5, y: 3.5, width: 6, height: 6, rx: 1 }],
  ['rect', { x: 3.5, y: 14.5, width: 6, height: 6, rx: 1 }],
  ['path', { d: 'M6.5 6.5 H6.51 M17.5 6.5 H17.51 M6.5 17.5 H6.51' }],
  [
    'path',
    {
      d: 'M17.99 12.81 L19.42 14.24 L19.07 14.24 A1.67 1.67 0 0 0 17.88 14.73 L17.15 15.46 A0.21 0.21 0 0 1 16.85 15.46 L16.12 14.73 A1.67 1.67 0 0 0 14.93 14.24 L14.58 14.24 L16.01 12.81 A1.4 1.4 0 0 1 17.99 12.81 Z M12.81 16.01 L13.53 15.29 L14.93 15.29 A0.62 0.62 0 0 1 15.38 15.47 L16.11 16.21 A1.26 1.26 0 0 0 17.89 16.21 L18.62 15.47 A0.62 0.62 0 0 1 19.07 15.29 L20.47 15.29 L21.19 16.01 A1.4 1.4 0 0 1 21.19 17.99 L20.47 18.71 L19.07 18.71 A0.62 0.62 0 0 1 18.62 18.53 L17.89 17.79 A1.26 1.26 0 0 0 16.11 17.79 L15.38 18.53 A0.62 0.62 0 0 1 14.93 18.71 L13.53 18.71 L12.81 17.99 A1.4 1.4 0 0 1 12.81 16.01 Z M14.58 19.76 L14.93 19.76 A1.67 1.67 0 0 0 16.12 19.27 L16.85 18.54 A0.21 0.21 0 0 1 17.15 18.54 L17.88 19.27 A1.67 1.67 0 0 0 19.07 19.76 L19.42 19.76 L17.99 21.19 A1.4 1.4 0 0 1 16.01 21.19 L14.58 19.76 Z',
    },
    'cheio',
  ],
];

// Ritmo fino, grosso, fino, fino, grosso, com vão constante de 1,5. A barra
// fina é o próprio traço; a grossa, um retângulo de 1,5 (3,25 com o traço).
export const codigoBarras = [
  ['path', { d: 'M4 6.5 V17.5 M12 6.5 V17.5 M15.25 6.5 V17.5' }],
  ['rect', { x: 7.25, y: 6.5, width: 1.5, height: 11, rx: 0.25 }],
  ['rect', { x: 18.5, y: 6.5, width: 1.5, height: 11, rx: 0.25 }],
];

// Dois laços em U a 45°, abertos um para o outro, e a ligação da família
// passando por dentro dos dois — os laços não se tocam.
export const linkFatura = [
  ['path', { d: 'M16.42 12.18 L18.36 10.23 A3.25 3.25 0 0 0 13.77 5.64 L11.82 7.58 M7.58 11.82 L5.64 13.77 A3.25 3.25 0 0 0 10.23 18.36 L12.18 16.42' }],
  ['path', { d: 'M8.99 15.01 L15.01 8.99' }],
];

// Página com a dobra discreta no canto e a etiqueta de tipo por dentro. Sem
// as letras: com o traço da família elas não se leem em 16 px.
export const pdfFatura = [
  ['path', { d: 'M18.5 8.5 V18 A2.5 2.5 0 0 1 16 20.5 H8 A2.5 2.5 0 0 1 5.5 18 V6 A2.5 2.5 0 0 1 8 3.5 H13.5 Z' }],
  ['path', { d: 'M13.5 3.5 V6.5 A2 2 0 0 0 15.5 8.5 H18.5' }],
  ['rect', { x: 8.5, y: 12.5, width: 7, height: 4, rx: 1 }],
];
