// Desenhos da família DW para Configurações (Fatia S1), aprovados nas três
// pranchas de 29/09/2026. Moram fora de desenhos.js, como os do SGP, da
// Supervisão e dos motivos: só Configurações os usa, e o empacotador põe um
// módulo inteiro num trecho só — no índice, viajariam com a mesa.
//
// Regras da grade: as de desenhos.js (24 × 24, desenho entre 2 e 22 com o
// traço, comandos absolutos, retas a 0°, 45° ou 90°). A geometria é a das
// pranchas, sem retoque. Reaproveitados, e por isso fora daqui: Canais, Equipe,
// Consultar SGP, Respostas rápidas, Buscar, Menu e Recolher (índice),
// Automação e Informações comerciais (arquivos próprios). OpenAI não tem
// ícone: só o texto, até existir marca oficial com origem e autorização.
//
// Este arquivo não importa nada: a prancha de revisão o lê direto no Node.

// — Atendimento —

// Grupo Regras e horários: três itens com o visto a 45°, o que precisa valer.
export const regrasEHorarios = [
  ['path', { d: 'M3.5 6 L5 7.5 L7.5 5 M3.5 12 L5 13.5 L7.5 11 M3.5 18 L5 19.5 L7.5 17' }],
  ['path', { d: 'M11 6.25 H20.5 M11 12.25 H20.5 M11 18.25 H17' }],
];

// Horário de atendimento: o relógio inteiro, sem abertura e sem seta — é a hora, não o histórico.
export const horario = [
  ['circle', { cx: 12, cy: 12, r: 8.5 }],
  ['path', { d: 'M12 7 V12 H15.5' }],
];

// Grupo Mensagens: a conversa que chega (cauda à esquerda) e a resposta (cauda à direita), separadas — não se sobrepõem como em Encerrados.
export const mensagens = [
  ['path', { d: 'M7 9.5 H6 A2.5 2.5 0 0 1 3.5 7 V6 A2.5 2.5 0 0 1 6 3.5 H11 A2.5 2.5 0 0 1 13.5 6 V7 A2.5 2.5 0 0 1 11 9.5 H9.5 L7 12' }],
  ['path', { d: 'M17 18.5 H18 A2.5 2.5 0 0 0 20.5 16 V15 A2.5 2.5 0 0 0 18 12.5 H13 A2.5 2.5 0 0 0 10.5 15 V16 A2.5 2.5 0 0 0 13 18.5 H14.5 L17 21' }],
];

// Boas-vindas: a seta entra pela porta aberta, quem chega. É o avesso de Sair.
export const boasVindas = [
  ['path', { d: 'M13.5 4 H17.5 A2.5 2.5 0 0 1 20 6.5 V17.5 A2.5 2.5 0 0 1 17.5 20 H13.5' }],
  ['path', { d: 'M4 12 H14 M10.5 8.5 L14 12 L10.5 15.5' }],
];

// Abertura e encerramento: o par começar e parar, lado a lado e do mesmo peso.
export const aberturaEncerramento = [
  ['path', { d: 'M4 6.5 L9.5 12 L4 17.5 Z' }],
  ['rect', { x: 13, y: 8.25, width: 7.5, height: 7.5, rx: 1.75 }],
];

// Avisos por cidade: o alfinete de lugar com o sinal de atenção por dentro.
export const avisosPorCidade = [
  ['path', { d: 'M12 17.49 L7.76 13.24 A6 6 0 1 1 16.24 13.24 Z' }],
  ['path', { d: 'M12 6 V9.25' }],
  ['circle', { cx: 12, cy: 12, r: 0.75 }],
];

// Templates WhatsApp: a página dividida em cabeçalho e colunas, um molde a preencher.
export const templates = [
  ['rect', { x: 3.5, y: 4, width: 17, height: 16, rx: 2.5 }],
  ['path', { d: 'M3.5 9 H20.5 M9.5 9 V20' }],
];

// — Automação —

// Triagem por menu: o menu dentro da conversa, as opções marcadas pelo ponto da família.
export const triagemPorMenu = [
  ['path', { d: 'M8 16.5 H7 A3 3 0 0 1 4 13.5 V6.5 A3 3 0 0 1 7 3.5 H17 A3 3 0 0 1 20 6.5 V13.5 A3 3 0 0 1 17 16.5 H11 L7.5 20' }],
  ['circle', { cx: 8.25, cy: 8, r: 1 }],
  ['circle', { cx: 8.25, cy: 12, r: 1 }],
  ['path', { d: 'M11.25 8 H16 M11.25 12 H14.75' }],
];

