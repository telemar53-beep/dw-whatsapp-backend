import { Component, Suspense } from 'react';
import { AsyncState } from './ui';

/**
 * Embrulho de um elemento de rota carregado sob demanda: cuida do "ainda
 * chegando" e do "não chegou".
 *
 * POR QUE NÃO BASTA O ErrorBoundary DA RAIZ. Ele existe para falha de
 * inicialização e toma a tela inteira, o que é certo quando a aplicação não
 * subiu. Um trecho de página que não baixou é outra coisa: o resto — menu,
 * lista de conversas, o que já estava aberto — continua funcionando, e derrubar
 * tudo seria transformar uma falha de rede num incidente.
 *
 * POR QUE O BOTÃO RECARREGA A PÁGINA, e não só tenta montar de novo. Duas
 * razões, e a segunda é a que decide:
 *
 * 1. `React.lazy` guarda a promessa REJEITADA. Montar o mesmo componente outra
 *    vez devolve o mesmo erro, sem tocar na rede — um "tentar de novo" que não
 *    tenta nada é pior do que não ter botão.
 * 2. A causa mais comum é deploy: o nome do arquivo carrega o hash do conteúdo,
 *    e depois de uma publicação o trecho que esta aba conhece deixou de
 *    existir. Só uma recarga busca o index.html novo, com os nomes novos.
 *
 * O carregamento e o erro usam o AsyncState, que é o padrão da base — não
 * inventa um terceiro jeito de dizer "carregando" e "deu erro".
 */
class RotaLazy extends Component {
  constructor(props) {
    super(props);
    this.state = { falhou: false };
  }

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(error, info) {
    // Sem isto, um trecho que não baixa é um esqueleto que nunca sai: o
    // sintoma visível não diz nada sobre a causa.
    console.error('Falha ao carregar um trecho da aplicação', error, info);
  }

  recarregar = () => {
    try {
      window.location.reload();
    } catch {
      /* sem reload programático, resta o botão do próprio navegador */
    }
  };

  render() {
    if (this.state.falhou) {
      return (
        <AsyncState
          status="error"
          error="Não foi possível carregar esta parte do sistema. Recarregue a página para tentar de novo."
          onRetry={this.recarregar}
        />
      );
    }
    return <Suspense fallback={<AsyncState status="loading" skeletonLines={4} />}>{this.props.children}</Suspense>;
  }
}

export default RotaLazy;
