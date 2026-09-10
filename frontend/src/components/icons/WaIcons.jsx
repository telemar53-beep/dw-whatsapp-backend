// Ícones no traço do WhatsApp Web: 24x24, preenchidos, herdam currentColor.
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

export function IconSearch(props) {
  return (
    <Svg {...props}>
      <path d="M15.01 14.06h-.79l-.28-.27a6.47 6.47 0 001.57-4.23 6.5 6.5 0 10-6.5 6.5c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.5 19l-5.49-4.94zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z" />
    </Svg>
  );
}

export function IconNewChat(props) {
  return (
    <Svg {...props}>
      <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 110-2h6V5a1 1 0 011-1z" />
    </Svg>
  );
}

export function IconChevronDown(props) {
  return (
    <Svg {...props}>
      <path d="M12 15.4l-5.7-5.7 1.4-1.4 4.3 4.3 4.3-4.3 1.4 1.4z" />
    </Svg>
  );
}

export function IconArrowLeft(props) {
  return (
    <Svg {...props}>
      <path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" />
    </Svg>
  );
}

export function IconHistory(props) {
  return (
    <Svg {...props}>
      <path d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 16.2A7.2 7.2 0 1119.2 12 7.2 7.2 0 0112 19.2zm.9-11.7h-1.8v5.4l4.5 2.7.9-1.5-3.6-2.1z" />
    </Svg>
  );
}

export function IconTransfer(props) {
  return (
    <Svg {...props}>
      <path d="M4 7h11.2l-3.1-3.1L13.5 2.5 19 8l-5.5 5.5-1.4-1.4L15.2 9H4zm16 8H8.8l3.1 3.1-1.4 1.4L5 14l5.5-5.5 1.4 1.4L8.8 13H20z" />
    </Svg>
  );
}

export function IconCheckCircle(props) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18.2a8.2 8.2 0 118.2-8.2 8.2 8.2 0 01-8.2 8.2zm4.6-11.9l-6.2 6.2-2.9-2.9-1.3 1.3 4.2 4.2 7.5-7.5z" />
    </Svg>
  );
}

export function IconClaim(props) {
  return (
    <Svg {...props}>
      <path d="M9.6 16.6L5 12l1.4-1.4 3.2 3.2 8-8L19 7.2z" />
    </Svg>
  );
}

export function IconClose(props) {
  return (
    <Svg {...props}>
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </Svg>
  );
}

export function IconAttach(props) {
  return (
    <Svg {...props}>
      <path d="M16.5 6.8v9a4.5 4.5 0 11-9 0V6.2a3 3 0 016 0v8.9a1.5 1.5 0 11-3 0V7.3H9.2v7.8a3 3 0 006 0V6.2a4.5 4.5 0 00-9 0v9.6a6 6 0 0012 0v-9z" />
    </Svg>
  );
}

export function IconEmoji(props) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18.2a8.2 8.2 0 118.2-8.2 8.2 8.2 0 01-8.2 8.2zM8.9 10.7a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zm6.2 0a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zM12 17.4a5.2 5.2 0 004.8-3.2H7.2a5.2 5.2 0 004.8 3.2z" />
    </Svg>
  );
}

export function IconQuickReply(props) {
  return (
    <Svg {...props}>
      <path d="M12 3c-5 0-9 3.4-9 7.7 0 2.4 1.3 4.6 3.3 6-.2 1.4-.9 2.7-1.9 3.6 1.7-.1 3.3-.7 4.7-1.7 1 .3 1.9.4 2.9.4 5 0 9-3.4 9-7.7S17 3 12 3zm-3.6 9a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zm3.6 0a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zm3.6 0a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6z" />
    </Svg>
  );
}

export function IconMic(props) {
  return (
    <Svg {...props}>
      <path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5.3-3c0 3-2.5 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.4 2.7 6.2 6.1 6.7V22h1.8v-3.3c3.4-.5 6.1-3.3 6.1-6.7z" />
    </Svg>
  );
}

export function IconSend(props) {
  return (
    <Svg {...props}>
      <path d="M2.2 21L23 12 2.2 3l-.01 7L17 12 2.19 14z" />
    </Svg>
  );
}

export function IconTrash(props) {
  return (
    <Svg {...props}>
      <path d="M9.4 3h5.2l.9 1.4H19v1.8H5V4.4h3.5zM6.5 7.7h11l-.8 12.1a1.4 1.4 0 01-1.4 1.3H8.7a1.4 1.4 0 01-1.4-1.3z" />
    </Svg>
  );
}

export function IconStop(props) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  );
}

export function IconPlay(props) {
  return (
    <Svg {...props}>
      <path d="M8 5.6c0-.8.9-1.3 1.5-.9l9 6.4c.6.4.6 1.4 0 1.8l-9 6.4c-.6.4-1.5 0-1.5-.9z" />
    </Svg>
  );
}

export function IconPause(props) {
  return (
    <Svg {...props}>
      <path d="M8 5h3v14H8zm5 0h3v14h-3z" />
    </Svg>
  );
}

