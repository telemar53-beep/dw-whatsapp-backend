// Identificação: como pedir o documento quando ainda não se sabe quem é o
// cliente, e o que fazer quando ele diz que o nome anterior não era dele
// (identidade contestada). Migração de ai-orchestrator.js — texto-âncora
// "Cliente NÃO identificado. Peça o CPF/CNPJ" (hoje linha 364) e a linha de
// contestação (:365).
//
// Decisão do dono (2026-09-18, depois do achado da Task 14): este conteúdo
// tinha ido parar em fatos.js na Task 12 e sobrevivido a 3 rodadas de
// revisão porque ninguém comparou as duas camadas entre si — fatos.js diz o
// FATO ("o cliente ainda não foi identificado"), este módulo diz o QUE FAZER
// a respeito. Instrução de fluxo não é fato. O texto abaixo é o mesmo que
// estava em fatos.js (já com a redação corrigida na Rodada de correção 3:
// sem nomear setor), só realocado — não uma nova migração a partir do texto
// bruto de ai-orchestrator.js.
//
// entra() cobre os dois casos em que este módulo precisa falar: identidade
// ainda não confirmada (nivel === 'none') OU identidade que acabou de ser
// descartada por contestação. Na prática hoje os dois sempre andam juntos
// (esquecer_identificacao zera nivel para 'none' junto com contestado: true
// — tool-registry.js), mas o contrato é a união dos dois estados, não só o
// caso observado (ver identificacao.test.js).
module.exports = {
  nome: 'identificacao',
  entra(estado) {
    const identidade = estado.identidade || {};
    return identidade.nivel === 'none' || Boolean(identidade.contestado);
  },
  linhas(estado) {
    const identidade = estado.identidade || {};
    const l = [
      '',
      'Cliente NÃO identificado. Peça o CPF ou CNPJ só quando o que ele pediu depender de localizar o cadastro dele (conta, fatura, problema no serviço, retorno de cliente antigo), no modelo: "Vou verificar isso para você. Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor." Quem só quer conhecer planos ou contratar não precisa se identificar. Depois de buscar_cliente, continue a triagem.',
    ];
    if (identidade.contestado) {
      l.push('O cliente disse que o nome anterior não era dele: a identificação foi descartada. Peça o CPF.');
    }
    return l;
  },
};
