const {
  sinaisOperacionais, temSinal, situacaoDoWifi, violacoesDaResposta, correcaoDaResposta,
  respostaSeguraDaContencao, linhaDoWifiNoResumo,
} = require('./contencoes-operacionais');

// Contenções operacionais (25/09/2026): equipamento com defeito físico, troca de nome/senha do
// Wi-Fi e explicação financeira sem fonte oficial. Documentos e senhas daqui são sintéticos.

const entrada = (content) => ({ direction: 'inbound', messageType: 'text', content });
const saida = (content) => ({ direction: 'outbound', messageType: 'text', content, sentBy: 'ai' });
const sinais = (...textos) => sinaisOperacionais(textos.map((t) => (typeof t === 'string' ? entrada(t) : t)));

const TITULAR = { nivel: 'forte', origem: 'phone', primeiroNome: 'Maria', contracts: [{ id: 5 }] };
const SEM_IDENT = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] };
const ctx = (contencoes, extra = {}) => ({
  contencoes, identidade: TITULAR, contracts: [{ id: 5 }], terceiro: null, avisoCidade: null, triagemConcluida: null,
  triagem: { noturno: { ativo: false } }, ...extra,
});

describe('A — equipamento com defeito físico: o sinal sai da fala do cliente', () => {
  test.each([
    'meu roteador queimou', 'a ONU não liga', 'a fonte queimou', 'o roteador não acende mais',
    'a ONU está sem energia', 'está saindo cheiro de queimado do aparelho', 'a fonte parou', 'o modem pifou',
  ])('"%s" é defeito físico', (texto) => {
    expect(sinais(texto).defeitoFisico).toBe(true);
  });

  test.each([
    'minha internet está lenta', 'estou sem internet', 'o celular não liga no wifi', 'estou sem energia em casa',
    'o roteador está ligado mas a internet não funciona',
  ])('"%s" NÃO é defeito físico', (texto) => {
    expect(sinais(texto).defeitoFisico).toBe(false);
  });

  test('a autorresposta provável (Fase 1C) não conta como fala do cliente', () => {
    const auto = { ...entrada('meu roteador queimou'), metadata: { autorrespostaProvavel: true } };
    expect(sinaisOperacionais([auto]).defeitoFisico).toBe(false);
  });
});

describe('A — o que a resposta não pode dizer com defeito físico', () => {
  const defeito = sinais('meu roteador queimou');

  test.each([
    'Reinicie o roteador e me avise.', 'Faça um teste de velocidade, por favor.', 'Teste em outros aparelhos da casa.',
    'Desligue da tomada por 30 segundos e ligue de novo.', 'Aperte o botão de reset.', 'Verifique os cabos.',
  ])('roteiro comum: "%s"', (texto) => {
    expect(violacoesDaResposta(texto, { contexto: ctx(defeito) })).toContain('equipamento_roteiro');
  });

  test.each([
    'Abra o equipamento e veja se tem algo solto.', 'Meça a tensão da tomada.', 'Use uma fonte de outra voltagem.',
    'Pode improvisar com o carregador do celular.', 'Troque a fonte por uma parecida.',
  ])('procedimento inseguro: "%s"', (texto) => {
    expect(violacoesDaResposta(texto, { contexto: ctx(defeito) })).toContain('equipamento_inseguro');
  });

  test.each([
    'Vamos agendar uma visita técnica.', 'Um técnico vai até você amanhã.', 'Vamos trocar o seu roteador.',
    'Deve ser resolvido em 24 horas.',
  ])('promessa sem fonte: "%s"', (texto) => {
    expect(violacoesDaResposta(texto, { contexto: ctx(defeito) })).toContain('equipamento_promessa');
  });

  test('com aviso de cidade ativo, atribuir o defeito à ocorrência (sem encaminhar) é mascarar o equipamento', () => {
    const c = ctx(defeito, { avisoCidade: { cidade: 'Maracaçumé', mensagem: 'Instabilidade.' } });
    expect(violacoesDaResposta('Há uma ocorrência na rede em Maracaçumé, aguarde a normalização.', { contexto: c })).toContain('equipamento_mascarado');
    // Encaminhado de fato: citar a ocorrência junto não mascara nada.
    expect(violacoesDaResposta('Há uma ocorrência na rede, e registrei o defeito para o suporte.', { contexto: { ...c, triagemConcluida: { setor: 'Suporte' } } })).toEqual([]);
  });

  test('resposta certa passa: acolhe, não orienta nada no equipamento', () => {
    expect(violacoesDaResposta('Entendi, o roteador queimou. Não mexa nele: registrei para o setor Suporte.', { contexto: ctx(defeito) })).toEqual([]);
  });

  test('sem defeito físico, o diagnóstico normal é permitido', () => {
    const lenta = sinais('minha internet está lenta');
    expect(violacoesDaResposta('Reinicie o roteador e faça um teste de velocidade.', { contexto: ctx(lenta) })).toEqual([]);
  });
});

