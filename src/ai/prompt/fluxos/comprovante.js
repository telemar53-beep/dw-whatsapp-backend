// Comprovante — leitura de comprovante de pagamento: como tratar a imagem
// quando a ferramenta analisar_comprovante está na lista do turno, e o caso
// de cliente ainda não identificado que manda um comprovante. Migração de
// ai-orchestrator.js — âncoras (números reais, conferidos por grep; os do
// brief/plano ":511-515" estavam desatualizados, mesmo padrão avisado pelas
// Tasks 13-16):
// - "COMPROVANTE À NOITE" — linha 342, dentro do bloco `if (triagem.noturno.ativo)`.
// - "COMPROVANTE:" (o diurno) — linha 439, metade IF do ternário
//   `config.triageReadReceiptsDaytime && !noturno`.
// - "COMPROVANTE DE CLIENTE NÃO IDENTIFICADO" — linha 444, incondicional.
//
// entra() é a presença da ferramenta na lista do turno (interface literal da
// tarefa): `analisar_comprovante` só entra em FERRAMENTAS_TRIAGEM_NOTURNO
// (sempre, à noite) ou em FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA (de dia, só com
// config.triageReadReceiptsDaytime ligado — e esse flag SAI DESLIGADO por
// padrão, ver ai-config.repository.test.js:139). Ou seja: a leitura de
// comprovante é sempre disponível à noite e só de dia se o operador ligar.
//
// CONTEÚDO distingue noturno de diurno (instrução explícita da tarefa: "a
// condição de entra() é a presença da ferramenta, mas o conteúdo precisa
// distinguir os dois casos"). À noite existe desbloqueio em confiança
// (desbloqueio_confianca só entra na lista à noite — FERRAMENTAS_TRIAGEM_NOTURNO);
// de dia não, porque a ferramenta não está disponível: descrever uma
// capacidade ausente ao modelo é convidá-lo a afirmar que a usou (mesmo
// princípio já registrado em ai-orchestrator.js sobre desbloqueio_confianca).
//
// "COMPROVANTE DE CLIENTE NÃO IDENTIFICADO" é a MESMA instrução nos dois
// casos (não depende de noturno) — por isso fica fora do if/else, comum aos
// dois ramos.
//
// Nomes de setor e motivo (Restrição Global do plano — "o setor da lista
// acima que cuidar de X" / "o motivo da lista acima que falar de X, se
// houver", mesmo idioma de fatos.js/financeiro.js/suporte-diagnostico.js):
// "conclua para o Financeiro" (3× no bloco noturno, 1× no diurno) virou "o
// setor da lista acima que cuidar do financeiro", sempre por extenso — sem
// pronome ("esse setor"/"esse mesmo setor") mesmo quando repetido na mesma
// frase, porque a Rodada de correção 1 da Task 16 (reativacao.js) já achou
// um pronome que virou ambíguo depois da genericização; repetir por extenso é
// o padrão mais seguro e é o que financeiro.js já faz em todo o módulo.
// "(motivo "Comprovante" se existir)" — nome de motivo como string literal —
// virou "(use o motivo da lista acima que falar de comprovante, se houver
// um)", mesma frase já usada por suporte-diagnostico.js (Task 15) para a
// mesma situação (motivo de comprovante).
//
// O "EXATAMENTE" do bloco noturno ("responda EXATAMENTE com a frase que ela
// devolver") NÃO foi removido: é a exceção legítima desta fase (frase
// pós-execução, devolvida por desbloqueio_confianca — não um texto fixo do
// prompt). Mesmo padrão já preservado por financeiro.js para
// enviar_boleto/gerar_pix.
//
// ==========================================================================
// O QUE NÃO MIGROU, DE PROPÓSITO (ver relatório desta tarefa)
// ==========================================================================
// O texto original tinha um TERCEIRO ramo, irmão do diurno, no mesmo ternário
// de ai-orchestrator.js:438-440: quando o comprovante NÃO está disponível
// (config.triageReadReceiptsDaytime desligado E não é noite — o padrão de
// fábrica), o modelo recebia "Se o cliente enviou uma imagem, pergunte se é
// um comprovante e, se for, classifique Financeiro / Comprovante sem
// confirmar pagamento." Esse ramo fica de fora por construção: ele é exibido
// exatamente quando a ferramenta NÃO está na lista — ou seja, precisamente
// quando entra() deste módulo é FALSE, a condição oposta à interface literal
// desta tarefa. Não há, entre os seis módulos desta tarefa, nenhum estado que
// cubra "ferramenta ausente" (os outros cinco são sobre noturno, múltiplos
// contratos, aviso de cidade, SGP indisponível e limite de perguntas — nenhum
// deles é "comprovante sem a ferramenta"). Também não é conteúdo de nenhum
// módulo já existente (financeiro.js e suporte-geral.js não mencionam
// imagem/comprovante). Resultado: no padrão de fábrica (leitura de dia
// desligada), um cliente que manda uma imagem de dia perde essa orientação
// específica — gap real, fora de "O LIMITE" desta tarefa (só os seis
// módulos; a interface de entra() é dada, não é minha para alterar). Ver
// preocupação no relatório.
module.exports = {
  nome: 'comprovante',
  entra(estado) {
    return (estado.ferramentas || []).includes('analisar_comprovante');
  },
  linhas(estado) {
    const triagem = estado.triagem || {};
    const noturno = Boolean(triagem.noturno && triagem.noturno.ativo);
    const l = [
      '',
      'COMPROVANTE DE CLIENTE NÃO IDENTIFICADO: peça o CPF ou CNPJ primeiro, nunca outro dado. Sem o cadastro localizado não há o que conferir.',
    ];
    if (noturno) {
      l.push('COMPROVANTE À NOITE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Se conferir e o contrato estiver SUSPENSO, chame desbloqueio_confianca do contrato indicado — a ferramenta já avisa o cliente antes de executar; depois responda EXATAMENTE com a frase que ela devolver e conclua para o setor da lista acima que cuidar do financeiro na mesma resposta. Se o comprovante não conferir, ou o contrato estiver ativo, não desbloqueie: agradeça, diga que a equipe confere a partir do horário de retorno e conclua para o setor da lista acima que cuidar do financeiro (use o motivo da lista acima que falar de comprovante, se houver um). Se ele pedir liberação SEM comprovante ("paguei, libera"), chame desbloqueio_confianca direto: a regra da casa decide. NUNCA diga "pagamento confirmado" nem "acesso liberado" sem a ferramenta ter devolvido liberado: true. Se a ferramenta devolver jaUtilizado: true, NÃO diga isso ao cliente nem cite outro contrato: responda o mesmo acolhimento (comprovante registrado para a equipe conferir a partir do horário de retorno) e conclua para o setor da lista acima que cuidar do financeiro.');
    } else {
      l.push('COMPROVANTE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Qualquer que seja o resultado, NÃO confirme pagamento nem prometa liberação: agradeça, diga que a equipe confere e dá baixa, e conclua para o setor da lista acima que cuidar do financeiro (use o motivo da lista acima que falar de comprovante, se houver um). Se a ferramenta disser que o comprovante já foi utilizado, NÃO diga isso ao cliente: responda o mesmo acolhimento e conclua — a equipe trata.');
    }
    return l;
  },
};
