import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import { formatPhone } from '../../../utils/phone';
import { providerLabel, conexaoLabel } from './ChannelsTable';
import { FaixaDeEstado } from './FaixaDeEstado';
import { EdicaoEmLinha } from './EdicaoEmLinha';
import { DetalhesDaConexao } from './DetalhesDaConexao';
import { AcoesDoCanal } from './AcoesDoCanal';
import QrDoCanal from './QrDoCanal';

// Aba Conexão do detalhe do canal (Fatia S2, primeiro mockup). A ordem do DOM
// é a de leitura: o estado (ou o QR, com o Baileys aguardando a leitura), a
// conexão, a identificação e as ações do canal. No computador, conexão e
// identificação ficam lado a lado (detalhe-do-canal.css).
function ChannelConnectionTab() {
  const { channel, refresh, actions, abrirCredenciais } = useOutletContext();
  const [renomear, setRenomear] = useState(0);
  const oficial = isOfficialChannelType(channel.type);
  const andamento = actions.pendentes[channel.id] || null;
  const erro = actions.erros[channel.id];
  const falha = erro ? { ...erro, dispensar: () => actions.limparErro(channel.id) } : null;

  return (
    <div className="cfg-conexao">
      <section aria-labelledby="cfg-conexao-titulo" className="cfg-secao cfg-secao-conexao">
        <h2 id="cfg-conexao-titulo" className="cfg-visualmente-oculto">Conexão</h2>
        <div className="cfg-conexao-estado">
          {channel.type === 'baileys' && channel.status === 'awaiting_qr' ? (
            <QrDoCanal channel={channel} onRefresh={refresh} />
          ) : (
            <FaixaDeEstado channel={channel} />
          )}
        </div>
        <DetalhesDaConexao
          channel={channel}
          andamento={andamento}
          falha={falha}
          onReconectar={() => actions.pedir('reconectar', channel)}
          onAtualizarCredenciais={() => abrirCredenciais('atualizar')}
        />
      </section>

      <section aria-labelledby="cfg-identificacao-titulo" className="cfg-secao cfg-secao-identificacao">
        <div className="cfg-cartao">
          <h2 id="cfg-identificacao-titulo">Identificação</h2>
          <dl className="cfg-linhas">
            <EdicaoEmLinha
              idDoCampo="canal-nome-edicao"
              rotulo="Nome"
              rotuloDoCampo="Nome do canal"
              rotuloEditar="Editar nome"
              rotuloSalvar="Salvar nome"
              valor={channel.name}
              onSalvar={(nome) => actions.salvarNome(channel.id, nome)}
              pedidoDeAbertura={renomear}
            />
            <div className="cfg-linha">
              <dt>Número</dt>
              <dd><span className="cfg-linha-valor">{formatPhone(channel.phoneNumber)}</span></dd>
            </div>
            <div className="cfg-linha">
              <dt>Provedor</dt>
              <dd><span className="cfg-linha-valor">{providerLabel(channel.type)} · {conexaoLabel(channel.type)}</span></dd>
            </div>
            {oficial && (
              <EdicaoEmLinha
                idDoCampo="canal-waba-edicao"
                rotulo="Conta (WABA)"
                rotuloDoCampo="Identificador da conta (WABA ID)"
                rotuloEditar="Editar WABA ID"
                rotuloSalvar="Salvar WABA ID"
                valor={channel.wabaId}
                vazio="não informado"
                onSalvar={(valor) => actions.salvarWaba(channel.id, valor)}
              />
            )}
          </dl>
        </div>
      </section>

      <AcoesDoCanal
        channel={channel}
        ocupado={Boolean(andamento)}
        onRenomear={() => setRenomear((n) => n + 1)}
        onOcultar={() => actions.pedir(channel.hidden ? 'reexibir' : 'ocultar', channel)}
        onMigrar={() => abrirCredenciais('migrar')}
        onExcluir={() => actions.pedir('excluir', channel)}
      />
    </div>
  );
}

export default ChannelConnectionTab;
