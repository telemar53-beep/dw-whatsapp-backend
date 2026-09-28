import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, startConversation, listTemplatesForChannel } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import { DialogoClaro, useCelular } from './ui/DialogoClaro';
import { descreverErro } from '../utils/errorMessages';
import './dialogo-nova-conversa.css';

// "Nova conversa", clara (Bloco 1). Chega sob demanda pela mesa: a página não
// baixa este formulário antes do clique em "Nova conversa".
//
// O fluxo é o de sempre — canal, país, telefone e, conforme o tipo do canal,
// a mensagem inicial (Baileys) ou o template de abertura (canal oficial). O
// que mudou:
// - a seção de conteúdo só aparece quando o tipo do canal é conhecido (A1-6):
//   antes o campo de mensagem aparecia e trocava pelo template;
// - a lista de templates tem carregando, erro com "Tentar de novo" e vazio de
//   verdade — a falha dela era uma rejeição sem tratamento, e a tela dizia
//   "nenhum template aprovado";
// - resposta atrasada de outro canal não vira a lista do canal escolhido;
// - o erro do envio fica fixo entre o corpo e o rodapé (A1-7).

const COUNTRY_CODES = [
  { code: '55', label: 'Brasil (+55)' },
  { code: '351', label: 'Portugal (+351)' },
  { code: '1', label: 'EUA/Canadá (+1)' },
  { code: '54', label: 'Argentina (+54)' },
  { code: '595', label: 'Paraguai (+595)' },
  { code: '598', label: 'Uruguai (+598)' },
  { code: '34', label: 'Espanha (+34)' },
];

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const celular = useCelular();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [ddi, setDdi] = useState('55');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState(null);
  // Um padrão só de validação (A1-10): antes o telefone usava erro na tela e
  // as variáveis e a mensagem, o balão nativo do navegador (`required`).
  const [variaveisErro, setVariaveisErro] = useState(null);
  const [conteudoErro, setConteudoErro] = useState(null);
  const [content, setContent] = useState('');
  const [templates, setTemplates] = useState([]);
  // 'idle' (canal não oficial) | 'loading' | 'ready' | 'error'
  const [templatesStatus, setTemplatesStatus] = useState('idle');
  const [tentativaDeTemplates, setTentativaDeTemplates] = useState(0);
  const [templateId, setTemplateId] = useState('');
  const [templateVariableValues, setTemplateVariableValues] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // O ref barra o segundo clique antes mesmo de o botão desabilitar.
  const enviandoRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const phoneDigits = phone.replace(/\D/g, '');

  useEffect(() => {
    let valendo = true;
    listChannelsForAgent(token)
      .then((data) => {
        if (!valendo) return;
        const eligible = data.filter(
          (channel) => (channel.type === 'baileys' && channel.status === 'connected') || isOfficialChannelType(channel.type)
        );
        setChannels(eligible);
        if (eligible.length > 0) {
          setChannelId(eligible[0].id);
        }
      })
      .catch(() => {
        if (valendo) setLoadError(true);
      })
      .finally(() => {
        if (valendo) setLoading(false);
      });
    return () => { valendo = false; };
  }, [token]);

  const selectedChannel = channels.find((channel) => channel.id === channelId);
  // O tipo do canal só é conhecido com a lista pronta e um canal escolhido.
  const tipoConhecido = !loading && !loadError && Boolean(selectedChannel);
  const isOfficialChannel = Boolean(selectedChannel) && isOfficialChannelType(selectedChannel.type);
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId);

  useEffect(() => {
    if (!isOfficialChannel || !channelId) {
      setTemplates([]);
      setTemplateId('');
      setTemplatesStatus('idle');
      return undefined;
    }
    // A resposta que chegar depois de trocar de canal é de outro canal: não
    // entra na tela.
    let valendo = true;
    setTemplates([]);
    setTemplateId('');
    setTemplatesStatus('loading');
    listTemplatesForChannel(channelId, token, 'atendimento')
      .then((data) => {
        if (!valendo) return;
        setTemplates(data);
        setTemplateId(data[0]?.id || '');
        setTemplatesStatus('ready');
      })
      .catch(() => {
        if (valendo) setTemplatesStatus('error');
      });
    return () => { valendo = false; };
  }, [isOfficialChannel, channelId, token, tentativaDeTemplates]);

  useEffect(() => {
    setTemplateVariableValues(selectedTemplate ? Array(selectedTemplate.variableCount).fill('') : []);
  }, [selectedTemplate]);

  function handleVariableChange(index, value) {
    setTemplateVariableValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  // O que falta para iniciar, dito no rodapé ao lado do botão.
  const disabledReason = submitting
    ? 'Iniciando conversa…'
    : loading
      ? 'Aguarde a lista de canais.'
      : loadError
        ? 'Falha no carregamento impede iniciar.'
        : channels.length === 0
          ? 'Nenhum canal disponível para iniciar.'
          : isOfficialChannel && templatesStatus === 'loading'
            ? 'Aguarde a lista de templates.'
            : isOfficialChannel && templatesStatus === 'error'
              ? 'Sem a lista de templates não dá para iniciar.'
              : isOfficialChannel && templates.length === 0
                ? 'Este canal precisa de um template aprovado para iniciar.'
                : null;
  const startDisabled = Boolean(disabledReason);

  async function handleSubmit(event) {
    event.preventDefault();
    if (enviandoRef.current || startDisabled) return;
    setError(null);
    setPhoneError(null);
    setVariaveisErro(null);
    setConteudoErro(null);
    let invalido = false;
    if (phoneDigits.length < 8) {
      setPhoneError('Informe o telefone com DDD.');
      invalido = true;
    }
    if (isOfficialChannel && templateVariableValues.some((v) => !String(v).trim())) {
      setVariaveisErro('Preencha todas as variáveis do template.');
      invalido = true;
    }
    if (!isOfficialChannel && !content.trim()) {
      setConteudoErro('Escreva a mensagem inicial.');
      invalido = true;
    }
    if (invalido) return;
    const phoneNumber = `${ddi}${phoneDigits}`;
    enviandoRef.current = true;
    setSubmitting(true);
    try {
      const conversation = isOfficialChannel
        ? await startConversation({ channelId, phoneNumber, templateId, templateVariables: templateVariableValues }, token)
        : await startConversation({ channelId, phoneNumber, content }, token);
      onCreated(conversation);
    } catch (err) {
      setError(descreverErro(err, 'Falha ao iniciar conversa'));
    } finally {
      enviandoRef.current = false;
      setSubmitting(false);
    }
  }

  let conteudo = null;
  if (tipoConhecido && isOfficialChannel) {
    conteudo = (
      <section className="nc-secao">
        <h3 className="nc-secao-titulo">Template de abertura</h3>
        <p className="mc-ajuda">Este canal requer o uso de template para iniciar o atendimento.</p>
        {templatesStatus === 'loading' && <p role="status" className="mc-carregando nc-estado">Carregando templates…</p>}
        {templatesStatus === 'error' && (
          <div role="alert" className="mc-falha">
            <span>Não foi possível carregar os templates.</span>
            <button type="button" className="mc-botao" onClick={() => setTentativaDeTemplates((n) => n + 1)}>Tentar de novo</button>
          </div>
        )}
        {templatesStatus === 'ready' && templates.length === 0 && (
          <p className="mc-vazio nc-estado">Nenhum template aprovado para este canal.</p>
        )}
        {templatesStatus === 'ready' && templates.length > 0 && (
          // O <label> acompanha o <select>: quando nao ha template o campo nao
          // existe, e um `for` apontando para id inexistente e referencia quebrada.
          <div className="mc-campo nc-template">
            <label htmlFor="start-conversation-template" className="mc-rotulo">Template</label>
            <select id="start-conversation-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mc-entrada">
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>
          </div>
        )}
        {/* Template não abre a janela de 24h — só a resposta do cliente abre.
            Botão é o caminho de um toque para ele responder; sem botão, a
            conversa fica esperando ele escrever por conta. */}
        {selectedTemplate && (
          <div className="nc-depois">
            {(selectedTemplate.buttons || []).length > 0 && (
              <div className="nc-botoes">
                {(selectedTemplate.buttons || []).map((texto) => (
                  <span key={texto} className="nc-botao-previa">{texto}</span>
                ))}
              </div>
            )}
            <p className="mc-ajuda">
              {(selectedTemplate.buttons || []).length > 0
                ? 'O cliente responde com um toque no botão — e é essa resposta que abre a conversa para você escrever.'
                : 'Este template não tem botões: a conversa só continua depois que o cliente responder.'}
            </p>
          </div>
        )}
        {templateVariableValues.length > 0 && (
          <div className="nc-variaveis">
            {templateVariableValues.map((value, index) => (
              <div key={index} className="mc-campo">
                <label htmlFor={`start-conversation-variable-${index}`} className="mc-rotulo">Variável {index + 1}</label>
                <input
                  id={`start-conversation-variable-${index}`}
                  value={value}
                  onChange={(e) => handleVariableChange(index, e.target.value)}
                  className="mc-entrada"
                  aria-invalid={variaveisErro && !String(value).trim() ? 'true' : 'false'}
                  aria-describedby={variaveisErro ? 'start-conversation-variables-error' : undefined}
                />
              </div>
            ))}
          </div>
        )}
        {variaveisErro && <p role="alert" id="start-conversation-variables-error" className="mc-campo-erro">{variaveisErro}</p>}
      </section>
    );
  } else if (tipoConhecido) {
    conteudo = (
      <section className="nc-secao">
        <div className="mc-campo">
          <label htmlFor="start-conversation-message" className="mc-rotulo">Mensagem inicial</label>
          <textarea
            id="start-conversation-message"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="mc-entrada"
            aria-invalid={conteudoErro ? 'true' : 'false'}
            aria-describedby={conteudoErro ? 'start-conversation-message-error' : undefined}
          />
          {conteudoErro && <p role="alert" id="start-conversation-message-error" className="mc-campo-erro">{conteudoErro}</p>}
        </div>
      </section>
    );
  }

  return (
    <DialogoClaro variant="start-conversation" titulo="Nova conversa" onClose={onClose} celular={celular} className="nc-dialogo">
      <form onSubmit={handleSubmit} noValidate className="nc-form">
        <div className="mc-corpo nc-corpo">
          <div className="mc-campo">
            <label htmlFor="start-conversation-channel" className="mc-rotulo">Canal</label>
            {loading ? (
              <p role="status" className="mc-carregando nc-estado">Carregando canais…</p>
            ) : loadError ? (
              <p role="alert" className="mc-falha">Não foi possível carregar os canais. Feche e tente novamente.</p>
            ) : channels.length === 0 ? (
              <p role="status" className="mc-vazio nc-estado">Nenhum canal conectado no momento.</p>
            ) : (
              <select id="start-conversation-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className="mc-entrada">
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="nc-fone">
            <div className="mc-campo">
              <label htmlFor="start-conversation-ddi" className="mc-rotulo">País</label>
              <select id="start-conversation-ddi" value={ddi} onChange={(e) => setDdi(e.target.value)} className="mc-entrada">
                {COUNTRY_CODES.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}
              </select>
            </div>
            <div className="mc-campo">
              <label htmlFor="start-conversation-phone" className="mc-rotulo">Telefone</label>
              <input
                id="start-conversation-phone"
                data-autofocus=""
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                autoComplete="tel-national"
                className="mc-entrada"
                aria-invalid={phoneError ? 'true' : 'false'}
                aria-describedby={phoneError ? 'start-conversation-phone-error' : 'start-conversation-phone-help'}
              />
            </div>
          </div>
          <div id="start-conversation-phone-help" className="nc-fone-ajuda">
            <span>Digite com DDD. Com ou sem o 9, o sistema confere no WhatsApp qual forma existe.</span>
            {phoneDigits.length > 0 && <span className="nc-fone-completo">Número completo: {ddi}{phoneDigits}</span>}
          </div>
          {phoneError && <p role="alert" id="start-conversation-phone-error" className="mc-campo-erro">{phoneError}</p>}

          {conteudo}
        </div>

        {/* Fora do corpo que rola (A1-7): o erro do envio fica logo acima do botão. */}
        {error && <p role="alert" className="mc-erro">{error}</p>}
        <div className="mc-rodape">
          <p role="status" className="mc-nota">{startDisabled ? disabledReason : ''}</p>
          <div className="mc-acoes">
            <button type="button" onClick={onClose} className="mc-botao">Cancelar</button>
            <button type="submit" disabled={startDisabled} className="mc-botao is-principal">Iniciar conversa</button>
          </div>
        </div>
      </form>
    </DialogoClaro>
  );
}

export default StartConversationModal;
