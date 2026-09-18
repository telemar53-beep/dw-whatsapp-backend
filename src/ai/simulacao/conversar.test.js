// Teste de fumaça do harness: ele roda de ponta a ponta com a OpenAI FINGIDA.
//
// Por que existe. A simulação de verdade depende de duas coisas que só o dono
// tem (a chave e os textos do painel), então ela fica pulada. Sem este arquivo,
// o harness inteiro — o encadeamento de turnos, os mocks do mundo, a captura
// dos argumentos das ferramentas, o registro de estado e a transcrição — seria
// código que nunca rodou, e o dia de rodar a simulação seria o dia de
// descobrir que ele não funciona. Aqui a única peça trocada é a resposta do
// modelo: todo o resto é o caminho de produção, com o executor de ferramentas
// e o registro de ferramentas de verdade.
//
// Este teste NÃO julga comportamento de IA (as respostas são escritas à mão
// aqui): quem faz isso é `invariantes.js`, com o modelo de verdade.
jest.mock('../../integrations/sgp-client');
jest.mock('../ai-config.repository');
jest.mock('../ai-interaction.repository');
jest.mock('../../conversations/message.repository');
jest.mock('../../conversations/conversation.repository');
jest.mock('../../conversations/contact.repository');
jest.mock('../../reasons/reason.repository');
jest.mock('../../sectors/sector.repository');
jest.mock('../../company/company-config.repository');
jest.mock('../trust-unlock.repository');
jest.mock('../../media/media-storage');
jest.mock('../../queue/outbound-queue');
jest.mock('../../realtime/socket-server');
jest.mock('../../payments/payment-sender');
jest.mock('../../cities/contact-city.service');
jest.mock('../../city-notices/city-notice.service');
jest.mock('../triage-close-reason');
jest.mock('../receipt-usage.repository');
// A diferença para a simulação real está NESTA linha, e só nela.
jest.mock('../openai-client');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createChatCompletion } = require('../openai-client');
const sgpClient = require('../../integrations/sgp-client');
const { enqueueOutboundMessage } = require('../../queue/outbound-queue');
const { conversar, salvarTranscricao, configDoPainel } = require('./conversar');
const { setorPorPapel, motivoPorPapel, CPF } = require('./sgp-falso');

// Valor claramente falso: a chave de verdade nunca entra em teste, e forçar o
// valor aqui garante que uma chave presente no ambiente do dono não vá parar
// nos argumentos registrados pelo mock.
const CHAVE_FALSA = 'chave-de-teste-nao-e-uma-chave';
const FINANCEIRO = setorPorPapel('financeiro');
const RESOLVIDO = motivoPorPapel('resolvido-pela-ia');

let pastaTemporaria;
let chaveOriginal;
let localOriginal;

function respostaComTexto(texto) {
  return { message: { role: 'assistant', content: texto }, usage: { promptTokens: 1, completionTokens: 1 } };
}

function respostaComFerramenta(nome, args) {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: `call-${nome}`, type: 'function', function: { name: nome, arguments: JSON.stringify(args) } }],
    },
    usage: { promptTokens: 1, completionTokens: 1 },
  };
}

/** O modelo fingido responde, na ordem, o que o teste enfileirou. */
function enfileirar(respostas) {
  const fila = respostas.slice();
  createChatCompletion.mockImplementation(async () => {
    if (fila.length === 0) throw new Error('O turno pediu mais respostas do que este teste enfileirou');
    return fila.shift();
  });
  return () => fila.length;
}

