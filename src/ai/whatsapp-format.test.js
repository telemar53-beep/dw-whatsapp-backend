const { paraWhatsApp } = require('./whatsapp-format');

describe('paraWhatsApp', () => {
  test('converte negrito markdown (**) para o asterisco simples do WhatsApp', () => {
    expect(paraWhatsApp('preciso saber **qual contrato** consultar')).toBe('preciso saber *qual contrato* consultar');
  });

  test('converte itálico markdown (__) para o sublinhado simples', () => {
    expect(paraWhatsApp('vence __amanhã__')).toBe('vence _amanhã_');
  });

  test('remove marcadores de título no começo da linha', () => {
    expect(paraWhatsApp('## Faturas em aberto\n- R$ 99,90')).toBe('Faturas em aberto\n- R$ 99,90');
  });

  test('troca bullet com asterisco por hífen, para não virar negrito quebrado', () => {
    expect(paraWhatsApp('* primeira\n* segunda')).toBe('- primeira\n- segunda');
  });

  test('desfaz link markdown mantendo texto e URL', () => {
    expect(paraWhatsApp('segunda via: [boleto](https://x.y/b.pdf)')).toBe('segunda via: boleto (https://x.y/b.pdf)');
  });

  test('negrito+itálico com três asteriscos vira negrito simples, sem sobrar **', () => {
    expect(paraWhatsApp('isso é ***muito importante***')).toBe('isso é *muito importante*');
  });

  test('não corrompe URL com sublinhado duplo dentro de link markdown', () => {
    expect(paraWhatsApp('[baixe aqui](https://x/a__b__c)')).toBe('baixe aqui (https://x/a__b__c)');
  });

  test('não corrompe URL solta com sublinhado duplo nem asteriscos', () => {
    const texto = 'veja https://x/y_z__w/**k** agora';
    expect(paraWhatsApp(texto)).toBe(texto);
  });

  test('não mexe em texto que já está no formato do WhatsApp', () => {
    const texto = 'Olá! *Fatura* de R$ 99,90 vence _hoje_.\n- Pix\n- Boleto';
    expect(paraWhatsApp(texto)).toBe(texto);
  });

  test('preserva o código PIX copia e cola intacto', () => {
    const pix = '00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d5204000053039865802BR';
    expect(paraWhatsApp(`Seu código:\n${pix}`)).toBe(`Seu código:\n${pix}`);
  });

  test('remove a mensagem inteira repetida, mesmo colada na linha anterior', () => {
    // Observado em produção: saudação + pergunta duplicadas num único balão,
    // com a repetição colada na linha anterior (sem linha em branco).
    const duplicado = 'Boa noite, Simeão! Posso te ajudar.\n\nAntes de enviar, me confirma sua data?\nBoa noite, Simeão! Posso te ajudar.\n\nAntes de enviar, me confirma sua data?';
    expect(paraWhatsApp(duplicado)).toBe('Boa noite, Simeão! Posso te ajudar.\n\nAntes de enviar, me confirma sua data?');
    expect(paraWhatsApp('A\n\nB\n\nA\n\nB')).toBe('A\n\nB');
    // Só o padrão "A + A" é tratado; uma repetição tripla não tem metade igual
    // e passa intacta — é raro e o custo de generalizar é falso positivo.
    expect(paraWhatsApp('Oi\nOi\nOi')).toBe('Oi\nOi\nOi');
  });

  test('linhas legitimamente repetidas em contratos diferentes ficam intactas', () => {
    // O deduplicador é da mensagem inteira, não de linhas: "Status: Ativo"
    // aparece uma vez por contrato e as duas precisam sobreviver.
    const texto = 'Contrato 111 — Rua X\nStatus: Ativo\n\nContrato 222 — Rua Y\nStatus: Ativo';
    expect(paraWhatsApp(texto)).toBe(texto);
  });

  test('parágrafos diferentes e listas de uma linha ficam intactos', () => {
    const texto = 'Olá!\n\n- Pix\n- Boleto\n\nQual prefere?';
    expect(paraWhatsApp(texto)).toBe(texto);
  });

  test('devolve nulo e vazio sem quebrar', () => {
    expect(paraWhatsApp(null)).toBeNull();
    expect(paraWhatsApp('')).toBe('');
  });

  describe('parágrafo quase repetido', () => {
    test('descarta a frase colada do modelo quando ela repete a frase do próprio texto', () => {
      // Observado em produção (2026-09-13): o modelo escreveu com as palavras
      // dele e, na linha seguinte, colou o modelo de frase do prompt.
      const texto = 'Bom dia, Willemberg! 😊 Vou te ajudar com o boleto. Como você tem mais de um contrato com a gente, pode me confirmar de qual endereço você precisa?\n'
        + 'Claro, vou te ajudar com o boleto. Como você tem mais de um contrato com a gente, pode me confirmar de qual endereço você precisa?';
      expect(paraWhatsApp(texto)).toBe('Bom dia, Willemberg! 😊 Vou te ajudar com o boleto. Como você tem mais de um contrato com a gente, pode me confirmar de qual endereço você precisa?');
    });

    test('também com linha em branco entre as duas versões', () => {
      const texto = 'Enviei acima o PIX referente ao seu contrato do endereço Agenor Costa. É só copiar o código e colar no app do seu banco.\n\n'
        + 'Pronto! Enviei acima o PIX referente ao seu contrato do endereço Agenor Costa, é só copiar o código e colar no aplicativo do seu banco.';
      expect(paraWhatsApp(texto)).toBe('Enviei acima o PIX referente ao seu contrato do endereço Agenor Costa. É só copiar o código e colar no app do seu banco.');
    });

    test('frases diferentes com algumas palavras em comum ficam intactas', () => {
      const texto = 'Sua conexão está offline no momento, e o contrato segue ativo no sistema.\n\nSe quiser, posso abrir um chamado para o técnico verificar a conexão na sua casa.';
      expect(paraWhatsApp(texto)).toBe(texto);
    });

    test('linhas curtas iguais (status por contrato, itens de lista) nunca são tocadas', () => {
      const texto = 'Contrato 111 — Rua X\nStatus: Ativo\nPlano: 600 Mega\n\nContrato 222 — Rua Y\nStatus: Ativo\nPlano: 600 Mega';
      expect(paraWhatsApp(texto)).toBe(texto);
    });
  });
});
