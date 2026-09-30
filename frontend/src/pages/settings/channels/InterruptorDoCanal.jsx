import { useEffect, useId, useRef, useState } from 'react';

// Interruptor de automação do canal (aba Atendimento, Fatia S2).
//
// Antes o controle ficava igual durante o envio, aceitava um segundo clique e,
// na falha, o erro ia para o topo da aba. Agora:
// - ao clicar, mostra o valor novo e "Salvando…", e não aceita outro clique
//   até a resposta (aria-disabled: o foco fica nele);
// - deu certo: a releitura do canal confirma o valor;
// - falhou: volta ao valor de antes e o motivo aparece nesta linha.
// Indisponível de verdade (falta a IA, falta a janela), fica `disabled`, com o
// motivo à vista.
export function InterruptorDoCanal({ rotulo, descricao, ligado, indisponivel = false, motivo, onAlterar }) {
  const id = useId();
  const [pendente, setPendente] = useState(false);
  const [otimista, setOtimista] = useState(null);
  const [erro, setErro] = useState(null);
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);

  const valor = otimista === null ? Boolean(ligado) : otimista;

  async function alternar() {
    if (pendente || indisponivel) return;
    const novo = !valor;
    setPendente(true);
    setOtimista(novo);
    setErro(null);
    try {
      await onAlterar(novo);
    } catch (falha) {
      if (montado.current) setErro(falha.message);
    } finally {
      if (montado.current) {
        setPendente(false);
        setOtimista(null);
      }
    }
  }

  return (
    <div className="cfg-interruptor" aria-busy={pendente ? 'true' : undefined}>
      <div className="cfg-interruptor-texto">
        <strong id={`${id}-rotulo`}>{rotulo}</strong>
        {descricao && <span id={`${id}-descricao`}>{descricao}</span>}
        {indisponivel && motivo && <span className="cfg-interruptor-motivo">{motivo}</span>}
        {pendente && <span className="cfg-interruptor-salvando">Salvando…</span>}
        {erro && <span role="alert" className="cfg-interruptor-erro">{erro}</span>}
      </div>
      <button
        type="button"
        role="switch"
        className="cfg-chave"
        aria-checked={valor}
        aria-labelledby={`${id}-rotulo`}
        aria-describedby={descricao ? `${id}-descricao` : undefined}
        aria-disabled={pendente ? 'true' : undefined}
        disabled={indisponivel && !pendente}
        onClick={alternar}
      />
    </div>
  );
}
