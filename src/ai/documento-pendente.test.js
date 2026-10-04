const {
  pedeDocumento, alvoDoPedido, estadoDoDocumento, violacoesDoDocumento, correcaoDoDocumento, respostaSemRepetirDocumento,
  documentosNoTexto, documentoConfirmadoNoTurno, localizacaoDoTerceiro, recuperacaoComprovada,
} = require('./documento-pendente');

// Documento pendente (25/09/2026): caso real em que a IA pediu o CPF três vezes seguidas enquanto o
// cliente só explicava o problema. Documentos daqui são sintéticos (dígitos verificadores válidos,
// nenhum de pessoa real): 529.982.247-25, 111.444.777-35 e o CNPJ 11.222.333/0001-81.
const CPF_A = '52998224725';
const CPF_B = '11144477735';

const entrada = (content) => ({ direction: 'inbound', messageType: 'text', content });
const audio = (transcription) => ({ direction: 'inbound', messageType: 'audio', transcription, transcriptionStatus: 'completed', content: null });
const pedido = (content, alvo = 'principal', createdAt = undefined) => ({
  direction: 'outbound', messageType: 'text', sentBy: 'ai', content, metadata: { pedidoDeDocumento: { alvo } }, ...(createdAt ? { createdAt } : {}),
});
const resposta = (content) => ({ direction: 'outbound', messageType: 'text', sentBy: 'ai', content });
const PEDIDO = 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.';

const SEM_IDENT = { nivel: 'none', origem: 'none', contracts: [] };
const FULANA = { nivel: 'forte', origem: 'phone', primeiroNome: 'Fulana', contracts: [{ id: 5 }], client: { id: 9, document: CPF_A } };
const estado = (historico, extra = {}) => estadoDoDocumento(historico, { identidade: SEM_IDENT, documentoDeQuemFala: null, ...extra });

describe('o que é pedir o documento', () => {
  test.each([
    PEDIDO, 'Qual o CPF do titular?', 'Pode me passar o CPF ou CNPJ?', 'Preciso do CPF para seguir.',
    'Assim que você me passar o documento, eu consulto.', 'Me envia o CNPJ da empresa, por favor.',
  ])('"%s" pede', (texto) => {
    expect(pedeDocumento(texto)).toBe(true);
  });

  test.each([
    'Não precisa mandar o CPF de novo.', 'Localizei seu cadastro pelo CPF informado.', 'Sua internet está ativa.',
  ])('"%s" não pede', (texto) => {
    expect(pedeDocumento(texto)).toBe(false);
  });

  test('documentos no texto: CPF/CNPJ com ou sem pontuação; CEP e número curto não contam', () => {
    expect(documentosNoTexto('meu cpf é 529.982.247-25')).toEqual([CPF_A]);
    expect(documentosNoTexto('CNPJ 11.222.333/0001-81')).toEqual(['11222333000181']);
    expect(documentosNoTexto(`é ${CPF_B}`)).toEqual([CPF_B]);
    expect(documentosNoTexto('moro no 123, CEP 65000-000')).toEqual([]);
  });
});

describe('de quem é o documento pedido (marcado no próprio pedido)', () => {
  test('quem fala sem identificação e sem pedido de terceiro: o próprio', () => {
    expect(alvoDoPedido({ identidade: SEM_IDENT }, PEDIDO)).toBe('principal');
  });

  test('quem fala já identificado: o documento pedido é de OUTRA pessoa', () => {
    expect(alvoDoPedido({ identidade: FULANA }, 'Qual o CPF da Beltrana?')).toBe('terceiro');
  });

  test('escopo, trava ou ambiguidade de terceiro no turno: outra pessoa', () => {
    expect(alvoDoPedido({ identidade: SEM_IDENT, terceiro: { nome: 'N', contratos: [] } }, 'Qual o CPF?')).toBe('terceiro');
    expect(alvoDoPedido({ identidade: SEM_IDENT, alvoAmbiguo: true }, 'Qual o CPF?')).toBe('terceiro');
    expect(alvoDoPedido({ identidade: SEM_IDENT }, 'Me passa o CPF dela, por favor.')).toBe('terceiro');
  });
});