// Identificação e comprovantes: o recibo (dentes a 45°) com o visto por dentro.
export const identificacao = [
  ['path', { d: 'M6 20.5 V5.5 A2 2 0 0 1 8 3.5 H16 A2 2 0 0 1 18 5.5 V20.5 L16 18.5 L14 20.5 L12 18.5 L10 20.5 L8 18.5 Z' }],
  ['path', { d: 'M9 11.5 L11 13.5 L15 9.5' }],
];

// Transcrição de áudio: a onda do áudio vira as linhas do texto.
export const transcricao = [
  ['path', { d: 'M4 10 V14 M7 7 V17 M10 9.5 V14.5' }],
  ['path', { d: 'M13.5 8 H20 M13.5 12 H20 M13.5 16 H17.5' }],
];

// Atendimento noturno: a lua grande com o brilho da IA — quem atende à noite é a IA.
export const atendimentoNoturno = [
  ['path', { d: 'M10.04 5.51 A7.5 7.5 0 1 0 17.99 13.46 A6 6 0 0 1 10.04 5.51 Z' }],
  ['path', { d: 'M18 3 A3 3 0 0 0 21 6 A3 3 0 0 0 18 9 A3 3 0 0 0 15 6 A3 3 0 0 0 18 3 Z' }],
];

// Ações permitidas à IA: o interruptor ligado e o brilho da IA.
export const acoesDaIa = [
  ['rect', { x: 3.5, y: 12, width: 13, height: 7.5, rx: 3.75 }],
  ['circle', { cx: 12.75, cy: 15.75, r: 1.75 }],
  ['path', { d: 'M17.5 3 A3.5 3.5 0 0 0 21 6.5 A3.5 3.5 0 0 0 17.5 10 A3.5 3.5 0 0 0 14 6.5 A3.5 3.5 0 0 0 17.5 3 Z' }],
];

// Grupo Integrações: o plugue, o sistema de fora que se liga ao nosso.
export const integracoes = [
  ['path', { d: 'M9 3.5 V7 M15 3.5 V7' }],
  ['path', { d: 'M6.5 7 H17.5 V10.5 A5.5 5.5 0 0 1 6.5 10.5 Z' }],
  ['path', { d: 'M12 16 V20.5' }],
];

// SGP: Pix e boleto: a marca Pix aprovada (a de desenhosSgp.js, só reduzida e deslocada; preenchida, como lá) ao lado do código de barras.
export const pixEBoleto = [
  ['path', { d: 'M8.05 7.56 L9.8 9.32 L9.54 9.32 A1.53 1.53 0 0 0 8.46 9.77 L7.16 11.07 A0.22 0.22 0 0 1 6.84 11.07 L5.54 9.77 A1.53 1.53 0 0 0 4.46 9.32 L4.2 9.32 L5.95 7.56 A1.48 1.48 0 0 1 8.05 7.56 Z M2.56 10.95 L3.57 9.95 L4.46 9.95 A0.91 0.91 0 0 1 5.09 10.21 L6.41 11.52 A0.84 0.84 0 0 0 7.59 11.52 L8.91 10.21 A0.91 0.91 0 0 1 9.54 9.95 L10.43 9.95 L11.44 10.95 A1.48 1.48 0 0 1 11.44 13.05 L10.43 14.05 L9.54 14.05 A0.91 0.91 0 0 1 8.91 13.79 L7.59 12.48 A0.84 0.84 0 0 0 6.41 12.48 L5.09 13.79 A0.91 0.91 0 0 1 4.46 14.05 L3.57 14.05 L2.56 13.05 A1.48 1.48 0 0 1 2.56 10.95 Z M4.2 14.68 L4.46 14.68 A1.53 1.53 0 0 0 5.54 14.23 L6.84 12.93 A0.22 0.22 0 0 1 7.16 12.93 L8.46 14.23 A1.53 1.53 0 0 0 9.54 14.68 L9.8 14.68 L8.05 16.44 A1.48 1.48 0 0 1 5.95 16.44 L4.2 14.68 Z' }, 'cheio'],
  ['path', { d: 'M13.63 7.5 V16.5 M20.38 7.5 V16.5' }],
  ['rect', { x: 16.63, y: 7.5, width: 0.75, height: 9, rx: 0.25 }],
];

