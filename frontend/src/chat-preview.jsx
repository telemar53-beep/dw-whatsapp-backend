import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppShell from './components/AppShell';
import DashboardPage from './pages/DashboardPage';
import './index.css';

// Prévia isolada por origem (porta 5174). Nenhum pedido chega ao backend.
const names = [
  'Ana Beatriz Figueiredo', 'Carlos Eduardo Lima', 'Mariana Santos',
  'João Pedro Alves', 'Patrícia Gomes', 'Roberto Nascimento',
  'Fernanda Costa', 'Rafael Martins', 'Juliana Ribeiro', 'Ricardo Souza',
  'Tatiane Oliveira', 'Larissa Almeida', 'Bruno Ferreira', 'Camila Rocha',
  'Pedro Henrique',
];
const previews = [
  'Consegue me enviar a segunda via?', 'O sinal voltou, muito obrigado!',
  'Ainda não recebi o retorno.', 'Tem previsão para hoje?',
  'Obrigada pelo atendimento!', 'O boleto já foi compensado?',
  'Quero alterar meu plano.', 'Está muito instável aqui.',
  'Consegue verificar pra mim?', 'Show, era isso mesmo. Valeu!',
  'Vocês atendem em outra cidade?', 'Preciso de ajuda com o acesso.',
  'Pode me passar o protocolo?', 'Recebi o comprovante.',
  'Gostaria de falar com o suporte.',
];
const now = Date.now();
const conversations = names.map((name, index) => ({
  id: `demo-${index + 1}`,
  contactId: `contact-${index + 1}`,
  contactDisplayName: name,
  contactPhoneNumber: `+55 11 98765-${String(4321 + index).padStart(4, '0')}`,
  contactCityName: index % 3 === 0 ? 'São Paulo' : index % 3 === 1 ? 'Campinas' : 'Santos',
  sectorName: index % 3 === 0 ? 'Financeiro' : index % 3 === 1 ? 'Suporte Técnico' : 'Comercial',
  assignedAgentId: 'preview-agent',
  assignedAgentName: 'Lucas Silva',
  status: 'assigned',
  channelName: 'DW Telecom',
  channelType: 'meta_cloud',
  protocolNumber: index === 0 ? '20260919-001' : undefined,
  lastMessageContent: previews[index],
  lastMessageDirection: index % 4 === 1 ? 'outbound' : 'inbound',
  lastMessageStatus: 'read',
  lastMessageAt: new Date(now - index * 13 * 60000).toISOString(),
  createdAt: new Date(now - (index + 1) * 45 * 60000).toISOString(),
  ...(index === 0 ? { contactInternalNote: 'Cliente prefere receber a fatura por mensagem.' } : {}),
}));
const queue = [
  { ...conversations[11], id: 'queue-1', assignedAgentId: null, assignedAgentName: null, status: 'waiting' },
  { ...conversations[12], id: 'queue-2', assignedAgentId: null, assignedAgentName: null, status: 'waiting' },
  { ...conversations[13], id: 'queue-3', assignedAgentId: null, assignedAgentName: null, status: 'waiting', triageState: 'pending' },
];
const demoMessages = [
  { id: 'm1', direction: 'inbound', content: 'Olá, boa tarde!\nPreciso da segunda via da minha fatura, por favor.', messageType: 'text', createdAt: new Date(now - 22 * 60000).toISOString() },
  { id: 'm2', direction: 'outbound', content: 'Olá, Ana! Boa tarde!\nClaro, vou verificar aqui para você. 😊', messageType: 'text', sentBy: 'human', status: 'read', createdAt: new Date(now - 21 * 60000).toISOString() },
  { id: 'm3', direction: 'inbound', content: 'Perfeito, obrigada!', messageType: 'text', createdAt: new Date(now - 20 * 60000).toISOString() },
  { id: 'm4', direction: 'outbound', content: 'Sua solicitação foi direcionada ao Financeiro.', messageType: 'text', sentBy: 'ai', status: 'read', createdAt: new Date(now - 18 * 60000).toISOString() },
  { id: 'm5', direction: 'inbound', content: 'Consegue me enviar a segunda via?\nPreciso pagar ainda hoje.', messageType: 'text', createdAt: new Date(now - 15 * 60000).toISOString() },
  { id: 'm6', direction: 'outbound', content: 'Sim, já estou gerando aqui. Em instantes te envio.', messageType: 'text', sentBy: 'human', status: 'read', createdAt: new Date(now - 14 * 60000).toISOString() },
  { id: 'm7', direction: 'inbound', content: 'Recebi aqui, muito obrigada!', messageType: 'text', createdAt: new Date(now - 4 * 60000).toISOString() },
  { id: 'm8', direction: 'inbound', content: 'Só mais uma dúvida: o vencimento continua sendo dia 10?', messageType: 'text', createdAt: new Date(now - 2 * 60000).toISOString() },
  { id: 'm9', direction: 'outbound', content: 'Isso mesmo, o vencimento é todo dia 10. Qualquer outra dúvida, estou à disposição!', messageType: 'text', sentBy: 'human', status: 'read', createdAt: new Date(now - 60000).toISOString() },
];

localStorage.setItem('dw_token', 'preview-only');
localStorage.setItem('dw_agent', JSON.stringify({ id: 'preview-agent', name: 'Lucas Silva', role: 'agent' }));

window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  if (url.hostname !== 'localhost' || url.port !== '3000') throw new Error('Prévia local: acesso externo bloqueado');
  const path = url.pathname;
  const method = init.method || 'GET';
  let payload = [];
  let status = 200;
  if (method !== 'GET') {
    payload = { error: 'A prévia é somente para avaliar o visual.' };
    status = 403;
  } else if (path === '/api/public/company') payload = { name: 'DW Telecom' };
  else if (path === '/api/conversations/mine') payload = conversations;
  else if (path === '/api/conversations/queue') payload = queue;
  else if (/^\/api\/conversations\/[^/]+\/messages$/.test(path)) payload = path.includes('demo-1/') ? demoMessages : [demoMessages[0], demoMessages[2]];
  else if (path.endsWith('/ai-suggestion')) payload = { suggestion: null };
  else if (path === '/api/agents') payload = [
    { id: 'preview-agent', name: 'Lucas Silva', online: true, activeConversations: 15 },
    { id: 'agent-2', name: 'Mariana Costa', online: true, activeConversations: 3 },
    { id: 'agent-3', name: 'Rafael Souza', online: true, activeConversations: 8 },
    { id: 'agent-4', name: 'Patrícia Lima', online: false, activeConversations: 12 },
  ];
  else if (path === '/api/admin/channels') payload = [{ id: 'channel-1', type: 'meta_cloud', name: 'DW Telecom', status: 'connected' }];
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
};

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[{ pathname: '/', state: { pendingConversation: conversations[0] } }]}>
    <AuthProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  </MemoryRouter>,
);
