import { Button } from './Button';

function Skeleton({ lines }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5 py-2">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} aria-hidden="true" className="block h-[14px] animate-pulse rounded-full bg-white/[0.08]" style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function AsyncState({ status, error, isEmpty = false, emptyMessage = 'Nada por aqui ainda.', onRetry, skeletonLines = 3, children }) {
  if (status === 'loading') return <Skeleton lines={skeletonLines} />;
  if (status === 'forbidden') {
    return <p className="rounded-[12px] bg-wa-warn-bg px-3 py-2.5 text-[13.5px] text-wa-warn-text">Você não tem permissão para ver esta lista.</p>;
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">
        <span>{error || 'Não foi possível carregar.'}</span>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="!py-1.5">
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }
  if (isEmpty) return <p className="py-4 text-[14px] text-wa-muted">{emptyMessage}</p>;
  return children;
}
