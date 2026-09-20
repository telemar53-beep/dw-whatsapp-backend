import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button, DangerZone, Field, inputClass } from '../../../components/ui';
import QrCodeView from '../../../components/QrCodeView';
import { IconInfo, IconChevronDown } from '../../../components/icons/WaIcons';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import { formatPhone } from '../../../utils/phone';
import { ConnectionStatus, providerLabel } from './ChannelsTable';

export { STATUS_LABELS } from './channelStatus';
export { ConnectionStatus as StatusDot } from './ChannelsTable';

const PERMISSION_REASON = 'Requer permissão de Canais e Integrações';

function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">{children}</p>;
}

// Levar um número de outro provedor para o Meta Cloud. O canal é convertido no
// lugar — mesmo id, mesmo telefone — porque recriar perderia as conversas, os
// protocolos, as campanhas e a integração SGP daquele número. O backend confere
// as credenciais com a Meta contra o telefone deste canal antes de mudar nada.
function MetaCloudCredentialsForm({ channel, canManage, onSave }) {
  const updating = channel.type === 'meta_cloud';
  const [open, setOpen] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSave({ phoneNumberId, accessToken, wabaId });
      setOpen(false);
    } catch (err) {
      setError((err.body && err.body.error) || 'Não foi possível salvar as credenciais deste canal');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={!canManage}
        title={!canManage ? PERMISSION_REASON : undefined}
      >
        {updating ? 'Atualizar credenciais' : 'Migrar para Meta Cloud'}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <p className="rounded-[12px] bg-wa-panel-header px-3 py-2.5 text-[13px] text-wa-muted">
        {updating
          ? `Use isto quando o Access Token for rotacionado ou revogado. As credenciais são conferidas com a Meta contra o número ${formatPhone(channel.phoneNumber)} antes de serem salvas, e o histórico deste canal não é afetado.`
          : `O número ${formatPhone(channel.phoneNumber)} precisa estar no Cloud API da Meta antes disso — ou seja, já ter saído do provedor atual — e o app precisa estar inscrito no webhook da conta do WhatsApp. O histórico deste canal é preservado: conversas, protocolos e integrações continuam aqui.`}
      </p>
      <Field id="migratePhoneNumberId" label="Phone Number ID">
        <input
          id="migratePhoneNumberId"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className={inputClass}
          required
        />
      </Field>
      <Field id="migrateAccessToken" label="Access Token">
        <input
          id="migrateAccessToken"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          className={inputClass}
          required
        />
      </Field>
      <Field id="migrateWabaId" label="WABA ID">
        <input
          id="migrateWabaId"
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
          className={inputClass}
          required
        />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {updating ? 'Salvar' : 'Migrar'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// As duas frases de Ações avançadas eram fixas e anunciavam ações que o canal
// não tem: num Meta Cloud prometiam "Migrar" e "reconectar" sem nenhum dos dois
// botões na tela. Agora saem da mesma condição que decide quais botões existem.
function joinPt(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`;
}

function advancedActions(type) {
  const verbs = [];
  const notes = [];
  if (type === 'meta_cloud') {
    verbs.push('atualizar credenciais');
    notes.push('atualizar credenciais troca o Access Token e os IDs deste canal');
  } else {
    verbs.push('migrar');
    notes.push('migrar troca o provedor deste número sem perder o histórico');
  }
  if (type === 'baileys') {
    verbs.push('reconectar');
    notes.push('reconectar gera um novo QR code');
  }
  verbs.push('ocultar', 'excluir');
  notes.push('ocultar tira o canal da lista sem apagar nada');
  notes.push('excluir só é possível se o canal nunca teve conversas');
  const summary = joinPt(verbs);
  return {
    summary: `${summary.charAt(0).toUpperCase()}${summary.slice(1)} este canal`,
    description: `${notes.join('; ').replace(/^./, (c) => c.toUpperCase())}.`,
  };
}

function DataRow({ label, children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="w-[46%] shrink-0 text-[13px] text-wa-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center justify-between gap-3 text-[13.5px] text-wa-text">
        <span className="min-w-0 truncate">{children}</span>
        {action}
      </dd>
    </div>
  );
}

function ChannelConnectionTab() {
  const { channel, refresh, actions, canManage } = useOutletContext();
  const official = isOfficialChannelType(channel.type);
  const [editingWaba, setEditingWaba] = useState(false);
  const [wabaIdDraft, setWabaIdDraft] = useState(channel.wabaId || '');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(channel.name);

  // Trocar de canal (mesma aba, id novo na URL) não remonta o componente —
  // sincroniza o rascunho com o canal atual em vez de arrastar o valor do
  // canal anterior.
  useEffect(() => {
    setWabaIdDraft(channel.wabaId || '');
    setEditingWaba(false);
  }, [channel.id, channel.wabaId]);

  useEffect(() => {
    setNameDraft(channel.name);
    setEditingName(false);
  }, [channel.id, channel.name]);

  const busy = actions.busyChannelId === channel.id;

  async function handleSaveWaba() {
    await actions.saveWabaId(channel.id, wabaIdDraft);
    setEditingWaba(false);
  }

  async function handleSaveName() {
    await actions.saveChannelName(channel.id, nameDraft.trim());
    setEditingName(false);
  }

  return (
    <div className="space-y-3">
      {!canManage && (
        <p className="rounded-[12px] bg-wa-warn-bg px-3 py-2.5 text-[13.5px] text-wa-warn-text">{PERMISSION_REASON}</p>
      )}
      <ErrorNote>{actions.errors.name}</ErrorNote>
      <ErrorNote>{actions.errors.wabaId}</ErrorNote>
      <ErrorNote>{actions.errors.action}</ErrorNote>

      <div className="settings-channel-connection grid gap-3">
        <section aria-labelledby="connection-data-title" className="order-2 rounded-[14px] border border-wa-border bg-black/[0.08] px-4 pb-2 pt-4 sm:px-5">
          <h3 id="connection-data-title" className="text-[15px] font-semibold text-wa-text">
            Dados da conexão
          </h3>
          <dl className="mt-2 divide-y divide-wa-border">
            {!editingName && (
              <DataRow
                label="Nome"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingName(true)}
                    disabled={!canManage}
                    title={!canManage ? PERMISSION_REASON : undefined}
                  >
                    Editar nome
                  </Button>
                }
              >
                {channel.name}
              </DataRow>
            )}
            <DataRow label="Provedor">{providerLabel(channel.type)}</DataRow>
            <DataRow label="Tipo">{official ? 'API oficial' : 'Não oficial'}</DataRow>
            <DataRow label="Número">{formatPhone(channel.phoneNumber)}</DataRow>
            {!official && (
              <DataRow label="Situação">
                <ConnectionStatus channel={channel} />
              </DataRow>
            )}
            {official && !editingWaba && (
              <DataRow
                label="Identificador da conta (WABA)"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingWaba(true)}
                    disabled={!canManage}
                    title={!canManage ? PERMISSION_REASON : undefined}
                  >
                    Editar
                  </Button>
                }
              >
                {channel.wabaId || <span className="text-wa-meta">não informado</span>}
              </DataRow>
            )}
          </dl>
          {editingName && (
            <div className="border-t border-wa-border py-3">
              <Field id="channel-name" label="Nome do canal" width="md">
                <input
                  id="channel-name"
                  value={nameDraft}
                  disabled={!canManage}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button onClick={handleSaveName} disabled={!canManage || !nameDraft.trim()} className="!py-2">
                  Salvar nome
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNameDraft(channel.name);
                    setEditingName(false);
                  }}
                  className="!py-2"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          {official && editingWaba && (
            <div className="border-t border-wa-border py-3">
              <Field id="waba-id" label="Identificador da conta (WABA ID)" width="md">
                <input
                  id="waba-id"
                  value={wabaIdDraft}
                  disabled={!canManage}
                  onChange={(e) => setWabaIdDraft(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button onClick={handleSaveWaba} disabled={!canManage} className="!py-2">
                  Salvar WABA ID
                </Button>
                <Button variant="secondary" onClick={() => { setWabaIdDraft(channel.wabaId || ''); setEditingWaba(false); }} className="!py-2">
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="order-1 rounded-[14px] border border-chat-orange/25 bg-chat-orange/[0.045] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 shrink-0 text-wa-muted">
              <IconInfo size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-wa-text">Sobre o status</h3>
              <p className="mt-1 text-[13px] leading-[19px] text-wa-muted">
                {official
                  ? 'API oficial identifica o tipo de conexão. O status operacional é confirmado pelo provedor, não por este sistema.'
                  : channel.status === 'awaiting_qr'
                    ? 'Leia o QR code abaixo no WhatsApp do número deste canal. A situação muda para "Conectado" sozinha assim que o celular terminar.'
                    : channel.status === 'connected'
                      ? 'O WhatsApp deste número está ligado a este sistema. Se cair, use "Reconectar" em Ações avançadas.'
                      : 'O WhatsApp deste número não está ligado. Use "Reconectar" em Ações avançadas para gerar um novo QR code.'}
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-full border border-wa-border bg-wa-surface px-3 py-1.5"><ConnectionStatus channel={channel} /></div>
          </div>
          <QrCodeView channel={channel} onRefresh={refresh} />
        </section>
      </div>

      <details className="group rounded-[14px] border border-wa-border bg-black/[0.08]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13.5px] text-wa-text sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="text-wa-muted transition-transform group-open:rotate-180">
              <IconChevronDown size={16} />
            </span>
            Ações avançadas
          </span>
          <span className="text-[12.5px] text-wa-muted">{advancedActions(channel.type).summary}</span>
        </summary>
        <div className="px-4 pb-4 sm:px-5">
          <DangerZone description={advancedActions(channel.type).description}>
            <MetaCloudCredentialsForm
              channel={channel}
              canManage={canManage}
              onSave={(credentials) => actions.saveMetaCloudCredentials(channel.id, credentials)}
            />
            {channel.type === 'baileys' && (
              <Button
                variant="secondary"
                onClick={() => actions.reconnect(channel)}
                disabled={!canManage || busy}
                title={!canManage ? PERMISSION_REASON : undefined}
              >
                Reconectar
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => actions.toggleHidden(channel)}
              disabled={!canManage || busy}
              title={!canManage ? PERMISSION_REASON : undefined}
            >
              {channel.hidden ? 'Reexibir' : 'Ocultar'}
            </Button>
            <Button
              variant="danger"
              onClick={() => actions.remove(channel)}
              disabled={!canManage || busy}
              title={!canManage ? PERMISSION_REASON : undefined}
            >
              Excluir
            </Button>
          </DangerZone>
        </div>
      </details>
    </div>
  );
}

export default ChannelConnectionTab;
