import { useState, useRef, useEffect } from 'react';
import { IconEmoji, IconAttach, IconQuickReply, IconMic, IconSend, IconTrash, IconStop } from './icons/WaIcons';

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
  const className = `flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-wa-green ${
    active ? 'bg-black/[.07] text-wa-text' : 'text-wa-icon'
  } ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-black/[.06]'}`;

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

function MessageInput({ onSend, quickReplies = [], replyingTo = null, onCancelReply }) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  // A microphone recording is a voice note; a file picked from disk is an attachment.
  const [fileIsRecording, setFileIsRecording] = useState(false);
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

  function clearAttachment() {
    setFile(null);
    setFileIsRecording(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim() && !file) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content, file, replyingTo ? replyingTo.id : null, fileIsRecording);
      setContent('');
      clearAttachment();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }

  const canSend = Boolean(content.trim() || file);

  return (
    <div className="border-t border-white/50 bg-white/40 font-wa backdrop-blur-2xl">
      {replyingTo && (
        <div className="px-4 pt-2">
          <div className="flex items-stretch overflow-hidden rounded-t-[8px] bg-white">
            <span className="w-[4px] shrink-0 bg-wa-quote" />
            <div className="min-w-0 flex-1 px-3 py-1.5">
              <p className="text-[12.8px] font-medium leading-[18px] text-wa-quote">Respondendo</p>
              <p className="truncate text-[13px] leading-[18px] text-wa-muted">{replyingTo.content}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancelar resposta"
              title="Cancelar resposta"
              className="flex w-11 shrink-0 items-center justify-center text-[18px] leading-none text-wa-icon hover:bg-black/[.04]"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {!recording && file && (
        <div className="px-4 pt-2">
          <p className="flex items-center gap-2 rounded-[8px] bg-white px-3 py-2 text-[13px] text-wa-muted">
            <span className="shrink-0 text-wa-green">
              <IconAttach size={17} />
            </span>
            Anexo: {file.name === 'gravacao.webm' ? `gravação de áudio (${recordingSeconds}s)` : file.name}{' '}
            <button
              type="button"
              onClick={clearAttachment}
              className="ml-auto shrink-0 rounded px-2 py-0.5 text-[13px] font-medium text-wa-green hover:bg-wa-green/10"
            >
              Remover
            </button>
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-1.5 px-2 py-[7px] md:px-4">
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
            <p className="flex h-[42px] flex-1 items-center gap-2 rounded-full bg-white px-4 text-[14px] text-wa-text">
              <span aria-hidden="true" className="animate-wa-rec h-2.5 w-2.5 shrink-0 rounded-full bg-[#ea4335]" />
              Gravando… {recordingSeconds}s
            </p>
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Parar gravação"
              title="Parar gravação"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-wa-green text-white transition-colors hover:bg-wa-green-dark"
            >
              <IconStop size={18} />
            </button>
          </>
        ) : (
          <>
            <div ref={popoverRef} className="relative flex flex-1 items-end gap-1">
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
                <IconQuickReply size={22} />
              </ComposerButton>

              <div className="flex h-[42px] min-w-0 flex-1 items-center rounded-full bg-white pl-1 pr-1 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-wa-green/50">
                <button
                  type="button"
                  onClick={() => {
                    setShowingEmojis((prev) => !prev);
                    setShowingQuickReplies(false);
                  }}
                  aria-label="Emojis"
                  title="Emojis"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/[.05] ${
                    showingEmojis ? 'text-wa-green' : 'text-wa-icon'
                  }`}
                >
                  <IconEmoji size={24} />
                </button>
                <input
                  type="text"
                  ref={textInputRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Digite uma mensagem..."
                  className="h-full min-w-0 flex-1 bg-transparent px-1 text-[15px] text-wa-text outline-none placeholder:text-wa-muted"
                />
              </div>

              {showingEmojis && (
                <div className="animate-wa-pop absolute bottom-full left-0 z-20 mb-2 w-[19rem] max-w-[92vw] rounded-2xl border border-white/70 bg-white/90 p-2 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.45)] backdrop-blur-xl">
                  <div className="grid grid-cols-8 gap-1">
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => appendEmoji(emoji)}
                        className="rounded-md py-1 text-[20px] leading-none transition-colors hover:bg-wa-hover"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showingQuickReplies && (
                <div className="animate-wa-pop wa-scroll absolute bottom-full left-0 z-20 mb-2 max-h-72 w-72 max-w-[92vw] overflow-y-auto rounded-2xl border border-white/70 bg-white/90 py-1.5 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.45)] backdrop-blur-xl">
                  {quickReplies.length === 0 ? (
                    <p className="px-3 py-2 text-[13.5px] text-wa-muted">Nenhuma resposta cadastrada</p>
                  ) : (
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
                            className="block w-full truncate px-3.5 py-2.5 text-left text-[14.5px] text-wa-text transition-colors hover:bg-wa-hover"
                          >
                            {quickReply.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {canSend ? (
              <button
                type="submit"
                disabled={sending}
                aria-label="Enviar"
                title="Enviar"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-black/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-wa-green disabled:opacity-40"
              >
                <IconSend size={24} />
              </button>
            ) : (
              <ComposerButton label="Gravar áudio" onClick={startRecording}>
                <IconMic size={24} />
              </ComposerButton>
            )}
          </>
        )}
      </form>

      {error && (
        <p className="px-4 pb-2 text-[13px] text-[#ea4335]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default MessageInput;
