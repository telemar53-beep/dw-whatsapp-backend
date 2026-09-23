// Comercial — cliente NOVO (ainda não identificado): cobertura, planos,
// abertura de venda, endereço de instalação, documentação de cadastro e
// quando encaminhar. Migração de ai-orchestrator.js — texto-âncora "COMERCIAL
// (cobertura, planos, contratar" e "- Cliente NOVO (não identificado)" (hoje
// por volta das linhas 529-566; os números do brief estavam desatualizados,
// como o aviso da tarefa alertou — localizado por grep de texto-âncora).
//
// entra() só quando identidade.nivel === 'none': o bloco "- Cliente JÁ
// identificado" do texto antigo (planos para quem já tem contrato) NÃO está
// aqui — é conteúdo de fluxos/comercial-cliente.js (ainda esqueleto, tarefa
// futura). Pelo mesmo motivo "MUDANÇA DE ENDEREÇO" (transferência de ponto)
// não migrou: fala de um cliente que JÁ TEM um ponto para mudar, não de
// cliente novo — fica para quem preencher comercial-cliente.js.
//
// O que NÃO migrou de propósito (dado da operação, não regra — Restrição
// Global do plano):
// - "Instalação grátis." — promoção; só entra via INSTRUÇÕES ADICIONAIS DA
//   OPERAÇÃO (painel.js), nunca hardcoded aqui.
// - "Temos planos de internet 100% fibra óptica" — afirmação comercial
//   específica. A abertura agora diz só "Temos estes planos:".
// - "500 Mega", "R$ 100/mês" (linhas reais de plano do texto antigo) — o
//   formato de reserva (quando as instruções não trazem um bloco pronto)
//   vira "• [velocidade] por R$ [valor]/mês".
// - "Centro de Godofredo Viana" (bairro/cidade reais do exemplo de
//   confirmação de endereço) — vira "[bairro], [cidade]".
// - "Comercial"/"Financeiro" como nome fixo de setor — toda referência aponta
//   para "o setor da lista acima que cuidar de vendas" (painel.js injeta a
//   lista real de estado.setores; mesmo idioma já usado em fatos.js/
//   painel.js). Isso inclui o próprio rótulo da seção: o texto antigo usava
//   "COMERCIAL" como cabeçalho — aqui virou "VENDA" (assunto, não nome de
//   setor) para não nomear um setor que pode não existir com esse nome na
//   operação.
//
// Também NÃO migrado (achado ao ler o entorno, fora do escopo desta tarefa):
// "Fim de roteiro NÃO é automático" e "Ao concluir, o resumo é para o
// atendente" (ai-orchestrator.js, linhas vizinhas) são princípios GERAIS
// (valem para qualquer fluxo, não só comercial) — não estão nas âncoras desta
// tarefa e não são específicos daqui; ver preocupação no relatório.
//
// Os templates entre aspas ("no modelo: ...") são exemplo para o modelo
// adaptar — mesmo padrão já usado em privacidade.js/terceiros.js/fatos.js —,
// não roteiro fixo: por isso a saudação vira "(saudação da hora)" em vez de
// cravar "Boa noite!" (fatos.js já resolve qual saudação usar; repetir uma
// saudação fixa aqui poderia contradizer aquela regra).
//
// Rodada de correção 1 (dono, 2026-09-18): a frase de recomendação de plano
// dizia "a diferença é só a velocidade (todos fibra)" — o parêntese afirma
// que TODOS os planos da operação são fibra, o mesmo dado proibido que já
// tinha sido removido da abertura como "100% fibra óptica" (linha 19 acima),
// só reescrito mais adiante no mesmo parágrafo original. Este chat é vendido
// para outras operações; nem toda uma vende só fibra. Parêntese removido; se
// a operação quiser afirmar isso, vem das Instruções adicionais do painel.
//
// ==========================================================================
// Rodada de correção 1 da Task 17 (coordenador, 2026-09-18) — encaminhamento
// comercial ganha noção de horário
// ==========================================================================
// A frase-modelo "Ao encaminhar para o Comercial..." (ai-orchestrator.js:
// 569-571, um ternário com metade noturna e metade diurna) tinha ficado sem
// dono entre a Task 14 (este módulo) e a Task 16 (comercial-cliente.js): a
// Task 17 (primeira rodada) migrou só a metade NOTURNA, para noturno.js — a
// metade DIURNA continuou sem lar. O coordenador decidiu que as DUAS metades
// formam um conceito só ("como encaminhar para vendas") e devem morar juntas
// aqui (e em comercial-cliente.js, que também encaminha para vendas — ver lá),
// ramificando em estado.triagem.noturno.ativo, em vez de partidas entre
// noturno.js e os módulos comerciais.
// Nomes de setor: "Comercial" saiu de dentro e de fora do script entre aspas
// (mesma convenção já usada no resto deste módulo — "o setor da lista acima
// que cuidar de vendas"; dentro da fala dirigida ao cliente, "nossa equipe
// Comercial"/"para o Comercial" viraram só "nossa equipe"/"você", sem nome).
// Não duplica a instrução de resumo ("Ao encaminhar, o resumo inclui...",
// logo abaixo): ela já cobre as duas metades.
// 2026-09-22: a ordem de "copiar o bloco de planos das INSTRUÇÕES ADICIONAIS"
// saiu daqui. Com consultar_planos no ar, o preço vem do cadastro; mandar
// copiar o texto salvo deixava duas ordens conflitantes no mesmo prompt, e a
// antiga ganhava. As instruções continuam valendo para política comercial,
// promoções, critério de recomendação e documentação — não para o catálogo.
//
// O texto é condicional à ferramenta ESTAR no perfil do turno: mandar chamar
// uma ferramenta que não existe ali é o jeito conhecido de o modelo afirmar
// que consultou.
const { temFerramenta } = require('./../fontes-comerciais');
const { ROTULO_DE_PLANO } = require('./../formato-plano');
const { QUANTIDADE_NAO_E_USO, CATALOGO_JA_APRESENTADO, AGRADECIMENTO_NAO_E_INTENCAO } = require('./../regra-recomendacao');

