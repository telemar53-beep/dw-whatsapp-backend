const { temSinal, situacaoDoWifi, faltaNoWifi } = require('../../contencoes-operacionais');

// Contenções operacionais (25/09/2026): o fato que o CÓDIGO leu da fala do cliente (defeito físico
// no equipamento, pedido de troca do Wi-Fi, pedido de explicação financeira do contrato) vira
// instrução do turno. Só entra com o sinal: sem ele, o prompt é exatamente o de antes. A mesma
// regra é conferida em código na resposta (contencoes-operacionais.js, aplicada no orquestrador):
// este módulo diz ao modelo o que fazer; a trava garante o que não pode sair.
//
// Fica depois dos fluxos de suporte, financeiro e noturno de propósito: é a regra específica do
// turno e vence o roteiro geral (inclusive o de CONEXÃO À NOITE e o do aviso de cidade).

function linhasDoDefeito(estado) {
  const identificado = estado.identidade && estado.identidade.nivel === 'forte';
  const l = [
    'DEFEITO FÍSICO NO EQUIPAMENTO (o cliente disse que o equipamento queimou, não liga, não acende, está sem energia ou com cheiro de queimado): NÃO siga nenhum roteiro de diagnóstico — nada de teste de velocidade, reiniciar, desligar da tomada, testar outros aparelhos ou mexer em configuração. NUNCA oriente abrir o equipamento, medir tensão, trocar peça, usar outra fonte ou fonte de outra voltagem, improvisar, nem qualquer procedimento elétrico ou reparo. Não prometa visita técnica, prazo nem troca de equipamento.',
    identificado
      ? 'Acolha em uma frase, diga para ele não mexer no equipamento e conclua para o setor da lista acima que cuidar de suporte na mesma resposta, com o defeito relatado no resumo.'
      : 'Se ainda não souber quem é o cliente, peça só o CPF ou CNPJ do titular para encaminhar; depois conclua para o setor da lista acima que cuidar de suporte, com o defeito relatado no resumo.',
  ];
  if (estado.avisoCidade) l.push('O AVISO ATIVO NÃO explica defeito físico do equipamento: não atribua o defeito à falha regional — o defeito relatado vence.');
  if (estado.triagem && estado.triagem.noturno && estado.triagem.noturno.ativo) {
    l.push('À noite vale o mesmo: o roteiro de CONEXÃO À NOITE não se aplica a equipamento com defeito físico; deixe na fila do setor da lista acima que cuidar de suporte.');
  }
  return l;
}

function linhasDoWifi(estado) {
  const wifi = estado.contencoes.wifi;
  const l = ['ALTERAÇÃO DO WI-FI (nome ou senha da rede): a empresa faz a alteração remotamente. NUNCA ensine o cliente a entrar no roteador (endereço numérico de acesso, painel, usuário ou senha administrativa, aplicativo do fabricante) nem a mudar nada no equipamento.'];
  const situacao = situacaoDoWifi({ contencoes: estado.contencoes, identidade: estado.identidade, terceiro: estado.terceiro });
  if (situacao === 'terceiro') {
    l.push('Quem pede NÃO é o titular identificado dessa rede: a alteração do Wi-Fi só pode ser pedida pelo próprio titular. Diga isso em uma frase, não peça o nome nem a senha nova e não encaminhe a alteração. A autorização de outra pessoa vale só para boleto e PIX.');
    return l;
  }
  if (situacao === 'nao_identificado') {
    l.push('Quem pede ainda não foi identificado: identifique pelo fluxo normal (CPF ou CNPJ) ANTES de pedir o nome ou a senha nova. Não peça nenhum outro dado.');
    return l;
  }
  const falta = faltaNoWifi(wifi);
  const informado = [
    wifi.nome && wifi.nomeInformado ? 'o nome novo da rede' : null,
    wifi.senha && wifi.senhaInformada ? 'a senha nova' : null,
  ].filter(Boolean);
  if (informado.length > 0) l.push(`Ele já informou ${informado.join(' e ')}: NÃO pergunte de novo nem peça confirmação.`);
  if (falta.nome && falta.senha) l.push('Peça só o nome e a senha novos da rede, numa pergunta.');
  else if (falta.senha) l.push('Peça só a senha nova.');
  else if (falta.nome) l.push('Peça só o nome novo da rede.');
  l.push((estado.contratos || []).length > 1
    ? 'Não peça data de nascimento, modelo do roteador, usuário ou senha administrativa, nem o que você já sabe; com mais de um contrato, pergunte só de qual endereço é a rede.'
    : 'Não peça data de nascimento, endereço, modelo do roteador, usuário ou senha administrativa, nem o que você já sabe.');
  l.push('Com o que ele pediu para trocar informado, conclua para o setor da lista acima que cuidar de suporte, com o pedido no resumo (sem repetir a senha nova).');
  return l;
}

function linhasDoFinanceiro() {
  return [
    'EXPLICAÇÃO FINANCEIRA DO CONTRATO (por que a fatura veio com esse valor, quanto vem no mês seguinte, período cobrado, proporcional, ciclo, vencimento futuro, cobrança depois de mudar de plano): só afirme o que uma ferramenta devolveu NESTE atendimento ou o que estiver escrito nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO. NÃO calcule, NÃO deduza, NÃO preveja valor nem período, e não afirme nem negue proporcional sem essa fonte. Use só o que estiver confirmado e não complete lacunas.',
    'Sem essa fonte, diga em uma frase que não tem essa informação confirmada no sistema e conclua para o setor da lista acima que cuidar do financeiro, com a pergunta dele no resumo.',
  ];
}

module.exports = {
  nome: 'contencoes',
  entra(estado) { return temSinal(estado.contencoes); },
  linhas(estado) {
    const sinais = estado.contencoes;
    return [
      '',
      ...(sinais.defeitoFisico ? linhasDoDefeito(estado) : []),
      ...(sinais.wifi ? linhasDoWifi(estado) : []),
      ...(sinais.explicacaoFinanceira ? linhasDoFinanceiro() : []),
    ];
  },
};
