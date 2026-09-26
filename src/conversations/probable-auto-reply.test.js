const { classificarAutorresposta, normalizarTexto, JANELA_MS } = require('./probable-auto-reply');

// Fase 1C (25/09/2026): autorresposta provável do WhatsApp Business do destinatário depois de
// um disparo automático. Regra determinística e conservadora: na dúvida, NÃO suprime.
const T = new Date('2026-09-25T15:00:00.000Z');
const DISPARO_SGP = { origem: 'sgp', modo: 'template', criadoEm: T };

function caso({
  texto, tipo = 'text', segundos = 30, citada = false, atendenteId = null,
  disparo = DISPARO_SGP, depoisDoDisparo = [], anteriores = [],
} = {}) {
  return classificarAutorresposta({
    mensagem: { tipo, texto, citada, recebidaEm: new Date(T.getTime() + segundos * 1000) },
    atendenteId, disparo, depoisDoDisparo, anteriores,
  });
}

const RESTAURANTE = 'Restaurante sabor caseiro agradece seu contato. Como podemos ajudar?';

describe('classificarAutorresposta — suprime (janela de 120 s)', () => {
  test('1. caso real: "Restaurante sabor caseiro agradece seu contato. Como podemos ajudar?" 30 s depois do disparo SGP', () => {
    expect(caso({ texto: RESTAURANTE })).toEqual({ suprimir: true, motivo: 'janela_padrao_forte' });
  });

  test('2. "Recebemos sua mensagem. Nosso horário de atendimento é..." (padrão forte)', () => {
    expect(caso({ texto: 'Recebemos sua mensagem. Nosso horário de atendimento é das 8h às 18h.' }))
      .toEqual({ suprimir: true, motivo: 'janela_padrao_forte' });
  });

  test('4. "Seja bem-vindo! Como podemos ajudar?" — dois sinais médios', () => {
    expect(caso({ texto: 'Seja bem-vindo! Como podemos ajudar?' })).toEqual({ suprimir: true, motivo: 'janela_padroes_medios' });
  });

  test.each([
    ['retorno posterior', 'Olá! Retornaremos o seu contato assim que possível.'],
    ['ausência', 'No momento estamos ausentes.'],
    ['fechado', 'Estamos fechados agora.'],
    ['declaração explícita', 'Esta é uma mensagem automática.'],
    ['equipe vai responder', 'Olá, em instantes um de nossos atendentes vai te responder.'],
    ['atendemos de', 'Atendemos de segunda a sábado.'],
  ])('família forte (%s)', (_nome, texto) => {
    expect(caso({ texto })).toEqual({ suprimir: true, motivo: 'janela_padrao_forte' });
  });

  test('disparo de campanha também é contexto compatível', () => {
    expect(caso({ texto: RESTAURANTE, disparo: { origem: 'campanha', criadoEm: T } })).toEqual({ suprimir: true, motivo: 'janela_padrao_forte' });
  });

  test('uma autorresposta anterior JÁ MARCADA depois do disparo não impede a seguinte', () => {
    expect(caso({ texto: 'Estamos fechados agora.', depoisDoDisparo: [{ direcao: 'inbound', autorresposta: true }] }))
      .toEqual({ suprimir: true, motivo: 'janela_padrao_forte' });
  });
});

