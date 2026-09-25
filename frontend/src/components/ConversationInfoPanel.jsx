import { useEffect, useRef, useState } from 'react';
import ContactAvatar from './ContactAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { setConversationSector } from '../services/api';
import { nomeDoLocal } from '../utils/place';
import { descreverErro } from '../utils/errorMessages';

const IDENTIFIED_BY_LABELS = {
  memory: 'memória',
  phone: 'telefone',
  cpf: 'CPF',
  none: 'não identificado',
};

function getStatusMeta(conversation) {
  if (conversation.status === 'closed' || conversation.closedAt) {
    return { label: 'Encerrado', className: 'bg-wa-active text-wa-muted' };
  }
  if (conversation.triageState === 'pending' && conversation.status !== 'silent') {
    return { label: 'Em automação', className: 'bg-wa-link/15 text-wa-link' };
  }
  if (conversation.status === 'waiting') {
    return { label: 'Em espera', className: 'bg-wa-warn-bg text-wa-warn-text' };
  }
  if (conversation.status === 'assigned') {
    return { label: 'Em andamento', className: 'bg-wa-link/15 text-wa-link' };
  }
  return { label: 'Conversa', className: 'bg-wa-active text-wa-muted' };
}

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] leading-[16px] text-wa-muted">{label}</span>
      <span className="text-[14px] leading-[19px] font-medium text-wa-text">{value}</span>
    </div>
  );
}

function ConversationInfoPanel({ conversation }) {
  const { token, agent } = useAuth();
  const { sectors } = useSectors();
  const [sectorId, setSectorId] = useState(conversation.sectorId || '');
  // Troca de setor com retorno (CVM-INF-08/09/10): antes, `.catch(() => {})` —
  // sem "Salvando…", erro mudo, o select ficava no valor não salvo e a linha
  // "Setor" continuava velha.
  const [salvandoSetor, setSalvandoSetor] = useState(false);
  const [erroSetor, setErroSetor] = useState(null);
  const [nomeDoSetorSalvo, setNomeDoSetorSalvo] = useState(null);
  const conversaAtual = useRef(conversation.id);
  conversaAtual.current = conversation.id;

  useEffect(() => {
    setSectorId(conversation.sectorId || '');
    setNomeDoSetorSalvo(null);
    setErroSetor(null);
    setSalvandoSetor(false);
  }, [conversation.id, conversation.sectorId]);

  const displayName = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const status = getStatusMeta(conversation);
  const closedAtLabel = conversation.closedAt
    ? new Date(conversation.closedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  const canEditSector = Boolean(agent) && (agent.role === 'admin' || agent.role === 'manager' || conversation.assignedAgentId === agent.id);

  async function handleSectorChange(event) {
    const value = event.target.value || null;
    const anterior = sectorId;
    const conversaDoPedido = conversation.id;
    setSectorId(value || '');
    setErroSetor(null);
    setSalvandoSetor(true);
    try {
      await setConversationSector(conversaDoPedido, value, token);
      // Resposta que chega depois da troca de conversa não vale para a nova.
      if (conversaDoPedido !== conversaAtual.current) return;
      setNomeDoSetorSalvo(value ? sectors.find((s) => s.id === value)?.name || null : '');
    } catch (err) {
      if (conversaDoPedido !== conversaAtual.current) return;
      setSectorId(anterior);
      setErroSetor(descreverErro(err, 'Não foi possível alterar o setor. Tente de novo.'));
    } finally {
      if (conversaDoPedido === conversaAtual.current) setSalvandoSetor(false);
    }
  }

  const aiSectorName = conversation.aiTriageCompletedAt
    ? sectors.find((s) => s.id === conversation.aiTriageSectorId)?.name || 'Não definido'
    : null;
  const identifiedByLabel = IDENTIFIED_BY_LABELS[conversation.aiTriageIdentifiedBy] || 'não identificado';
  const confidenceLabel = conversation.aiTriageConfidence != null ? `${Math.round(conversation.aiTriageConfidence * 100)}%` : '—';

  return (
    <aside className="dialog-conversation-info hidden w-[272px] shrink-0 flex-col overflow-y-auto border-l border-wa-surface-line bg-wa-surface-soft px-6 py-8 md:flex">
      <div className="flex flex-col items-center text-center">
        <div className="rounded-full ring-4 ring-accent/25">
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={conversation.contactDisplayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={88}
          />
        </div>
        <h2 className="mt-4 font-display text-[17px] font-semibold leading-[22px] text-wa-text">{displayName}</h2>
        {conversation.contactPhoneNumber && (
          <p className="mt-1 text-[13px] leading-[18px] text-wa-muted">{conversation.contactPhoneNumber}</p>
        )}
        <span className={`mt-3 rounded-full px-3 py-1 text-[12px] font-medium ${status.className}`}>{status.label}</span>
      </div>

      {conversation.contactInternalNote && (
        <div className="mt-6 rounded-xl bg-wa-active px-3.5 py-3 text-left">
          <span className="text-[12px] leading-[16px] text-wa-muted">Nota interna</span>
          <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[19px] text-wa-text">
            {conversation.contactInternalNote}
          </p>
        </div>
      )}

      <div className="my-6 border-t border-wa-border" />

      <div className="flex flex-col gap-4">
        <InfoRow label="Cidade" value={nomeDoLocal(conversation.contactLocalityName, conversation.contactCityName) || 'Não informada'} />
        <InfoRow label="Setor" value={(nomeDoSetorSalvo !== null ? nomeDoSetorSalvo : conversation.sectorName) || 'Não definido'} />
        {canEditSector && (
          <label className="-mt-2.5 flex flex-col gap-1">
            <span className="sr-only">Alterar setor</span>
            <select
              aria-label="Alterar setor"
              value={sectorId}
              onChange={handleSectorChange}
              disabled={salvandoSetor}
              className="rounded-lg border border-wa-border bg-wa-panel px-2 py-1.5 text-[13px] text-wa-text"
            >
              <option value="">Selecione um setor</option>
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
            {salvandoSetor && <span className="text-[12px] text-wa-muted">Salvando…</span>}
            {erroSetor && <span role="alert" className="text-[12px] text-wa-error-text">{erroSetor}</span>}
          </label>
        )}
        <InfoRow label="Atendente" value={conversation.assignedAgentName || 'Não atribuído'} />
        {conversation.protocolNumber && <InfoRow label="Protocolo" value={conversation.protocolNumber} />}
        {closedAtLabel && <InfoRow label="Encerrado em" value={closedAtLabel} />}
      </div>

      {conversation.aiTriageCompletedAt && (
        <>
          <div className="my-6 border-t border-wa-border" />
          <div className="flex flex-col gap-4">
            <h3 className="text-[13px] font-semibold text-wa-text">Triagem por IA</h3>
            <InfoRow label="Setor da IA" value={aiSectorName} />
            <InfoRow label="Motivo" value={conversation.aiTriageReasonName || 'não definido'} />
            <InfoRow label="Identificação" value={identifiedByLabel} />
            <InfoRow label="Confiança" value={confidenceLabel} />
            <pre className="whitespace-pre-wrap text-[13px] leading-[18px] text-wa-text">{conversation.aiTriageSummary}</pre>
          </div>
        </>
      )}
    </aside>
  );
}

export default ConversationInfoPanel;
