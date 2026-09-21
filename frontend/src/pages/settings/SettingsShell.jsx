import { useLocation } from 'react-router-dom';
import ProtectedRoute from '../../components/ProtectedRoute';
import { PageHeader, ScopeBadge } from '../../components/ui';
import { findSettingsItem, SETTINGS_BASE } from '../../navigation/navItems';
import { SettingsTitle } from './SettingsVisuals';

// Casca única de Configurações.
//
// Existiam cinco: SettingsPage para as páginas de detalhe e um Layout próprio
// para Equipe, Mensagens, Cadastros e Integrações — os três primeiros idênticos
// linha por linha, diferindo só no rótulo da trilha. Era por causa desse par
// (`settings-detail-*` e `settings-group-*`) que a folha de estilo precisava de
// um `:is(...)` em toda regra de cabeçalho e de corpo.
//
// A casca padroniza a moldura: trilha, título, descrição, escopo, largura, área
// rolável e espaçamento. O conteúdo de cada página continua sendo o que a
// função dela pede — consistência aqui é a moldura, não a composição.

// Largura pela natureza do conteúdo, e não pelo que sobra na tela. Antes os
// `max-w-*` do JSX eram anulados por `max-width:none` na folha, e todas as
// páginas usavam a largura inteira: num monitor de 1920 um formulário de dois
// campos esticava por 1340px.
const LARGURAS = {
  form: 'max-w-[760px]',   // formulário de leitura contínua
  wide: 'max-w-[1024px]',  // formulário com colunas ou lista longa
  table: 'max-w-[1280px]', // tabela e painéis lado a lado
};

function SettingsShell({
  level = 'admin',
  areaLabel,
  crumb,
  title,
  description,
  iconName,
  scope,
  scopeDetail,
  action,
  width = 'form',
  children,
}) {
  const location = useLocation();
  const found = findSettingsItem(location.pathname);
  const item = found?.item;

  // Título, descrição e ícone caem para o que a navegação já declara, que é a
  // mesma fonte do menu e das rotas. Quem precisa de outro, passa.
  const tituloFinal = title ?? item?.label ?? 'Configurações';
  const descricaoFinal = description ?? item?.description;
  const iconeFinal = iconName ?? item?.key;
  const trilha = [{ label: 'Configurações', to: SETTINGS_BASE }];
  const segundo = crumb === undefined ? found?.group.group : crumb;
  if (segundo) trilha.push({ label: segundo });

  return (
    <ProtectedRoute level={level} areaLabel={areaLabel || tituloFinal}>
      <div className="settings-shell flex min-h-0 flex-1 flex-col">
        <div className="settings-shell-header">
          <PageHeader
            crumbs={trilha}
            title={<SettingsTitle name={iconeFinal}>{tituloFinal}</SettingsTitle>}
            description={descricaoFinal}
            action={
              scope ? (
                <div className="flex items-center gap-3">
                  <ScopeBadge scope={scope} detail={scopeDetail} />
                  {action}
                </div>
              ) : (
                action || undefined
              )
            }
          />
        </div>
        <div className="settings-shell-body chat-scroll min-h-0 flex-1 overflow-y-auto">
          <div className={`settings-shell-content ${LARGURAS[width] || LARGURAS.form}`} data-width={width}>
            {children}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default SettingsShell;
