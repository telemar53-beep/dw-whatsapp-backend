import { Outlet, useLocation } from 'react-router-dom';
import SettingsShell from '../SettingsShell';
import { findSettingsItem } from '../../../navigation/navItems';

function TeamLayout() {
  const location = useLocation();
  const selected = findSettingsItem(location.pathname)?.item;
  return (
    <SettingsShell
      areaLabel="Equipe e permissões"
      crumb="Equipe e permissões"
      description={selected?.description || 'Organize as pessoas, os setores e as permissões da equipe.'}
      width="wide"
    >
      <Outlet />
    </SettingsShell>
  );
}

export default TeamLayout;
