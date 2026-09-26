// Desenhos da família de ícones DW, só dados: cada ícone é uma lista de traços
// [elemento, geometria]. Espessura, cor, pontas e junções não moram aqui —
// são da moldura (Icone.jsx), iguais para todos.
//
// Regras da grade (conferidas no teste da pasta):
// - 24 × 24, desenho na área útil de ~20 × 20 (de 2 a 22, já contando o traço);
// - só comandos absolutos nos caminhos, para revisar coordenada a coordenada;
// - diagonais a 45°; caixas com canto de raio 4 (balões), 3, 2,5 ou 2 (menores);
// - abertura intencional só onde ela diz algo.
//
// Linguagem própria dos ícones centrais (prancha 2), em dois elementos:
// - CONVERSA: moldura interrompida no canto de baixo, de onde a cauda sai
//   como traço a 45° — nunca o balão fechado com triângulo;
// - CONEXÃO: pontos pequenos ligados por retas, com a mudança de rumo a 45°.
// A relação entre os dois é o que dá o sentido: a cauda que termina num ponto
// é a conversa conectada (atendimento); a cauda solta com a parada dentro é a
// conversa encerrada; a ligação que sai da origem e segue até outro ponto é a
// transferência.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// Moldura de conversa: largura de 4 a 20, canto de raio 3, interrompida entre
// x = 8 e x = 11 na borda de baixo. Quem usa acrescenta a cauda a partir de
// (11, base).
const moldura = (topo, base) =>
  `M8 ${base} H7 A3 3 0 0 1 4 ${base - 3} V${topo + 3} A3 3 0 0 1 7 ${topo} H17 A3 3 0 0 1 20 ${topo + 3} V${base - 3} A3 3 0 0 1 17 ${base} H11`;

// ── Navegação ───────────────────────────────────────────────────────────────

// A conversa conduzida: a cauda termina num ponto ativo.
export const atendimento = [
  ['path', { d: `${moldura(3.5, 14.5)} L7.56 17.94` }],
  ['circle', { cx: 6.5, cy: 19, r: 1.5 }],
];

// Três entradas convergindo a 45° para um fluxo com direção.
export const filas = [
  ['circle', { cx: 5, cy: 5, r: 1.25 }],
  ['circle', { cx: 5, cy: 12, r: 1.25 }],
  ['circle', { cx: 5, cy: 19, r: 1.25 }],
  ['path', { d: 'M5.88 5.88 L12 12 L5.88 18.12 M6.25 12 H20 M16.75 8.75 L20 12 L16.75 15.25' }],
];

// Duas pessoas; a de trás deixa o contorno aberto onde a da frente passa.
export const equipe = [
  ['circle', { cx: 9, cy: 8, r: 3 }],
  ['path', { d: 'M3.5 19 A5.5 5.5 0 0 1 14.5 19' }],
  ['path', { d: 'M13.84 6.25 A2.5 2.5 0 1 1 13.84 8.75' }],
  ['path', { d: 'M15.5 13.75 A5.25 5.25 0 0 1 20.75 19' }],
];

// Origens diferentes ligadas ao mesmo núcleo, pelas diagonais. O núcleo fica
// meio ponto abaixo e à direita: o canto sem origem deixaria o peso para cima.
export const canais = [
  ['circle', { cx: 12.5, cy: 12.5, r: 3 }],
  ['circle', { cx: 5.75, cy: 5.75, r: 1.5 }],
  ['circle', { cx: 19.25, cy: 5.75, r: 1.5 }],
  ['circle', { cx: 5.75, cy: 19.25, r: 1.5 }],
  ['path', { d: 'M6.81 6.81 L10.38 10.38 M18.19 6.81 L14.62 10.38 M6.81 18.19 L10.38 14.62' }],
];

// Uma conversa que se abre para vários destinos: o disparo. É o inverso de
// Filas (várias entradas convergindo), na mesma linguagem.
export const campanhas = [
  ['path', { d: 'M6 16.25 H5.5 A2.5 2.5 0 0 1 3 13.75 V10.25 A2.5 2.5 0 0 1 5.5 7.75 H9.5 A2.5 2.5 0 0 1 12 10.25 V13.75 A2.5 2.5 0 0 1 9.5 16.25 H8.5 L6.25 18.5' }],
  ['path', { d: 'M12 12 H17.5 M13.5 12 L17.94 7.56 M13.5 12 L17.94 16.44' }],
  ['circle', { cx: 19, cy: 6.5, r: 1.5 }],
  ['circle', { cx: 19, cy: 12, r: 1.5 }],
  ['circle', { cx: 19, cy: 17.5, r: 1.5 }],
];

