// Aviso de cidade — falha regional ativa: cita o aviso e suprime o roteiro
// normal de diagnóstico (nada de pedir para reiniciar equipamento nem
// prometer previsão) enquanto ele durar. Migração de ai-orchestrator.js —
// âncora "AVISO ATIVO NA CIDADE DO CLIENTE", hoje linhas 328-329 (o brief e o
// plano citavam ":387-390", desatualizado — mesmo padrão avisado pelas Tasks
// 13-16; localizado por grep de texto-âncora).
//
// entra() é Boolean(estado.avisoCidade): no original este bloco fica fora e
// ANTES de todo o if/else de identidade (linha 326, logo depois da lista de
// ferramentas de comprovante) — não depende de o cliente estar identificado.
// Faz sentido: uma falha regional afeta quem liga reclamando de internet
// mesmo antes de qualquer identificação.
//
// Nomes de setor (Restrição Global — mesmo idioma de fatos.js/financeiro.js/
// noturno.js/suporte-*.js): "conclua para o Suporte" virou "conclua para o
// setor da lista acima que cuidar de suporte".
//
// Cruza com suporte-diagnostico.js (Task 15): a linha "JÁ NORMALIZOU?" de lá
// já cita "se houver aviso ativo na cidade dele, use o aviso" — é só uma
// REFERÊNCIA cruzada ao aviso (não repete o conteúdo deste módulo), sem
// duplicação: quando os dois módulos entram juntos (cliente identificado com
// aviso ativo), o texto real do aviso só aparece uma vez, aqui.
const { suspensaoAfastaOAviso } = require('../../regional-outage');

module.exports = {
  nome: 'aviso-cidade',
  entra(estado) {
    return Boolean(estado.avisoCidade);
  },
  linhas(estado) {
    const aviso = estado.avisoCidade;
    // P1-1 (auditoria final, 25/09/2026): o aviso NÃO explica suspensão — a mesma regra das
    // ferramentas de status (regional-outage.suspensaoAfastaOAviso). Com contrato suspenso já
    // conhecido, a regra "sem acesso → falha regional" nem aparece; sem contrato conhecido (ele pode
    // ser identificado no meio do turno), a exceção vai junto.
    const contratos = estado.contratos || [];
    const suspensos = contratos.filter((c) => c && c.status === 'suspenso');
    let regra;
    if (!suspensaoAfastaOAviso(contratos)) {
      regra = 'Se ele reclamar de internet lenta, caindo ou sem acesso: informe que há uma falha regional em andamento nesse local (use o aviso acima), NÃO peça verificações de equipamento, NÃO prometa previsão, e conclua para o setor da lista acima que cuidar de suporte na mesma resposta com "falha regional" no resumo. Se o assunto for outro, atenda normalmente. Contrato SUSPENSO não é falha regional: se o contrato dele constar suspenso, a falta de acesso é a suspensão — use o roteiro do contrato suspenso e nunca atribua ao aviso.';
    } else if (suspensos.length === contratos.length) {
      regra = 'O contrato dele consta SUSPENSO: a falta de acesso é a suspensão, não a falha regional. Use o roteiro do contrato suspenso (fatura em aberto) e NÃO atribua a falta de acesso ao aviso acima.';
    } else {
      regra = `Contrato(s) que consta(m) SUSPENSO(s): ${suspensos.map((c) => c.endereco || 'sem endereço').join('; ')}. A falta de acesso de contrato suspenso é a suspensão, não a falha regional — use o roteiro do contrato suspenso para ele. Para um contrato ativo, vale a falha regional acima. Se ainda não souber de qual endereço ele fala, pergunte de qual endereço é antes de apontar a causa.`;
    }
    return [
      '',
      // Rotulo neutro: o aviso selecionado pode ser do municipio OU do povoado,
      // e `aviso.cidade` ja traz o nome do lugar que venceu a selecao. Dizer
      // "cidade do cliente" seria errado quando quem vence e a localidade.
      `AVISO ATIVO PARA ${aviso.cidade}: ${aviso.mensagem}`,
      regra,
      // Um aviso por turno (25/09/2026): quando o próprio turno já mandou o aviso ao cliente, o
      // fato continua acima, mas repetir a ocorrência seria a segunda mensagem sobre o mesmo assunto.
      ...(aviso.enviadoNesteTurno === true
        ? ['Esse aviso JÁ FOI ENVIADO ao cliente agora, em mensagem separada: NÃO repita a ocorrência nem o texto do aviso; responda só ao que ele disse, sem pedir testes de equipamento.']
        : []),
    ];
  },
};
