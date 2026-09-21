import { useId } from 'react';
import { ScopeBadge } from './ScopeBadge';

const TONES = {
  default: 'border-wa-surface-line bg-wa-surface',
  warn: 'border-wa-warn-text/40 bg-wa-warn-bg',
};

export function Card({ title, description, scope, scopeDetail, footer, tone = 'default', className = '', children, as: Tag = 'section', ...rest }) {
  const headingId = useId();
  return (
    <Tag
      aria-labelledby={title ? headingId : undefined}
      className={`settings-section rounded-[16px] border p-3.5 sm:p-4 ${TONES[tone] || TONES.default} ${className}`}
      {...rest}
    >
      {(title || scope) && (
        <div className="settings-section-head mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[14rem]">
            {title && (
              <h2 id={headingId} className="font-display text-[16px] font-semibold leading-[22px] text-wa-text">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 max-w-[70ch] text-[13.5px] leading-[19px] text-wa-muted">{description}</p>}
          </div>
          {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
        </div>
      )}
      <div className="settings-section-body space-y-3">{children}</div>
      {footer && <div className="settings-section-foot mt-3 flex flex-wrap items-center gap-2 border-t border-wa-border pt-3">{footer}</div>}
    </Tag>
  );
}
