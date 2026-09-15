import { Link } from 'react-router-dom';

const CRUMB_LINK =
  'rounded-[6px] hover:text-chat-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

export function PageHeader({ title, description, action, crumbs = [] }) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 px-2 pb-4 pt-2">
      <div className="min-w-0 flex-1 basis-[16rem]">
        {crumbs.length > 0 && (
          <nav aria-label="Você está em" className="mb-1.5 flex flex-wrap items-center gap-1 text-[12.5px] text-chat-muted">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {crumb.to ? (
                  <Link to={crumb.to} className={CRUMB_LINK}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                {index < crumbs.length - 1 && <span aria-hidden="true" className="text-chat-faint">›</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-[14px] leading-[20px] text-chat-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
