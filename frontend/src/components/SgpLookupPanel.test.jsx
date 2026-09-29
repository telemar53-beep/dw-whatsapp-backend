import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SgpLookupPanel from './SgpLookupPanel';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { ApiError } from '../services/api';
import QRCode from 'qrcode';

vi.mock('../hooks/useSgpLookup');
vi.mock('qrcode');

// Dados claramente fictícios.
const VINCULADO = '00011122233';
const BASE_HOOK = {
  client: null,
  contracts: [],
  loading: false,
  error: null,
  errorMessage: null,
  search: vi.fn(),
  fetchDuplicate: vi.fn(),
  duplicateState: {},
};
const CLIENTE = { id: 1, name: 'Cliente Exemplo', document: '000.111.222-33' };
const CONTRATO_A = {
  id: 17402,
  status: 'Ativo',
  plan: 'Plano Teste 300',
  address: 'Rua Exemplo, 10 - Centro - Cidade Teste/MA',
  city: 'Cidade Teste',
  phones: ['(00) 00000-0000'],
  emails: ['contato@exemplo.test'],
  login: 'cliente.teste',
  mac: '00:00:00:00:00:01',
  openInvoicesCount: 2,
  openAmount: 179.8,
};
const CONTRATO_B = { id: 25439, status: 'Suspenso', statusReason: 'Inadimplência', plan: 'Plano Teste 100' };
const FATURA_1 = { id: '901', dueDate: '2026-09-20', value: 89.9, barCode: '0000 1111', pixCode: 'PIX-901', boletoLink: 'https://exemplo.test/901' };
const FATURA_2 = { id: '902', dueDate: '2026-10-20', value: 99.5, barCode: '2222 3333', pixCode: 'PIX-902', boletoLink: 'https://exemplo.test/902' };
const COM_FATURAS = { 17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [FATURA_1, FATURA_2] } };

function envios() {
  return {
    onSendMessage: vi.fn().mockResolvedValue({}),
    onSendPdf: vi.fn().mockResolvedValue({}),
    onSendPix: vi.fn().mockResolvedValue([]),
    onSendPixQr: vi.fn().mockResolvedValue([]),
    onSendBarcode: vi.fn().mockResolvedValue([]),
  };
}

