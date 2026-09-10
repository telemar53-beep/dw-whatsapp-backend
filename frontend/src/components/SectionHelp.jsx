import { useState } from 'react';
import WaDialog, { waPrimaryButtonClass } from './WaDialog';

function SectionHelp({ label, title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`O que é isso: ${label}`}
        className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline"
      >
        O que é isso?
      </button>
      {open && (
        <WaDialog title={title} onClose={() => setOpen(false)} size="max-w-md">
          <div className="px-6 py-4 text-[14.5px] leading-[20px] text-wa-text">{children}</div>
          <div className="flex shrink-0 justify-end px-4 py-3">
            <button type="button" onClick={() => setOpen(false)} className={waPrimaryButtonClass}>
              Entendi
            </button>
          </div>
        </WaDialog>
      )}
    </>
  );
}

export default SectionHelp;
