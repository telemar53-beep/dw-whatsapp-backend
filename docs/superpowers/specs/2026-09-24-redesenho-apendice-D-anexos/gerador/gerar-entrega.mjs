// Gera a entrega da familia recomendada (Phosphor 2.1.1, precisao adaptativa por
// icone) em tres modulos por camada + licenca, fora do repositorio.
import fs from 'fs';
import { SP, SLOTS, arquivo } from './familias.mjs';
import { modulo, minificar } from './vendor2.mjs';
const ADAPT = JSON.parse(fs.readFileSync(SP + 'prec-ph-adapt.json', 'utf8'));
const prec = (s, v) => ADAPT[s + '|' + v] ?? 2;
const camada = JSON.parse(fs.readFileSync(SP + 'slots-camada.json', 'utf8'));
// slot -> nome do export (mantem os nomes atuais onde ja existem: troca sem mexer nos consumidores)
export const NOME = {
  busca: 'IconSearch', adicionar: 'IconNewChat', 'chevron-baixo': 'IconChevronDown', 'chevron-direita': 'IconChevronRight', voltar: 'IconArrowLeft',
  'seta-direita': 'IconArrowRight', historico: 'IconHistory', transferir: 'IconTransfer', encerrar: 'IconCheckCircle', assumir: 'IconClaim', check: 'IconCheck',
  'lido-entregue': 'IconChecks', fechar: 'IconClose', anexo: 'IconAttach', emoji: 'IconEmoji', 'resposta-rapida': 'IconQuickReply', microfone: 'IconMic',
  enviar: 'IconSend', lixeira: 'IconTrash', parar: 'IconStop', play: 'IconPlay', pause: 'IconPause', download: 'IconDownload', local: 'IconPin', cadeado: 'IconLock',
  sino: 'IconBellOn', 'sino-mudo': 'IconBellOff', relatorio: 'IconChart', configuracoes: 'IconSettings', sair: 'IconLogout', equipe: 'IconTeam',
  supervisao: 'IconSupervision', alerta: 'IconWarning', falha: 'IconWarningCircle', atendimento: 'IconChats', cliente: 'IconUser', campanha: 'IconMegaphone',
  canal: 'IconChannel', ia: 'IconSpark', 'ia-cerebro': 'IconBrain', regras: 'IconRules', integracoes: 'IconPlug', tag: 'IconTag', empresa: 'IconBuilding',
  'adicionar-usuario': 'IconUserPlus', 'mais-h': 'IconMore', 'mais-v': 'IconMoreVertical', atualizar: 'IconRefresh', info: 'IconInfo', template: 'IconFileText',
  relogio: 'IconClock', servidor: 'IconServer', editar: 'IconEdit', pix: 'IconPix', 'codigo-barras': 'IconBarcode', qr: 'IconQrCode', pdf: 'IconPdfFile',
  link: 'IconInvoiceLink', 'documento-cpf': 'IconIdCard', carregando: 'IconSpinnerGlyph', calendario: 'IconCalendar', responder: 'IconReply', setores: 'IconStack',
  'caixa-entrada': 'IconInbox', triagem: 'IconTree', noturno: 'IconMoon', exibir: 'IconEye', foto: 'IconImage', video: 'IconVideo', figurinha: 'IconSticker',
  arquivo: 'IconDocument', cancelamento: 'IconCancel', financeiro: 'IconMoney', instalacao: 'IconWrench', reativacao: 'IconPower', robo: 'IconRobot',
  'sem-resposta': 'IconChatSlash', suporte: 'IconHeadset', senha: 'IconKey', encerrados: 'IconArchive', carga: 'IconSignal', 'zoom-mais': 'IconZoomIn', 'zoom-menos': 'IconZoomOut',
};
export const CHEIOS = ['atendimento', 'supervisao', 'campanha', 'relatorio', 'configuracoes'];
if (process.argv[1] && process.argv[1].endsWith('gerar-entrega.mjs')) {
const OUT = SP + 'entrega/';
fs.mkdirSync(OUT, { recursive: true });
const grupos = { entrada: [], raiz: [], resto: [] };
for (const [s, c] of Object.entries(camada)) { if (!NOME[s]) throw new Error('slot sem nome: ' + s); grupos[c].push(s); }
const cab = (titulo, lista) => `// ${titulo}\n// Phosphor Icons 2.1.1 (@phosphor-icons/core), peso regular${lista ? ' + fill' : ''}, MIT — ver LICENSE-Phosphor.txt ao lado.\n// GERADO: caminhos otimizados com SVGO (precisao por icone: a menor que nao muda nenhum pixel mais de 64/255\n// a 16/20/24 px contra o original). Nao edite a mao; regenere a partir do pacote.\n`;
const res = {};
function gravar(arq, titulo, itens, extra = '') {
  const { src, avisos } = modulo('ph', itens, prec);
  if (avisos.length) throw new Error(arq + ': ' + avisos.join(';'));
  const final = cab(titulo, itens.some((i) => i.variante === 'fill')) + src + extra;
  fs.writeFileSync(OUT + arq, final);
  res[arq] = { exports: itens.length + (extra ? (extra.match(/export /g) || []).length : 0), ...minificar(final, 'entrega-' + arq.replace('.js', '')) };
}
gravar('IconesEntrada.js', 'Icones do chunk de ENTRADA (login). So o que a AccessDeniedPage usa.', grupos.entrada.map((s) => ({ nome: NOME[s], slot: s, variante: 'reg' })));
const trab = [...grupos.raiz.filter((s) => s !== 'carregando').map((s) => ({ nome: NOME[s], slot: s, variante: 'reg' })), ...CHEIOS.map((s) => ({ nome: NOME[s] + 'Fill', slot: s, variante: 'fill' })), { nome: '_spin', slot: 'carregando', variante: 'reg' }];
gravar('IconesTrabalho.js', 'Icones da casca (menu) e da mesa de atendimento: tudo que "/" baixa. O cadeado vem de IconesEntrada (ja esta no chunk de entrada).', trab,
  `export { IconLock } from './IconesEntrada';\nexport function IconSpinner({ className = '', ...p }) { return _spin({ className: 'motion-safe:animate-spin ' + className, ...p }); }\n`);
gravar('IconesConfig.js', 'Icones so de rotas sob demanda (Configuracoes, Relatorios, Campanhas, Supervisao). Nao entra em "/".', grupos.resto.map((s) => ({ nome: NOME[s], slot: s, variante: 'reg' })));
fs.copyFileSync(SP + 'pacotes/phosphor-icons-core-2.1.1/package/LICENSE', OUT + 'LICENSE-Phosphor.txt');
fs.writeFileSync(OUT + 'resumo.json', JSON.stringify({ grupos, res }, null, 1));
console.log(JSON.stringify(res, null, 1));
console.log('regular', grupos.entrada.length + grupos.raiz.length + grupos.resto.length, '+ cheios', CHEIOS.length);

}