function abrir(hook = {}, props = {}) {
  useSgpLookup.mockReturnValue({ ...BASE_HOOK, ...hook });
  const handlers = envios();
  render(<SgpLookupPanel {...handlers} onClose={vi.fn()} {...props} />);
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  QRCode.toDataURL.mockResolvedValue('data:image/png;base64,FAKE');
  // Só o relógio: 28/09/2026 (as datas curtas saem sem o ano). Os timers seguem reais.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T12:00:00-03:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('busca', () => {
  test('sem documento vinculado: dica e campo à vista, nenhuma consulta', () => {
    const search = vi.fn();
    abrir({ search });
    expect(screen.getByText(/este contato não tem documento vinculado/i)).toBeInTheDocument();
    expect(screen.getByLabelText('CPF ou CNPJ do cliente')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  test('com documento vinculado: consulta ao abrir e deixa o campo recolhido', () => {
    const search = vi.fn();
    abrir({ search }, { initialCpf: VINCULADO });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(VINCULADO);
    expect(screen.queryByLabelText('CPF ou CNPJ do cliente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar outro documento' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('outro documento: abre o campo e busca só os dígitos', async () => {
    const search = vi.fn();
    abrir({ search }, { initialCpf: VINCULADO });
    await userEvent.click(screen.getByRole('button', { name: 'Consultar outro documento' }));
    await userEvent.type(screen.getByLabelText('CPF ou CNPJ do cliente'), '999.888.777-66');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(search).toHaveBeenLastCalledWith('99988877766');
  });

  test('"Buscar" fica bloqueado enquanto a busca está no caminho', () => {
    abrir({ loading: true });
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
    expect(screen.getByText('Buscando no SGP…')).toBeInTheDocument();
  });

  test('cliente não encontrado', () => {
    abrir({ error: 'not_found' });
    expect(screen.getByText(/cliente não encontrado/i)).toBeInTheDocument();
  });

  test('erro conhecido do backend aparece traduzido; desconhecido, como veio', () => {
    abrir({ error: 'error', errorMessage: 'SGP integration is not configured' });
    expect(screen.getByRole('alert')).toHaveTextContent('A integração com o SGP não está configurada.');
  });

  test('erro desconhecido não é engolido', () => {
    abrir({ error: 'error', errorMessage: 'Falha X no SGP' });
    expect(screen.getByRole('alert')).toHaveTextContent('Falha X no SGP');
  });
});

describe('identificação', () => {
  test('nome do SGP, documento mascarado uma vez só e o selo "Documento vinculado"', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A] }, { initialCpf: VINCULADO });
    const cliente = screen.getByRole('region', { name: 'Cliente no SGP' });
    expect(within(cliente).getByText('Cliente Exemplo')).toBeInTheDocument();
    expect(within(cliente).getByText('000.***.***-33')).toBeInTheDocument();
    expect(within(cliente).getByText('Documento vinculado')).toBeInTheDocument();
    expect(screen.queryByText('000.111.222-33')).not.toBeInTheDocument();
    expect(screen.getAllByText('000.***.***-33')).toHaveLength(1);
  });

  test('documento diferente do contato fica sinalizado', async () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A] }, { initialCpf: VINCULADO });
    await userEvent.click(screen.getByRole('button', { name: 'Consultar outro documento' }));
    await userEvent.type(screen.getByLabelText('CPF ou CNPJ do cliente'), '99988877766');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('Documento diferente do contato')).toBeInTheDocument();
    expect(screen.queryByText('Documento vinculado')).not.toBeInTheDocument();
  });

  test('contato sem documento vinculado: diz isso, sem presumir vínculo', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A] });
    expect(screen.getByText('Contato sem documento vinculado')).toBeInTheDocument();
  });
});

describe('contratos', () => {
  test('fechado, mostra só o contrato escolhido: o primeiro, como sempre', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A, CONTRATO_B] });
    const contratos = screen.getByRole('region', { name: 'Contratos' });
    expect(within(contratos).getByText('Contrato ••402')).toBeInTheDocument();
    expect(within(contratos).queryByText('Contrato ••439')).not.toBeInTheDocument();
    expect(within(contratos).getByText('Ativo')).toBeInTheDocument();
    expect(within(contratos).getByText('Plano Teste 300')).toBeInTheDocument();
    expect(within(contratos).getByText('2 contratos')).toBeInTheDocument();
  });

  test('abrir mostra todos, com o status; o que não está ativo aparece em atenção e com o motivo', async () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A, CONTRATO_B] });
    const linha = screen.getByRole('button', { name: /contrato ••402/i });
    await userEvent.click(linha);
    expect(linha).toHaveAttribute('aria-expanded', 'true');
    const lista = screen.getByRole('list', { name: 'Contratos' });
    expect(within(lista).getAllByRole('button')).toHaveLength(2);
    expect(within(lista).getByText('Suspenso')).toHaveClass('is-atencao');
    expect(within(lista).getByText('Inadimplência')).toBeInTheDocument();
  });

  test('escolher outro contrato fecha a lista e mostra o escolhido com o motivo do status', async () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A, CONTRATO_B] });
    await userEvent.click(screen.getByRole('button', { name: /contrato ••402/i }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Contratos' })).getByRole('button', { name: /••439/ }));
    expect(screen.queryByRole('list', { name: 'Contratos' })).not.toBeInTheDocument();
    expect(screen.getByText('Contrato ••439')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Inadimplência')).toBeInTheDocument();
  });

  test('Esc fecha a lista e devolve o foco à linha', async () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A, CONTRATO_B] });
    const linha = screen.getByRole('button', { name: /contrato ••402/i });
    await userEvent.click(linha);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Contratos' })).not.toBeInTheDocument();
    expect(linha).toHaveFocus();
  });

  test('um contrato só: a linha não abre lista', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A] });
    expect(screen.queryByRole('button', { name: /contrato ••402/i })).not.toBeInTheDocument();
    expect(screen.getByText('Contrato ••402')).toBeInTheDocument();
  });

  test('cliente sem contrato', () => {
    abrir({ client: CLIENTE, contracts: [] });
    expect(screen.getByText('Nenhum contrato encontrado para este cliente no SGP.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consultar 2ª via' })).not.toBeInTheDocument();
  });
});

