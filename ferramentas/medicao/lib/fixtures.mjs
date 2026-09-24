// Dados simulados, deterministas. O "agora" da pagina e congelado em
// AGORA_FIXO (ver lib/session.mjs), para "Hoje"/"Ontem" e os horarios sairem
// iguais em qualquer rodada — e os prints de antes/depois serem comparaveis.
import crypto from 'node:crypto';
import { encodePng } from './png.mjs';

export const AGORA_FIXO = Date.parse('2026-09-24T14:30:00-03:00');
const MEIA_NOITE = Date.parse('2026-09-24T00:00:00-03:00');

export function uuid(semente) {
  const h = crypto.createHash('md5').update(String(semente)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// dia 0 = hoje (24/09), -1 = ontem. hhmm "08:05"
export function quando(dia, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(MEIA_NOITE + dia * 86400000 + h * 3600000 + m * 60000).toISOString();
}

// ---------- Imagens ----------
function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
export const PNG_AVATAR = encodePng(64, 64, (x, y) => {
  // silhueta neutra (cabeca e ombros) sobre fundo cinza-azulado claro
  const dxh = x - 32;
  const dyh = y - 25;
  const cabeca = dxh * dxh + dyh * dyh < 12 * 12;
  const dxo = x - 32;
  const dyo = y - 64;
  const ombro = dxo * dxo * 0.55 + dyo * dyo < 26 * 26;
  if (cabeca || ombro) return [120, 134, 146];
  return [clamp(206 - y * 0.3), clamp(214 - y * 0.3), clamp(220 - y * 0.3)];
});
export const PNG_FOTO = encodePng(320, 214, (x, y) => {
  // "foto" de um roteador numa mesa: fundo em degrade + caixa escura + leds
  let r = 176 - y * 0.25;
  let g = 170 - y * 0.25;
  let b = 160 - y * 0.2;
  if (y > 150) {
    r = 120 - (y - 150) * 0.3;
    g = 98 - (y - 150) * 0.3;
    b = 80 - (y - 150) * 0.3;
  }
  if (x > 60 && x < 260 && y > 90 && y < 150) {
    r = 38;
    g = 41;
    b = 46;
    const leds = [90, 120, 150, 180];
    for (const lx of leds) {
      const dx = x - lx;
      const dy = y - 110;
      if (dx * dx + dy * dy < 16) {
        if (lx === 180) return [214, 60, 52];
        return [90, 200, 120];
      }
    }
  }
  return [clamp(r), clamp(g), clamp(b)];
});

// ---------- Cadastros ----------
export const CANAIS = [
  { id: uuid('canal-suporte'), name: 'DW Suporte', type: 'baileys', status: 'connected', phoneNumber: '5598981110000' },
  { id: uuid('canal-comercial'), name: 'DW Comercial', type: 'meta_cloud', status: 'connected', phoneNumber: '5598981110001' },
  { id: uuid('canal-financeiro'), name: 'DW Financeiro', type: 'baileys', status: 'connected', phoneNumber: '5598981110002' },
];
const CANAL = Object.fromEntries(CANAIS.map((c) => [c.name, c]));

export const SETORES = [
  { id: uuid('setor-suporte'), name: 'Suporte Técnico' },
  { id: uuid('setor-financeiro'), name: 'Financeiro' },
  { id: uuid('setor-comercial'), name: 'Comercial' },
  { id: uuid('setor-cobranca'), name: 'Cobrança' },
];
const SETOR = Object.fromEntries(SETORES.map((s) => [s.name, s]));

export const CIDADES = [
  'Cândido Mendes',
  'Godofredo Viana',
  'Carutapera',
  'Luís Domingues',
  'Turiaçu',
  'Bacuri',
  'Maracaçumé',
  'Governador Nunes Freire',
].map((name) => ({ id: uuid('cidade-' + name), name, kind: 'municipio', parentId: null }));
const CIDADE = Object.fromEntries(CIDADES.map((c) => [c.name, c]));
export const LOCALIDADES = [
  { id: uuid('loc-barao'), name: 'Barão de Tromaí', kind: 'localidade', parentId: CIDADE['Cândido Mendes'].id },
  { id: uuid('loc-aurizona'), name: 'Aurizona', kind: 'localidade', parentId: CIDADE['Godofredo Viana'].id },
];
const LOCAL = Object.fromEntries(LOCALIDADES.map((c) => [c.name, c]));

export const MOTIVOS = [
  'Sem conexão',
  'Lentidão',
  'Segunda via',
  'Comprovante de pagamento',
  'Mudança de plano',
  'Negociação de débito',
  'Instalação',
  'Informações comerciais',
].map((name, i) => ({ id: uuid('motivo-' + name), name, active: true, sortOrder: i }));
const MOTIVO = Object.fromEntries(MOTIVOS.map((m) => [m.name, m]));

// ---------- Atendentes ----------
export const EU_ATENDENTE = {
  id: uuid('agente-carla'),
  name: 'Carla Menezes',
  email: 'carla.menezes@exemplo.com.br',
  role: 'agent',
  canManageIntegrations: false,
  avatarPath: null,
};
export const EU_ADMIN = {
  id: uuid('agente-rafael'),
  name: 'Rafael Souza',
  email: 'rafael.souza@exemplo.com.br',
  role: 'admin',
  canManageIntegrations: true,
  avatarPath: null,
};
export function listaDeAtendentes() {
  const base = [
    [EU_ATENDENTE, true, 6, null],
    [EU_ADMIN, true, 0, null],
    [{ id: uuid('agente-juliana'), name: 'Juliana Castro', email: 'juliana@exemplo.com.br', role: 'agent', avatarPath: 'avatars/juliana.png' }, true, 4, null],
    [{ id: uuid('agente-marcos'), name: 'Marcos Vinícius Pereira', email: 'marcos@exemplo.com.br', role: 'agent', avatarPath: null }, false, 0, quando(0, '12:10')],
    [{ id: uuid('agente-patricia'), name: 'Patrícia Lopes', email: 'patricia@exemplo.com.br', role: 'agent', avatarPath: 'avatars/patricia.png' }, true, 5, null],
    [{ id: uuid('agente-diego'), name: 'Diego Almeida', email: 'diego@exemplo.com.br', role: 'manager', avatarPath: null }, false, 0, quando(-1, '18:40')],
    [{ id: uuid('agente-beatriz'), name: 'Beatriz Nogueira', email: 'beatriz@exemplo.com.br', role: 'agent', avatarPath: null }, true, 3, null],
  ];
  return base.map(([a, online, ativos, visto]) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    role: a.role,
    avatarPath: a.avatarPath || null,
    online,
    lastSeenAt: online ? quando(0, '14:29') : visto,
    activeConversations: ativos,
  }));
}

