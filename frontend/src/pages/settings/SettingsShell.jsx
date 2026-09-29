import { Link, useLocation } from 'react-router-dom';
import ProtectedRoute from '../../components/ProtectedRoute';
import { ScopeBadge } from '../../components/ui';
import { IconeSemAcesso } from '../../components/icones/configuracoes';
import { useAuth } from '../../contexts/AuthContext';
import { findSettingsItem, firstAllowedSettingsPath, hasLevel, SETTINGS_BASE } from '../../navigation/navItems';
import { LEVEL_TEXT } from '../AccessDeniedPage';
import { SettingsIcon, temIcone } from './SettingsVisuals';

// Casca única das páginas de Configurações: trilha, título com o ícone da
// página, descrição, escopo, ação, largura e área rolável. O conteúdo de cada
// página continua sendo o que a função dela pede — consistência aqui é a
// moldura, não a composição.

// Largura pela natureza do conteúdo, e não pelo que sobra na tela.
const LARGURAS = {
  form: 'max-w-[760px]',   // formulário de leitura contínua
  wide: 'max-w-[1024px]',  // formulário com colunas ou lista longa
  table: 'max-w-[1280px]', // tabela e painéis lado a lado
};

// Sem permissão, dentro da área: o motivo e o caminho de volta para a primeira
// página que o perfil pode abrir — nunca para fora de Configurações. Nenhuma
// página filha é montada, então nenhum dado dela é pedido.
function SemAcessoNaArea({ areaLabel, level, agent }) {
  const voltar = firstAllowedSettingsPath(agent);
  return (
    <div className="settings-shell cfg-sem-acesso">
      <div className="cfg-sem-acesso-corpo">
        <span className="cfg-sem-acesso-icone"><IconeSemAcesso tamanho={25} /></span>
        <h1>Sem acesso a {areaLabel}</h1>
        <p>{LEVEL_TEXT[level] || LEVEL_TEXT.admin}</p>
        {voltar && <Link to={voltar} className="cfg-botao-secundario">Voltar às Configurações</Link>}
      </div>
    </div>
  );
}

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
  const { token, agent } = useAuth();
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

  if (token && !hasLevel(agent, level)) {
    return <SemAcessoNaArea areaLabel={areaLabel || tituloFinal} level={level} agent={agent} />;
  }

  return (
    <ProtectedRoute level={level} areaLabel={areaLabel || tituloFinal}>
      <div className="settings-shell flex min-h-0 flex-1 flex-col">
        {/* Cabeçalho do mockup: a trilha em cima; o ladrilho do ícone ao lado do
            título e da descrição juntos; a ação à direita. O h1 leva só o nome. */}
        <div className="settings-shell-header">
          <header className="cfg-cabecalho">
            <nav aria-label="Você está em" className="cfg-trilha">
              {trilha.map((passo, indice) => (
                <span key={`${passo.label}-${indice}`}>
                  {passo.to ? <Link to={passo.to}>{passo.label}</Link> : <span>{passo.label}</span>}
                  {indice < trilha.length - 1 && <span aria-hidden="true" className="cfg-trilha-sep">›</span>}
                </span>
              ))}
            </nav>
            <div className="cfg-cabecalho-linha">
              <div className="cfg-titulo">
                {temIcone(iconeFinal) && <span className="settings-title-mark"><SettingsIcon name={iconeFinal} size={21} /></span>}
                <div className="cfg-titulo-texto">
                  <h1>{tituloFinal}</h1>
                  {descricaoFinal && <p>{descricaoFinal}</p>}
                </div>
              </div>
              {(scope || action) && (
                <div className="cfg-cabecalho-acao">
                  {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
                  {action}
                </div>
              )}
            </div>
          </header>
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