describe('faturas', () => {
  test('antes da 2ª via: o que a consulta do contrato informou, o botão e o aviso — sem chamada automática', () => {
    const fetchDuplicate = vi.fn();
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], fetchDuplicate });
    expect(screen.getByText('2 títulos informados pelo SGP · Valor informado R$ 179,80')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar 2ª via' })).toBeInTheDocument();
    expect(screen.getByText('Pode gerar Pix no SGP.')).toBeInTheDocument();
    expect(fetchDuplicate).not.toHaveBeenCalled();
  });

  test('"Consultar 2ª via" pede a do contrato escolhido', async () => {
    const fetchDuplicate = vi.fn();
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], fetchDuplicate });
    await userEvent.click(screen.getByRole('button', { name: 'Consultar 2ª via' }));
    expect(fetchDuplicate).toHaveBeenCalledWith(17402);
  });

  test('consultando, nenhuma fatura e erro traduzido', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], duplicateState: { 17402: { loading: true, error: null } } });
    expect(screen.getByText('Consultando o SGP…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consultar 2ª via' })).not.toBeInTheDocument();
  });

  test('nenhuma 2ª via liberada: diz isso, sem afirmar que não há fatura em aberto', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: false, duplicates: [] } } });
    expect(screen.getByText('O SGP não liberou segunda via para este contrato.')).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma fatura em aberto/i)).not.toBeInTheDocument();
  });

  test('erro da 2ª via: mensagem traduzida e o botão de volta para tentar de novo', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], duplicateState: { 17402: { loading: false, error: 'error', errorMessage: 'Failed to reach SGP' } } });
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível falar com o SGP.');
    expect(screen.getByRole('button', { name: 'Consultar 2ª via' })).toBeInTheDocument();
  });

  test('fechada, mostra só a 2ª via escolhida, com a data como validade; a soma das 2ª vias não vira total', () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], duplicateState: COM_FATURAS });
    const faturas = screen.getByRole('region', { name: 'Faturas' });
    expect(within(faturas).getByText(/Nº 901/)).toBeInTheDocument();
    expect(within(faturas).queryByText(/Nº 902/)).not.toBeInTheDocument();
    expect(within(faturas).getByText('R$ 89,90')).toBeInTheDocument();
    expect(within(faturas).getByText('2ª via válida até 20 set')).toBeInTheDocument();
    expect(within(faturas).getByText('Em aberto')).toBeInTheDocument();
    expect(within(faturas).getByText('2 segundas vias')).toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$\s189,40/)).not.toBeInTheDocument();
  });

  test('abrir mostra todas as 2ª vias liberadas', async () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A], duplicateState: COM_FATURAS });
    await userEvent.click(screen.getByRole('button', { name: /nº 901/i }));
    const lista = screen.getByRole('list', { name: 'Segundas vias liberadas' });
    expect(within(lista).getAllByRole('button')).toHaveLength(2);
    expect(within(lista).getByText('Nº 902')).toBeInTheDocument();
  });

  test('trocar a 2ª via troca o que vai no envio', async () => {
    const { onSendPix } = abrir({ client: CLIENTE, contracts: [CONTRATO_A], duplicateState: COM_FATURAS }, { podeEnviar: true });
    await userEvent.click(screen.getByRole('button', { name: /nº 901/i }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Segundas vias liberadas' })).getByRole('button', { name: /902/ }));
    // A escolhida aparece fechada no seletor, logo acima do "Enviar esta 2ª via".
    expect(screen.getByRole('button', { name: /nº 902/i })).toHaveTextContent('2ª via válida até 20 out');
    await userEvent.click(screen.getByRole('button', { name: 'Código Pix' }));
    expect(onSendPix).toHaveBeenCalledWith(17402, expect.objectContaining({ id: '902', pixCode: 'PIX-902' }));
  });
});