// ---------- Conversas ----------
function conversa(semente, c) {
  const cidade = c.cidade ? CIDADE[c.cidade] : null;
  const local = c.local ? LOCAL[c.local] : null;
  const setor = c.setor ? SETOR[c.setor] : null;
  const canal = CANAL[c.canal || 'DW Suporte'];
  const motivoIa = c.ia ? MOTIVO[c.ia] : null;
  const contactId = uuid('contato-' + semente);
  return {
    id: uuid('conversa-' + semente),
    contactId,
    channelId: canal.id,
    status: c.dono ? 'assigned' : 'waiting',
    assignedAgentId: c.dono ? c.dono.id : null,
    sectorId: setor ? setor.id : null,
    triageState: c.pendente ? 'pending' : c.ia ? 'completed' : null,
    triageAttempts: 0,
    protocolNumber: c.protocolo || null,
    businessHoursNoticeSentAt: null,
    suggestedReasonId: motivoIa ? motivoIa.id : null,
    aiTriageSectorId: motivoIa && setor ? setor.id : null,
    aiTriageReasonId: motivoIa ? motivoIa.id : null,
    aiTriageConfidence: motivoIa ? (c.baixa ? 0.41 : 0.87) : null,
    aiTriageSummary: motivoIa ? c.resumo || `Cliente relata: ${motivoIa.name.toLowerCase()}.` : null,
    aiTriageIdentifiedBy: motivoIa ? 'cpf' : null,
    aiTriageLowConfidence: Boolean(c.baixa),
    aiTriageResolvedByAi: Boolean(c.resolvidoIa),
    aiTriageCompletedAt: motivoIa ? c.chegada : null,
    createdAt: c.chegada,
    updatedAt: c.ultima,
    contactPhoneNumber: c.telefone,
    contactDisplayName: c.nome || null,
    contactAvatarPath: c.foto ? `avatars/${semente}.jpg` : null,
    contactCityId: cidade ? cidade.id : null,
    contactCityName: cidade ? cidade.name : null,
    contactLocalityId: local ? local.id : null,
    contactLocalityName: local ? local.name : null,
    ...(c.dono ? { contactInternalNote: c.nota || null } : {}),
    assignedAgentName: c.dono ? c.dono.name : null,
    contactSgpDocument: c.cpf || null,
    sectorName: setor ? setor.name : null,
    channelName: canal.name,
    channelType: canal.type,
    aiTriageReasonName: motivoIa ? motivoIa.name : null,
    lastMessageContent: c.tipo && c.tipo !== 'text' ? (c.legenda || null) : c.texto,
    lastMessageType: c.tipo || 'text',
    lastMessageStatus: c.saida ? c.statusMsg || 'read' : 'received',
    lastMessageDirection: c.saida ? 'outbound' : 'inbound',
    lastMessageAt: c.ultima,
  };
}

