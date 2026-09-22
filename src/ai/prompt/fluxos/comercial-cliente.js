// Comercial — cliente JÁ identificado: quando (e só quando) falar de preço
// ou upgrade, de onde vêm os planos (nunca do código), o que fazer quando
// ele já escolheu, como recomendar sem empurrar o mais caro, e mudança de
// endereço (transferência do ponto). Migração de ai-orchestrator.js —
// âncoras (números reais, conferidos por grep; os do brief e da tarefa já
// vinham desatualizados, mesmo padrão avisado pelas Tasks 13-15):
// - "A tabela de planos é SÓ para cliente NÃO identificado" — linha 529,
//   SEGUNDA oração ("Cliente com contrato nunca recebe a lista de
//   planos..."). A PRIMEIRA oração já foi migrada por comercial-novo.js
//   (Task 14); a Task 14 registrou explicitamente (relatório, "Preocupações"
//   item 5) que a segunda oração ficaria para este módulo — é o que este
//   arquivo migra agora. Migrar as duas no mesmo módulo duplicaria a regra
//   no prompt sempre que os dois módulos entrassem juntos (o que nunca
//   acontece: um exige nivel 'none', o outro 'forte' — mas a regra em si é
//   uma só, só se aplica a lados opostos).
// - "- Cliente JÁ identificado:" — linhas 546-554 (bloco inteiro, INCLUINDO
//   a tabela fixa 500/600/800 das linhas 549-551). Ver "O HARDCODE MAIS
//   GRAVE" abaixo.
// - "MUDANÇA DE ENDEREÇO" — linha 565.
//
// entra() só com identidade.nivel === 'forte': "peça preço ou upgrade com
// todas as letras" e "mudar de endereço" só fazem sentido para quem já tem
// contrato.
//
// ==========================================================================
// O HARDCODE MAIS GRAVE DO DIAGNÓSTICO INTEIRO (o motivo desta tarefa existir)
// ==========================================================================
// O texto original (linhas 549-551) tinha os TRÊS planos da operação escritos
// no CÓDIGO: "500 Mega por R$ 100/mês", "600 Mega por R$ 135/mês", "800 Mega
// por R$ 185/mês". Cliente identificado que perguntasse preço recebia a
// tabela DO CÓDIGO, não a do painel — um reajuste de preço exigia DEPLOY.
// A tabela foi APAGADA por completo (não migrada, não reescrita com
// marcador — removida). No lugar dela, o módulo manda copiar o bloco de
// planos das INSTRUÇÕES ADICIONAIS DA OPERAÇÃO, exatamente como
// comercial-novo.js (Task 14) já faz para cliente novo. Copiar literalmente
// do painel é a EXCEÇÃO legítima a "nada de frase obrigatória": preço não
// pode ser parafraseado, só copiado da única fonte real (o painel).
// Trava contra o defeito voltar: comercial-cliente.test.js tem testes
// dedicados provando que nenhuma linha deste módulo contém padrão de preço
// (R$ \d) nem de velocidade em Mega, incluindo as três linhas reais antigas
// por extenso (500/600/800 Mega, R$ 100/135/185) — a mesma dupla categoria
// que a guarda de montar.test.js varre em todos os módulos.
// ==========================================================================
//
// Nome real de cliente: o texto original citava "Boa tarde, Willemberg!
// Claro, vou te ajudar a conhecer nossos planos 😊 Temos estas opções:" como
// saudação fixa entre aspas — um roteiro engessado (a própria categoria que
// os princípios desta fase proíbem) E com nome real dentro. O texto novo
// (dado pela tarefa, ver Step 3 do brief) não usa saudação entre aspas
// nenhuma: descreve o OBJETIVO ("cumprimente pelo nome, diga que vai
// ajudar") em vez de um script fixo — por isso não sobra "Willemberg" nem é
// preciso um marcador "[nome]" no lugar dele (não há citação nenhuma para
// genericizar). Guarda dedicada em comercial-cliente.test.js confirma que
// "Willemberg" não aparece em nenhum estado.
//
// Nomes de setor (Restrição Global — "o setor da lista acima que cuidar de
// X", mesmo idioma de fatos.js/painel.js/comercial-novo.js/suporte-*.js/
// reativacao.js): o bloco de planos dado pelo brief (Step 3) usava "conclua
// para o setor comercial" — nome de setor em MINÚSCULA, categoria que a
// guarda de montar.test.js NÃO detecta (regex é case-sensitive e só pega
// "Comercial" com C maiúsculo) e que a própria tarefa avisa para procurar à
// mão. Corrigido para "o setor da lista acima que cuidar de vendas", mesma
// frase já usada em comercial-novo.js — divergência mecânica entre o texto
// sugerido e a Restrição Global do próprio plano, corrigida e registrada no
// relatório. "MUDANÇA DE ENDEREÇO" tinha "Comercial" maiúsculo três vezes,
// uma delas DENTRO do script entre aspas, dirigido ao cliente: essa virou
// "Para já adiantar" (nenhum script já migrado neste projeto nomeia um setor
// dentro de uma fala dirigida ao cliente); as outras duas viraram "o setor
// da lista acima que cuidar de vendas" / "esse setor" (para não repetir a
// frase inteira duas vezes seguidas na mesma instrução).
//
// ==========================================================================
// Rodada de correção 1 da Task 17 (coordenador, 2026-09-18) — duas mudanças
// ==========================================================================
// (1) entra() ganhou `&& !identidade.sgpIndisponivel`, mesma correção já
// aplicada a suporte-diagnostico.js (Pendência 2 original) e agora estendida
// aqui, a financeiro.js e a reativacao.js por autorização explícita do
// coordenador: com o SGP fora do ar, fatos.js manda não tentar boleto, PIX
// nem status — e este módulo (upgrade, ponto adicional, mudança de
// endereço) pressupõe justamente esse tipo de consulta/ação sobre o
// contrato. Deixar três módulos corrigidos (financeiro, reativação,
// suporte-diagnóstico) e este errado seria pior que qualquer um dos
// extremos.
// (2) Ganhou a mesma frase-modelo de encaminhamento ao setor de vendas que
// comercial-novo.js tem (dia x noite, ramificando em
// estado.triagem.noturno.ativo) — ele também encaminha para vendas (upgrade
// e mudança de endereço), então precisa da mesma orientação de horário que
// o coordenador decidiu centralizar nos módulos comerciais. Não interfere
// no script próprio de MUDANÇA DE ENDEREÇO (mais específico, sem "Certo!"),
// que continua como estava — mesma relação implícita "mais específico
// primeiro" que o texto original já tinha entre os dois.
// 2026-09-22: mesma correção de comercial-novo.js — o catálogo vem de
// consultar_planos, não do texto salvo nas instruções. Condicional à
// ferramenta estar no perfil do turno.
const { temFerramenta } = require('./../fontes-comerciais');

