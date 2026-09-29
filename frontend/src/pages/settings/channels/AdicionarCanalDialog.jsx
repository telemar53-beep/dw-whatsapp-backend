import './formulario-do-canal.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DialogoClaro, useCelular } from '../../../components/ui/DialogoClaro';
import { IconeRecolher } from '../../../components/icones/conversa';
import { IconeSemAcesso } from '../../../components/icones/configuracoes';
import { useAuth } from '../../../contexts/AuthContext';
import { createChannel } from '../../../services/api';
import { EmblemaDoCanal } from './emblema';
import { CampoSecreto } from './CampoSecreto';
import { mensagemDoCanal } from './mensagensDoCanal';

// Adicionar canal (Fatia S2, mockup aprovado): diálogo claro, carregado só
// quando é aberto (ChannelsListPage, via sobDemanda). Substitui o diálogo
// escuro de antes, com as marcas de terceiro.
//
// O que ele garante:
// - o tipo em emblemas de texto (API, BSP, BL), sem marca do WhatsApp;
// - credenciais mascaradas e sem autocompletar (CampoSecreto);
// - durante o envio, nada sai: Fechar, Cancelar, Trocar conexão, Esc e o
//   clique fora ficam presos, o envio não duplica e o botão diz
//   "Adicionando…". Assim o canal nunca é criado com o diálogo já fechado;
// - em erro, os dados ficam e o motivo aparece aqui dentro, em português;
// - uma resposta que chegue depois de o diálogo sumir (ou de o tipo mudar) é
//   descartada;
// - o payload é o mesmo de antes, campo a campo.
const TIPOS = [
  {
    valor: 'baileys',
    nome: 'Baileys',
    escolha: 'Conecta pelo WhatsApp do celular. Depois de adicionar, você lê um QR code.',
    intro: 'Depois você conecta lendo um QR code',
    pedido: 'Informe um nome para identificar este número.',
    acao: 'Adicionar e conectar',
  },
  {
    valor: 'meta_cloud',
    nome: 'Meta Cloud',
    escolha: 'Conexão oficial da Meta. Requer os identificadores e o Access Token.',
    intro: 'Conexão oficial da Meta',
    pedido: 'Informe os dados fornecidos no painel da Meta.',
    acao: 'Adicionar canal',
  },
  {
    valor: '360dialog',
    nome: '360dialog',
    escolha: 'Conexão oficial via BSP. Requer a API Key e o WABA ID.',
    intro: 'Conexão oficial via BSP',
    pedido: 'Informe os dados fornecidos pela 360dialog.',
    acao: 'Adicionar canal',
  },
];

const VAZIO = { name: '', phoneNumber: '', phoneNumberId: '', accessToken: '', wabaId: '', apiKey: '' };
const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };
const PARA_A_DIREITA = { transform: 'rotate(-90deg)' };

function payloadDo(tipo, c) {
  if (tipo === 'meta_cloud') {
    return { type: tipo, name: c.name, phoneNumber: c.phoneNumber, phoneNumberId: c.phoneNumberId, accessToken: c.accessToken, wabaId: c.wabaId };
  }
  if (tipo === '360dialog') return { type: tipo, name: c.name, phoneNumber: c.phoneNumber, apiKey: c.apiKey, wabaId: c.wabaId };
  return { type: tipo, name: c.name, phoneNumber: c.phoneNumber };
}

function CampoDeTexto({ id, rotulo, valor, onChange, disabled, inputMode, placeholder, inteiro = false }) {
  return (
    <div className={`mc-campo cfg-campo ${inteiro ? 'cfg-campo-inteiro' : ''}`}>
      <label htmlFor={id} className="mc-rotulo">{rotulo}</label>
      <input
        id={id}
        name={id}
        className="mc-entrada"
        value={valor}
        onChange={onChange}
        disabled={disabled}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete="off"
        required
      />
    </div>
  );
}