// Bug de 28/09/2026: o contrato tinha duas faturas vencidas de R$ 100,00 no mesmo dia, e o painel
// mostrava "2 faturas em aberto · Total R$ 100,00" antes e "1 fatura em aberto · Vence 28 set"
// depois. A conferência dos títulos (vencimento original, valores, total) e as 2ª vias liberadas
// (data da reemissão, meios de pagamento) agora aparecem separadas — nada casa uma com a outra.
describe('conferência das faturas (bug de 28/09/2026)', () => {
  const CONTRATO_DO_BUG = { id: 17402, status: 'Ativo', plan: 'Plano Teste 300', openInvoicesCount: 2, openAmount: 100 };
  const SEGUNDA_VIA = { id: '900', dueDate: '2026-09-28', value: 100, barCode: 'LINHA-900', pixCode: 'PIX-900', boletoLink: 'https://exemplo.test/900' };
  const OUTRA_SEGUNDA_VIA = { id: '901', dueDate: '2026-10-20', value: 100, barCode: 'LINHA-901', pixCode: 'PIX-901-B', boletoLink: 'https://exemplo.test/901-b' };
  const pendencia = (faturaId, campos = {}) => ({
    faturaId, vencimentoOriginal: '2026-09-15', vencimentoAtualizado: '2026-09-28', valorOriginal: 100, valorCorrigido: 100, valor: 100, ...campos,
  });
  const doDia = (faturaId) => pendencia(faturaId, { vencimentoOriginal: '2026-09-28' });
  const conferida = (vencidas, venceHoje, totalVencidas) => ({ estado: 'completa', vencidas, venceHoje, totalVencidas });
  const DUAS_VENCIDAS = conferida([pendencia(101), pendencia(102)], [], 200);
  const respostaDaSegundaVia = (duplicates, conferencia) => ({
    17402: { loading: false, error: null, hasOpenInvoice: duplicates.length > 0, duplicates, ...(conferencia ? { conferencia } : {}) },
  });
  const doBug = (duplicateState = {}, props) => abrir({ client: CLIENTE, contracts: [CONTRATO_DO_BUG], duplicateState }, props);

  test('antes da consulta: só o que o SGP informou, sem chamar de "Total"', () => {
    doBug();
    expect(screen.getByText('2 títulos informados pelo SGP · Valor informado R$ 100,00')).toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  test('um título informado: singular', () => {
    abrir({ client: CLIENTE, contracts: [{ ...CONTRATO_DO_BUG, openInvoicesCount: 1 }] });
    expect(screen.getByText('1 título informado pelo SGP · Valor informado R$ 100,00')).toBeInTheDocument();
  });

  test('conferida: as duas vencidas, cada uma pelo vencimento original e com o valor, e o total R$ 200,00', () => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA], DUAS_VENCIDAS));
    expect(screen.getByText('2 faturas vencidas · Total R$ 200,00')).toBeInTheDocument();
    const linhas = within(screen.getByRole('list', { name: 'Pendências no SGP' })).getAllByRole('listitem');
    expect(linhas).toHaveLength(2);
    linhas.forEach((linha, i) => {
      expect(within(linha).getByText('Venceu 15 set')).toBeInTheDocument();
      expect(within(linha).getByText('R$ 100,00')).toBeInTheDocument();
      expect(within(linha).getByText(`Nº ${101 + i}`)).toBeInTheDocument();
    });
    // Com a conferência, o que a consulta do contrato "informou" sai de cena.
    expect(screen.queryByText(/informado/)).not.toBeInTheDocument();
  });

  test('a 2ª via fica à parte: só a que o SGP liberou, com a data da reemissão como validade', () => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA], DUAS_VENCIDAS));
    expect(screen.queryByText('Fatura selecionada')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2ª via selecionada' })).toBeInTheDocument();
    expect(screen.getByText('2ª via válida até 28 set')).toBeInTheDocument();
    expect(screen.queryByText(/Venc(e|eu) 28 set/)).not.toBeInTheDocument();
    expect(screen.getByText('Nº 900')).toBeInTheDocument();
    // A validade já está no cartão logo acima: o título das ações não repete a data.
    expect(screen.getByRole('heading', { name: 'Enviar esta 2ª via' })).toBeInTheDocument();
    expect(screen.queryByText(/Enviar ao cliente/)).not.toBeInTheDocument();
    // Uma só: não há lista de 2ª vias para abrir.
    expect(screen.queryByRole('button', { name: /nº 900/i })).not.toBeInTheDocument();
  });

  test('2 vencidas e 1 segunda via: o aviso diz as duas coisas', () => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA], DUAS_VENCIDAS));
    expect(screen.getByText('O SGP informou 2 faturas vencidas, mas liberou 1 segunda via. Confira no SGP antes de enviar.')).toBeInTheDocument();
  });

  test.each([
    ['1 vencida e 2 segundas vias', conferida([pendencia(101)], [], 100), [SEGUNDA_VIA, OUTRA_SEGUNDA_VIA],
      'O SGP informou 1 fatura vencida, mas liberou 2 segundas vias. Confira no SGP antes de enviar.'],
    ['2 vencidas e nenhuma segunda via', DUAS_VENCIDAS, [],
      'O SGP informou 2 faturas vencidas, mas não liberou segunda via. Confira no SGP antes de enviar.'],
    ['1 vencida, 1 do dia e 1 segunda via', conferida([pendencia(101)], [doDia(102)], 100), [SEGUNDA_VIA],
      'O SGP informou 1 fatura vencida e 1 que vence hoje, mas liberou 1 segunda via. Confira no SGP antes de enviar.'],
    ['2 do dia e 1 segunda via', conferida([], [doDia(101), doDia(102)], 0), [SEGUNDA_VIA],
      'O SGP informou 2 faturas que vencem hoje, mas liberou 1 segunda via. Confira no SGP antes de enviar.'],
  ])('aviso com %s', (_, conferencia, duplicates, aviso) => {
    doBug(respostaDaSegundaVia(duplicates, conferencia));
    expect(screen.getByText(aviso)).toBeInTheDocument();
  });

  test('pendências e 2ª vias na mesma quantidade: sem aviso', () => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA, OUTRA_SEGUNDA_VIA], DUAS_VENCIDAS));
    expect(screen.queryByText(/Confira no SGP/)).not.toBeInTheDocument();
  });

  test('nada vencido: diz isso, sem total, e a 2ª via adiantada segue sem aviso', () => {
    doBug(respostaDaSegundaVia([OUTRA_SEGUNDA_VIA], conferida([], [], 0)));
    expect(screen.getByText('Nenhuma fatura vencida.')).toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confira no SGP/)).not.toBeInTheDocument();
    expect(screen.getByText('2ª via válida até 20 out')).toBeInTheDocument();
  });

  test('vencida e do dia: o total é só das vencidas; a do dia aparece como "Vence hoje"', () => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA, OUTRA_SEGUNDA_VIA], conferida([pendencia(101)], [doDia(102)], 100)));
    expect(screen.getByText('1 fatura vencida · Total R$ 100,00 · 1 vence hoje')).toBeInTheDocument();
    const linhas = within(screen.getByRole('list', { name: 'Pendências no SGP' })).getAllByRole('listitem');
    expect(within(linhas[0]).getByText('Venceu 15 set')).toBeInTheDocument();
    expect(within(linhas[1]).getByText('Vence hoje')).toBeInTheDocument();
  });

  test('só do dia: o resumo diz quantas vencem hoje', () => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA, OUTRA_SEGUNDA_VIA], conferida([], [doDia(101), doDia(102)], 0)));
    expect(screen.getByText('2 faturas vencem hoje')).toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  test.each([
    ['incompleta', { estado: 'incompleta' }],
    ['indisponível', { estado: 'indisponivel' }],
    ['ausente (backend anterior)', undefined],
  ])('conferência %s: 2ª vias disponíveis, aviso claro e nenhuma soma como total', (_, conferencia) => {
    doBug(respostaDaSegundaVia([SEGUNDA_VIA, { ...OUTRA_SEGUNDA_VIA, dueDate: '2026-09-28' }], conferencia), { podeEnviar: true });
    expect(screen.getByText('Não foi possível conferir todas as pendências. Confira no SGP antes de enviar.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pendências no SGP' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$\s200,00/)).not.toBeInTheDocument();
    // O que o SGP informou continua à vista, como informado.
    expect(screen.getByText('2 títulos informados pelo SGP · Valor informado R$ 100,00')).toBeInTheDocument();
    expect(screen.getByText('2ª via válida até 28 set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Código Pix' })).not.toBeDisabled();
  });

  test('os cinco meios saem só da 2ª via escolhida, como ela veio — nunca de uma pendência', async () => {
    const h = doBug(respostaDaSegundaVia([SEGUNDA_VIA, OUTRA_SEGUNDA_VIA], DUAS_VENCIDAS), { podeEnviar: true });
    await userEvent.click(screen.getByRole('button', { name: /nº 900/i }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Segundas vias liberadas' })).getByRole('button', { name: /901/ }));
    expect(screen.getByRole('button', { name: /nº 901/i })).toHaveTextContent('2ª via válida até 20 out');
    expect(screen.getByRole('heading', { name: 'Enviar esta 2ª via' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Código Pix' }));
    await userEvent.click(screen.getByRole('button', { name: 'Código de barras' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'QR Pix' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar QR Pix' }));

    expect(h.onSendPix).toHaveBeenCalledWith(17402, OUTRA_SEGUNDA_VIA);
    expect(h.onSendBarcode).toHaveBeenCalledWith(17402, OUTRA_SEGUNDA_VIA);
    expect(h.onSendMessage).toHaveBeenCalledWith('https://exemplo.test/901-b');
    expect(h.onSendPdf).toHaveBeenCalledWith(17402, 'https://exemplo.test/901-b');
    expect(h.onSendPixQr).toHaveBeenCalledWith(17402, OUTRA_SEGUNDA_VIA);
    expect(QRCode.toDataURL).toHaveBeenCalledWith('PIX-901-B');
  });

  test('troca de contrato: o outro contrato não herda as pendências, o total nem o aviso do primeiro', async () => {
    const CONTRATO_OUTRO = { id: 25439, status: 'Suspenso', statusReason: 'Inadimplência', plan: 'Plano Teste 100', openInvoicesCount: 1, openAmount: 50 };
    abrir({ client: CLIENTE, contracts: [CONTRATO_DO_BUG, CONTRATO_OUTRO], duplicateState: respostaDaSegundaVia([SEGUNDA_VIA], DUAS_VENCIDAS) });
    expect(screen.getByText('2 faturas vencidas · Total R$ 200,00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /contrato ••402/i }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Contratos' })).getByRole('button', { name: /••439/ }));

    expect(screen.getByText('1 título informado pelo SGP · Valor informado R$ 50,00')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pendências no SGP' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confira no SGP/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar 2ª via' })).toBeInTheDocument();
  });
});

describe('envio ao cliente', () => {
  const comFaturas = { client: CLIENTE, contracts: [CONTRATO_A], duplicateState: COM_FATURAS };

  test('cada ação chama o envio certo, com a fatura escolhida', async () => {
    const h = abrir(comFaturas);
    await userEvent.click(screen.getByRole('button', { name: 'Código Pix' }));
    expect(h.onSendPix).toHaveBeenCalledWith(17402, expect.objectContaining({ pixCode: 'PIX-901' }));
    expect(await screen.findByText('Código Pix enviado para o cliente')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Código de barras' }));
    expect(h.onSendBarcode).toHaveBeenCalledWith(17402, expect.objectContaining({ barCode: '0000 1111' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(h.onSendMessage).toHaveBeenCalledWith('https://exemplo.test/901');
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(h.onSendPdf).toHaveBeenCalledWith(17402, 'https://exemplo.test/901');
    expect(await screen.findByText('PDF da fatura enviado para o cliente')).toBeInTheDocument();
    expect(h.onSendPixQr).not.toHaveBeenCalled();
  });

  test('clique repetido não dispara o mesmo envio duas vezes', async () => {
    let concluir;
    const h = abrir(comFaturas);
    h.onSendPix.mockReturnValue(new Promise((resolve) => { concluir = resolve; }));
    const botao = screen.getByRole('button', { name: 'Código Pix' });
    await userEvent.click(botao);
    await userEvent.click(botao);
    expect(h.onSendPix).toHaveBeenCalledTimes(1);
    expect(botao).toBeDisabled();
    concluir([]);
    await waitFor(() => expect(botao).not.toBeDisabled());
  });

  test('falha com motivo do backend aparece traduzida', async () => {
    const h = abrir(comFaturas);
    h.onSendPix.mockRejectedValue(new ApiError(403, { error: 'Only the assigned agent can send messages on this conversation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Código Pix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar. Só quem está com o atendimento pode enviar mensagens nele.');
  });

  test('falha sem resposta do servidor', async () => {
    const h = abrir(comFaturas);
    h.onSendPdf.mockRejectedValue(new Error('network error'));
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível enviar/i);
  });

  test('sem a responsabilidade pelo atendimento, as ações ficam desabilitadas e o motivo à vista', () => {
    abrir(comFaturas, { podeEnviar: false, motivoSemEnvio: 'Assuma o atendimento para enviar ao cliente.' });
    const motivo = screen.getByText('Assuma o atendimento para enviar ao cliente.');
    ['Código Pix', 'Código de barras', 'Link', 'PDF'].forEach((nome) => {
      const botao = screen.getByRole('button', { name: nome });
      expect(botao).toBeDisabled();
      expect(botao).toHaveAttribute('aria-describedby', motivo.id);
    });
    // A prévia do QR não é envio: continua disponível.
    expect(screen.getByRole('button', { name: 'QR Pix' })).not.toBeDisabled();
  });

  test('com a responsabilidade, o rodapé diz isso', () => {
    abrir(comFaturas, { podeEnviar: true });
    expect(screen.getByText('Atendimento sob sua responsabilidade')).toBeInTheDocument();
  });

  test('sem o dado na fatura, a ação fica desabilitada com o motivo', () => {
    abrir({ ...comFaturas, duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [{ ...FATURA_1, barCode: null }] } } });
    expect(screen.getByRole('button', { name: 'Código de barras' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Código de barras' })).toHaveAttribute('title', 'Esta fatura não tem código de barras.');
  });
});

describe('prévia do QR Pix', () => {
  const comFaturas = { client: CLIENTE, contracts: [CONTRATO_A], duplicateState: COM_FATURAS };

  test('"QR Pix" abre a prévia sem enviar; o envio é a ação explícita de dentro dela', async () => {
    const h = abrir(comFaturas);
    await userEvent.click(screen.getByRole('button', { name: 'QR Pix' }));
    await waitFor(() => expect(screen.getByAltText('QR code do Pix')).toHaveAttribute('src', 'data:image/png;base64,FAKE'));
    expect(QRCode.toDataURL).toHaveBeenCalledWith('PIX-901');
    expect(screen.getByText('Prévia. O cliente ainda não recebeu este QR.')).toBeInTheDocument();
    expect(h.onSendPixQr).not.toHaveBeenCalled();
    expect(h.onSendPix).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar QR Pix' }));
    expect(h.onSendPixQr).toHaveBeenCalledWith(17402, expect.objectContaining({ pixCode: 'PIX-901' }));
    expect(await screen.findByText('QR Pix enviado para o cliente')).toBeInTheDocument();
  });

  test('sem a responsabilidade, a prévia abre mas o envio fica desabilitado', async () => {
    abrir(comFaturas, { podeEnviar: false, motivoSemEnvio: 'Assuma o atendimento para enviar ao cliente.' });
    await userEvent.click(screen.getByRole('button', { name: 'QR Pix' }));
    expect(await screen.findByAltText('QR code do Pix')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar QR Pix' })).toBeDisabled();
  });

  test('clicar de novo fecha a prévia; trocar de fatura também', async () => {
    abrir(comFaturas);
    await userEvent.click(screen.getByRole('button', { name: 'QR Pix' }));
    await screen.findByAltText('QR code do Pix');
    await userEvent.click(screen.getByRole('button', { name: 'QR Pix' }));
    expect(screen.queryByAltText('QR code do Pix')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'QR Pix' }));
    await screen.findByAltText('QR code do Pix');
    await userEvent.click(screen.getByRole('button', { name: /nº 901/i }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Segundas vias liberadas' })).getByRole('button', { name: /902/ }));
    expect(screen.queryByAltText('QR code do Pix')).not.toBeInTheDocument();
  });
});

describe('contatos e dados técnicos', () => {
  test('recolhido; aberto, mostra só o que a consulta trouxe, com rótulos', async () => {
    abrir({ client: CLIENTE, contracts: [CONTRATO_A] });
    const botao = screen.getByRole('button', { name: 'Contatos e dados técnicos' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('contato@exemplo.test')).not.toBeInTheDocument();
    await userEvent.click(botao);
    expect(screen.getByText('(00) 00000-0000')).toBeInTheDocument();
    expect(screen.getByText('contato@exemplo.test')).toBeInTheDocument();
    expect(screen.getByText('cliente.teste')).toBeInTheDocument();
    expect(screen.getByText('00:00:00:00:00:01')).toBeInTheDocument();
    expect(screen.getByText('E-mail')).toBeInTheDocument();
    expect(screen.queryByText('VLAN')).not.toBeInTheDocument();
  });

  test('sem nenhum desses dados, a seção não aparece', () => {
    abrir({ client: CLIENTE, contracts: [{ id: 1, status: 'Ativo' }] });
    expect(screen.queryByRole('button', { name: 'Contatos e dados técnicos' })).not.toBeInTheDocument();
  });
});

describe('no lugar da conversa', () => {
  test('um só controle de saída: "Voltar à conversa", sem o "×"', async () => {
    const onClose = vi.fn();
    useSgpLookup.mockReturnValue(BASE_HOOK);
    render(<SgpLookupPanel {...envios()} onClose={onClose} emTela />);
    expect(screen.getAllByRole('button', { name: /voltar à conversa|fechar consulta sgp/i })).toHaveLength(1);
    const voltar = screen.getByRole('button', { name: 'Voltar à conversa' });
    expect(voltar).toHaveFocus();
    await userEvent.click(voltar);
    expect(onClose).toHaveBeenCalled();
  });

  test('em coluna, o "×" fecha', () => {
    abrir();
    expect(screen.getByRole('button', { name: 'Fechar consulta SGP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar à conversa' })).not.toBeInTheDocument();
  });
});
