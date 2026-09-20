import { SettingsSteps } from '../SettingsVisuals';
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
      <SettingsSteps items={[['transcricao','Áudio recebido'],['openai','Modelo e limites'],['ia','Texto para equipe e IA']]} />
      <AudioTranscriptionConfigCard />
    </SettingsPage>
  );
}

export default TranscriptionPage;
