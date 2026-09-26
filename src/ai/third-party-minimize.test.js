const { minimizarParaTerceiro } = require('./third-party-minimize');

// normalizeInvoices (sgp-normalizer.js) devolve faturaId e
// vencimentoOriginal/vencimentoAtualizado — nunca "id"/"vencimento" soltos. O
// bruto aqui usa os nomes REAIS de propósito, para provar que a projeção lê
// do campo certo, não só que ela sabe filtrar chaves por nome.
test('consultar_faturas devolve só id, vencimento e status', () => {
  const bruto = {
    faturas: [{
      faturaId: 5, vencimentoOriginal: '2026-09-10', vencimentoAtualizado: '2026-09-12', status: 'aberta',
      valorOriginal: 135.0, valorAtualizado: 135.0, pagador: 'MARIA SILVA', linhaDigitavel: '0001...',
    }],
  };
  expect(minimizarParaTerceiro('consultar_faturas', bruto))
    .toEqual({ faturas: [{ id: 5, vencimento: '2026-09-10', status: 'aberta' }] });
});

test('consultar_faturas usa vencimentoOriginal também quando não há vencimentoAtualizado', () => {
  const bruto = { faturas: [{ faturaId: 7, vencimentoOriginal: '2026-09-01', status: 'aberta' }] };
  expect(minimizarParaTerceiro('consultar_faturas', bruto))
    .toEqual({ faturas: [{ id: 7, vencimento: '2026-09-01', status: 'aberta' }] });
});

// Regra financeira 0/1/2+ (25/09/2026, decisão do dono que substitui a de antes — "a atualizada
// prevalece"): o SGP troca o vencimento_atualizado da fatura ATRASADA pela data de hoje. Mostrar a
// atualizada fazia a IA ver uma fatura vencida há 55 dias como "vence hoje". A exposta é a
// ORIGINAL, e a atualizada não aparece em lugar nenhum do retorno.
test('36b. consultar_faturas expõe o vencimento ORIGINAL: a vencida nunca aparece como "vence hoje"', () => {
  const bruto = { faturas: [{ faturaId: 9, vencimentoOriginal: '2026-08-01', vencimentoAtualizado: '2026-09-25', status: 'Gerado' }] };
  const r = minimizarParaTerceiro('consultar_faturas', bruto);
  expect(r).toEqual({ faturas: [{ id: 9, vencimento: '2026-08-01', status: 'Gerado' }] });
  expect(JSON.stringify(r)).not.toMatch('2026-09-25');
});

test('enviar_boleto devolve só a confirmação e a instrução, sem valor', () => {
  const bruto = { enviado: true, valor: 135.0, vencimento: '2026-09-10', linhaDigitavelEnviada: true, instrucao: 'texto' };
  const r = minimizarParaTerceiro('enviar_boleto', bruto);
  expect(r).toEqual({ enviado: true, linhaDigitavelEnviada: true, instrucao: 'texto' });
  expect(r).not.toHaveProperty('valor');
});

test('gerar_pix devolve só a confirmação e a instrução', () => {
  expect(minimizarParaTerceiro('gerar_pix', { enviado: true, valor: 135.0, codigo: '000201...', instrucao: 'texto' }))
    .toEqual({ enviado: true, instrucao: 'texto' });
});

test('gerar_segunda_via devolve só a confirmação e a instrução quando achou fatura', () => {
  const bruto = {
    temFaturaAberta: true,
    faturas: [{ faturaId: 5, vencimento: '2026-09-10', valor: 135, linhaDigitavel: '0001...', linkBoleto: 'https://x' }],
    instrucao: 'texto',
  };
  expect(minimizarParaTerceiro('gerar_segunda_via', bruto)).toEqual({ gerado: true, instrucao: 'texto' });
});

// gerado nunca pode ser true quando a busca não achou fatura nenhuma: é a
// mesma classe do defeito real de 2026-09-15 (a IA dizia "enviei o boleto"
// sem enviar). A confirmação tem que vir de um campo real do resultado
// (temFaturaAberta), nunca de uma constante — sem este teste, um "gerado:
// true" fixo na projeção passaria despercebido.
test('gerar_segunda_via nunca afirma sucesso quando não havia fatura em aberto', () => {
  const bruto = { temFaturaAberta: false, faturas: [], motivo: 'Nenhuma fatura em aberto em nenhum contrato do cliente.' };
  expect(minimizarParaTerceiro('gerar_segunda_via', bruto)).toEqual({ gerado: false });
});

// Falha fechado: uma ferramenta nova que entre na lista de permissao sem
// projecao devolve o minimo, em vez de despejar o payload do SGP no modelo.
test('ferramenta sem projeção definida não vaza nada', () => {
  expect(minimizarParaTerceiro('ferramenta_nova', { segredo: 'x', dadosCadastrais: {} }))
    .toEqual({ ok: true });
});

test('nenhum dado cadastral do titular sobrevive a nenhuma projeção', () => {
  const envenenado = {
    faturas: [{ id: 1, vencimento: 'd', status: 's', endereco: 'Rua X', cpf: '52998224725', nomeCompleto: 'MARIA DA SILVA', telefone: '98999', email: 'a@b.c' }],
    enviado: true, instrucao: 'texto',
  };
  for (const nome of ['consultar_faturas', 'enviar_boleto', 'gerar_pix', 'gerar_segunda_via']) {
    const texto = JSON.stringify(minimizarParaTerceiro(nome, envenenado));
    expect(texto).not.toMatch(/Rua X|52998224725|MARIA DA SILVA|98999|a@b\.c/);
  }
});