describe('B — pedido de troca de nome/senha do Wi-Fi', () => {
  test('senha pedida, sem valor', () => {
    expect(sinais('quero mudar a senha do Wi-Fi').wifi).toEqual({ senha: true, nome: false, senhaInformada: false, nomeInformado: false, deOutraPessoa: false });
  });

  test('senha pedida COM a nova senha na mesma mensagem', () => {
    expect(sinais('quero mudar a senha do Wi-Fi para Casa@2025').wifi).toMatchObject({ senha: true, senhaInformada: true });
    expect(sinais('troca a senha do wifi, a nova senha é abc12345').wifi).toMatchObject({ senhaInformada: true });
  });

  test('nome da rede com o valor: a senha NÃO foi pedida', () => {
    expect(sinais('quero mudar o nome da rede para CASA').wifi).toEqual({ senha: false, nome: true, senhaInformada: false, nomeInformado: true, deOutraPessoa: false });
  });

  test('nome e senha, sem valores; o valor de um não vira do outro', () => {
    expect(sinais('quero trocar a senha e o nome do wifi').wifi).toMatchObject({ senha: true, nome: true, senhaInformada: false, nomeInformado: false });
    expect(sinais('quero trocar a senha do wifi e o nome da rede para CASA').wifi).toMatchObject({ senhaInformada: false, nomeInformado: true });
  });

  test('"para uma mais segura", "pra mim": não é valor', () => {
    expect(sinais('quero trocar a senha do wifi para uma mais segura').wifi.senhaInformada).toBe(false);
    expect(sinais('troca a senha do wifi pra mim').wifi.senhaInformada).toBe(false);
  });

  test('valor respondido depois da pergunta da IA conta como informado', () => {
    const s = sinais('quero mudar a senha do wifi', saida('Qual senha você quer usar no Wi-Fi?'), 'Casa@2025');
    expect(s.wifi.senhaInformada).toBe(true);
    const naoSei = sinais('quero mudar a senha do wifi', saida('Qual senha você quer usar no Wi-Fi?'), 'não sei ainda');
    expect(naoSei.wifi.senhaInformada).toBe(false);
  });

  test('pedido para o Wi-Fi de outra pessoa', () => {
    expect(sinais('quero mudar a senha do wifi da minha mãe').wifi.deOutraPessoa).toBe(true);
    expect(sinais('quero mudar a senha do wifi da minha casa').wifi.deOutraPessoa).toBe(false);
  });

  test.each(['esqueci a senha do wifi', 'qual a senha do wifi?', 'quero trocar de plano', 'quero mudar a senha do app'])(
    '"%s" não é pedido de troca do Wi-Fi', (texto) => {
      expect(sinais(texto).wifi).toBeNull();
    }
  );

  test('situação: titular identificado, não identificado, terceiro (escopo financeiro ou pedido para outra pessoa)', () => {
    const s = sinais('quero mudar a senha do wifi');
    expect(situacaoDoWifi(ctx(s))).toBe('titular');
    expect(situacaoDoWifi(ctx(s, { identidade: SEM_IDENT }))).toBe('nao_identificado');
    expect(situacaoDoWifi(ctx(s, { identidade: SEM_IDENT, terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] } }))).toBe('terceiro');
    expect(situacaoDoWifi(ctx(sinais('quero mudar a senha do wifi da minha mãe')))).toBe('terceiro');
    // O escopo de boleto/PIX de terceiro não tira o titular identificado da própria rede.
    expect(situacaoDoWifi(ctx(s, { terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] } }))).toBe('titular');
  });
});

