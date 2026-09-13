import { IconPix } from './icons/SgpIcons';

const CODE_PREVIEW_LENGTH = 18;

// 'AAAA-MM-DD' -> 'dd/mm/aaaa'. Se o formato vier fora do esperado, omite a linha
// em vez de mostrar uma data quebrada.
function formatDueDate(dueDate) {
  if (!dueDate) return null;
  const parts = String(dueDate).split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function formatValue(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return null;
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Nunca mostra o código Pix inteiro no balão — só os primeiros caracteres, pra
// identificação visual. O código completo já vai no cartão nativo que o WhatsApp
// entrega ao cliente, com o botão de copiar.
function shortenCode(code) {
  if (!code) return '';
  if (code.length <= CODE_PREVIEW_LENGTH) return code;
  return `${code.slice(0, CODE_PREVIEW_LENGTH)}…`;
}

function PixCardMessage({ message }) {
  const metadata = message.metadata || {};
  const dueLabel = formatDueDate(metadata.dueDate);
  const valueLabel = formatValue(metadata.value);
  const shortCode = shortenCode(message.content);

  return (
    <div className="flex min-w-[200px] flex-col gap-1 rounded-[12px] bg-white/[0.06] px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[14px] font-semibold leading-[19px] text-chat-text">
        <IconPix size={17} />
        Pix da fatura
      </span>
      {(dueLabel || valueLabel) && (
        <span className="text-[13.5px] leading-[18px] text-chat-muted">
          {dueLabel && <>Vence <span>{dueLabel}</span></>}
          {dueLabel && valueLabel && ' · '}
          {valueLabel && <span>{valueLabel}</span>}
        </span>
      )}
      <span className="font-mono text-[12.5px] leading-[17px] text-chat-muted">{shortCode}</span>
      <span className="text-[12px] text-chat-faint">Cartão com botão Copiar código Pix</span>
    </div>
  );
}

export default PixCardMessage;
