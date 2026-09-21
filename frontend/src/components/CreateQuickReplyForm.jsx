import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createQuickReply } from '../services/api';
import { Button } from './ui';
import { descreverErro } from '../utils/errorMessages';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-focus-ring/40';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

function CreateQuickReplyForm({ onCreated, onCancel }) {
  const { token } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createQuickReply({ title, content }, token);
      setTitle('');
      setContent('');
      onCreated();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao cadastrar resposta rápida'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="settings-open-form space-y-3 border-t border-white/[0.09] px-0 pb-4 pt-4"
    >
      <h3 className="font-display text-base font-semibold text-wa-text">Cadastrar nova resposta rápida</h3>
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
      <div>
        <label htmlFor="quick-reply-title" className={labelClass}>
          Título
        </label>
        <input
          id="quick-reply-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="quick-reply-content" className={labelClass}>
          Mensagem
        </label>
        <textarea
          id="quick-reply-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className={`${inputClass} min-h-[72px] max-h-56 resize-y [field-sizing:content]`}
          required
        />
      </div>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={submitting}>
          Cadastrar
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

export default CreateQuickReplyForm;