describe('estado do documento pendente (derivado do histórico da conversa)', () => {
  test('1. pedido feito e o cliente não mandou: pendente, aguardando', () => {
    const e = estado([entrada('minha internet caiu desde cedo'), pedido(PEDIDO), entrada('é que desde ontem não funciona nada')]);
    expect(e).toMatchObject({ alvo: 'principal', mudancaRelevante: false, mudouDeAssunto: false, irritado: false });
  });

  test('sem pedido marcado, nada pendente', () => {
    expect(estado([entrada('oi'), resposta('Olá! Como posso ajudar?')])).toBeNull();
  });

  // Número recebido != identidade confirmada (ajuste de 25/09/2026): 11 ou 14 dígitos podem ser um
  // telefone, um número errado ou um documento que não existe. O número é tentado (buscar_cliente)
  // e pedir para conferir é avanço — mas a pendência só termina com a identificação confirmada.
  test('3. CPF informado depois do pedido: respondido, ainda NÃO validado', () => {
    const e = estado([entrada('caiu a internet'), pedido(PEDIDO), entrada(`meu cpf é ${CPF_A}`)]);
    expect(e).toMatchObject({ alvo: 'principal', documentoRecebido: true, mudancaRelevante: true });
  });

  test('3b. o cadastro foi localizado (quem fala identificado): aí sim a pendência termina', () => {
    expect(estado([entrada('caiu a internet'), pedido(PEDIDO), entrada(`meu cpf é ${CPF_A}`), resposta('Localizei seu cadastro.'), entrada('e agora?')], { identidade: FULANA })).toBeNull();
  });

  test('4. CPF dito em áudio (transcrição): recebido igual, sem validar', () => {
    expect(estado([entrada('caiu a internet'), pedido(PEDIDO), audio(`o cpf é ${CPF_A}`)])).toMatchObject({ documentoRecebido: true });
  });

  test('telefone de 11 dígitos (texto ou áudio): recebido, NÃO é identificação confirmada', () => {
    expect(estado([entrada('caiu'), pedido(PEDIDO), entrada('meu telefone é 98991234567')])).toMatchObject({ documentoRecebido: true });
    expect(estado([entrada('caiu'), pedido(PEDIDO), audio('o número é 98991234567')])).toMatchObject({ documentoRecebido: true });
  });

  test('o mesmo número que já foi tentado antes do pedido não é informação nova', () => {
    const historico = [
      entrada('caiu'), pedido(PEDIDO), entrada('98991234567'),
      pedido('Não consegui localizar com esse número. Confere o CPF ou CNPJ para mim?'), entrada('98991234567'),
    ];
    expect(estado(historico)).toMatchObject({ documentoRecebido: false, mudancaRelevante: false });
  });

  test('áudio sem CPF conta como fala do cliente, não como resposta', () => {
    const e = estado([entrada('caiu a internet'), pedido(PEDIDO), audio('é que a luz ficou vermelha e nada funciona')]);
    expect(e).toMatchObject({ alvo: 'principal', mudancaRelevante: false });
  });

  test('6. identificado depois do pedido (telefone, memória): a pendência do próprio termina', () => {
    expect(estado([entrada('caiu a internet'), pedido(PEDIDO), entrada('e aí?')], { identidade: FULANA })).toBeNull();
  });

  test('7. mudou de assunto: a última intenção vence', () => {
    const e = estado([entrada('caiu a internet'), pedido(PEDIDO), entrada('Na verdade só queria saber se vocês atendem meu bairro.')]);
    expect(e).toMatchObject({ mudouDeAssunto: true, retomou: false, mudancaRelevante: false });
  });

  test('8. voltou ao assunto que depende da identificação: pode retomar, sem loop', () => {
    const e = estado([
      entrada('caiu a internet'), pedido(PEDIDO), entrada('Na verdade só queria saber se vocês atendem meu bairro.'),
      resposta('Atendemos sim!'), entrada('ah, e a minha internet que caiu, vocês conseguem ver?'),
    ]);
    expect(e).toMatchObject({ retomou: true, mudancaRelevante: true });
  });

  test('pedido novo que também depende da identificação (suporte → boleto) é mudança relevante', () => {
    const e = estado([entrada('caiu a internet'), pedido(PEDIDO), entrada('e me manda o boleto também')]);
    expect(e.mudancaRelevante).toBe(true);
  });

  test('9. cliente irritado com o pedido', () => {
    for (const texto of ['já falei', 'para de pedir isso', 'vocês só sabem pedir CPF?']) {
      expect(estado([entrada('caiu a internet'), pedido(PEDIDO), entrada(texto)]).irritado).toBe(true);
    }
  });

  test('10. terceiro: o CPF de quem fala NÃO responde ao pedido do documento da outra pessoa', () => {
    const historico = [entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada(`toma: ${CPF_A}`)];
    const e = estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A });
    expect(e).toMatchObject({ alvo: 'terceiro', mandouOProprioDocumento: true, documentoRecebido: false });
    // Tentativa com documento é avanço: esclarecer de quem é o CPF não é repetir.
    expect(e.mudancaRelevante).toBe(true);
  });

  test('10b. terceiro: o documento da outra pessoa é recebido, mas só a localização encerra', () => {
    const historico = [entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada(`é ${CPF_B}`)];
    expect(estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A })).toMatchObject({ alvo: 'terceiro', documentoRecebido: true });
  });

  test('10c. terceiro: documento inválido (não localizado) — a pendência permanece', () => {
    const historico = [
      entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada(`é ${CPF_B}`),
      resposta('Não localizei esse CPF.'), entrada('e agora?'),
    ];
    expect(estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A })).toMatchObject({ alvo: 'terceiro' });
  });

  // Identidade confirmada é FATO DO SISTEMA (ajuste de 25/09/2026): a localização do terceiro vem do
  // escopo que buscar_cliente PERSISTE antes de devolver (a hora sai de expiraEm), e não de texto da
  // IA — uma resposta descartada, vazia ou substituída não pode fazer o pedido reaparecer.
  const PEDIU_EM = new Date('2026-09-25T15:00:00.000Z');
  const DEPOIS = new Date('2026-09-25T15:02:00.000Z');
  const ANTES = new Date('2026-09-25T14:58:00.000Z');

  test('10d. terceiro localizado depois do pedido: a pendência termina — sem resposta da IA nenhuma no histórico', () => {
    const historico = [entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro', PEDIU_EM), entrada(`é ${CPF_B}`), entrada('e aí?')];
    expect(estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A, terceiroLocalizadoEm: DEPOIS })).toBeNull();
  });

  test('10e. terceiro localizado ANTES de um pedido novo não encerra o pedido novo', () => {
    const historico = [
      entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro', ANTES), entrada(`é ${CPF_B}`), resposta('Localizei.'),
      entrada('agora quero o da minha mãe'), pedido('Qual o CPF da sua mãe?', 'terceiro', PEDIU_EM), entrada('um instante'),
    ];
    expect(estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A, terceiroLocalizadoEm: new Date('2026-09-25T14:59:00.000Z') }))
      .toMatchObject({ alvo: 'terceiro', documentoRecebido: false });
  });

  test('10f. texto da IA não confirma nada: marca antiga na resposta, sem escopo localizado, não encerra', () => {
    const comMarca = { ...resposta('Localizei o contrato.'), metadata: { documentoConfirmado: 'terceiro' } };
    const historico = [entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro', PEDIU_EM), entrada(`é ${CPF_B}`), comMarca, entrada('e aí?')];
    expect(estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A, terceiroLocalizadoEm: null })).toMatchObject({ alvo: 'terceiro' });
  });

  test('10g. pedido sem hora (legado): não dá para provar que a localização veio depois — continua pendente', () => {
    const historico = [entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada(`é ${CPF_B}`)];
    expect(estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A, terceiroLocalizadoEm: DEPOIS })).toMatchObject({ alvo: 'terceiro' });
  });

  test('a hora da localização sai do escopo persistido: só com contrato, válido e não pendente', () => {
    const agora = new Date('2026-09-25T15:10:00.000Z');
    const expiraEm = '2026-09-25T15:32:00.000Z';
    expect(localizacaoDoTerceiro({ nome: 'Beltrana', contratos: [77], expiraEm }, agora)).toEqual(new Date('2026-09-25T15:02:00.000Z'));
    expect(localizacaoDoTerceiro({ nome: null, contratos: [], expiraEm, pendente: true }, agora)).toBeNull();
    expect(localizacaoDoTerceiro({ nome: 'Beltrana', contratos: [77], expiraEm: '2026-09-25T15:05:00.000Z' }, agora)).toBeNull();
    expect(localizacaoDoTerceiro(null, agora)).toBeNull();
  });

  test('12. novo terceiro: o pedido mais recente substitui o anterior', () => {
    const historico = [
      entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'),
      entrada('na verdade é da minha mãe'), pedido('Qual o CPF da sua mãe?', 'terceiro'), entrada('um instante'),
    ];
    const e = estadoDoDocumento(historico, { identidade: FULANA, documentoDeQuemFala: CPF_A });
    expect(e).toMatchObject({ alvo: 'terceiro', mudancaRelevante: false });
    // Entre os dois pedidos, a menção à mãe foi mudança relevante: o 2º pedido não era repetição.
    const antes = estadoDoDocumento(historico.slice(0, 3), { identidade: FULANA, documentoDeQuemFala: CPF_A });
    expect(antes.mudancaRelevante).toBe(true);
  });

  test('15. conversa nova (histórico sem o pedido): nada pendente', () => {
    expect(estado([entrada('bom dia, caiu a internet')])).toBeNull();
  });

  test('a autorresposta provável (Fase 1C) não conta como fala do cliente', () => {
    const auto = { ...entrada(`${CPF_A}`), metadata: { autorrespostaProvavel: true } };
    expect(estado([entrada('caiu'), pedido(PEDIDO), auto])).toMatchObject({ alvo: 'principal' });
  });
});

