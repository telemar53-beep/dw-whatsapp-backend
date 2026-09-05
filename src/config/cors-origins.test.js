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
});
