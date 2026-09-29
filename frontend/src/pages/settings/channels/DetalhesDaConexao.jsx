import { estadoDoCanal, QUALIDADE } from './ChannelsTable';

// O cartão "Sessão do WhatsApp" (Baileys) ou "Conexão oficial" (Meta Cloud e
// 360dialog) do detalhe do canal, Fatia S2. As ações que nascem aqui
// (Reconectar, Atualizar credenciais) ficam aqui, e o erro delas também.
const ESTADO_DA_SESSAO = { connected: 'Conectada', awaiting_qr: 'Aguardando leitura do QR code', disconnected: 'Desconectada' };

function Linha({ rotulo, children, acao }) {
  return (
    <div className="cfg-linha">
      <dt>{rotulo}</dt>
      <dd>
        <span className="cfg-linha-valor">{children}</span>
        {acao}
      </dd>
    </div>
  );
}

export function DetalhesDaConexao({ channel, andamento, falha, onReconectar, onAtualizarCredenciais }) {
  if (channel.type === 'baileys') {
    return (
      <div className="cfg-cartao">
        <h3>Sessão do WhatsApp</h3>
        <dl className="cfg-linhas">
          <Linha rotulo="Estado">{ESTADO_DA_SESSAO[channel.status] || channel.status}</Linha>
          <Linha
            rotulo="Reconexão"
            acao={
              <button type="button" className="cfg-linha-acao" onClick={onReconectar} disabled={Boolean(andamento)}>
                {andamento === 'Reconectando…' ? 'Reconectando…' : 'Reconectar'}
              </button>
            }
          >
            Gera um novo QR code
          </Linha>
        </dl>
        {falha && (
          <div className="cfg-cartao-falha" role="alert">
            <p>{falha.mensagem}</p>
            <button type="button" className="cfg-linha-acao" onClick={falha.repetir}>Tentar novamente</button>
          </div>
        )}
      </div>
    );
  }

  const estado = estadoDoCanal(channel);
  const meta = channel.type === 'meta_cloud';
  return (
    <div className="cfg-cartao">
      <h3>Conexão oficial</h3>
      <dl className="cfg-linhas">
        <Linha rotulo="Estado">{estado.texto}</Linha>
        {meta ? (
          <>
            <Linha rotulo="Qualidade">{estado.qualidade ? QUALIDADE[estado.qualidade] : 'Não informada pela Meta'}</Linha>
            <Linha
              rotulo="Credenciais"
              acao={
                <button type="button" className="cfg-linha-acao" onClick={onAtualizarCredenciais} disabled={Boolean(andamento)}>
                  Atualizar credenciais
                </button>
              }
            >
              Access Token guardado
            </Linha>
          </>
        ) : (
          <>
            <Linha rotulo="Verificação">Feita pela 360dialog</Linha>
            <Linha rotulo="Credenciais">API Key guardada</Linha>
          </>
        )}
      </dl>
    </div>
  );
}
