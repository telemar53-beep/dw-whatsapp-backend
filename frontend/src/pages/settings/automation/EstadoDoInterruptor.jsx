// O que acompanha um interruptor que grava na hora (Fatia S0): "Salvando…"
// enquanto o pedido está a caminho, ou o erro com "Tentar novamente" quando ele
// falhou. Sem pedido nem erro, não desenha nada — nem a moldura.
//
// `recuo` alinha o texto com o rótulo do Toggle (caixa de 16 px + 12 px de vão).
function EstadoDoInterruptor({ salvando, erro, onTentarDeNovo, recuo = false }) {
  const alinhamento = recuo ? ' pl-7' : '';
  if (salvando) {
    return <p role="status" className={`mt-1 text-[12px] leading-[17px] text-wa-muted${alinhamento}`}>Salvando…</p>;
  }
  if (!erro) return null;
  // A frase do servidor às vezes vem sem ponto final.
  const frase = /[.!?…]$/.test(erro) ? erro : `${erro}.`;
  return (
    <div role="alert" className={`mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-[17px] text-wa-error-text${alinhamento}`}>
      <span>{frase} O valor anterior foi mantido.</span>
      <button type="button" onClick={onTentarDeNovo} className="font-semibold underline underline-offset-2">
        Tentar novamente
      </button>
    </div>
  );
}

export default EstadoDoInterruptor;
