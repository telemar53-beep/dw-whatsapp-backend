// Documento pendente (25/09/2026): o CPF/CNPJ já foi pedido e ainda não veio (estado derivado em
// src/ai/documento-pendente.js). Caso real: a IA pediu o CPF três vezes seguidas — o módulo de
// identificação manda pedir a cada turno enquanto ninguém está identificado, e nada dizia que o
// pedido já tinha sido feito. Só entra com a pendência; a trava em código (orquestrador) garante
// que a repetição não sai mesmo se o modelo insistir.
//
// Fica depois dos fluxos (identificação, suporte, financeiro, contenções): é o fato específico
// do turno e vence a ordem geral de pedir o documento.
module.exports = {
  nome: 'documento-pendente',
  entra(estado) { return Boolean(estado.documento); },
  linhas(estado) {
    const p = estado.documento;
    const deQuem = p.alvo === 'terceiro' ? 'o CPF ou CNPJ da OUTRA pessoa (o titular do pedido)' : 'o CPF ou CNPJ';
    // Número recebido != identidade confirmada (ajuste de 25/09/2026): o número é tentado, e pedir
    // para conferir quando ele não localiza é avanço — não repetição.
    const l = p.documentoRecebido
      ? [
        '',
        `DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO: depois do pedido ele mandou um número com cara de ${p.alvo === 'terceiro' ? 'CPF ou CNPJ da OUTRA pessoa' : 'CPF ou CNPJ'}. Tente com buscar_cliente${p.alvo === 'terceiro' ? ' (titularEOutraPessoa: true)' : ''}; a identificação só está feita quando o cadastro for localizado — até lá, o que depende dela continua sem poder ser feito. Se não localizar, diga isso e peça para conferir o número, numa frase: isso não é repetir o pedido.`,
      ]
      : [
        '',
        `DOCUMENTO JÁ PEDIDO: você já pediu ${deQuem} e ele ainda não informou. NÃO peça de novo a cada mensagem, nem com outras palavras: responda ao que ele disse agora, com o que dá para responder sem o cadastro. O que depende da identificação continua sem poder ser feito até ele informar — não diga que consultou nada.`,
      ];
    if (p.documentoRecebido) {
      if (p.irritado) l.push('Ele se incomodou com o pedido: não discuta nem se justifique.');
      return l;
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
    } else if (p.mudancaRelevante) {
      l.push('Desde o pedido ele trouxe algo novo que também depende da identificação: se ela ainda for necessária, lembre do documento numa frase curta e natural, sem repetir o pedido anterior.');
    } else {
      l.push('Se ele continuar só explicando e não houver como avançar sem o cadastro, você pode encaminhar com concluir_triagem, com "identificação pendente" no resumo.');
    }
    return l;
  },
};
