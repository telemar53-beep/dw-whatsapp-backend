// Ações do canal no detalhe (Fatia S2, primeiro mockup), separadas pela
// gravidade — sem caixa dentro de caixa:
// - Organização: renomear e ocultar/reexibir, que não apagam nada;
// - Ações permanentes: migrar para Meta Cloud (não num canal que já é Meta
//   Cloud) e excluir, a única destrutiva, em vermelho.
// Cada botão só pede; quem confirma e executa é useChannelActions.
export function AcoesDoCanal({ channel, ocupado, onRenomear, onOcultar, onMigrar, onExcluir }) {
  const meta = channel.type === 'meta_cloud';
  return (
    <section aria-labelledby="cfg-acoes-titulo" className="cfg-secao cfg-secao-acoes">
      <h2 id="cfg-acoes-titulo" className="cfg-visualmente-oculto">Ações do canal</h2>

      <div role="group" aria-labelledby="cfg-acoes-organizacao" className="cfg-grupo-acoes">
        <div className="cfg-grupo-acoes-texto">
          <h3 id="cfg-acoes-organizacao">Organização</h3>
          {channel.hidden ? (
            <p>
              <span>Este canal está oculto da lista.</span> Reexiba para ele voltar aos números conectados.
            </p>
          ) : (
            <p>Renomeie ou retire este canal da lista sem apagar o histórico.</p>
          )}
        </div>
        <div className="cfg-grupo-acoes-botoes">
          <button type="button" className="cfg-botao" onClick={onRenomear} disabled={ocupado}>Renomear</button>
          <button type="button" className="cfg-botao" onClick={onOcultar} disabled={ocupado}>
            {channel.hidden ? 'Reexibir na lista' : 'Ocultar na lista'}
          </button>
        </div>
      </div>

      <div role="group" aria-labelledby="cfg-acoes-permanentes" className="cfg-grupo-acoes is-permanente">
        <div className="cfg-grupo-acoes-texto">
          <h3 id="cfg-acoes-permanentes">Ações permanentes</h3>
          <p>
            {meta
              ? 'Excluir remove de vez um canal que nunca teve atendimentos.'
              : 'Migrar troca o provedor deste número sem perder o histórico; excluir remove de vez um canal que nunca teve atendimentos.'}
          </p>
        </div>
        <div className="cfg-grupo-acoes-botoes">
          {!meta && (
            <button type="button" className="cfg-botao" onClick={onMigrar} disabled={ocupado}>Migrar para Meta Cloud</button>
          )}
          <button type="button" className="cfg-botao is-perigo" onClick={onExcluir} disabled={ocupado}>Excluir canal</button>
        </div>
      </div>
    </section>
  );
}
