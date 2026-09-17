// Traduz o veredito da análise de comprovante para o que o atendente lê na
// bolha. A conferência em si é feita no servidor, em código — aqui é só
// apresentação.
//
// "Já foi usado" vem na frente até de "confere": é o aviso que muda a decisão
// do atendente, e um comprovante reenviado pode conferir em tudo o mais.
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatarValor(valor) {
  return Number.isFinite(Number(valor)) ? MOEDA.format(Number(valor)) : null;
}

// 'AAAA-MM-DD' vira 'DD/MM/AAAA' sem passar por Date: `new Date('2026-09-17')`
// é interpretado como UTC e, num fuso a oeste, volta um dia.
function formatarData(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function receiptVerdict(resultado) {
  const r = resultado || {};
  if (!r.analisado) {
    return { tone: 'error', title: r.motivo || 'Não foi possível analisar o comprovante.', details: [] };
  }

  const details = [];
  const valor = formatarValor(r.valor);
  const data = formatarData(r.data);
  if (valor) details.push(`Valor: ${valor}`);
  if (data) details.push(`Data: ${data}`);
  if (r.tipo) details.push(`Tipo: ${r.tipo}`);
  for (const motivo of r.motivos || []) details.push(motivo);

  if (r.jaUtilizado) {
    return { tone: 'warn', title: 'Atenção: este comprovante já foi usado antes.', details };
  }
  if (r.valido) {
    return { tone: 'ok', title: 'O comprovante confere.', details };
  }
  return { tone: 'error', title: 'O comprovante não confere.', details };
}
