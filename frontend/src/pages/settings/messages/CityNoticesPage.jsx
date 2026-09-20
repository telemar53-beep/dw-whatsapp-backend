import { Link } from 'react-router-dom';
import { Card, AsyncState } from '../../../components/ui';
import { useCityNotices } from '../../../hooks/useCityNotices';
import CityNoticeRow from '../../../components/messages/CityNoticeRow';

function CityNoticesPage() {
  const { cityNotices, status, refresh } = useCityNotices();
  return (
    <div className="settings-message-library">
      <div className="border-b border-wa-border pb-4 text-[13.5px] leading-5 text-wa-muted">
        <p>Envie um aviso aos clientes de uma cidade quando entrarem em contato, além das boas-vindas.</p>
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-chat-orange">Ver exemplo</summary>
          <p className="mt-2 italic">“Nossa rede está passando por uma instabilidade na sua região. Nossa equipe já está trabalhando na correção.”</p>
        </details>
      </div>
      <Card title="Por cidade">
        <AsyncState
          status={status}
          onRetry={refresh}
          isEmpty={cityNotices.length === 0}
          emptyMessage={
            <>
              Nenhuma cidade cadastrada ainda. Cadastre cidades em{' '}
              <Link to="/configuracoes/cadastros/cidades" className="font-medium text-wa-link hover:text-wa-link/80 hover:underline">
                Cidades
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
    </div>
  );
}

export default CityNoticesPage;
