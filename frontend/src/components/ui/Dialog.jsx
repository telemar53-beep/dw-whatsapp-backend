import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { entrar, inscrever, posicaoDe, topoDaPilha, passoDeCamada } from './dialogStack';
import { IconClose } from '../icons/WaIcons';
import '../overlays.css';

// Base única de todo diálogo modal. Quem estiver lendo isto procurando onde
// mexer no visual de UMA tela: não é aqui. Aqui mora só o que precisa ser
// igual em todos — camada, foco, ESC, clique fora, rolagem.

const FOCAVEIS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Distância em px que separa um clique de um arrasto. Soltar o botão a 3px do
// ponto onde ele desceu é clique; a 40px foi alguém selecionando texto.
const TOLERANCIA_DE_ARRASTO = 6;

function focaveis(raiz) {
  if (!raiz) return [];
  return [...raiz.querySelectorAll(FOCAVEIS)].filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[inert]'),
  );
}

// Foco inicial: primeiro o que a tela marcou, depois o primeiro CAMPO — não o
// primeiro focável, que seria o "×" ou um item de lista qualquer — e, na falta
// de campo, o próprio diálogo, para o leitor de tela anunciar o título antes de
// o Tab começar a andar. Ação destrutiva nunca recebe foco inicial.
function alvoDoFocoInicial(painel) {
  const marcado = painel.querySelector('[data-autofocus]');
  if (marcado) return marcado;

  const campos = [...painel.querySelectorAll('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')]
    .filter((campo) => !campo.hasAttribute('data-danger') && !campo.closest('[inert]'));
  const primeiro = campos[0];
  if (!primeiro) return painel;
  // Num grupo de rádio o foco pertence à opção marcada, não à primeira.
  if (primeiro.type === 'radio') {
    return campos.find((campo) => campo.type === 'radio' && campo.checked) || primeiro;
  }
  return primeiro;
}

// Para overlays que JA funcionam e nao devem ser reconstruidos — o
// visualizador de imagem, com zoom, pan, roda e teclado proprios. Eles entram
// na mesma pilha (camada e ESC do topo) sem herdar a moldura do Dialog.
// No instante em que o diálogo de cima desmonta, o de baixo AINDA tem `inert`:
// o React só tira o atributo no render seguinte, e focar dentro de uma subárvore
// inerte simplesmente não acontece — o foco cai no <body>. Isso só aparece no
// navegador (o jsdom ignora `inert` por completo), e foi exatamente o que a
// validação da pilha mostrou. Como este nível está prestes a virar o topo, tirar
// o atributo aqui é antecipar o que o render seguinte faria.
function destravarNivelDeBaixo(alvo) {
  const preso = alvo.closest && alvo.closest('[inert]');
  if (!preso) return;
  const topo = topoDaPilha();
  if (topo && topo.painel && preso.contains(topo.painel)) preso.removeAttribute('inert');
}

