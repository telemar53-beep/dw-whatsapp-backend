import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listTemplatesForChannel, sendConversationTemplate } from '../services/api';
import { substituirVariaveis } from '../utils/templatePreview';
import { DialogoClaro, useCelular } from './ui/DialogoClaro';
import { descreverErro } from '../utils/errorMessages';
import './dialogo-template.css';

// Com a janela de 24h fechada, template aprovado é a única coisa que o WhatsApp
// entrega. Isto não contorna a regra: o texto continua sendo o pré-aprovado,
// com variáveis. O que muda é o atendente conseguir fazer, pela tela, a única
// coisa permitida naquele momento.
//
// A lista pede só os de 'atendimento': template de disparo é do SGP e da
// campanha, e não tem por que aparecer numa conversa individual.
//
// Claro desde o Bloco 1 (28/09), e sob demanda: a conversa só baixa este
// diálogo quando alguém pede "Enviar template". O rodapé diz o que falta para
// enviar (A5-4) e o erro do envio fica fixo acima dele (A5-5).

// Os mesmos nomes da tela de Templates (TemplatesAdminTab.jsx), copiados:
// importar de lá traria a tela de administração para a conversa.
const CATEGORIAS = { UTILITY: 'Utilidade', MARKETING: 'Marketing', AUTHENTICATION: 'Autenticação' };
const IDIOMAS = { pt_BR: 'Português (Brasil)', en_US: 'Inglês (EUA)', es: 'Espanhol' };

// "Preencha a variável 2." / "Preencha as variáveis 1 e 3."
function oQueFalta(variables) {
  const vazias = variables.map((v, i) => (v.trim() ? null : i + 1)).filter(Boolean);
  if (vazias.length === 0) return null;
  if (vazias.length === 1) return `Preencha a variável ${vazias[0]}.`;
  return `Preencha as variáveis ${vazias.slice(0, -1).join(', ')} e ${vazias[vazias.length - 1]}.`;
}

