import { Outlet } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { PageHeader, Tabs } from '../../../components/ui';
import { SETTINGS_BASE } from '../../../navigation/navItems';

const BASE = `${SETTINGS_BASE}/equipe`;

// Usuários, Setores e Perfis são abas de uma página só: o cabeçalho e o traço
// laranja ficam aqui, cada aba só entrega o seu cartão pelo <Outlet />.
const TABS = [
  { key: 'usuarios', label: 'Usuários', to: `${BASE}/usuarios` },
  { key: 'setores', label: 'Setores', to: `${BASE}/setores` },
  { key: 'perfis', label: 'Perfis e permissões', to: `${BASE}/perfis` },
];

function TeamLayout() {
  return (
    <ProtectedRoute level="admin" areaLabel="Equipe e acesso">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: SETTINGS_BASE }]}
            title="Equipe e acesso"
            description="Organize as pessoas, os setores e as permissões da equipe."
          />
          <Tabs look="underline" label="Equipe e acesso" tabs={TABS} />
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

export default TeamLayout;
