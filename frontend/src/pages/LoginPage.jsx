import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function SignalMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className="h-6 w-6 text-chat-orange"
      aria-hidden="true"
    >
      <circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <path d="M6 14a4 4 0 0 1 4 4" />
      <path d="M6 10a8 8 0 0 1 8 8" />
      <path d="M6 6a12 12 0 0 1 12 12" />
    </svg>
  );
}

const FIELD_CLASS =
  'h-[48px] w-full rounded-[14px] border border-white/[0.10] bg-white/[0.06] px-4 text-[15px] text-chat-text outline-none transition placeholder:text-chat-faint focus:border-chat-orange/60 focus:bg-white/[0.10]';

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao entrar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="chat-theme relative flex min-h-dvh items-center justify-center overflow-hidden bg-chat-canvas px-4 py-10 font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[40rem] w-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-chat-copper/50 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[18%] -right-[6%] h-[28rem] w-[30rem] rounded-full bg-chat-copper/30 blur-[150px]"
      />

      <div className="relative w-full max-w-sm animate-login-rise">
        <div className="relative overflow-hidden rounded-[28px] border border-white/[0.10] bg-white/[0.10] p-8 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)] backdrop-blur-2xl sm:p-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-chat-orange/60 to-transparent"
          />
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08]">
              <SignalMark />
            </span>
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
              DW Telecom
            </h1>
            <p className="mt-1.5 text-[14px] text-chat-muted">Painel de atendimento</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-chat-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-chat-muted">
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-[48px] w-full rounded-[14px] bg-chat-orange text-[15px] font-medium text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12.5px] text-chat-faint">
          Acesso restrito à equipe de atendimento da DW Telecom.
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
