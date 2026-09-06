import { useState, useRef } from 'react';

const AUDIO_MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function MessageInput({ onSend, quickReplies = [] }) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showingQuickReplies, setShowingQuickReplies] = useState(false);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  function clearAttachment() {
    setFile(null);
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

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim() && !file) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content, file);
      setContent('');
      clearAttachment();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="hidden"
          id="message-file-input"
          disabled={recording}
        />
        <label
          htmlFor="message-file-input"
          className={`rounded border border-gray-300 px-3 py-2 ${recording ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
          title="Anexar arquivo"
        >
          📎
        </label>
        {recording ? (
          <button
            type="button"
            onClick={stopRecording}
            title="Parar gravação"
            aria-label="Parar gravação"
            className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-600"
          >
            ⏹️
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            title="Gravar áudio"
            aria-label="Gravar áudio"
            className="rounded border border-gray-300 px-3 py-2"
          >
            🎤
          </button>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowingQuickReplies((prev) => !prev)}
            title="Respostas rápidas"
            aria-label="Respostas rápidas"
            className="rounded border border-gray-300 px-3 py-2"
            disabled={recording}
          >
            💬
          </button>
          {showingQuickReplies && (
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-64 overflow-y-auto rounded border border-gray-200 bg-white p-2 shadow">
              {quickReplies.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhuma resposta cadastrada</p>
              ) : (
                <ul className="space-y-1">
                  {quickReplies.map((quickReply) => (
                    <li key={quickReply.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setContent(quickReply.content);
                          setShowingQuickReplies(false);
                        }}
                        className="w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-50"
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
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Digite uma mensagem..."
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          disabled={recording}
        />
        <button type="submit" disabled={sending || recording} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
          Enviar
        </button>
      </div>
      {recording && <p className="mt-1 text-sm text-red-600">Gravando... {recordingSeconds}s</p>}
      {!recording && file && (
        <p className="mt-1 text-sm text-gray-600">
          Anexo: {file.name === 'gravacao.webm' ? `gravação de áudio (${recordingSeconds}s)` : file.name}{' '}
          <button type="button" onClick={clearAttachment} className="text-blue-600 underline">
            Remover
          </button>
        </p>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default MessageInput;