export const relatorios = [['path', { d: 'M6 19.5 V13.5 M12 19.5 V4.5 M18 19.5 V9.5' }]];

// Três ajustes de nível, em vez da engrenagem: lê melhor em 16 px.
export const configuracoes = [
  ['path', { d: 'M4 6.5 H14 M18 6.5 H20 M4 12 H6.5 M10.5 12 H20 M4 17.5 H11.5 M15.5 17.5 H20' }],
  ['circle', { cx: 16, cy: 6.5, r: 2 }],
  ['circle', { cx: 8.5, cy: 12, r: 2 }],
  ['circle', { cx: 13.5, cy: 17.5, r: 2 }],
];

// ── Lista e cabeçalho ───────────────────────────────────────────────────────

// A moldura de conversa com o sinal de nova dentro, como a parada do Encerrar.
export const novaConversa = [
  ['path', { d: `${moldura(4.5, 15.5)} L7.5 19` }],
  ['path', { d: 'M12 7 V13 M9 10 H15' }],
];

export const maisOpcoes = [
  ['circle', { cx: 12, cy: 5.5, r: 1 }],
  ['circle', { cx: 12, cy: 12, r: 1 }],
  ['circle', { cx: 12, cy: 18.5, r: 1 }],
];

export const buscar = [
  ['circle', { cx: 10.5, cy: 10.5, r: 6.25 }],
  ['path', { d: 'M15.25 15.25 L20 20' }],
];

export const informacoes = [
  ['circle', { cx: 12, cy: 12, r: 8.75 }],
  ['path', { d: 'M12 11 V16.25' }],
  ['circle', { cx: 12, cy: 7.75, r: 0.5 }],
];

// Registro estruturado em linhas; a linha consultada sai pela interrupção da
// borda e segue a 45° até o ponto de consulta.
export const consultarSgp = [
  ['path', { d: 'M14.25 10.5 V7 A2.5 2.5 0 0 0 11.75 4.5 H5.75 A2.5 2.5 0 0 0 3.25 7 V17 A2.5 2.5 0 0 0 5.75 19.5 H11.75 A2.5 2.5 0 0 0 14.25 17 V14.5' }],
  ['path', { d: 'M6.25 8.5 H11.25 M6.25 16 H9.75' }],
  ['path', { d: 'M6.25 12.25 H16 L18.19 14.44' }],
  ['circle', { cx: 19.25, cy: 15.5, r: 1.5 }],
];

// A conversa (moldura), a origem a que ela estava ligada e o destino para onde
// a ligação segue.
export const transferir = [
  ['path', { d: `${moldura(4.5, 12.5)} L7.06 16.44` }],
  ['circle', { cx: 6, cy: 17.5, r: 1.5 }],
  ['path', { d: 'M7.5 17.5 H16.25 M14 15.25 L16.25 17.5 L14 19.75' }],
  ['circle', { cx: 19.5, cy: 17.5, r: 1.5 }],
];

// A cauda perde o ponto ativo e a conversa ganha a parada: fechada de vez.
export const encerrar = [
  ['path', { d: `${moldura(4.5, 15.5)} L7.5 19` }],
  ['rect', { x: 9.5, y: 7.5, width: 5, height: 5, rx: 1.25 }],
];

// Relógio aberto à esquerda; a ponta da abertura volta no tempo.
export const historico = [
  ['path', { d: 'M4.27 14.07 A8 8 0 1 0 6.34 6.34' }],
  ['path', { d: 'M6.34 3.09 V6.34 H9.59' }],
  ['path', { d: 'M12 8 V12 L14.5 14.5' }],
];

