import SettingsPage from '../SettingsPage';
import { Card } from '../../../components/ui';
import AssignmentMessageSection from '../../../components/messages/AssignmentMessageSection';

function AssignmentPage() {
  return (
    <SettingsPage title="Atribuição" description="Mensagens automáticas ao assumir e ao encerrar um atendimento." scope="global">
      <Card title="Como funciona">
        <p>
          Enviada automaticamente para o cliente quando um atendente assume o
          atendimento, e uma segunda mensagem quando ele é encerrado. Escolha
          abaixo quais atendentes e quais canais disparam essas mensagens.
        </p>
        <p className="mt-2">Placeholders disponíveis:</p>
        <ul className="mt-1 list-disc pl-5">
          <li><code>@chat_saudacao_maiusculo</code> — Bom dia / Boa tarde / Boa noite, automático</li>
          <li><code>@chat_atendente</code> — primeiro nome de quem assumiu</li>
          <li><code>@chat_protocolo</code> — número do protocolo do atendimento</li>
        </ul>
        <p className="mt-2 italic">
          Exemplo: "Bom dia, meu nome é Geovanna. Irei iniciar seu atendimento,
          como posso te ajudar? O protocolo do seu atendimento é 1042"
        </p>
      </Card>
      <AssignmentMessageSection />
    </SettingsPage>
  );
}

export default AssignmentPage;
