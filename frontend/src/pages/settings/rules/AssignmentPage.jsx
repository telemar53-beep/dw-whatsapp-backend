import AssignmentMessageSection from '../../../components/messages/AssignmentMessageSection';

function AssignmentPage() {
  return (
    <div className="settings-message-editor">
      <div className="settings-intro border-b border-wa-border pb-4 text-[13.5px] leading-5 text-wa-muted">
        <p>Defina as mensagens enviadas ao assumir e ao encerrar um atendimento, por canal e atendente.</p>
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-chat-orange">Ver variáveis e exemplo</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><code>@chat_saudacao_maiusculo</code> — Bom dia / Boa tarde / Boa noite, automático</li>
            <li><code>@chat_atendente</code> — primeiro nome de quem assumiu</li>
            <li><code>@chat_protocolo</code> — número do protocolo do atendimento</li>
          </ul>
          <p className="mt-2 italic">Exemplo: “Bom dia, meu nome é Geovanna. Irei iniciar seu atendimento, como posso te ajudar? O protocolo do seu atendimento é 1042”</p>
        </details>
      </div>
      <AssignmentMessageSection />
    </div>
  );
}

export default AssignmentPage;
