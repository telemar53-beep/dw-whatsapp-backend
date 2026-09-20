import { SettingsTitle, SettingsIcon } from '../SettingsVisuals';
import { Outlet, useLocation } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { PageHeader } from '../../../components/ui';
import { findSettingsItem, SETTINGS_BASE } from '../../../navigation/navItems';

function RegistersLayout() {
  const location = useLocation();
  const selected = findSettingsItem(location.pathname)?.item;
  return (
    <ProtectedRoute level="admin" areaLabel="Cadastros auxiliares">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="settings-group-header border-b border-white/[0.07] px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: SETTINGS_BASE }, { label: 'Cadastros auxiliares' }]}
            title={<SettingsTitle name={selected?.key}>{selected?.label || 'Cadastros auxiliares'}</SettingsTitle>}
            description={selected?.description || 'Listas usadas no atendimento e nos relatórios.'}
          />
        </div>
        <div className="settings-group-body chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-4 sm:px-6">
          <div className="settings-section-list max-w-5xl">
            <Outlet />
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default RegistersLayout;
