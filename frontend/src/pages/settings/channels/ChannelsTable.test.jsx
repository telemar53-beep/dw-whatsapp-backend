import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus, estadoDoCanal } from './ChannelsTable';

// A coluna Conexão do canal oficial era um "Não verificada" fixo, porque
// ninguém perguntava nada para a Meta. Agora o backend manda `connection`; o
// selo antigo continua sendo o que aparece quando não veio resposta.
describe('ConnectionStatus para canal oficial', () => {
  const metaCloud = (connection) => ({ id: 'ch1', type: 'meta_cloud', status: 'connected', connection });

  test('mostra conectado e a qualidade quando a Meta confirma o número', () => {
    render(<ConnectionStatus comQualidade channel={metaCloud({ state: 'connected', quality: 'GREEN' })} />);

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('Qualidade alta')).toBeInTheDocument();
  });

  test('traduz as outras faixas de qualidade da Meta', () => {
    const { rerender } = render(<ConnectionStatus comQualidade channel={metaCloud({ state: 'connected', quality: 'YELLOW' })} />);
    expect(screen.getByText('Qualidade média')).toBeInTheDocument();

    rerender(<ConnectionStatus comQualidade channel={metaCloud({ state: 'connected', quality: 'RED' })} />);
    expect(screen.getByText('Qualidade baixa')).toBeInTheDocument();
  });

  test('não mostra chip quando a Meta não sabe a qualidade', () => {
    render(<ConnectionStatus comQualidade channel={metaCloud({ state: 'connected', quality: 'UNKNOWN' })} />);

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

// Fatia S2: na lista o selo é só ponto e texto (a qualidade fica para o
// detalhe) e não desenha mais os ícones da família antiga, que o CSS escondia.
describe('ConnectionStatus na S2', () => {
  test('sem comQualidade, a lista não mostra o chip de qualidade', () => {
    render(<ConnectionStatus channel={{ id: 'ch1', type: 'meta_cloud', status: 'connected', connection: { state: 'connected', quality: 'RED' } }} />);
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText(/Qualidade/)).not.toBeInTheDocument();
  });

  test('é ponto e texto, sem svg', () => {
    const { container } = render(<ConnectionStatus channel={{ id: 'ch3', type: 'baileys', status: 'disconnected' }} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.channel-status-dot')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.channel-connection')).toHaveAttribute('data-tom', 'erro');
  });
});

describe('estadoDoCanal', () => {
  test('qualidade média ou baixa da Meta vira tom de espera, alta fica ok', () => {
    const meta = (quality) => ({ type: 'meta_cloud', connection: { state: 'connected', quality } });
    expect(estadoDoCanal(meta('GREEN')).tom).toBe('ok');
    expect(estadoDoCanal(meta('YELLOW')).tom).toBe('espera');
    expect(estadoDoCanal(meta('RED')).tom).toBe('espera');
    expect(estadoDoCanal(meta('UNKNOWN')).qualidade).toBeNull();
  });

  test('o erro da Meta guarda o motivo que ela deu', () => {
    const estado = estadoDoCanal({ type: 'meta_cloud', connection: { state: 'error', motivo: '(190) Session has expired' } });
    expect(estado).toMatchObject({ chave: 'error', tom: 'erro', motivo: '(190) Session has expired' });
  });

  test('Baileys: tom pelo status do banco', () => {
    expect(estadoDoCanal({ type: 'baileys', status: 'connected' }).tom).toBe('ok');
    expect(estadoDoCanal({ type: 'baileys', status: 'awaiting_qr' }).tom).toBe('espera');
    expect(estadoDoCanal({ type: 'baileys', status: 'disconnected' }).tom).toBe('erro');
  });
});

// O chip de atendimento ("IA ativa") saiu desta lista com a tabela: os cartões
// da Fatia S1 o mostram só em texto, sem o glifo do produto nem o do
// fornecedor. Ver CartoesDeCanais.test.jsx.
