import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IconMore } from '../icons/WaIcons';

// Base de tabela de Configurações.
//
// As mesmas constantes (`CELL`, `HEAD`, `MENU_ITEM`, `ICON_BTN`) e o mesmo
// componente de menu de linha estavam copiados em cinco arquivos, e a aparência
// de `table`, `th` e `td` vinha de uma regra global da folha. Aqui a densidade,
// o cabeçalho, o hover, o vazio e o menu de ações ficam num lugar só.
//
// O que NÃO fica aqui, de propósito: as colunas e as larguras. Cada cadastro
// tem o seu conteúdo, e uma tabela rígida universal seria o oposto do que a
// área precisa.

export const CELULA = 'dw-table-cell';
export const CABECALHO = 'dw-table-head';
export const ITEM_DE_MENU = 'dw-menu-item';

export function DataTable({ label, className = '', children }) {
  return (
    <div className="dw-table-scroll chat-scroll">
      <table aria-label={label} className={`dw-table ${className}`}>
        {children}
      </table>
    </div>
  );
}

// Folga entre o gatilho e o menu, e a margem mínima até a borda da tela.
const FOLGA = 4;
const MARGEM = 8;

// O menu de ações da linha mora num portal do `body`, não dentro da `<tr>`.
//
// Como `absolute` dentro da linha, ele era recortado na ÚLTIMA linha de toda
// tabela: a cadeia `.settings-register-list{overflow:hidden}` ->
// `.dw-table-scroll{overflow:auto}` -> `section.overflow-clip` corta tudo
// abaixo da última linha, e os dois itens ficavam inalcançáveis ao clique
// (medido: `elementFromPoint` devolvia o corpo da página, não o botão).
// `z-index` não resolve isso — recorte não é camada.
//
// A saída é a mesma que a `DicaFlutuante` já usa no rail: sair do ancestral
// que recorta e posicionar por coordenada de tela a partir do retângulo do
// gatilho. E, cabendo ou não abaixo, o menu VIRA para cima perto da borda
// inferior em vez de vazar.
export function RowMenu({ label, children }) {
  const [caixa, setCaixa] = useState(null);
  const gatilho = useRef(null);
  const painel = useRef(null);
  const aberto = caixa !== null;

  const fechar = useCallback((devolverFoco = false) => {
    setCaixa(null);
    // Só o ESC devolve o foco. Ao ativar um item, quem manda no foco é a ação
    // do item (quase sempre um diálogo), e disputar isso com ela piscaria.
    if (devolverFoco) gatilho.current?.focus();
  }, []);

  function abrir() {
    const r = gatilho.current.getBoundingClientRect();
    // `right` ancorado na direita do gatilho preserva o alinhamento que o
    // `right:0` do absolute dava.
    setCaixa({ right: Math.round(window.innerWidth - r.right), top: Math.round(r.bottom + FOLGA) });
  }

  // A altura real só existe depois de montar, então a decisão de virar para
  // cima é tomada aqui. `useLayoutEffect` corre antes da pintura: não pisca.
  useLayoutEffect(() => {
    if (!caixa || caixa.top === undefined) return;
    if (!painel.current || !gatilho.current) return;
    const altura = painel.current.getBoundingClientRect().height;
    if (caixa.top + altura <= window.innerHeight - MARGEM) return;
    const r = gatilho.current.getBoundingClientRect();
    setCaixa({ right: caixa.right, bottom: Math.round(window.innerHeight - r.top + FOLGA) });
  }, [caixa]);

  useEffect(() => {
    if (!aberto) return undefined;
    function onDown(event) {
      // O gatilho alterna sozinho; e um clique num item precisa chegar ao
      // `onClick` dele — fechar no mousedown desmontaria o item antes disso.
      if (gatilho.current?.contains(event.target)) return;
      if (painel.current?.contains(event.target)) return;
      fechar();
    }
    function onKey(event) {
      if (event.key !== 'Escape') return;
      // Só este menu some: a tecla não pode subir e fechar o diálogo de trás.
      event.stopPropagation();
      fechar(true);
    }
    // Em coordenada de tela, rolar a tabela deixaria o menu parado apontando
    // para outra linha. Rolagem e redimensionamento fecham.
    const aoMover = () => fechar();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', aoMover, true);
    window.addEventListener('resize', aoMover);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', aoMover, true);
      window.removeEventListener('resize', aoMover);
    };
  }, [aberto, fechar]);

  return (
    <div className="relative inline-block">
      <button
        ref={gatilho}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={aberto}
        onClick={() => (aberto ? fechar() : abrir())}
        className="dw-row-menu-trigger"
      >
        <IconMore size={18} />
      </button>
      {aberto &&
        typeof document !== 'undefined' &&
        createPortal(
          // `chat-theme` viaja com o portal: no `body` os tokens escuros não
          // são herdados, e sem isso o menu sairia claro dentro do app escuro.
          <div
            ref={painel}
            onClick={() => fechar()}
            className="chat-theme dw-row-menu dialog-context-menu"
            style={caixa}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
