import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listCampaigns } from '../services/api';
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';
import CreateCampaignModal from '../components/CreateCampaignModal';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CampaignsPage() {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    return listCampaigns(token)
      .then(setCampaigns)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
          <header className="flex shrink-0 items-center justify-between px-2 pb-4 pt-2">
            <div>
              <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
                Campanhas
              </h1>
              <p className="mt-1.5 text-[14px] text-chat-muted">Disparo em massa para uma lista de clientes</p>
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="shrink-0 rounded-full bg-chat-orange px-5 py-2.5 text-[14px] font-medium text-white transition hover:brightness-110"
            >
              Nova campanha
            </button>
          </header>

          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {loading ? (
              <p className="text-[14px] text-chat-muted">Carregando...</p>
            ) : campaigns.length === 0 ? (
              <p className="text-[14px] text-chat-muted">Nenhuma campanha criada ainda.</p>
            ) : (
              <ul className="space-y-2">
                {campaigns.map((campaign) => (
                  <li key={campaign.id}>
                    <a
                      href={`/campaigns/${campaign.id}`}
                      className="block rounded-[16px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.07]"
                    >
                      <p className="text-[15px] font-medium text-chat-text">{campaign.name || 'Sem nome'}</p>
                      <p className="mt-1 text-[13px] text-chat-muted">
                        {formatDate(campaign.createdAt)} — {campaign.sentCount} enviados, {campaign.failedCount} falharam,{' '}
                        {campaign.skippedCount} pulados de {campaign.totalRecipients}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {creating && (
        <CreateCampaignModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export default CampaignsPage;
