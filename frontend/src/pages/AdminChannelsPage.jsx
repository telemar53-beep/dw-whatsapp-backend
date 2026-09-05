import { useChannels } from '../hooks/useChannels';
import CreateChannelForm from '../components/CreateChannelForm';
import QrCodeView from '../components/QrCodeView';

function AdminChannelsPage() {
  const { channels, refresh } = useChannels();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold text-gray-800">Administração de Canais</h1>
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
            <QrCodeView channel={channel} onRefresh={refresh} />
          </div>
        ))}
      </div>
      <CreateChannelForm onCreated={refresh} />
    </div>
  );
}

export default AdminChannelsPage;