// — Administração —

// Setores: um ponto que se divide em três pela ligação da família.
export const setores = [
  ['circle', { cx: 12, cy: 5, r: 2 }],
  ['path', { d: 'M12 7 V16.25 M10.59 6.41 L5.75 11.25 V16.25 M13.41 6.41 L18.25 11.25 V16.25' }],
  ['circle', { cx: 5.75, cy: 18.5, r: 1.5 }],
  ['circle', { cx: 12, cy: 18.5, r: 1.5 }],
  ['circle', { cx: 18.25, cy: 18.5, r: 1.5 }],
];

// Perfis e permissões: o crachá, uma pessoa só presa pela presilha.
export const perfis = [
  ['path', { d: 'M10 4.5 H7.5 A2.5 2.5 0 0 0 5 7 V18 A2.5 2.5 0 0 0 7.5 20.5 H16.5 A2.5 2.5 0 0 0 19 18 V7 A2.5 2.5 0 0 0 16.5 4.5 H14' }],
  ['path', { d: 'M10 3 H14 V6 H10 Z' }],
  ['circle', { cx: 12, cy: 11, r: 2.25 }],
  ['path', { d: 'M8.5 17.5 A3.5 3.5 0 0 1 15.5 17.5' }],
];

// Grupo Cadastros auxiliares: o caderno de registros, com as argolas pela lombada. Estreito, para não repetir o contorno de Empresa.
export const cadastros = [
  ['rect', { x: 7.5, y: 3.5, width: 12, height: 17, rx: 2 }],
  ['path', { d: 'M5 7.5 H9.5 M5 12 H9.5 M5 16.5 H9.5' }],
  ['path', { d: 'M12.5 8 H16.5 M12.5 12 H15.5' }],
];

// Motivos de atendimento: a etiqueta em pé, com ilhós e cordão — não é a etiqueta de preço de Planos, deitada e pontuda.
export const motivos = [
  ['path', { d: 'M9 6.5 L6.5 9 V19 A1.5 1.5 0 0 0 8 20.5 H16 A1.5 1.5 0 0 0 17.5 19 V9 L15 6.5 Z' }],
  ['circle', { cx: 12, cy: 10, r: 1.25 }],
  ['path', { d: 'M12 8.75 V6.5 A3 3 0 0 1 15 3.5 H17' }],
];

// Cidades: o alfinete sobre a ligação entre dois pontos.
export const cidades = [
  ['path', { d: 'M12 15 L8.46 11.46 A5 5 0 1 1 15.54 11.46 Z' }],
  ['circle', { cx: 12, cy: 7.93, r: 1.5 }],
  ['circle', { cx: 4.5, cy: 19, r: 1.5 }],
  ['circle', { cx: 19.5, cy: 19, r: 1.5 }],
  ['path', { d: 'M6 19 H18' }],
];

// Empresa: o prédio com as janelas no ponto da família e a porta aberta na base.
export const empresa = [
  ['path', { d: 'M10 20.5 H6.5 A1.5 1.5 0 0 1 5 19 V5 A1.5 1.5 0 0 1 6.5 3.5 H17.5 A1.5 1.5 0 0 1 19 5 V19 A1.5 1.5 0 0 1 17.5 20.5 H14 V17 H10 Z' }],
  ['path', { d: 'M9 7.5 H9.01 M12 7.5 H12.01 M15 7.5 H15.01 M9 11.25 H9.01 M12 11.25 H12.01 M15 11.25 H15.01' }],
];

// — Estado —

// Área sem acesso: o cadeado da tela de entrada, com a mesma geometria, em comandos absolutos.
export const semAcesso = [
  ['rect', { x: 5, y: 10.25, width: 14, height: 10, rx: 2.5 }],
  ['path', { d: 'M8.25 10.25 V7.5 A3.75 3.75 0 0 1 15.75 7.5 V10.25' }],
  ['path', { d: 'M12 14.5 V16.25' }],
];
