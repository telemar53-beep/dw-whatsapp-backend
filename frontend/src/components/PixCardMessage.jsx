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

// A queda para texto precisa aparecer no balão: o atendente clicou em "Cód Pix"
// e, se o cartão não saiu, o que o cliente tem na mão é o copia e cola solto.
// Mostrar o cartão nesse caso faz o atendente garantir ao cliente uma bolha que
// nunca chegou - e, quando o código do boleto não traz a chave do recebedor,
// esconde a única explicação possível para o cartão oficial não ter saído.
const MOTIVO_TEXTO = {
  codigo_sem_chave:
    'O código Pix deste boleto não traz a chave do recebedor, que o WhatsApp oficial exige no cartão: o cliente recebeu o código em texto.',
  cartao_recusado: 'O WhatsApp oficial recusou o cartão: o cliente recebeu o código em texto.',
  cartao_nao_entregue: 'O cartão não chegou ao cliente: o código foi reenviado em texto.',
};
const MOTIVO_PADRAO = 'O cliente recebeu o código em texto.';

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
  const viaTexto = Boolean(metadata.fallbackTextoEnviado);
  const rodape = viaTexto ? MOTIVO_TEXTO[metadata.motivoTexto] || MOTIVO_PADRAO : 'Cartão com botão Copiar código Pix';

  return (
    <div className="flex min-w-[200px] flex-col gap-1 rounded-[12px] bg-white/[0.06] px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[14px] font-semibold leading-[19px] text-chat-text">
        <IconPix size={17} />
        {viaTexto ? 'Pix enviado como texto' : 'Pix da fatura'}
      </span>
      {(dueLabel || valueLabel) && (
        <span className="text-[13.5px] leading-[18px] text-chat-muted">
          {dueLabel && <>Vence <span>{dueLabel}</span></>}
          {dueLabel && valueLabel && ' · '}
          {valueLabel && <span>{valueLabel}</span>}
        </span>
      )}
      <span className="font-mono text-[12.5px] leading-[17px] text-chat-muted">{shortCode}</span>
      <span className={`text-[12px] ${viaTexto ? 'text-chat-orange' : 'text-chat-faint'}`}>{rodape}</span>
    </div>
  );
}

export default PixCardMessage;
