function AiSuggestionCard({ suggestion, onSend, onEdit, onDiscard }) {
  if (!suggestion) return null;
  return (
    <div className="mx-3 mb-2 rounded-2xl border border-wa-border bg-wa-field p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-wa-muted">Sugestão da IA</p>
      <p className="mb-3 whitespace-pre-wrap text-sm text-wa-text">{suggestion.content}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onSend(suggestion)} className="rounded-lg bg-wa-green px-3 py-1.5 text-sm font-medium text-white">Enviar</button>
        <button type="button" onClick={() => onEdit(suggestion)} className="rounded-lg border border-wa-border px-3 py-1.5 text-sm text-wa-text">Editar</button>
        <button type="button" onClick={() => onDiscard(suggestion)} className="rounded-lg px-3 py-1.5 text-sm text-wa-muted">Descartar</button>
      </div>
    </div>
  );
}

export default AiSuggestionCard;