// Ficha de identificação: o retrato apoiado na borda de baixo.
export const dadosCliente = [
  ['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2.5 }],
  ['circle', { cx: 9, cy: 10.5, r: 2.25 }],
  ['path', { d: 'M5.5 19 A3.5 3.5 0 0 1 12.5 19' }],
  ['path', { d: 'M14.5 10 H17.5 M14.5 13.5 H16.5' }],
];

// Um desenho só: girar o elemento inteiro faz a volta (recolher ↔ expandir).
export const recolher = [['path', { d: 'M6.5 9.25 L12 14.75 L17.5 9.25' }]];

// O atendente ocupa a abertura da conversa: a moldura se abre para o lado dele.
export const assumir = [
  ['path', { d: 'M11 4.5 H6.5 A3 3 0 0 0 3.5 7.5 V11.5 A3 3 0 0 0 6.5 14.5 H7 M10 14.5 L7.25 17.25' }],
  ['circle', { cx: 16, cy: 8.5, r: 2.5 }],
  ['path', { d: 'M11.5 19.5 A4.5 4.5 0 0 1 20.5 19.5' }],
];

// ── Compositor ──────────────────────────────────────────────────────────────

// Clipe desenhado em pé e girado 45°, com o laço maior embaixo.
export const anexar = [
  [
    'path',
    {
      d: 'M18.24 13.91 L14 18.15 A5 5 0 0 1 6.93 11.08 L12.58 5.43 A3.5 3.5 0 0 1 17.53 10.38 L13.29 14.62 A2 2 0 0 1 10.46 11.79 L13.29 8.96',
    },
  ],
];

// Trechos prontos; o gesto dobra e leva um deles até o cursor do texto.
export const respostasRapidas = [
  ['path', { d: 'M4.75 4.25 H12.75 M4.75 8.25 H10.25' }],
  ['path', { d: 'M6.25 11.25 V13.75 A2 2 0 0 0 8.25 15.75 H15.75 M13.5 13.5 L15.75 15.75 L13.5 18' }],
  ['path', { d: 'M19.25 11.75 V19.75' }],
];

export const emoji = [
  ['circle', { cx: 12, cy: 12, r: 8.75 }],
  ['circle', { cx: 9, cy: 9.75, r: 0.6 }],
  ['circle', { cx: 15, cy: 9.75, r: 0.6 }],
  ['path', { d: 'M8.5 14.25 A4 4 0 0 0 15.5 14.25' }],
];

export const microfone = [
  ['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }],
  ['path', { d: 'M5.5 11 A6.5 6.5 0 0 0 18.5 11 M12 17.5 V21' }],
];

// Avião de papel com vinco. Deslocado à direita da caixa: o peso visual do
// triângulo fica na cauda, e centrado pela caixa ele parece fugir para a esquerda.
export const enviar = [
  ['path', { d: 'M4.5 4.5 L21 12 L4.5 19.5 L8 12 Z' }],
  ['path', { d: 'M8 12 H13.5' }],
];

// ── Utilidades ──────────────────────────────────────────────────────────────

export const som = [
  ['path', { d: 'M4.5 17 L6.5 15 V10.5 A5.5 5.5 0 0 1 17.5 10.5 V15 L19.5 17 Z' }],
  ['path', { d: 'M12 3 V5 M10.25 19.25 A1.75 1.75 0 0 0 13.75 19.25' }],
];

// O mesmo sino cortado a 45°. O contorno se abre onde o corte passa — no arco
// de cima e na base —, em vez de o traço atravessar por cima.
export const somDesativado = [
  ['path', { d: 'M15.7 17 H4.5 L6.5 15 V10.5 A5.5 5.5 0 0 1 6.83 8.62 M8.32 6.41 A5.5 5.5 0 0 1 17.5 10.5 V15 L19.5 17 H18.3' }],
  ['path', { d: 'M12 3 V5 M10.25 19.25 A1.75 1.75 0 0 0 13.75 19.25' }],
  ['path', { d: 'M4 4 L20 20' }],
];

// A conversa encerrada (com a parada) à frente e outra guardada atrás.
export const encerrados = [
  ['path', { d: 'M7.25 17.5 H6 A2.5 2.5 0 0 1 3.5 15 V11 A2.5 2.5 0 0 1 6 8.5 H14 A2.5 2.5 0 0 1 16.5 11 V15 A2.5 2.5 0 0 1 14 17.5 H9.75 L7 20.25' }],
  ['rect', { x: 8, y: 11, width: 4, height: 4, rx: 1 }],
  ['path', { d: 'M8 6.25 V6 A2.5 2.5 0 0 1 10.5 3.5 H18 A2.5 2.5 0 0 1 20.5 6 V12.5' }],
];

export const sair = [
  ['path', { d: 'M10.5 4 H6.5 A2.5 2.5 0 0 0 4 6.5 V17.5 A2.5 2.5 0 0 0 6.5 20 H10.5' }],
  ['path', { d: 'M10 12 H20 M16.5 8.5 L20 12 L16.5 15.5' }],
];

// Menu: três traços iguais, a metáfora que todo mundo lê como "abrir o
// menu". Ocupa a área útil da família (4,5 a 19,5) com o espaçamento dela
// (5,5), e não a grade padrão das bibliotecas.
export const menu = [['path', { d: 'M4.5 6.5 H19.5 M4.5 12 H19.5 M4.5 17.5 H19.5' }]];

// ── Painel SGP ──────────────────────────────────────────────────────────────

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
