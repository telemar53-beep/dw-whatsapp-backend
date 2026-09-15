import { useLocation } from 'react-router-dom';
import ProtectedRoute from '../../components/ProtectedRoute';
import { PageHeader, ScopeBadge } from '../../components/ui';
import { findSettingsItem, SETTINGS_BASE } from '../../navigation/navItems';

function SettingsPage({ title, description, action, scope, scopeDetail, level = 'admin', wide = false, children }) {
  const location = useLocation();
  const found = findSettingsItem(location.pathname);
  const crumbs = [{ label: 'Configurações', to: SETTINGS_BASE }];
  if (found) crumbs.push({ label: found.group.group });
  return (
    <ProtectedRoute level={level} areaLabel={title}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-white/[0.06] px-4">
          <PageHeader
            crumbs={crumbs}
            title={title}
            description={description}
            action={
              <div className="flex items-center gap-3">
                {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
                {action}
              </div>
            }
          />
        </div>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-6">
          {/* Formulário fica em 720px: a linha de leitura não passa de ~80 caracteres. */}
          <div className={`${wide ? 'max-w-5xl' : 'max-w-[720px]'} space-y-5`}>{children}</div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default SettingsPage;
