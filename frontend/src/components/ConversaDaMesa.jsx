import ContactAvatar from './ContactAvatar';
import {
  IconeConsultarSgp, IconeTransferir, IconeEncerrar, IconeAssumir, IconeHistorico, IconeDadosCliente, IconeRecolher,
  IconeAnexar, IconeRespostasRapidas, IconeEmoji, IconeMicrofone, IconeEnviar, IconeInformacoes,
} from './icones';
import './conversa-mesa.css';

// A conversa da mesa (fatia 2 do novo atendimento). A ConversationView é a
// mesma do modal da Supervisão e dos Encerrados, e fica num trecho que essas
// páginas também baixam: por isso o que é SÓ da mesa — este cabeçalho, a
// faixa de contexto, os ícones DW e o CSS claro — entra pela página, dentro
// de VARIANTE_DA_MESA. A lógica (assumir, transferir, encerrar, painéis,
// janela de 24 h) continua toda na ConversationView; aqui só se desenha.

const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

// O cabeçalho recebe da ConversationView os dados e as ações que ela já tinha.
// Nada é consultado aqui: nenhum dado do SGP, nenhuma presença, nenhuma
// duração — só o que a conversa já traz.
function CabecalhoDaMesa({
  conversation, displayName, nameLabel, headerLabel, phoneLine, telefone, cityName, status, canal,
  podeAssumir, podeAgir, encerrarDiscreto,
  onVoltar, onEditarContato, onAssumir, onTransferir, onEncerrar, onHistorico, sgp, cliente,
}) {
  // Pares rótulo/valor em ordem de prioridade: quando falta largura, o CSS
  // tira do fim para o começo. A cidade é o único texto livre e longo: ela
  // encolhe com reticências em vez de sair (`flexivel`). Responsável por
  // último porque, na mesa, quase sempre é quem está olhando. Só entra o que
  // existe.
  const dados = [
    ['Setor', conversation.sectorName],
    ['Protocolo', conversation.protocolNumber],
    ['Cidade', cityName, true],
    ['Telefone', telefone],
    ['Responsável', conversation.assignedAgentName],
  ].filter(([, valor]) => Boolean(valor));

  return (
    <>
      <div className="mesa-cab">
        <button type="button" onClick={onVoltar} aria-label="Voltar para a lista" className="mesa-cab-voltar">
          <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
        </button>
        <button type="button" onClick={onEditarContato} aria-label={`Editar cliente: ${headerLabel}`} className="mesa-cab-contato">
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={displayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={40}
          />
          <span className="mesa-cab-identidade">
            <span className="mesa-cab-nome" title={phoneLine || nameLabel}>{nameLabel}</span>
            <span className="mesa-cab-estado">
              <span className="mesa-cab-ponto" data-estado={status.tipo} aria-hidden="true" />
              <span>{status.label}</span>
              {canal && <span className="mesa-cab-canal">{canal}</span>}
            </span>
          </span>
        </button>
        <div className="mesa-cab-acoes">
          <button
            type="button"
            ref={sgp.ref}
            onClick={sgp.alternar}
            aria-label="Consultar SGP"
            aria-expanded={sgp.aberto}
            aria-controls={sgp.aberto ? 'conv-painel-sgp' : undefined}
            className="mesa-acao"
          >
            <IconeConsultarSgp /><span className="mesa-acao-texto">Consultar SGP</span>
          </button>
          {podeAssumir && (
            <button type="button" onClick={onAssumir} aria-label="Assumir" className="mesa-acao is-principal">
              <IconeAssumir /><span className="mesa-acao-principal-texto">Assumir</span>
            </button>
          )}
          {podeAgir && (
            <>
              <button type="button" onClick={onTransferir} aria-label="Transferir atendimento" className="mesa-acao">
                <IconeTransferir /><span className="mesa-acao-texto">Transferir</span>
              </button>
              <button type="button" onClick={onEncerrar} aria-label="Encerrar atendimento" className={`mesa-acao ${encerrarDiscreto ? '' : 'is-encerrar'}`}>
                <IconeEncerrar /><span className="mesa-acao-texto">Encerrar</span>
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mesa-faixa">
        {dados.length > 0 && (
          <dl className="mesa-faixa-dados">
            {dados.map(([rotulo, valor, flexivel]) => (
              <div key={rotulo} className={flexivel ? 'mesa-faixa-item is-flexivel' : 'mesa-faixa-item'}>
                <dt>{rotulo}</dt>
                <dd title={valor}>{valor}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mesa-faixa-acoes">
          <button type="button" onClick={onHistorico} aria-label="Ver atendimentos anteriores" className="mesa-acao is-faixa">
            <IconeHistorico tamanho={18} /><span className="mesa-acao-texto">Histórico</span>
          </button>
          <button
            type="button"
            ref={cliente.ref}
            onClick={cliente.alternar}
            aria-label="Dados do cliente"
            aria-expanded={cliente.aberto}
            aria-controls={cliente.aberto ? 'conv-painel-cliente' : undefined}
            className="mesa-acao is-faixa"
          >
            <IconeDadosCliente tamanho={18} /><span className="mesa-acao-texto">Dados do cliente</span>
          </button>
        </div>
      </div>
    </>
  );
}

// Os ícones que a ConversationView e o MessageInput desenham por dentro
// (compositor, aviso da janela, responder) chegam prontos, no formato que eles
// já usam: um componente que recebe `size`.
const tamanhoDW = (Icone) => function IconeDaMesa({ size }) {
  return <Icone tamanho={size} />;
};

// Um objeto só, definido uma vez: a página o passa sempre igual, e o memo da
// conversa aberta (A2) continua comparando a mesma referência.
export const VARIANTE_DA_MESA = Object.freeze({
  Cabecalho: CabecalhoDaMesa,
  icones: Object.freeze({
    Anexar: tamanhoDW(IconeAnexar),
    Respostas: tamanhoDW(IconeRespostasRapidas),
    Emoji: tamanhoDW(IconeEmoji),
    Microfone: tamanhoDW(IconeMicrofone),
    Enviar: tamanhoDW(IconeEnviar),
    Info: tamanhoDW(IconeInformacoes),
    Responder: tamanhoDW(IconeRecolher),
  }),
});
