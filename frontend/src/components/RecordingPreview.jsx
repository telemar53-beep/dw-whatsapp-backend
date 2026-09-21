import { useEffect, useRef, useState } from 'react';
import { IconPlay, IconPause, IconTrash, IconRefresh, IconSend } from './icons/WaIcons';
import './recording-preview.css';

function clock(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export default function RecordingPreview({ file, seconds, sending, onRemove, onRecordAgain, onSend }) {
  const audioRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(seconds);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const localUrl = URL.createObjectURL(file);
    setUrl(localUrl);
    setPosition(0);
    setDuration(seconds);
    setPlaying(false);
    setEnded(false);
    setError(false);
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      URL.revokeObjectURL(localUrl);
    };
  }, [file, seconds]);

  function readDuration() {
    const value = audioRef.current?.duration;
    if (Number.isFinite(value) && value > 0) setDuration(value);
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) return audio.pause();
    if (audio.ended) audio.currentTime = 0;
    setError(false);
    try { await audio.play(); } catch { setError(true); }
  }

  return (
    <section className="recording-preview" aria-label="Prévia da gravação de áudio">
      <audio ref={audioRef} src={url || undefined} preload="metadata"
        onLoadedMetadata={readDuration} onDurationChange={readDuration}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); setEnded(false); }} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setEnded(true); }} onError={() => setError(true)} />
      <div className="recording-preview-label" role="status">
        Gravação de áudio · {error ? 'Não foi possível ouvir. Tente novamente.' : sending ? 'Enviando…' : playing ? 'Reproduzindo' : ended ? 'Reprodução concluída' : position > 0 ? 'Pausado' : 'Pronta para revisar'}
      </div>
      <button type="button" className="recording-preview-play" onClick={toggle} disabled={!url || sending}
        aria-label={playing ? 'Pausar prévia' : 'Ouvir prévia'} title={playing ? 'Pausar prévia' : 'Ouvir prévia'}>
        {playing ? <IconPause size={19} /> : <IconPlay size={19} />}
      </button>
      <div className="recording-preview-progress">
        <input type="range" aria-label="Posição do áudio" min="0" max={duration || 1} step="0.1"
          value={Math.min(position, duration || 1)} disabled={sending || !duration}
          style={{ '--progress': `${duration ? Math.min(100, position / duration * 100) : 0}%` }}
          onChange={(event) => {
            audioRef.current.currentTime = Number(event.target.value);
            setPosition(Number(event.target.value));
            setEnded(false);
          }} />
        <span className="recording-preview-time">{clock(position)} / {clock(duration)}</span>
      </div>
      <div className="recording-preview-actions">
        <button type="button" disabled={sending} onClick={onRemove} aria-label="Remover gravação" title="Remover gravação"><IconTrash size={17} /></button>
        <button type="button" disabled={sending} onClick={onRecordAgain} title="Gravar novamente"><IconRefresh size={17} /><span>Gravar novamente</span></button>
        <button type="button" className="recording-preview-send" disabled={sending} onClick={() => { audioRef.current?.pause(); onSend(); }} title="Enviar áudio"><IconSend size={17} /><span>Enviar</span></button>
      </div>
    </section>
  );
}
