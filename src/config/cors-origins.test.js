jest.mock('./env');
const { loadConfig } = require('./env');
const { getAllowedOrigins } = require('./cors-origins');

describe('getAllowedOrigins', () => {
  test('always includes the local Vite dev server origin', () => {
    loadConfig.mockReturnValue({ frontendOrigin: null });
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173']);
  });

  test('also includes FRONTEND_ORIGIN when configured', () => {
    loadConfig.mockReturnValue({ frontendOrigin: 'https://dw-whatsapp-frontend.onrender.com' });
    expect(getAllowedOrigins()).toEqual([
      'http://localhost:5173',
      'https://dw-whatsapp-frontend.onrender.com',
    ]);
  });

  // A lista existe para a troca de domínio poder ter os dois valendo ao mesmo
  // tempo, sem janela em que o antigo para antes de o novo subir.
  test('aceita várias origens separadas por vírgula', () => {
    loadConfig.mockReturnValue({
      frontendOrigin: 'https://dw-whatsapp-frontend.onrender.com,https://chat.exemplo.com.br',
    });
    expect(getAllowedOrigins()).toEqual([
      'http://localhost:5173',
      'https://dw-whatsapp-frontend.onrender.com',
      'https://chat.exemplo.com.br',
    ]);
  });

  // Espaço em volta é o que sai de qualquer campo de painel preenchido à mão.
  test('apara espaços em volta de cada origem', () => {
    loadConfig.mockReturnValue({ frontendOrigin: '  https://a.exemplo.com.br ,   https://b.exemplo.com.br  ' });
    expect(getAllowedOrigins()).toEqual([
      'http://localhost:5173',
      'https://a.exemplo.com.br',
      'https://b.exemplo.com.br',
    ]);
  });

  // Vírgula sobrando viraria origem vazia — que o cors trataria como origem
  // inválida em vez de ignorar.
  test('descarta vazios de vírgula sobrando', () => {
    loadConfig.mockReturnValue({ frontendOrigin: 'https://a.exemplo.com.br,,https://b.exemplo.com.br,' });
    expect(getAllowedOrigins()).toEqual([
      'http://localhost:5173',
      'https://a.exemplo.com.br',
      'https://b.exemplo.com.br',
    ]);
  });

  test('uma lista só de vírgulas e espaços não acrescenta nada', () => {
    loadConfig.mockReturnValue({ frontendOrigin: ' , , ' });
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173']);
  });

  test('origem repetida entra uma vez só', () => {
    loadConfig.mockReturnValue({
      frontendOrigin: 'https://a.exemplo.com.br, https://a.exemplo.com.br, http://localhost:5173',
    });
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173', 'https://a.exemplo.com.br']);
  });

  test('variável ausente (undefined) continua só com a origem local', () => {
    loadConfig.mockReturnValue({});
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173']);
  });
});
