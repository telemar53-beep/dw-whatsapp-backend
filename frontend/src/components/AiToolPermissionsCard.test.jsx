import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AiToolPermissionsCard from './AiToolPermissionsCard';

vi.mock('../services/api');
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

import { listAiTools, setAiToolEnabled } from '../services/api';

describe('AiToolPermissionsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAiTools.mockResolvedValue([
      { nome: 'consultar_plano', categoria: 'CONSULTA', descricao: 'd', enabled: true },
      { nome: 'gerar_pix', categoria: 'ACAO_SENSIVEL', descricao: 'd', enabled: false },
    ]);
  });

  test('groups the tools by category', async () => {
    render(<AiToolPermissionsCard />);
    expect(await screen.findByText('Consulta')).toBeInTheDocument();
    expect(screen.getByText('Ação sensível')).toBeInTheDocument();
  });

  test('toggling a tool saves it', async () => {
    setAiToolEnabled.mockResolvedValue({ toolName: 'gerar_pix', enabled: true });
    render(<AiToolPermissionsCard />);
    const toggle = await screen.findByRole('checkbox', { name: /gerar_pix/i });
    await userEvent.click(toggle);
    expect(setAiToolEnabled).toHaveBeenCalledWith('gerar_pix', true, 't');
  });
});
