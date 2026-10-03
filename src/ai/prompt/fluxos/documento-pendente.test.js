const modulo = require('./documento-pendente');
const { estadoBase } = require('../estado-de-teste');

// Documento pendente (25/09/2026): o fato "o documento já foi pedido e ainda não veio" entra no
// prompt só quando existe — sem ele, o prompt é o de antes.
const PENDENTE = { alvo: 'principal', assunto: 'suporte', mudouDeAssunto: false, retomou: false, mudancaRelevante: false, irritado: false, mandouOProprioDocumento: false };
const texto = (documento) => modulo.linhas(estadoBase({ documento })).join('\n');

describe('módulo documento-pendente', () => {
  test('sem pendência, não entra', () => {
    expect(modulo.entra(estadoBase())).toBe(false);
    expect(modulo.entra(estadoBase({ documento: PENDENTE }))).toBe(true);
  });

  test('pendente e sem avanço: não pedir de novo, responder ao que ele disse, ação continua bloqueada', () => {
    const t = texto(PENDENTE);
    expect(t).toMatch(/DOCUMENTO JÁ PEDIDO/);
    expect(t).toMatch(/NÃO peça de novo a cada mensagem, nem com outras palavras/);
    expect(t).toMatch(/continua sem poder ser feito/);
    expect(t).toMatch(/identificação pendente/);
  });

  test('mudou de assunto: a última intenção vence', () => {
    expect(texto({ ...PENDENTE, mudouDeAssunto: true })).toMatch(/Ele mudou de assunto depois do pedido: responda ao assunto novo/);
  });

  test('voltou ao assunto que depende da identificação: lembrete curto e natural', () => {
    expect(texto({ ...PENDENTE, retomou: true, mudancaRelevante: true })).toMatch(/lembre do documento numa frase curta e natural/);
  });

  test('irritado: não pedir de novo agora, não discutir', () => {
    expect(texto({ ...PENDENTE, irritado: true })).toMatch(/Ele se incomodou com o pedido: NÃO peça de novo agora, não discuta/);
  });

  // Número recebido != identidade confirmada (ajuste de 25/09/2026).
  test('número recebido, ainda não confirmado: tentar, e pedir para conferir se não localizar não é repetir', () => {
    const t = texto({ ...PENDENTE, documentoRecebido: true, mudancaRelevante: true });
    expect(t).toMatch(/DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO/);
    expect(t).toMatch(/a identificação só está feita quando o cadastro for localizado/);
    expect(t).toMatch(/peça para conferir o número, numa frase: isso não é repetir o pedido/);
    expect(t).not.toMatch(/DOCUMENTO JÁ PEDIDO/);
    expect(texto({ ...PENDENTE, alvo: 'terceiro', documentoRecebido: true, mudancaRelevante: true })).toMatch(/titularEOutraPessoa: true/);
  });

  // F1, terceira revisão (30/09/2026): o código concede UM esclarecimento por cadeia de pedidos; se ele
  // cabe, quem decide é o modelo, lendo a conversa — não uma lista de frases. Sem a linha própria, o
  // código permitiria e a linha padrão continuaria proibindo.
  const DISPONIVEL = { ...PENDENTE, pedidosNaCadeia: 1, esclarecimentoUsado: false, esclarecimentoDisponivel: true, numeroNaCadeia: false };
  const USADO = { ...PENDENTE, pedidosNaCadeia: 2, esclarecimentoUsado: true, esclarecimentoDisponivel: false, numeroNaCadeia: false };

  test('esclarecimento disponível: possibilidade, não ordem — o modelo decide lendo a última mensagem', () => {
    const t = texto(DISPONIVEL);
    expect(t).toMatch(/DOCUMENTO JÁ PEDIDO/);
    expect(t).toMatch(/Se ele TENTOU responder sem o dado/);
    expect(t).toMatch(/você pode esclarecer UMA vez/);
    expect(t).toMatch(/Se ele está explicando o problema ou pediu outra coisa, não peça de novo/);
    expect(t).not.toMatch(/NÃO peça de novo a cada mensagem, nem com outras palavras/);
    expect(t).not.toMatch(/Peça o CPF/);
  });

  test('esclarecimento disponível: nada do que ele disser sem o documento identifica, consulta ou encaminha', () => {
    const t = texto(DISPONIVEL);
    expect(t).toMatch(/não chame buscar_cliente sem o documento/);
    expect(t).toMatch(/não diga que localizou ou consultou nada/);
    expect(t).toMatch(/não encaminhe só por/);
  });

  test('uso do nome: a apresentação do próprio cliente pode ser forma de tratamento, sem confirmar identidade; na dúvida, sem nome', () => {
    for (const p of [DISPONIVEL, USADO]) {
      const t = texto(p);
      expect(t).toMatch(/pode tratá-lo por esse nome/);
      expect(t).toMatch(/não confirma identidade/);
      expect(t).toMatch(/na dúvida, responda sem nome/);
    }
  });

  test('uso do nome no pedido de terceiro: o nome é da outra pessoa e não vira o nome de quem fala', () => {
    const t = texto({ ...DISPONIVEL, alvo: 'terceiro' });
    expect(t).toMatch(/é o da outra pessoa: não trate quem fala por ele/);
    expect(t).not.toMatch(/pode tratá-lo por esse nome/);
  });

  // Sem detector de adiamento ou recusa: a orientação está SEMPRE presente enquanto o documento está
  // pendente e não chegou — o modelo aplica a que couber.
  test('adiamento, recusa e outro pedido: orientação sempre presente, sem depender de reconhecer a frase', () => {
    for (const p of [DISPONIVEL, USADO, PENDENTE]) {
      const t = texto(p);
      expect(t).toMatch(/fica no aguardo, sem pedir de novo e sem encaminhar só por isso/);
      expect(t).toMatch(/não insista nem discuta/);
      expect(t).toMatch(/só diga que encaminhou depois de chamar concluir_triagem/);
      expect(t).toMatch(/Se a mensagem trouxer outro pedido ou pergunta, responda a isso também/);
    }
  });

  test('resposta vazia: "Entendi." sozinho não basta quando ele pediu algo; curta só cabe quando adiou ou se despediu', () => {
    for (const p of [DISPONIVEL, USADO, PENDENTE]) {
      const t = texto(p);
      expect(t).toMatch(/Só "Entendi\." não basta quando ele pediu algo/);
      expect(t).toMatch(/Resposta curta só cabe quando ele disse que manda depois ou se despediu/);
    }
  });

  test('esclarecimento já usado: volta a proibição, e o modelo é orientado a oferecer enviar depois ou atendente', () => {
    const t = texto(USADO);
    expect(t).toMatch(/NÃO peça de novo a cada mensagem, nem com outras palavras/);
    expect(t).toMatch(/Você já esclareceu o que falta/);
    expect(t).toMatch(/enviar depois ou seguir com um atendente/);
    expect(t).toMatch(/Só diga que encaminhou depois de chamar concluir_triagem/);
    expect(t).not.toMatch(/você pode esclarecer UMA vez/);
  });

  test('esclarecimento já usado com a oferta feita: não repetir a oferta', () => {
    expect(texto({ ...USADO, ofertaFeita: true })).toMatch(/não repita a oferta/);
  });

  test('fora do contexto comprovado, nenhuma oferta: irritação, mudança de assunto e número na cadeia', () => {
    const irritado = texto({ ...USADO, irritado: true });
    expect(irritado).toMatch(/Ele se incomodou/);
    expect(irritado).not.toMatch(/Você já esclareceu o que falta/);
    const mudou = texto({ ...USADO, mudouDeAssunto: true });
    expect(mudou).toMatch(/responda ao assunto novo/);
    expect(mudou).not.toMatch(/Você já esclareceu o que falta/);
    expect(texto({ ...USADO, numeroNaCadeia: true })).not.toMatch(/Você já esclareceu o que falta/);
  });

  test('irritação e mudança de assunto vencem o esclarecimento (o estado já chega sem ele)', () => {
    expect(texto({ ...PENDENTE, irritado: true, pedidosNaCadeia: 1, esclarecimentoDisponivel: false })).not.toMatch(/você pode esclarecer UMA vez/);
    expect(texto({ ...PENDENTE, mudouDeAssunto: true, pedidosNaCadeia: 1, esclarecimentoDisponivel: false })).not.toMatch(/você pode esclarecer UMA vez/);
  });

  test('número recebido: a verificação vence o esclarecimento', () => {
    const t = texto({ ...DISPONIVEL, documentoRecebido: true, mudancaRelevante: true });
    expect(t).toMatch(/DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO/);
    expect(t).not.toMatch(/você pode esclarecer UMA vez/);
  });

  test('terceiro: o documento pendente é o da outra pessoa; o de quem fala não responde', () => {
    const t = texto({ ...PENDENTE, alvo: 'terceiro', mandouOProprioDocumento: true, mudancaRelevante: true });
    expect(t).toMatch(/da OUTRA pessoa/);
    expect(t).toMatch(/o que ele mandou é o dele mesmo/);
  });
});
