import { Outlet } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { PageHeader, Tabs } from '../../../components/ui';
import { SETTINGS_BASE } from '../../../navigation/navItems';

const BASE = `${SETTINGS_BASE}/mensagens`;

// As cinco telas de mensagens são abas de uma página só: o cabeçalho e o traço
// laranja ficam aqui, cada aba só entrega os seus cartões pelo <Outlet />.
const TABS = [
  { key: 'boas-vindas', label: 'Boas-vindas', to: `${BASE}/boas-vindas` },
  { key: 'abertura-encerramento', label: 'Abertura e encerramento', to: `${BASE}/abertura-encerramento` },
  { key: 'avisos-cidade', label: 'Avisos por cidade', to: `${BASE}/avisos-cidade` },
  { key: 'respostas-rapidas', label: 'Respostas rápidas', to: `${BASE}/respostas-rapidas` },
  { key: 'templates', label: 'Templates WhatsApp', to: `${BASE}/templates` },
];

function MessagesLayout() {
  return (
    <ProtectedRoute level="admin" areaLabel="Mensagens e templates">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: SETTINGS_BASE }]}
            title="Mensagens e templates"
            description="Organize os textos usados pela equipe e pelas automações."
          />
          <Tabs look="underline" label="Mensagens e templates" tabs={TABS} />
        </div>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-6">
          <div className="max-w-5xl space-y-5">
            <Outlet />
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default MessagesLayout;
