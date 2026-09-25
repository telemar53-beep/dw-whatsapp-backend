// Disparo recente (Fase 1B, 25/09/2026): o cliente pode estar respondendo a uma mensagem
// AUTOMÁTICA — disparo do SGP ou campanha — que ele recebeu antes. Sem isto, a IA via uma
// resposta solta ("não estou atrasado, pago dia 30") sem saber o que a provocou.
//
// Só entra quando existe disparo relacionado (o orquestrador escolhe: o citado pelo cliente,
// senão o último automático do histórico). Recebe o FATO SEGURO (fatoDoDisparo): origem,
// template, tipo, vencimento informado (só se veio nomeado pelo SGP), quando e se foi citado.
// Nunca o texto montado — ele tem nome, valor e link do cliente.
//
// D6 (aprovada): sem identificação, a IA explica só o que o próprio disparo informou.
// Nomes de setor e motivo nunca aparecem aqui (Restrição Global, montar.test.js).

function haQuantoTempo(enviadoEm, agora) {
  const minutos = Math.max(0, Math.round((new Date(agora) - new Date(enviadoEm)) / 60000));
  if (!Number.isFinite(minutos)) return 'recentemente';
  if (minutos < 60) return minutos <= 1 ? 'há 1 minuto' : `há ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function linhasDoDisparoRecente(disparo, agora) {
  const doSgp = disparo.origem === 'sgp';
  const origem = doSgp ? 'pelo sistema de cobrança (SGP)' : 'por uma campanha';
  const detalhes = [];
  if (disparo.template) detalhes.push(`template ${disparo.template}`);
  if (doSgp) detalhes.push(`tipo ${disparo.tipo || 'desconhecido'}`);
  if (disparo.vencimento) detalhes.push(`vencimento informado ${disparo.vencimento}`);
  const resposta = disparo.citado ? 'Ele respondeu citando essa mensagem.' : 'Ele pode estar respondendo a ela.';

  const l = [
    '',
    `MENSAGEM AUTOMÁTICA RECENTE: ${haQuantoTempo(disparo.enviadoEm, agora)} o cliente recebeu uma mensagem enviada automaticamente ${origem}, não por você nem por uma atendente (${detalhes.join('; ')}). ${resposta} O resumo dela está no histórico.`,
    'Interprete a mensagem dele levando esse disparo em conta. Se ele mudou de assunto, siga o assunto novo.',
  ];
  if (doSgp) {
    l.push(!disparo.tipo || disparo.tipo === 'desconhecido'
      ? 'O tipo desse disparo é desconhecido: não presuma a finalidade dele.'
      : `O sistema informou o tipo ${disparo.tipo}; não acrescente finalidade além disso.`);
  }
  l.push(
    'Nunca afirme atraso, dívida, pagamento confirmado ou qualquer situação financeira só por causa desse disparo: isso depende de consulta ao cadastro, com o cliente identificado.',
    disparo.vencimento
      ? `Sem o cliente identificado, explique apenas o que a própria mensagem automática informou — inclusive o vencimento informado nela, ${disparo.vencimento}, que pode ser repetido. Qualquer outro dado da conta exige identificação.`
      : 'Sem o cliente identificado, explique apenas o que a própria mensagem automática informou. Qualquer outro dado da conta exige identificação.',
  );
  return l;
}

module.exports = {
  nome: 'disparo-recente',
  entra(estado) {
    return Boolean(estado.disparoRecente);
  },
  linhas(estado) {
    return linhasDoDisparoRecente(estado.disparoRecente, estado.agora);
  },
  linhasDoDisparoRecente,
};
