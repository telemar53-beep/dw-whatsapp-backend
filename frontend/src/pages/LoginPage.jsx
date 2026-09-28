import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCompanyName } from '../hooks/useCompanyName';
import { descreverErro, detalheTecnicoDoErro } from '../utils/errorMessages';
import './login.css';

// Os dois únicos desenhos da tela. Traço em currentColor: a cor vem do círculo.
function IconeConta() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 19.5c.9-3.3 3.8-5.25 7.25-5.25s6.35 1.95 7.25 5.25" />
    </svg>
  );
}

function IconeCadeado() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5" y="10.25" width="14" height="10" rx="2.5" />
      <path d="M8.25 10.25V7.5a3.75 3.75 0 0 1 7.5 0v2.75" />
      <path d="M12 14.5v1.75" />
    </svg>
  );
}

// A mesma regra do <input type="email"> do navegador: quem entrava antes com
// um e-mail aceito continua entrando.
const EMAIL_VALIDO =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function validar(email, senha) {
  const erros = {};
  if (!email) erros.email = 'Informe o e-mail.';
  else if (!EMAIL_VALIDO.test(email)) erros.email = 'Informe um e-mail válido.';
  if (!senha) erros.senha = 'Informe a senha.';
  return erros;
}

const SEM_CONEXAO = 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
const ERRO_DO_SERVIDOR = 'O servidor encontrou um erro. Tente de novo em instantes.';

// Nenhuma frase em inglês chega à tela: só usa a tradução que existe; sem
// tradução, decide pelo tipo de falha.
function mensagemDoLogin(erro) {
  // O fetch rejeita com TypeError quando não há resposta nenhuma (rede).
  if (erro instanceof TypeError) return SEM_CONEXAO;
  if (detalheTecnicoDoErro(erro)) return descreverErro(erro);
  const status = erro && typeof erro.status === 'number' ? erro.status : null;
  if (status === 401) return 'E-mail ou senha incorretos.';
  if (status === 429) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  // Sem status = a resposta nem pôde ser lida (uma página de erro do proxy).
  if (status === null || status >= 500) return ERRO_DO_SERVIDOR;
  return 'Não foi possível entrar. Tente de novo.';
}

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { name: nomeDaEmpresa, status: statusDoNome } = useCompanyName();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [erros, setErros] = useState({});
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  // O estado só muda no próximo render; a ref fecha a porta no mesmo instante
  // (clique duplo, Enter durante o pedido).
  const enviandoRef = useRef(false);
  const emailRef = useRef(null);
  const senhaRef = useRef(null);

  // Foco no e-mail só com mouse: no celular abriria o teclado sozinho. Uma
  // consulta na montagem, sem ouvinte.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) emailRef.current?.focus();
  }, []);

  function aoDigitarEmail(evento) {
    setEmail(evento.target.value);
    if (erros.email) setErros((atual) => ({ ...atual, email: null }));
  }

  function aoDigitarSenha(evento) {
    setSenha(evento.target.value);
    if (erros.senha) setErros((atual) => ({ ...atual, senha: null }));
  }

  function alternarSenha() {
    if (enviandoRef.current) return;
    setSenhaVisivel((visivel) => !visivel);
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    const emailLimpo = email.trim();
    const novosErros = validar(emailLimpo, senha);
    setErros(novosErros);
    setErro(null);
    if (novosErros.email) {
      emailRef.current?.focus();
      return;
    }
    if (novosErros.senha) {
      senhaRef.current?.focus();
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    // Senha oculta no envio: o gerenciador de senhas só oferece salvar campo
    // do tipo password.
    setSenhaVisivel(false);
    try {
      await login(emailLimpo, senha);
      navigate('/');
    } catch (falha) {
      setErro(mensagemDoLogin(falha));
      emailRef.current?.focus();
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const carregandoNome = statusDoNome === 'loading';
  const titulo = nomeDaEmpresa || 'Atendimento';
  // Sem nome, o título já diz "Atendimento": o rótulo repetiria a palavra.
  const mostrarRotulo = carregandoNome || Boolean(nomeDaEmpresa);

  return (
    <div className="login">
      <main className="login-modulo" aria-labelledby="login-titulo">
        <header className="login-marca">
          <h1 className="login-empresa">
            {carregandoNome ? (
              <>
                <span className="login-esqueleto" aria-hidden="true" />
                <span className="sr-only">Carregando o nome da empresa…</span>
              </>
            ) : (
              titulo
            )}
          </h1>
          {mostrarRotulo && <p className="login-rotulo">Atendimento</p>}
        </header>

        <h2 id="login-titulo" className="login-titulo">
          Entrar
        </h2>

        <form className="login-form" onSubmit={aoEnviar} noValidate aria-labelledby="login-titulo" aria-busy={enviando}>
          <div className="login-grupo">
            <label htmlFor="email" className="login-label">
              E-mail
            </label>
            <div className="login-campo" data-invalido={erros.email ? 'true' : undefined}>
              <span className="login-circulo">
                <IconeConta />
              </span>
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="nome@empresa.com.br"
                required
                readOnly={enviando}
                value={email}
                onChange={aoDigitarEmail}
                aria-invalid={erros.email ? 'true' : undefined}
                aria-describedby={erros.email ? 'email-erro' : undefined}
              />
            </div>
            {erros.email && (
              <p id="email-erro" className="login-erro-campo">
                {erros.email}
              </p>
            )}
          </div>

          <div className="login-grupo">
            <label htmlFor="password" className="login-label">
              Senha
            </label>
            <div className="login-campo" data-invalido={erros.senha ? 'true' : undefined}>
              <span className="login-circulo">
                <IconeCadeado />
              </span>
              <input
                ref={senhaRef}
                id="password"
                name="password"
                type={senhaVisivel ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                readOnly={enviando}
                value={senha}
                onChange={aoDigitarSenha}
                aria-invalid={erros.senha ? 'true' : undefined}
                aria-describedby={erros.senha ? 'senha-erro' : undefined}
              />
              <button
                type="button"
                className="login-mostrar"
                onClick={alternarSenha}
                aria-controls="password"
                aria-disabled={enviando ? 'true' : undefined}
              >
                {senhaVisivel ? 'Ocultar' : 'Mostrar'}
                <span className="sr-only"> senha</span>
              </button>
            </div>
            {erros.senha && (
              <p id="senha-erro" className="login-erro-campo">
                {erros.senha}
              </p>
            )}
          </div>

          {erro && (
            <p role="alert" className="login-erro">
              {erro}
            </p>
          )}

          <button type="submit" className="login-botao" aria-disabled={enviando ? 'true' : undefined}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </main>
    </div>
  );
}

export default LoginPage;