describe('B — o que a resposta não pode dizer num pedido de Wi-Fi', () => {
  const soSenha = sinais('quero mudar a senha do wifi');

  test.each([
    'Acesse 192.168.0.1 no navegador e troque a senha.', 'Entre no painel do roteador.', 'Use o usuário admin e a senha admin.',
    'Baixe o aplicativo do fabricante.', 'Abra o navegador e digite o endereço do roteador.',
  ])('painel do roteador: "%s"', (texto) => {
    expect(violacoesDaResposta(texto, { contexto: ctx(soSenha) })).toContain('wifi_painel');
  });

  test('ensinar o painel é barrado mesmo sem o pedido detectado ("como troco a senha?")', () => {
    expect(violacoesDaResposta('Acesse 192.168.1.1 e entre com usuário admin.', { contexto: ctx(sinais('como troco a senha?')) })).toEqual(['wifi_painel']);
  });

  test.each([
    'Me informe seu endereço, por favor.', 'Qual é a sua data de nascimento?', 'Qual o modelo do roteador?',
    'Me passe o usuário e a senha de administrador.', 'Me confirme seu CPF, por favor.',
  ])('dado desnecessário: "%s"', (texto) => {
    expect(violacoesDaResposta(texto, { contexto: ctx(soSenha) })).toContain('wifi_dado_desnecessario');
  });

  test('com mais de um contrato, perguntar de qual endereço é a rede é permitido', () => {
    const c = ctx(soSenha, { contracts: [{ id: 5 }, { id: 6 }] });
    expect(violacoesDaResposta('De qual endereço é a rede que você quer alterar?', { contexto: c })).toEqual([]);
  });

  test('pedir a senha que falta é certo; pedir a senha já informada ou não pedida é repetir', () => {
    expect(violacoesDaResposta('Qual senha você quer usar no Wi-Fi?', { contexto: ctx(soSenha) })).toEqual([]);
    const informada = sinais('quero mudar a senha do Wi-Fi para Casa@2025');
    expect(violacoesDaResposta('Certo! Qual é a nova senha?', { contexto: ctx(informada) })).toContain('wifi_repergunta');
    expect(violacoesDaResposta('Pode me confirmar a nova senha?', { contexto: ctx(informada) })).toContain('wifi_repergunta');
    const soNome = sinais('quero mudar o nome da rede para CASA');
    expect(violacoesDaResposta('Perfeito. E qual senha você quer colocar?', { contexto: ctx(soNome) })).toContain('wifi_repergunta');
  });

  test('frase afirmativa citando a senha não é pergunta', () => {
    const informada = sinais('quero mudar a senha do Wi-Fi para Casa@2025');
    expect(violacoesDaResposta('Registrei o pedido de troca da senha do Wi-Fi.', { contexto: ctx(informada) })).toEqual([]);
  });

  test('não identificado ou terceiro: coletar a nova senha é prosseguir sem titular', () => {
    expect(violacoesDaResposta('Qual a nova senha?', { contexto: ctx(soSenha, { identidade: SEM_IDENT }) })).toContain('wifi_sem_titular');
    const terceiro = ctx(sinais('quero mudar a senha do wifi dela'), { identidade: SEM_IDENT, terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] } });
    expect(violacoesDaResposta('Claro! Qual a nova senha?', { contexto: terceiro })).toContain('wifi_sem_titular');
    expect(violacoesDaResposta('Certo, vamos trocar a senha dela.', { contexto: terceiro })).toContain('wifi_sem_titular');
    expect(violacoesDaResposta('Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.', { contexto: ctx(soSenha, { identidade: SEM_IDENT }) })).toEqual([]);
  });
});

