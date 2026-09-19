// Limite de perguntas — a triagem foi forçada a concluir: não fazer mais
// nenhuma pergunta, entregar o que já puder (boleto/PIX) e encaminhar ou
// encerrar, respeitando o mesmo ternário de config.triageResolvedReasonId que
// financeiro.js já usa (com motivo de encerramento configurado, entrega e
// ENCERRA sozinha; sem motivo, entrega e sempre encaminha). Migração de
// ai-orchestrator.js — âncora "LIMITE DE PERGUNTAS ATINGIDO", hoje linhas
// 581-583 (o brief/plano citava ":650-656", desatualizado — mesmo padrão
// avisado pelas Tasks 13-16; localizado por grep de texto-âncora).
//
// entra() é Boolean(estado.triagem.forcarConclusao): no original este bloco
// fica dentro de `if (triagem && triagem.forcarConclusao)`, depois de todo o
// resto do contexto de triagem — mesma posição relativa que ele ocupa aqui no
// compositor (montar.js já lista este módulo por último entre os fluxos,
// logo antes de painel.js).
//
// Sem nome de setor ou motivo hardcoded no texto original desta âncora —
// nenhuma reescrita de papel foi necessária aqui.
module.exports = {
  nome: 'limite-perguntas',
  entra(estado) {
    const triagem = estado.triagem || {};
    return Boolean(triagem.forcarConclusao);
  },
  linhas(estado) {
    const config = estado.config || {};
    return [
      '',
      config.triageResolvedReasonId
        ? 'LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente. Se você já tem o que precisa para entregar boleto ou PIX, entregue AGORA e chame encerrar_atendimento, dizendo que qualquer outra coisa é só chamar de novo. Se não tem, chame concluir_triagem com o que apurou. Se ele fez uma pergunta nesta mensagem, responda-a ANTES de dizer que está encaminhando, na mesma mensagem.'
        : 'LIMITE DE PERGUNTAS ATINGIDO: NÃO faça mais nenhuma pergunta ao cliente. Se você já tem o que precisa para entregar boleto ou PIX, entregue AGORA (enviar_boleto ou gerar_pix) e em seguida chame concluir_triagem. Se não tem, chame concluir_triagem com o que apurou. Se ele fez uma pergunta nesta mensagem, responda-a ANTES de dizer que está encaminhando, na mesma mensagem.',
    ];
  },
};