describe('o que a resposta não pode pedir', () => {
  const pendente = estado([entrada('caiu a internet'), pedido(PEDIDO), entrada('é que nada funciona')]);
  const ctx = (extra = {}) => ({ documento: pendente, identidade: SEM_IDENT, terceiro: null, triagemConcluida: null, atendimentoEncerrado: false, ...extra });

  // Desenho de 30/09/2026 (F1, terceira revisão): sem mudança relevante, UM esclarecimento por cadeia
  // de pedidos é permitido — se ele é necessário, quem decide é o modelo, lendo a conversa. O segundo
  // repedido continua barrado: o caso real de 25/09 (três pedidos seguidos, sem mudança relevante) é barrado
  // enquanto os pedidos forem reconhecidos e estiverem no histórico lido.
  test('2. sem avanço: o primeiro repedido é o esclarecimento permitido; depois dele, repetir é barrado', () => {
    expect(violacoesDoDocumento('Entendi! Para verificar, me informe seu CPF.', ctx())).toEqual([]);
    const esclarecido = estado([entrada('caiu a internet'), pedido(PEDIDO), entrada('é que nada funciona'), pedido('Para verificar, preciso do CPF ou CNPJ.'), entrada('continua sem funcionar')]);
    expect(violacoesDoDocumento('Me informe seu CPF, por favor.', ctx({ documento: esclarecido }))).toEqual(['documento_repetido']);
    expect(violacoesDoDocumento('Entendi, sem o cadastro não consigo ver o status da conexão.', ctx())).toEqual([]);
  });

  test('mudou de assunto: pedir o documento é forçar formulário', () => {
    const mudou = estado([entrada('caiu'), pedido(PEDIDO), entrada('Na verdade só queria saber se vocês atendem meu bairro.')]);
    expect(violacoesDoDocumento('Atendemos sim! Me passa seu CPF?', ctx({ documento: mudou }))).toEqual(['documento_repetido']);
  });

  test('retomou o assunto: lembrar do documento é permitido', () => {
    const retomou = estado([
      entrada('caiu'), pedido(PEDIDO), entrada('Na verdade só queria saber se vocês atendem meu bairro.'),
      resposta('Atendemos sim!'), entrada('e a minha internet que caiu, conseguem ver?'),
    ]);
    expect(violacoesDoDocumento('Consigo sim: é só me passar o CPF ou CNPJ do titular.', ctx({ documento: retomou }))).toEqual([]);
  });

  test('irritado: nem com mudança relevante o pedido sai neste turno', () => {
    const irritado = estado([entrada('caiu'), pedido(PEDIDO), entrada('e o boleto? já falei tudo!')]);
    expect(violacoesDoDocumento('Me passa o CPF, por favor.', ctx({ documento: irritado }))).toEqual(['documento_repetido']);
  });

  test('5. cliente já identificado: pedir o documento DELE é barrado; o de outra pessoa não', () => {
    const c = ctx({ documento: null, identidade: FULANA });
    expect(violacoesDoDocumento(PEDIDO, c)).toEqual(['documento_ja_identificado']);
    expect(violacoesDoDocumento('Qual o CPF da Beltrana?', c)).toEqual([]);
    expect(violacoesDoDocumento('Esse é o seu CPF, preciso do CPF da Beltrana.', c)).toEqual([]);
  });

  test('11. terceiro já localizado: pedir o documento dele de novo é barrado; novo terceiro, não', () => {
    const localizado = { nome: 'Beltrana', contratos: [{ id: 77 }] };
    expect(violacoesDoDocumento('Qual o CPF dela?', ctx({ documento: null, terceiro: localizado, ultimaFala: 'manda o pix dela' }))).toEqual(['documento_terceiro_localizado']);
    expect(violacoesDoDocumento('Qual o CPF da sua mãe?', ctx({ documento: null, terceiro: localizado, ultimaFala: 'agora quero o boleto da minha mãe' }))).toEqual([]);
  });

  test('14/15. depois de encaminhar ou encerrar, nenhum pedido de documento', () => {
    expect(violacoesDoDocumento('Encaminhei. Me passa o CPF?', ctx({ documento: null, triagemConcluida: { setor: 'Suporte' } }))).toEqual(['documento_apos_encaminhar']);
    expect(violacoesDoDocumento('Até logo! Me passa o CPF?', ctx({ documento: null, atendimentoEncerrado: true }))).toEqual(['documento_apos_encaminhar']);
  });

  test('número recebido e não localizado: pedir para CONFERIR é permitido (houve informação nova)', () => {
    const recebido = estado([entrada('caiu'), pedido(PEDIDO), entrada('98991234567')]);
    expect(violacoesDoDocumento('Não consegui localizar com esse número. Confere o CPF ou CNPJ para mim?', ctx({ documento: recebido }))).toEqual([]);
  });

  test('terceiro: localizado NESTE turno (buscar_cliente achou) encerra ao vivo; não localizado, não', () => {
    const terceiro = estadoDoDocumento([entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada(`é ${CPF_B}`)], { identidade: FULANA, documentoDeQuemFala: CPF_A });
    const achou = ctx({ documento: terceiro, identidade: FULANA, terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] }, alvoTerceiro: { contratos: [77] }, ultimaFala: `é ${CPF_B}` });
    expect(violacoesDoDocumento('Qual o CPF dela?', achou)).toEqual(['documento_terceiro_localizado']);
    const naoAchou = ctx({ documento: terceiro, identidade: FULANA, terceiro: { nome: null, contratos: [], pendente: true }, alvoTerceiro: { contratos: [] }, ultimaFala: `é ${CPF_B}` });
    expect(violacoesDoDocumento('Não localizei esse CPF. Confere o CPF da Beltrana para mim?', naoAchou)).toEqual([]);
  });

  // No próprio turno, a trava de buscar_cliente com contrato só existe DEPOIS de o escopo ter sido
  // gravado (falha fechado) — é o mesmo fato persistido, visto de dentro do turno.
  test('no próprio turno: trava com contrato = localizado; trava vazia (não achou) = não', () => {
    expect(documentoConfirmadoNoTurno({ alvoTerceiro: { contratos: [77] } })).toBe('terceiro');
    expect(documentoConfirmadoNoTurno({ alvoTerceiro: { contratos: [] } })).toBeNull();
    expect(documentoConfirmadoNoTurno({})).toBeNull();
  });

  test('pendência do próprio que terminou no meio do turno (buscar_cliente identificou): nada a barrar como repetição', () => {
    expect(violacoesDoDocumento('Qual o CPF da Beltrana?', ctx({ identidade: FULANA }))).toEqual([]);
  });
});