describe('C — pedido de explicação financeira específica', () => {
  test.each([
    'por que minha fatura veio esse valor?', 'vai vir quanto mês que vem?', 'teve proporcional?',
    'qual período está sendo cobrado?', 'mudei de plano, por que a fatura veio mais cara?', 'quanto vai ser a próxima fatura?',
  ])('"%s" pede fato financeiro do contrato', (texto) => {
    expect(sinais(texto).explicacaoFinanceira).toBe(true);
  });

  // Item 20: nada de 0/1/2+ aqui — pedir para pagar não é pedir explicação.
  test.each(['quero o boleto', 'quero pagar', 'manda o pix', 'quero o boleto da minha mãe', 'o que é proporcional?'])(
    '"%s" NÃO é pedido de explicação específica', (texto) => {
      expect(sinais(texto).explicacaoFinanceira).toBe(false);
    }
  );
});

describe('C — afirmação financeira sem fonte oficial', () => {
  const porQue = sinais('por que minha fatura veio esse valor?');
  const FATURAS = JSON.stringify({ faturas: [{ valorOriginal: 99.9, valorAtualizado: '102.30', vencimentoOriginal: '2026-10-10' }] });

  test('sem fonte nenhuma: explicação, valor, proporcional e previsão são barrados', () => {
    for (const texto of [
      'Sua fatura veio mais alta porque teve o proporcional da mudança de plano.',
      'Mês que vem deve vir R$ 99,90.', 'Não, não teve proporcional.', 'Sim, teve proporcional de 10 dias.',
      'O período cobrado é de 01/09 a 30/09.',
    ]) {
      expect(violacoesDaResposta(texto, { contexto: ctx(porQue), fontes: '' })).toEqual(['financeiro_sem_fonte']);
    }
  });

  test('fato que a ferramenta devolveu pode ser usado (valor, vencimento)', () => {
    const texto = 'Sua fatura é de R$ 99,90, atualizada para R$ 102,30, com vencimento em 10/10/2026.';
    expect(violacoesDaResposta(texto, { contexto: ctx(porQue), fontes: FATURAS })).toEqual([]);
  });

  test('ferramenta com período explícito: o período pode ser usado', () => {
    const fontes = JSON.stringify({ faturas: [{ valorOriginal: 99.9, periodo: '01/09/2026 a 30/09/2026' }] });
    expect(violacoesDaResposta('O período cobrado é de 01/09/2026 a 30/09/2026, no valor de R$ 99,90.', { contexto: ctx(porQue), fontes })).toEqual([]);
  });

  test('instrução explícita do painel também é fonte', () => {
    const teve = sinais('teve proporcional?');
    const fontes = 'A primeira fatura é proporcional aos dias de uso.';
    expect(violacoesDaResposta('Pela nossa política, a primeira fatura é proporcional aos dias de uso.', { contexto: ctx(teve), fontes })).toEqual([]);
  });

  test('fonte parcial: o confirmado passa, a lacuna completada não', () => {
    expect(violacoesDaResposta('Sua fatura é de R$ 99,90 e vence em 10/10/2026. O motivo desse valor eu não tenho confirmado no sistema.', { contexto: ctx(porQue), fontes: FATURAS })).toEqual([]);
    expect(violacoesDaResposta('Sua fatura é de R$ 99,90 e inclui o proporcional de 5 dias.', { contexto: ctx(porQue), fontes: FATURAS })).toEqual(['financeiro_sem_fonte']);
    expect(violacoesDaResposta('Sua fatura é de R$ 105,00.', { contexto: ctx(porQue), fontes: FATURAS })).toEqual(['financeiro_sem_fonte']);
    expect(violacoesDaResposta('Sua fatura vence em 15/10/2026.', { contexto: ctx(porQue), fontes: FATURAS })).toEqual(['financeiro_sem_fonte']);
  });

  test('sem pedido de explicação, a guarda financeira não age (boleto/PIX seguem normais)', () => {
    const boleto = sinais('quero o boleto');
    expect(violacoesDaResposta('Enviei o boleto de R$ 99,90.', { contexto: ctx(boleto), fontes: '' })).toEqual([]);
  });

  test('a resposta segura não tem nada a barrar', () => {
    expect(violacoesDaResposta('Não tenho essa informação confirmada no sistema.', { contexto: ctx(porQue), fontes: '' })).toEqual([]);
  });
});

