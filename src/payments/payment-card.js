// Módulo puro (sem I/O): monta o texto dos "cartões" que precedem o PIX/boleto
// mandado ao cliente. Sem markdown (*/**) — o WhatsApp mostra os asteriscos
// literalmente em alguns clientes, e o formatador da IA só trata isso nas
// respostas dela, não em texto fixo como este.

/** '135' / 135 / '89.9' → 'R$ 135,00'; não numérico → 'R$ ' + valor original. */
function formatarValor(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return 'R$ ' + String(valor);
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** '2026-09-15' → '15/09/2026'; fora do padrão AAAA-MM-DD, devolve a string original. */
function formatarData(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, ano, mes, dia] = m;
  return `${dia}/${mes}/${ano}`;
}

function cartaoPix({ valor, vencimento }) {
  return (
    '💠 PIX da fatura\n' +
    `Valor: ${formatarValor(valor)}\n` +
    `Vencimento: ${formatarData(vencimento)}\n` +
    '\n' +
    'Copie o código da próxima mensagem e cole no app do banco em Pix > Pix Copia e Cola.'
  );
}

function cartaoPixQr({ valor, vencimento }) {
  return (
    '💠 PIX da fatura\n' +
    `Valor: ${formatarValor(valor)}\n` +
    `Vencimento: ${formatarData(vencimento)}\n` +
    '\n' +
    'Escaneie este QR no app do banco, ou copie o código da próxima mensagem em Pix > Pix Copia e Cola.'
  );
}

function cartaoBoleto({ valor, vencimento }) {
  return (
    '🧾 Boleto da fatura\n' +
    `Valor: ${formatarValor(valor)}\n` +
    `Vencimento: ${formatarData(vencimento)}\n` +
    '\n' +
    'Copie a linha digitável da próxima mensagem e cole no app do banco em Pagar > Boleto.'
  );
}

module.exports = { formatarValor, formatarData, cartaoPix, cartaoPixQr, cartaoBoleto };
