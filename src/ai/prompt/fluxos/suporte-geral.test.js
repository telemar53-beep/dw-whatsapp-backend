const suporteGeral = require('./suporte-geral');
const { estadoBase } = require('../estado-de-teste');

describe('módulo suporte-geral', () => {
  describe('entra()', () => {
    test('entra com cliente não identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      });
      expect(suporteGeral.entra(estado)).toBe(true);
    });

    test('entra também com cliente identificado (identidade forte)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
        contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
      });
      expect(suporteGeral.entra(estado)).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const texto = () => suporteGeral.linhas(estadoBase()).join('\n');

    test('dúvida não é falha: não chama nem cita status, responde direto', () => {
      const t = texto();
      expect(t).toMatch(/DÚVIDA não é falha/);
      expect(t).toMatch(/NÃO chame status, NÃO cite status/);
    });

    test('alcance do Wi-Fi: perda ao se afastar é normal, nunca promete visita técnica nem equipamento', () => {
      const t = texto();
      expect(t).toMatch(/ALCANCE DO WI-FI/);
      expect(t).toMatch(/é o alcance normal do Wi-Fi/);
      expect(t).toMatch(/Nunca prometa visita técnica nem equipamento\./);
    });

    test('velocidade abaixo da contratada: pede teste perto do equipamento, nunca confirma sem teste', () => {
      const t = texto();
      expect(t).toMatch(/VELOCIDADE ABAIXO DA CONTRATADA/);
      expect(t).toMatch(/você consegue fazer um teste de velocidade perto do equipamento\?/);
      expect(t).toMatch(/NUNCA diga que a velocidade está correta sem teste, nem prometa técnico\./);
    });

    test('o exemplo de reconhecimento de velocidade usa marcador, nunca número real', () => {
      const t = texto();
      expect(t).toContain('contratei [velocidade] e aparece bem menos');
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/contratei 500/);
    });

    test('reembolso, desconto ou abatimento: nunca promete nem recusa, quem decide é a equipe', () => {
      const t = texto();
      expect(t).toMatch(/REEMBOLSO, DESCONTO OU ABATIMENTO/);
      expect(t).toMatch(/nunca prometa e nunca recuse — quem decide é a equipe/);
    });

    test('mudar o equipamento de lugar: cliente mesmo pode fazer, sem consultar status', () => {
      const t = texto();
      expect(t).toMatch(/MUDAR O EQUIPAMENTO DE LUGAR: responda direto, sem consultar status/);
      expect(t).toMatch(/você mesmo pode fazer/);
    });

    test('problema já relatado sem roteiro próprio: parte do que o cliente disse, não usa lista fixa', () => {
      const t = texto();
      expect(t).toMatch(/PROBLEMA JÁ RELATADO SEM ROTEIRO PRÓPRIO/);
      expect(t).toMatch(/NÃO use a lista fixa de diagnóstico/);
    });

    test('senha ou QR code do próprio Wi-Fi: pedido normal, nunca tratado como dado de outra pessoa', () => {
      const t = texto();
      expect(t).toMatch(/SENHA OU QR CODE DO WI-FI DO PRÓPRIO CLIENTE/);
      expect(t).toMatch(/Nunca trate isso como dado de outra pessoa\./);
    });

    test('piora em horário certo: reconhece o padrão, não trata como falha geral', () => {
      const t = texto();
      expect(t).toMatch(/PIORA EM HORÁRIO CERTO/);
      expect(t).toMatch(/não trate como falha geral/);
    });

    test('equipamento na casa de outra pessoa: é alcance de Wi-Fi, não falha', () => {
      const t = texto();
      expect(t).toMatch(/EQUIPAMENTO NA CASA DE OUTRA PESSOA/);
      expect(t).toMatch(/é alcance de Wi-Fi, não falha/);
    });

    test('dados móveis: avisa que não é a internet da casa antes de qualquer diagnóstico', () => {
      const t = texto();
      expect(t).toMatch(/DADOS MÓVEIS \(2G, 3G, 4G, 5G\)/);
      expect(t).toMatch(/teste conectado ao Wi-Fi antes de qualquer diagnóstico/);
    });

    // =================================================================
    // Task 18 — asserts migrados de ai-orchestrator.test.js
    // =================================================================
    // Os testes acima travam o RÓTULO de cada roteiro. Estes travam o MIOLO:
    // a explicação que o cliente ouve, a pergunta que a IA faz e o desfecho.
    // Cada um veio de um print de produção em que o roteiro existia e ainda
    // assim o atendimento saiu errado.

    // Antes: ai-orchestrator.test.js:1116-1119 e :1121. Print 2026-09-16:
    // "não pega no canto da rua" / "some quando saio de casa" caiu no roteiro
    // de falha (conexão online → uma pergunta → encaminhar) e o cliente saiu
    // sem entender nada.
    test('alcance do Wi-Fi: explica por que o sinal some ao se afastar e pergunta como está dentro de casa', () => {
      const t = texto();
      expect(t).toMatch(/perda de sinal ao se AFASTAR \(quintal, portão, canto da rua, cômodo distante, "some quando saio de casa"\) NÃO é falha de conexão/);
      expect(t).toMatch(/Não peça reinício de equipamento nem trate como defeito\./);
      expect(t).toMatch(/O Wi-Fi tem alcance limitado: a distância e as paredes vão enfraquecendo o sinal, por isso ele some quando você se afasta\./);
      expect(t).toMatch(/Dentro de casa, perto do equipamento, a internet está funcionando bem\?/);
    });

    // Antes: ai-orchestrator.test.js:1186-1187 e :1189. O desfecho é o que o
    // print produziu: alcance normal NÃO abre chamado. O fecho antigo, que
    // mandava concluir sempre, saiu de propósito.
    test('alcance do Wi-Fi: se dentro de casa funciona, não abre chamado; só encaminha se ele quiser melhorar o alcance', () => {
      const t = texto();
      expect(t).toMatch(/está tudo normal: NÃO abra chamado — diga que é o comportamento esperado do Wi-Fi e pergunte se precisa de mais alguma coisa\./);
      expect(t).toMatch(/Só conclua para o setor da lista acima que cuidar de suporte se ele quiser melhorar o alcance \(resumo: "quer melhorar o alcance do Wi-Fi"\) ou se disser que dentro de casa também está ruim\./);
      expect(t).not.toMatch(/conclua para o setor da lista acima que cuidar de suporte com "alcance de Wi-Fi" no resumo, sem prometer/);
    });

    // Antes: ai-orchestrator.test.js:1121. Repetidor e ponto extra são
    // política comercial: a IA não inventa o que a empresa oferece.
    test('alcance do Wi-Fi: o que a empresa oferece nesse caso sai só das instruções da operação, ou nada é oferecido', () => {
      expect(texto()).toMatch(/siga exatamente o que está lá; se não disserem nada, não ofereça nada\./);
    });

    // Antes: ai-orchestrator.test.js:1166. Print 2026-09-16: "contratei 500
    // mega, no celular aparece 20". A explicação (cabo x Wi-Fi) é o que evita
    // tanto o chamado inútil quanto a promessa de que está tudo certo.
    test('velocidade abaixo da contratada: explica que a medição é por cabo e que o Wi-Fi sempre chega menor', () => {
      const t = texto();
      expect(t).toMatch(/A velocidade do plano é entregue até o equipamento e medida por cabo\./);
      expect(t).toMatch(/No Wi-Fi ela sempre chega menor, porque a distância, as paredes e o próprio aparelho limitam o sinal/);
    });

    // Antes: ai-orchestrator.test.js:1174. Mesmo print: o pedido de reembolso
    // foi ignorado. Registrar no resumo é o que faz o atendente ver o pedido.
    test('reembolso: o pedido vai para o resumo e o problema técnico segue sendo atendido', () => {
      const t = texto();
      expect(t).toMatch(/escreva "Cliente pediu reembolso\/desconto" no resumo/);
      expect(t).toMatch(/siga atendendo o problema técnico normalmente\./);
    });

    // Antes: ai-orchestrator.test.js:1181. Print 2026-09-16: "quero mudar meu
    // roteador de lugar, posso?" virou consulta de status + uma pergunta
    // inútil + encaminhamento sem responder.
    test('mudar o equipamento de lugar: quem só queria saber se pode não é encaminhado', () => {
      const t = texto();
      expect(t).toMatch(/se ele só queria saber se pode, não encaminhe — pergunte se precisa de mais alguma coisa\./);
      expect(t).toMatch(/Se o cabo não alcançar ou precisar passar por parede, é serviço técnico e nossa equipe avalia\./);
    });

    // Antes: ai-orchestrator.test.js:1214-1217. Print 2026-09-16: "tô tentando
    // assistir um filme há uma hora, não carrega no Globoplay" recebeu "está
    // sem acesso, com lentidão ou caindo?" — o relato não tinha roteiro
    // próprio e o modelo voltou para a lista fixa.
    test('problema sem roteiro próprio: repete o relato com as palavras dele e faz UMA pergunta daquele problema', () => {
      const t = texto();
      expect(t).toMatch(/repita o problema com as palavras dele para mostrar que entendeu/);
      expect(t).toMatch(/faça UMA pergunta que faça sentido para AQUELE problema/);
      expect(t).toMatch(/vídeo travando ou não carregando/);
      expect(t).toMatch(/"acontece só nesse aplicativo ou em tudo \(outros vídeos, sites\)\?"/);
    });

    // Antes: ai-orchestrator.test.js:1273. Print 2026-09-16: pedido do QR code
    // da própria rede virou encaminhamento seco, sem nenhuma informação útil.
    test('senha do próprio Wi-Fi: diz onde a senha fica antes de encaminhar', () => {
      expect(texto()).toMatch(/a senha fica no equipamento \(normalmente numa etiqueta atrás dele\)/);
    });

    // Antes: ai-orchestrator.test.js:1279. Print 2026-09-16: "fica ruim de
    // noite, das nove em diante trava tudo na TV" caiu na lista fixa.
    test('piora em horário certo: pergunta quantos aparelhos usam naquele horário e se é em todos', () => {
      expect(texto()).toMatch(/pergunte quantos aparelhos costumam estar usando nesse horário e se acontece em todos eles ou só na TV/);
    });

    // Antes: ai-orchestrator.test.js:1286. O aviso precisa ser dado com
    // cuidado: o cliente não fez nada errado, mas o diagnóstico não vale.
    test('dados móveis: avisa com cuidado que ali ele não está usando a internet da casa', () => {
      expect(texto()).toMatch(/avise com cuidado que aí ele não está usando a internet da casa/);
    });

    test('nunca nomeia um setor fixo como string literal', () => {
      expect(texto()).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
    });

    test('nunca afirma o que a operação oferece (fibra, grátis, ilimitado) — só as instruções do painel podem', () => {
      const t = texto();
      expect(t).not.toMatch(/fibra/i);
      expect(t).not.toMatch(/óptica/i);
      expect(t).not.toMatch(/grátis/i);
      expect(t).not.toMatch(/gratuit/i);
      expect(t).not.toMatch(/ilimitad/i);
    });

    test('nunca contém preço real (R$ seguido de número)', () => {
      expect(texto()).not.toMatch(/R\$\s*\d/);
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
