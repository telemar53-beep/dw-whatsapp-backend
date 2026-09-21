import SettingsPage from '../SettingsPage';
import AudioTranscriptionConfigCard from '../../../components/AudioTranscriptionConfigCard';

function TranscriptionPage() {
  return (
    <SettingsPage
      wide
      title="Transcrição de áudio"
      description="Áudios do cliente viram texto para o atendente e para a IA."
      scope="depends"
      scopeDetail="OpenAI conectada"
    >
      <AudioTranscriptionConfigCard />
    </SettingsPage>
  );
}

export default TranscriptionPage;