beforeAll(() => {
  pastaTemporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'simulacao-fumaca-'));
  fs.writeFileSync(path.join(pastaTemporaria, 'ia-config.json'), JSON.stringify({
    model: 'modelo-de-teste',
    mode: 'triage',
    maxToolsPerInteraction: 8,
    triageMaxQuestions: 5,
    triageConfidenceThreshold: 0.8,
    triageResolvedReasonId: RESOLVIDO ? RESOLVIDO.id : null,
    triageReadReceiptsDaytime: false,
    empresa: 'Provedor de Teste',
  }), 'utf8');
  fs.writeFileSync(path.join(pastaTemporaria, 'prompt-sistema.txt'), 'Você é a recepcionista de um provedor de teste.', 'utf8');
  fs.writeFileSync(path.join(pastaTemporaria, 'instrucoes-operacao.txt'), 'Instruções de teste da operação.', 'utf8');
  localOriginal = process.env.SIMULACAO_LOCAL;
  chaveOriginal = process.env.OPENAI_API_KEY;
  process.env.SIMULACAO_LOCAL = pastaTemporaria;
  process.env.OPENAI_API_KEY = CHAVE_FALSA;
});

afterAll(() => {
  if (localOriginal === undefined) delete process.env.SIMULACAO_LOCAL;
  else process.env.SIMULACAO_LOCAL = localOriginal;
  if (chaveOriginal === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = chaveOriginal;
  fs.rmSync(pastaTemporaria, { recursive: true, force: true });
});

// O roteiro do teste de fumaça: o mesmo formato dos roteiros de verdade, com
// um áudio no meio, para exercitar também o caminho da transcrição.
const ROTEIRO = {
  numero: 99,
  nome: 'fumaca do harness',
  identidade: 'nenhuma',
  mensagens: [
    'Quero o boleto da minha esposa',
    { audio: '390.533.447-05' },
    'Pode mandar',
    'Obrigado!',
  ],
  invariantes: {},
  revisaoHumana: ['pergunta de exemplo'],
};

describe('conversar (harness com a OpenAI fingida)', () => {
  test('roda o roteiro pelo runAiTurn real, do primeiro turno à conclusão', async () => {
    const sobrando = enfileirar([
      // turno 1
      respostaComTexto('Claro! Me informe o CPF ou CNPJ dela, por favor.'),
      // turno 2 (áudio com o CPF da titular)
      respostaComFerramenta('buscar_cliente', { cpf: '39053344705', titularEOutraPessoa: true }),
      respostaComTexto('Localizei o contrato no CPF informado. Posso enviar o boleto dela?'),
      // turno 3
      respostaComFerramenta('enviar_boleto', { contratoId: 401 }),
      respostaComFerramenta('concluir_triagem', {
        setorId: FINANCEIRO.id,
        resumo: 'Quem está falando não é a titular: pediu o boleto da esposa, localizado pelo CPF dela. Boleto entregue em PDF com a linha digitável.',
        confianca: 0.9,
      }),
      respostaComTexto('Enviei acima o boleto em PDF e com a linha digitável.'),
    ]);

    const resultado = await conversar(ROTEIRO);

    // Três turnos: o quarto não chega a ser enviado porque a triagem concluiu,
    // e em produção o worker também não atenderia mais nada na triagem.
    expect(resultado.turnos).toHaveLength(3);
    expect(resultado.mensagensNaoEnviadas).toEqual(['Obrigado!']);
    expect(resultado.parou).toContain(FINANCEIRO.name);
    expect(resultado.continuaNaTriagem).toBe(false);
    expect(sobrando()).toBe(0);

    // O áudio virou a fala do cliente, e o turno soube que a origem foi áudio.
    expect(resultado.turnos[1].audio).toBe(true);
    expect(resultado.turnos[1].cliente).toBe('390.533.447-05');
    const historicoVistoPeloModelo = createChatCompletion.mock.calls[1][0].messages;
    expect(historicoVistoPeloModelo.some((m) => m.role === 'user' && m.content === '390.533.447-05')).toBe(true);

    // As ferramentas RODARAM de verdade (executor e registro reais).
    expect(sgpClient.lookupClientByCpf).toHaveBeenCalledWith('39053344705');
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalled();
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ messageType: 'document' }));
    expect(resultado.turnos[2].toolsExecutadas.map((f) => f.nome)).toEqual(['enviar_boleto', 'concluir_triagem']);
  });

  test('captura os ARGUMENTOS das ferramentas, com o documento já mascarado', async () => {
    enfileirar([
      respostaComFerramenta('buscar_cliente', { cpf: CPF.TITULAR_ATIVO, titularEOutraPessoa: true }),
      respostaComTexto('Localizei o contrato no CPF informado.'),
    ]);

    const resultado = await conversar({ ...ROTEIRO, numero: 98, mensagens: ['O CPF dela é 390.533.447-05'] });

    const pedidas = resultado.turnos[0].toolsSolicitadas;
    expect(pedidas).toHaveLength(1);
    expect(pedidas[0].nome).toBe('buscar_cliente');
    expect(pedidas[0].args.titularEOutraPessoa).toBe(true);
    // O CPF cru nunca fica guardado no harness: o que chega é o que a auditoria
    // de produção grava, já mascarado pelo orquestrador.
    expect(pedidas[0].args.cpf).not.toBe(CPF.TITULAR_ATIVO);
    expect(pedidas[0].args.cpf).toMatch(/\*/);
  });

  test('registra o estado antes e depois de cada turno', async () => {
    enfileirar([
      respostaComTexto('Claro! Me informe o CPF ou CNPJ dela, por favor.'),
      respostaComFerramenta('buscar_cliente', { cpf: CPF.TITULAR_ATIVO, titularEOutraPessoa: true }),
      respostaComTexto('Localizei o contrato no CPF informado.'),
    ]);

    const resultado = await conversar({
      ...ROTEIRO, numero: 97, mensagens: ['Quero o boleto da minha esposa', '390.533.447-05'],
    });

    expect(resultado.turnos[0].antes).toEqual({
      identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contestado: false },
      contratos: [], terceiro: null, attempts: 0,
    });
    // Depois do buscar_cliente com titularEOutraPessoa: o escopo do terceiro
    // aparece e a identidade de quem fala NÃO sobe.
    expect(resultado.turnos[1].depois.identidade.nivel).toBe('none');
    expect(resultado.turnos[1].depois.contratos).toEqual([]);
    expect(resultado.turnos[1].depois.terceiro).toEqual({ nome: 'Fulana', contratos: [401] });
    expect(resultado.turnos[1].depois.attempts).toBe(2);
  });

  test('a transcrição sai completa e sem nada de segredo', async () => {
    enfileirar([respostaComTexto('Claro! Me informe o CPF ou CNPJ dela, por favor.')]);
    const resultado = await conversar({ ...ROTEIRO, numero: 96, mensagens: ['Quero o boleto da minha esposa'] });
    const arquivo = await salvarTranscricao(resultado, resultado.turnos);
    try {
      const conteudo = fs.readFileSync(arquivo, 'utf8');
      expect(conteudo).toContain('# 96 — fumaca do harness');
      expect(conteudo).toContain('Quero o boleto da minha esposa');
      expect(conteudo).toContain('Claro! Me informe o CPF ou CNPJ dela');
      expect(conteudo).toContain('## Para revisão humana');
      expect(conteudo).toContain('pergunta de exemplo');
      expect(conteudo).toContain('Antes: identidade none/none');
      expect(conteudo).not.toContain(CHAVE_FALSA);
      expect(conteudo).not.toContain('apiKey');
    } finally {
      fs.rmSync(arquivo, { force: true });
    }
  });

  test('a config do painel recusa a chave em arquivo e cobra o que falta', () => {
    const comChave = path.join(pastaTemporaria, 'ia-config.json');
    const original = fs.readFileSync(comChave, 'utf8');
    try {
      fs.writeFileSync(comChave, JSON.stringify({ ...JSON.parse(original), apiKey: 'nao-pode' }), 'utf8');
      expect(() => configDoPainel()).toThrow(/apiKey/);
      fs.writeFileSync(comChave, JSON.stringify({ model: 'x' }), 'utf8');
      expect(() => configDoPainel()).toThrow(/maxToolsPerInteraction/);
    } finally {
      fs.writeFileSync(comChave, original, 'utf8');
    }
  });

  test('sem OPENAI_API_KEY no ambiente, a conversa nem começa', async () => {
    const guardada = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(conversar({ ...ROTEIRO, numero: 95, mensagens: ['oi'] })).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      process.env.OPENAI_API_KEY = guardada;
    }
  });
});
