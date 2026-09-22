const fs = require('fs');
const path = require('path');

// REGRA CRITICA do item: enriquecer uma consulta do frontend nao pode fazer
// dado administrativo escorrer para IA, OpenAI, ferramentas, SGP, integracoes
// ou mensagem para o cliente (ADR-008).
//
// As duas consultas que passaram a trazer nota interna --
// listWaitingConversations e listConversationsByAgent -- so podem ter a
// camada HTTP do atendente como consumidora. Este teste le o codigo-fonte e
// falha se alguem passar a importa-las de outro lugar. Nao e um teste de
// comportamento: e o unico jeito de provar "ninguem mais usa isso".

const RAIZ = path.join(__dirname, '..');

const CONSULTAS_ENRIQUECIDAS = ['listWaitingConversations', 'listConversationsByAgent'];

const AREAS_PROIBIDAS = [
  ['ai', 'IA / orquestrador / tool-registry / prompt'],
  ['queue', 'workers de fila (mensagens, IA, transcricao)'],
  ['sgp', 'SGP'],
  ['payments', 'Pix / boleto'],
  ['whatsapp-adapters', 'Baileys / Meta Cloud / 360dialog'],
  ['campaigns', 'campanhas'],
];

function arquivosDe(pasta) {
  const raiz = path.join(RAIZ, pasta);
  if (!fs.existsSync(raiz)) return [];
  const achados = [];
  (function andar(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) andar(caminho);
      else if (entrada.name.endsWith('.js') && !entrada.name.includes('.test.')) achados.push(caminho);
    }
  })(raiz);
  return achados;
}

describe('as consultas enriquecidas nao alcancam area protegida', () => {
  for (const [pasta, descricao] of AREAS_PROIBIDAS) {
    test(`${descricao} nao usa nenhuma delas`, () => {
      const culpados = [];
      for (const arquivo of arquivosDe(pasta)) {
        const fonte = fs.readFileSync(arquivo, 'utf8');
        for (const consulta of CONSULTAS_ENRIQUECIDAS) {
          if (fonte.includes(consulta)) culpados.push(`${path.relative(RAIZ, arquivo)} usa ${consulta}`);
        }
      }
      expect(culpados).toEqual([]);
    });
  }

  // Tambem nao podem estar em rota de integracao, que e chamada pelo SGP com
  // API key e nao por um atendente logado.
  test('as rotas de integracao SGP nao usam nenhuma delas', () => {
    for (const arquivo of ['api/integrations-sgp.routes.js', 'api/sgp-query.routes.js']) {
      const fonte = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
      for (const consulta of CONSULTAS_ENRIQUECIDAS) {
        expect(fonte).not.toContain(consulta);
      }
    }
  });

  // O presenter e o unico lugar que decide quem ve nota interna. Se uma rota
  // devolver a lista crua, o filtro nao aconteceu.
  test('as rotas de conversa passam as duas listas pelo presenter', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'api/conversations.routes.js'), 'utf8');

    expect(fonte).toContain("require('../conversations/conversation.presenter')");
    // Nenhuma das duas pode ser devolvida sem passar pelo apresentador.
    expect(fonte).not.toMatch(/res\.json\(\s*await\s+listWaitingConversations/);
    expect(fonte).not.toMatch(/res\.json\(\s*await\s+listConversationsByAgent/);
    const chamadas = fonte.match(/apresentarConversas\(/g) || [];
    expect(chamadas.length).toBe(2);
  });
});
