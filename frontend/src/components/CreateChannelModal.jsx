import { useState } from 'react';
import CreateChannelForm from './CreateChannelForm';
import WaDialog from './WaDialog';

const TYPE_OPTIONS = [
  {
    value: 'baileys',
    label: 'Baileys (não oficial)',
    description: 'Conecta pelo WhatsApp normal, escaneando um QR code — mais rápido de configurar.',
  },
  {
    value: 'meta_cloud',
    label: 'Meta Cloud (oficial)',
    description: 'API oficial da Meta — precisa de Phone Number ID, Access Token e WABA ID.',
  },
  {
    value: '360dialog',
    label: '360dialog (oficial via BSP)',
    description: 'API oficial via 360dialog — precisa só da API Key (D360-API-KEY) e do WABA ID.',
  },
];

function CreateChannelModal({ onClose, onCreated }) {
  const [type, setType] = useState(null);

  if (!type) {
    return (
      <WaDialog title="Criar canal" onClose={onClose} size="max-w-lg">
        <div className="space-y-3 px-6 py-4">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className="w-full rounded-2xl border border-wa-surface-line bg-wa-surface p-4 text-left shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl transition hover:bg-wa-panel"
            >
              <p className="font-medium text-wa-text">{option.label}</p>
              <p className="mt-1 text-sm text-wa-muted">{option.description}</p>
            </button>
          ))}
        </div>
      </WaDialog>
    );
  }

  const selected = TYPE_OPTIONS.find((option) => option.value === type);

  return (
    <WaDialog title={`Criar canal — ${selected.label}`} onClose={onClose} size="max-w-lg">
      <div className="px-6 py-4">
        <button
          type="button"
          onClick={() => setType(null)}
          className="mb-3 text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
        >
          ← Voltar
        </button>
        <CreateChannelForm type={type} onCreated={onCreated} onCancel={onClose} />
      </div>
    </WaDialog>
  );
}

export default CreateChannelModal;
