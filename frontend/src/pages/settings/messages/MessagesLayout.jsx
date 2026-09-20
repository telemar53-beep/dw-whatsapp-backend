import { Outlet, useLocation } from 'react-router-dom';
import SettingsShell from '../SettingsShell';
import { findSettingsItem } from '../../../navigation/navItems';

// Boas-vindas e Abertura/encerramento são textos que o cliente recebe durante
// o atendimento; os demais são biblioteca de mensagens. A trilha diz de qual
// dos dois se trata.
const DE_ATENDIMENTO = new Set(['boas-vindas', 'abertura-encerramento']);

function MessagesLayout() {
  const location = useLocation();
  const selected = findSettingsItem(location.pathname)?.item;
  return (
    <SettingsShell
      areaLabel="Mensagens e templates"
      crumb={DE_ATENDIMENTO.has(selected?.key) ? 'Atendimento' : 'Mensagens'}
      description={selected?.description || 'Organize os textos usados pela equipe e pelas automações.'}
      width="wide"
    >
      <Outlet />
    </SettingsShell>
  );
}

export default MessagesLayout;