// 2026-09-22, teste real: depois de ver os quatro planos, o cliente disse
// "tenho 2 TVs e 7 filhos" e a IA repetiu a tabela inteira e recomendou pela
// quantidade de filhos. A regra antiga só disparava quando ele PEDIA indicação,
// e mandava perguntar "quantas pessoas" — que é justamente o número que não
// decide velocidade. Quem decide é o uso SIMULTÂNEO.
function recomendacaoDePlano(estado) {
  const consultado = temFerramenta(estado, 'consultar_planos')
    ? 'a mensalidade que consultar_planos devolveu'
    : 'a mensalidade da fonte que você usou';
  return [
    'RECOMENDAÇÃO — vale quando ele pedir indicação OU quando ele contar como vai usar (pessoas, aparelhos, TVs, trabalho, jogos), mesmo sem perguntar nada:',
    CATALOGO_JA_APRESENTADO,
    QUANTIDADE_NAO_E_USO,
    `Ao recomendar: diga qual plano, ${consultado} e uma frase curta de motivo apoiada no que ELE contou. Se as instruções trouxerem critério de recomendação, siga-o. NUNCA invente capacidade ("aguenta X aparelhos", "dá para N pessoas") nem garanta desempenho, e nunca empurre o mais caro.`,
    'Nunca encaminhe deixando uma pergunta dele sem resposta: responda primeiro, na mesma mensagem.',
  ].join(' ');
}

function vendaComFerramenta(estado) {
  const comPlanos = temFerramenta(estado, 'consultar_planos');
  const comCobertura = temFerramenta(estado, 'verificar_cobertura');

  // Só a FONTE muda. O formato da linha, o "Atendemos em X!", a emenda na
  // mesma mensagem e o "não encaminhe na primeira resposta" são comportamento
  // de venda e continuam iguais nos dois caminhos.
  const planos = comPlanos
    ? `Planos: chame consultar_planos e responda com o que ela devolver, um plano por linha começando com "• ": ${ROTULO_DE_PLANO}. Nunca monte uma linha juntando pedaços de planos diferentes. Preço que o cliente disse ter ouvido, valor que apareceu antes na conversa ou tabela escrita nas instruções NÃO substituem o que a ferramenta devolveu. Se ela não devolver plano nenhum ou falhar, NÃO invente e NÃO diga que consultou: diga que a equipe confirma os valores e conclua para o setor da lista acima que cuidar de vendas.`
    : 'Planos: copie o bloco de planos EXATAMENTE como está escrito nas instruções (mesmas linhas, mesmos ícones, mesmos preços); se lá não houver um bloco pronto, liste um plano por linha no formato "• [velocidade] por R$ [valor]/mês".';

  const cobertura = comCobertura
    ? 'Cobertura: chame verificar_cobertura com o lugar que ele disse. Com "atendida", responda "Atendemos em X!" e, NA MESMA mensagem, emende a abertura de cliente novo (planos e a pergunta de endereço) — a pergunta de cobertura é o começo da venda, não o fim; atender o local não promete instalação em qualquer endereço. NUNCA encaminhe um cliente novo na primeira resposta quando a ferramenta disser que atendemos. Com "precisa_verificar_viabilidade", NÃO diga que não atendemos: diga que a equipe confirma a viabilidade para o endereço dele e conclua para o setor da lista acima que cuidar de vendas, sem inventar.'
    : 'Cobertura: se a cidade estiver nas instruções, atendemos em TODOS os bairros e ruas dela. Pergunta de cobertura de cliente novo ("tem internet em X?"): responda "Atendemos em X!" e, NA MESMA mensagem, emende a abertura de cliente novo (planos e a pergunta de endereço) — a pergunta de cobertura é o começo da venda, não o fim. NUNCA encaminhe um cliente novo na primeira resposta se a cidade estiver na lista. Se a cidade NÃO estiver na lista de cobertura, diga que a equipe confirma a cobertura e conclua para o setor da lista acima que cuidar de vendas, sem inventar.';

  return `VENDA (cobertura, planos, contratar, mudar de plano): ${planos} Nunca peça CPF ou CNPJ de cliente novo. ${cobertura}`;
}