function AdicionarCanalDialog({ onClose, onCreated }) {
  const { token } = useAuth();
  const celular = useCelular();
  const [tipo, setTipo] = useState(null);
  const [campos, setCampos] = useState(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [tentou, setTentou] = useState(false);
  const pedido = useRef(0);
  const ultimoTipo = useRef(null);
  const opcoesRef = useRef({});
  const corpoRef = useRef(null);
  const nomeRef = useRef(null);
  const enviarRef = useRef(null);

  // Uma resposta que chegue depois de o diálogo sumir não vale nada.
  useEffect(() => () => { pedido.current += 1; }, []);

  // O diálogo anuncia que está ocupado. A moldura (ui/Dialog) não recebe o
  // atributo por prop, então ele vai direto no painel dela.
  useLayoutEffect(() => {
    const painel = corpoRef.current && corpoRef.current.closest('[role=dialog]');
    if (!painel) return;
    if (enviando) painel.setAttribute('aria-busy', 'true');
    else painel.removeAttribute('aria-busy');
  }, [enviando]);

  // Entrar no formulário leva o foco ao primeiro campo; voltar à escolha, ao
  // tipo que estava escolhido.
  useEffect(() => {
    if (tipo && nomeRef.current) nomeRef.current.focus();
    if (!tipo && ultimoTipo.current && opcoesRef.current[ultimoTipo.current]) opcoesRef.current[ultimoTipo.current].focus();
  }, [tipo]);

  function escolher(valor) {
    pedido.current += 1;
    ultimoTipo.current = valor;
    setErro(null);
    setTentou(false);
    setTipo(valor);
  }

  function trocarConexao() {
    if (enviando) return;
    pedido.current += 1;
    setErro(null);
    setTentou(false);
    setTipo(null);
  }

  function fechar() {
    if (enviando) return;
    onClose();
  }

  function mudar(campo) {
    return (evento) => setCampos((atual) => ({ ...atual, [campo]: evento.target.value }));
  }

  async function adicionar(evento) {
    evento.preventDefault();
    if (enviando || !tipo) return;
    const meu = ++pedido.current;
    // Os campos e o Cancelar ficam desativados durante o envio; o foco vai para
    // o botão de envio, que só fica aria-disabled e o segura até a resposta
    // (um elemento desativado com foco joga o foco no <body>).
    if (enviarRef.current) enviarRef.current.focus();
    setEnviando(true);
    setErro(null);
    try {
      const canal = await createChannel(payloadDo(tipo, campos), token);
      if (meu !== pedido.current) return;
      onCreated(canal);
    } catch (falha) {
      if (meu !== pedido.current) return;
      setErro(mensagemDoCanal(falha, 'Não foi possível adicionar o canal. Confira os dados e tente novamente.'));
      setTentou(true);
      setEnviando(false);
    }
  }

  const escolhido = TIPOS.find((t) => t.valor === tipo);
  const descricao = !escolhido
    ? 'Escolha como este número será conectado.'
    : enviando
      ? 'A conexão está sendo preparada. Aguarde a conclusão.'
      : erro
        ? 'Revise os dados e tente novamente.'
        : escolhido.pedido;

  return (
    <DialogoClaro
      variant="adicionar-canal"
      titulo="Adicionar canal"
      descricao={descricao}
      onClose={fechar}
      saidaDesabilitada={enviando}
      className="cfg-dlg-canal cfg-dlg-adicionar"
    >
      <div className="mc-corpo" ref={corpoRef}>
        <ol className="cfg-passos" aria-label="Etapas">
          <li aria-current={escolhido ? undefined : 'step'}>1 Conexão</li>
          <li aria-hidden="true" className="cfg-passos-linha" />
          <li aria-current={escolhido ? 'step' : undefined}>2 Dados</li>
        </ol>

        {!escolhido ? (
          <div className="cfg-escolhas">
            {TIPOS.map((t, i) => (
              <button
                key={t.valor}
                type="button"
                ref={(el) => { opcoesRef.current[t.valor] = el; }}
                className="cfg-escolha"
                onClick={() => escolher(t.valor)}
                data-autofocus={i === 0 ? '' : undefined}
              >
                <EmblemaDoCanal type={t.valor} />
                <strong>{t.nome}</strong>
                <span className="cfg-escolha-texto">{t.escolha}</span>
                <span className="cfg-escolha-seguir">
                  Continuar
                  <IconeRecolher tamanho={15} style={PARA_A_DIREITA} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form id="cfg-form-adicionar" className="cfg-form-canal" onSubmit={adicionar} autoComplete="off" noValidate={false}>
            <div className="cfg-form-intro">
              <EmblemaDoCanal type={escolhido.valor} />
              <div>
                <strong>{escolhido.nome}</strong>
                <span>{escolhido.intro}</span>
              </div>
            </div>
            <div className="cfg-campos">
              <div className="mc-campo cfg-campo">
                <label htmlFor="canal-nome" className="mc-rotulo">Nome do canal</label>
                <input
                  id="canal-nome"
                  name="canal-nome"
                  ref={nomeRef}
                  className="mc-entrada"
                  value={campos.name}
                  onChange={mudar('name')}
                  disabled={enviando}
                  autoComplete="off"
                  required
                />
              </div>
              <CampoDeTexto id="canal-telefone" rotulo="Telefone" valor={campos.phoneNumber} onChange={mudar('phoneNumber')} disabled={enviando} inputMode="tel" placeholder="+55 DDD número" />
              {tipo === 'meta_cloud' && (
                <>
                  <CampoDeTexto id="canal-phone-number-id" rotulo="Phone Number ID" valor={campos.phoneNumberId} onChange={mudar('phoneNumberId')} disabled={enviando} inputMode="numeric" />
                  <CampoDeTexto id="canal-waba" rotulo="WABA ID" valor={campos.wabaId} onChange={mudar('wabaId')} disabled={enviando} inputMode="numeric" />
                  <CampoSecreto
                    id="canal-token"
                    rotulo="Access Token"
                    nota="fica mascarado"
                    valor={campos.accessToken}
                    onChange={mudar('accessToken')}
                    disabled={enviando}
                    ajuda="Cole o token exatamente como aparece na Meta. Ele não será mostrado novamente aqui."
                  />
                </>
              )}
              {tipo === '360dialog' && (
                <>
                  <CampoSecreto id="canal-api-key" rotulo="API Key" nota="fica mascarada" valor={campos.apiKey} onChange={mudar('apiKey')} disabled={enviando} />
                  <CampoDeTexto id="canal-waba" rotulo="WABA ID" valor={campos.wabaId} onChange={mudar('wabaId')} disabled={enviando} inputMode="numeric" />
                </>
              )}
            </div>
          </form>
        )}
      </div>

      {escolhido && erro && <p role="alert" className="mc-erro">{erro}</p>}

      {escolhido && (
        <div className="mc-rodape cfg-dlg-rodape">
          {enviando ? (
            <p className="cfg-trava">
              <IconeSemAcesso tamanho={14} />
              Fechar e voltar estão bloqueados durante o envio.
            </p>
          ) : (
            <button type="button" className="cfg-voltar-conexao" onClick={trocarConexao}>
              <IconeRecolher tamanho={15} style={PARA_A_ESQUERDA} />
              {celular ? 'Voltar' : 'Trocar conexão'}
            </button>
          )}
          <div className="mc-acoes">
            <button type="button" className="mc-botao" onClick={fechar} disabled={enviando}>
              Cancelar
            </button>
            <button type="submit" form="cfg-form-adicionar" ref={enviarRef} className="mc-botao is-principal" aria-disabled={enviando ? 'true' : undefined}>
              {enviando ? 'Adicionando…' : tentou ? 'Tentar novamente' : escolhido.acao}
            </button>
          </div>
        </div>
      )}
    </DialogoClaro>
  );
}

export default AdicionarCanalDialog;
