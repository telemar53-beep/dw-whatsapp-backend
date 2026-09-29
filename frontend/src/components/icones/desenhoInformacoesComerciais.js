// O desenho de Informações comerciais mora sozinho aqui porque duas áreas o
// usam — o diálogo Encerrar (motivo) e Configurações (Planos) — e cada trecho
// deve levar só ele. desenhosMotivos.js o reexporta. Regras da grade: as de
// desenhos.js.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// A etiqueta de preço, com as bordas a 45° e o furo como o ponto da família:
// planos, valores, ofertas.
export const informacoesComerciais = [
  ['path', { d: 'M11.5 3.5 H5.5 A2 2 0 0 0 3.5 5.5 V11.5 L12.5 20.5 L20.5 12.5 Z' }],
  ['circle', { cx: 8, cy: 8, r: 1.5 }],
];
