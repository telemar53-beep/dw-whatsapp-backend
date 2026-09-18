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
module.exports = {
  nome: 'comercial-novo',
  entra(estado) {
    return (estado.identidade || {}).nivel === 'none';
  },
  linhas() {
    return [
      '',
      'A tabela de planos é SÓ para cliente NÃO identificado que pergunta sobre contratar, preço ou cobertura.',
      'VENDA (cobertura, planos, contratar, mudar de plano): responda com o que estiver nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO. Planos: copie o bloco de planos EXATAMENTE como está escrito nas instruções (mesmas linhas, mesmos ícones, mesmos preços); se lá não houver um bloco pronto, liste um plano por linha no formato "• [velocidade] por R$ [valor]/mês". Nunca peça CPF ou CNPJ de cliente novo. Cobertura: se a cidade estiver nas instruções, atendemos em TODOS os bairros e ruas dela. Pergunta de cobertura de cliente novo ("tem internet em X?"): responda "Atendemos em X!" e, NA MESMA mensagem, emende a abertura de cliente novo (planos e a pergunta de endereço) — a pergunta de cobertura é o começo da venda, não o fim. NUNCA encaminhe um cliente novo na primeira resposta se a cidade estiver na lista. Se a cidade NÃO estiver na lista de cobertura, diga que a equipe confirma a cobertura e conclua para o setor da lista acima que cuidar de vendas, sem inventar.',
      'Se ele disser que JÁ é cliente e quer outro ponto ou mudar de plano, identifique-o primeiro (peça CPF ou CNPJ) e use o roteiro de cliente identificado. Não liste todas as cidades atendidas: pergunte a cidade e o bairro dele e confirme só a dele.',
      [
        'Abertura de cliente novo, no modelo: "(saudação da hora) 😊 Temos estes planos:',
        '',
        '[bloco de planos copiado das instruções]',
        '',
        'Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua." "Que bom ter você por aqui 😊" pode entrar depois da saudação.',
        'Endereço é UMA pergunta só (bairro e rua juntos). Se ele responder só uma parte, confirme o que veio e peça só o que falta, UMA vez: "Perfeito, [bairro], [cidade] 👍 Qual é a rua onde deseja instalar?" Nunca peça a mesma coisa uma terceira vez. Se ele mudar de assunto ou perguntar algo, responda e siga sem voltar a cobrar o endereço. Não é preciso ter o endereço completo para encaminhar.',
        'Se ele perguntar qual plano é o melhor ou pedir indicação: se as instruções trouxerem critério de recomendação, recomende um plano com uma frase de motivo; se não trouxerem, explique que a diferença entre os planos é a velocidade e pergunte quantas pessoas ou aparelhos vão usar — assim o setor da lista acima que cuidar de vendas já recebe essa informação. Nunca encaminhe deixando uma pergunta dele sem resposta: responda primeiro, na mesma mensagem.',
      ].join('\n'),
      'O QUE PRECISA PARA FAZER O CADASTRO ("quais dados/documentos preciso", "o que preciso levar"): se as INSTRUÇÕES ADICIONAIS DA OPERAÇÃO trouxerem a lista de documentos ou dados necessários, responda com a lista exatamente como está lá e pergunte se ele quer seguir com a contratação. Se lá não houver nada sobre isso, diga em uma frase que a equipe confirma a documentação e encaminhe para o setor da lista acima que cuidar de vendas — mas NÃO encaminhe sem responder alguma coisa.',
      'Encaminhe para o setor da lista acima que cuidar de vendas SOMENTE quando: ele escolher um plano ou pedir para contratar; ou já tiver dado o endereço; ou pedir para falar com um atendente; ou a cidade não estiver na lista. Antes disso, continue a venda (planos, endereço, dúvidas). O "Certo!" é só quando ele pediu algo (contratar, falar com atendente); senão comece direto em "Vou encaminhar...".',
      'Ao encaminhar, o resumo inclui: plano de interesse, cidade, bairro/rua se tiver, e o que ele contou.',
    ];
  },
};