describe('correção e resposta sem o pedido repetido', () => {
  const pendente = estado([entrada('caiu a internet'), pedido(PEDIDO), entrada('é que nada funciona')]);

  test('a correção manda responder ao que ele disse e manter a ação bloqueada', () => {
    const c = correcaoDoDocumento(['documento_repetido'], { documento: pendente });
    expect(c).toMatch(/NÃO peça de novo/);
    expect(c).toMatch(/continua sem poder ser feito/);
  });

  test('irritado: não discutir; encaminhar se não der para seguir', () => {
    const irritado = estado([entrada('caiu'), pedido(PEDIDO), entrada('para de pedir isso')]);
    expect(correcaoDoDocumento(['documento_repetido'], { documento: irritado })).toMatch(/não discuta/);
  });

  test('terceiro: o documento pendente é o da outra pessoa', () => {
    const terceiro = estadoDoDocumento([entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada('um instante')], { identidade: FULANA, documentoDeQuemFala: CPF_A });
    expect(correcaoDoDocumento(['documento_repetido'], { documento: terceiro })).toMatch(/da OUTRA pessoa/);
  });

  test('a resposta final perde só a frase do pedido; sem nada útil, uma frase curta', () => {
    expect(respostaSemRepetirDocumento('Entendi, a luz está vermelha. Me informe seu CPF, por favor.', ['documento_repetido'], { documento: pendente }))
      .toBe('Entendi, a luz está vermelha.');
    expect(respostaSemRepetirDocumento(PEDIDO, ['documento_repetido'], { documento: pendente })).toBe('Entendi.');
    const irritado = estado([entrada('caiu'), pedido(PEDIDO), entrada('já falei')]);
    expect(respostaSemRepetirDocumento(PEDIDO, ['documento_repetido'], { documento: irritado })).toBe('Entendi, desculpe a insistência.');
    expect(respostaSemRepetirDocumento('Me passa o CPF?', ['documento_apos_encaminhar'], { triagemConcluida: { setor: 'Suporte' }, triagem: { noturno: { ativo: false } } }))
      .toBe('Seu atendimento entrou na fila do setor Suporte. Um atendente responde por aqui assim que estiver disponível.');
  });
});

