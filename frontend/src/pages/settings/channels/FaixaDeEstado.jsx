import { estadoDoCanal } from './ChannelsTable';

// A faixa de estado do detalhe (Fatia S2, primeiro mockup): a resposta à
// primeira pergunta de quem abre o canal — está ligado? — com o que fazer
// quando não está. Os tons seguem o selo: ok, espera, erro e neutro.
export function descreverEstado(channel) {
  const e = estadoDoCanal(channel);
  if (channel.type === 'baileys') {
    if (channel.status === 'connected') {
      return { tom: 'ok', titulo: 'Conexão normal', texto: 'O número está ligado ao sistema e pronto para receber mensagens.' };
    }
    return { tom: 'erro', titulo: 'Desconectado', texto: 'O WhatsApp deste número não está ligado. Use Reconectar para gerar um novo QR code.' };
  }
  if (channel.type === '360dialog') {
    return { tom: 'neutro', titulo: 'Não verificada', texto: 'Este sistema não confirma a conexão de canais 360dialog: o estado é o do provedor.' };
  }
  if (e.chave === 'unknown') {
    return { tom: 'neutro', titulo: 'Não verificada', texto: 'A Meta não respondeu agora. O estado volta a ser conferido na próxima leitura.' };
  }
  if (e.chave === 'disconnected') {
    return { tom: 'erro', titulo: 'Desconectado', texto: 'A Meta informa que este número não está conectado.' };
  }
  if (e.chave === 'error') {
    return {
      tom: 'erro',
      titulo: 'A Meta recusou a conexão',
      texto: `Motivo informado pela Meta: ${e.motivo || 'não informado'}. Atualize as credenciais para voltar a enviar.`,
    };
  }
  if (e.qualidade === 'YELLOW') {
    return { tom: 'espera', titulo: 'Qualidade média', texto: 'A Meta avalia a qualidade deste número como média. Abaixo disso, ela pode limitar ou bloquear os envios.' };
  }
  if (e.qualidade === 'RED') {
    return { tom: 'erro', titulo: 'Qualidade baixa', texto: 'A Meta avalia a qualidade deste número como baixa e pode limitar ou bloquear os envios.' };
  }
  return {
    tom: 'ok',
    titulo: 'Conexão oficial ativa',
    texto: e.qualidade ? 'A Meta confirma o número. Qualidade alta.' : 'A Meta confirma o número. Ela ainda não informou a qualidade.',
  };
}

export function FaixaDeEstado({ channel }) {
  const f = descreverEstado(channel);
  return (
    <div className="cfg-faixa" data-tom={f.tom}>
      <strong>{f.titulo}</strong>
      <span>{f.texto}</span>
    </div>
  );
}
