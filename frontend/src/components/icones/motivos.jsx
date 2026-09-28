import { Icone } from './Icone';
import * as desenhos from './desenhosMotivos';

// Os ícones dos motivos de encerramento, num módulo à parte da família: só o
// diálogo Encerrar os importará (sob demanda), e a mesa não leva os desenhos
// deles. Nesta rodada nenhuma tela os importa ainda (aprovação visual
// primeiro).
export function IconeMotivoCancelamento(props) { return <Icone desenho={desenhos.cancelamento} {...props} />; }
export function IconeMotivoFinanceiro(props) { return <Icone desenho={desenhos.financeiro} {...props} />; }
export function IconeMotivoInstalacao(props) { return <Icone desenho={desenhos.instalacao} {...props} />; }
export function IconeMotivoMudancaDeEndereco(props) { return <Icone desenho={desenhos.mudancaDeEndereco} {...props} />; }
export function IconeMotivoMudancaDePlano(props) { return <Icone desenho={desenhos.mudancaDePlano} {...props} />; }
export function IconeMotivoReativacao(props) { return <Icone desenho={desenhos.reativacao} {...props} />; }
export function IconeMotivoResolvidoPelaIa(props) { return <Icone desenho={desenhos.resolvidoPelaIa} {...props} />; }
export function IconeMotivoSemResposta(props) { return <Icone desenho={desenhos.semResposta} {...props} />; }
export function IconeMotivoSuporteTecnico(props) { return <Icone desenho={desenhos.suporteTecnico} {...props} />; }
export function IconeMotivoTrocaDeSenha(props) { return <Icone desenho={desenhos.trocaDeSenha} {...props} />; }
export function IconeMotivoInformacoesComerciais(props) { return <Icone desenho={desenhos.informacoesComerciais} {...props} />; }
export function IconeMotivoSegundaVia(props) { return <Icone desenho={desenhos.segundaVia} {...props} />; }
export function IconeMotivoSemConexao(props) { return <Icone desenho={desenhos.semConexao} {...props} />; }
export function IconeMotivoLentidao(props) { return <Icone desenho={desenhos.lentidao} {...props} />; }
export function IconeMotivoNegociacaoDeDebito(props) { return <Icone desenho={desenhos.negociacaoDeDebito} {...props} />; }
export function IconeMotivoDesconhecido(props) { return <Icone desenho={desenhos.motivoDesconhecido} {...props} />; }

// Os motivos vivem no banco só com o nome, cadastrado pelo administrador. O
// desenho é achado pelo nome normalizado (sem acento, caixa ou espaço extra):
// primeiro o nome exato, depois os apelidos, na ordem — o primeiro que casa
// vence. Nome fora da lista cai no genérico: nunca some da tela.
const EXATOS = {
  cancelamento: 'cancelamento',
  financeiro: 'financeiro',
  instalacao: 'instalacao',
  'mudanca de endereco': 'mudancaDeEndereco',
  'mudanca de plano': 'mudancaDePlano',
  reativacao: 'reativacao',
  'resolvido pela ia': 'resolvidoPelaIa',
  'sem resposta': 'semResposta',
  'suporte tecnico': 'suporteTecnico',
  'troca de senha': 'trocaDeSenha',
  'informacoes comerciais': 'informacoesComerciais',
  'segunda via': 'segundaVia',
  'sem conexao': 'semConexao',
  lentidao: 'lentidao',
  'negociacao de debito': 'negociacaoDeDebito',
};

// A ordem importa:
// - "Segunda via de fatura" é Segunda via, não Financeiro;
// - "Acordo de débito" é Negociação, não Financeiro;
// - "Pagamento - sem conexão" é Financeiro (o motivo é o pagamento), como no
//   catálogo de hoje.
// "Mudança" sozinha não entra em nenhum dos dois: Mudança de plano só casa com
// verbo de troca seguido de "plano", e Mudança de endereço só pelo endereço.
const APELIDOS = [
  [/\bsegunda via\b|\b2a via\b|\b2ª via\b/, 'segundaVia'],
  [/negociac|\bdebito|\bacordo\b/, 'negociacaoDeDebito'],
  [/\b(mudanca|mudar|troca|trocar|alteracao|alterar|upgrade|downgrade)( de| do| o)? plano\b/, 'mudancaDePlano'],
  [/cancel/, 'cancelamento'],
  [/financ|boleto|pagamento|fatura|cobranc/, 'financeiro'],
  [/instal/, 'instalacao'],
  [/endereco/, 'mudancaDeEndereco'],
  [/reativ/, 'reativacao'],
  [/\bia\b/, 'resolvidoPelaIa'],
  [/sem resposta|nao respondeu/, 'semResposta'],
  [/sem conexao|sem internet/, 'semConexao'],
  [/lentid|\blent[ao]\b/, 'lentidao'],
  [/suporte|tecnic/, 'suporteTecnico'],
  [/senha/, 'trocaDeSenha'],
  [/informac/, 'informacoesComerciais'],
];

function normalizar(nome) {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function chaveDoMotivo(nome) {
  const chave = normalizar(nome);
  if (EXATOS[chave]) return EXATOS[chave];
  const achado = APELIDOS.find(([regra]) => regra.test(chave));
  return achado ? achado[1] : 'motivoDesconhecido';
}

// O ícone de um motivo pelo nome cadastrado; `tamanho` e `titulo` seguem para
// a moldura, como em qualquer ícone da família.
export function IconeDoMotivo({ nome, ...props }) {
  return <Icone desenho={desenhos[chaveDoMotivo(nome)]} {...props} />;
}
