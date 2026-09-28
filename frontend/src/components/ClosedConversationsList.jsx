import ContactAvatar from './ContactAvatar';
import { getPreviewText } from './ConversationListItem';

// A lista dos Encerrados, clara (Bloco 1): uma coluna de linhas — foto, nome,
// quando encerrou, a última mensagem e o setor. A escolhida fica marcada em
// índigo (a mesma marca do Transferir) e com `aria-current`.
//
// Os estados são os de sempre: carregando sem "nenhum", erro com "Tentar de
// novo", sem permissão, vazio; e o "Carregar mais" com o erro dele (CVM-ENC-11).

function pad(n) {
  return String(n).padStart(2, '0');
}

// "20/09 12:00", na hora do navegador.
export function dataCurta(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return `${pad(data.getDate())}/${pad(data.getMonth() + 1)} ${pad(data.getHours())}:${pad(data.getMinutes())}`;
}

function Carregando() {
  return (
    <div role="status" className="ae-carregando">
      <span className="mc-carregando">Carregando os atendimentos…</span>
      <span aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="ae-carregando-linha"><i /><b /><b /></span>
        ))}
      </span>
    </div>
  );
}

function ClosedConversationsList({ conversations, status, onSelect, selectedId, hasMore, loading, onLoadMore, onRetry, erroAoCarregarMais = false }) {
  if (status === 'loading') return <Carregando />;
  if (status === 'forbidden') return <p className="mc-vazio ae-estado">Você não tem permissão para ver esta lista.</p>;
  if (status === 'error') {
    return (
      <div role="alert" className="mc-falha ae-falha">
        <span>Não foi possível carregar os atendimentos encerrados.</span>
        {onRetry && <button type="button" className="mc-botao" onClick={onRetry}>Tentar de novo</button>}
      </div>
    );
  }
  if (conversations.length === 0) return <p className="mc-vazio ae-estado">Nenhum atendimento encerrado ainda.</p>;

  return (
    <>
      <ul className="ae-lista">
        {conversations.map((conversation) => {
          const nome = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
          const quando = dataCurta(conversation.closedAt || conversation.lastMessageAt);
          const escolhida = selectedId === conversation.id;
          return (
            <li key={conversation.id}>
              <button
                type="button"
                className="ae-linha"
                data-conversa={conversation.id}
                aria-current={escolhida ? 'true' : undefined}
                onClick={() => onSelect(conversation)}
              >
                <span className="ae-foto" aria-hidden="true">
                  <ContactAvatar
                    contactId={conversation.contactId}
                    avatarPath={conversation.contactAvatarPath}
                    displayName={conversation.contactDisplayName}
                    phoneNumber={conversation.contactPhoneNumber}
                    size={36}
                  />
                </span>
                <span className="ae-linha-topo">
                  <span className="ae-nome" title={nome}>{nome}</span>
                  {quando && <span className="ae-quando" title="Encerrado em">{quando}</span>}
                </span>
                <span className="ae-previa">{getPreviewText(conversation)}</span>
                {conversation.sectorName && <span className="ae-setor">{conversation.sectorName}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {erroAoCarregarMais && (
        <p role="alert" className="ae-erro-mais">Não foi possível carregar mais atendimentos.</p>
      )}
      {hasMore && (
        <button type="button" onClick={onLoadMore} disabled={loading} className="mc-botao ae-mais">
          {loading ? 'Carregando…' : erroAoCarregarMais ? 'Tentar de novo' : 'Carregar mais'}
        </button>
      )}
    </>
  );
}

export default ClosedConversationsList;
