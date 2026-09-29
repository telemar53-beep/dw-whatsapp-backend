import { IconeCanais, IconeEquipe, IconeConsultarSgp, IconeRespostasRapidas } from '../../components/icones';
import { IconeAutomacao } from '../../components/icones/IconeAutomacao';
import { IconeMotivoInformacoesComerciais } from '../../components/icones/IconeMotivoInformacoesComerciais';
import {
  IconeRegrasEHorarios, IconeHorario, IconeMensagens, IconeBoasVindas, IconeAberturaEncerramento,
  IconeAvisosPorCidade, IconeTemplates, IconeTriagemPorMenu, IconeIdentificacao, IconeTranscricao,
  IconeAtendimentoNoturno, IconeAcoesDaIa, IconeIntegracoes, IconePixEBoleto, IconeSetores, IconePerfis,
  IconeCadastros, IconeMotivos, IconeCidades, IconeEmpresa,
} from '../../components/icones/configuracoes';

// Um ícone da família DW por página e por grupo de Configurações, aprovados
// nas três pranchas de 29/09. A chave é a mesma de navItems (item.key e
// group.groupKey). Reaproveitados com o mesmo significado: Canais, Equipe,
// Automação, Consultar SGP, Respostas rápidas e Informações comerciais.
//
// A OpenAI não tem ícone: só o texto, até existir uma marca oficial com
// origem e autorização documentadas. Chave sem ícone não desenha nada — nunca
// um genérico no lugar.
const ICONES = {
  // Grupos
  canais: IconeCanais,
  regras: IconeRegrasEHorarios,
  mensagens: IconeMensagens,
  automacao: IconeAutomacao,
  integracoes: IconeIntegracoes,
  equipe: IconeEquipe,
  cadastros: IconeCadastros,
  empresa: IconeEmpresa,
  // Páginas
  horario: IconeHorario,
  'boas-vindas': IconeBoasVindas,
  'abertura-encerramento': IconeAberturaEncerramento,
  'avisos-cidade': IconeAvisosPorCidade,
  'respostas-rapidas': IconeRespostasRapidas,
  templates: IconeTemplates,
  'triagem-menu': IconeTriagemPorMenu,
  ia: IconeAutomacao,
  identificacao: IconeIdentificacao,
  transcricao: IconeTranscricao,
  noturno: IconeAtendimentoNoturno,
  ferramentas: IconeAcoesDaIa,
  usuarios: IconeEquipe,
  setores: IconeSetores,
  perfis: IconePerfis,
  'sgp-consultas': IconeConsultarSgp,
  'sgp-envios': IconePixEBoleto,
  motivos: IconeMotivos,
  cidades: IconeCidades,
  planos: IconeMotivoInformacoesComerciais,
};

export function temIcone(name) {
  return Boolean(ICONES[name]);
}

export function SettingsIcon({ name, size = 18 }) {
  const Icone = ICONES[name];
  if (!Icone) return null;
  return <span className="settings-functional-icon" aria-hidden="true"><Icone tamanho={size} /></span>;
}

// Título da página: o ladrilho com o ícone (21 px, como no mockup) e o nome.
// Sem ícone (OpenAI), só o nome.
export function SettingsTitle({ name, children }) {
  return (
    <span className="settings-title">
      {temIcone(name) && <span className="settings-title-mark"><SettingsIcon name={name} size={21} /></span>}
      <span>{children}</span>
    </span>
  );
}
