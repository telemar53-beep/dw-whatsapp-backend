import { SettingsTitle } from './SettingsVisuals';
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
      <div className="settings-detail flex min-h-0 flex-1 flex-col">
        <div className="settings-detail-header border-b border-white/[0.06] px-4">
          <PageHeader
            crumbs={crumbs}
            title={<SettingsTitle name={found?.item.key}>{title}</SettingsTitle>}
            description={description}
            action={
              <div className="flex items-center gap-3">
                {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
                {action}
              </div>
            }
          />
        </div>
        <div className="settings-detail-body chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-4 sm:px-6">
          {/* A composição de cada página controla a largura dos seus campos. */}
          <div className={`${wide ? 'max-w-5xl' : 'max-w-[760px]'} settings-section-list`}>{children}</div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default SettingsPage;
