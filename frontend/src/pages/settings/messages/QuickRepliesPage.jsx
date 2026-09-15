import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button, Card, AsyncState } from '../../../components/ui';
import { useQuickReplies } from '../../../hooks/useQuickReplies';
import QuickReplyRow from '../../../components/messages/QuickReplyRow';
import CreateQuickReplyForm from '../../../components/CreateQuickReplyForm';

function QuickRepliesPage() {
  const [creating, setCreating] = useState(false);
  const { quickReplies, loading, status: hookStatus, refresh } = useQuickReplies();
  const status = hookStatus || (loading ? 'loading' : 'ready');
  return (
    <SettingsPage
      title="Respostas rápidas"
      description="Textos prontos que o atendente insere com um clique."
      scope="global"
      action={!creating && <Button onClick={() => setCreating(true)}>Criar resposta rápida</Button>}
    >
      {creating && (
        <CreateQuickReplyForm
          onCreated={() => {
            refresh();
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      <Card title="Cadastradas">
        <AsyncState status={status} onRetry={refresh} isEmpty={quickReplies.length === 0} emptyMessage="Nenhuma resposta rápida cadastrada ainda.">
          <div className="space-y-3">
            {quickReplies.map((quickReply) => (
              <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
            ))}
          </div>
        </AsyncState>
      </Card>
    </SettingsPage>
  );
}

export default QuickRepliesPage;
