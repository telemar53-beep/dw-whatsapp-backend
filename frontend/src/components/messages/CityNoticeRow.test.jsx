import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CityNoticeRow from './CityNoticeRow';
import { useAuth } from '../../contexts/AuthContext';
import * as api from '../../services/api';

vi.mock('../../contexts/AuthContext');
vi.mock('../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CityNoticeRow', () => {
  test('a city without a notice shows a create button, not an open textarea', () => {
    render(<CityNoticeRow city={{ id: 'city-1', name: 'Maracaçumé', notice: null }} onSaved={vi.fn()} />);

    expect(screen.getByText('Maracaçumé')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar aviso/i })).toBeInTheDocument();
    const cityRow = screen.getByText('Maracaçumé').closest('li');
    expect(within(cityRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a city with a notice shows a closed row with status, preview, and edit/delete buttons', () => {
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade na rede', enabled: true } }}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText('Maracaçumé')).toBeInTheDocument();
    expect(screen.getByText('Instabilidade na rede')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^excluir$/i })).toBeInTheDocument();
    const cityRow = screen.getByText('Maracaçumé').closest('li');
    expect(within(cityRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a disabled notice shows the Inativo status instead of Ativo', () => {
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade na rede', enabled: false } }}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(screen.queryByText('Ativo')).not.toBeInTheDocument();
  });

  test('creating a city notice opens the form, saves with the Ativo checkbox, and refreshes the list', async () => {
    const onSaved = vi.fn();
    api.setCityNotice.mockResolvedValue({ id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true });
    render(<CityNoticeRow city={{ id: 'city-1', name: 'Maracaçumé', notice: null }} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: /criar aviso/i }));
    const textareas = screen.getAllByRole('textbox');
    const noticeTextarea = textareas.find((ta) => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(noticeTextarea, 'Instabilidade');
    await userEvent.click(screen.getByRole('checkbox', { name: /ativo/i }));
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => expect(api.setCityNotice).toHaveBeenCalledWith('city-1', 'Instabilidade', true, 'tok-123'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('editing an existing city notice pre-fills the text and the Ativo checkbox', async () => {
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }}
        onSaved={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByDisplayValue('Texto atual')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /ativo/i })).toBeChecked();
  });

  test('canceling a city-notice edit discards unsaved changes and shows the closed row again', async () => {
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }}
        onSaved={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const textarea = screen.getByDisplayValue('Texto atual');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.getByText('Texto atual')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a city notice asks for confirmation, then removes it and refreshes', async () => {
    const onSaved = vi.fn();
    api.deleteCityNotice.mockResolvedValue(undefined);
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }}
        onSaved={onSaved}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(api.deleteCityNotice).toHaveBeenCalledWith('city-1', 'tok-123'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('does not delete a city notice when the confirmation is declined', async () => {
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }}
        onSaved={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancelar/i }));

    expect(api.deleteCityNotice).not.toHaveBeenCalled();
  });

  test('shows an error message when saving a city notice fails', async () => {
    api.setCityNotice.mockRejectedValue({ body: { error: 'Falha ao salvar aviso' } });
    render(<CityNoticeRow city={{ id: 'city-1', name: 'Maracaçumé', notice: null }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /criar aviso/i }));
    const textareas = screen.getAllByRole('textbox');
    const noticeTextarea = textareas.find((ta) => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(noticeTextarea, 'Instabilidade');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(await screen.findByText('Falha ao salvar aviso')).toBeInTheDocument();
  });

  test('shows an error message when deleting a city notice fails', async () => {
    api.deleteCityNotice.mockRejectedValue({ body: { error: 'Falha ao excluir aviso' } });
    render(
      <CityNoticeRow
        city={{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }}
        onSaved={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));

    expect(await screen.findByText('Falha ao excluir aviso')).toBeInTheDocument();
  });
});
