const fatos = require('./fatos');
const { estadoBase } = require('./estado-de-teste');

describe('módulo fatos', () => {
  test('entra sempre, independente do estado', () => {
    expect(fatos.entra(estadoBase())).toBe(true);
  });

  test('data e hora vêm de estado.agora (determinístico), nunca do relógio', () => {
    const texto = fatos.linhas(estadoBase({ agora: new Date('2026-09-17T14:00:00.000Z') })).join('\n');
    expect(texto).toContain('Hoje é 17/09/2026 e agora são 11:00 em Brasília.');
  });

  test('cumprimenta só na primeira resposta e não repete saudação depois', () => {
    const texto = fatos.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/Cumprimente só na primeira resposta da conversa; nas seguintes, não repita a saudação/);
  });

  describe('SGP indisponível', () => {
    test('cumprimenta pelo nome da memória, sem pedir CPF nem tentar boleto/PIX', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      })).join('\n');
      expect(texto).toMatch(/Cliente identificado pela memória \(primeiro nome Maria\), mas o sistema do SGP NÃO respondeu agora/);
      expect(texto).toMatch(/NÃO peça CPF e NÃO tente boleto, PIX nem status de conexão/);
      expect(texto).toMatch(/SGP indisponível na triagem/);
    });

    test('sem primeiro nome, usa o fallback "cliente"', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: null, contracts: [], contestado: false, sgpIndisponivel: true },
      })).join('\n');
      expect(texto).toMatch(/primeiro nome cliente\)/);
    });
  });

  describe('cliente não identificado', () => {
    test('pede CPF/CNPJ só se o setor exigir, e não trata Comercial de cliente novo', () => {
      const texto = fatos.linhas(estadoBase()).join('\n');
      expect(texto).toMatch(/Cliente NÃO identificado\. Peça o CPF\/CNPJ só se o setor exigir identificação/);
      expect(texto).toMatch(/Comercial de cliente novo nunca exige CPF/);
    });

    test('identidade contestada soma o aviso de identificação descartada', () => {
      const semContestar = fatos.linhas(estadoBase()).join('\n');
      expect(semContestar).not.toMatch(/identificação foi descartada/);

      const comContestar = fatos.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: true },
      })).join('\n');
      expect(comContestar).toMatch(/O cliente disse que o nome anterior não era dele: a identificação foi descartada\. Peça o CPF\./);
    });
  });

  describe('cliente identificado (forte)', () => {
    function estadoIdentificado(extraIdentidade = {}, contratos = []) {
      return estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false, ...extraIdentidade },
        contratos,
      });
    }

    test('saudação sempre na primeira resposta, com o primeiro nome', () => {
      const texto = fatos.linhas(estadoIdentificado()).join('\n');
      expect(texto).toMatch(/Cliente identificado \(telefone\): primeiro nome João/);
      expect(texto).toMatch(/A PRIMEIRA resposta desta conversa começa SEMPRE com a saudação da hora e o primeiro nome \("Bom dia, João!"\)/);
    });

    test('sem primeiro nome, usa o fallback "cliente" e não aparece "null"', () => {
      const texto = fatos.linhas(estadoIdentificado({ primeiroNome: null })).join('\n');
      expect(texto).toMatch(/primeiro nome cliente\./);
      expect(texto).not.toMatch(/null/);
    });

    test('origem memória e CPF também aparecem traduzidas', () => {
      const memoria = fatos.linhas(estadoIdentificado({ origem: 'memory' })).join('\n');
      expect(memoria).toMatch(/Cliente identificado \(memória\)/);

      const cpf = fatos.linhas(estadoIdentificado({ origem: 'cpf' })).join('\n');
      expect(cpf).toMatch(/Cliente identificado \(CPF\)/);
    });

    test('sem contratos, não lista "Contratos dele:"', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [])).join('\n');
      expect(texto).not.toContain('Contratos dele:');
    });

    test('um contrato só: lista e diz para usar sem perguntar qual', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 101, plano: 'Plano X', velocidade: '500 Mega', endereco: 'Rua das Flores, 10', status: 'ativo' },
      ])).join('\n');
      expect(texto).toContain('Contratos dele:');
      expect(texto).toContain('- contrato 101 — Plano X (500 Mega) — Rua das Flores, 10 — ativo');
      expect(texto).toMatch(/Contrato único: use-o sem perguntar qual\./);
    });

    test('contrato sem velocidade e sem endereço usa os textos de fallback', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 55, plano: 'Plano Y', velocidade: null, endereco: null, status: 'suspenso' },
      ])).join('\n');
      expect(texto).toContain('- contrato 55 — Plano Y — endereço não informado — suspenso');
    });

    test('múltiplos contratos: lista todos e NÃO diz "contrato único"', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 1, plano: 'A', velocidade: null, endereco: 'Rua A', status: 'ativo' },
        { id: 2, plano: 'B', velocidade: null, endereco: 'Rua B', status: 'ativo' },
      ])).join('\n');
      expect(texto).toContain('- contrato 1 — A — Rua A — ativo');
      expect(texto).toContain('- contrato 2 — B — Rua B — ativo');
      expect(texto).not.toMatch(/Contrato único/);
      expect(texto).toMatch(/pergunte de uma vez pelo endereço, citando os endereços/);
    });

    test('nunca cita o número do contrato ao cliente nem pede para escolher pelo número', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 1, plano: 'A', velocidade: null, endereco: 'Rua A', status: 'ativo' },
      ])).join('\n');
      expect(texto).toMatch(/Nunca peça o número do contrato nem pergunte "qual contrato": o cliente não sabe\. NUNCA cite o número do contrato ao cliente\./);
    });

    test('permite dizer atraso em dias\\/meses e quantidade de faturas, mas nunca o valor', () => {
      const texto = fatos.linhas(estadoIdentificado()).join('\n');
      expect(texto).toMatch(/Com identidade confirmada você pode dizer há quantos dias\/meses a fatura está vencida e quantas faturas estão em aberto/);
      expect(texto).toMatch(/Continua proibido dizer o VALOR\./);
      expect(texto).toMatch(/NUNCA diga ao cliente: valores e vencimentos de faturas, plano contratado ou endereço/);
    });
  });

  describe('privacidade e dados de terceiros (sempre presentes)', () => {
    test.each(['none', 'forte'])('aparece com identidade %s', (nivel) => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel, origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
      })).join('\n');
      expect(texto).toMatch(/DADOS DE OUTRA PESSOA: senha do Wi-Fi, dados cadastrais, endereço ou informação de vizinho/);
      expect(texto).toMatch(/Não consigo passar dados de outro cliente, nem a senha da rede dele/);
      expect(texto).toMatch(/isso já é pedido de terceiro: passe titularEOutraPessoa: true/);
      expect(texto).toMatch(/FATURA, BOLETO OU PIX DE OUTRA PESSOA é a exceção/);
    });

    test('relato do problema do vizinho não é tratado como pedido de dado', () => {
      const texto = fatos.linhas(estadoBase()).join('\n');
      expect(texto).toMatch(/Relatar problema do vizinho .* NÃO é pedido de dado: atenda o relato normalmente/);
    });
  });

  describe('guardas de princípio (não reintroduzir o que foi removido)', () => {
    test('nunca menciona data de nascimento em nenhum cenário', () => {
      for (const identidade of [
        { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
        { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
        { nivel: 'forte', origem: 'memory', primeiroNome: 'João', contracts: [], contestado: false, sgpIndisponivel: true },
      ]) {
        const texto = fatos.linhas(estadoBase({ identidade })).join('\n');
        expect(texto).not.toMatch(/nascimento/i);
      }
    });

    test('não existe ramo de identidade fraca: só none, forte e sgpIndisponivel são tratados', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'fraca', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
      })).join('\n');
      // Sem tratamento próprio, 'fraca' cai no mesmo ramo de identidade
      // confirmada (else) que 'forte' — não existe um terceiro caminho.
      expect(texto).toMatch(/Cliente identificado \(telefone\): primeiro nome João/);
    });
  });
});
