import { Button } from './ui';
// Nomes de ferramenta que mudam algo no mundo (ou custam dinheiro) e por isso
// merecem aviso explícito ao atendente. Consultas ficam de fora: são leitura.
const ROTULO_ACAO = {
  desbloqueio_confianca: 'Liberação em confiança executada no SGP',
  gerar_pix: 'Código PIX gerado',
  gerar_segunda_via: 'Segunda via de boleto gerada',
  transferir_atendimento: 'Atendimento transferido de setor',
  definir_motivo_atendimento: 'Motivo do atendimento registrado',
};

// A MESMA ferramenta, do outro lado do gate de aprovação humana: a IA pediu e
// não aconteceu. Rótulos próprios porque os de cima estão todos no passado
// ("executada", "gerado") — reusá-los aqui afirmaria à atendente exatamente o
// que o gate impediu de acontecer.
const ROTULO_PROPOSTA = {
  desbloqueio_confianca: 'Liberar em confiança no SGP',
  gerar_pix: 'Gerar código PIX',
  gerar_segunda_via: 'Gerar segunda via de boleto',
  transferir_atendimento: 'Transferir o atendimento de setor',
  definir_motivo_atendimento: 'Registrar o motivo do atendimento',
  encerrar_atendimento: 'Encerrar o atendimento',
  esquecer_identificacao: 'Apagar a identificação do cliente',
  concluir_triagem: 'Concluir a triagem',
};

// Ferramenta nova, ainda sem rótulo aqui, NÃO pode sumir da tela: o gate barra
// por classificação, então o catálogo do frontend sempre vai ficar para trás.
// Sumir em silêncio é o defeito, não o texto feio.
function rotuloDaProposta(nome) {
  return ROTULO_PROPOSTA[nome] || `Executar ${nome}`;
}

function AiSuggestionCard({ suggestion, onSend, onEdit, onDiscard }) {
  if (!suggestion) return null;
  const acoes = (suggestion.acoesExecutadas || []).filter((nome) => ROTULO_ACAO[nome]);
  const propostas = suggestion.acoesPropostas || [];
  return (
    <div className="chat-ai-suggestion mx-3 mb-2 rounded-2xl border border-wa-border bg-wa-field p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-wa-muted">Sugestão da IA</p>
      {acoes.length > 0 && (
        <ul className="mb-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-wa-text">
          {acoes.map((nome) => (
            <li key={nome}>⚠ {ROTULO_ACAO[nome]}</li>
          ))}
        </ul>
      )}
      {propostas.length > 0 && (
        <div className="mb-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs text-wa-text">
          <p className="mb-1 font-medium">A IA propôs e NÃO executou — depende de você:</p>
          <ul>
            {propostas.map((nome) => (
              <li key={nome}>• {rotuloDaProposta(nome)}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mb-3 whitespace-pre-wrap text-sm text-wa-text">{suggestion.content}</p>
      <div className="flex gap-2">
        {/* Eram tres <button> a mao, com o mesmo px-3 py-1.5 do `sm` e NENHUM
            hover, foco ou disabled — o unico botao de acento solido do produto
            sem estado de hover. O padding e a altura nao mudam. */}
        <Button size="sm" onClick={() => onSend(suggestion)}>Enviar</Button>
        <Button size="sm" variant="secondary" onClick={() => onEdit(suggestion)}>Editar</Button>
        <Button size="sm" variant="ghost" onClick={() => onDiscard(suggestion)}>Descartar</Button>
      </div>
    </div>
  );
}

export default AiSuggestionCard;