export function useDialogLayer(aberto, aoFechar, { fecharComEsc = true } = {}) {
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;

  const entrada = useMemo(
    () => ({ fechar: () => fecharRef.current && fecharRef.current(), fecharComEsc, painel: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  entrada.fecharComEsc = fecharComEsc;

  const [camada, setCamada] = useState(() => posicaoDe(entrada));

  useLayoutEffect(() => {
    if (!aberto) return undefined;
    const sair = entrar(entrada);
    setCamada(posicaoDe(entrada));
    const desinscrever = inscrever(() => setCamada(posicaoDe(entrada)));
    return () => {
      desinscrever();
      sair();
    };
  }, [aberto, entrada]);

  return {
    profundidade: camada.profundidade,
    topo: camada.topo,
    zIndex: `calc(var(--z-dialog) + ${camada.profundidade * passoDeCamada()})`,
  };
}

export function DialogBody({ className = '', children, ...rest }) {
  return (
    <div className={`dw-dialog-body wa-scroll ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function DialogFooter({ className = '', children, ...rest }) {
  return (
    <div className={`dw-dialog-footer ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Dialog({
  title,
  description,
  labelledBy,
  ariaLabel,
  describedBy,
  role = 'dialog',
  size = 'max-w-md',
  variant = 'standard',
  orientation = 'col',
  onClose,
  closeOnBackdrop = false,
  closeOnEsc = true,
  dismissible = true,
  initialFocus = 'auto',
  closeLabel = 'Fechar',
  className = '',
  children,
}) {
  const painelRef = useRef(null);
  const abridorRef = useRef(null);
  const descidaRef = useRef(null);
  const fecharRef = useRef(onClose);
  const id = useId();
  const tituloId = `${id}-titulo`;
  const descricaoId = `${id}-descricao`;

  fecharRef.current = onClose;

  // A entrada é estável por instância: é ela que identifica este diálogo na
  // pilha, e os callbacks leem sempre a versão atual pelas refs.
  const entrada = useMemo(
    () => ({
      fechar: () => fecharRef.current && fecharRef.current(),
      fecharComEsc: closeOnEsc,
      painel: null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  entrada.fecharComEsc = closeOnEsc;

  const [camada, setCamada] = useState(() => posicaoDe(entrada));

  useLayoutEffect(() => {
    entrada.painel = painelRef.current;
    const sair = entrar(entrada);
    // A inscrição tem de vir DEPOIS de entrar e ler a posição na sequência: o
    // aviso da própria entrada já passou, e sem esta leitura o diálogo ficaria
    // para sempre achando que é o nível 0.
    setCamada(posicaoDe(entrada));
    const desinscrever = inscrever(() => setCamada(posicaoDe(entrada)));
    return () => {
      desinscrever();
      sair();
    };
  }, [entrada]);

  // Foco: guarda quem abriu, entrega o foco ao diálogo e devolve na saída.
  useEffect(() => {
    const ativo = document.activeElement;
    abridorRef.current = ativo && typeof ativo.focus === 'function' ? ativo : null;
    const painel = painelRef.current;
    if (painel) {
      const alvo = initialFocus === 'dialog' ? painel : alvoDoFocoInicial(painel);
      if (alvo && typeof alvo.focus === 'function') alvo.focus();
    }

    return () => {
      const abridor = abridorRef.current;
      if (abridor && document.contains(abridor)) {
        destravarNivelDeBaixo(abridor);
        abridor.focus();
        return;
      }
      // Quem abriu sumiu junto (uma linha de lista que foi filtrada, por
      // exemplo): o foco volta para o diálogo que passou a ser o topo.
      const topo = topoDaPilha();
      if (topo && topo !== entrada && topo.painel && document.contains(topo.painel)) {
        destravarNivelDeBaixo(topo.painel);
        topo.painel.focus();
      }
    };
  }, [entrada]);

  function prenderTab(evento) {
    if (evento.key !== 'Tab') return;
    const painel = painelRef.current;
    const lista = focaveis(painel);
    if (lista.length === 0) {
      evento.preventDefault();
      painel.focus();
      return;
    }
    const primeiro = lista[0];
    const ultimo = lista[lista.length - 1];
    const ativo = document.activeElement;
    if (evento.shiftKey && (ativo === primeiro || ativo === painel)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && ativo === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  // Clique fora só conta quando o gesto INTEIRO aconteceu no fundo. Descer o
  // ponteiro dentro do diálogo — selecionando o texto de um campo, por exemplo —
  // e soltar fora não fecha nada. Era assim que se perdia formulário preenchido.
  function aoDescerNoFundo(evento) {
    if (evento.target !== evento.currentTarget || evento.button !== 0) {
      descidaRef.current = null;
      return;
    }
    descidaRef.current = { x: evento.clientX, y: evento.clientY, ponteiro: evento.pointerId };
  }

  function aoSubirNoFundo(evento) {
    const descida = descidaRef.current;
    descidaRef.current = null;
    if (!closeOnBackdrop || !descida) return;
    if (evento.target !== evento.currentTarget) return;
    if (evento.pointerId !== undefined && descida.ponteiro !== undefined && evento.pointerId !== descida.ponteiro) return;
    const andou = Math.hypot(evento.clientX - descida.x, evento.clientY - descida.y);
    if (andou > TOLERANCIA_DE_ARRASTO) return;
    const selecao = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (selecao && !selecao.isCollapsed) return;
    if (onClose) onClose();
  }

  const nomeado = labelledBy || (title ? tituloId : undefined);

  return createPortal(
    <div
      className={`chat-theme fixed inset-0 flex items-center justify-center bg-[var(--wa-overlay)] p-4 font-wa ${
        camada.profundidade === 0 ? 'backdrop-blur-[var(--wa-overlay-blur)]' : ''
      }`}
      style={{ zIndex: `calc(var(--z-dialog) + ${camada.profundidade * passoDeCamada()})` }}
      data-dialog-depth={camada.profundidade}
      inert={camada.topo ? undefined : ''}
      onPointerDown={aoDescerNoFundo}
      onPointerUp={aoSubirNoFundo}
    >
      <div
        ref={painelRef}
        role={role}
        data-dialog={variant}
        aria-modal="true"
        aria-labelledby={nomeado}
        aria-label={nomeado ? undefined : ariaLabel}
        aria-describedby={describedBy || (title && description ? descricaoId : undefined)}
        tabIndex={-1}
        onKeyDown={prenderTab}
        className={`dw-dialog animate-wa-pop relative flex w-full ${size} ${orientation === 'row' ? 'flex-row' : 'flex-col'} overflow-hidden rounded-[var(--wa-dialog-radius)] border border-[var(--wa-dialog-border)] bg-wa-panel shadow-[var(--wa-dialog-shadow)] backdrop-blur-[var(--wa-dialog-blur)] ${className}`}
      >
        {dismissible && (
          <button
            type="button"
            data-dialog-close=""
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="dw-dialog-close"
          >
            <IconClose size={16} />
          </button>
        )}
        {title && (
          <div className="dw-dialog-heading shrink-0 px-6 pb-2 pt-5">
            <h2 id={tituloId} className="text-[19px] leading-[26px] text-wa-text">
              {title}
            </h2>
            {description && (
              <p id={descricaoId} className="mt-1.5 text-[14px] leading-[20px] text-wa-muted">
                {description}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default Dialog;