describe('classificarAutorresposta — NÃO suprime', () => {
  test('3. "Como podemos ajudar?" isolado: um sinal médio só', () => {
    expect(caso({ texto: 'Como podemos ajudar?' })).toEqual({ suprimir: false, razao: 'sinais_insuficientes' });
  });

  test.each([
    ['5', 'Que mensagem é essa?'],
    ['6', 'Já paguei o boleto'],
    ['7', 'Não sei do que se trata'],
  ])('%s. pergunta ou fala humana: "%s"', (_n, texto) => {
    expect(caso({ texto }).suprimir).toBe(false);
  });

  // Anti-sinal com padrão presente: é o anti-sinal que segura.
  test.each([
    ['primeira pessoa + cobrança', 'Recebemos sua mensagem, mas eu já paguei essa fatura.'],
    ['valor em dinheiro', 'Nosso horário de atendimento é das 8h às 18h. O valor é R$ 99,90.'],
    ['CPF', 'Recebemos sua mensagem. CPF 123.456.789-09'],
    ['pergunta humana', 'Que mensagem é essa? Seja bem-vindo, como podemos ajudar?'],
    ['internet', 'Estamos fechados? Minha internet caiu'],
    ['segunda via', 'Recebemos sua mensagem. Quero a segunda via'],
    ['vocês', 'Vocês agradecem o contato? Como podemos ajudar?'],
  ])('anti-sinal vence os padrões (%s)', (_nome, texto) => {
    expect(caso({ texto })).toEqual({ suprimir: false, razao: 'anti_sinal' });
  });

  test('pronome dentro de outra palavra não é anti-sinal ("seu", "museu"): a frase empresarial passa', () => {
    expect(caso({ texto: 'O Museu da Cidade agradece seu contato.' })).toEqual({ suprimir: true, motivo: 'janela_padrao_forte' });
  });

  test('padrão forte dentro de PERGUNTA não conta ("Essa mensagem é automática?")', () => {
    expect(caso({ texto: 'Essa mensagem é automática?' })).toEqual({ suprimir: false, razao: 'sinais_insuficientes' });
  });

  test('8. áudio nunca é suprimido (mesmo com texto de padrão forte)', () => {
    expect(caso({ tipo: 'audio', texto: RESTAURANTE })).toEqual({ suprimir: false, razao: 'nao_e_texto' });
  });

  test.each(['image', 'document', 'location', 'sticker', 'interactive', 'button', 'video'])('9. %s nunca é suprimido', (tipo) => {
    expect(caso({ tipo, texto: RESTAURANTE })).toEqual({ suprimir: false, razao: 'nao_e_texto' });
  });

  test('10. resposta citada (quoted/context reply) nunca é suprimida', () => {
    expect(caso({ texto: RESTAURANTE, citada: true })).toEqual({ suprimir: false, razao: 'resposta_citada' });
  });

  test('11. padrão forte depois de 120 s, primeira ocorrência: não suprime', () => {
    expect(caso({ texto: RESTAURANTE, segundos: 121 })).toEqual({ suprimir: false, razao: 'fora_da_janela' });
  });

  test('11b. DUAS famílias fortes fora da janela também não (regra rejeitada)', () => {
    expect(caso({ texto: 'Recebemos sua mensagem. Retornaremos em breve.', segundos: 600 })).toEqual({ suprimir: false, razao: 'fora_da_janela' });
  });

  test('exatamente 120 s ainda está na janela', () => {
    expect(caso({ texto: RESTAURANTE, segundos: JANELA_MS / 1000 }).suprimir).toBe(true);
  });

  test('15. conversa com atendente atribuído: nunca suprime', () => {
    expect(caso({ texto: RESTAURANTE, atendenteId: 'ag-1' })).toEqual({ suprimir: false, razao: 'tem_atendente' });
  });

  test('16. já houve mensagem humana normal depois do disparo: a próxima não é autorresposta daquele disparo', () => {
    expect(caso({ texto: RESTAURANTE, depoisDoDisparo: [{ direcao: 'inbound', autorresposta: false }] }))
      .toEqual({ suprimir: false, razao: 'humano_depois_do_disparo' });
  });

  test('saída que não é disparo depois do disparo (atendente, IA): não suprime', () => {
    expect(caso({ texto: RESTAURANTE, depoisDoDisparo: [{ direcao: 'outbound', automatica: false }] }))
      .toEqual({ suprimir: false, razao: 'saida_nao_automatica_depois_do_disparo' });
  });

  test('sem disparo automático na conversa: não suprime', () => {
    expect(caso({ texto: RESTAURANTE, disparo: null })).toEqual({ suprimir: false, razao: 'sem_disparo' });
  });

  test('disparo SGP em texto livre (Baileys) não é contexto compatível: nada muda no Baileys', () => {
    expect(caso({ texto: RESTAURANTE, disparo: { origem: 'sgp', modo: 'freetext', criadoEm: T } }))
      .toEqual({ suprimir: false, razao: 'disparo_incompativel' });
  });

  test('texto vazio: não suprime', () => {
    expect(caso({ texto: '   ' })).toEqual({ suprimir: false, razao: 'texto_vazio' });
  });
});

describe('classificarAutorresposta — repetição comprovada (fora da janela)', () => {
  const ANTERIOR_NA_JANELA = { texto: RESTAURANTE, autorresposta: true, motivo: 'janela_padrao_forte' };

  test('12. igual (normalizado) a uma autorresposta anterior marcada logo após disparo: suprime por repetição', () => {
    const texto = '  restaurante SABOR caseiro agradece seu contato!! como podemos ajudar ';
    expect(caso({ texto, segundos: 900, anteriores: [ANTERIOR_NA_JANELA] })).toEqual({ suprimir: true, motivo: 'repeticao_comprovada' });
  });

  test('13. repetição sem ocorrência anterior marcada: não suprime', () => {
    expect(caso({ texto: RESTAURANTE, segundos: 900, anteriores: [{ texto: RESTAURANTE, autorresposta: false, motivo: null }] }))
      .toEqual({ suprimir: false, razao: 'fora_da_janela' });
  });

  test('14. repetição cuja anterior NÃO aconteceu logo após disparo: não suprime', () => {
    expect(caso({ texto: RESTAURANTE, segundos: 900, anteriores: [{ texto: RESTAURANTE, autorresposta: true, motivo: 'repeticao_comprovada' }] }))
      .toEqual({ suprimir: false, razao: 'fora_da_janela' });
  });

  test('texto curto (< 20 caracteres) nunca vale como repetição', () => {
    const curto = 'Estamos fechados.';
    expect(caso({ texto: curto, segundos: 900, anteriores: [{ texto: curto, autorresposta: true, motivo: 'janela_padrao_forte' }] }))
      .toEqual({ suprimir: false, razao: 'fora_da_janela' });
  });

  test('texto diferente de toda autorresposta anterior: não suprime', () => {
    expect(caso({ texto: 'Olá, tudo bem? Qual o assunto?', segundos: 900, anteriores: [ANTERIOR_NA_JANELA] }).suprimir).toBe(false);
  });
});

describe('normalizarTexto', () => {
  test('trim, minúsculas, acentos, pontuação básica e espaços repetidos', () => {
    expect(normalizarTexto('  Olá!!  Seja   BEM-VINDO, à Loja.  ')).toBe('ola seja bem vindo a loja');
  });
});