describe('correção no laço: o que o código manda fazer', () => {
  test('equipamento com titular identificado: concluir para suporte, sem nenhuma orientação', () => {
    const c = correcaoDaResposta(['equipamento_roteiro'], ctx(sinais('meu roteador queimou')));
    expect(c.concluir).toBe(true);
    expect(c.instrucao).toMatch(/concluir_triagem/);
    expect(c.instrucao).toMatch(/suporte/);
  });

  test('equipamento sem identificação: pedir só o CPF ou CNPJ, sem concluir ainda', () => {
    const c = correcaoDaResposta(['equipamento_roteiro'], ctx(sinais('meu roteador queimou'), { identidade: SEM_IDENT }));
    expect(c.concluir).toBe(false);
    expect(c.instrucao).toMatch(/CPF ou CNPJ/);
  });

  test('Wi-Fi do titular: concluir só quando nada falta', () => {
    expect(correcaoDaResposta(['wifi_repergunta'], ctx(sinais('quero mudar a senha do Wi-Fi para Casa@2025'))).concluir).toBe(true);
    const falta = correcaoDaResposta(['wifi_painel'], ctx(sinais('quero mudar a senha do wifi')));
    expect(falta.concluir).toBe(false);
    expect(falta.instrucao).toMatch(/senha nova/);
  });

  test('Wi-Fi de terceiro: nada de coletar nem encaminhar a alteração', () => {
    const c = correcaoDaResposta(['wifi_sem_titular'], ctx(sinais('quero mudar a senha do wifi dela'), { identidade: SEM_IDENT, terceiro: { nome: 'N', contratos: [] } }));
    expect(c.concluir).toBe(false);
    expect(c.instrucao).toMatch(/só pode ser pedida pelo próprio titular/);
  });

  test('financeiro com titular identificado: concluir para o financeiro', () => {
    const c = correcaoDaResposta(['financeiro_sem_fonte'], ctx(sinais('teve proporcional?')));
    expect(c.concluir).toBe(true);
    expect(c.instrucao).toMatch(/financeiro/);
  });
});

