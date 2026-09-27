import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditContactModal from './EditContactModal';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// O CSS da variante, lido como texto (o ?raw de CSS chega vazio no Vitest).
const cssDaVariante = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'editar-cliente.css'), 'utf8');
import { useAuth } from '../contexts/AuthContext';
import { usePlaces } from '../hooks/useCities';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCities');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  // O modal passou a usar usePlaces: precisa da hierarquia para encadear
  // município e localidade. Os municípios de sempre continuam aqui.
  usePlaces.mockReturnValue({
    places: [
      { id: 'city-1', name: 'Bahia', kind: 'city', parentId: null },
      { id: 'city-2', name: 'São Luís', kind: 'city', parentId: null },
    ],
    status: 'ready',
    refresh: vi.fn(),
  });
});

const CONVERSATION = {
  id: 'conv-1',
  contactId: 'contact-1',
  contactDisplayName: 'Carlos',
  contactPhoneNumber: '+5511999990000',
  contactCityId: 'city-1',
};

describe('EditContactModal', () => {
  test('pre-fills the current name and city', () => {
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Carlos');
    expect(screen.getByLabelText('Município')).toHaveValue('city-1');
  });

  test('pre-fills with no city selected when the contact has none', () => {
    render(
      <EditContactModal conversation={{ ...CONVERSATION, contactCityId: null }} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.getByLabelText('Município')).toHaveValue('');
  });

  test('pre-fills the internal note when the contact has one', () => {
    render(
      <EditContactModal
        conversation={{ ...CONVERSATION, contactInternalNote: 'Já reclamou 3x' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/nota interna/i)).toHaveValue('Já reclamou 3x');
  });

  test('pre-fills an empty internal note when the contact has none', () => {
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/nota interna/i)).toHaveValue('');
  });

  test('saving calls the API with the edited values, resolves the city name, then closes', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: 'city-2', internalNote: 'Cliente VIP' });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={onSaved} />);

    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.selectOptions(screen.getByLabelText('Município'), 'city-2');
    await userEvent.type(screen.getByLabelText(/nota interna/i), 'Cliente VIP');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateContact).toHaveBeenCalledWith(
        'contact-1',
        { displayName: 'Carlos Editado', cityId: 'city-2', internalNote: 'Cliente VIP' },
        'tok-123'
      )
    );
    expect(onSaved).toHaveBeenCalledWith({
      displayName: 'Carlos Editado',
      cityId: 'city-2',
      cityName: 'São Luís',
      localityId: undefined,
      localityName: null,
      internalNote: 'Cliente VIP',
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('shows an error message and keeps the modal open when saving fails', async () => {
    api.updateContact.mockRejectedValue({ body: { error: 'Falha ao salvar' } });
    const onClose = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), ' Silva');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    // Mensagem do servidor sem tradução não vai para a tela: vira a frase segura.
    expect(await screen.findByText('Não foi possível salvar as alterações. Tente novamente.')).toBeInTheDocument();
    expect(screen.queryByText('Falha ao salvar')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicking Cancelar closes the modal without saving', async () => {
    const onClose = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onClose).toHaveBeenCalled();
    expect(api.updateContact).not.toHaveBeenCalled();
  });

  test('em carregamento, o seletor de cidade mostra "Carregando…" e fica desabilitado', () => {
    usePlaces.mockReturnValue({ places: [], status: 'loading', refresh: vi.fn() });
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Município')).toBeDisabled();
    expect(screen.getByLabelText('Localidade')).toBeDisabled();
    expect(screen.queryByText('Nenhum')).not.toBeInTheDocument();
  });
});

