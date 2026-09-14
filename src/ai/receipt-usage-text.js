// Como se conta, em uma frase, que um comprovante já foi usado antes.
//
// A frase é SÓ para o resumo interno: ela cita o contrato de outro cliente, e
// isso não pode chegar ao WhatsApp de quem mandou a imagem. Função pura de
// propósito — quem monta o texto do cliente nunca precisa importar daqui.

// Fuso da operação. O servidor roda em UTC, e um uso às 23:12 de São Paulo não
// pode virar "14/09 às 02:12" no resumo de manhã.
const FUSO = 'America/Sao_Paulo';
const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
// hour12: false explícito: sem ele o pt-BR escreve "24:00" à meia-noite.
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false });

function descreverUsoAnterior(uso) {
  if (!uso) return '';
  const ondeFoi = uso.contractId != null ? ` no contrato ${uso.contractId}` : '';
  // Data ilegível (ou ausente) não pode virar "em Invalid Date às Invalid" —
  // nem, pior, virar a Epoch: new Date(null) é 01/01/1970, uma data válida e
  // completamente falsa. Sem hora confiável, a frase diz só o que se sabe.
  if (!uso.usedAt) return 'já utilizado';
  const quando = uso.usedAt instanceof Date ? uso.usedAt : new Date(uso.usedAt);
  if (Number.isNaN(quando.getTime())) return 'já utilizado';
  return `já utilizado${ondeFoi} em ${DIA_E_MES.format(quando)} às ${HORA.format(quando)}`;
}

module.exports = { descreverUsoAnterior };
