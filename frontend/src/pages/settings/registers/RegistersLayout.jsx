import { Outlet, useLocation } from 'react-router-dom';
import SettingsShell from '../SettingsShell';
import { findSettingsItem } from '../../../navigation/navItems';

function RegistersLayout() {
  const location = useLocation();
  const selected = findSettingsItem(location.pathname)?.item;
  return (
    <SettingsShell
      areaLabel="Cadastros auxiliares"
      crumb="Cadastros auxiliares"
      description={selected?.description || 'Listas usadas no atendimento e nos relatórios.'}
      width="wide"
    >
      <Outlet />
    </SettingsShell>
  );
}

export default RegistersLayout;
