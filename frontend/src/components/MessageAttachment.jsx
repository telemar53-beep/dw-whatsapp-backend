import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { mediaUrl } from '../services/api';
import { receiptVerdict } from '../utils/receiptVerdict';
import { IconPlay, IconPause, IconMic, IconDownload, IconPin, IconAttach } from './icons/WaIcons';
import PixCardMessage from './PixCardMessage';
import { useDialogLayer, primeiroFocavel, prenderTabEm } from './ui/Dialog';
import { descreverErro } from '../utils/errorMessages';

// Tipos que guardam arquivo no disco — os únicos que a retenção pode esvaziar.
const MEDIA_TYPES_COM_ARQUIVO = ['image', 'video', 'audio', 'document', 'sticker'];

const BAR_COUNT = 38;
const SPEEDS = [1, 1.5, 2];

// Enter e Espaço num <button> disparam um clique SINTÉTICO: `detail` 0 e
// `clientX` 0. Como a posição na barra vinha de `clientX - rect.left`, a conta
// dava negativo, o clamp prendia em 0 e o áudio REBOBINAVA para o começo — pelo
// teclado, a única coisa que a barra de progresso fazia era voltar ao início.
// Sem coordenada não existe posição para onde ir, então o clique é ignorado.
function posicaoDoCliqueNaBarra(event) {
  if (event.detail === 0) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width) return null;
  return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
}

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
  const [unavailable, setUnavailable] = useState(false);
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
      if (played && typeof played.catch === 'function') played.catch(() => { setPlaying(false); setUnavailable(true); });
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
  const trackColor = dark ? (outbound ? 'rgba(255,237,223,0.55)' : 'rgba(224,233,236,0.48)') : outbound ? '#a9cec7' : '#c7d3d0';
  const playedColor = dark ? (outbound ? '#fff5ec' : '#f7a56f') : '#0d9488';

  if (unavailable) {
    return <div role="status" className={dark
      ? 'chat-voice-note inline-flex min-h-[52px] min-w-[172px] items-center gap-2 rounded-[12px] border border-white/[0.14] bg-black/[0.10] px-3 text-[12.5px] font-medium text-white'
      : 'inline-flex min-h-[58px] min-w-[172px] items-start gap-2 rounded-[8px] border border-wa-border bg-wa-hover px-3 pb-6 pt-2 text-[12.5px] font-medium text-wa-text'}><IconMic size={16} /> Áudio indisponível</div>;
  }

  if (dark) {
    return (
      <div className={`chat-voice-note ${outbound ? 'is-outbound' : 'is-inbound'}`}>
        <audio ref={audioRef} src={url} preload="metadata" onError={() => setUnavailable(true)} className="max-w-full hidden" />
        <div className="flex w-[min(19rem,72vw)] max-w-full min-w-0 items-center gap-[10px]">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
            title={playing ? 'Pausar' : 'Reproduzir'}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring ${outbound ? 'bg-[#fff0e2] text-[#573823] hover:bg-white' : 'bg-[#eef2f1] text-[#344047] hover:bg-white'}`}
          >
            {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
          </button>

          <button
            type="button"
            aria-label="Avançar no áudio"
            onClick={(event) => {
              const posicao = posicaoDoCliqueNaBarra(event);
              if (posicao !== null) seekTo(posicao);
            }}
            className="relative flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          >
            {bars.map((height, index) => (
              <span
                key={index}
                className="min-w-0 flex-1 rounded-full"
                style={{
                  height: `${Math.round(height * 22)}px`,
                  backgroundColor: index < playedBars ? playedColor : trackColor,
                }}
              />
            ))}
            {progress > 0 && (
              <span
                className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.3)]"
                style={{ left: `calc(${progress * 100}% - 6px)` }}
              />
            )}
          </button>

          <span className="relative shrink-0">
            {avatar || (
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/[0.22] text-white/85">
                <IconMic size={20} />
              </span>
            )}
            {avatar && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-chat-canvas ${
                  progress > 0 ? 'text-chat-faint' : 'text-chat-orange'
                }`}
              >
                <IconMic size={13} />
              </span>
            )}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 pl-[50px] text-[11px] leading-[16px] tabular-nums text-white/70">
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
      <audio ref={audioRef} src={url} preload="metadata" onError={() => setUnavailable(true)} className="max-w-full hidden" />
      <div className="flex w-[min(17.5rem,62vw)] items-start gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
          title={playing ? 'Pausar' : 'Reproduzir'}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
        >
          {playing ? <IconPause size={26} /> : <IconPlay size={26} />}
        </button>

        <button
          type="button"
          aria-label="Avançar no áudio"
          onClick={(event) => {
            const posicao = posicaoDoCliqueNaBarra(event);
            if (posicao !== null) seekTo(posicao);
          }}
          className="relative mt-1 flex h-8 flex-1 items-center gap-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
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
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-accent shadow-[0_1px_2px_rgba(11,20,26,.25)]"
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
              progress > 0 ? 'text-wa-meta' : 'text-accent'
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