export function IconDownload(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v9.2l3.6-3.6 1.3 1.3-5.8 5.8-5.8-5.8 1.3-1.3 3.6 3.6V3zM5 18.2h14V20H5z" />
    </Svg>
  );
}

export function IconPin(props) {
  return (
    <Svg {...props}>
      <path d="M12 2a6.8 6.8 0 00-6.8 6.8C5.2 14 12 22 12 22s6.8-8 6.8-13.2A6.8 6.8 0 0012 2zm0 9.4a2.6 2.6 0 110-5.2 2.6 2.6 0 010 5.2z" />
    </Svg>
  );
}

export function IconLock(props) {
  return (
    <Svg {...props}>
      <path d="M17 9h-1V7a4 4 0 10-8 0v2H7a1.5 1.5 0 00-1.5 1.5v9A1.5 1.5 0 007 21h10a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0017 9zM9.8 7a2.2 2.2 0 114.4 0v2H9.8z" />
    </Svg>
  );
}

export function IconBellOn(props) {
  return (
    <Svg {...props}>
      <path d="M12 22a2.2 2.2 0 002.2-2.1H9.8A2.2 2.2 0 0012 22zm6.5-5.4v-5a6.6 6.6 0 00-5-6.4V4.4a1.5 1.5 0 00-3 0v.8a6.6 6.6 0 00-5 6.4v5L4 18.2v.9h16v-.9z" />
    </Svg>
  );
}

export function IconBellOff(props) {
  return (
    <Svg {...props}>
      <path d="M12 22a2.2 2.2 0 002.2-2.1H9.8A2.2 2.2 0 0012 22zm6.5-5.4v-5c0-.6-.1-1.2-.2-1.7L7.4 20.7v-1.6h11.1v-.9zM4.5 3.2L3.2 4.5l2.4 2.4a6.5 6.5 0 00-.6 2.7v2.1c0 2.6-.6 3.5-1.5 4.4v1.6h.3l-1.6 1.6 1.3 1.3z" />
    </Svg>
  );
}

export function IconKey(props) {
  return (
    <Svg {...props}>
      <path d="M14.5 3a6.5 6.5 0 00-6.2 8.5L3 16.8V21h4.2v-2.2h2.2v-2.2h2.2l1.3-1.3A6.5 6.5 0 1014.5 3zm2 5.5a1.7 1.7 0 110-3.4 1.7 1.7 0 010 3.4z" />
    </Svg>
  );
}

export function IconChart(props) {
  return (
    <Svg {...props}>
      <path d="M4 20V10h4v10zm6 0V4h4v16zm6 0v-7h4v7z" />
    </Svg>
  );
}

export function IconSettings(props) {
  return (
    <Svg {...props}>
      <path d="M19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-1.7-1L15 3.4H11l-.3 2.6a7.6 7.6 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 001.7 1l.3 2.6h4l.3-2.6a7.6 7.6 0 001.7-1l2.4 1 2-3.4zM13 15.6A3.6 3.6 0 1116.6 12 3.6 3.6 0 0113 15.6z" />
    </Svg>
  );
}

export function IconLogout(props) {
  return (
    <Svg {...props}>
      <path d="M10.6 15.6l1.3 1.3L16.8 12l-4.9-4.9-1.3 1.3 2.7 2.7H4v1.8h9.3zM19 3H10v1.8h9v14.4h-9V21h9a1.8 1.8 0 001.8-1.8V4.8A1.8 1.8 0 0019 3z" />
    </Svg>
  );
}

export function IconTeam(props) {
  return (
    <Svg {...props}>
      <path d="M16 11a3 3 0 100-6 3 3 0 000 6zm-8 0a3 3 0 100-6 3 3 0 000 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z" />
    </Svg>
  );
}

export function IconWarning(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.2L1.6 20.8h20.8zm.9 13.9h-1.8v-1.8h1.8zm0-3.6h-1.8V9.9h1.8z" />
    </Svg>
  );
}

export function IconEmptyChat(props) {
  return (
    <Svg viewBox="0 0 320 190" {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="34" y="18" width="196" height="126" rx="10" />
        <path d="M14 144h236l-14 22H28z" />
        <path d="M118 152h28" />
        <path d="M62 46h84M62 66h120M62 86h96" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <path d="M198 60h84a12 12 0 0112 12v46a12 12 0 01-12 12h-46l-22 18v-18h-16a12 12 0 01-12-12V72a12 12 0 0112-12z" fill="#f0f2f5" />
      </g>
      <g fill="currentColor">
        <circle cx="222" cy="95" r="6" />
        <circle cx="244" cy="95" r="6" />
        <circle cx="266" cy="95" r="6" />
      </g>
    </Svg>
  );
}

export function IconChats(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.2c-5.2 0-9.4 3.5-9.4 7.9 0 2.5 1.4 4.8 3.5 6.3-.2 1.5-1 3-2.1 4 1.9-.2 3.7-.9 5.2-2 .9.2 1.8.3 2.8.3 5.2 0 9.4-3.5 9.4-7.9S17.2 3.2 12 3.2z" />
    </Svg>
  );
}
