export { Button } from './Button';
export { Card } from './Card';
export { Field } from './Field';
export { Toggle } from './Toggle';
export { ScopeBadge } from './ScopeBadge';
export { HelpText } from './HelpText';
export { Tabs } from './Tabs';
export { PageHeader } from './PageHeader';
export { DangerZone } from './DangerZone';
export { AsyncState } from './AsyncState';
export { ConfirmDialog } from './ConfirmDialog';
export { AlertDialog } from './AlertDialog';
export { Dialog, DialogBody, DialogFooter } from './Dialog';
export { DataTable, DataTableEmpty, RowMenu, CELULA, CABECALHO, ITEM_DE_MENU } from './DataTable';

// Raio 12px: o controle é o nível mais interno da escala (painel 22 > cartão 16 > controle 12).
export const inputClass =
  'w-full rounded-[12px] border border-wa-border bg-wa-field px-3.5 py-2.5 text-[14px] text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60';
