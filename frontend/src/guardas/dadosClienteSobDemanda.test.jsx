import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from '../components/ConversationView';
import { VARIANTE_DA_MESA } from '../components/ConversaDaMesa';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { usePlaces } from '../hooks/useCities';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// Guarda dos modais de "Editar cliente" e "Atendimentos anteriores" sob demanda.
//
// Os dois abrem pouco — e, fechados, eram código no trecho da conversa, que a
// mesa, a Supervisão e os Encerrados baixam. Agora cada um chega quando a ação
// dele é pedida, e só ele: abrir um não traz o outro.
//
// Duas provas, como em sgpSobDemanda.test.jsx:
//  1. LEITURA: nenhum import estático dos modais na conversa; os dinâmicos, sim.
//  2. EFEITO: abrir a conversa e o painel não avalia nenhum dos dois módulos;
//     cada ação avalia só o seu.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ler = (relativo) => readFileSync(join(RAIZ, relativo), 'utf8');
function importsEstaticos(fonte) {
  const limpa = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...limpa.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
const importsDinamicos = (fonte) => [...fonte.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/EditContactModal', async (original) => {
  avaliados.add('editar');
  return original();
});
vi.mock('../components/ConversationHistoryModal', async (original) => {
  avaliados.add('historico');
  return original();
});
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');

const MINHA = { id: 'c1', contactId: 'contato-1', contactDisplayName: 'Cliente Exemplo', status: 'assigned', assignedAgentId: 'agent-1' };
const mesa = () => render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} onBack={vi.fn()} workspace variante={VARIANTE_DA_MESA} />);

beforeEach(() => {
  avaliados.clear();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
  useReasons.mockReturnValue({ reasons: [], loading: false, refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.getConversationHistory.mockResolvedValue([]);
});

describe('Editar cliente e Atendimentos anteriores sob demanda', () => {
  test('a conversa não importa os dois modais de forma estática, só sob demanda', () => {
    const fonte = ler('components/ConversationView.jsx');
    expect(importsEstaticos(fonte)).not.toEqual(expect.arrayContaining(['./EditContactModal']));
    expect(importsEstaticos(fonte)).not.toEqual(expect.arrayContaining(['./ConversationHistoryModal']));
    expect(importsDinamicos(fonte)).toEqual(expect.arrayContaining(['./EditContactModal', './ConversationHistoryModal']));
  });

  // vi.mock avalia o módulo uma vez só por arquivo: os testes abaixo dependem
  // da ordem (nada → Editar). A ordem inversa (Histórico primeiro) está em
  // historicoSobDemanda.test.jsx.
  test('abrir a conversa e o painel "Dados do cliente" não traz nenhum dos dois', async () => {
    mesa();
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' })).toBeInTheDocument();
    await waitFor(() => expect(api.getPublicCompany).toHaveBeenCalled());
    expect(avaliados.has('editar')).toBe(false);
    expect(avaliados.has('historico')).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('abrir "Editar cliente" traz só o modal de edição', async () => {
    mesa();
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar cliente' }));
    expect(await screen.findByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(avaliados.has('editar')).toBe(true);
    expect(avaliados.has('historico')).toBe(false);
  });
});
