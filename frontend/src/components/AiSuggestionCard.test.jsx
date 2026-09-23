import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AiSuggestionCard from './AiSuggestionCard';

describe('AiSuggestionCard', () => {
  const suggestion = { id: 's-1', content: 'Seu plano é 600MB.' };

  test('renders nothing when there is no suggestion', () => {
    const { container } = render(<AiSuggestionCard suggestion={null} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows the suggested text and marks it as coming from the AI', () => {
    render(<AiSuggestionCard suggestion={suggestion} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText('Seu plano é 600MB.')).toBeInTheDocument();
    expect(screen.getByText(/sugestão da ia/i)).toBeInTheDocument();
  });

  test('the three actions call their handlers', async () => {
    const onSend = vi.fn(); const onEdit = vi.fn(); const onDiscard = vi.fn();
    render(<AiSuggestionCard suggestion={suggestion} onSend={onSend} onEdit={onEdit} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(onSend).toHaveBeenCalledWith(suggestion);
    expect(onEdit).toHaveBeenCalledWith(suggestion);
    expect(onDiscard).toHaveBeenCalledWith(suggestion);
  });
});

describe('AiSuggestionCard — ações executadas pela IA', () => {
  const base = { id: 's-1', content: 'Sua internet foi liberada.' };

  test('mostra o aviso de liberação em confiança executada', () => {
    render(<AiSuggestionCard suggestion={{ ...base, acoesExecutadas: ['consultar_faturas', 'desbloqueio_confianca'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/liberação em confiança executada/i)).toBeInTheDocument();
    // Consultas são leitura: não viram aviso.
    expect(screen.queryByText(/consultar_faturas/)).not.toBeInTheDocument();
  });

  test('sem ações sensíveis, nenhum aviso aparece', () => {
    render(<AiSuggestionCard suggestion={{ ...base, acoesExecutadas: ['consultar_plano'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });
});

// Contenção de 22/09/2026. O card filtra `acoesExecutadas` por
// `ROTULO_ACAO[nome]`: qualquer nome fora do catálogo some sem deixar rastro.
// Era por ali que a ação bloqueada ia desaparecer da tela — o oposto do que
// esta entrega existe para garantir.
describe('AiSuggestionCard — ações propostas e NÃO executadas', () => {
  const base = { id: 's-1', content: 'Posso liberar; confirma?' };

  test('mostra a ação proposta e diz que ela não aconteceu', () => {
    render(<AiSuggestionCard suggestion={{ ...base, acoesPropostas: ['desbloqueio_confianca'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/não executou/i)).toBeInTheDocument();
    expect(screen.getByText(/liberar em confiança no sgp/i)).toBeInTheDocument();
  });

  // O ponto que fez esta lista existir: a proposta NUNCA pode ser descrita com
  // a frase no passado da lista de executadas.
  test('a ação proposta não é descrita como executada', () => {
    render(<AiSuggestionCard suggestion={{ ...base, acoesPropostas: ['desbloqueio_confianca'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.queryByText(/executada no sgp/i)).not.toBeInTheDocument();
  });

  // O gate barra por CLASSIFICAÇÃO, então o catálogo do frontend sempre vai
  // ficar para trás de uma ferramenta nova. Ficar para trás pode; sumir, não.
  test('ferramenta sem rótulo no catálogo ainda aparece', () => {
    render(<AiSuggestionCard suggestion={{ ...base, acoesPropostas: ['cancelar_contrato_inventada'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/cancelar_contrato_inventada/)).toBeInTheDocument();
  });

  test('as duas listas convivem sem se confundir', () => {
    render(<AiSuggestionCard
      suggestion={{ ...base, acoesExecutadas: ['gerar_pix'], acoesPropostas: ['desbloqueio_confianca'] }}
      onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()}
    />);
    expect(screen.getByText(/código pix gerado/i)).toBeInTheDocument();
    expect(screen.getByText(/liberar em confiança no sgp/i)).toBeInTheDocument();
  });

  test('sem ações propostas, o bloco não aparece', () => {
    render(<AiSuggestionCard suggestion={{ ...base, acoesExecutadas: ['gerar_pix'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.queryByText(/não executou/i)).not.toBeInTheDocument();
  });
});