// F1 — nome no lugar do documento, desenho de 30/09/2026 (terceira revisão). O código não tenta mais
// reconhecer nomes, adiamentos ou recusas por listas de palavras: controla o que é verificável —
// documento já pedido, quantos pedidos a cadeia já teve, alvo, e as regras preexistentes de irritação,
// mudança de assunto e número recebido — e concede UM esclarecimento por cadeia. Se ele é necessário,
// é o modelo que decide, lendo a conversa. Nada disso identifica, muda o alvo ou libera ferramenta.
describe('esclarecimento limitado (F1)', () => {
  const ESCLARECIMENTO = 'Para localizar seu cadastro, preciso do CPF ou CNPJ do titular — só o nome não basta.';
  const REPEDIDO = 'Me passa o CPF ou CNPJ do titular, por favor?';
  const ctx = (documento, extra = {}) => ({ documento, identidade: SEM_IDENT, terceiro: null, triagemConcluida: null, atendimentoEncerrado: false, ...extra });
  const depoisDoPedido = (texto) => estado([entrada('manda o boleto'), pedido(PEDIDO), entrada(texto)]);
  const depoisDoEsclarecimento = (texto) => estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('Fulana de Tal Exemplo'), pedido(ESCLARECIMENTO), entrada(texto)]);

  describe('o esclarecimento não depende de reconhecer o que o cliente escreveu', () => {
    test.each([
      'Fulana Luz', 'sou Fulana Luz', 'sou a Fulana Luz', 'meu nome é Fulana Luz', 'Nome: Fulana',
      'meu nome é Fulana, quero o boleto', 'meu nome é Fulana e quero o boleto', 'é que nada funciona', 'ok',
    ])('depois do pedido, "%s": um esclarecimento é permitido, e nada é identificado', (texto) => {
      const e = depoisDoPedido(texto);
      expect(e).toMatchObject({ pedidosNaCadeia: 1, esclarecimentoUsado: false, esclarecimentoDisponivel: true, documentoRecebido: false });
      expect(violacoesDoDocumento(ESCLARECIMENTO, ctx(e))).toEqual([]);
    });
  });

  describe('o limite: um esclarecimento por cadeia de pedidos', () => {
    test.each(['Fulana de Tal Exemplo', 'Fulana Luz', 'é que eu preciso pagar hoje', 'ok'])(
      'depois do esclarecimento, "%s": pedir de novo é repetição', (texto) => {
        const e = depoisDoEsclarecimento(texto);
        expect(e).toMatchObject({ pedidosNaCadeia: 2, esclarecimentoUsado: true, esclarecimentoDisponivel: false });
        expect(violacoesDoDocumento(REPEDIDO, ctx(e))).toEqual(['documento_repetido']);
      },
    );

    test('resposta da IA sem pedido no meio não gasta o esclarecimento', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('é urgente'), resposta('Entendo.'), entrada('Fulana de Tal Exemplo')]);
      expect(e).toMatchObject({ pedidosNaCadeia: 1, esclarecimentoDisponivel: true });
    });

    test('três turnos sem o dado não viram três pedidos', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('Fulana'), pedido(ESCLARECIMENTO), entrada('Fulana'), resposta('Sem o CPF não consigo localizar.'), entrada('Fulana')]);
      expect(violacoesDoDocumento(REPEDIDO, ctx(e))).toEqual(['documento_repetido']);
    });
  });

  describe('as regras preexistentes decidem antes do esclarecimento', () => {
    test('irritação: nem o primeiro repedido passa', () => {
      const e = depoisDoPedido('já falei meu nome');
      expect(e).toMatchObject({ irritado: true, esclarecimentoDisponivel: false });
      expect(violacoesDoDocumento(REPEDIDO, ctx(e))).toEqual(['documento_repetido']);
    });

    test('mudança de assunto: pedir o documento é forçar formulário', () => {
      const e = depoisDoPedido('Na verdade só queria saber se vocês atendem meu bairro.');
      expect(e).toMatchObject({ mudouDeAssunto: true, esclarecimentoDisponivel: false });
      expect(violacoesDoDocumento(REPEDIDO, ctx(e))).toEqual(['documento_repetido']);
    });

    test('número novo depois do esclarecimento: pedir para conferir continua sendo avanço (regra de 25/09)', () => {
      const e = depoisDoEsclarecimento('98991234567');
      expect(e).toMatchObject({ documentoRecebido: true, mudancaRelevante: true });
      expect(violacoesDoDocumento('Não localizei com esse número. Confere o CPF ou CNPJ?', ctx(e))).toEqual([]);
    });

    test('o mesmo número de novo depois da conferência: repetir é barrado', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('98991234567'), pedido('Confere o CPF ou CNPJ?'), entrada('98991234567')]);
      expect(violacoesDoDocumento('Confere o CPF?', ctx(e))).toEqual(['documento_repetido']);
    });

    test('pedido de OUTRA pessoa abre cadeia nova: o esclarecimento do terceiro não foi gasto pelo pedido do titular', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('é da minha mãe'), pedido('Qual o CPF ou CNPJ da sua mãe?', 'terceiro'), entrada('Beltrana de Tal')]);
      expect(e).toMatchObject({ alvo: 'terceiro', pedidosNaCadeia: 1, esclarecimentoDisponivel: true });
    });

    test('pedido de outro alvo, mesmo sem fala que troque o alvo no meio, não soma na cadeia', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('ok'), pedido('Qual o CPF ou CNPJ dela?', 'terceiro'), entrada('Beltrana de Tal')]);
      expect(e).toMatchObject({ alvo: 'terceiro', pedidosNaCadeia: 1, esclarecimentoDisponivel: true });
    });

    test('terceiro novo no meio da cadeia de terceiro também recomeça a contagem', () => {
      const e = estadoDoDocumento(
        [entrada('quero o pix da Beltrana'), pedido('Qual o CPF da Beltrana?', 'terceiro'), entrada('um instante'), entrada('agora quero o da minha mãe'), pedido('Qual o CPF da sua mãe?', 'terceiro'), entrada('Beltrana de Tal')],
        { identidade: FULANA, documentoDeQuemFala: CPF_A },
      );
      expect(e).toMatchObject({ pedidosNaCadeia: 1, esclarecimentoDisponivel: true });
    });

    test('quem fala identificado: a pendência do próprio termina', () => {
      expect(depoisDoPedido('Fulana') && estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('Fulana')], { identidade: FULANA })).toBeNull();
    });

    test('o próprio documento continua proibido a quem já está identificado', () => {
      expect(violacoesDoDocumento('Me informe seu CPF, por favor.', ctx(depoisDoPedido('Fulana'), { identidade: FULANA }))).toEqual(['documento_ja_identificado']);
    });

    test('documento na mesma mensagem: segue para verificação (recebido, não confirmado)', () => {
      expect(depoisDoPedido('meu nome é Fulana, cpf 529.982.247-25')).toMatchObject({ documentoRecebido: true });
    });
  });

  describe('correção no laço depois do esclarecimento', () => {
    test('não manda pedir de novo e orienta oferecer enviar depois ou atendente', () => {
      const t = correcaoDoDocumento(['documento_repetido'], ctx(depoisDoEsclarecimento('Fulana')));
      expect(t).toMatch(/NÃO peça de novo/);
      expect(t).toMatch(/atendente/);
      expect(t).toMatch(/concluir_triagem/);
    });

    test('com a oferta já feita, manda não repeti-la', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('Fulana'), pedido(ESCLARECIMENTO), entrada('Fulana'), resposta('Sem o CPF não consigo localizar. Você prefere me enviar depois ou seguir com um atendente?'), entrada('Fulana')]);
      expect(correcaoDoDocumento(['documento_repetido'], ctx(e))).toMatch(/não repita/);
    });
  });

  describe('recuperação quando o modelo insiste depois do esclarecimento', () => {
    const repetido = depoisDoEsclarecimento('Fulana de Tal Exemplo');
    const semPromessa = (r) => expect(r).not.toMatch(/encaminhei|encaminhado|transferi|já está com (?:um|o) atendente/i);

    test('só o pedido: limitação e continuidade (enviar depois ou atendente), sem novo pedido nem promessa', () => {
      const r = respostaSemRepetirDocumento('Preciso do seu CPF ou CNPJ para localizar o cadastro.', ['documento_repetido'], { documento: repetido });
      expect(r).toMatch(/não consigo localizar/);
      expect(r).toMatch(/atendente/);
      expect(r).toMatch(/depois/);
      expect(pedeDocumento(r)).toBe(false);
      semPromessa(r);
    });

    test('o texto que sobra só cita "documento": completa a limitação e a oferta', () => {
      const r = respostaSemRepetirDocumento('Assim que tiver o documento, me avise. Me passa o CPF?', ['documento_repetido'], { documento: repetido });
      expect(r.startsWith('Assim que tiver o documento, me avise.')).toBe(true);
      expect(r).toMatch(/não consigo localizar/);
      expect(r).toMatch(/atendente/);
    });

    test('o modelo já explicou a limitação: só a oferta entra, sem explicação duplicada', () => {
      const r = respostaSemRepetirDocumento('Sem o CPF eu não consigo localizar seu cadastro por aqui. Pode me mandar o CPF ou CNPJ?', ['documento_repetido'], { documento: repetido });
      expect(r.startsWith('Sem o CPF eu não consigo localizar seu cadastro por aqui.')).toBe(true);
      expect(r.match(/não consigo localizar/g)).toHaveLength(1);
      expect(r).toMatch(/atendente/);
    });

    test('o modelo já explicou e ofereceu: nada entra', () => {
      const texto = 'Sem o CPF eu não consigo localizar seu cadastro por aqui. Você prefere me enviar depois ou seguir com um atendente? Me passa o CPF?';
      expect(respostaSemRepetirDocumento(texto, ['documento_repetido'], { documento: repetido }))
        .toBe('Sem o CPF eu não consigo localizar seu cadastro por aqui. Você prefere me enviar depois ou seguir com um atendente?');
    });

    test('a oferta já foi feita e o cliente respondeu: a oferta não se repete', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('Fulana'), pedido(ESCLARECIMENTO), entrada('Fulana'), resposta('Sem o CPF não consigo localizar. Você prefere me enviar depois ou seguir com um atendente?'), entrada('Fulana')]);
      const r = respostaSemRepetirDocumento('Preciso do seu CPF ou CNPJ para localizar o cadastro.', ['documento_repetido'], { documento: e });
      expect(r).toMatch(/não consigo localizar/);
      expect(r).not.toMatch(/atendente/);
    });

    test('pedido de terceiro: fala do titular, nunca do cadastro de quem fala', () => {
      const e = estadoDoDocumento(
        [entrada('quero o boleto da minha mãe'), pedido('Qual o CPF da sua mãe?', 'terceiro'), entrada('Beltrana de Tal'), pedido('Preciso do CPF dela, o nome não basta.', 'terceiro'), entrada('Beltrana de Tal')],
        { identidade: FULANA, documentoDeQuemFala: CPF_A },
      );
      expect(e).toMatchObject({ alvo: 'terceiro', esclarecimentoUsado: true });
      const r = respostaSemRepetirDocumento('Preciso do CPF dela para localizar.', ['documento_repetido'], { documento: e });
      expect(r).toMatch(/titular/);
      expect(r).not.toMatch(/seu cadastro/);
    });

    test('fora do contexto comprovado, a troca de sempre: antes do esclarecimento, irritação, mudança de assunto e cadeia com número', () => {
      expect(respostaSemRepetirDocumento(PEDIDO, ['documento_repetido'], { documento: depoisDoPedido('é que nada funciona') })).toBe('Entendi.');
      expect(respostaSemRepetirDocumento(PEDIDO, ['documento_repetido'], { documento: depoisDoEsclarecimento('já falei meu nome') })).toBe('Entendi, desculpe a insistência.');
      expect(respostaSemRepetirDocumento(PEDIDO, ['documento_repetido'], { documento: depoisDoEsclarecimento('Na verdade só queria saber se vocês atendem meu bairro.') })).toBe('Entendi.');
      const comNumero = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('98991234567'), pedido('Confere o CPF ou CNPJ?'), entrada('é esse mesmo')]);
      expect(respostaSemRepetirDocumento(PEDIDO, ['documento_repetido'], { documento: comNumero })).toBe('Entendi.');
    });
  });

  // O contexto comprovado da recuperação é fato do histórico, não leitura da frase: o módulo de prompt usa
  // o mesmo predicado, para a instrução e a troca final não divergirem.
  describe('contexto comprovado da recuperação', () => {
    test('só depois do esclarecimento, sem irritação, sem mudança de assunto e sem número na cadeia', () => {
      expect(recuperacaoComprovada(depoisDoEsclarecimento('Fulana'))).toBe(true);
      expect(recuperacaoComprovada(depoisDoPedido('Fulana'))).toBe(false);
      expect(recuperacaoComprovada(depoisDoEsclarecimento('já falei meu nome'))).toBe(false);
      expect(recuperacaoComprovada(depoisDoEsclarecimento('Na verdade só queria saber se vocês atendem meu bairro.'))).toBe(false);
      expect(recuperacaoComprovada(estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('98991234567'), pedido('Confere o CPF ou CNPJ?'), entrada('é esse mesmo')]))).toBe(false);
      expect(recuperacaoComprovada(null)).toBe(false);
    });
  });

  // F2 (30/09/2026) na cadeia da F1: a cadeia reinicia quando uma fala do cliente troca o alvo
  // (intencaoDeAlvo). "da minha internet" era lido como terceiro: reiniciava a contagem e contava como
  // mudança relevante — a cada repetição da frase, um pedido a mais era permitido, sem limite.
  describe('F2 na cadeia: posse de coisa própria não troca o alvo', () => {
    const INTERNET = [entrada('quero pagar o boleto da minha internet'), pedido(PEDIDO), entrada('é o boleto da minha internet'), pedido(ESCLARECIMENTO), entrada('o boleto da minha internet, por favor')];

    test('"da minha internet" repetido entre os pedidos: a cadeia conta os dois, e o terceiro pedido é barrado', () => {
      const e = estado(INTERNET);
      expect(e).toMatchObject({ alvo: 'principal', pedidosNaCadeia: 2, esclarecimentoUsado: true, mudancaRelevante: false });
      expect(violacoesDoDocumento(REPEDIDO, ctx(e))).toEqual(['documento_repetido']);
    });

    test('fragmento incompleto ("é da minha") também não troca o alvo nem reinicia a cadeia', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('é da minha'), pedido(ESCLARECIMENTO), entrada('é da minha')]);
      expect(e).toMatchObject({ pedidosNaCadeia: 2, mudancaRelevante: false });
    });

    // Revisão da F2: "vou pagar com o meu cartão" era lido como volta ao próprio — no pedido do documento de
    // OUTRA pessoa, trocava o alvo e reiniciava a cadeia a cada repetição.
    test('meio de pagamento no pedido do documento de outra pessoa não troca o alvo nem reinicia a cadeia', () => {
      const e = estadoDoDocumento(
        [entrada('quero o boleto da minha mãe'), pedido('Qual o CPF dela?', 'terceiro'), entrada('vou pagar com o meu cartão'), pedido('Me passa o CPF dela?', 'terceiro'), entrada('vou pagar com o meu cartão')],
        { identidade: FULANA, documentoDeQuemFala: CPF_A },
      );
      expect(e).toMatchObject({ alvo: 'terceiro', pedidosNaCadeia: 2, esclarecimentoUsado: true, mudancaRelevante: false });
    });

    test('contraste: pessoa de verdade ("é da minha mãe") continua trocando o alvo, como em 25/09', () => {
      const e = estado([entrada('manda o boleto'), pedido(PEDIDO), entrada('é da minha mãe')]);
      expect(e).toMatchObject({ mudancaRelevante: true });
    });
  });
});
