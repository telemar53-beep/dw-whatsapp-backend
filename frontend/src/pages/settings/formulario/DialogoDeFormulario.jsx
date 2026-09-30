import './dialogo-de-formulario.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DialogoClaro } from '../../../components/ui/DialogoClaro';
import { mensagemSegura } from './mensagemSegura';

// Diálogo de formulário de Configurações (Fatia S3), sobre a moldura clara do
// Bloco 1. Vale só para os cadastros desta área que o usam; o WaDialog e os
// diálogos das outras partes do sistema não mudam.
//
// Antes do envio, Fechar, Cancelar e Escape descartam o formulário como antes,
// e o clique fora continua sem descartar (um formulário preenchido não some
// por um clique perdido).
//
// Durante o envio:
// - a ação diz o que está acontecendo ("Adicionando…") e continua focável
//   (aria-disabled; desativada, jogaria o foco no <body>);
// - uma trava de verdade impede o segundo envio (clique, Enter);
// - Fechar, Cancelar, Escape e o clique fora ficam presos, e o diálogo não
//   desmonta até a resposta: nada é gravado sem que a pessoa veja o fim;
// - os campos ficam desativados e o diálogo, aria-busy.
//
// Na falha, os dados ficam, a mensagem é segura e em português, e o foco vai
// para o campo que precisa de ajuste (ErroDoFormulario) ou para "Tentar
// novamente". No sucesso, quem usa fecha (onConcluido) e a moldura devolve o
// foco a quem abriu. Resposta que chegue depois de a página sair é ignorada.
export class ErroDoFormulario extends Error {
  constructor(mensagem, campo = null) {
    super(mensagem);
    this.name = 'ErroDoFormulario';
    this.campo = campo;
  }
}

const TRAVA = 'Fechar, Cancelar e Escape estão bloqueados.';

export function DialogoDeFormulario({
  titulo,
  descricao,
  acao,
  andamento,
  erroPadrao,
  onEnviar,
  onConcluido,
  onClose,
  enviarDesativado = false,
  className = '',
  children,
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [tentou, setTentou] = useState(false);
  const emCurso = useRef(false);
  const vivo = useRef(true);
  const formRef = useRef(null);
  const enviarRef = useRef(null);
  const focoDepois = useRef(null);

  useEffect(() => () => { vivo.current = false; }, []);

  useLayoutEffect(() => {
    const painel = formRef.current && formRef.current.closest('[role=dialog]');
    if (!painel) return;
    if (enviando) painel.setAttribute('aria-busy', 'true');
    else painel.removeAttribute('aria-busy');
  }, [enviando]);

  // O foco da falha só pode ir ao campo depois que ele deixa de estar desativado.
  useEffect(() => {
    if (enviando || !focoDepois.current) return;
    const alvo = focoDepois.current === 'enviar' ? enviarRef.current : document.getElementById(focoDepois.current);
    focoDepois.current = null;
    if (alvo && typeof alvo.focus === 'function') alvo.focus();
  }, [enviando, erro]);

  async function enviar(evento) {
    evento.preventDefault();
    if (emCurso.current || enviarDesativado) return;
    emCurso.current = true;
    if (enviarRef.current) enviarRef.current.focus();
    setErro(null);
    setEnviando(true);
    try {
      await onEnviar();
      if (!vivo.current) return;
      emCurso.current = false;
      onConcluido();
      if (vivo.current) setEnviando(false);
    } catch (falha) {
      if (!vivo.current) return;
      emCurso.current = false;
      const deCampo = falha instanceof ErroDoFormulario;
      setErro(deCampo ? falha.message : mensagemSegura(falha, erroPadrao));
      focoDepois.current = deCampo && falha.campo ? falha.campo : 'enviar';
      setTentou(true);
      setEnviando(false);
    }
  }

  function fechar() {
    if (emCurso.current) return;
    onClose();
  }

  const textoDaDescricao = enviando ? 'Aguarde a confirmação antes de sair.' : erro ? 'Revise os dados e tente novamente.' : descricao;

  return (
    <DialogoClaro
      variant="formulario"
      titulo={titulo}
      descricao={textoDaDescricao}
      onClose={fechar}
      saidaDesabilitada={enviando}
      className={`cfg-dlg-form ${className}`.trim()}
    >
      <form ref={formRef} className="cfg-dlg-form-conteudo" onSubmit={enviar}>
        <div className="mc-corpo">
          <fieldset className="cfg-dlg-campos" disabled={enviando}>
            {children}
          </fieldset>
        </div>
        {erro && <p role="alert" className="mc-erro">{erro}</p>}
        <div className="mc-rodape cfg-dlg-rodape">
          {enviando && <p className="cfg-dlg-trava">{TRAVA}</p>}
          <div className="mc-acoes">
            <button type="button" className="mc-botao" onClick={fechar} disabled={enviando}>Cancelar</button>
            <button
              type="submit"
              ref={enviarRef}
              className="mc-botao is-principal"
              aria-disabled={enviando ? 'true' : undefined}
              disabled={!enviando && enviarDesativado}
            >
              {enviando ? andamento : tentou ? 'Tentar novamente' : acao}
            </button>
          </div>
        </div>
      </form>
    </DialogoClaro>
  );
}

// Um campo com rótulo, ajuda e largura na grade (meia ou inteira).
export function CampoDoFormulario({ id, rotulo, opcional = false, ajuda, inteiro = false, children }) {
  return (
    <div className={`mc-campo cfg-dlg-campo${inteiro ? ' is-inteiro' : ''}`}>
      <label htmlFor={id} className="mc-rotulo cfg-dlg-rotulo">
        {rotulo}
        {opcional && <small>opcional</small>}
      </label>
      {children}
      {ajuda && <p className="cfg-dlg-ajuda">{ajuda}</p>}
    </div>
  );
}

// Caixa de marcar com área de toque inteira (44 px), como no mockup.
export function MarcaDoFormulario({ id, rotulo, checked, onChange }) {
  return (
    <label htmlFor={id} className="cfg-dlg-marca">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      <span>{rotulo}</span>
    </label>
  );
}