describe('resposta segura (se o modelo insistir depois da correção)', () => {
  test('equipamento encaminhado, de dia e à noite', () => {
    const s = sinais('meu roteador queimou');
    expect(respostaSeguraDaContencao(['equipamento_roteiro'], ctx(s, { triagemConcluida: { setor: 'Suporte' } })))
      .toBe('Entendi. Não mexa no equipamento nem tente consertar. Seu atendimento vai para o setor Suporte e um atendente continua daqui.');
    expect(respostaSeguraDaContencao(['equipamento_roteiro'], ctx(s, { triagemConcluida: { setor: 'Suporte' }, triagem: { noturno: { ativo: true, retornoAs: '08:00' } } })))
      .toBe('Entendi. Não mexa no equipamento nem tente consertar. Seu atendimento ficou registrado para o setor Suporte e nossa equipe dá continuidade a partir das 08:00.');
  });

  test('equipamento sem identificação: pede só o documento', () => {
    expect(respostaSeguraDaContencao(['equipamento_inseguro'], ctx(sinais('a fonte queimou'), { identidade: SEM_IDENT })))
      .toBe('Entendi. Não mexa no equipamento nem tente consertar. Para eu encaminhar ao suporte, me informe o CPF ou CNPJ do titular, por favor.');
  });

  test('Wi-Fi: pede só o que falta; terceiro é recusado; sem pedido detectado, só a regra', () => {
    expect(respostaSeguraDaContencao(['wifi_painel'], ctx(sinais('quero mudar a senha do wifi'))))
      .toBe('Nós fazemos essa alteração para você, sem precisar mexer no equipamento. Qual senha você quer usar no Wi-Fi?');
    expect(respostaSeguraDaContencao(['wifi_sem_titular'], ctx(sinais('quero mudar a senha do wifi dela'), { identidade: SEM_IDENT, terceiro: { nome: 'N', contratos: [] } })))
      .toBe('A alteração do Wi-Fi só pode ser pedida pelo próprio titular do contrato.');
    expect(respostaSeguraDaContencao(['wifi_sem_titular'], ctx(sinais('quero mudar a senha do wifi'), { identidade: SEM_IDENT })))
      .toBe('Nós fazemos essa alteração para você, sem precisar mexer no equipamento. Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.');
    expect(respostaSeguraDaContencao(['wifi_painel'], ctx(sinais('como troco a senha?'))))
      .toBe('Essa alteração é feita pela nossa equipe, sem você precisar mexer no equipamento.');
  });

  test('financeiro: não tem a informação confirmada; encaminhado quando concluiu', () => {
    const s = sinais('teve proporcional?');
    expect(respostaSeguraDaContencao(['financeiro_sem_fonte'], ctx(s))).toBe('Não tenho essa informação confirmada no sistema.');
    expect(respostaSeguraDaContencao(['financeiro_sem_fonte'], ctx(s, { triagemConcluida: { setor: 'Financeiro' } })))
      .toBe('Não tenho essa informação confirmada no sistema. Seu atendimento vai para o setor Financeiro e um atendente continua daqui.');
  });

  test('a própria resposta segura não viola a contenção', () => {
    const s = sinais('meu roteador queimou');
    const c = ctx(s, { triagemConcluida: { setor: 'Suporte' } });
    expect(violacoesDaResposta(respostaSeguraDaContencao(['equipamento_roteiro'], c), { contexto: c })).toEqual([]);
  });
});

describe('resumo do concluir_triagem: quem pediu a troca do Wi-Fi', () => {
  test('titular identificado: pedido registrado, sem repetir a senha', () => {
    const linha = linhaDoWifiNoResumo(ctx(sinais('quero mudar a senha do Wi-Fi para Casa@2025')));
    expect(linha).toBe('Alteração do Wi-Fi (senha) pedida pelo titular identificado; os valores novos estão na conversa.');
    expect(linha).not.toContain('Casa@2025');
  });

  test('não titular: NÃO fazer a alteração', () => {
    expect(linhaDoWifiNoResumo(ctx(sinais('quero mudar o nome da rede dela para CASA'), { identidade: SEM_IDENT, terceiro: { nome: 'N', contratos: [] } })))
      .toBe('Alteração do Wi-Fi (nome da rede) pedida por quem NÃO é o titular identificado: NÃO fazer a alteração.');
  });

  test('sem pedido de Wi-Fi, nenhuma linha', () => {
    expect(linhaDoWifiNoResumo(ctx(sinais('quero o boleto')))).toBeNull();
    expect(temSinal(sinais('quero o boleto'))).toBe(false);
  });
});
