import { memo } from 'react';
import ContactAvatar from '../ContactAvatar';
import MessageStatusTicks from '../MessageStatusTicks';
import { getPreviewText } from '../ConversationListItem';
import { IconeRecolher } from '../icones';
import { IconeAutomacao, IconeSemResponsavel } from '../icones/supervisao';
import { nomeDoLocal } from '../../utils/place';
import { agentInitial } from '../../utils/agentDisplayName';
import { isHandledByAi, inicioDoTempo } from './regras';
import { TempoDecorrido, HoraDoEncerramento } from './Relogio';

// Uma linha densa por conversa, com UMA ação: abrir. Nada de encerrar ou
// finalizar daqui — a Supervisão olha e abre; decidir é dentro da conversa.
//
// memo com comparação rasa, de propósito: `conversa` mantém a referência
// quando o evento é de outra conversa (useAttendanceDashboard), `rotulos` só
// muda com a lista de atendentes e `onAbrir` é estável. O tempo que passa não
// redesenha a linha: quem lê o relógio é o texto do tempo (Relogio.jsx).

export function grupoDaConversa(conversa) {
  if (conversa.status === 'closed') return 'encerrado';
  if (conversa.status === 'assigned') return 'atendimento';
  if (conversa.triageState === 'pending') return 'automacao';
  return 'espera';
}

const ESTADO = { espera: 'Espera', atendimento: 'Em atendimento', automacao: 'Automação', encerrado: 'Encerrado' };

function responsavelDe(conversa, rotulos) {
  const agente = conversa.assignedAgentId ? rotulos.get(conversa.assignedAgentId) : null;
  if (agente) return { tipo: 'agente', rotulo: agente.curto, completo: agente.completo };
  if (conversa.status !== 'closed' && conversa.triageState === 'pending') return { tipo: 'ia', rotulo: 'IA em triagem' };
  if (conversa.status === 'closed' && isHandledByAi(conversa)) return { tipo: 'ia', rotulo: 'IA' };
  return { tipo: 'vazio', rotulo: 'Sem responsável' };
}

function LinhaDaSupervisao({ conversa, rotulos, onAbrir, mostrarEstado = false }) {
  const grupo = grupoDaConversa(conversa);
  const nome = conversa.contactDisplayName || conversa.contactPhoneNumber || 'Cliente';
  const local = nomeDoLocal(conversa.contactLocalityName, conversa.contactCityName);
  const responsavel = responsavelDe(conversa, rotulos);
  // "IA · motivo" quando a triagem da IA deu um motivo; "IA" quando concluiu
  // sem motivo. É o mesmo texto da linha antiga.
  const comIa = Boolean(conversa.aiTriageCompletedAt || conversa.aiTriageReasonName);

  return (
    <li className="sv-item">
      <button type="button" className="sv-linha" data-grupo={grupo} onClick={() => onAbrir(conversa.id)}>
        {/* A foto repetia o nome no nome acessível da linha (alt do <img>). */}
        <span className="sv-linha-foto" aria-hidden="true">
          <ContactAvatar
            contactId={conversa.contactId}
            avatarPath={conversa.contactAvatarPath}
            displayName={conversa.contactDisplayName}
            phoneNumber={conversa.contactPhoneNumber}
            size={32}
          />
        </span>
        <span className="sv-linha-cliente">
          <span className="sv-linha-nome" title={nome}>{nome}</span>
          <span className="sv-linha-previa">
            {conversa.lastMessageDirection === 'outbound' && <MessageStatusTicks status={conversa.lastMessageStatus} />}
            <span className="sv-linha-previa-texto">{getPreviewText(conversa) || ''}</span>
          </span>
        </span>
        <span className="sv-linha-contexto">
          <span className="sv-linha-setor" data-vazio={conversa.sectorName ? undefined : 'true'}>{conversa.sectorName || 'Sem setor'}</span>
          {(comIa || conversa.aiTriageResolvedByAi || local) && (
            <span className="sv-linha-motivo">
              {/* O violeta fica só na marca "IA": pintar o motivo inteiro
                  espalhava a cor da Automação por quase toda linha. */}
              {comIa && <span className="sv-linha-ia"><b className="sv-linha-ia-marca">IA</b>{conversa.aiTriageReasonName ? ` · ${conversa.aiTriageReasonName}` : ''}</span>}
              {comIa && conversa.aiTriageLowConfidence && (
                <span className="sv-linha-alerta" role="img" aria-label="Triagem com confiança baixa" title="A triagem da IA ficou com confiança baixa">⚠</span>
              )}
              {conversa.aiTriageResolvedByAi && <span className="sv-linha-ia">Resolvido pela IA</span>}
              {local && <span className="sv-linha-local">{local}</span>}
            </span>
          )}
        </span>
        <span className="sv-responsavel" data-tipo={responsavel.tipo}>
          {responsavel.tipo === 'agente' && <span className="sv-responsavel-inicial" aria-hidden="true">{agentInitial(responsavel.rotulo)}</span>}
          {responsavel.tipo === 'vazio' && <IconeSemResponsavel tamanho={16} className="sv-responsavel-icone" />}
          {responsavel.tipo === 'ia' && <IconeAutomacao tamanho={16} className="sv-responsavel-icone" />}
          <span className="sv-responsavel-nome" title={responsavel.completo || responsavel.rotulo}>{responsavel.rotulo}</span>
        </span>
        <span className="sv-linha-tempo" data-grupo={grupo}>
          {mostrarEstado && <span className="sv-linha-estado">{ESTADO[grupo]}</span>}
          {grupo === 'encerrado' ? (
            <span className="sv-linha-tempo-valor">
              <span className="sr-only">encerrado </span>
              <HoraDoEncerramento em={conversa.closedAt} />
            </span>
          ) : (
            <span className="sv-linha-tempo-valor">
              <span className="sr-only">{grupo === 'espera' ? 'esperando há ' : 'última mensagem há '}</span>
              <TempoDecorrido desde={inicioDoTempo(conversa)} />
            </span>
          )}
        </span>
        <IconeRecolher tamanho={16} className="sv-linha-seta" />
      </button>
    </li>
  );
}

export default memo(LinhaDaSupervisao);