// Mesma correção de comercial-novo.js: o que decide a velocidade é o uso
// SIMULTÂNEO, não a contagem de moradores — e contar como usa é gatilho de
// recomendação, não motivo para repetir a tabela.
function recomendacaoParaClienteIdentificado(estado) {
  const consultado = temFerramenta(estado, 'consultar_planos')
    ? 'a mensalidade que consultar_planos devolveu'
    : 'a mensalidade da fonte que você usou';
  return `Antes de recomendar, entenda a necessidade pelo uso SIMULTÂNEO — quantos aparelhos ao mesmo tempo, streaming em TV, trabalho, jogo online — e não pela quantidade de moradores. Quando ele contar como usa, avance para a recomendação sem repetir a tabela; só reapresente se ele pedir para rever ou comparar. Se faltar informação, faça UMA pergunta útil sobre uso simultâneo; se o que ele contou bastar, recomende direto. Ao recomendar, diga qual plano, ${consultado} e uma frase curta de motivo, apoiado no que as instruções permitirem. Nunca empurre o mais caro, nunca invente capacidade ou desempenho e nunca invente vantagem que não esteja nas instruções.`;
}

function planosParaClienteIdentificado(estado) {
  return temFerramenta(estado, 'consultar_planos')
    ? '- Cliente JÁ identificado que pede preço ou upgrade com todas as letras: cumprimente pelo nome, diga que vai ajudar, chame consultar_planos e apresente o que ela devolver, mantendo junto o nome, a velocidade, a mensalidade e a instalação DAQUELE mesmo plano. Preço dito pelo cliente ou escrito nas instruções não substitui o que a ferramenta devolveu. Se ela não devolver plano nenhum ou falhar, não invente e não diga que consultou. Pergunte qual interessa e, com a escolha, conclua para o setor da lista acima que cuidar de vendas com o plano escolhido no resumo — sem repetir a tabela depois que ele já escolheu.'
    : '- Cliente JÁ identificado que pede preço ou upgrade com todas as letras: cumprimente pelo nome, diga que vai ajudar, e apresente os planos copiando o bloco das INSTRUÇÕES ADICIONAIS DA OPERAÇÃO exatamente como está lá. Pergunte qual interessa e, com a escolha, conclua para o setor da lista acima que cuidar de vendas com o plano escolhido no resumo.';
}

module.exports = {
  nome: 'comercial-cliente',
  entra(estado) {
    const identidade = estado.identidade || {};
    return identidade.nivel === 'forte' && !identidade.sgpIndisponivel;
  },
  linhas(estado) {
    const triagem = (estado && estado.triagem) || {};
    const noturno = Boolean(triagem.noturno && triagem.noturno.ativo);
    return [
      '',
      'Cliente com contrato nunca recebe a lista de planos, a menos que peça preço ou upgrade com todas as letras — para ele, cidade e endereço são o ponto que ele já tem, não cobertura nova.',
      planosParaClienteIdentificado(estado),
      'Se ele JÁ escolheu um plano, não liste os planos de novo: siga para o próximo passo.',
      recomendacaoParaClienteIdentificado(estado),
      'MUDANÇA DE ENDEREÇO ("vou me mudar", "quero levar a internet para outra casa"): isso é a transferência do ponto. Responda no modelo: "Claro! Mudança de endereço a gente chama de transferência do ponto. Para já adiantar, me diz o novo endereço (cidade, bairro e rua) e a data prevista da mudança?" NÃO encaminhe sem pedir isso — com a resposta, conclua para o setor da lista acima que cuidar de vendas com o endereço novo e a data no resumo. Prazo, custo e disponibilidade quem confirma é esse setor: não invente nenhum dos três.',
      noturno
        ? 'Ao encaminhar para o setor da lista acima que cuidar de vendas (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar seu atendimento. No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem.'
        : 'Ao encaminhar para o setor da lista acima que cuidar de vendas (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar você. Um atendente continuará o atendimento por aqui." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem.',
    ];
  },
};