export const CONVERSA_A_SEMENTE = 'maria';
export const CONVERSA_B_SEMENTE = 'antonio';

export function minhasConversas(eu = EU_ATENDENTE) {
  const lista = [
    conversa(CONVERSA_A_SEMENTE, {
      nome: 'Maria José da Conceição Silva Nascimento',
      telefone: '5598981234567',
      cidade: 'Cândido Mendes',
      local: 'Barão de Tromaí',
      setor: 'Suporte Técnico',
      ia: 'Sem conexão',
      resumo: 'Cliente sem internet desde ontem à noite; LOS vermelho no roteador. Instabilidade registrada na região.',
      cpf: '12345678909',
      foto: true,
      protocolo: '20260924-0031',
      nota: 'Prefere contato à tarde. Teve 2 visitas técnicas em agosto (troca de conector).',
      chegada: quando(-1, '18:12'),
      ultima: quando(0, '14:21'),
      texto: 'Agora voltou, mas ainda está bem lenta aqui',
      dono: eu,
    }),
    conversa('ana', {
      nome: 'Ana',
      telefone: '5598991112233',
      cidade: 'Carutapera',
      setor: 'Financeiro',
      protocolo: '20260924-0027',
      chegada: quando(0, '11:02'),
      ultima: quando(0, '14:08'),
      texto: 'Segue a segunda via com vencimento para 30/09. Qualquer dúvida é só chamar.',
      saida: true,
      statusMsg: 'read',
      dono: eu,
    }),
    conversa('joao', {
      nome: 'João Pedro Ribeiro dos Santos Filho',
      telefone: '5598984455667',
      cidade: 'Godofredo Viana',
      local: 'Aurizona',
      setor: 'Comercial',
      foto: true,
      protocolo: '20260924-0024',
      chegada: quando(0, '10:15'),
      ultima: quando(0, '13:57'),
      tipo: 'image',
      dono: eu,
    }),
    conversa('raimundo', {
      nome: 'Raimundo Nonato Ferreira',
      telefone: '5598987788990',
      cidade: 'Luís Domingues',
      setor: 'Suporte Técnico',
      ia: 'Lentidão',
      baixa: true,
      protocolo: '20260924-0019',
      chegada: quando(0, '09:40'),
      ultima: quando(0, '13:31'),
      texto: 'o sinal da fibra tá piscando vermelho de vez em quando',
      dono: eu,
    }),
    conversa('semnome', {
      nome: null,
      telefone: '5598988776655',
      cidade: 'Turiaçu',
      protocolo: '20260924-0015',
      chegada: quando(0, '09:05'),
      ultima: quando(0, '12:48'),
      tipo: 'audio',
      dono: eu,
    }),
    conversa('luana', {
      nome: 'Luana Beatriz',
      telefone: '5598981239876',
      cidade: 'Bacuri',
      setor: 'Cobrança',
      foto: true,
      protocolo: '20260924-0009',
      chegada: quando(0, '08:31'),
      ultima: quando(0, '11:20'),
      texto: 'Pagamento confirmado, obrigado pela paciência!',
      saida: true,
      statusMsg: 'delivered',
      dono: eu,
    }),
  ];
  return lista.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

export function fila() {
  const espera = [
    ['francisca', { nome: 'Francisca das Chagas Pereira Lima', telefone: '5598991234001', cidade: 'Cândido Mendes', setor: 'Financeiro', ia: 'Segunda via', foto: true, chegada: quando(0, '08:12'), ultima: quando(0, '08:14'), texto: 'Vou te transferir para o financeiro, só um instante 🙂', saida: true, statusMsg: 'delivered', canal: 'DW Financeiro' }],
    ['carlos', { nome: 'Carlos', telefone: '5598991234002', cidade: 'Carutapera', setor: 'Suporte Técnico', ia: 'Sem conexão', chegada: quando(0, '08:47'), ultima: quando(0, '08:49'), texto: 'sem internet desde ontem' }],
    [CONVERSA_B_SEMENTE, { nome: 'Antônio Carlos de Oliveira Brandão Júnior', telefone: '5598991234003', cidade: 'Cândido Mendes', local: 'Barão de Tromaí', setor: 'Comercial', foto: true, chegada: quando(0, '09:21'), ultima: quando(0, '09:24'), texto: 'Quero contratar o plano de 500 mega pra minha loja no centro', canal: 'DW Comercial' }],
    ['josefa', { nome: 'Josefa', telefone: '5598991234004', cidade: 'Godofredo Viana', setor: 'Suporte Técnico', ia: 'Lentidão', chegada: quando(0, '09:58'), ultima: quando(0, '10:01'), texto: 'tá muito lenta a internet' }],
    ['pedro', { nome: 'Pedro Henrique Sousa Costa', telefone: '5598991234005', cidade: 'Maracaçumé', setor: 'Financeiro', ia: 'Comprovante de pagamento', foto: true, chegada: quando(0, '10:33'), ultima: quando(0, '10:35'), tipo: 'image', canal: 'DW Financeiro' }],
    ['rosangela', { nome: 'Rosângela Maria Pinheiro', telefone: '5598991234006', cidade: 'Governador Nunes Freire', setor: 'Suporte Técnico', chegada: quando(0, '11:05'), ultima: quando(0, '11:06'), texto: 'Boa tarde' }],
    ['numero', { nome: null, telefone: '5598991234411', chegada: quando(0, '11:40'), ultima: quando(0, '11:40'), texto: 'Oi' }],
    ['valdemar', { nome: 'Valdemar Araújo', telefone: '5598991234008', cidade: 'Luís Domingues', setor: 'Cobrança', ia: 'Negociação de débito', chegada: quando(0, '12:02'), ultima: quando(0, '12:06'), texto: 'queria parcelar as duas faturas atrasadas', canal: 'DW Financeiro' }],
    ['thais', { nome: 'Thaís Fernandes', telefone: '5598991234009', cidade: 'Turiaçu', setor: 'Comercial', foto: true, chegada: quando(0, '12:30'), ultima: quando(0, '12:31'), texto: 'Vocês atendem na zona rural?', canal: 'DW Comercial' }],
    ['sebastiao', { nome: 'Sebastião Ribeiro da Silva', telefone: '5598991234010', cidade: 'Godofredo Viana', local: 'Aurizona', setor: 'Suporte Técnico', ia: 'Sem conexão', chegada: quando(0, '13:04'), ultima: quando(0, '13:05'), tipo: 'audio' }],
    ['kelly', { nome: 'Kelly', telefone: '5598991234011', cidade: 'Bacuri', setor: 'Financeiro', ia: 'Segunda via', resolvidoIa: true, chegada: quando(0, '13:22'), ultima: quando(0, '13:26'), tipo: 'pix', texto: '00020126580014br.gov.bcb.pix...', saida: true, statusMsg: 'read', canal: 'DW Financeiro' }],
    ['manoel', { nome: 'Manoel Messias dos Santos Moraes', telefone: '5598991234012', cidade: 'Cândido Mendes', setor: 'Suporte Técnico', ia: 'Sem conexão', foto: true, chegada: quando(0, '13:49'), ultima: quando(0, '13:50'), texto: 'a luz LOS tá acesa vermelha' }],
    ['irene', { nome: 'Irene', telefone: '5598991234013', cidade: 'Carutapera', chegada: quando(0, '14:06'), ultima: quando(0, '14:06'), texto: 'Bom dia' }],
    ['gabriel', { nome: 'Gabriel Lucas Nascimento', telefone: '5598991234014', cidade: 'Maracaçumé', setor: 'Comercial', ia: 'Mudança de plano', chegada: quando(0, '14:18'), ultima: quando(0, '14:20'), texto: 'quero mudar pro plano de 300', canal: 'DW Comercial' }],
  ];
  const automacao = [
    ['edivaldo', { nome: 'Edivaldo Costa', telefone: '5598991234015', cidade: 'Turiaçu', pendente: true, chegada: quando(0, '14:24'), ultima: quando(0, '14:25'), texto: '1' }],
    ['numero2', { nome: null, telefone: '5598982001133', pendente: true, chegada: quando(0, '14:27'), ultima: quando(0, '14:27'), texto: 'Olá, boa tarde' }],
  ];
  return [...espera, ...automacao].map(([s, c]) => {
    const conv = conversa(s, c);
    if (c.tipo === 'pix') conv.lastMessageContent = c.texto;
    return conv;
  });
}

// ---------- Mensagens ----------
function msg(convId, n, dia, hhmm, dir, texto, extra = {}) {
  return {
    id: uuid(`msg-${convId}-${n}`),
    conversationId: convId,
    direction: dir,
    content: texto,
    messageType: 'text',
    mediaPath: null,
    mediaMimeType: null,
    mediaFilename: null,
    locationLatitude: null,
    locationLongitude: null,
    whatsappMessageId: `wamid.${n}`,
    status: dir === 'outbound' ? 'read' : 'received',
    repliedToMessageId: null,
    sentBy: null,
    transcription: null,
    transcriptionStatus: null,
    transcriptionDetail: null,
    transcriptionModel: null,
    transcriptionMs: null,
    audioDurationSeconds: null,
    metadata: null,
    createdAt: quando(dia, hhmm),
    repliedToPreview: null,
    ...extra,
  };
}

// 50 mensagens: triagem pela IA ontem, abertura/transferencia e atendimento hoje,
// uma foto do cliente sem legenda (badge de hora sobre a imagem).
export function mensagensDaConversaA(convId) {
  const C = 'inbound';
  const O = 'outbound';
  const IA = { sentBy: 'ai' };
  const roteiro = [
    [-1, '18:12', C, 'Boa noite, minha internet caiu de novo'],
    [-1, '18:12', O, 'Olá! Sou o assistente virtual da DW Telecom. Para localizar o seu cadastro, pode me informar o CPF do titular?', IA],
    [-1, '18:13', C, '123.456.789-09'],
    [-1, '18:13', O, 'Obrigado, Maria José! Encontrei o seu contrato FIBRA 300 MEGA em Barão de Tromaí.', IA],
    [-1, '18:14', O, 'Existe uma instabilidade registrada na sua região desde as 17h. A equipe técnica já está trabalhando no reparo.', IA],
    [-1, '18:15', C, 'e tem previsão de voltar?'],
    [-1, '18:15', O, 'Ainda não temos previsão confirmada. Assim que normalizar, você recebe um aviso por aqui.', IA],
    [-1, '18:16', C, 'tá bom, vou aguardar então'],
    [-1, '18:16', O, 'Combinado! Se amanhã cedo continuar sem conexão, vou encaminhar você para um atendente do suporte.', IA],
    [-1, '22:47', C, 'continua sem nada aqui'],
    [-1, '22:47', O, 'Entendi. Registrei a sua reclamação e vou transferir para o suporte técnico assim que o expediente começar.', IA],
    [0, '08:02', C, 'bom dia, ainda sem internet'],
    [0, '08:05', O, 'Olá, Maria José! Meu nome é Carla e vou continuar o seu atendimento. Seu protocolo é 20260924-0031.'],
    [0, '08:05', O, 'Vi aqui o histórico com o nosso assistente. Vou verificar o seu equipamento agora.'],
    [0, '08:07', C, 'obrigada Carla'],
    [0, '08:09', O, 'Maria José, pode me dizer quais luzes estão acesas no roteador?'],
    [0, '08:12', C, 'tem uma vermelha piscando'],
    [0, '08:16', O, 'Essa luz vermelha (LOS) indica que o sinal da fibra não está chegando ao equipamento.'],
    [0, '08:16', O, 'Pode confirmar se o cabo amarelo está bem encaixado atrás do aparelho, sem dobras?'],
    [0, '08:21', C, 'tá encaixado sim, não mexi em nada'],
    [0, '08:22', O, 'Certo. Vou abrir uma verificação na caixa de atendimento da sua rua.'],
    [0, '08:23', C, 'ok'],
    [0, '08:40', O, 'A equipe confirmou o rompimento de um cabo na rua principal de Barão de Tromaí.'],
    [0, '08:41', O, 'O reparo está previsto para o final da manhã.'],
    [0, '08:44', C, 'nossa, de novo esse cabo'],
    [0, '08:45', C, 'semana passada foi a mesma coisa'],
    [0, '08:47', O, 'Entendo a sua chateação, e peço desculpas pelo transtorno. Vou registrar a recorrência para a equipe de rede.'],
    [0, '08:48', O, 'Também vou solicitar o desconto proporcional dos dias sem serviço na sua próxima fatura.'],
    [0, '08:52', C, 'tá bom, obrigada'],
    [0, '09:30', C, 'alguma novidade?'],
    [0, '09:33', O, 'Ainda não, Maria José. A equipe está no local. Assim que concluírem eu te aviso.'],
    [0, '10:58', C, 'e aí?'],
    [0, '11:02', O, 'Acabaram de concluir a emenda do cabo. Pode desligar o roteador da tomada por 30 segundos e ligar de novo?'],
    [0, '11:05', C, 'vou fazer'],
    [0, '11:09', C, 'desliguei e liguei'],
    [0, '11:10', O, 'Ótimo! A luz vermelha apagou?'],
    [0, '11:12', C, 'apagou sim, agora tá verde'],
    [0, '11:12', O, 'Perfeito! Consegue testar a navegação no celular, conectado no Wi‑Fi?'],
    [0, '11:20', C, 'tá abrindo mas bem devagar'],
    [0, '11:22', O, 'Pode acontecer nos primeiros minutos, enquanto o equipamento sincroniza. Vou acompanhar por aqui.'],
    [0, '12:40', O, 'Maria José, como está a conexão agora?'],
    [0, '13:05', C, 'melhorou um pouco'],
    [0, '13:06', O, 'Vou rodar um teste de velocidade remoto no seu equipamento, só um momento.'],
    [0, '13:12', O, 'O teste remoto mostrou 280 Mbps de download, dentro do contratado. A lentidão pode ser o Wi‑Fi do cômodo onde você está.', IA],
    [0, '13:15', C, 'estou no quarto dos fundos'],
    [0, '13:16', C, 'olha como estão as luzes agora'],
    [0, '13:16', C, null, { messageType: 'image', mediaPath: 'media/2026/09/roteador.jpg', mediaMimeType: 'image/jpeg', mediaFilename: 'IMG-20260924-WA0012.jpg' }],
    [0, '13:18', O, 'Obrigada pela foto! As luzes estão normais, o sinal da fibra voltou. Se puder, teste perto do roteador para compararmos.', IA],
    [0, '14:18', O, 'Conseguiu testar perto do roteador?', { status: 'delivered' }],
    [0, '14:21', C, 'Agora voltou, mas ainda está bem lenta aqui'],
  ];
  return roteiro.map(([dia, hhmm, dir, texto, extra], i) => msg(convId, i + 1, dia, hhmm, dir, texto, extra || {}));
}

export function mensagensDaConversaB(convId) {
  const roteiro = [
    [0, '09:21', 'inbound', 'Boa tarde'],
    [0, '09:21', 'inbound', 'Quero saber os planos de vocês pra empresa'],
    [0, '09:22', 'outbound', 'Olá! Sou o assistente virtual da DW Telecom. Você deseja contratar um plano novo ou falar sobre um contrato existente?', { sentBy: 'ai' }],
    [0, '09:23', 'inbound', 'contratar novo'],
    [0, '09:23', 'outbound', 'Perfeito! Vou encaminhar você para o nosso time comercial, só um instante.', { sentBy: 'ai' }],
    [0, '09:24', 'inbound', 'Quero contratar o plano de 500 mega pra minha loja no centro'],
  ];
  return roteiro.map(([dia, hhmm, dir, texto, extra], i) => msg(convId, i + 1, dia, hhmm, dir, texto, extra || {}));
}

export function mensagensGenericas(conv) {
  const t = conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(AGORA_FIXO);
  const hhmm = (d) => `${String(d.getUTCHours() - 3).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const menos = (min) => new Date(t.getTime() - min * 60000);
  const lista = [
    msg(conv.id, 1, 0, hhmm(menos(9)), 'inbound', 'Olá'),
    msg(conv.id, 2, 0, hhmm(menos(8)), 'outbound', 'Olá! Sou o assistente virtual da DW Telecom. Como posso ajudar?', { sentBy: 'ai' }),
    msg(conv.id, 3, 0, hhmm(menos(6)), 'inbound', 'Preciso de ajuda com a minha internet'),
    msg(conv.id, 4, 0, hhmm(menos(5)), 'outbound', 'Certo! Vou encaminhar você para um atendente.', { sentBy: 'ai' }),
    msg(conv.id, 5, 0, hhmm(t), 'inbound', conv.lastMessageContent || 'Ok'),
  ];
  return lista;
}

export const SGP_CLIENTE = {
  client: { name: 'MARIA JOSE DA CONCEICAO SILVA NASCIMENTO', document: '123.456.789-09' },
  contracts: [
    { id: 10482, plan: 'FIBRA 300 MEGA', status: 'Ativo', phones: ['(98) 98123-4567'], emails: ['mariajose.nascimento@gmail.com'] },
    { id: 11893, plan: 'FIBRA 100 MEGA', status: 'Suspenso', phones: ['(98) 98123-4567'], emails: [] },
  ],
};

export const RESPOSTAS_RAPIDAS = [
  ['Saudação', 'Olá! Tudo bem? Meu nome é {atendente} e vou continuar o seu atendimento.'],
  ['Reiniciar roteador', 'Pode desligar o roteador da tomada por 30 segundos e ligar de novo?'],
  ['Segunda via', 'Segue a segunda via da sua fatura. Qualquer dúvida é só chamar.'],
  ['Luz LOS', 'A luz vermelha (LOS) indica que o sinal da fibra não está chegando ao equipamento.'],
  ['Encerramento', 'Posso ajudar em algo mais? Se não, vou encerrar o atendimento. Obrigado pelo contato!'],
  ['Visita técnica', 'Vou agendar uma visita técnica. Qual o melhor período: manhã ou tarde?'],
].map(([title, content], i) => ({ id: uuid('qr-' + i), title, content, active: true }));

// ---------- Area administrativa (opcional: Supervisao, Relatorios, Canais) ----------
const outro = (nome) => listaDeAtendentes().find((a) => a.name === nome);
export function supervisao() {
  const deOutros = [
    ['bruna', 'Juliana Castro', { nome: 'Bruna Carvalho', telefone: '5598990001001', cidade: 'Pinheiro' in CIDADE ? 'Pinheiro' : 'Bacuri', setor: 'Financeiro', protocolo: '20260924-0028', chegada: quando(0, '10:40'), ultima: quando(0, '14:12'), texto: 'pode mandar o código do pix?' }],
    ['wesley', 'Juliana Castro', { nome: 'Wesley Monteiro', telefone: '5598990001002', cidade: 'Carutapera', setor: 'Suporte Técnico', ia: 'Sem conexão', protocolo: '20260924-0022', chegada: quando(0, '09:55'), ultima: quando(0, '13:40'), texto: 'Vou verificar com a equipe de campo.', saida: true, statusMsg: 'read' }],
    ['socorro', 'Patrícia Lopes', { nome: 'Maria do Socorro Almeida Costa', telefone: '5598990001003', cidade: 'Cândido Mendes', local: 'Barão de Tromaí', setor: 'Suporte Técnico', protocolo: '20260924-0017', foto: true, chegada: quando(0, '09:12'), ultima: quando(0, '14:02'), texto: 'ainda está caindo toda hora' }],
    ['renato', 'Patrícia Lopes', { nome: 'Renato', telefone: '5598990001004', cidade: 'Turiaçu', setor: 'Comercial', protocolo: '20260924-0012', chegada: quando(0, '08:50'), ultima: quando(0, '12:15'), texto: 'Fechado! Pode agendar a instalação.' }],
    ['cleide', 'Beatriz Nogueira', { nome: 'Cleide Santos', telefone: '5598990001005', cidade: 'Maracaçumé', setor: 'Cobrança', ia: 'Negociação de débito', baixa: false, protocolo: '20260924-0020', chegada: quando(0, '09:30'), ultima: quando(0, '13:58'), tipo: 'document', saida: true, statusMsg: 'delivered' }],
  ].map(([s, dono, c]) => conversa(s, { ...c, dono: outro(dono) }));
  const f = fila();
  return {
    inProgress: [...minhasConversas(EU_ATENDENTE), ...deOutros],
    waiting: f.filter((c) => c.triageState !== 'pending'),
    inAutomation: f.filter((c) => c.triageState === 'pending'),
    closedTodayCount: 23,
  };
}

export function encerradasHoje() {
  const base = [
    ['enc1', 'Carla Menezes', { nome: 'Joana Batista', telefone: '5598990002001', cidade: 'Bacuri', setor: 'Financeiro', protocolo: '20260924-0004', chegada: quando(0, '08:05'), ultima: quando(0, '09:10'), texto: 'Obrigada!' }],
    ['enc2', 'Juliana Castro', { nome: 'Francisco Nunes', telefone: '5598990002002', cidade: 'Carutapera', setor: 'Suporte Técnico', protocolo: '20260924-0006', chegada: quando(0, '08:20'), ultima: quando(0, '10:02'), texto: 'Voltou aqui, valeu' }],
    ['enc3', 'Patrícia Lopes', { nome: 'Lúcia Helena', telefone: '5598990002003', cidade: 'Turiaçu', setor: 'Comercial', protocolo: '20260924-0010', chegada: quando(0, '09:00'), ultima: quando(0, '10:45'), texto: 'Ok, aguardo o técnico.' }],
  ];
  return base.map(([s, dono, c]) => ({
    ...conversa(s, { ...c, dono: outro(dono) }),
    status: 'closed',
    closedByAgentName: dono,
    closeReasonName: c.setor === 'Financeiro' ? 'Segunda via' : c.setor === 'Comercial' ? 'Instalação' : 'Sem conexão',
    closedAt: c.ultima,
  }));
}

export function metricasAdmin(period) {
  const agentes = listaDeAtendentes().filter((a) => a.role !== 'manager');
  return {
    period,
    scope: 'admin',
    byAgent: agentes.slice(0, 6).map((a, i) => ({ agentId: a.id, agentName: a.name, closedCount: [14, 3, 11, 0, 9, 7][i], avgResolutionMinutes: [42.5, 18, 55.2, null, 37.9, 61.3][i], avgFirstResponseMinutes: [3.2, 1.5, 6.8, null, 4.1, 9.7][i] })).filter((r) => r.closedCount > 0),
    bySector: [
      { sectorId: SETORES[0].id, sectorName: SETORES[0].name, closedCount: 19 },
      { sectorId: SETORES[1].id, sectorName: SETORES[1].name, closedCount: 12 },
      { sectorId: SETORES[2].id, sectorName: SETORES[2].name, closedCount: 8 },
      { sectorId: SETORES[3].id, sectorName: SETORES[3].name, closedCount: 3 },
      { sectorId: null, sectorName: null, closedCount: 2 },
    ],
    byReason: [
      ['Sem conexão', 15],
      ['Segunda via', 11],
      ['Lentidão', 6],
      ['Instalação', 5],
      ['Mudança de plano', 3],
      [null, 4],
    ].map(([n, c]) => ({ reasonId: n ? MOTIVO[n].id : null, reasonName: n || 'Sem motivo', closedCount: c })),
  };
}
