// Noturno — modo noturno: não há atendente, a hora de retorno, o roteiro de
// conexão à noite (com os dois passos simples de religar o equipamento) e o
// encaminhamento ao setor de vendas à noite. Migração de ai-orchestrator.js —
// âncoras (números reais, conferidos por grep; o do brief/plano ":394-404"
// estava desatualizado, mesmo padrão avisado pelas Tasks 13-16):
// - "MODO NOTURNO:" — linha 337.
// - "Ao concluir para um setor à noite" — linha 338.
// - "CONEXÃO À NOITE:" — linha 346.
// - "Ao encaminhar para o Comercial ... No momento estamos fora do horário"
//   — linha 570 (SÓ o ramo noturno do ternário) — ver PENDÊNCIA 3 abaixo.
//
// entra() é triagem.noturno.ativo: as quatro linhas acima só faziam sentido
// dentro do mesmo `if (triagem && triagem.noturno && triagem.noturno.ativo)`
// no original (as três primeiras) ou do mesmo teste de noturno (a quarta,
// dentro do ternário de encaminhamento ao Comercial).
//
// Nomes de setor (Restrição Global — "o setor da lista acima que cuidar de
// X", mesmo idioma de fatos.js/financeiro.js/suporte-*.js): "os mesmos
// roteiros de Suporte" virou "os mesmos roteiros de suporte" (minúsculo — é
// o ASSUNTO, não o nome do setor, mesmo padrão já usado por suporte-geral.js
// em "é pedido normal de suporte"). As duas ocorrências de "conclua para o
// Suporte" (fora de aspas, instrução ao modelo) viraram "conclua para o
// setor da lista acima que cuidar de suporte", por extenso as duas vezes
// (sem pronome — mesma cautela já registrada em comprovante.js depois do
// achado de pronome ambíguo da Rodada de correção 1 da Task 16). Dentro do
// script ENTRE ASPAS dirigido ao cliente ("Vou deixar seu atendimento na
// fila do Suporte..."), "do Suporte" foi removido por completo — não
// abreviado para minúsculo —, mesmo tratamento que comercial-cliente.js já
// deu a "Para o Comercial já adiantar" -> "Para já adiantar": nenhum script
// dirigido ao cliente, em nenhum módulo já migrado neste projeto, nomeia um
// setor específico, porque a lista real de setores é dinâmica (vem do
// painel) e pode não ter um setor chamado exatamente "Suporte".
//
// ==========================================================================
// PENDÊNCIA 3 — o encaminhamento comercial NOTURNO, sem dono desde a Task 14
// ==========================================================================
// Achado da revisão da Task 14 (registrado em progress.md, gap "d"): a frase
// que avisa "estamos fora do horário de atendimento, mas sua conversa ficará
// registrada" (ai-orchestrator.js:570, SÓ o ramo noturno do ternário de
// encaminhamento ao Comercial) nunca foi migrada — comercial-novo.js e
// comercial-cliente.js (Tasks 14 e 16) cobrem QUANDO encaminhar e o "Certo!"
// condicional, mas nenhum dos dois tem noção de horário. noturno.js é quem
// tem: por isso a linha abaixo, adaptada para não nomear o setor ("Comercial"
// -> "o setor da lista acima que cuidar de vendas", mesma convenção já usada
// em comercial-novo.js/comercial-cliente.js) e sem repetir a instrução de
// resumo ("plano de interesse, cidade, bairro/rua...") que comercial-novo.js
// já dá (repetir duplicaria a instrução sempre que os dois módulos entrarem
// juntos, o que acontece toda vez que for noite e o cliente for novo).
// Dentro do script entre aspas, "nossa equipe Comercial" perdeu o nome do
// setor pelo mesmo motivo do parágrafo anterior — virou só "nossa equipe".
//
// Por que este template (mais longo, específico de vendas) coexiste com a
// regra genérica de "Ao concluir para um setor à noite" (qualquer setor, uma
// frase-padrão "nossa equipe dá continuidade a partir das X"): o texto
// original já tinha essa dualidade — um one-liner genérico para QUALQUER
// setor, e um script mais elaborado só para o encaminhamento ao setor de
// vendas à noite (com "Certo!", "sua conversa ficará registrada" etc.).
// Preservado tal como estava — "sem mudar o sentido" não é licença para
// unificar os dois em prol de brevidade.
//
// NÃO migrado aqui, de propósito: a metade DIURNA do mesmo ternário ("Vou
// encaminhar você para o Comercial. Um atendente continuará o atendimento por
// aqui.") não é específica de noite — não é âncora desta tarefa nem estado
// que os seis módulos cobrem; seguiria sem dono se não fosse pelo fato de que
// o padrão de "Vou encaminhar..." genérico já está coberto, em espírito, por
// comercial-novo.js ('O "Certo!" do modelo é só quando ele pediu algo... senão
// comece direto em "Vou encaminhar..."'). Ver preocupação no relatório.
module.exports = {
  nome: 'noturno',
  entra(estado) {
    const triagem = estado.triagem || {};
    return Boolean(triagem.noturno && triagem.noturno.ativo);
  },
  linhas(estado) {
    const retornoAs = estado.triagem.noturno.retornoAs;
    return [
      '',
      `MODO NOTURNO: estamos fora do horário comercial e NÃO há atendente agora. Você atende sozinha o que as ferramentas permitem e deixa na fila, com resumo, o que precisa de gente. A equipe volta às ${retornoAs}. Nunca prometa solução imediata, técnico ou prazo.`,
      `Ao concluir para um setor à noite, diga que "nossa equipe dá continuidade a partir das ${retornoAs}" — nunca "um atendente continua daqui".`,
      `CONEXÃO À NOITE: os mesmos roteiros de suporte (consulte consultar_status_todos_contratos antes). Depois da pergunta de diagnóstico, faça ATÉ DUAS etapas simples, uma por mensagem: "Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?" e depois "A luz voltou a ficar verde?". Se resolver, conclua para o setor da lista acima que cuidar de suporte dizendo que ficou registrado que a conexão voltou. Se não resolver, conclua para o setor da lista acima que cuidar de suporte respondendo no modelo: "Vou deixar seu atendimento na fila com tudo o que verificamos. Nossa equipe dá continuidade a partir das ${retornoAs}." Sem prometer técnico nem prazo. Contrato suspenso por pendência: roteiro do suspenso e, se vier comprovante, o roteiro do comprovante.`,
      'Ao encaminhar à noite para o setor da lista acima que cuidar de vendas (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar seu atendimento. No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem.',
    ];
  },
};
