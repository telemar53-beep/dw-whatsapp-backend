import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionStatus, ChannelsTable } from './ChannelsTable';
import { IconBrain, IconSpark } from '../../../components/icons/WaIcons';

// A coluna Conexão do canal oficial era um "Não verificada" fixo, porque
// ninguém perguntava nada para a Meta. Agora o backend manda `connection`; o
// selo antigo continua sendo o que aparece quando não veio resposta.
describe('ConnectionStatus para canal oficial', () => {
  const metaCloud = (connection) => ({ id: 'ch1', type: 'meta_cloud', status: 'connected', connection });

  test('mostra conectado e a qualidade quando a Meta confirma o número', () => {
    render(<ConnectionStatus channel={metaCloud({ state: 'connected', quality: 'GREEN' })} />);

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('Qualidade alta')).toBeInTheDocument();
  });

  test('traduz as outras faixas de qualidade da Meta', () => {
    const { rerender } = render(<ConnectionStatus channel={metaCloud({ state: 'connected', quality: 'YELLOW' })} />);
    expect(screen.getByText('Qualidade média')).toBeInTheDocument();

    rerender(<ConnectionStatus channel={metaCloud({ state: 'connected', quality: 'RED' })} />);
    expect(screen.getByText('Qualidade baixa')).toBeInTheDocument();
  });

  test('não mostra chip quando a Meta não sabe a qualidade', () => {
    render(<ConnectionStatus channel={metaCloud({ state: 'connected', quality: 'UNKNOWN' })} />);

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText(/Qualidade/)).not.toBeInTheDocument();
  });

  test('mostra o motivo da Meta quando o token do canal caiu', () => {
    render(<ConnectionStatus channel={metaCloud({ state: 'error', motivo: '(190) Session has expired' })} />);

    expect(screen.getByText('(190) Session has expired')).toBeInTheDocument();
  });

  test('avisa quando a Meta diz que o número não está conectado', () => {
    render(<ConnectionStatus channel={metaCloud({ state: 'disconnected' })} />);

    expect(screen.getByText('Desconectado')).toBeInTheDocument();
  });

  test('cai no selo antigo quando a Meta não respondeu', () => {
    render(<ConnectionStatus channel={metaCloud({ state: 'unknown' })} />);

    expect(screen.getByText('Não verificada')).toBeInTheDocument();
  });

  test('cai no selo antigo quando o backend não mandou o campo', () => {
    render(<ConnectionStatus channel={metaCloud(undefined)} />);

    expect(screen.getByText('Não verificada')).toBeInTheDocument();
  });

  test('o 360dialog continua como antes, sem verificação', () => {
    render(<ConnectionStatus channel={{ id: 'ch2', type: '360dialog', status: 'connected' }} />);

    expect(screen.getByText('Não verificada')).toBeInTheDocument();
  });
});

describe('ConnectionStatus para canal Baileys', () => {
  test('segue mostrando o status vigiado pelo handshake', () => {
    render(<ConnectionStatus channel={{ id: 'ch3', type: 'baileys', status: 'connected' }} />);

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText(/Qualidade/)).not.toBeInTheDocument();
  });

  test('mostra aguardando QR code', () => {
    render(<ConnectionStatus channel={{ id: 'ch3', type: 'baileys', status: 'awaiting_qr' }} />);

    expect(screen.getByText('Aguardando QR code')).toBeInTheDocument();
  });
});

// `IconBrain` e a IA DO PRODUTO (Triagem, Automacao) e `IconSpark` e a OpenAI, o
// FORNECEDOR — a Etapa 7.7 separou os dois de proposito. O chip de atendimento
// dizia "IA ativa" com o glifo do fornecedor, o que confundia as duas coisas.
describe('chip de atendimento: IA do produto, nao o fornecedor', () => {
  function caminhoDoGlifo(elemento) {
    const svg = elemento.querySelector('svg');
    return svg ? svg.querySelector('path').getAttribute('d') : null;
  }

  function chipDeIa() {
    const { container } = render(
      <MemoryRouter>
        <ChannelsTable channels={[{ id: 'ch1', name: 'Canal', type: 'baileys', status: 'connected', aiEnabled: true }]} />
      </MemoryRouter>
    );
    return container.querySelector('[data-attendance="IA ativa"] .channel-attendance-icon');
  }

  test('usa o cerebro (IA do produto), nao a faisca (OpenAI)', () => {
    const icone = chipDeIa();
    expect(icone).not.toBeNull();

    const cerebro = caminhoDoGlifo(render(<IconBrain size={13} />).container);
    const faisca = caminhoDoGlifo(render(<IconSpark size={13} />).container);
    expect(cerebro).not.toBe(faisca);

    expect(caminhoDoGlifo(icone)).toBe(cerebro);
    expect(caminhoDoGlifo(icone)).not.toBe(faisca);
  });
});
