import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCampaign } from '../services/api';
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';

const STATUS_LABELS = { pending: 'Pendente', sent: 'Enviado', failed: 'Falhou', skipped: 'Pulado' };

function CampaignDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [campaign, setCampaign] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const refresh = useCallback(() => {
    return getCampaign(id, token).then(setCampaign);
  }, [id, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const processedCount = campaign ? campaign.sentCount + campaign.failedCount + campaign.skippedCount : 0;
  const stillProcessing = campaign ? processedCount < campaign.totalRecipients : false;

  useEffect(() => {
    if (!stillProcessing) return undefined;
    const interval = setInterval(() => refresh(), 3000);
    return () => clearInterval(interval);
  }, [stillProcessing, refresh]);

  if (!campaign) {
    return (
      <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[36%] -top-[12%] h-[38rem] w-[42rem] rounded-full bg-chat-copper/40 blur-[150px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-[8%] bottom-[-18%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/25 blur-[150px]"
        />

        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
          <NavRail active="campaigns" onProfileClick={() => setProfileOpen(true)} />
          <p className="px-4 py-4 text-[14px] text-chat-muted">Carregando...</p>
        </div>
        {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[36%] -top-[12%] h-[38rem] w-[42rem] rounded-full bg-chat-copper/40 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[8%] bottom-[-18%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/25 blur-[150px]"
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
        <NavRail active="campaigns" onProfileClick={() => setProfileOpen(true)} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 px-2 pb-4 pt-2">
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
              {campaign.name || 'Sem nome'}
            </h1>
            <p className="mt-1.5 text-[14px] text-chat-muted">
              {campaign.sentCount} enviados, {campaign.failedCount} falharam, {campaign.skippedCount} pulados de{' '}
              {campaign.totalRecipients}
            </p>
          </header>

          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <ul className="space-y-1.5">
              {campaign.recipients.map((recipient) => (
                <li
                  key={recipient.id}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-4 py-2.5"
                >
                  <div>
                    <p className="text-[14px] text-chat-text">{recipient.displayName || recipient.phoneNumber}</p>
                    {recipient.errorMessage && <p className="text-[12.5px] text-chat-muted">{recipient.errorMessage}</p>}
                  </div>
                  <span className="shrink-0 text-[12.5px] text-chat-muted">{STATUS_LABELS[recipient.status] || recipient.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

export default CampaignDetailPage;
