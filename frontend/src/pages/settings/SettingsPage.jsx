import SettingsShell from './SettingsShell';

// Continua existindo para não obrigar a migração das oito páginas que já a
// chamavam; por dentro é a casca única. `wide` vira o modo de largura.
function SettingsPage({ title, description, action, scope, scopeDetail, level = 'admin', wide = false, children }) {
  return (
    <SettingsShell
      level={level}
      areaLabel={title}
      title={title}
      description={description}
      action={action}
      scope={scope}
      scopeDetail={scopeDetail}
      width={wide ? 'wide' : 'form'}
    >
      {children}
    </SettingsShell>
  );
}

export default SettingsPage;
