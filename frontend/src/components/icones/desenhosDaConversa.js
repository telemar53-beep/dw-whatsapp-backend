// Os três desenhos que a conversa usa em qualquer tela — mesa, Supervisão,
// Encerrados: o painel "Dados do cliente" e o acesso a ele no popup. Moram
// fora de desenhos.js para o trecho da conversa (que a Supervisão também
// baixa) levar só eles, não a família inteira. desenhos.js os reexporta: a
// fonte é uma só. Regras da grade: as de desenhos.js.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

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
