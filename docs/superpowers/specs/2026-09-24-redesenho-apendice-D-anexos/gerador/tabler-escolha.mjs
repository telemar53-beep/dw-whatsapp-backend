// Escolha final de desenho Tabler por significado (o mapeamento de significados e o
// mesmo da entrega Phosphor; so muda o desenho). Parte de familias.mjs e troca onde a
// prancha de candidatos mostrou um desenho melhor.
import fs from 'fs';
import { SP, SLOTS } from './familias.mjs';
export const TB_DIR = SP + 'pacotes/tabler-icons-3.48.0/package/icons/outline/';
export const TROCAS = {
  atendimento: 'message-circle', // `messages` (dois baloes quadrados) se funde a 16 px; message-circle casa com message-circle-off (sem resposta)
  enviar: 'send-2', // horizontal, como hoje e como no WhatsApp; `send` e inclinado 45 graus
  supervisao: 'device-desktop-analytics', // binoculars ocupa ~60% da caixa e some a 19 px no menu; eye colidiria com "exibir"
  carga: 'gauge', // antenna-bars-5 quase some a 13 px (tamanho do chip no TransferModal)
};
export const TB = Object.fromEntries(Object.keys(SLOTS).map((s) => [s, TROCAS[s] ?? SLOTS[s].tb[0]]));
export const arqTb = (slot) => (TB[slot] ? TB_DIR + TB[slot] + '.svg' : null);
for (const [s, n] of Object.entries(TB)) if (n && !fs.existsSync(TB_DIR + n + '.svg')) throw new Error('nao existe na Tabler: ' + s + ' -> ' + n);
