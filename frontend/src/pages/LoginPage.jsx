import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCompanyName } from '../hooks/useCompanyName';

function SignalMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className="h-6 w-6 text-[#f29a58]"
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
  'h-12 w-full rounded-xl border border-white/[0.13] bg-[#222a30] px-4 text-[15px] text-white outline-none transition-colors placeholder:text-[#aeb8c0] hover:border-white/25 focus:border-[#f29a58] focus:ring-2 focus:ring-[#f29a58]/25';

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // O nome da empresa vem da rota pública: aqui ainda não existe token. Sem
  // nome cadastrado (ou com a rota fora do ar) a tela continua de pé.
  const { name: companyName, status: companyNameStatus } = useCompanyName();

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
    <div className="chat-theme relative isolate flex min-h-dvh overflow-hidden bg-[#20272d] px-4 py-6 font-sans text-chat-text sm:px-8 lg:px-12">
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[32rem] w-[32rem] rounded-full bg-[#f18442]/[0.08] blur-[110px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 right-[-12rem] h-[35rem] w-[35rem] rounded-full bg-[#8296a4]/[0.08] blur-[120px]" />

      <div className="relative mx-auto grid w-full max-w-[1360px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(400px,480px)] lg:gap-16">
        <section className="hidden max-w-[620px] flex-col items-start lg:flex" aria-label="Apresentação do atendimento">
          <div className="mb-16 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#d7dfe4]">
            <span className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#f29a58]/30 bg-[#f29a58]/10">
              <SignalMark />
            </span>
            Plataforma de atendimento
          </div>
          <span className="mb-6 h-1 w-14 rounded-full bg-[#f29a58]" aria-hidden="true" />
          <p className="max-w-[13ch] font-display text-[clamp(2.6rem,4vw,4.25rem)] font-semibold leading-[1.12] tracking-[-0.045em] text-[#f4f6f7]">
            Um lugar claro para cada conversa.
          </p>
          <p className="mt-7 max-w-[43ch] text-[17px] leading-7 text-[#b9c3ca]">
            Entre no painel e continue seus atendimentos com o contexto de que precisa para trabalhar bem.
          </p>
          <div className="mt-14 flex items-center gap-3 text-[13px] font-medium text-[#b9c3ca]">
            <span className="rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-2">Conversas</span>
            <span className="rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-2">Contexto</span>
            <span className="rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-2">Equipe</span>
          </div>
        </section>

        <main className="w-full animate-login-rise">
          <div className="rounded-[22px] border border-white/[0.12] bg-[#2b333a]/95 px-6 py-8 shadow-[0_28px_70px_-30px_rgba(0,0,0,0.65)] backdrop-blur-md sm:px-10 sm:py-10">
            <div className="mb-8">
              <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-[13px] border border-[#f29a58]/25 bg-[#f29a58]/10 lg:hidden">
                <SignalMark />
              </span>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f5a366]">Acesso à plataforma</p>
              <h1 className="font-display text-[clamp(1.55rem,3vw,2rem)] font-semibold leading-tight tracking-[-0.025em] text-[#f5f7f8]">
                {companyNameStatus === 'loading' ? '' : companyName || 'Atendimento'}
              </h1>
              <p className="mt-3 text-[14px] leading-6 text-[#bdc6cd]">Entre com seu email e senha para continuar.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" aria-busy={submitting}>
              <div>
                <label htmlFor="email" className="mb-2 block text-[13px] font-medium text-[#e5eaed]">Email</label>
                <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD_CLASS} required />
              </div>
              <div>
                <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-[#e5eaed]">Senha</label>
                <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD_CLASS} required />
              </div>

              {error && <p role="alert" className="rounded-xl border border-[#ef8f85]/25 bg-[#b94237]/15 px-3 py-2.5 text-[13.5px] leading-5 text-[#ffb2a9]">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 flex h-12 w-full items-center justify-center rounded-xl bg-[#f28c45] text-[15px] font-semibold text-[#201c19] shadow-[0_8px_20px_-12px_rgba(242,140,69,0.8)] transition-colors hover:bg-[#ffa260] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffbd8d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </div>

          <p className="mt-5 px-2 text-center text-[12px] leading-5 text-[#aeb9c1]">
            {companyName
              ? `Acesso restrito à equipe de atendimento da ${companyName}.`
              : 'Acesso restrito à equipe de atendimento.'}
          </p>
        </main>
      </div>
    </div>
  );
}

export default LoginPage;
