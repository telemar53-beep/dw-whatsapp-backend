// Ícones do painel de consulta ao SGP: meios de pagamento e blocos de dados.
function Svg({ size = 24, viewBox = '0 0 24 24', className, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconPix(props) {
  return (
    <Svg {...props}>
      <path d="M12 2.4l4 4-4 4-4-4z" />
      <path d="M17.6 8l4 4-4 4-4-4z" />
      <path d="M12 13.6l4 4-4 4-4-4z" />
      <path d="M6.4 8l4 4-4 4-4-4z" />
    </Svg>
  );
}

export function IconBarcode(props) {
  return (
    <Svg {...props}>
      <path d="M2 5h2.2v14H2zM5.6 5h1.2v14H5.6zM8.2 5h2.2v14H8.2zM11.8 5h1.2v14h-1.2zM14.4 5h2.4v14h-2.4zM18.2 5h1.2v14h-1.2zM20.6 5H22v14h-1.4z" />
    </Svg>
  );
}

export function IconQrCode(props) {
  return (
    <Svg {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="3" y="3" width="7" height="7" rx="1.2" />
        <rect x="14" y="3" width="7" height="7" rx="1.2" />
        <rect x="3" y="14" width="7" height="7" rx="1.2" />
      </g>
      <g fill="currentColor">
        <rect x="5.6" y="5.6" width="1.8" height="1.8" />
        <rect x="16.6" y="5.6" width="1.8" height="1.8" />
        <rect x="5.6" y="16.6" width="1.8" height="1.8" />
        <rect x="14" y="14" width="3" height="3" rx=".5" />
        <rect x="18.6" y="14" width="2.4" height="2" rx=".5" />
        <rect x="19" y="17.6" width="2" height="3.4" rx=".5" />
        <rect x="14" y="18.6" width="3" height="2.4" rx=".5" />
      </g>
    </Svg>
  );
}

export function IconPdfFile(props) {
  return (
    <Svg {...props}>
      <path d="M6.5 2h7L19 7.5V20a2 2 0 01-2 2H6.5a2 2 0 01-2-2V4a2 2 0 012-2z" opacity=".22" />
      <path d="M13.5 2L19 7.5h-5.5z" />
      <rect x="3.2" y="12.4" width="14.4" height="7" rx="1.4" />
      <path
        d="M6.1 17.9v-4h1.5c.9 0 1.4.5 1.4 1.3s-.5 1.3-1.4 1.3h-.6v1.4zm.9-2.1h.5c.4 0 .6-.2.6-.6s-.2-.6-.6-.6H7zm3 2.1v-4h1.4c1.2 0 1.9.8 1.9 2s-.7 2-1.9 2zm.9-.8h.4c.7 0 1-.4 1-1.2s-.3-1.2-1-1.2h-.4zm3.9.8v-4h2.5v.8h-1.6v.8h1.4v.8h-1.4v1.6z"
        fill="#fff"
      />
    </Svg>
  );
}

export function IconInvoiceLink(props) {
  return (
    <Svg {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M10.3 13.7a4.6 4.6 0 006.5 0l2.4-2.4a4.6 4.6 0 00-6.5-6.5l-1.3 1.3" />
        <path d="M13.7 10.3a4.6 4.6 0 00-6.5 0l-2.4 2.4a4.6 4.6 0 006.5 6.5l1.3-1.3" />
      </g>
    </Svg>
  );
}

export function IconIdCard(props) {
  return (
    <Svg {...props}>
      <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM8.5 7.6a2.3 2.3 0 110 4.6 2.3 2.3 0 010-4.6zM13 16.8H4v-.7c0-1.5 3-2.3 4.5-2.3s4.5.8 4.5 2.3zM20 15h-5v-1.8h5zm0-3.4h-5V9.8h5zm0-3.4h-5V6.4h5z" />
    </Svg>
  );
}

export function IconInvoice(props) {
  return (
    <Svg {...props}>
      <path d="M5.5 2h13a1 1 0 011 1v18.2l-2.6-1.6-2.6 1.6-2.6-1.6-2.6 1.6-2.6-1.6L4.5 21V3a1 1 0 011-1zm2 5.2v1.8h9V7.2zm0 4v1.8h9v-1.8zm0 4v1.8h6v-1.8z" />
    </Svg>
  );
}

export function IconClose(props) {
  return (
    <Svg {...props}>
      <path d="M19.1 6.3l-1.4-1.4-5.7 5.7-5.7-5.7-1.4 1.4 5.7 5.7-5.7 5.7 1.4 1.4 5.7-5.7 5.7 5.7 1.4-1.4-5.7-5.7z" />
    </Svg>
  );
}

export function IconSpinner({ size = 24, className = '', ...rest }) {
  return (
    <Svg size={size} className={`motion-safe:animate-spin ${className}`} {...rest}>
      <path d="M12 3a9 9 0 109 9h-2.2A6.8 6.8 0 1112 5.2z" />
    </Svg>
  );
}

export function IconCheck(props) {
  return (
    <Svg {...props}>
      <path d="M9.6 16.9L4.8 12l1.5-1.5 3.3 3.3 8-8L19.1 7.3z" />
    </Svg>
  );
}
