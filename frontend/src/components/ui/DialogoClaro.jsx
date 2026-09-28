import { useId, useSyncExternalStore } from 'react';
import { Dialog } from './Dialog';
import { IconeRecolher } from '../icones/conversa';
import './dialogo-claro.css';

// Moldura clara dos diálogos do dia a dia (Bloco 1): Confirmação, Aviso, Nossa
// equipe, Meu perfil, Nova conversa, Enviar template e Atendimentos
// encerrados. É a mesma gramática do Transferir e do Encerrar aprovados —
// papel branco, cinza muito claro, índigo só na escolha e na ação principal —
// num lugar só, em vez de uma folha inteira por diálogo.
//
// A saída é UMA: "Fechar" no cabeçalho do desktop, a seta de voltar no
// celular. Nunca as duas, e nunca o "×" da base.
//
// Este módulo mora no mesmo trecho da Confirmação e do Aviso (que toda página
// já baixa): os diálogos sob demanda o importam sem criar um trecho a mais.

// O mesmo corte de celular do Transferir, do Encerrar e do popup da
// Supervisão. Decidido aqui, e não pelo CSS: a saída muda (seta ou "Fechar"),
// o foco inicial muda (no celular o teclado não sobe sozinho) e o diálogo vai
// para a tela cheia.
const CELULAR = '(max-width: 767px)';

function assinarTela(aviso) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const consulta = window.matchMedia(CELULAR);
  consulta.addEventListener('change', aviso);
  return () => consulta.removeEventListener('change', aviso);
}

function telaDeCelular() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CELULAR).matches;
}

export function useCelular() {
  return useSyncExternalStore(assinarTela, telaDeCelular, () => false);
}

const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

// O cabeçalho da moldura clara. `rotuloVoltar` nomeia a seta do celular
// ("Voltar" por padrão; nos Encerrados, dentro da conversa, "Voltar para a
// lista"). `saidaDesabilitada` segura a saída durante um envio que não pode
// ser abandonado pela metade.
export function CabecalhoClaro({ titulo, tituloId, descricao, descricaoId, extra, celular, onSair, rotuloVoltar = 'Voltar', saidaDesabilitada = false }) {
  return (
    <div className="mc-cab">
      {celular && (
        <button type="button" className="mc-voltar" aria-label={rotuloVoltar} title={rotuloVoltar} onClick={onSair} disabled={saidaDesabilitada}>
          <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
        </button>
      )}
      <div className="mc-cab-texto">
        <h2 id={tituloId}>
          {titulo}
          {extra}
        </h2>
        {descricao && <p id={descricaoId}>{descricao}</p>}
      </div>
      {!celular && (
        <button type="button" className="mc-fechar" onClick={onSair} disabled={saidaDesabilitada}>
          Fechar
        </button>
      )}
    </div>
  );
}

// O diálogo claro com o cabeçalho padrão. O corpo, a faixa de erro e o rodapé
// vêm de quem usa (classes `mc-corpo`, `mc-erro`, `mc-rodape`): cada diálogo
// sabe o que o rodapé dele precisa dizer.
export function DialogoClaro({
  variant,
  titulo,
  descricao,
  extra,
  onClose,
  celular = false,
  rotuloVoltar,
  saidaDesabilitada = false,
  closeOnEsc = true,
  // Só quem é de leitura (Nossa equipe, Encerrados) fecha pelo fundo.
  closeOnBackdrop = false,
  initialFocus,
  className = '',
  children,
}) {
  const id = useId();
  const tituloId = `${id}-titulo`;
  const descricaoId = `${id}-descricao`;
  return (
    <Dialog
      claro
      variant={variant}
      size=""
      labelledBy={tituloId}
      describedBy={descricao ? descricaoId : undefined}
      onClose={onClose}
      dismissible={false}
      closeOnBackdrop={closeOnBackdrop && !saidaDesabilitada}
      closeOnEsc={closeOnEsc && !saidaDesabilitada}
      initialFocus={initialFocus || (celular ? 'dialog' : 'auto')}
      className={`${className}${celular ? ' is-celular' : ''}`}
    >
      <CabecalhoClaro
        titulo={titulo}
        tituloId={tituloId}
        descricao={descricao}
        descricaoId={descricaoId}
        extra={extra}
        celular={celular}
        onSair={onClose}
        rotuloVoltar={rotuloVoltar}
        saidaDesabilitada={saidaDesabilitada}
      />
      {children}
    </Dialog>
  );
}
