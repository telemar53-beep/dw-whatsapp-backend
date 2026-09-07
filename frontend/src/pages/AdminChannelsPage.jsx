import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import CreateChannelForm from '../components/CreateChannelForm';
import QrCodeView from '../components/QrCodeView';
import AgentsAdminTab from '../components/AgentsAdminTab';
import QuickRepliesAdminTab from '../components/QuickRepliesAdminTab';
import SectorsAdminTab from '../components/SectorsAdminTab';
import TriageAdminTab from '../components/TriageAdminTab';
import TemplatesAdminTab from '../components/TemplatesAdminTab';
import { setChannelTriageEnabled, setChannelWabaId } from '../services/api';

function AdminChannelsPage() {
  const { token } = useAuth();
  const { channels, refresh } = useChannels();
  const [activeTab, setActiveTab] = useState('channels');
  const [triageToggleError, setTriageToggleError] = useState(null);
  const [wabaIdDrafts, setWabaIdDrafts] = useState({});
  const [wabaIdError, setWabaIdError] = useState(null);

  async function handleToggleTriage(channelId, triageEnabled) {
    setTriageToggleError(null);
    try {
      await setChannelTriageEnabled(channelId, triageEnabled, token);
      refresh();
    } catch (err) {
      setTriageToggleError((err.body && err.body.error) || 'Falha ao atualizar a triagem deste canal');
    }
  }

  async function handleSaveWabaId(channelId) {
    setWabaIdError(null);
    try {
      await setChannelWabaId(channelId, wabaIdDrafts[channelId], token);
      refresh();
    } catch (err) {
      setWabaIdError((err.body && err.body.error) || 'Falha ao atualizar o WABA ID');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold text-gray-800">Administração</h1>
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('channels')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'channels' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Canais
        </button>
        <button
          onClick={() => setActiveTab('agents')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'agents' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Atendentes
        </button>
        <button
          onClick={() => setActiveTab('quickReplies')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'quickReplies' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Respostas rápidas
        </button>
        <button
          onClick={() => setActiveTab('sectors')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'sectors' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Setores
        </button>
        <button
          onClick={() => setActiveTab('triage')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'triage' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Triagem
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'templates' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Templates
        </button>
      </div>
      {activeTab === 'channels' ? (
        <div className="space-y-6">
          {triageToggleError && <p className="text-sm text-red-600">{triageToggleError}</p>}
          {wabaIdError && <p className="text-sm text-red-600">{wabaIdError}</p>}
          <div className="space-y-3">
            {channels.map((channel) => (
              <div key={channel.id} className="rounded border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">{channel.name}</p>
                    <p className="text-sm text-gray-500">
                      {channel.type === 'meta_cloud' ? 'Meta Cloud (oficial)' : 'Baileys (não oficial)'} —{' '}
                      {channel.phoneNumber}
                    </p>
                  </div>
                  <span className="text-sm text-gray-500">{channel.status}</span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!channel.triageEnabled}
                    onChange={(e) => handleToggleTriage(channel.id, e.target.checked)}
                  />
                  Usar triagem automática
                </label>
                {channel.type === 'meta_cloud' && (
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor={`waba-id-${channel.id}`} className="text-sm text-gray-600">
                      WABA ID
                    </label>
                    <input
                      id={`waba-id-${channel.id}`}
                      value={wabaIdDrafts[channel.id] ?? channel.wabaId ?? ''}
                      onChange={(e) => setWabaIdDrafts((prev) => ({ ...prev, [channel.id]: e.target.value }))}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => handleSaveWabaId(channel.id)}
                      className="rounded bg-gray-200 px-2 py-1 text-sm text-gray-700"
                    >
                      Salvar WABA ID
                    </button>
                  </div>
                )}
                <QrCodeView channel={channel} onRefresh={refresh} />
              </div>
            ))}
          </div>
          <CreateChannelForm onCreated={refresh} />
        </div>
      ) : activeTab === 'agents' ? (
        <AgentsAdminTab />
      ) : activeTab === 'quickReplies' ? (
        <QuickRepliesAdminTab />
      ) : activeTab === 'sectors' ? (
        <SectorsAdminTab />
      ) : activeTab === 'triage' ? (
        <TriageAdminTab />
      ) : (
        <TemplatesAdminTab />
      )}
    </div>
  );
}

export default AdminChannelsPage;
