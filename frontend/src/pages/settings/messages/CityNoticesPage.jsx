import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card, AsyncState } from '../../../components/ui';
import { useCityNotices } from '../../../hooks/useCityNotices';
import CityNoticeRow from '../../../components/messages/CityNoticeRow';

function CityNoticesPage() {
  const { cityNotices, loading, status: hookStatus, refresh } = useCityNotices();
  const status = hookStatus || (loading ? 'loading' : 'ready');
  return (
    <SettingsPage title="Avisos por cidade" description="Avisos de instabilidade ou manutenção por região." scope="global">
      <Card title="Por cidade">
        <AsyncState
          status={status}
          onRetry={refresh}
          isEmpty={cityNotices.length === 0}
          emptyMessage={
            <>
              Nenhuma cidade cadastrada ainda. Cadastre cidades em{' '}
              <Link to="/configuracoes/cadastros/cidades" className="font-medium text-wa-link hover:text-wa-link/80 hover:underline">
                Cadastros › Cidades
              </Link>
              .
            </>
          }
        >
          <ul className="divide-y divide-wa-border overflow-hidden rounded-[16px] border border-wa-border bg-wa-surface">
            {cityNotices.map((city) => (
              <CityNoticeRow key={city.id} city={city} onSaved={refresh} />
            ))}
          </ul>
        </AsyncState>
      </Card>
    </SettingsPage>
  );
}

export default CityNoticesPage;
