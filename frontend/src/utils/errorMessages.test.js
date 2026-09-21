import { describe, test, expect } from 'vitest';
import { descreverErro, detalheTecnicoDoErro } from './errorMessages';

// Etapa 7.1 — o backend responde em ingles e essas frases chegavam cruas a
// tela como mensagem principal.
describe('descreverErro', () => {
  const erroDaApi = (texto) => ({ body: { error: texto } });

  test('traduz os erros que o usuario mais encontra', () => {
    expect(descreverErro(erroDaApi('Invalid credentials'))).toBe('E-mail ou senha incorretos.');
    expect(descreverErro(erroDaApi('Failed to reach SGP'))).toBe('Não foi possível falar com o SGP.');
    expect(descreverErro(erroDaApi('Conversation already assigned or closed')))
      .toBe('Este atendimento já foi assumido por outra pessoa ou já foi encerrado.');
    expect(descreverErro(erroDaApi('This phone number is not on WhatsApp'))).toBe('Este número não tem WhatsApp.');
  });

  test('sem mapeamento, o texto original vai inteiro para a tela', () => {
    // Engolir um erro desconhecido seria pior que mostra-lo em ingles: quem
    // esta na frente da tela precisa de algo para relatar ao suporte.
    expect(descreverErro(erroDaApi('Some brand new backend error'))).toBe('Some brand new backend error');
  });

  test('mensagem que o backend ja manda em portugues passa intacta', () => {
    const cru = 'A lista não pode ter mais de 2000 destinatários';
    expect(descreverErro(erroDaApi(cru))).toBe(cru);
  });

  test('sem erro nenhum, usa o padrao de quem chamou', () => {
    expect(descreverErro(null, 'Falha ao salvar')).toBe('Falha ao salvar');
    expect(descreverErro({}, 'Falha ao salvar')).toBe('Falha ao salvar');
    expect(descreverErro(new Error('boom'), 'Falha ao salvar')).toBe('Falha ao salvar');
  });

  test('aceita string solta e o formato { error }', () => {
    expect(descreverErro('Invalid credentials')).toBe('E-mail ou senha incorretos.');
    expect(descreverErro({ error: 'Channel not found' })).toBe('Canal não encontrado.');
  });

  // O numero vem do servidor; a regra so o recoloca na frase em portugues.
  test('frases com valor interpolado preservam o valor do servidor', () => {
    expect(descreverErro(erroDaApi('File exceeds the 100MB upload limit'))).toBe('O arquivo passa do limite de 100 MB.');
    expect(descreverErro(erroDaApi('File exceeds the 5MB upload limit'))).toBe('O arquivo passa do limite de 5 MB.');
    expect(descreverErro(erroDaApi('This template requires exactly 3 variable(s)')))
      .toBe('Este template exige exatamente 3 variável(is).');
    expect(descreverErro(erroDaApi('Template "boas_vindas" not found for this channel')))
      .toBe('O template "boas_vindas" não existe neste canal.');
  });

  test('erros de campo obrigatorio viram frase, sem inventar significado', () => {
    // `apiKey is required` tem entrada propria no mapa e ganha frase melhor;
    // a regra generica cobre o resto dos campos.
    expect(descreverErro(erroDaApi('apiKey is required'))).toBe('Informe a chave da API.');
    expect(descreverErro(erroDaApi('baseUrl is required'))).toBe('O campo "baseUrl" é obrigatório.');
    expect(descreverErro(erroDaApi('active must be a boolean'))).toBe('O campo "active" precisa ser verdadeiro ou falso.');
    expect(descreverErro(erroDaApi('agentIds must be an array'))).toBe('O campo "agentIds" precisa ser uma lista.');
  });

  test('nenhuma traducao inventa um motivo que o backend nao deu', () => {
    // "Conversation is closed" nao pode virar "o cliente encerrou" nem nada
    // parecido: o backend so afirma que esta fechada.
    expect(descreverErro(erroDaApi('Conversation is closed'))).toBe('Este atendimento já foi encerrado.');
  });
});

describe('detalheTecnicoDoErro', () => {
  test('devolve o texto original quando houve traducao', () => {
    expect(detalheTecnicoDoErro({ body: { error: 'Failed to reach SGP' } })).toBe('Failed to reach SGP');
  });

  test('nao devolve nada quando o proprio texto tecnico ja esta na tela', () => {
    expect(detalheTecnicoDoErro({ body: { error: 'Some brand new backend error' } })).toBeNull();
    expect(detalheTecnicoDoErro(null)).toBeNull();
  });
});
