// Fatos: quem é o cliente, quais contratos ele tem, o que pode e não pode ser
// dito sobre a conta dele, e a data/hora de Brasília. Migração literal do
// bloco de identidade/contratos e da linha de data/hora de
// ai-orchestrator.js:montarContextoTriagem, sem mudar o sentido.
//
// Fora daqui de propósito (fica para os módulos de fluxo das tarefas
// seguintes, que hoje são só esqueleto): o aviso de cidade, o modo noturno, o
// limite de perguntas, a entrega de boleto/PIX e a leitura de comprovante —
// tudo isso é procedimento de UM fluxo específico, não fato sobre o cliente.
// "Nunca encaminhe deixando a pergunta dele sem resposta" também não é
// repetido aqui: principios.js já cobre essa regra.
//
// Rodada de correção 1 (dono, 2026-09-18): as quatro linhas de privacidade e
// dados de terceiros ("DADOS DE OUTRA PESSOA" e a exceção de fatura/boleto/PIX
// de outra pessoa) SAÍRAM daqui. Elas são conteúdo de fluxos/privacidade.js e
// fluxos/terceiros.js (Task 13) — deixá-las aqui garantiria a duplicação que
// esta entrega existe para eliminar, e o texto original em ai-orchestrator.js
// tem dois nomes reais de cliente ("Laureny", "Jureildson") que a Task 13
// precisa trocar por marcador ao migrar, não copiar verbatim. Os dois módulos
// já entram (entra() -> true) em qualquer estado de identidade; só o
// conteúdo (linhas()) ainda é esqueleto.
//
// Regras da migração (brief da Task 12): o ramo de identidade fraca não
// existe mais — só forte, none e sgpIndisponivel —, e nenhuma frase aqui
// pergunta ou cita data de nascimento (princípio do dono: não reintroduzir).

// Mesma redação de horaDeBrasilia/dataDeBrasilia em ai-orchestrator.js, mas
// recebendo a hora do ESTADO (estado.agora) em vez de ler o relógio direto:
// o compositor precisa ser determinístico em teste, e ai-orchestrator.js não
// pode ser tocado nesta tarefa (a função de lá não é exportada).
function horaDeBrasilia(agora) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(agora);
}

function dataDeBrasilia(agora) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(agora);
}

// Mesma redação de descreverContrato em ai-orchestrator.js. Não dá para
// importar de lá: a função não é exportada e o arquivo antigo fica intocado.
function descreverContrato(c) {
  const plano = c.velocidade ? `${c.plano} (${c.velocidade})` : c.plano;
  return `contrato ${c.id} — ${plano} — ${c.endereco || 'endereço não informado'} — ${c.status}`;
}

module.exports = {
  nome: 'fatos',
  entra() { return true; },
  linhas(estado) {
    const identidade = estado.identidade || { nivel: 'none', origem: 'none', primeiroNome: null, contestado: false };
    const contratos = estado.contratos || [];
    const l = [
      '',
      `Hoje é ${dataDeBrasilia(estado.agora)} e agora são ${horaDeBrasilia(estado.agora)} em Brasília. Saudação: "Bom dia" até 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" depois. Cumprimente só na primeira resposta da conversa; nas seguintes, não repita a saudação: vá direto ao assunto.`,
      '',
    ];

    if (identidade.sgpIndisponivel) {
      // Vínculo gravado + SGP fora do ar: o cliente continua identificado —
      // pedir CPF de novo a quem já foi chamado pelo nome é o pior desfecho —,
      // mas não há contratos nem consultas possíveis.
      l.push(`Cliente identificado pela memória (primeiro nome ${identidade.primeiroNome || 'cliente'}), mas o sistema do SGP NÃO respondeu agora. NÃO peça CPF e NÃO tente boleto, PIX nem status de conexão. Cumprimente pelo primeiro nome, diga em uma frase que o sistema de consulta está instável neste momento, e chame concluir_triagem para o setor adequado ao que ele pediu, com o resumo começando por "SGP indisponível na triagem".`);
    } else if (identidade.nivel === 'none') {
      l.push('Cliente NÃO identificado. Peça o CPF/CNPJ só se o setor exigir identificação (Financeiro, Suporte, Reativação), no modelo: "Vou verificar isso para você. Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor." Comercial de cliente novo nunca exige CPF. Depois de buscar_cliente, continue a triagem.');
      if (identidade.contestado) l.push('O cliente disse que o nome anterior não era dele: a identificação foi descartada. Peça o CPF.');
    } else {
      // Chegando aqui a identidade já é FORTE — é o único nível possível além
      // de 'none' —, então o endereço pode ser falado de volta ao cliente.
      l.push(`Cliente identificado (${identidade.origem === 'memory' ? 'memória' : identidade.origem === 'phone' ? 'telefone' : 'CPF'}): primeiro nome ${identidade.primeiroNome || 'cliente'}. A PRIMEIRA resposta desta conversa começa SEMPRE com a saudação da hora e o primeiro nome ("Bom dia, ${identidade.primeiroNome || 'cliente'}!"), mesmo quando você já entregou algo por ferramenta. Se ele disser que não é ele ou que o nome está errado, chame esquecer_identificacao e peça o CPF.`);
      if (contratos.length > 0) {
        l.push('Contratos dele:');
        for (const c of contratos) l.push(`- ${descreverContrato(c)}`);
        l.push('Se precisar saber de qual ponto ele fala, pergunte de uma vez pelo endereço, citando os endereços ("é o da Rua X ou o da Av. Y?"). Pergunte SÓ quando a resposta depender do ponto.');
        l.push('Nunca peça o número do contrato nem pergunte "qual contrato": o cliente não sabe. NUNCA cite o número do contrato ao cliente.');
        if (contratos.length === 1) l.push('Contrato único: use-o sem perguntar qual.');
      }
    }

    l.push(
      '',
      'Com identidade confirmada você pode dizer há quantos dias/meses a fatura está vencida e quantas faturas estão em aberto (use a data de hoje, no alto, para contar). Continua proibido dizer o VALOR.',
      'NUNCA diga ao cliente: valores e vencimentos de faturas, plano contratado ou endereço (isso vai só para o resumo). Exceções, SÓ com identidade confirmada: perguntar de qual ponto ele fala, dizer se existe ou não fatura em aberto, e dizer o status do contrato e da conexão no fluxo de SUPORTE abaixo. Nunca diga "pagamento confirmado"; nunca prometa prazos ou "um técnico vai".',
      'Preço, planos e cobertura: informe SOMENTE o que estiver escrito nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO abaixo, exatamente como está lá. Se não houver instruções ou o que o cliente pergunta não constar nelas, não invente: diga que o Comercial confirma e encaminhe.',
      'Ao pedir um esclarecimento, pergunte direto o que você precisa saber — nunca "me diga qual problema para eu encaminhar ao setor correto". O encaminhamento não se anuncia antes de acontecer.',
    );

    return l;
  },
};
