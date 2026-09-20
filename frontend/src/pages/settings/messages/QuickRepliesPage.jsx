import { useState } from 'react';
import { Button, Card, AsyncState } from '../../../components/ui';
import { useQuickReplies } from '../../../hooks/useQuickReplies';
import QuickReplyRow from '../../../components/messages/QuickReplyRow';
import CreateQuickReplyForm from '../../../components/CreateQuickReplyForm';

function QuickRepliesPage() {
  const [creating, setCreating] = useState(false);
  const { quickReplies, status, refresh } = useQuickReplies();
  return (
    <div className="settings-message-library">
      <div className="border-b border-wa-border pb-4 text-[13.5px] leading-5 text-wa-muted">
        <p>Textos prontos que o atendente insere na conversa com um clique.</p>
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-chat-orange">Ver exemplo</summary>
          <p className="mt-2 italic">“Olá! Para agilizar seu atendimento, poderia me informar seu CPF ou número de contrato?”</p>
        </details>
      </div>
      <div className="settings-library-toolbar"><span>{status === 'ready' ? `${quickReplies.length} respostas cadastradas` : 'Respostas da equipe'}</span>{!creating && <Button onClick={() => setCreating(true)}>Criar resposta rápida</Button>}</div>
      {creating && (
        <CreateQuickReplyForm
          onCreated={() => {
            refresh();
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      <Card
        title="Cadastradas"
        description="Crie e edite as mensagens disponíveis para a equipe."
      >
        <AsyncState status={status} onRetry={refresh} isEmpty={quickReplies.length === 0} emptyMessage="Nenhuma resposta rápida cadastrada ainda.">
          <div className="space-y-3">
            {quickReplies.map((quickReply) => (
              <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
            ))}
          </div>
        </AsyncState>
      </Card>
    </div>
  );
}

export default QuickRepliesPage;