function SendTemplateModal({ conversationId, channelId, onClose, onSent }) {
  const { token } = useAuth();
  const celular = useCelular();
  const [templates, setTemplates] = useState([]);
  const [status, setStatus] = useState('loading');
  const [selected, setSelected] = useState(null);
  const [variables, setVariables] = useState([]);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  // O ref barra o segundo clique antes mesmo de o botão desabilitar.
  const enviandoRef = useRef(false);
  // Resposta que chega depois de fechar não mexe em nada.
  const montadoRef = useRef(true);
  useEffect(() => () => { montadoRef.current = false; }, []);
  // No celular a prévia fica depois da lista: o toque num template a traz à
  // vista, de uma vez (sem animação). As setas não rolam — quem anda com o
  // teclado continua na lista.
  const comporRef = useRef(null);
  const rolarAtePreviaRef = useRef(false);
  useEffect(() => {
    const rolar = rolarAtePreviaRef.current;
    rolarAtePreviaRef.current = false;
    const alvo = comporRef.current;
    if (rolar && celular && selected && alvo && typeof alvo.scrollIntoView === 'function') alvo.scrollIntoView({ block: 'start' });
  }, [selected, celular]);

  const carregar = useCallback(() => {
    if (!channelId) return;
    setStatus('loading');
    listTemplatesForChannel(channelId, token, 'atendimento')
      .then((data) => {
        if (!montadoRef.current) return;
        setTemplates(data);
        setStatus('ready');
      })
      .catch(() => {
        if (montadoRef.current) setStatus('error');
      });
  }, [channelId, token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Escolha de um entre N é grupo de rádio (antes: botões com aria-pressed).
  // As setas movem a escolha, como o padrão pede.
  function aoTeclarNaLista(evento) {
    const passo = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[evento.key];
    if (!passo || templates.length === 0) return;
    evento.preventDefault();
    const atual = selected ? templates.findIndex((t) => t.id === selected.id) : -1;
    const proximo = templates[(atual + passo + templates.length) % templates.length];
    escolher(proximo);
    evento.currentTarget.querySelector(`[data-template-id="${proximo.id}"]`)?.focus();
  }

  function escolher(template) {
    setSelected(template);
    setVariables(Array.from({ length: template.variableCount }, () => ''));
    setError(null);
  }

  async function enviar() {
    if (!pronto || enviandoRef.current) return;
    enviandoRef.current = true;
    setSending(true);
    setError(null);
    try {
      await sendConversationTemplate(conversationId, selected.id, variables, token);
      onSent();
    } catch (err) {
      if (montadoRef.current) setError(descreverErro(err, 'Não foi possível enviar o template.'));
    } finally {
      enviandoRef.current = false;
      if (montadoRef.current) setSending(false);
    }
  }

  const pronto = Boolean(selected) && variables.every((v) => v.trim());
  const falta = sending
    ? 'Enviando o template…'
    : status === 'loading'
      ? 'Aguarde a lista de templates.'
      : status !== 'ready'
        ? 'Sem a lista de templates, não dá para enviar.'
        : templates.length === 0
          ? 'Sem template aprovado, não há o que enviar.'
        : !selected
          ? 'Escolha um template.'
          : oQueFalta(variables);

  let lista;
  if (status === 'loading') {
    lista = <p role="status" className="mc-carregando">Carregando templates…</p>;
  } else if (status === 'error') {
    lista = (
      <div role="alert" className="mc-falha">
        <span>Não foi possível carregar os templates.</span>
        <button type="button" className="mc-botao" onClick={carregar}>Tentar de novo</button>
      </div>
    );
  } else if (templates.length === 0) {
    lista = <p className="mc-vazio">Nenhum template de atendimento aprovado neste canal. Cadastre um em Configurações → Templates.</p>;
  } else {
    lista = (
      <ul role="radiogroup" aria-label="Template" onKeyDown={aoTeclarNaLista} className="te-lista">
        {templates.map((t) => {
          const escolhido = Boolean(selected && selected.id === t.id);
          const categoria = t.category ? CATEGORIAS[t.category] || t.category : null;
          const idioma = t.language ? IDIOMAS[t.language] || t.language : null;
          return (
            <li key={t.id} role="none">
              <button
                type="button"
                role="radio"
                data-template-id={t.id}
                onClick={() => { rolarAtePreviaRef.current = !escolhido; escolher(t); }}
                aria-checked={escolhido}
                tabIndex={selected ? (escolhido ? 0 : -1) : (t.id === templates[0].id ? 0 : -1)}
                className="te-linha"
              >
                <span className="te-linha-texto">
                  <span className="te-nome">{t.name}</span>
                  {(categoria || idioma) && (
                    <span className="te-meta">
                      {categoria && <span>{categoria}</span>}
                      {idioma && <span>{idioma}</span>}
                    </span>
                  )}
                  <span className="te-corpo">{t.bodyText}</span>
                </span>
                <span className="te-marca" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <DialogoClaro
      variant="send-template"
      titulo="Enviar template"
      descricao="A janela de 24h está fechada. Só template aprovado é entregue até o cliente responder."
      onClose={onClose}
      celular={celular}
      className="te-dialogo"
    >
      <div className="mc-corpo te-grade">
        <div className="te-escolha">{lista}</div>

        <div ref={comporRef} className="te-compor">
          {/* A prévia existe porque template não dá para corrigir depois: uma
              variável no lugar errado chega assim ao cliente. */}
          {selected ? (
            <>
              <div role="group" aria-label="Prévia da mensagem" className="te-previa">
                <p className="te-previa-titulo" aria-hidden="true">Prévia da mensagem</p>
                <p className="te-bolha">{substituirVariaveis(selected.bodyText, variables)}</p>
                {/* Um template com botão não é só uma mensagem: é a única saída
                    de um toque para o cliente responder e reabrir a conversa. */}
                {(selected.buttons || []).map((texto) => (
                  <div key={texto} className="te-botao-previa">{texto}</div>
                ))}
                {(selected.buttons || []).length > 0 && (
                  <p className="mc-ajuda">Se o cliente tocar num botão, a resposta chega no chat e reabre a janela de 24h.</p>
                )}
              </div>
              {selected.variableCount > 0 && (
                <div className="te-variaveis">
                  {variables.map((valor, i) => (
                    <div key={i} className="mc-campo">
                      <label htmlFor={`template-var-${i}`} className="mc-rotulo">Variável {i + 1}</label>
                      <input
                        id={`template-var-${i}`}
                        value={valor}
                        onChange={(e) => setVariables(variables.map((v, j) => (j === i ? e.target.value : v)))}
                        className="mc-entrada"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            status === 'ready' && templates.length > 0 && <p className="te-previa-vazia">Escolha um template para ver a prévia.</p>
          )}
        </div>
      </div>

      {/* Falhar ao enviar template era MUDO: sem role, ninguem e avisado. Fica
          fora do corpo que rola, logo acima do "Enviar" (A5-5). */}
      {error && <p role="alert" className="mc-erro">{error}</p>}
      <div className="mc-rodape">
        <p className="mc-nota">{falta || ''}</p>
        <div className="mc-acoes">
          <button type="button" onClick={onClose} className="mc-botao">Cancelar</button>
          <button type="button" onClick={enviar} disabled={!pronto || sending} className="mc-botao is-principal">
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </DialogoClaro>
  );
}

export default SendTemplateModal;
