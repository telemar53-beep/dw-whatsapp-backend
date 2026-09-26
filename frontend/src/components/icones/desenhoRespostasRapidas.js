// O desenho de Respostas rápidas mora sozinho aqui porque o compositor
// (MessageInput) o usa em qualquer tela — mesa, Supervisão, Encerrados — e o
// trecho da conversa deve levar só este desenho, não a família inteira.
// desenhos.js o reexporta: a fonte é uma só. Regras da grade: as de desenhos.js.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// Trechos prontos; o gesto dobra e leva um deles até o cursor do texto.
export const respostasRapidas = [
  ['path', { d: 'M4.75 4.25 H12.75 M4.75 8.25 H10.25' }],
  ['path', { d: 'M6.25 11.25 V13.75 A2 2 0 0 0 8.25 15.75 H15.75 M13.5 13.5 L15.75 15.75 L13.5 18' }],
  ['path', { d: 'M19.25 11.75 V19.75' }],
];
