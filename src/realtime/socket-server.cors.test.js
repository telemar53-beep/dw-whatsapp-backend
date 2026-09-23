// Arquivo separado do socket-server.test.js de propósito: aquele sobe um
// servidor de verdade e precisa do socket.io real. Aqui o socket.io é mockado,
// que é a única forma de LER o que foi passado ao construtor.
jest.mock('socket.io', () => ({ Server: jest.fn(() => ({ use: jest.fn(), on: jest.fn() })) }));
jest.mock('../config/cors-origins');
jest.mock('../agents/agent.repository');

const { Server } = require('socket.io');
const { getAllowedOrigins } = require('../config/cors-origins');
const { initSocketServer } = require('./socket-server');

beforeEach(() => jest.clearAllMocks());

describe('CORS do socket', () => {
  // O CORS do socket e o do HTTP precisam sair da MESMA fonte: uma origem que
  // vale para o fetch e não para o socket derruba o tempo real sem derrubar o
  // resto — e é o tipo de coisa que só aparece com a aba aberta em produção.
  //
  // Conferir por leitura do código ("ele chama getAllowedOrigins") não prova
  // nada: prova é o valor que chegou ao construtor.
  test('o socket recebe exatamente a lista de getAllowedOrigins', () => {
    const lista = ['http://localhost:5173', 'https://antigo.exemplo.com.br', 'https://novo.exemplo.com.br'];
    getAllowedOrigins.mockReturnValue(lista);

    initSocketServer({});

    expect(getAllowedOrigins).toHaveBeenCalled();
    expect(Server).toHaveBeenCalledWith({}, { cors: { origin: lista } });
  });

  // Mutação: se alguém trocar a fonte do socket por uma lista própria, a
  // asserção acima passaria a comparar contra um valor que não muda junto.
  test('mudar a lista muda o que o socket recebe', () => {
    getAllowedOrigins.mockReturnValue(['https://so-uma.exemplo.com.br']);

    initSocketServer({});

    expect(Server).toHaveBeenCalledWith({}, { cors: { origin: ['https://so-uma.exemplo.com.br'] } });
  });
});
