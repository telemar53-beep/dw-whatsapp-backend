// BLOQUEADO (Task 14, 2026-09-18) — ver task-14-report.md para o achado
// completo, com comandos e evidência. Resumo:
//
// O brief desta tarefa pede que este módulo receba "Cliente NÃO
// identificado. Peça o CPF/CNPJ" (ai-orchestrator.js:364) e a linha de
// contestação (:365) — mas esse EXATO conteúdo já está em fatos.js (ramo
// identidade.nivel === 'none'), colocado lá pela implementação original da
// Task 12 (commit 6a1cd3b) e mantido de pé por 3 rodadas de revisão daquela
// tarefa, incluindo uma que editou essa PRÓPRIA linha por outro motivo (nome
// de setor fixo, commit cabe5cf) sem movê-la para um módulo de fluxo — ao
// contrário de privacidade/terceiros, que tinham comentário explícito
// ("Rodada de correção 1... saíram daqui") e teste-tripwire documentando a
// mudança de camada antes da Task 13 preencher os dois. fatos.test.js também
// afirma esse conteúdo POSITIVAMENTE (describe('cliente não identificado')),
// revisado e aprovado junto com o resto da Task 12.
//
// Preencher linhas() aqui do jeito que o brief pede duplicaria a instrução
// toda vez que o cliente não estiver identificado: fatos.js entra sempre
// (entra() -> true) e este módulo entraria exatamente no mesmo estado
// (nivel === 'none') — o oposto do que as Tasks 12 e 13 vêm ativamente
// evitando (é o mesmo "DEFEITO DO PLANO" que a Task 12 corrigiu para
// privacidade/terceiros, agora seguindo despercebido para identificação).
// Mover o conteúdo de fatos.js para cá, por conta própria, desfaria uma
// decisão revisada 3 vezes sem autorização explícita para tocar naquele
// arquivo — esta tarefa só autoriza preencher identificacao.js e
// comercial-novo.js.
//
// entra() abaixo está implementado e testado (contrato dado pela tarefa:
// nivel === 'none' OU identidade.contestado) — é inequívoco e não depende da
// decisão pendente. linhas() fica vazio (não contribui NADA ao prompt ainda)
// até alguém decidir entre mover o conteúdo de fatos.js para cá ou corrigir
// o brief desta tarefa para refletir que fatos.js já cobre isso.
module.exports = {
  nome: 'identificacao',
  entra(estado) {
    const identidade = estado.identidade || {};
    return identidade.nivel === 'none' || Boolean(identidade.contestado);
  },
  linhas() { return []; },
};
