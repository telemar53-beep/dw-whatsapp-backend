// Documento pendente (25/09/2026): o CPF/CNPJ já foi pedido e ainda não veio (estado derivado em
// src/ai/documento-pendente.js). Caso real: a IA pediu o CPF três vezes seguidas — o módulo de
// identificação manda pedir a cada turno enquanto ninguém está identificado, e nada dizia que o
// pedido já tinha sido feito. Só entra com a pendência; a trava em código (orquestrador) garante
// que a repetição não sai mesmo se o modelo insistir.
//
// Fica depois dos fluxos (identificação, suporte, financeiro, contenções): é o fato específico
// do turno e vence a ordem geral de pedir o documento.
//
// F1 — terceira revisão (30/09/2026): o código concede UM esclarecimento por cadeia de pedidos
// (documento-pendente.js) e não reconhece mais nome, adiamento ou recusa por lista de palavras. SE o
// esclarecimento cabe, quem decide é o modelo, lendo a conversa — por isso a orientação sobre adiamento,
// recusa, outro pedido e resposta vazia fica sempre presente enquanto o documento está pendente.
const { recuperacaoComprovada } = require('../../documento-pendente');

// Cada leitura possível da última mensagem, com o que fazer. Orientação, não ordem; nenhuma identifica.
const LEITURA_DA_CONVERSA = 'Se ele disse que manda depois ou que não está com o documento agora, aceite com naturalidade e diga que fica no aguardo, sem pedir de novo e sem encaminhar só por isso. Se ele não quer informar, não insista nem discuta: diga que sem o documento não dá para localizar o cadastro por aqui e ofereça seguir com um atendente; só diga que encaminhou depois de chamar concluir_triagem, com "identificação pendente" no resumo. Se a mensagem trouxer outro pedido ou pergunta, responda a isso também.';
// Resposta vazia (revisão gerencial de 30/09/2026): curta pode ser certa, vazia diante de um pedido não.
const SEM_RESPOSTA_VAZIA = 'Só "Entendi." não basta quando ele pediu algo: diga o que dá para fazer sem o cadastro ou qual é o próximo passo. Resposta curta só cabe quando ele disse que manda depois ou se despediu.';

module.exports = {
  nome: 'documento-pendente',
  entra(estado) { return Boolean(estado.documento); },
  linhas(estado) {
    const p = estado.documento;
    const deQuem = p.alvo === 'terceiro' ? 'o CPF ou CNPJ da OUTRA pessoa (o titular do pedido)' : 'o CPF ou CNPJ';
    // Uso do nome (decisão do gerente, 30/09/2026): a apresentação do próprio cliente pode ser forma de
    // tratamento; o nome de um terceiro nunca vira o de quem fala; na dúvida, sem nome.
    const usoDoNome = p.alvo === 'terceiro'
      ? 'Nome dito em resposta a este pedido é o da outra pessoa: não trate quem fala por ele.'
      : 'Se ele se apresentou, você pode tratá-lo por esse nome — isso não confirma identidade nem titularidade; na dúvida, responda sem nome.';
    // Número recebido != identidade confirmada (ajuste de 25/09/2026): o número é tentado, e pedir
    // para conferir quando ele não localiza é avanço — não repetição.
    let l;
    if (p.documentoRecebido) {
      l = [
        '',
        `DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO: depois do pedido ele mandou um número com cara de ${p.alvo === 'terceiro' ? 'CPF ou CNPJ da OUTRA pessoa' : 'CPF ou CNPJ'}. Tente com buscar_cliente${p.alvo === 'terceiro' ? ' (titularEOutraPessoa: true)' : ''}; a identificação só está feita quando o cadastro for localizado — até lá, o que depende dela continua sem poder ser feito. Se não localizar, diga isso e peça para conferir o número, numa frase: isso não é repetir o pedido.`,
      ];
      if (p.irritado) l.push('Ele se incomodou com o pedido: não discuta nem se justifique.');
      return l;
    }
    if (p.esclarecimentoDisponivel) {
      // O código permite UM pedido a mais nesta cadeia; a linha diz quando ele cabe. Sem ela, o código
      // permitiria e a linha padrão continuaria proibindo.
      l = [
        '',
        `DOCUMENTO JÁ PEDIDO: você já pediu ${deQuem} e ele ainda não informou. Leia a última mensagem dele antes de responder. Se ele TENTOU responder sem o dado (mandou o nome, se apresentou ou mandou outra informação no lugar), você pode esclarecer UMA vez, em poucas palavras e sem repreender, que para localizar o cadastro precisa de ${deQuem}, ligado ao que ele pediu. Se ele está explicando o problema ou pediu outra coisa, não peça de novo: responda ao que ele disse, com o que dá para responder sem o cadastro. ${LEITURA_DA_CONVERSA} ${SEM_RESPOSTA_VAZIA} Nada do que ele disser sem o documento confirma quem é: não chame buscar_cliente sem o documento, não diga que localizou ou consultou nada e não encaminhe só por ele não ter mandado o documento. ${usoDoNome}`,
      ];
    } else {
      l = [
        '',
        `DOCUMENTO JÁ PEDIDO: você já pediu ${deQuem} e ele ainda não informou. NÃO peça de novo a cada mensagem, nem com outras palavras: responda ao que ele disse agora, com o que dá para responder sem o cadastro. O que depende da identificação continua sem poder ser feito até ele informar — não diga que consultou nada. ${LEITURA_DA_CONVERSA} ${SEM_RESPOSTA_VAZIA} ${usoDoNome}`,
      ];
    }
    if (p.alvo === 'terceiro') {
      l.push(p.mandouOProprioDocumento
        ? 'O documento de quem está falando NÃO responde a esse pedido: o que ele mandou é o dele mesmo. Diga isso em uma frase, sem repetir o pedido anterior palavra por palavra.'
        : 'O documento de quem está falando NÃO responde a esse pedido: nunca o use para a outra pessoa.');
    }
    if (p.irritado) {
      l.push('Ele se incomodou com o pedido: NÃO peça de novo agora, não discuta nem se justifique. Se não der para seguir sem o cadastro, encaminhe com concluir_triagem, com "identificação pendente" no resumo.');
    } else if (p.mudouDeAssunto) {
      l.push('Ele mudou de assunto depois do pedido: responda ao assunto novo e não volte ao documento agora.');
    } else if (recuperacaoComprovada(p) && p.ofertaFeita) {
      l.push('Você já esclareceu o que falta e JÁ ofereceu enviar depois ou seguir com um atendente: não repita a oferta. Responda ao que ele disse; se ainda precisar, diga em uma frase, sem repreender, que sem o CPF ou CNPJ não dá para localizar o cadastro por aqui. Se ele pedir o atendente, chame concluir_triagem antes de anunciar.');
    } else if (recuperacaoComprovada(p)) {
      l.push('Você já esclareceu o que falta e ele ainda não mandou o documento. Responda ao que ele disse; se ele não disse que manda depois, diga, sem repreender, que sem o CPF ou CNPJ não dá para localizar o cadastro por aqui e pergunte se ele prefere enviar depois ou seguir com um atendente. Só diga que encaminhou depois de chamar concluir_triagem, com "identificação pendente" no resumo.');
    } else if (p.mudancaRelevante) {
      l.push('Desde o pedido ele trouxe algo novo que também depende da identificação: se ela ainda for necessária, lembre do documento numa frase curta e natural, sem repetir o pedido anterior.');
    } else {
      l.push('Se ele continuar só explicando e não houver como avançar sem o cadastro, você pode encaminhar com concluir_triagem, com "identificação pendente" no resumo.');
    }
    return l;
  },
};
