import { useState, useRef, useEffect } from 'react';
import { IconEmoji, IconAttach, IconQuickReply, IconMic, IconSend, IconTrash, IconStop } from './icons/WaIcons';
import { AsyncState } from './ui';
import RecordingPreview from './RecordingPreview';

// O campo cresce com o conteúdo, como o WhatsApp: com altura fixa, reler um
// texto longo antes de enviar virava rolar dentro de uma caixa de 4 linhas.
// O teto existe para o campo não engolir a conversa — passando dele, rola por
// dentro como antes.
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 320;

function fitComposerHeight(element) {
  if (!element) return;
  // Zerar primeiro é o que permite ENCOLHER: sem isso o scrollHeight nunca
  // diminui, e o campo só cresceria.
  element.style.height = 'auto';
  const desejada = Math.max(element.scrollHeight || 0, COMPOSER_MIN_HEIGHT);
  element.style.height = `${Math.min(desejada, COMPOSER_MAX_HEIGHT)}px`;
}

const AUDIO_MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🙂', '😉',
  '😊', '😍', '😘', '😎', '🤩', '🤗', '🤔', '😐',
  '😴', '😭', '😢', '😡', '👍', '👎', '👏', '🙏',
  '💪', '🤝', '👌', '✌️', '👋', '❤️', '🧡', '💚',
  '💙', '🔥', '⭐', '✅', '❌', '⚠️', '📌', '📎',
  '📞', '📱', '💬', '📷', '🎉', '🎁', '💰', '🧾',
  '🕐', '📅', '🚀', '🛠️', '🔧', '📡', '🌐', '🏠',
];

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function ComposerButton({ label, onClick, disabled, active, children, as = 'button', htmlFor }) {
  const className = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 ${
    active ? 'bg-white/10 text-chat-text' : 'text-chat-icon'
  } ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-white/[0.08]'}`;

  if (as === 'label') {
    return (
      <label htmlFor={htmlFor} title={label} aria-label={label} className={className}>
        {children}
      </label>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className={className}>
      {children}
    </button>
  );
}

function MessageInput({ conversationId, onSend, quickReplies = [], quickRepliesStatus = 'ready', replyingTo = null, onCancelReply, draftContent, draftKey }) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  // A microphone recording is a voice note; a file picked from disk is an attachment.
  const [fileIsRecording, setFileIsRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showingQuickReplies, setShowingQuickReplies] = useState(false);
  const [showingEmojis, setShowingEmojis] = useState(false);
  const fileInputRef = useRef(null);
  const textInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const popoverRef = useRef(null);
  // O rascunho de texto de cada conversa. O componente não remonta ao trocar de
  // conversa — só muda a prop —, então sem isto o que ficou escrito para um
  // cliente aparecia na conversa do próximo, e enviar mandava para a pessoa
  // errada (relatado pelas atendentes em 2026-09-17).
  // O botão Enviar tem `disabled={sending}`, mas o Enter do teclado chama
  // `submit()` direto e não passa por ele. Como o campo só é limpo depois do
  // await, dois Enters numa rede lenta mandavam a mesma mensagem duas vezes
  // para o cliente. O ref tranca na hora; o estado `sending` sozinho depende de
  // um novo render para valer.
  const sendingRef = useRef(false);
  const contentRef = useRef('');
  const draftsRef = useRef(new Map());
  const currentConversationRef = useRef(conversationId);

  useEffect(() => {
    // Carrega o texto de uma sugestão da IA que o atendente escolheu editar.
    // draftKey muda a cada "Editar" (mesmo que o texto seja repetido), então
    // só dispara quando há um pedido novo de edição, não a cada render.
    if (draftKey === undefined || draftKey === null) return;
    setContent(draftContent || '');
    if (textInputRef.current) textInputRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!showingQuickReplies && !showingEmojis) return undefined;
    function onPointerDown(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setShowingQuickReplies(false);
        setShowingEmojis(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setShowingQuickReplies(false);
        setShowingEmojis(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showingQuickReplies, showingEmojis]);

  // Miniatura do anexo quando ele é imagem — vale para a colada e para a
  // escolhida no botão. A URL é revogada ao trocar ou limpar: sem isso cada
  // colagem deixa um blob preso na memória do navegador.
  useEffect(() => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    contentRef.current = content;
    fitComposerHeight(textInputRef.current);
  }, [content]);

  useEffect(() => {
    const anterior = currentConversationRef.current;
    if (anterior === conversationId) return;
    if (anterior !== undefined && anterior !== null) {
      draftsRef.current.set(anterior, contentRef.current);
    }
    currentConversationRef.current = conversationId;
    setContent(draftsRef.current.get(conversationId) || '');
    // Anexo e gravação NUNCA atravessam a troca, nem voltam depois: é o que
    // mais arrisca ir para o cliente errado, e um áudio gravado pela metade não
    // tem valor guardado. Uma gravação em andamento é encerrada e descartada.
    if (mediaRecorderRef.current && recording) {
      stopRecordingAndDiscard();
    }
    setFile(null);
    setFileIsRecording(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  function clearAttachment() {
    setFile(null);
    setFileIsRecording(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  // Colar print direto no chat. Vira anexo, nunca envia sozinho: um Ctrl+V sem
  // querer não pode disparar imagem para o cliente. Só intercepta quando há
  // imagem na área de transferência — colar texto continua normal.
  function handlePaste(event) {
    const items = event.clipboardData ? Array.from(event.clipboardData.items || []) : [];
    const imagem = items.find((item) => item.type && item.type.startsWith('image/'));
    if (!imagem) return;
    const arquivo = imagem.getAsFile();
    if (!arquivo) return;
    event.preventDefault();
    // A área de transferência não dá um nome útil ao arquivo: o horário aqui é
    // o que diferencia um print do outro na lista de mídias do cliente.
    const extensao = (arquivo.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const nome = `imagem-colada-${Date.now()}.${extensao}`;
    setFile(new File([arquivo], nome, { type: arquivo.type }));
    setFileIsRecording(false);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        setFile(new File([blob], 'gravacao.webm', { type: blob.type }));
        setFileIsRecording(true);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Não foi possível acessar o microfone');
    }
  }

  // O stop normal guarda o áudio como anexo. Este descarta: a gravação é da
  // conversa que acabou de sair da tela, e guardá-la seria exatamente o bug que
  // estamos corrigindo. As trilhas do microfone são encerradas do mesmo jeito.
  function stopRecordingAndDiscard() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.onstop = () => {
        if (recorder.stream) recorder.stream.getTracks().forEach((track) => track.stop());
      };
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
    setRecordingSeconds(0);
  }

  function stopRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  function appendEmoji(emoji) {
    setContent((prev) => prev + emoji);
    if (textInputRef.current) textInputRef.current.focus();
  }

  async function submit() {
    if (!content.trim() && !file) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(content, file, replyingTo ? replyingTo.id : null, fileIsRecording);
      draftsRef.current.delete(conversationId);
      setContent('');
      clearAttachment();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao enviar mensagem');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await submit();
  }

  // Enter envia (como no restante do app); Shift+Enter quebra linha — necessário
  // agora que o campo é multi-linha, para caber uma sugestão da IA com parágrafos.
  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const canSend = Boolean(content.trim() || file);

  return (
    <div className="chat-workspace-composer shrink-0 font-wa">
      {replyingTo && (
        <div className="px-3 pt-2 md:px-5">
          <div className="flex items-stretch overflow-hidden rounded-2xl bg-white/[0.10]">
            <span className="w-[4px] shrink-0 bg-chat-copper" />
            <div className="min-w-0 flex-1 px-3 py-1.5">
              <p className="text-[12.8px] font-medium leading-[18px] text-chat-copper">Respondendo</p>
              <p className="truncate text-[13px] leading-[18px] text-chat-muted">{replyingTo.content}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancelar resposta"
              title="Cancelar resposta"
              className="flex w-11 shrink-0 items-center justify-center text-[18px] leading-none text-chat-icon hover:bg-white/[0.06]"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {!recording && file && fileIsRecording && (
        <RecordingPreview file={file} seconds={recordingSeconds} sending={sending}
          onRemove={clearAttachment} onRecordAgain={startRecording} onSend={submit} />
      )}
      {!recording && file && !fileIsRecording && (
        <div className="px-3 pt-2 md:px-5">
          <p className="flex items-center gap-2 rounded-2xl bg-white/[0.10] px-3 py-2 text-[13px] text-chat-muted">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Pré-visualização do anexo"
                className="h-10 w-10 shrink-0 rounded-[8px] border border-white/10 object-cover"
              />
            ) : (
              <span className="shrink-0 text-chat-copper">
                <IconAttach size={17} />
              </span>
            )}
            Anexo: {file.name === 'gravacao.webm' ? `gravação de áudio (${recordingSeconds}s)` : file.name}{' '}
            <button
              type="button"
              onClick={clearAttachment}
              className="ml-auto shrink-0 rounded px-2 py-0.5 text-[13px] font-medium text-chat-text hover:bg-white/10"
            >
              Remover
            </button>
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2.5 px-3 py-3 md:px-5">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            setFile(e.target.files[0] || null);
            setFileIsRecording(false);
          }}
          className="hidden"
          id="message-file-input"
          disabled={recording}
        />

        {recording ? (
          <>
            <ComposerButton label="Descartar gravação" onClick={stopRecording}>
              <IconTrash size={22} />
            </ComposerButton>
            <p className="flex h-[60px] flex-1 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.07] px-5 text-[15px] text-chat-text">
              <span aria-hidden="true" className="animate-wa-rec h-2.5 w-2.5 shrink-0 rounded-full bg-[#ea4335]" />
              Gravando… {recordingSeconds}s
            </p>
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Parar gravação"
              title="Parar gravação"
              className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-chat-cream text-chat-orange-ink transition-colors hover:brightness-95"
            >
              <IconStop size={20} />
            </button>
          </>
        ) : (
          <>
            <div
              ref={popoverRef}
              className="relative flex min-h-[60px] min-w-0 flex-1 items-end gap-3 rounded-[30px] border border-white/[0.06] bg-white/[0.07] py-2 pl-3 pr-1.5"
            >
              <ComposerButton label="Anexar arquivo" as="label" htmlFor="message-file-input">
                <IconAttach size={24} />
              </ComposerButton>
              <ComposerButton
                label="Respostas rápidas"
                active={showingQuickReplies}
                onClick={() => {
                  setShowingQuickReplies((prev) => !prev);
                  setShowingEmojis(false);
                }}
              >
                <IconQuickReply size={24} />
              </ComposerButton>
              <ComposerButton
                label="Emojis"
                active={showingEmojis}
                onClick={() => {
                  setShowingEmojis((prev) => !prev);
                  setShowingQuickReplies(false);
                }}
              >
                <IconEmoji size={24} />
              </ComposerButton>

              <textarea
                ref={textInputRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={handlePaste}
                placeholder="Digite uma mensagem..."
                rows={1}
                style={{ minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT }}
                className="min-w-0 flex-1 resize-none overflow-y-auto rounded-[24px] border border-white/[0.10] bg-white/[0.03] px-[18px] py-[13px] text-[15px] leading-[21px] text-chat-text outline-none placeholder:text-chat-faint focus:border-white/25"
              />

              {showingEmojis && (
                <div className="dialog-emoji-picker animate-wa-pop absolute bottom-full left-0 z-20 mb-2 w-[19rem] max-w-[92vw] rounded-2xl border border-white/10 bg-[#30383d]/95 p-2 shadow-[0_20px_50px_-25px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                  <p className="dialog-popover-heading">Emojis</p>
                  <div className="grid grid-cols-8 gap-1">
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => appendEmoji(emoji)}
                        className="rounded-md py-1 text-[20px] leading-none transition-colors hover:bg-white/10"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showingQuickReplies && (
                <div className="dialog-quick-replies animate-wa-pop chat-scroll absolute bottom-full left-0 z-20 mb-2 max-h-72 w-72 max-w-[92vw] overflow-y-auto rounded-2xl border border-white/10 bg-[#30383d]/95 py-1.5 shadow-[0_20px_50px_-25px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                  <p className="dialog-popover-heading">Respostas rápidas</p>
                  <AsyncState
                    status={quickRepliesStatus}
                    isEmpty={quickReplies.length === 0}
                    emptyMessage="Nenhuma resposta rápida cadastrada."
                    skeletonLines={2}
                  >
                    <ul>
                      {quickReplies.map((quickReply) => (
                        <li key={quickReply.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setContent(quickReply.content);
                              setShowingQuickReplies(false);
                              if (textInputRef.current) textInputRef.current.focus();
                            }}
                            className="block w-full truncate px-3.5 py-2.5 text-left text-[14.5px] text-chat-text transition-colors hover:bg-white/[0.06]"
                          >
                            <span className="block font-medium">{quickReply.title}</span>
                            <span className="dialog-quick-reply-preview">{quickReply.content}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </AsyncState>
                </div>
              )}
            </div>

            {file && fileIsRecording ? null : canSend ? (
              <button
                type="submit"
                disabled={sending}
                aria-label="Enviar"
                title="Enviar"
                className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-chat-cream text-chat-orange-ink transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 disabled:opacity-40"
              >
                <IconSend size={24} />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                aria-label="Gravar áudio"
                title="Gravar áudio"
                className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.08] text-chat-icon transition-colors hover:bg-white/[0.13] hover:text-chat-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70"
              >
                <IconMic size={24} />
              </button>
            )}
          </>
        )}
      </form>

      {error && (
        <p className="px-3 pb-2 text-[13px] text-[#ea4335] md:px-5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default MessageInput;
