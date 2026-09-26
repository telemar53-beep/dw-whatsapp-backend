import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from '../components/ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { usePlaces } from '../hooks/useCities';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// Guarda do painel do SGP sob demanda (fatia 3 do novo atendimento).
//
// A conversa comum não pode pagar o custo do SGP: o painel (e a biblioteca de
// QR que ele usa) fica fora do trecho da conversa, que a mesa, a Supervisão e
// os Encerrados baixam. O painel chega quando o atendente clica em "Consultar
// SGP"; a biblioteca de QR, só quando a prévia do QR é pedida.
//
// Duas provas, como em mesaSobDemanda.test.jsx:
//  1. LEITURA: nenhum import estático do painel na conversa, nem de `qrcode`
//     em lugar nenhum; o encaixe e o CSS do painel não dependem do dashboard.css.
//  2. EFEITO: abrir uma conversa não avalia o módulo do painel nem o de QR.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ler = (relativo) => readFileSync(join(RAIZ, relativo), 'utf8');
function importsEstaticos(fonte) {
  const limpa = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...limpa.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
const importsDinamicos = (fonte) => [...fonte.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
function arquivosDeCodigo(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeCodigo(caminho);
    return /\.(js|jsx)$/.test(nome) && !/\.test\./.test(nome) ? [caminho] : [];
  });
}

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/SgpLookupPanel', async (original) => {
  avaliados.add('painel');
  return original();
});
vi.mock('qrcode', () => {
  avaliados.add('qrcode');
  return { default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } };
});
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSgpLookup');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');

const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactSgpDocument: '00011122233' };

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
  useReasons.mockReturnValue({ reasons: [], loading: false, refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  useSgpLookup.mockReturnValue({
    client: { id: 1, name: 'Cliente Exemplo', document: '000.111.222-33' },
    contracts: [{ id: 5, status: 'Ativo' }],
    loading: false,
    error: null,
    search: vi.fn(),
    fetchDuplicate: vi.fn(),
    duplicateState: { 5: { loading: false, error: null, hasOpenInvoice: true, duplicates: [{ id: '1', dueDate: '2026-10-01', value: 10, pixCode: 'PIX-1' }] } },
  });
});

describe('painel do SGP sob demanda', () => {
  test('a conversa não importa o painel de forma estática, só sob demanda', () => {
    const fonte = ler('components/ConversationView.jsx');
    expect(importsEstaticos(fonte)).not.toContain('./SgpLookupPanel');
    expect(importsDinamicos(fonte)).toContain('./SgpLookupPanel');
  });

  test('nenhum arquivo importa `qrcode` de forma estática; o painel o carrega na prévia', () => {
    arquivosDeCodigo(RAIZ).forEach((arquivo) => {
      expect(importsEstaticos(readFileSync(arquivo, 'utf8')), relative(RAIZ, arquivo)).not.toContain('qrcode');
    });
    expect(importsDinamicos(ler('components/SgpLookupPanel.jsx'))).toContain('qrcode');
  });

  test('o encaixe do painel mora com a conversa e o estilo com o painel, fora do dashboard.css', () => {
    // A regra-base do encaixe saiu do dashboard.css (que só a mesa carrega).
    expect(ler('pages/dashboard.css')).not.toMatch(/\.conv-raiz\s*>\s*\.conv-painel-slot|\.conv-raiz\.is-painel-alternado/);
    expect(ler('components/conversa-painel.css')).toMatch(/\.conv-raiz > \.conv-painel-slot/);
    expect(ler('components/conversa-painel.css')).toMatch(/\.conv-raiz\.is-painel-alternado > div:first-child/);
    expect(importsEstaticos(ler('components/ConversationView.jsx'))).toContain('./conversa-painel.css');
    expect(importsEstaticos(ler('components/SgpLookupPanel.jsx'))).toContain('./sgp-painel.css');
  });

  // Os dois testes abaixo dependem da ordem: o módulo é avaliado uma vez só.
  test('abrir uma conversa não avalia o painel do SGP nem a biblioteca de QR', async () => {
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(api.getPublicCompany).toHaveBeenCalled());
    expect(avaliados.has('painel')).toBe(false);
    expect(avaliados.has('qrcode')).toBe(false);
  });

  test('o clique traz o painel; a biblioteca de QR chega só com a prévia', async () => {
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Consultar SGP'));
    await screen.findByRole('region', { name: 'Consulta SGP' });
    expect(avaliados.has('painel')).toBe(true);
    expect(avaliados.has('qrcode')).toBe(false);

    await userEvent.click(await screen.findByRole('button', { name: 'QR Pix' }));
    expect(await screen.findByAltText('QR code do Pix')).toBeInTheDocument();
    expect(avaliados.has('qrcode')).toBe(true);
  });
});
