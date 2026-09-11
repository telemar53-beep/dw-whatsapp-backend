import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { mediaUrl } from '../services/api';
import { IconPlay, IconPause, IconMic, IconDownload, IconPin } from './icons/WaIcons';

const BAR_COUNT = 38;
const SPEEDS = [1, 1.5, 2];

function waveformBars(seed = '') {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    bars.push(0.22 + (((hash >>> 16) % 1000) / 1000) * 0.78);
  }
  return bars;
}

function formatClock(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function fileExtension(filename) {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : '';
}

const DOC_COLORS = {
  PDF: '#d93025',
  DOC: '#2b579a',
  DOCX: '#2b579a',
  XLS: '#217346',
  XLSX: '#217346',
  CSV: '#217346',
  PPT: '#d24726',
  PPTX: '#d24726',
  ZIP: '#7d6b3e',
  RAR: '#7d6b3e',
};

function VoiceNote({ url, seed, outbound, avatar, dark }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const bars = useMemo(() => waveformBars(seed), [seed]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return undefined;
    const onTime = () => setCurrent(element.currentTime);
    const onMeta = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('loadedmetadata', onMeta);
    element.addEventListener('durationchange', onMeta);
    element.addEventListener('ended', onEnd);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('loadedmetadata', onMeta);
      element.removeEventListener('durationchange', onMeta);
      element.removeEventListener('ended', onEnd);
    };
  }, []);

  function togglePlay() {
    const element = audioRef.current;
    if (!element) return;
    if (element.paused) {
      const played = element.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
      setPlaying(true);
    } else {
      element.pause();
      setPlaying(false);
    }
  }

  function seekTo(ratio) {
    const element = audioRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = element.duration * ratio;
    setCurrent(element.currentTime);
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  const progress = duration > 0 ? Math.min(current / duration, 1) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);
  const trackColor = dark ? 'rgba(255,255,255,0.22)' : outbound ? '#a9cec7' : '#c7d3d0';
  const playedColor = dark ? '#efe7ce' : '#0d9488';

  if (dark) {
    return (
      <div className="pt-0.5">
        <audio ref={audioRef} src={url} preload="metadata" className="max-w-full hidden" />
        <div className="flex w-[min(17.5rem,62vw)] items-start gap-2">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
            title={playing ? 'Pausar' : 'Reproduzir'}
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chat-cream text-chat-orange-ink transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70"
          >
            {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
          </button>

          <button
            type="button"
            aria-label="Avançar no áudio"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              seekTo(Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1));
            }}
            className="relative mt-1 flex h-8 flex-1 items-center gap-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70"
          >
            {bars.map((height, index) => (
              <span
                key={index}
                className="w-[2px] shrink-0 rounded-full"
                style={{
                  height: `${Math.round(height * 22)}px`,
                  backgroundColor: index < playedBars ? playedColor : trackColor,
                }}
              />
            ))}
            <span
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-chat-cream shadow-[0_1px_3px_rgba(0,0,0,.4)]"
              style={{ left: `calc(${progress * 100}% - 6px)` }}
            />
          </button>

          <span className="relative mt-0.5 shrink-0">
            {avatar || (
              <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-white/10 text-chat-icon">
                <IconMic size={22} />
              </span>
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-chat-canvas ${
                progress > 0 ? 'text-chat-faint' : 'text-chat-cream'
              }`}
            >
              <IconMic size={13} />
            </span>
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-1 text-[11px] text-chat-faint">
          <span>{formatClock(current > 0 ? current : duration)}</span>
          {(playing || current > 0) && (
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Velocidade de reprodução: ${SPEEDS[speedIndex]}x`}
              className="rounded-full bg-white/10 px-1.5 py-[1px] text-[10px] font-medium text-chat-icon hover:bg-white/[0.16]"
            >
              {SPEEDS[speedIndex]}x
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-0.5">
      <audio ref={audioRef} src={url} preload="metadata" className="max-w-full hidden" />
      <div className="flex w-[min(17.5rem,62vw)] items-start gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
          title={playing ? 'Pausar' : 'Reproduzir'}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wa-green"
        >
          {playing ? <IconPause size={26} /> : <IconPlay size={26} />}
        </button>

        <button
          type="button"
          aria-label="Avançar no áudio"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            seekTo(Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1));
          }}
          className="relative mt-1 flex h-8 flex-1 items-center gap-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wa-green"
        >
          {bars.map((height, index) => (
            <span
              key={index}
              className="w-[2px] shrink-0 rounded-full"
              style={{
                height: `${Math.round(height * 22)}px`,
                backgroundColor: index < playedBars ? playedColor : trackColor,
              }}
            />
          ))}
          <span
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-wa-green shadow-[0_1px_2px_rgba(11,20,26,.25)]"
            style={{ left: `calc(${progress * 100}% - 6px)` }}
          />
        </button>

        <span className="relative mt-0.5 shrink-0">
          {avatar || (
            <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#dfe5e7] text-[#8696a0]">
              <IconMic size={22} />
            </span>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full ${
              progress > 0 ? 'text-wa-meta' : 'text-wa-green'
            }`}
          >
            <IconMic size={18} />
          </span>
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-1 text-[11px] text-wa-meta">
        <span>{formatClock(current > 0 ? current : duration)}</span>
        {(playing || current > 0) && (
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Velocidade de reprodução: ${SPEEDS[speedIndex]}x`}
            className="rounded-full bg-black/5 px-1.5 py-[1px] text-[10px] font-medium text-wa-icon hover:bg-black/10"
          >
            {SPEEDS[speedIndex]}x
          </button>
        )}
      </div>
    </div>
  );
}

