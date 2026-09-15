import { ScopeBadge } from './ScopeBadge';

const TONES = {
  default: 'border-wa-surface-line bg-wa-surface',
  warn: 'border-wa-warn-text/40 bg-wa-warn-bg',
};

export function Card({ title, description, scope, scopeDetail, footer, tone = 'default', children, as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`rounded-2xl border p-6 backdrop-blur-xl ${TONES[tone] || TONES.default}`} {...rest}>
      {(title || scope) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[16px] font-semibold text-wa-text">{title}</h2>}
            {description && <p className="mt-1 text-[13.5px] leading-[19px] text-wa-muted">{description}</p>}
          </div>
          {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
        </div>
      )}
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-wa-border pt-4">{footer}</div>}
    </Tag>
  );
}
