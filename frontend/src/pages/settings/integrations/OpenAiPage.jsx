import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card } from '../../../components/ui';
import OpenAiConfigCard from '../../../components/OpenAiConfigCard';

const USERS = [
  { label: 'Atendimento e triagem com IA', to: '/configuracoes/automacao/ia' },
  { label: 'Transcrição de áudio', to: '/configuracoes/automacao/transcricao' },
  { label: 'Atendimento noturno', to: '/configuracoes/automacao/noturno' },
];

function OpenAiPage() {
  return (
    <SettingsPage
      title="OpenAI"
      description="Credencial, modelo e teste de conexão da IA. Só quem tem permissão de credenciais mexe aqui."
      scope="global"
      level="integrations"
    >
      <OpenAiConfigCard />
      <Card title="Usa esta conexão" description="Estas automações só funcionam com a OpenAI conectada.">
        <ul className="space-y-1 text-[14px]">
          {USERS.map((u) => (
            <li key={u.to}>
              <Link to={u.to} className="text-wa-link hover:underline">{u.label}</Link>
            </li>
          ))}
        </ul>
      </Card>
    </SettingsPage>
  );
}

export default OpenAiPage;
