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
      className="h-5 w-5 text-teal-signal"
      aria-hidden="true"
    >
      <circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <path d="M6 14a4 4 0 0 1 4 4" />
      <path d="M6 10a8 8 0 0 1 8 8" />
      <path d="M6 6a12 12 0 0 1 12 12" />
    </svg>
  );
}

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-ink-950 via-ink-900 to-ink-800 px-4 py-10 font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-signal/20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -bottom-24 h-96 w-96 rounded-full bg-amber-signal/20 blur-[120px]"
      />

      <div className="relative w-full max-w-sm animate-login-rise">
        <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.08] p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:p-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent"
          />
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-signal/30 bg-teal-signal/10">
              <SignalMark />
            </span>
            <h1 className="font-display text-xl font-semibold text-white">DW Telecom</h1>
            <p className="mt-1 text-sm text-white/55">Painel de atendimento</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-white/75">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 text-white placeholder-white/30 outline-none transition focus:border-teal-signal/60 focus:bg-white/10 focus:ring-2 focus:ring-teal-signal/30"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-white/75">
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 text-white placeholder-white/30 outline-none transition focus:border-teal-signal/60 focus:bg-white/10 focus:ring-2 focus:ring-teal-signal/30"
                required
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