// Comprovante de banco e print de erro chegam altos e estreitos. O visualizador
// encolhia tudo para caber na tela, e a atendente precisava baixar o arquivo só
// para conseguir ler. Daí o zoom — e o arrasto junto, porque ampliar um
// comprovante longo sem poder navegar deixa a pessoa presa no meio dele.
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

function clampZoom(value) {
  return Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
}

function ImageBubble({ url, alt, filename, hasCaption, dark }) {
  const [open, setOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const draggedRef = useRef(false);

  function resetView() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function closeViewer() {
    setOpen(false);
    resetView();
  }

  // So a camada e o ESC vem da base. Zoom, pan, roda, duplo clique e a guarda
  // de arrasto continuam exatamente como estavam.
  const camadaDoVisualizador = useDialogLayer(open, closeViewer);

  // O visualizador se anunciava `aria-modal` mas vivia DENTRO da bolha da
  // mensagem, sem portal: a promessa de modal era falsa para quem usa leitor
  // de tela. E o foco nunca entrava — abria e continuava na miniatura, atras
  // do overlay, com o Tab passeando pela conversa por baixo. Aqui ele e modal
  // de verdade, e portanto merece trap.
  const visorRef = useRef(null);
  const abridorRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    abridorRef.current = document.activeElement;
    const alvo = primeiroFocavel(visorRef.current) || visorRef.current;
    if (alvo) alvo.focus();
    return () => {
      const anterior = abridorRef.current;
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, [open]);

  // Sempre a partir do valor atual: zoom e offset andam juntos, e voltar ao
  // ajuste tem que recentralizar, senão a imagem some para fora da tela.
  function applyZoom(next) {
    const alvo = clampZoom(next);
    setZoom(alvo);
    if (alvo === ZOOM_MIN) setOffset({ x: 0, y: 0 });
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      // ESC nao e tratado aqui: quem decide e a pilha de dialogos, e so o
      // nivel do topo responde. Zoom e reenquadramento continuam locais.
      if (event.key === '+' || event.key === '=') applyZoom(zoom + ZOOM_STEP);
      if (event.key === '-') applyZoom(zoom - ZOOM_STEP);
      if (event.key === '0') resetView();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, zoom]);

  // O arrasto escuta na janela: o ponteiro sai da imagem no meio do movimento,
  // e sem isso a imagem "gruda" quando o mouse passa da borda.
  useEffect(() => {
    if (!open) return undefined;
    function onMove(event) {
      if (!dragRef.current) return;
      draggedRef.current = true;
      setOffset({
        x: dragRef.current.offsetX + (event.clientX - dragRef.current.startX),
        y: dragRef.current.offsetY + (event.clientY - dragRef.current.startY),
      });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [open]);

  return (
    <>
      {failedUrl === url ? (
        <div role="img" aria-label="Imagem indisponível" className={`flex min-h-[88px] min-w-[160px] items-center gap-2 rounded-[8px] border px-3 text-[12.5px] ${dark ? 'border-white/[0.15] bg-white/[0.08] text-chat-orange' : 'border-wa-border bg-wa-hover text-wa-muted'} ${hasCaption ? 'mb-1' : ''}`}>
          <IconAttach size={17} />
          Imagem indisponível
        </div>
      ) : <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir imagem em tela cheia"
        className={`block overflow-hidden rounded-[6px] focus-visible:outline focus-visible:outline-2 ${
          dark ? 'focus-visible:outline-focus-ring' : 'focus-visible:outline-focus-ring'
        } ${hasCaption ? 'mb-1' : ''}`}
      >
        <img
          src={url}
          alt={alt || 'Imagem'}
          onError={() => { setFailedUrl(url); setOpen(false); }}
          className="max-w-full rounded-[6px] object-contain transition-[filter] hover:brightness-[.97]"
          style={{ maxHeight: 340, maxWidth: 330, minWidth: 120 }}
        />
      </button>}
      {open && failedUrl !== url && createPortal(
        <div
          ref={visorRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Visualizar imagem"
          onKeyDown={(event) => prenderTabEm(visorRef.current, event)}
          onClick={() => {
            // Soltar o mouse fora da imagem depois de arrastar não pode fechar:
            // seria fechar sem querer no meio da navegação.
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            closeViewer();
          }}
          onWheel={(event) => applyZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))}
          style={{ zIndex: camadaDoVisualizador.zIndex }}
          className="chat-theme dialog-image-viewer fixed inset-0 flex items-center justify-center overflow-hidden bg-[#0b141a]/95 p-4"
        >
          <button
            type="button"
            onClick={closeViewer}
            aria-label="Fechar imagem"
            className="absolute right-5 top-4 z-10 rounded-full p-2 text-2xl leading-none text-white/80 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>

          <img
            src={url}
            alt={alt || 'Imagem'}
            onError={() => { setFailedUrl(url); setOpen(false); }}
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={() => (zoom > ZOOM_MIN ? resetView() : applyZoom(2))}
            onMouseDown={(event) => {
              if (zoom <= ZOOM_MIN) return;
              event.preventDefault();
              draggedRef.current = false;
              dragRef.current = { startX: event.clientX, startY: event.clientY, offsetX: offset.x, offsetY: offset.y };
            }}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              cursor: zoom > ZOOM_MIN ? 'grab' : 'zoom-in',
            }}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-75"
          />

          <div
            onClick={(event) => event.stopPropagation()}
            /* Sem `flex-wrap`, dentro de um pai `overflow-hidden`, abaixo de
               ~320px "Ajustar" e "Baixar" ficavam fora da vista e sem nenhuma
               forma de alcancar. Agora a barra quebra em duas linhas. */
            className="dialog-image-zoom absolute bottom-5 left-1/2 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-[18px] border border-white/10 bg-black/70 px-2 py-1.5 backdrop-blur"
          >
            <ViewerButton label="Diminuir zoom" onClick={() => applyZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
              −
            </ViewerButton>
            <span className="min-w-[3.5rem] text-center text-[13px] tabular-nums text-white/90">
              {Math.round(zoom * 100)}%
            </span>
            <ViewerButton label="Aumentar zoom" onClick={() => applyZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
              +
            </ViewerButton>
            <button
              type="button"
              onClick={resetView}
              className="ml-1 rounded-full px-3 py-1 text-[13px] text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Ajustar
            </button>
            <a
              href={url}
              download={filename || 'imagem'}
              onClick={(event) => event.stopPropagation()}
              className="rounded-full px-3 py-1 text-[13px] text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Baixar
            </a>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function ViewerButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-[18px] leading-none text-white/85 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// O video era o unico anexo sem acabamento nenhum:
//
//   <video controls src={url} className="max-w-full rounded-[12px]" ... />
//
// Player nativo solto no meio de uma timeline onde o audio tem tratamento
// proprio, sem nome do arquivo e — o que mais pesa — sem estado de
// indisponivel: video apagado pela retencao de 12 meses virava um quadro preto
// quebrado, enquanto o audio e a imagem ja diziam que o arquivo nao existe
// mais.
//
// Os CONTROLES continuam sendo os nativos, de proposito: sao a opcao mais
// robusta (tela cheia, velocidade, legenda, teclado, picture-in-picture) e
// reescreve-los seria trocar robustez por enfeite. O que passa a ser nosso e a
// moldura em volta.
//
// NAO mostra tamanho do arquivo: a tabela `messages` guarda media_path,
// media_mime_type e media_filename — tamanho nao existe, e inventar seria pior
// que omitir.
function VideoCard({ url, filename, outbound, dark }) {
  const [indisponivel, setIndisponivel] = useState(false);

  const moldura = dark
    ? 'border-white/[0.14] bg-black/[0.16]'
    : outbound
      ? 'border-wa-border bg-wa-out-deep'
      : 'border-wa-border bg-[#eef4f2]';

  if (indisponivel) {
    return (
      <div
        role="status"
        className={`flex min-h-[88px] w-[min(20rem,68vw)] items-center gap-2 rounded-[12px] border px-3 text-[12.5px] ${moldura} ${dark ? 'text-chat-muted' : 'text-wa-meta'}`}
      >
        <IconAttach size={17} />
        <span className="min-w-0">
          Vídeo indisponível
          {filename && <span className="mt-0.5 block truncate text-[11px] opacity-80">{filename}</span>}
        </span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-[12px] border ${moldura}`}>
      <video
        controls
        preload="metadata"
        src={url}
        onError={() => setIndisponivel(true)}
        className="block w-[min(20rem,68vw)] max-w-full bg-black"
        style={{ maxHeight: 340 }}
      />
      {filename && (
        <p className={`truncate px-3 py-1.5 text-[11.5px] ${dark ? 'text-chat-muted' : 'text-wa-meta'}`} title={filename}>
          {filename}
        </p>
      )}
    </div>
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

function TranscriptionBlock({ message, dark }) {
  const status = message.transcriptionStatus;
  if (!status) return null;

  const base = 'rounded-xl px-3 py-2 text-sm';
  const muted = dark ? 'text-wa-muted' : 'text-gray-500';

  if (status === 'pending' || status === 'processing') {
    return <p className={`${base} ${muted} italic`}>Transcrevendo…</p>;
  }
  // 'skipped' cobre mais de um motivo (duração, tamanho, formato não suportado),
  // por isso a frase é única e o detalhe técnico fica só no banco — o atendente
  // precisa saber que não há texto, não por que o modelo recusou.
  if (status === 'failed' || status === 'skipped') {
    return <p className={`${base} ${muted}`}>Não foi possível transcrever este áudio.</p>;
  }
  return (
    <div className={`${base} ${dark ? 'bg-wa-field' : 'bg-gray-100'}`}>
      <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${muted}`}>Transcrição por IA</p>
      <p className="whitespace-pre-wrap">{message.transcription}</p>
    </div>
  );
}

// O atendente pede a mesma análise que a triagem já fazia, sobre a imagem que
// ele escolheu. A conferência acontece no servidor, em código — aqui é só o
// pedido e a leitura do veredito.
function ReceiptAnalysis({ messageId, onAnalyze }) {
  const [state, setState] = useState('idle');
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState(null);

  async function analisar() {
    setState('loading');
    setError(null);
    try {
      setVerdict(receiptVerdict(await onAnalyze(messageId)));
      setState('done');
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível analisar o comprovante.'));
      setState('idle');
    }
  }

  const TONES = {
    ok: 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text',
    warn: 'border-wa-warn-text/30 bg-wa-warn-bg text-wa-warn-text',
    error: 'border-wa-error-text/30 bg-wa-error-bg text-wa-error-text',
  };

  return (
    <div className="mt-1.5">
      {state !== 'done' && (
        <button
          type="button"
          onClick={analisar}
          disabled={state === 'loading'}
          className="rounded-[10px] border border-white/15 bg-white/[0.08] px-2.5 py-1 text-[12.5px] font-medium text-chat-text transition hover:bg-white/[0.16] disabled:opacity-50"
        >
          {state === 'loading' ? 'Analisando…' : 'Analisar comprovante'}
        </button>
      )}
      {error && <p className="mt-1 text-[12.5px] text-wa-error-text">{error}</p>}
      {verdict && (
        <div className={`mt-1 rounded-[10px] border px-2.5 py-1.5 text-[12.5px] ${TONES[verdict.tone]}`}>
          <p className="font-semibold">{verdict.title}</p>
          {verdict.details.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 opacity-90">
              {verdict.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MessageAttachment({ message, avatar, dark = false, onAnalyzeReceipt }) {
  const { token } = useAuth();
  const outbound = message.direction === 'outbound';

  if (message.messageType === 'pix') {
    return <PixCardMessage message={message} />;
  }

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

  // Mídia sem arquivo só acontece por um motivo: a retenção apagou o arquivo
  // depois de 12 meses e manteve a mensagem. Sem este aviso a bolha sumiria sem
  // explicação e o histórico ficaria com buracos.
  if (!message.mediaPath) {
    if (!MEDIA_TYPES_COM_ARQUIVO.includes(message.messageType)) return null;
    return (
      <p className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[13px] italic text-chat-muted">
        <IconAttach size={15} />
        Arquivo removido (mais de 12 meses)
      </p>
    );
  }

  const url = mediaUrl(message.id, token);

  if (message.messageType === 'image') {
    return (
      <>
        <ImageBubble
          url={url}
          alt={message.mediaFilename || 'Imagem'}
          filename={message.mediaFilename}
          hasCaption={Boolean(message.content)}
          dark={dark}
        />
        {/* Comprovante é o que o CLIENTE manda: analisar o que nós enviamos não
            faz sentido e só poluiria a conversa. */}
        {onAnalyzeReceipt && !outbound && (
          <ReceiptAnalysis messageId={message.id} onAnalyze={onAnalyzeReceipt} />
        )}
      </>
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
    return (
      <div className="flex flex-col gap-1.5">
        <VoiceNote url={url} seed={message.id || ''} outbound={outbound} avatar={avatar} dark={dark} />
        <TranscriptionBlock message={message} dark={dark} />
      </div>
    );
  }

  if (message.messageType === 'video') {
    return <VideoCard url={url} filename={message.mediaFilename} outbound={outbound} dark={dark} />;
  }

  if (message.messageType === 'document') {
    return <DocumentCard url={url} filename={message.mediaFilename} outbound={outbound} dark={dark} />;
  }

  return null;
}

export default MessageAttachment;
