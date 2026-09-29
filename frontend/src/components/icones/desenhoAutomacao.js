// O desenho da Automação mora sozinho aqui porque duas áreas o usam — a
// Supervisão e Configurações — e cada trecho deve levar só ele, não o módulo
// inteiro da outra. desenhosSupervisao.js o reexporta. Regras da grade: as de
// desenhos.js.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// Atendimento automático: a moldura de conversa se abre no canto de cima, e
// ali mora o brilho (a IA). É a conversa entregue à automação — não o brilho
// sozinho, nem um robô. A cauda sai da interrupção da borda de baixo, a 45°.
export const automacao = [
  ['path', { d: 'M7.5 18 H6.5 A3 3 0 0 1 3.5 15 V11 A3 3 0 0 1 6.5 8 H11 M16.5 13 V15 A3 3 0 0 1 13.5 18 H10 L7 21' }],
  ['path', { d: 'M16.75 3 A3.75 3.75 0 0 0 20.5 6.75 A3.75 3.75 0 0 0 16.75 10.5 A3.75 3.75 0 0 0 13 6.75 A3.75 3.75 0 0 0 16.75 3 Z' }],
];
