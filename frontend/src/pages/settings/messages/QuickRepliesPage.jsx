import { useState } from 'react';
import { Button, Card, AsyncState } from '../../../components/ui';
import { useQuickReplies } from '../../../hooks/useQuickReplies';
import QuickReplyRow from '../../../components/messages/QuickReplyRow';
import CreateQuickReplyForm from '../../../components/CreateQuickReplyForm';

function QuickRepliesPage() {
  const [creating, setCreating] = useState(false);
  const { quickReplies, status, refresh } = useQuickReplies();
  return (
    <>
      <Card title="Como funciona">
        <p>
          Mensagens prontas que o atendente pode inserir com um clique durante o
          atendimento, pra agilizar respostas repetitivas.
        </p>
        <p className="mt-2 italic">
          Exemplo: "Olá! Para agilizar seu atendimento, poderia me informar seu
          CPF ou número de contrato?"
        </p>
      </Card>
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
        description="Textos prontos que o atendente insere com um clique."
        footer={!creating && <Button onClick={() => setCreating(true)}>Criar resposta rápida</Button>}
      >
        <AsyncState status={status} onRetry={refresh} isEmpty={quickReplies.length === 0} emptyMessage="Nenhuma resposta rápida cadastrada ainda.">
          <div className="space-y-3">
            {quickReplies.map((quickReply) => (
              <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
            ))}
          </div>
        </AsyncState>
      </Card>
    </>
  );
}

export default QuickRepliesPage;
