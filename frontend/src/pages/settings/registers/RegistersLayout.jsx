import { Outlet } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { PageHeader, Tabs } from '../../../components/ui';
import { SETTINGS_BASE } from '../../../navigation/navItems';

const BASE = `${SETTINGS_BASE}/cadastros`;

// Motivos e Cidades são abas de uma página só: o cabeçalho e o traço laranja
// ficam aqui, cada aba só entrega o seu cartão pelo <Outlet />.
const TABS = [
  { key: 'motivos', label: 'Motivos de atendimento', to: `${BASE}/motivos` },
  { key: 'cidades', label: 'Cidades', to: `${BASE}/cidades` },
];

function RegistersLayout() {
  return (
    <ProtectedRoute level="admin" areaLabel="Cadastros auxiliares">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: SETTINGS_BASE }]}
            title="Cadastros auxiliares"
            description="Listas usadas no atendimento e nos relatórios."
          />
          <Tabs look="underline" label="Cadastros auxiliares" tabs={TABS} />
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

export default RegistersLayout;