function ImageBubble({ url, alt, hasCaption, dark }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir imagem em tela cheia"
        className={`block overflow-hidden rounded-[6px] focus-visible:outline focus-visible:outline-2 ${
          dark ? 'focus-visible:outline-white/70' : 'focus-visible:outline-wa-green'
        } ${hasCaption ? 'mb-1' : ''}`}
      >
        <img
          src={url}
          alt={alt || 'Imagem'}
          className="max-w-full rounded-[6px] object-cover transition-[filter] hover:brightness-[.97]"
          style={{ maxHeight: 340, maxWidth: 330, minWidth: 120 }}
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Visualizar imagem"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b141a]/95 p-4"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar imagem"
            className="absolute right-5 top-4 rounded-full p-2 text-2xl leading-none text-white/80 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
          <img src={url} alt={alt || 'Imagem'} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </>
  );
}

function DocumentCard({ url, filename, outbound, dark }) {
  const label = filename || 'Documento';
  const extension = fileExtension(filename) || 'ARQUIVO';
  const color = DOC_COLORS[extension] || '#667781';

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`flex w-[min(18rem,62vw)] items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors ${
        dark
          ? 'bg-white/[0.06] hover:bg-white/10'
          : outbound
            ? 'bg-wa-out-deep hover:bg-[#e6efec]'
            : 'bg-[#eef4f2] hover:bg-[#e6efec]'
      }`}
    >
      <span className="relative flex h-9 w-7 shrink-0 items-center justify-center">
        <svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">
          <path d="M2 2h16l8 8v24a2 2 0 01-2 2H2a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#fff" />
          <path d="M18 2l8 8h-8z" fill="#e3e8ea" />
          <rect x="0" y="18" width="28" height="12" rx="2" fill={color} />
        </svg>
        <span className="absolute bottom-[7px] left-0 w-full text-center text-[7px] font-bold tracking-tight text-white">
          {extension.slice(0, 4)}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] leading-tight ${dark ? 'text-chat-text' : 'text-wa-text'}`}>{label}</span>
        <span className={`mt-0.5 block text-[11px] uppercase tracking-wide ${dark ? 'text-chat-faint' : 'text-wa-meta'}`}>
          {extension}
        </span>
      </span>
      <span className={`shrink-0 opacity-70 ${dark ? 'text-chat-icon' : 'text-wa-icon'}`}>
        <IconDownload size={20} />
      </span>
    </a>
  );
}

function MessageAttachment({ message, avatar, dark = false }) {
  const { token } = useAuth();
  const outbound = message.direction === 'outbound';

  if (message.messageType === 'location') {
    const mapsUrl = `https://www.google.com/maps?q=${message.locationLatitude},${message.locationLongitude}`;
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer"
        className={`block w-[min(16rem,60vw)] overflow-hidden rounded-[12px] ${dark ? 'bg-white/[0.06]' : 'bg-[#e6e0d8]'}`}
      >
        <span className="relative flex h-28 items-center justify-center bg-[linear-gradient(135deg,#dfe7dc_0%,#cfdcd2_45%,#e6e1d6_100%)]">
          <span className="absolute inset-0 opacity-40 [background-image:linear-gradient(#b8c6bb_1px,transparent_1px),linear-gradient(90deg,#b8c6bb_1px,transparent_1px)] [background-size:26px_26px]" />
          <span className="relative text-[#ea4335] drop-shadow-sm">
            <IconPin size={38} />
          </span>
        </span>
        <span className={`flex items-center justify-between gap-2 px-3 py-2 text-[13px] ${dark ? 'text-chat-text' : 'text-wa-text'}`}>
          Ver localização no mapa
          <span className={`-rotate-90 opacity-70 ${dark ? 'text-chat-icon' : 'text-wa-icon'}`}>
            <IconDownload size={16} />
          </span>
        </span>
      </a>
    );
  }

  if (!message.mediaPath) return null;

  const url = mediaUrl(message.id, token);

  if (message.messageType === 'image') {
    return (
      <ImageBubble url={url} alt={message.mediaFilename || 'Imagem'} hasCaption={Boolean(message.content)} dark={dark} />
    );
  }

  if (message.messageType === 'sticker') {
    return (
      <img
        src={url}
        alt={message.mediaFilename || 'Figurinha'}
        className="max-w-full"
        style={{ width: 128, height: 128, objectFit: 'contain' }}
      />
    );
  }

  if (message.messageType === 'audio') {
    return <VoiceNote url={url} seed={message.id || ''} outbound={outbound} avatar={avatar} dark={dark} />;
  }

  if (message.messageType === 'video') {
    return <video controls src={url} className="max-w-full rounded-[12px]" style={{ maxHeight: 340, minWidth: 200 }} />;
  }

  if (message.messageType === 'document') {
    return <DocumentCard url={url} filename={message.mediaFilename} outbound={outbound} dark={dark} />;
  }

  return null;
}

export default MessageAttachment;
