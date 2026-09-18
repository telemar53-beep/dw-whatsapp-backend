const comercialNovo = require('./comercial-novo');
const { estadoBase } = require('../estado-de-teste');

describe('módulo comercial-novo', () => {
  describe('entra()', () => {
    test('entra quando o cliente ainda não foi identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      });
      expect(comercialNovo.entra(estado)).toBe(true);
    });

    test('NÃO entra com o cliente já identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
        contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
      });
      expect(comercialNovo.entra(estado)).toBe(false);
    });

    test('NÃO entra com SGP indisponível (identidade continua forte pela memória)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(comercialNovo.entra(estado)).toBe(false);
    });
  });

  describe('conteúdo', () => {
    const texto = () => comercialNovo.linhas(estadoBase()).join('\n');

    test('cobre cobertura, planos e contratação', () => {
      expect(texto()).toMatch(/VENDA \(cobertura, planos, contratar, mudar de plano\)/);
    });

    test('nunca pede CPF ou CNPJ de cliente novo', () => {
      expect(texto()).toMatch(/Nunca peça CPF ou CNPJ de cliente novo/);
    });

    test('cobertura: cidade na lista atende todos os bairros; fora da lista encaminha sem inventar', () => {
      const t = texto();
      expect(t).toMatch(/se a cidade estiver nas instruções, atendemos em TODOS os bairros e ruas dela/i);
      expect(t).toMatch(/Se a cidade NÃO estiver na lista de cobertura, diga que a equipe confirma a cobertura e conclua para o setor da lista acima que cuidar de vendas, sem inventar\./);
    });

    test('pergunta de cobertura emenda a abertura de cliente novo na mesma mensagem', () => {
      expect(texto()).toMatch(/a pergunta de cobertura é o começo da venda, não o fim/);
    });

    test('cliente que já diz ser cliente é identificado primeiro, sem listar todas as cidades', () => {
      const t = texto();
      expect(t).toMatch(/Se ele disser que JÁ é cliente e quer outro ponto ou mudar de plano, identifique-o primeiro \(peça CPF ou CNPJ\)/);
      expect(t).toMatch(/Não liste todas as cidades atendidas/);
    });

    test('formato de plano sem bloco pronto usa marcador de velocidade e valor, nunca número real', () => {
      const t = texto();
      expect(t).toContain('• [velocidade] por R$ [valor]/mês');
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/R\$\s*\d/);
    });

    test('abertura de cliente novo diz "Temos estes planos:", sem afirmar 100% fibra óptica nem instalação grátis', () => {
      const t = texto();
      expect(t).toContain('Temos estes planos:');
      expect(t).not.toMatch(/100% fibra óptica/i);
      expect(t).not.toMatch(/[Ii]nstalação grátis/);
    });

    test('a saudação da abertura não crava horário fixo: usa o marcador de saudação da hora', () => {
      const t = texto();
      expect(t).toMatch(/\(saudação da hora\)/);
      expect(t).not.toMatch(/Boa noite! 😊 Temos/);
    });

    test('endereço é uma pergunta só, com exemplo usando marcador de bairro\\/cidade (não nome real)', () => {
      const t = texto();
      expect(t).toMatch(/Endereço é UMA pergunta só \(bairro e rua juntos\)/);
      expect(t).toContain('[bairro], [cidade]');
      expect(t).not.toMatch(/Godofredo Viana/);
    });

    test('recomendação de plano responde antes de encaminhar, sem citar preço real', () => {
      const t = texto();
      expect(t).toMatch(/Se ele perguntar qual plano é o melhor ou pedir indicação/);
      expect(t).toMatch(/Nunca encaminhe deixando uma pergunta dele sem resposta/);
    });

    test('documentação de cadastro: usa a lista das instruções, ou avisa e encaminha sem deixar sem resposta', () => {
      const t = texto();
      expect(t).toMatch(/O QUE PRECISA PARA FAZER O CADASTRO/);
      expect(t).toMatch(/mas NÃO encaminhe sem responder alguma coisa/);
    });

    test('só encaminha nas condições previstas (plano escolhido, endereço dado, pediu atendente, ou cidade fora da lista)', () => {
      const t = texto();
      expect(t).toMatch(/SOMENTE quando: ele escolher um plano ou pedir para contratar; ou já tiver dado o endereço; ou pedir para falar com um atendente; ou a cidade não estiver na lista\./);
    });

    test('resumo do encaminhamento inclui plano, cidade e bairro/rua', () => {
      expect(texto()).toMatch(/Ao encaminhar, o resumo inclui: plano de interesse, cidade, bairro\/rua se tiver, e o que ele contou\./);
    });

    test('nunca nomeia um setor fixo como string literal', () => {
      expect(texto()).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
    });

    test('nunca contém nome real de cliente', () => {
      expect(texto()).not.toMatch(/Willemberg/);
    });

    test('nunca reintroduz data de nascimento, identidade fraca ou gate de confiança', () => {
      const t = texto();
      expect(t).not.toMatch(/nascimento/i);
      expect(t).not.toMatch(/identidade fraca/i);
      expect(t).not.toMatch(/gate de confiança/i);
    });
  });
});