describe('EditContactModal — municipio e localidade', () => {
  const LUGARES = [
    { id: 'm1', name: 'Candido Mendes', kind: 'city', parentId: null },
    { id: 'm2', name: 'Carutapera', kind: 'city', parentId: null },
    { id: 'p1', name: 'Barao de Tromai', kind: 'locality', parentId: 'm1' },
    { id: 'l1', name: 'Aurizona', kind: 'unclassified', parentId: null },
  ];

  const CONVERSA = {
    contactId: 'c1', contactDisplayName: 'Ana',
    contactCityId: 'm1', contactLocalityId: null, contactInternalNote: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ token: 'tok-123' });
    usePlaces.mockReturnValue({ places: LUGARES, status: 'ready' });
  });

  test('o seletor de municipio nao oferece povoado, mas oferece o legado', () => {
    render(<EditContactModal conversation={CONVERSA} onClose={vi.fn()} onSaved={vi.fn()} />);

    const municipio = within(screen.getByLabelText('Município'));
    expect(municipio.getByRole('option', { name: 'Candido Mendes' })).toBeInTheDocument();
    expect(municipio.getByRole('option', { name: 'Aurizona' })).toBeInTheDocument();
    expect(municipio.queryByRole('option', { name: 'Barao de Tromai' })).not.toBeInTheDocument();
  });

  test('a localidade so oferece filhas do municipio escolhido', async () => {
    render(<EditContactModal conversation={CONVERSA} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(within(screen.getByLabelText('Localidade')).getByRole('option', { name: 'Barao de Tromai' }))
      .toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');

    expect(within(screen.getByLabelText('Localidade')).queryByRole('option', { name: 'Barao de Tromai' }))
      .not.toBeInTheDocument();
  });

  test('sem municipio, a localidade fica desabilitada', () => {
    render(
      <EditContactModal
        conversation={{ ...CONVERSA, contactCityId: null }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Localidade')).toBeDisabled();
  });

  test('trocar de municipio limpa a localidade escolhida', async () => {
    api.updateContact.mockResolvedValue({
      displayName: 'Ana', cityId: 'm2', localityId: null, internalNote: null,
    });
    render(
      <EditContactModal
        conversation={{ ...CONVERSA, contactLocalityId: 'p1' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(api.updateContact).toHaveBeenCalledWith(
      'c1',
      { cityId: 'm2', localityId: null },
      'tok-123'
    ));
  });

  test('salva municipio e localidade juntos e devolve os dois nomes', async () => {
    api.updateContact.mockResolvedValue({
      displayName: 'Ana', cityId: 'm1', localityId: 'p1', internalNote: null,
    });
    const onSaved = vi.fn();
    render(<EditContactModal conversation={CONVERSA} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.selectOptions(screen.getByLabelText('Localidade'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      cityId: 'm1', cityName: 'Candido Mendes',
      localityId: 'p1', localityName: 'Barao de Tromai',
    })));
  });
});

// O modal pode fechar com o salvamento no caminho ("Cancelar", Esc ou a troca
// de conversa). A resposta que chega depois continua valendo para o contato de
// onde saiu — por isso o onSaved —, mas não fecha de novo: o onClose fecharia a
// edição que estiver aberta agora, talvez a de outro cliente.
describe('EditContactModal — resposta depois de fechar', () => {
  test('entrega o valor salvo, mas não chama onClose de novo', async () => {
    let responder;
    api.updateContact.mockReturnValue(new Promise((resolve) => { responder = resolve; }));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const { unmount } = render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText(/nome/i), ' Silva');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(api.updateContact).toHaveBeenCalled());
    unmount();
    await act(async () => {
      responder({ id: 'contact-1', displayName: 'Carlos', cityId: 'city-1', localityId: null, internalNote: null });
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// A conversa da lista pode estar desatualizada (outra edição, outra aba). Só vai
// ao servidor o que mudou em relação ao que o modal recebeu ao abrir: reenviar
// um campo intocado — a nota, sobretudo — devolvia ao servidor um valor que
// outra edição já tinha trocado. A rota aplica só as chaves que chegam.
describe('EditContactModal — só vai ao servidor o que mudou', () => {
  // Os quatro campos preenchidos: qualquer um reenviado sem mudar aparece no payload.
  const COMPLETO = {
    id: 'conv-1',
    contactId: 'contact-1',
    contactDisplayName: 'Carlos',
    contactCityId: 'city-1',
    contactLocalityId: 'loc-1',
    contactInternalNote: 'Nota atual',
  };

  beforeEach(() => {
    usePlaces.mockReturnValue({
      places: [
        { id: 'city-1', name: 'Bahia', kind: 'city', parentId: null },
        { id: 'city-2', name: 'São Luís', kind: 'city', parentId: null },
        { id: 'loc-1', name: 'Localidade Um', kind: 'locality', parentId: 'city-1' },
        { id: 'loc-2', name: 'Localidade Dois', kind: 'locality', parentId: 'city-2' },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    api.updateContact.mockReset();
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos', cityId: 'city-1', localityId: 'loc-1', internalNote: 'Nota atual' });
  });

  const abrir = (props = {}) => render(<EditContactModal conversation={COMPLETO} onClose={vi.fn()} onSaved={vi.fn()} {...props} />);
  const salvar = () => userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  async function escrever(rotulo, texto) {
    const campo = screen.getByLabelText(rotulo);
    await userEvent.clear(campo);
    if (texto) await userEvent.type(campo, texto);
  }
  const enviado = () => api.updateContact.mock.calls[0][1];

  test('editar só o nome envia só o nome', async () => {
    abrir();
    await escrever('Nome', 'Carlos Editado');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ displayName: 'Carlos Editado' });
  });

  test('editar só a localização envia município e localidade, e não a nota', async () => {
    abrir();
    await userEvent.selectOptions(screen.getByLabelText('Município'), 'city-2');
    await userEvent.selectOptions(screen.getByLabelText('Localidade'), 'loc-2');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ cityId: 'city-2', localityId: 'loc-2' });
  });

  test('editar a nota envia só a nota', async () => {
    abrir();
    await escrever('Nota interna', 'Nota nova');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ internalNote: 'Nota nova' });
  });

  test('limpar a nota de propósito envia a limpeza', async () => {
    abrir();
    await escrever('Nota interna', '');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ internalNote: null });
  });

  test('limpar o município de propósito envia município e localidade vazios', async () => {
    abrir();
    await userEvent.selectOptions(screen.getByLabelText('Município'), '');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ cityId: null, localityId: null });
  });

  test('sem nada alterado — nem depois de mexer e desfazer —, salvar fecha sem PATCH', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    abrir({ onClose, onSaved });
    await escrever('Nome', 'Outro nome');
    await escrever('Nome', 'Carlos');
    await salvar();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.updateContact).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

// Redesenho aprovado (mockup de 26/09): claro, em três seções, com "Salvando…",
// erros sempre em português e a carga dos municípios com "Tentar novamente".
describe('EditContactModal — redesenho', () => {
  const LUGARES = [
    { id: 'm1', name: 'Município Um', kind: 'city', parentId: null },
    { id: 'm2', name: 'Município Dois', kind: 'city', parentId: null },
    { id: 'l1', name: 'Localidade Um', kind: 'locality', parentId: 'm1' },
  ];
  const CONTATO = { id: 'conv-1', contactId: 'contact-1', contactDisplayName: 'Cliente Exemplo', contactCityId: 'm1', contactLocalityId: '', contactInternalNote: 'Nota atual' };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ token: 'tok-123' });
    usePlaces.mockReturnValue({ places: LUGARES, status: 'ready', refresh: vi.fn() });
    api.updateContact.mockReset();
  });

  const abrir = (props = {}) => render(<EditContactModal conversation={CONTATO} onClose={vi.fn()} onSaved={vi.fn()} {...props} />);
  const dialogo = () => screen.getByRole('dialog', { name: 'Editar cliente' });
  async function mudarNome(texto = ' (editado)') {
    await userEvent.type(screen.getByLabelText('Nome'), texto);
  }

  test('estrutura: título, apoio, as três seções e o rodapé', () => {
    abrir();
    const d = dialogo();
    expect(d).toHaveAttribute('data-dialog', 'contact-edit');
    expect(d).toHaveAccessibleDescription('Atualize as informações usadas no atendimento');
    expect(within(d).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Identificação', 'Localização', 'Nota interna']);
    expect(within(d).getByLabelText('Nota interna')).toHaveAccessibleDescription('Visível apenas para a equipe');
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument();
    // O foco abre no primeiro campo, o Nome.
    expect(screen.getByLabelText('Nome')).toHaveFocus();
  });

  test('salvando: "Salvando…", nada abandona o modal e não sai um segundo envio', async () => {
    let responder;
    api.updateContact.mockReturnValue(new Promise((resolve) => { responder = resolve; }));
    const onClose = vi.fn();
    abrir({ onClose });
    await mudarNome();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    const salvando = screen.getByRole('button', { name: 'Salvando…' });
    // Indisponível sem `disabled`: o botão focado que vira `disabled` joga o
    // foco no <body>, e o Tab escapa para a página atrás do modal.
    expect(salvando).toHaveAttribute('aria-disabled', 'true');
    expect(salvando).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
    // Clique de novo, Enter no formulário e Esc: nenhum faz efeito.
    await userEvent.click(salvando);
    fireEvent.submit(salvando.closest('form'));
    fireEvent.submit(salvando.closest('form'));
    await userEvent.keyboard('{Escape}');
    expect(api.updateContact).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => responder({ id: 'contact-1', displayName: 'Cliente Exemplo (editado)', cityId: 'm1', localityId: null, internalNote: 'Nota atual' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('erro de validação conhecido chega traduzido, e o que foi digitado fica', async () => {
    api.updateContact.mockRejectedValue({ status: 400, body: { error: 'locality does not belong to city' } });
    abrir();
    await mudarNome();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A localidade escolhida não pertence a este município. Escolha outra ou deixe em branco.');
    expect(screen.queryByText(/locality does not belong/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('Cliente Exemplo (editado)');
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
  });

  test.each([
    ['erro sem tradução do servidor', { status: 500, body: { error: 'Unexpected database hiccup' } }, /database hiccup/],
    ['falha de rede', new TypeError('Failed to fetch'), /Failed to fetch/],
  ])('%s: frase segura em português, nunca o texto técnico', async (_caso, erro, tecnico) => {
    api.updateContact.mockRejectedValue(erro);
    abrir();
    await mudarNome();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar as alterações. Tente novamente.');
    expect(screen.queryByText(tecnico)).not.toBeInTheDocument();
  });

  test('falha ao carregar os municípios: aviso visível e "Tentar novamente" pede de novo', async () => {
    const refresh = vi.fn();
    usePlaces.mockReturnValue({ places: [], status: 'error', refresh });
    abrir();
    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('Não foi possível carregar os municípios.');
    // O contato TEM município e localidade: "Nenhum" diria que o cadastro está
    // vazio. Os seletores dizem que o dado não está disponível.
    const opcoes = (rotulo) => within(screen.getByLabelText(rotulo)).getAllByRole('option').map((o) => o.textContent);
    expect(screen.getByLabelText('Município')).toBeDisabled();
    expect(opcoes('Município')).toEqual(['Indisponível']);
    expect(opcoes('Localidade')).toEqual(['Indisponível']);
    await userEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('municípios carregando: aviso no próprio seletor, sem inventar opção', () => {
    usePlaces.mockReturnValue({ places: [], status: 'loading', refresh: vi.fn() });
    abrir();
    const municipio = screen.getByLabelText('Município');
    expect(municipio).toBeDisabled();
    expect(within(municipio).getAllByRole('option').map((o) => o.textContent)).toEqual(['Carregando municípios…']);
    expect(within(screen.getByLabelText('Localidade')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Carregando…']);
  });

  test('sem município, a localidade orienta a escolher um', () => {
    abrir({ conversation: { ...CONTATO, contactCityId: '' } });
    const localidade = screen.getByLabelText('Localidade');
    expect(localidade).toBeDisabled();
    expect(localidade).toHaveAccessibleDescription('Escolha um município para ver as localidades.');
  });

  test('município sem localidades: estado vazio claro', async () => {
    abrir();
    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
    const localidade = screen.getByLabelText('Localidade');
    expect(localidade).toBeDisabled();
    expect(within(localidade).getAllByRole('option').map((o) => o.textContent)).toEqual(['Nenhuma localidade cadastrada']);
    expect(localidade).toHaveAccessibleDescription('Este município não tem localidades cadastradas.');
  });
});

// Com a busca de municípios DE VERDADE (só a API simulada): "Tentar novamente"
// refaz a consulta e as opções aparecem.
describe('EditContactModal — tentar de novo refaz a consulta dos municípios', () => {
  let lugaresReais;
  beforeAll(async () => {
    lugaresReais = await vi.importActual('../hooks/useCities');
  });

  test('a segunda consulta traz os municípios', async () => {
    usePlaces.mockImplementation(lugaresReais.usePlaces);
    useAuth.mockReturnValue({ token: 'tok-123' });
    api.listCities.mockReset();
    api.listCities
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce([{ id: 'm1', name: 'Município Um', kind: 'city', parentId: null }]);
    render(<EditContactModal conversation={{ contactId: 'contact-1', contactDisplayName: 'Cliente Exemplo', contactCityId: '' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    const aviso = await screen.findByRole('alert');
    await userEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }));

    expect(await within(screen.getByLabelText('Município')).findByRole('option', { name: 'Município Um' })).toBeInTheDocument();
    expect(api.listCities).toHaveBeenCalledTimes(2);
    // O botão sumiu com o aviso: o foco não cai no <body>, vai ao Município.
    await waitFor(() => expect(screen.getByLabelText('Município')).toHaveFocus());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// O jsdom não calcula layout: a regra mora no CSS da variante, lido aqui. As
// capturas medem o resultado no navegador.
describe('EditContactModal — CSS da variante', () => {
  const css = cssDaVariante.replace(/\/\*[\s\S]*?\*\//g, '');
  function blocoDaMidia(consulta) {
    const inicio = css.indexOf(`@media ${consulta}`);
    if (inicio < 0) return '';
    let nivel = 0;
    for (let i = css.indexOf('{', inicio); i < css.length; i += 1) {
      if (css[i] === '{') nivel += 1;
      if (css[i] === '}') { nivel -= 1; if (nivel === 0) return css.slice(inicio, i + 1); }
    }
    return '';
  }
  const semMidias = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  const regra = (texto, seletor) => {
    const m = texto.match(new RegExp(`([^{}]*${seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{}]*)\\{([^}]*)\\}`));
    return m ? m[2] : '';
  };
  // Regra de um seletor exato (não das regras filhas que começam por ele).
  const regraExata = (texto, seletor) => {
    const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = texto.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : '';
  };
  const px = (corpo, prop) => {
    const m = corpo.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+)px`));
    return m ? Number(m[1]) : 0;
  };

  test('toda regra fica presa à variante contact-edit', () => {
    const seletores = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith('@'));
    expect(seletores.length).toBeGreaterThan(10);
    seletores.forEach((seletor) => {
      // Só as vírgulas de fora de parênteses separam seletores (:is(a, b) é um só).
      seletor.split(/,(?![^()]*\))/).forEach((parte) => expect(parte, parte).toMatch(/contact-edit/));
    });
  });

  // No toque, o :hover gruda depois do toque e o botão fica na cor de "sobre".
  test('hover só onde há ponteiro que paira', () => {
    const foraDoHover = css.replace(blocoDaMidia('(hover: hover)'), '');
    expect(blocoDaMidia('(hover: hover)')).toMatch(/:hover/);
    expect(foraDoHover).not.toMatch(/:hover/);
  });

  // "Salvando…" continua legível: índigo sólido e texto branco com contraste de
  // 4,5:1 ou mais. Opacidade no botão inteiro lavava o texto junto com o fundo
  // (2,5:1).
  test('"Salvando…" sem opacidade e com contraste de 4,5:1 ou mais', () => {
    const tokens = Object.fromEntries([...css.matchAll(/(--ec-[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
    const cor = (valor) => {
      const token = valor.trim().match(/^var\((--ec-[\w-]+)\)$/);
      return (token ? tokens[token[1]] : valor.trim()).toLowerCase();
    };
    // Toda regra que alcança o botão em "Salvando…" (o que está dentro de
    // :not() não conta).
    const doSalvando = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .map(([, sel, corpo]) => [sel.trim(), corpo])
      .filter(([sel]) => sel.replace(/:not\([^()]*\)/g, '').includes("[aria-disabled='true']"));
    doSalvando.forEach(([sel, corpo]) => expect(corpo, sel).not.toMatch(/(?:^|;)\s*opacity\s*:/));

    const principal = doSalvando.find(([sel]) => sel.includes('.is-principal'));
    expect(principal).toBeDefined();
    const fundo = cor(principal[1].match(/background:\s*([^;]+)/)[1]);
    const texto = cor(principal[1].match(/(?:^|;)\s*color:\s*([^;]+)/)[1]);
    expect(contraste(fundo, texto)).toBeGreaterThanOrEqual(4.5);
    // Um pouco menos intenso que o índigo normal, não o mesmo.
    expect(fundo).not.toBe(cor('var(--ec-indigo)'));
  });

  test('claro, sem desfoque no diálogo nem no fundo', () => {
    expect(regraExata(semMidias, "[data-dialog='contact-edit'].dw-dialog")).toMatch(/backdrop-filter:\s*none/);
    expect(regraExata(semMidias, "[data-dialog='contact-edit'].dw-dialog")).toMatch(/background:\s*var\(--ec-papel\)/);
    expect(semMidias).toMatch(/--ec-papel:\s*#ffffff/);
    expect(regra(semMidias, ":has(> [data-dialog='contact-edit'])")).toMatch(/backdrop-filter:\s*none/);
  });

  test('desktop: Município e Localidade na mesma linha', () => {
    expect(regra(semMidias, '.ec-linha')).toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  test('celular: uma coluna, campos de 16 px e alvos de 44 px', () => {
    const celular = blocoDaMidia('(max-width: 600px)');
    expect(celular).not.toBe('');
    expect(regra(celular, '.ec-linha')).toMatch(/grid-template-columns:\s*1fr\s*;/);
    const campo = regra(celular, '.ec-controle');
    expect(px(campo, 'font-size')).toBeGreaterThanOrEqual(16);
    expect(px(campo, 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px(regra(celular, '.ec-botao'), 'min-height')).toBeGreaterThanOrEqual(44);
    const fechar = regraExata(celular, "[data-dialog='contact-edit'].dw-dialog .dw-dialog-close");
    expect(px(fechar, 'width')).toBeGreaterThanOrEqual(44);
    expect(px(fechar, 'height')).toBeGreaterThanOrEqual(44);
  });

  // O overlays.css dá 13 px, padding e raio a todo campo de diálogo com um
  // seletor forte. Classe no DOM não prova nada: se a regra da variante não
  // passar dele em especificidade, o campo do celular volta a 13 px (e o
  // Safari aproxima a tela no foco). O jsdom não resolve essa cascata; a conta
  // é feita aqui.
  test('a fonte dos campos vence a regra geral dos diálogos', () => {
    const geral = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'overlays.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const seletorGeral = [...geral.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find(([, sel, corpo]) => /\.dw-dialog\s+:is\(input/.test(sel) && /font-size/.test(corpo))[1].trim();
    const base = especificidade(seletorGeral);
    expect(base).toEqual([0, 4, 1]);

    const daFonte = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .filter(([, sel, corpo]) => /\.ec-controle/.test(sel) && /font-size/.test(corpo))
      .map(([, sel]) => sel.trim());
    expect(daFonte.length).toBeGreaterThanOrEqual(3); // base, celular e toque
    daFonte.forEach((sel) => expect(comparar(especificidade(sel), base), sel).toBeGreaterThan(0));

    // Foco e desabilitado mudam borda e fundo, que a regra do campo também
    // define: precisam passar dela, senão o foco some e o travado fica branco.
    const doCampo = especificidade(daFonte[0]);
    const estados = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .map(([, sel]) => sel.trim())
      .filter((sel) => /\.ec-controle.*:(focus-visible|disabled)$/.test(sel));
    expect(estados.length).toBe(2);
    estados.forEach((sel) => expect(comparar(especificidade(sel), doCampo), sel).toBeGreaterThan(0));
  });
});

// Especificidade [ids, classes/atributos/pseudo-classes, elementos]. :is,
// :not e :has valem o argumento mais forte; :where não vale nada.
function dividirNoTopo(lista) {
  const partes = [];
  let nivel = 0, atual = '';
  for (const ch of lista) {
    if (ch === '(') nivel += 1;
    if (ch === ')') nivel -= 1;
    if (ch === ',' && nivel === 0) { partes.push(atual); atual = ''; } else atual += ch;
  }
  return [...partes, atual];
}
function comparar(x, y) {
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
// Razão de contraste do WCAG entre duas cores #rrggbb.
function contraste(a, b) {
  const luminancia = (hex) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}
function especificidade(seletor) {
  const soma = [0, 0, 0];
  const resto = seletor.replace(/:(is|not|has|where)\(((?:[^()]|\([^()]*\))*)\)/g, (_, funcao, args) => {
    if (funcao !== 'where') {
      const maior = dividirNoTopo(args).map(especificidade).reduce((m, x) => (comparar(x, m) > 0 ? x : m), [0, 0, 0]);
      maior.forEach((v, i) => { soma[i] += v; });
    }
    return ' ';
  });
  soma[0] += (resto.match(/#[\w-]+/g) || []).length;
  soma[1] += (resto.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  soma[2] += (resto.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length + (resto.match(/::[\w-]+/g) || []).length;
  return soma;
}