function blocoDePlanos(estado) {
  return temFerramenta(estado, 'consultar_planos')
    ? '[os planos que consultar_planos devolveu, um por linha]'
    : '[bloco de planos das instruções]';
}

module.exports = {
  nome: 'comercial-novo',
  entra(estado) {
    return (estado.identidade || {}).nivel === 'none';
  },
  linhas(estado) {
    const triagem = (estado && estado.triagem) || {};
    const noturno = Boolean(triagem.noturno && triagem.noturno.ativo);
    return [
      '',
      'A tabela de planos é SÓ para cliente NÃO identificado que pergunta sobre contratar, preço ou cobertura.',
      vendaComFerramenta(estado),
      'Se ele disser que JÁ é cliente e quer outro ponto ou mudar de plano, identifique-o primeiro (peça CPF ou CNPJ) e use o roteiro de cliente identificado. Não liste todas as cidades atendidas: pergunte a cidade e o bairro dele e confirme só a dele.',
      [
        'Abertura de cliente novo, no modelo: "(saudação da hora) 😊 Temos estes planos:',
        '',
        blocoDePlanos(estado),
        '',
        'Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua." "Que bom ter você por aqui 😊" pode entrar depois da saudação.',
        'Endereço é UMA pergunta só (bairro e rua juntos). Se ele responder só uma parte, confirme o que veio e peça só o que falta, UMA vez: "Perfeito, [bairro], [cidade] 👍 Qual é a rua onde deseja instalar?" Nunca peça a mesma coisa uma terceira vez. Se ele mudar de assunto ou perguntar algo, responda e siga sem voltar a cobrar o endereço. Não é preciso ter o endereço completo para encaminhar.',
        recomendacaoDePlano(estado),
      ].join('\n'),
      'O QUE PRECISA PARA FAZER O CADASTRO ("quais dados/documentos preciso", "o que preciso levar"): se as INSTRUÇÕES ADICIONAIS DA OPERAÇÃO trouxerem a lista de documentos ou dados necessários, responda com a lista exatamente como está lá e pergunte se ele quer seguir com a contratação. Se lá não houver nada sobre isso, diga em uma frase que a equipe confirma a documentação e encaminhe para o setor da lista acima que cuidar de vendas — mas NÃO encaminhe sem responder alguma coisa.',
      // 2026-09-22, teste real: com o lugar já dito, "já tiver dado o endereço"
      // virava gatilho PERMANENTE de encaminhamento — e a mensagem seguinte do
      // cliente ("tenho 2 TVs e 7 filhos"), que é pedido de ajuda para
      // escolher, caiu direto no "Vou encaminhar". A frase seguinte nomeia o
      // caso observado apontando para a RECOMENDAÇÃO acima, sem reescrevê-la.
      //
      // Terceira rodada do mesmo teste: o qualificador que eu tinha posto ali
      // ("E não houver mais nada de venda para tratar") resolveu o meio da
      // venda e QUEBROU o fim dela. "Ok muito obrigado", depois da
      // recomendação, é a leitura mais clara possível de "não há mais nada de
      // venda para tratar" — e virou "Vou encaminhar você para o Comercial".
      // A cláusula deixa de se apoiar na AUSÊNCIA de assunto e passa a exigir a
      // PRESENÇA de intenção dita com todas as letras.
      `Encaminhe para o setor da lista acima que cuidar de vendas SOMENTE quando: ele escolher um plano ou pedir para contratar; ou já tiver dado o endereço E disser que quer seguir com a contratação ou a instalação; ou pedir para falar com um atendente; ou a cidade não estiver na lista. Ele contar como usa (pessoas, aparelhos, TVs, trabalho, jogos) NÃO é pedido de encaminhamento: é pedido de ajuda para escolher, e já ter o endereço não autoriza encerrar aí — siga a RECOMENDAÇÃO acima. ${AGRADECIMENTO_NAO_E_INTENCAO} Antes disso, continue a venda (planos, endereço, dúvidas). O "Certo!" é só quando ele pediu algo (contratar, falar com atendente); senão comece direto em "Vou encaminhar...".`,
      noturno
        ? 'Ao encaminhar para o setor da lista acima que cuidar de vendas (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar seu atendimento. No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem.'
        : 'Ao encaminhar para o setor da lista acima que cuidar de vendas (na MESMA resposta em que chama concluir_triagem), responda no modelo: "Certo! 😊 Vou encaminhar você. Um atendente continuará o atendimento por aqui." Se houver uma pergunta dele pendente, responda-a ANTES dessa frase, na mesma mensagem.',
      'Ao encaminhar, o resumo inclui: plano de interesse, cidade, bairro/rua se tiver, e o que ele contou.',
    ];
  },
};
