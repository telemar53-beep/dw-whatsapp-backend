import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getConversationHistory, getMessages } from '../services/api';
import MessageAttachment from './MessageAttachment';
import WaDialog, { waGhostButtonClass } from './WaDialog';
import { IconArrowLeft, IconHistory } from './icons/WaIcons';

function ConversationHistoryModal({ contactId, onClose }) {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    getConversationHistory(contactId, token)
      .then(setHistory)
      .catch(() => {});
  }, [contactId, token]);

  function openConversation(conversation) {
    setSelected(conversation);
    getMessages(conversation.id, token)
      .then(setMessages)
      .catch(() => {});
  }

  return (
    <WaDialog onClose={onClose} size="max-w-lg">
      {selected ? (
        <>
          <div className="flex shrink-0 items-center gap-3 border-b border-wa-border px-4 py-3">
            <button
              onClick={() => setSelected(null)}
              aria-label="Voltar"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-icon hover:bg-wa-hover"
            >
              <IconArrowLeft size={20} />
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] leading-[21px] text-wa-text">
                Atendimento em {new Date(selected.updatedAt).toLocaleDateString('pt-BR')}
              </span>
              <span className="block truncate text-[13px] leading-[17px] text-wa-muted">{selected.channelName}</span>
            </span>
          </div>
          <div className="wa-wallpaper wa-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`wa-bubble max-w-[80%] rounded-[7.5px] px-[9px] pb-[7px] pt-[6px] text-[14.2px] leading-[19px] text-wa-text ${
                    message.direction === 'outbound' ? 'bg-wa-out' : 'bg-wa-in'
                  }`}
                >
                  {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                  <MessageAttachment message={message} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 px-6 pb-2 pt-5">
            <h2 className="text-[19px] leading-[26px] text-wa-text">Atendimentos anteriores</h2>
          </div>
          <div className="wa-scroll min-h-0 flex-1 overflow-y-auto py-1">
            {history.length === 0 ? (
              <p className="px-6 py-4 text-[14px] text-wa-muted">Nenhum atendimento anterior encontrado.</p>
            ) : (
              <ul>
                {history.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      onClick={() => openConversation(conversation)}
                      className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-wa-hover"
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-[#8696a0]"
                      >
                        <IconHistory size={19} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] leading-[20px] text-wa-text">
                          {new Date(conversation.updatedAt).toLocaleDateString('pt-BR')}
                        </span>
                        <span className="block truncate text-[13px] leading-[18px] text-wa-muted">
                          {conversation.channelName}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <div className="flex shrink-0 justify-end px-4 py-3">
        <button onClick={onClose} className={waGhostButtonClass}>
          Fechar
        </button>
      </div>
    </WaDialog>
  );
}

export default ConversationHistoryModal;
