import { Outlet } from 'react-router-dom';
import { Tabs } from '../../../components/ui';
import { IconServer, IconLock } from '../../../components/icons/WaIcons';

const BASE = '/configuracoes/integracoes/sgp';

// Cartão do SGP: cabeçalho, as duas abas (consultas e envios) e o conteúdo da
// aba pelo <Outlet />.
function SgpIntegrationLayout() {
  return (
    <section
      aria-labelledby="sgp-integration-title"
      className="overflow-clip rounded-[16px] border border-wa-surface-line bg-wa-surface backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-1 pt-5 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-wa-border bg-white/[0.05] text-wa-text">
            <IconServer size={24} />
          </span>
          <div className="min-w-0">
            <h2 id="sgp-integration-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
              SGP
            </h2>
            <p className="mt-0.5 text-[13px] text-wa-muted">Gerencie consultas e envios em um único lugar.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-wa-border bg-white/[0.05] px-3 py-1.5 text-[12.5px] text-wa-muted">
          <IconLock size={13} />
          Acesso a credenciais restrito
        </span>
      </div>
      <div className="px-2 sm:px-3">
        <Tabs
          look="underline"
          label="Seções do SGP"
          tabs={[
            { key: 'consultas', label: 'Consultas ao SGP', to: `${BASE}/consultas` },
            { key: 'envios', label: 'Envios por canal', to: `${BASE}/envios` },
          ]}
        />
      </div>
      <div className="px-4 pb-5 pt-5 sm:px-5">
        <Outlet />
      </div>
    </section>
  );
}

export default SgpIntegrationLayout;
