// Conversa de verdade com a OpenAI, turno a turno, com o SGP simulado.
//
// PULADO POR PADRÃO: só roda com SIMULACAO_REAL=1. Sem isso, `npm test` não
// muda em nada e a OpenAI nem é chamada.
//
//   SIMULACAO_REAL=1 npm test -- src/ai/simulacao-real.test.js
//
// A CHAVE vem SEMPRE de process.env.OPENAI_API_KEY. Nunca é impressa, nunca é
// mascarada, nunca é escrita em arquivo — nem na transcrição, nem no erro que
// este arquivo lança quando ela falta.
//
// Tudo o que toca banco, fila, disco ou rede é mockado, EXCETO ./openai-client:
// ele é o único componente real, e é justamente o que o harness existe para
// exercitar. Quem conduz o turno é o runAiTurn de produção, então orquestração,
// guardas e parâmetros são idênticos por construção.
jest.mock('../integrations/sgp-client');
jest.mock('./ai-config.repository');
jest.mock('./ai-interaction.repository');
jest.mock('../conversations/message.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../sectors/sector.repository');
jest.mock('../company/company-config.repository');
jest.mock('./trust-unlock.repository');
// Abaixo do que o brief listava: sem estes, o executor de ferramentas de
// verdade escreveria no disco (media-storage), publicaria na fila do Redis
// (outbound-queue), emitiria socket e chamaria o banco — numa simulação que
// deve ser inerte por fora.
jest.mock('../media/media-storage');
jest.mock('../queue/outbound-queue');
jest.mock('../realtime/socket-server');
jest.mock('../payments/payment-sender');
jest.mock('../cities/contact-city.service');
jest.mock('../city-notices/city-notice.service');
jest.mock('./triage-close-reason');
jest.mock('./receipt-usage.repository');

const { conversar, salvarTranscricao, SAIDA } = require('./simulacao/conversar');
const { ROTEIROS } = require('./simulacao/roteiros');
const { nuncaPediuNascimento, todosOsTurnosResponderam } = require('./simulacao/invariantes');

const LIGADO = process.env.SIMULACAO_REAL === '1';
const descreve = LIGADO ? describe : describe.skip;

// Confirmação 10 do dono: a data de nascimento nunca é solicitada, em roteiro
// NENHUM. Fica fora do que cada roteiro declara de propósito — assim nenhum
// roteiro novo pode esquecer dela.
const INVARIANTES_GLOBAIS = {
  'não pediu data de nascimento (invariante global)': nuncaPediuNascimento,
  'respondeu em todos os turnos (invariante global)': todosOsTurnosResponderam,
};

descreve('simulação multiturno com a OpenAI real', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      // A mensagem diz o NOME da variável e nada mais: nem valor, nem tamanho,
      // nem prefixo mascarado.
      throw new Error('Defina OPENAI_API_KEY no ambiente para rodar a simulação real.');
    }
  });

  // Roteiros encadeados (o 17 continua o 14) compartilham a conversa: o
  // resultado do anterior fica aqui e entra como `anterior` no seguinte. Cada
  // resultado é consumido UMA vez — o histórico é um objeto vivo, e dois
  // roteiros pendurados no mesmo pai veriam os turnos um do outro.
  const anteriores = new Map();

  test.each(ROTEIROS)('$numero — $nome', async (roteiro) => {
    const anterior = roteiro.continuaDe ? anteriores.get(roteiro.continuaDe) : null;
    if (roteiro.continuaDe) {
      if (!anterior) {
        throw new Error(`O roteiro ${roteiro.numero} continua o ${roteiro.continuaDe}, que não rodou (ou já foi consumido por outro roteiro).`);
      }
      if (!anterior.continuaNaTriagem) {
        throw new Error(
          `O roteiro ${roteiro.numero} continua o ${roteiro.continuaDe}, mas aquela conversa saiu da triagem (${anterior.parou}). `
          + 'Em produção o worker não atenderia mais nenhum turno de triagem nela. '
          + 'Confira triageResolvedReasonId em .local/ia-config.json: com o motivo de encerramento configurado, '
          + 'o fluxo do financeiro entrega o boleto SEM concluir a triagem, que é o estado que este roteiro precisa.'
        );
      }
      anteriores.delete(roteiro.continuaDe);
    }

    const resultado = await conversar(roteiro, anterior);
    anteriores.set(roteiro.numero, resultado);

    // Um roteiro encadeado é avaliado sobre a conversa INTEIRA: "não repetiu
    // pergunta" precisa enxergar os turnos do 14 junto com os do 17.
    const paraAvaliar = anterior ? [...anterior.turnos, ...resultado.turnos] : resultado.turnos;
    await salvarTranscricao(resultado, paraAvaliar);

    const verificacoes = { ...INVARIANTES_GLOBAIS, ...roteiro.invariantes };
    for (const [descricao, verificar] of Object.entries(verificacoes)) {
      // O objeto de um campo só existe para a falha do jest dizer QUAL
      // invariante quebrou, em vez de "expected true, received false".
      expect({ [descricao]: verificar(paraAvaliar, resultado) }).toEqual({ [descricao]: true });
    }
  }, 180000);

  afterAll(() => {
    if (LIGADO) console.log(`Transcrições em ${SAIDA}`);
  });
});

// Fora do describe.skip de propósito: estas duas checagens não chamam a OpenAI,
// não custam nada e pegam, no `npm test` de todo dia, o erro que só apareceria
// no dia em que alguém for rodar a simulação de verdade.
describe('roteiros da simulação (sem chamar a OpenAI)', () => {
  test('todo roteiro tem número único, mensagens e invariantes', () => {
    const numeros = ROTEIROS.map((r) => r.numero);
    expect(new Set(numeros).size).toBe(numeros.length);
    for (const r of ROTEIROS) {
      expect(typeof r.nome).toBe('string');
      expect(Array.isArray(r.mensagens) && r.mensagens.length > 0).toBe(true);
      expect(Object.keys(r.invariantes || {}).length).toBeGreaterThan(0);
      for (const verificar of Object.values(r.invariantes)) expect(typeof verificar).toBe('function');
      // Ou declara a identidade inicial, ou continua outro roteiro: nunca os dois.
      expect(Boolean(r.identidade) !== Boolean(r.continuaDe)).toBe(true);
      expect((r.revisaoHumana || []).length).toBeGreaterThan(0);
    }
  });

  test('todo roteiro encadeado aponta para um roteiro ANTERIOR na lista', () => {
    ROTEIROS.forEach((r, i) => {
      if (!r.continuaDe) return;
      const pai = ROTEIROS.findIndex((x) => x.numero === r.continuaDe);
      expect(pai).toBeGreaterThanOrEqual(0);
      expect(pai).toBeLessThan(i);
    });
    // Um mesmo roteiro não pode ser pai de dois: eles compartilhariam o
    // histórico vivo da conversa.
    const pais = ROTEIROS.filter((r) => r.continuaDe).map((r) => r.continuaDe);
    expect(new Set(pais).size).toBe(pais.length);
  });
});
