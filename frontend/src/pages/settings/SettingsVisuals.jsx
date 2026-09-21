import { IconChannel, IconClock, IconChats, IconCheckCircle, IconBrain, IconUser, IconMic, IconRules, IconMegaphone, IconQuickReply, IconFile, IconTeam, IconLock, IconServer, IconSend, IconPlug, IconTags, IconBuilding } from '../../components/icons/WaIcons';

// Ícones funcionais, não reproduções de logotipos de fornecedores.
function BranchIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="8" y="2" width="8" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/></svg>;
}
function MoonIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 15A8.5 8.5 0 0 1 9 4a8.5 8.5 0 1 0 11 11Z"/><path d="M17 3v4m-2-2h4"/></svg>;
}
function PlaceIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>;
}
const ICONS = { canais:IconChannel, horario:IconClock, 'boas-vindas':IconChats, 'abertura-encerramento':IconCheckCircle, 'triagem-menu':BranchIcon, ia:IconBrain, identificacao:IconUser, transcricao:IconMic, noturno:MoonIcon, ferramentas:IconRules, 'avisos-cidade':IconMegaphone, 'respostas-rapidas':IconQuickReply, templates:IconFile, usuarios:IconTeam, setores:BranchIcon, perfis:IconLock, 'sgp-consultas':IconServer, 'sgp-envios':IconSend, openai:IconBrain, motivos:IconTags, cidades:PlaceIcon, empresa:IconBuilding, atendimento:IconClock, automacao:IconBrain, mensagens:IconChats, equipe:IconTeam, integracoes:IconPlug, cadastros:IconTags };
export function SettingsIcon({ name, size = 18 }) {
  const Icon = ICONS[name] || IconRules;
  return <span className="settings-functional-icon" aria-hidden="true"><Icon size={size}/></span>;
}
export function SettingsTitle({ name, children }) {
  return <span className="settings-title"><span className="settings-title-mark"><SettingsIcon name={name} size={23}/></span><span>{children}</span></span>;
}
