import { Link } from 'react-router-dom';

const CRUMB_LINK =
  'rounded-[6px] hover:text-chat-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

// O tamanho do titulo agora e declarado AQUI. Ate a Etapa 7 o componente dizia
// 26px e o CSS de area o transformava em 20px (Configuracoes) ou 22px
// (Supervisao) sem que o JSX soubesse: quem editava este arquivo nao via
// efeito, e 26px so sobrevivia em Campanhas.
//
// `padrao` e o titulo de pagina do produto. `destaque` existe porque Campanhas
// e uma tela de abertura com composicao propria, aprovada em 26px — nao e
// excecao acidental, e escolha registrada.
const TITULO = {
  padrao: 'text-[21px] leading-[28px] tracking-[-0.015em]',
  destaque: 'text-[26px] leading-tight tracking-[-0.01em]',
};

export function PageHeader({ title, description, action, crumbs = [], variant = 'padrao' }) {
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
        <h1 className={`font-display font-semibold text-chat-text ${TITULO[variant] || TITULO.padrao}`}>{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-[14px] leading-[20px] text-chat-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
