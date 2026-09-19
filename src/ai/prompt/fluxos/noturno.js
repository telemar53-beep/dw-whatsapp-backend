// Noturno — modo noturno: não há atendente, a hora de retorno, e o roteiro
// de conexão à noite (com os dois passos simples de religar o equipamento).
// Migração de ai-orchestrator.js — âncoras (números reais, conferidos por
// grep; o do brief/plano ":394-404" estava desatualizado, mesmo padrão
// avisado pelas Tasks 13-16):
// - "MODO NOTURNO:" — linha 337.
// - "Ao concluir para um setor à noite" — linha 338.
// - "CONEXÃO À NOITE:" — linha 346.
//
// entra() é triagem.noturno.ativo: as três linhas acima só faziam sentido
// dentro do mesmo `if (triagem && triagem.noturno && triagem.noturno.ativo)`
// no original.
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
// PENDÊNCIA 3 (Rodada de correção 1, coordenador, 2026-09-18) — o
// encaminhamento comercial noturno SAIU daqui
// ==========================================================================
// A primeira versão deste módulo (Task 17, antes da rodada de correção)
// tinha migrado só a metade NOTURNA do ternário de encaminhamento ao
// Comercial (ai-orchestrator.js:569-571) para aqui. O coordenador mediu que
// a metade DIURNA do mesmo ternário ("Vou encaminhar você para o Comercial.
// Um atendente continuará o atendimento por aqui.") nunca tinha sido migrada
// por nenhuma tarefa — sumiu entre a Task 14 (comercial-novo.js) e a Task 16
// (comercial-cliente.js), que cobrem QUANDO encaminhar mas não tinham essa
// frase-modelo.
//
// Decisão do coordenador: as DUAS metades (dia e noite) formam UM conceito
// só — como encaminhar para vendas — e ficam JUNTAS num único lugar, nos
// módulos comerciais (comercial-novo.js e comercial-cliente.js, cada um
// ramificando em estado.triagem.noturno.ativo), em vez de partidas entre
// noturno.js (que tem noção de horário) e os módulos comerciais (que têm
// noção de quando encaminhar). Motivo explícito: mantê-las separadas
// arriscava noturno.js e o módulo comercial emitirem frases concorrentes de
// encaminhamento à noite.
//
// A linha de encaminhamento comercial que existia aqui foi REMOVIDA. Ela
// agora mora em comercial-novo.js (Task 17, correção) e comercial-cliente.js
// (idem — verificado que ele também encaminha para vendas e precisava da
// mesma frase). Este módulo (noturno.js) manteve só o que é genuinamente
// AGNÓSTICO de setor: modo noturno, a regra geral de "ao concluir para um
// setor à noite" (qualquer setor, não só vendas) e conexão à noite.
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
      `CONEXÃO À NOITE: os roteiros de suporte (consulte consultar_status_todos_contratos antes). Depois da pergunta de diagnóstico, faça ATÉ DUAS etapas simples, uma por mensagem: "Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?" e depois "A luz voltou a ficar verde?". Se resolver, conclua para o setor da lista acima que cuidar de suporte dizendo que ficou registrado que a conexão voltou. Se não resolver, conclua para o setor da lista acima que cuidar de suporte respondendo no modelo: "Vou deixar seu atendimento na fila com tudo o que verificamos. Nossa equipe dá continuidade a partir das ${retornoAs}." Sem prometer técnico nem prazo. Contrato suspenso por pendência: roteiro do suspenso e, se vier comprovante, o roteiro do comprovante.`,
    ];
  },
};
