import { useState, useEffect, useRef } from 'react';
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

export function DataTableEmpty({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="dw-table-empty">
        {children}
      </td>
    </tr>
  );
}

// Menu de ações da linha. O gatilho é um alvo de ícone com rótulo acessível;
// o painel fecha por clique fora, por ESC e ao escolher uma ação.
export function RowMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key !== 'Escape') return;
      // Só este menu some: a tecla não pode subir e fechar o diálogo de trás.
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="dw-row-menu-trigger"
      >
        <IconMore size={18} />
      </button>
      {open && (
        <div onClick={() => setOpen(false)} className="dw-row-menu dialog-context-menu">
          {children}
        </div>
      )}
    </div>
  );
}
