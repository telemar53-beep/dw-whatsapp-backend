import { Outlet, useLocation } from 'react-router-dom';
import SettingsShell from '../SettingsShell';
import { findSettingsItem } from '../../../navigation/navItems';

// Todas as páginas daqui são do grupo Mensagens do diretório (S1): a trilha é
// a do grupo, que a casca já tira de navItems.
function MessagesLayout() {
  const location = useLocation();
  const selected = findSettingsItem(location.pathname)?.item;
  return (
    <SettingsShell
      areaLabel="Mensagens e templates"
      description={selected?.description || 'Organize os textos usados pela equipe e pelas automações.'}
      width="wide"
    >
      <Outlet />
    </SettingsShell>
  );
}

export default MessagesLayout;
