// Mapeamento mestre: significado (slot) -> nome em cada familia.
// ph = Phosphor core 2.1.1 (regular + fill), tb = Tabler 3.48.0 (outline + filled),
// hi = Heroicons 2.2.0 (24/outline + 24/solid), lu = Lucide static 1.48.0 (so contorno).
// Cada entrada: [contorno, preenchido|null]. null no contorno = familia nao tem.
import fs from 'fs';
export const SP = 'C:/Users/WILLEM~1/AppData/Local/Temp/claude/d--dw-whatsapp-backend/928a28ee-4694-4e44-8cac-e7f98e8a0985/scratchpad/icones/';
const P = SP + 'pacotes/';
export const ARQ = {
  ph: { reg: (n) => `${P}phosphor-icons-core-2.1.1/package/assets/regular/${n}.svg`, fill: (n) => `${P}phosphor-icons-core-2.1.1/package/assets/fill/${n}-fill.svg` },
  tb: { reg: (n) => `${P}tabler-icons-3.48.0/package/icons/outline/${n}.svg`, fill: (n) => `${P}tabler-icons-3.48.0/package/icons/filled/${n}.svg` },
  hi: { reg: (n) => `${P}heroicons-2.2.0/package/24/outline/${n}.svg`, fill: (n) => `${P}heroicons-2.2.0/package/24/solid/${n}.svg` },
  lu: { reg: (n) => `${P}lucide-static-1.48.0/package/icons/${n}.svg`, fill: () => null },
};
export const NOME_FAMILIA = { ph: 'Phosphor', tb: 'Tabler', hi: 'Heroicons', lu: 'Lucide' };
// slot: { ph:[reg,fill], tb:[reg,fill], hi:[reg,fill], lu:[reg] }
const S = (ph, phf, tb, tbf, hi, hif, lu) => ({ ph: [ph, phf], tb: [tb, tbf], hi: [hi, hif], lu: [lu, null] });
export const SLOTS = {
  busca: S('magnifying-glass', 'magnifying-glass', 'search', 'search', 'magnifying-glass', 'magnifying-glass', 'search'),
  adicionar: S('plus', 'plus', 'plus', 'plus', 'plus', 'plus', 'plus'),
  'chevron-baixo': S('caret-down', 'caret-down', 'chevron-down', 'chevron-down', 'chevron-down', 'chevron-down', 'chevron-down'),
  'chevron-direita': S('caret-right', 'caret-right', 'chevron-right', 'chevron-right', 'chevron-right', 'chevron-right', 'chevron-right'),
  voltar: S('arrow-left', 'arrow-left', 'arrow-left', null, 'arrow-left', 'arrow-left', 'arrow-left'),
  'seta-direita': S('arrow-right', 'arrow-right', 'arrow-right', null, 'arrow-right', 'arrow-right', 'arrow-right'),
  historico: S('clock-counter-clockwise', 'clock-counter-clockwise', 'history', null, null, null, 'history'),
  transferir: S('arrows-left-right', 'arrows-left-right', 'arrows-left-right', null, 'arrows-right-left', 'arrows-right-left', 'arrow-left-right'),
  encerrar: S('check-circle', 'check-circle', 'circle-check', 'circle-check', 'check-circle', 'check-circle', 'circle-check'),
  assumir: S('user-check', 'user-check', 'user-check', null, 'user-plus', 'user-plus', 'user-check'),
  check: S('check', 'check', 'check', null, 'check', 'check', 'check'),
  'lido-entregue': S('checks', 'checks', 'checks', null, null, null, 'check-check'),
  fechar: S('x', 'x', 'x', 'x', 'x-mark', 'x-mark', 'x'),
  anexo: S('paperclip', 'paperclip', 'paperclip', null, 'paper-clip', 'paper-clip', 'paperclip'),
  emoji: S('smiley', 'smiley', 'mood-smile', 'mood-smile', 'face-smile', 'face-smile', 'smile'),
  'resposta-rapida': S('lightning', 'lightning', 'bolt', 'bolt', 'bolt', 'bolt', 'zap'),
  microfone: S('microphone', 'microphone', 'microphone', 'microphone', 'microphone', 'microphone', 'mic'),
  enviar: S('paper-plane-right', 'paper-plane-right', 'send', 'send', 'paper-airplane', 'paper-airplane', 'send-horizontal'),
  lixeira: S('trash', 'trash', 'trash', 'trash', 'trash', 'trash', 'trash-2'),
  parar: S('stop', 'stop', 'player-stop', 'player-stop', 'stop', 'stop', 'square'),
  play: S('play', 'play', 'player-play', 'player-play', 'play', 'play', 'play'),
  pause: S('pause', 'pause', 'player-pause', 'player-pause', 'pause', 'pause', 'pause'),
  download: S('download-simple', 'download-simple', 'download', 'download', 'arrow-down-tray', 'arrow-down-tray', 'download'),
  local: S('map-pin', 'map-pin', 'map-pin', 'map-pin', 'map-pin', 'map-pin', 'map-pin'),
  cadeado: S('lock-simple', 'lock-simple', 'lock', 'lock', 'lock-closed', 'lock-closed', 'lock'),
  sino: S('bell', 'bell', 'bell', 'bell', 'bell', 'bell', 'bell'),
  'sino-mudo': S('bell-slash', 'bell-slash', 'bell-off', null, 'bell-slash', 'bell-slash', 'bell-off'),
  relatorio: S('chart-bar', 'chart-bar', 'chart-bar', null, 'chart-bar', 'chart-bar', 'chart-column'),
  configuracoes: S('gear-six', 'gear-six', 'settings', 'settings', 'cog-6-tooth', 'cog-6-tooth', 'settings'),
  sair: S('sign-out', 'sign-out', 'logout', null, 'arrow-right-start-on-rectangle', 'arrow-right-start-on-rectangle', 'log-out'),
  equipe: S('users', 'users', 'users', null, 'users', 'users', 'users'),
  supervisao: S('binoculars', 'binoculars', 'binoculars', 'binoculars', 'eye', 'eye', 'binoculars'),
  alerta: S('warning', 'warning', 'alert-triangle', 'alert-triangle', 'exclamation-triangle', 'exclamation-triangle', 'triangle-alert'),
  falha: S('warning-circle', 'warning-circle', 'alert-circle', 'alert-circle', 'exclamation-circle', 'exclamation-circle', 'circle-alert'),
  atendimento: S('chats-circle', 'chats-circle', 'messages', 'messages', 'chat-bubble-left-right', 'chat-bubble-left-right', 'messages-square'),
  cliente: S('user', 'user', 'user', 'user', 'user', 'user', 'user'),
  campanha: S('megaphone', 'megaphone', 'speakerphone', null, 'megaphone', 'megaphone', 'megaphone'),
  canal: S('device-mobile', 'device-mobile', 'device-mobile', 'device-mobile', 'device-phone-mobile', 'device-phone-mobile', 'smartphone'),
  ia: S('sparkle', 'sparkle', 'sparkles', 'sparkles', 'sparkles', 'sparkles', 'sparkles'),
  'ia-cerebro': S('brain', 'brain', 'brain', null, 'cpu-chip', 'cpu-chip', 'brain'),
  regras: S('list-checks', 'list-checks', 'list-check', null, 'list-bullet', 'list-bullet', 'list-checks'),
  integracoes: S('plugs', 'plugs', 'plug', null, 'puzzle-piece', 'puzzle-piece', 'plug'),
  tag: S('tag', 'tag', 'tag', 'tag', 'tag', 'tag', 'tag'),
  empresa: S('buildings', 'buildings', 'building', null, 'building-office', 'building-office', 'building-2'),
  'adicionar-usuario': S('user-plus', 'user-plus', 'user-plus', null, 'user-plus', 'user-plus', 'user-plus'),
  'mais-h': S('dots-three', 'dots-three', 'dots', null, 'ellipsis-horizontal', 'ellipsis-horizontal', 'ellipsis'),
  'mais-v': S('dots-three-vertical', 'dots-three-vertical', 'dots-vertical', null, 'ellipsis-vertical', 'ellipsis-vertical', 'ellipsis-vertical'),
  atualizar: S('arrow-clockwise', 'arrow-clockwise', 'refresh', null, 'arrow-path', 'arrow-path', 'refresh-cw'),
  info: S('info', 'info', 'info-circle', 'info-circle', 'information-circle', 'information-circle', 'info'),
  template: S('file-text', 'file-text', 'file-text', 'file-text', 'document-text', 'document-text', 'file-text'),
  relogio: S('clock', 'clock', 'clock', 'clock', 'clock', 'clock', 'clock'),
  servidor: S('hard-drives', 'hard-drives', 'server', null, 'server', 'server', 'server'),
  editar: S('pencil-simple', 'pencil-simple', 'pencil', 'pencil', 'pencil', 'pencil', 'pencil'),
  pix: S('pix-logo', 'pix-logo', null, null, null, null, null),
  'codigo-barras': S('barcode', 'barcode', 'barcode', null, null, null, 'barcode'),
  qr: S('qr-code', 'qr-code', 'qrcode', null, 'qr-code', 'qr-code', 'qr-code'),
  pdf: S('file-pdf', 'file-pdf', 'file-type-pdf', null, null, null, null),
  link: S('link', 'link', 'link', null, 'link', 'link', 'link'),
  'documento-cpf': S('identification-card', 'identification-card', 'id', null, 'identification', 'identification', 'id-card'),
  carregando: S('circle-notch', 'circle-notch', 'loader-2', null, null, null, 'loader-circle'),
  calendario: S('calendar-blank', 'calendar-blank', 'calendar', 'calendar', 'calendar', 'calendar', 'calendar'),
  responder: S('arrow-bend-up-left', 'arrow-bend-up-left', 'arrow-back-up', null, 'arrow-uturn-left', 'arrow-uturn-left', 'reply'),
  setores: S('stack', 'stack', 'stack-2', null, 'square-3-stack-3d', 'square-3-stack-3d', 'layers'),
  'caixa-entrada': S('tray', 'tray', 'inbox', null, 'inbox', 'inbox', 'inbox'),
  triagem: S('tree-structure', 'tree-structure', 'hierarchy', null, null, null, 'network'),
  noturno: S('moon-stars', 'moon-stars', 'moon-stars', null, 'moon', 'moon', 'moon-star'),
  exibir: S('eye', 'eye', 'eye', 'eye', 'eye', 'eye', 'eye'),
  foto: S('image', 'image', 'photo', 'photo', 'photo', 'photo', 'image'),
  video: S('video-camera', 'video-camera', 'video', null, 'video-camera', 'video-camera', 'video'),
  figurinha: S('sticker', 'sticker', 'sticker', null, null, null, 'sticker'),
  arquivo: S('file', 'file', 'file', 'file', 'document', 'document', 'file'),
  cancelamento: S('x-circle', 'x-circle', 'circle-x', 'circle-x', 'x-circle', 'x-circle', 'circle-x'),
  financeiro: S('money', 'money', 'cash', null, 'banknotes', 'banknotes', 'banknote'),
  instalacao: S('wrench', 'wrench', 'tool', null, 'wrench', 'wrench', 'wrench'),
  reativacao: S('power', 'power', 'power', null, 'power', 'power', 'power'),
  robo: S('robot', 'robot', 'robot', null, null, null, 'bot'),
  'sem-resposta': S('chat-circle-slash', 'chat-circle-slash', 'message-circle-off', null, null, null, 'message-circle-off'),
  suporte: S('headset', 'headset', 'headset', null, null, null, 'headset'),
  senha: S('key', 'key', 'key', null, 'key', 'key', 'key-round'),
  encerrados: S('archive', 'archive', 'archive', 'archive', 'archive-box', 'archive-box', 'archive'),
  carga: S('cell-signal-high', 'cell-signal-high', 'antenna-bars-5', null, 'signal', 'signal', 'signal'),
  'zoom-mais': S('magnifying-glass-plus', 'magnifying-glass-plus', 'zoom-in', 'zoom-in', 'magnifying-glass-plus', 'magnifying-glass-plus', 'zoom-in'),
  'zoom-menos': S('magnifying-glass-minus', 'magnifying-glass-minus', 'zoom-out', 'zoom-out', 'magnifying-glass-minus', 'magnifying-glass-minus', 'zoom-out'),
};
// Tabler: o preenchido, quando existe, tem o MESMO nome na pasta filled/.
for (const e of Object.values(SLOTS)) if (e.tb[0] && !e.tb[1] && fs.existsSync(ARQ.tb.fill(e.tb[0]))) e.tb[1] = e.tb[0];
export function arquivo(fam, slot, preenchido = false) {
  const e = SLOTS[slot]?.[fam];
  if (!e) throw new Error('slot desconhecido ' + slot);
  const n = preenchido ? e[1] : e[0];
  if (!n) return null;
  const f = preenchido ? ARQ[fam].fill(n) : ARQ[fam].reg(n);
  return fs.existsSync(f) ? f : undefined; // undefined = nome declarado mas arquivo nao existe (erro)
}
