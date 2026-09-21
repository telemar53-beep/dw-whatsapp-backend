// A tabela `campaigns` tem só os contadores e `created_at`: não há coluna de
// estado, nem `started_at`, `finished_at` ou `updated_at`. Então "travada",
// "pausada", "cancelada" e "em atraso" NÃO são deriváveis — nada distingue
// fila lenta de fila parada — e esta função não as inventa.
//
// O que os dados permitem afirmar é só se todo destinatário já tem um estado
// terminal (enviado, falhou ou pulado). É o mesmo cálculo que o detalhe usa
// para decidir se ainda vale consultar de novo.
export function processadosDaCampanha({ sentCount = 0, failedCount = 0, skippedCount = 0 }) {
  return sentCount + failedCount + skippedCount;
}

export function situacaoDaCampanha(campanha) {
  const { totalRecipients = 0 } = campanha;
  // Sem destinatário nenhum não há o que processar: dizer "todos processados"
  // aqui seria afirmar um trabalho que nunca existiu.
  if (!totalRecipients) return 'Sem destinatários';
  return processadosDaCampanha(campanha) >= totalRecipients ? 'Todos processados' : 'Processando';
}

export function campanhaTerminou(campanha) {
  return situacaoDaCampanha(campanha) === 'Todos processados';
}
