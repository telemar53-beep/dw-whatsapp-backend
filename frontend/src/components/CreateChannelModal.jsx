import { useState } from 'react';
import CreateChannelForm from './CreateChannelForm';
import WaDialog from './WaDialog';
import { ProviderMark } from '../pages/settings/channels/ChannelVisuals';

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
      <WaDialog title="Criar canal" description="Escolha a conexão. Depois, preencha os dados do número." onClose={onClose} size="max-w-3xl" variant="channel-picker">
        <div className="dialog-provider-options">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className="dialog-provider-option"
            >
              <span className="dialog-provider-symbol" data-provider={option.value} aria-hidden="true"><ProviderMark type={option.value} /></span>
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
    <WaDialog title={`Criar canal — ${selected.label}`} onClose={onClose} size="max-w-3xl" variant="channel-create">
      <div className="dialog-channel-workspace">
        <aside className="dialog-channel-context">
          <span className="dialog-provider-symbol" data-provider={type} aria-hidden="true"><ProviderMark type={type} /></span>
          <h3>{selected.label}</h3>
          <p>{selected.description}</p>
        <button
          type="button"
          onClick={() => setType(null)}
          className="mb-3 text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
        >
          ← Voltar
        </button>
        </aside>
        <CreateChannelForm type={type} onCreated={onCreated} onCancel={onClose} />
      </div>
    </WaDialog>
  );
}

export default CreateChannelModal;
