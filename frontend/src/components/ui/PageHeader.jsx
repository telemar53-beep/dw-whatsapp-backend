import { Link } from 'react-router-dom';

export function PageHeader({ title, description, action, crumbs = [] }) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 px-2 pb-4 pt-2">
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <nav aria-label="Você está em" className="mb-1 flex flex-wrap items-center gap-1 text-[12.5px] text-chat-faint">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-chat-text hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                {index < crumbs.length - 1 && <span aria-hidden="true">›</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">{title}</h1>
        {description && <p className="mt-1.5 text-[14px] text-chat-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
