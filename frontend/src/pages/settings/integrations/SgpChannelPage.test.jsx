import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import SgpChannelPage from './SgpChannelPage';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useChannels } from '../../../hooks/useChannels';
import { useTemplates } from '../../../hooks/useTemplates';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../hooks/useSgpIntegrations');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTemplates');
vi.mock('../../../hooks/useSgpQueryConfig');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', name: 'Berg' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud', name: 'Oficial' };
const DIALOG360_CHANNEL = { id: 'channel-3', type: '360dialog', name: '360 Oficial' };
const APPROVED_TEMPLATE = { id: 'tpl-1', name: 'aviso_cobranca', status: 'APPROVED' };

const PATH = '/configuracoes/integracoes/sgp-canal';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
  useChannels.mockReturnValue({ channels: [BAILEYS_CHANNEL, META_CHANNEL] });
  useTemplates.mockReturnValue({ templates: [APPROVED_TEMPLATE] });
  useSgpQueryConfig.mockReturnValue({ config: { configured: false }, status: 'ready', refresh: vi.fn() });
});

function integracao(campos = {}) {
  return { id: 'int-1', description: 'Avisos Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true, ...campos };
}

function comIntegracao(campos) {
  const refresh = vi.fn();
  useSgpIntegrations.mockReturnValue({ integrations: [integracao(campos)], status: 'ready', refresh });
  return refresh;
}

// O jsdom não tem PointerEvent: o clique no fundo é descer e soltar no mesmo ponto.
function ponteiro(alvo, tipo, x, y) {
  fireEvent(alvo, new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}

describe('SgpChannelPage', () => {
  test('lists existing integrations with their channel name and mode label', () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys principal', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<SgpChannelPage />, { path: PATH });
    expect(screen.getByText('Baileys principal')).toBeInTheDocument();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/Texto livre/)).toBeInTheDocument();
  });

  test('does not show the create-integration form until its button is clicked', () => {
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<SgpChannelPage />, { path: PATH });

    expect(screen.queryByLabelText(/^canal$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nova integração sgp/i })).toBeInTheDocument();
  });

  test('the template selector only appears after choosing a meta_cloud channel', async () => {
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<SgpChannelPage />, { path: PATH });
    await userEvent.click(screen.getByRole('button', { name: /nova integração sgp/i }));

    expect(screen.queryByLabelText(/template padrão/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-2');

    expect(screen.getByLabelText(/template padrão/i)).toBeInTheDocument();
  });

  test('offers a 360dialog channel as eligible and switches the form to template mode when selected', async () => {
    useChannels.mockReturnValue({ channels: [BAILEYS_CHANNEL, DIALOG360_CHANNEL] });
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<SgpChannelPage />, { path: PATH });
    await userEvent.click(screen.getByRole('button', { name: /nova integração sgp/i }));

    expect(screen.getByRole('option', { name: '360 Oficial' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/template padrão/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-3');

    expect(screen.getByLabelText(/template padrão/i)).toBeInTheDocument();
  });

  test('creates a new freetext integration for a baileys channel', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh });
    api.createSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false });
    renderInShell(<SgpChannelPage />, { path: PATH });
    await userEvent.click(screen.getByRole('button', { name: /nova integração sgp/i }));

    await userEvent.type(screen.getByLabelText(/descrição/i), 'Baileys');
    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() =>
      expect(api.createSgpIntegration).toHaveBeenCalledWith({ description: 'Baileys', channelId: 'channel-1', defaultTemplateId: null, enabled: true }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('creates a new template integration for a meta_cloud channel with a chosen default template', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh });
    api.createSgpIntegration.mockResolvedValue({ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: false });
    renderInShell(<SgpChannelPage />, { path: PATH });
    await userEvent.click(screen.getByRole('button', { name: /nova integração sgp/i }));

    await userEvent.type(screen.getByLabelText(/descrição/i), 'Oficial');
    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-2');
    await userEvent.selectOptions(screen.getByLabelText(/template padrão/i), 'tpl-1');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() =>
      expect(api.createSgpIntegration).toHaveBeenCalledWith({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: true }, 'tok-123')
    );
  });

  test('toggling Ativo on a card calls updateSgpIntegration with that card current values', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      status: 'ready',
      refresh,
    });
    api.updateSgpIntegration.mockResolvedValue({});
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByLabelText('Ativo: Baileys'));

    await waitFor(() =>
      expect(api.updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Baileys', channelId: 'channel-1', defaultTemplateId: null, enabled: false }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('clicking Editar reveals the edit fields prefilled with the card current values', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<SgpChannelPage />, { path: PATH });

    expect(screen.queryByRole('form', { name: /editar integração/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    expect(editForm.getByLabelText(/descrição/i)).toHaveValue('Oficial');
    expect(editForm.getByLabelText(/^canal$/i)).toHaveValue('channel-2');
    expect(editForm.getByLabelText(/template padrão/i)).toHaveValue('tpl-1');
  });

  test('saving the edit form sends the edited values and preserves the card Ativo state', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: false, hasApiKey: true }],
      status: 'ready',
      refresh,
    });
    api.updateSgpIntegration.mockResolvedValue({});
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    await userEvent.clear(editForm.getByLabelText(/descrição/i));
    await userEvent.type(editForm.getByLabelText(/descrição/i), 'SGP Baileys renomeado');
    await userEvent.selectOptions(editForm.getByLabelText(/^canal$/i), 'channel-2');
    await userEvent.selectOptions(editForm.getByLabelText(/template padrão/i), 'tpl-1');
    await userEvent.click(editForm.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateSgpIntegration).toHaveBeenCalledWith(
        'int-1',
        { description: 'SGP Baileys renomeado', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: false },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('form', { name: /editar integração/i })).not.toBeInTheDocument());
  });

  test('the edit form template selector follows the edit form own channel selection', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    expect(editForm.queryByLabelText(/template padrão/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(editForm.getByLabelText(/^canal$/i), 'channel-2');

    expect(editForm.getByLabelText(/template padrão/i)).toBeInTheDocument();
  });

  test('cancelling the edit form closes it without calling the API', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    await userEvent.type(editForm.getByLabelText(/descrição/i), ' rascunho');
    await userEvent.click(editForm.getByRole('button', { name: /cancelar/i }));

    expect(api.updateSgpIntegration).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: /editar integração/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    expect(within(screen.getByRole('form', { name: /editar integração/i })).getByLabelText(/descrição/i)).toHaveValue('Baileys');
  });

  // Fatia S0 (29/09): gerar a chave invalida a atual e para os envios do SGP
  // até ela ser cadastrada. Pede confirmação, e a chave nova só sai da tela
  // por uma ação explícita.
  test('gerar nova chave pede confirmação que identifica a integração e o canal e diz o que para', async () => {
    comIntegracao();
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));

    const dialogo = screen.getByRole('alertdialog', { name: 'Gerar nova chave de API?' });
    expect(dialogo).toHaveTextContent('Avisos Baileys');
    expect(dialogo).toHaveTextContent('Berg');
    expect(dialogo).toHaveTextContent(/deixa de funcionar/i);
    expect(dialogo).toHaveTextContent(/param até/i);
    expect(api.rotateSgpIntegrationKey).not.toHaveBeenCalled();
  });

  test('sem chave anterior, a confirmação não fala em invalidar a chave atual', async () => {
    comIntegracao({ hasApiKey: false });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));

    const dialogo = screen.getByRole('alertdialog', { name: 'Gerar nova chave de API?' });
    expect(dialogo).not.toHaveTextContent(/deixa de funcionar/i);
    expect(dialogo).toHaveTextContent(/uma única vez/i);
  });

  test('Cancelar e Escape não geram chave', async () => {
    comIntegracao();
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.rotateSgpIntegrationKey).not.toHaveBeenCalled();
  });

  test('gerando: um pedido só, "Gerando chave…" e Escape não fecha', async () => {
    comIntegracao();
    api.rotateSgpIntegrationKey.mockReturnValue(new Promise(() => {}));
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    const confirmar = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova chave' });
    await userEvent.click(confirmar);
    await userEvent.click(confirmar);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(api.rotateSgpIntegrationKey).toHaveBeenCalledTimes(1);
    expect(api.rotateSgpIntegrationKey).toHaveBeenCalledWith('int-1', 'tok-123');
    expect(confirmar).toHaveTextContent('Gerando chave…');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  test('confirmar mostra a chave uma vez, num diálogo que não fecha por Escape nem clique fora', async () => {
    const refresh = comIntegracao();
    api.rotateSgpIntegrationKey.mockResolvedValue({ apiKey: 'plain-key-abc' });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova chave' }));

    const campo = await screen.findByDisplayValue('plain-key-abc');
    const dialogo = screen.getByRole('alertdialog', { name: 'Nova chave gerada' });
    expect(dialogo).toHaveTextContent(/uma única vez/i);
    expect(refresh).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    ponteiro(dialogo.parentElement, 'pointerdown', 10, 10);
    ponteiro(dialogo.parentElement, 'pointerup', 11, 11);
    expect(campo).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Já guardei a chave' }));
    expect(screen.queryByDisplayValue('plain-key-abc')).not.toBeInTheDocument();
  });

  test('a chave nova continua na tela mesmo se a releitura das integrações falhar', async () => {
    const lista = [integracao()];
    const refresh = vi.fn(() => {
      useSgpIntegrations.mockReturnValue({ integrations: lista, status: 'error', error: 'Não foi possível carregar.', refresh });
    });
    useSgpIntegrations.mockReturnValue({ integrations: lista, status: 'ready', refresh });
    api.rotateSgpIntegrationKey.mockResolvedValue({ apiKey: 'plain-key-abc' });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova chave' }));

    expect(await screen.findByDisplayValue('plain-key-abc')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText('Uma chave já foi gerada.')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('plain-key-abc')).toBeInTheDocument();
  });

  test('erro ao gerar aparece no diálogo, o cartão continua como estava e dá para tentar de novo', async () => {
    const refresh = comIntegracao();
    api.rotateSgpIntegrationKey
      .mockRejectedValueOnce(Object.assign(new Error('falhou'), { status: 500 }))
      .mockResolvedValueOnce({ apiKey: 'plain-key-abc' });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    const dialogo = screen.getByRole('alertdialog');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Gerar nova chave' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/.+/);
    expect(screen.getByText('Uma chave já foi gerada.')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Gerar nova chave' }));
    expect(await screen.findByDisplayValue('plain-key-abc')).toBeInTheDocument();
    expect(api.rotateSgpIntegrationKey).toHaveBeenCalledTimes(2);
  });

  test('copiar a chave: sucesso avisa; falha diz o que fazer e a chave fica', async () => {
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('negado'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    comIntegracao();
    api.rotateSgpIntegrationKey.mockResolvedValue({ apiKey: 'plain-key-abc' });
    renderInShell(<SgpChannelPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova chave' }));
    await screen.findByDisplayValue('plain-key-abc');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar chave' })); });
    expect(writeText).toHaveBeenCalledWith('plain-key-abc');
    expect(screen.getByRole('status')).toHaveTextContent('Chave copiada.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar chave' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível copiar/i);
    expect(screen.getByDisplayValue('plain-key-abc')).toBeInTheDocument();
  });

  test('avisa quando a Consulta ao SGP está desativada', () => {
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh: vi.fn() });
    useSgpQueryConfig.mockReturnValue({ config: { configured: true, enabled: false }, status: 'ready', refresh: vi.fn() });
    renderInShell(<SgpChannelPage />, { path: PATH });
    expect(screen.getByText(/consulta ao sgp está desativada/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /consulta ao sgp/i })).toHaveAttribute('href', '/configuracoes/integracoes/sgp/consultas');
  });

  test('gerente sem a flag vê acesso negado', () => {
    useSgpIntegrations.mockReturnValue({ integrations: [], status: 'ready', refresh: vi.fn() });
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    renderInShell(<SgpChannelPage />, { path: PATH });
    expect(screen.getByRole('heading', { name: /sem acesso a sgp por canal/i })).toBeInTheDocument();
  });
});
