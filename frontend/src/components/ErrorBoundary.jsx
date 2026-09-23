import { Component } from 'react';

/**
 * Tela de falha da raiz. Sem ela, uma exceção no primeiro render deixa #root
 * VAZIO: tela branca, sem uma palavra, em qualquer navegador — e sem console
 * remoto (celular, máquina do escritório) não há como saber o que aconteceu.
 *
 * TRÊS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. ESTILO EM ATRIBUTO, não classe utilitária. Esta tela aparece justamente
 *    quando algo grande quebrou — e a folha de estilo é uma das coisas que pode
 *    ter quebrado ou nem ter carregado. Uma tela de erro pintada com classes
 *    que dependem daquele CSS seria invisível exatamente quando é necessária.
 *    Por isso nada aqui depende de nada: nem de CSS, nem de ícone, nem de
 *    componente de UI, nem de contexto, nem de tradução.
 *
 * 2. A FRASE HUMANA APARECE SEMPRE; O TÉCNICO FICA A UM TOQUE. Quem está do
 *    outro lado é atendente, não desenvolvedor: abrir com uma pilha de stack
 *    não ajuda ninguém e assusta. Mas tela branca é pior que mensagem feia, e
 *    esconder o erro de quem PRECISA dele foi o que nos deixou sem diagnóstico.
 *    Então o erro nunca some — só não é a primeira coisa.
 *
 * 3. TEM BOTÃO DE COPIAR. Selecionar stack à mão num celular é sofrimento, e
 *    é assim que o relato chega a quem vai corrigir. O copiar é best-effort e
 *    NUNCA pode lançar: uma tela de erro que quebra ao ser usada é pior do que
 *    não ter tela de erro. Sem a API de área de transferência, o texto continua
 *    lá para seleção manual.
 *
 * Nada aqui carrega marca: o sistema é vendido a outros provedores.
 */

const COR_TEXTO = '#1f2933';
const COR_APOIO = '#52606d';
const COR_BORDA = '#cbd2d9';

const ESTILO = {
  pagina: {
    minHeight: '100vh',
    boxSizing: 'border-box',
    padding: '24px 16px',
    margin: 0,
    background: '#ffffff',
    color: COR_TEXTO,
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    fontSize: '15px',
    lineHeight: 1.5,
  },
  caixa: { maxWidth: '640px', margin: '0 auto' },
  titulo: { fontSize: '19px', fontWeight: 600, margin: '0 0 8px' },
  apoio: { color: COR_APOIO, margin: '0 0 20px' },
  acoes: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' },
  botao: {
    // 44px é o alvo de toque confortável no celular, que é onde esta tela
    // costuma aparecer para quem não tem como abrir um console.
    minHeight: '44px',
    padding: '10px 16px',
    borderRadius: '8px',
    border: `1px solid ${COR_BORDA}`,
    background: '#f5f7fa',
    color: COR_TEXTO,
    fontSize: '15px',
    cursor: 'pointer',
  },
  detalhe: {
    border: `1px solid ${COR_BORDA}`,
    borderRadius: '8px',
    padding: '12px',
    background: '#f5f7fa',
  },
  resumo: { cursor: 'pointer', fontWeight: 500 },
  // `pre` sem quebra de linha vira rolagem horizontal infinita no celular.
  pilha: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    margin: '12px 0 0',
    color: COR_TEXTO,
  },
};

export function descreverErro(error, info) {
  const partes = [];
  partes.push(String((error && (error.stack || error.message)) || error || 'Erro desconhecido'));
  if (info && info.componentStack) partes.push(`Componente:${info.componentStack}`);
  // Qual navegador e qual versão: é a primeira pergunta de qualquer suporte, e
  // quem está com o problema raramente sabe responder.
  try {
    partes.push(`Navegador: ${navigator.userAgent}`);
  } catch {
    /* sem userAgent, o resto do relato continua valendo */
  }
  return partes.join('\n\n');
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { texto: null, copiado: false };
  }

  static getDerivedStateFromError(error) {
    return { texto: descreverErro(error, null), copiado: false };
  }

  componentDidCatch(error, info) {
    // O console serve a quem TEM console; a tela serve a quem não tem.
    console.error('Falha não tratada na aplicação', error, info);
    this.setState({ texto: descreverErro(error, info) });
  }

  copiar = () => {
    const { texto } = this.state;
    try {
      // `navigator.clipboard` não existe fora de contexto seguro nem em
      // navegador antigo. Falhar aqui não pode derrubar a tela de erro.
      navigator.clipboard.writeText(texto).then(
        () => this.setState({ copiado: true }),
        () => this.setState({ copiado: false })
      );
    } catch {
      this.setState({ copiado: false });
    }
  };

  recarregar = () => {
    try {
      window.location.reload();
    } catch {
      /* sem reload programático, resta o botão do próprio navegador */
    }
  };

  render() {
    const { texto, copiado } = this.state;
    if (!texto) return this.props.children;

    return (
      <div style={ESTILO.pagina} role="alert">
        <div style={ESTILO.caixa}>
          <h1 style={ESTILO.titulo}>Não foi possível abrir o atendimento</h1>
          <p style={ESTILO.apoio}>
            Algo falhou ao carregar esta página. Tente novamente; se continuar, abra os detalhes e envie o texto para
            quem cuida do sistema.
          </p>

          <div style={ESTILO.acoes}>
            <button type="button" style={ESTILO.botao} onClick={this.recarregar}>
              Tentar de novo
            </button>
            <button type="button" style={ESTILO.botao} onClick={this.copiar}>
              {copiado ? 'Copiado' : 'Copiar detalhes'}
            </button>
          </div>

          <details style={ESTILO.detalhe}>
            <summary style={ESTILO.resumo}>Ver detalhes técnicos</summary>
            <pre style={ESTILO.pilha}>{texto}</pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
