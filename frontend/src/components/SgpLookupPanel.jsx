import { useState, useEffect, useRef, useId } from 'react';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { ApiError } from '../services/api';
import { descreverErro } from '../utils/errorMessages';
import { IconeConsultarSgp, IconeBuscar, IconeRecolher, IconeInformacoes, IconeAssumir } from './icones';
import { IconeCodigoPix, IconeQrPix, IconeCodigoBarras, IconeLinkFatura, IconePdfFatura } from './icones/sgp';
import { IconClose, IconSpinner, IconCheck } from './icons/SgpIcons';
import './sgp-painel.css';

// Painel "Verificação SGP". Só é carregado quando o atendente abre a consulta
// (ConversationView faz o import sob demanda), e a biblioteca de QR só chega
// quando a prévia é pedida. Tudo o que aparece aqui vem do SGP pela consulta
// já existente; o painel não inventa, não guarda e não recalcula nada: as
// pendências e o total vêm prontos da conferência dos títulos, no backend.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

const digitos = (valor) => String(valor || '').replace(/\D/g, '');

// CPF e CNPJ com o miolo escondido; o começo e o fim bastam para conferir.
function mascararDocumento(documento) {
  const d = digitos(documento);
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/****-${d.slice(12)}`;
  if (d.length > 4) return `${'*'.repeat(d.length - 2)}${d.slice(-2)}`;
  return d;
}

const mascararContrato = (id) => {
  const texto = String(id ?? '');
  return texto.length > 3 ? `••${texto.slice(-3)}` : texto;
};

function moeda(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return `R$ ${valor}`;
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataCurta(iso) {
  const [ano, mes, dia] = String(iso || '').split('-');
  if (!ano || !mes || !dia) return iso || '';
  const outroAno = Number(ano) !== new Date().getFullYear() ? ` ${ano}` : '';
  return `${Number(dia)} ${MESES[Number(mes) - 1]}${outroAno}`;
}

// A data da 2ª via é a da reemissão (num título atrasado, o dia em que ela foi
// gerada), nunca o vencimento original: por isso "válida até", e não "Vence".
const validade = (iso) => `2ª via válida até ${dataCurta(iso)}`;

const contar = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Resumo da conferência: o total é só das vencidas; as do dia vêm à parte.
function resumoConferido(vencidas, total, doDia) {
  const partes = [];
  if (vencidas > 0) partes.push(`${contar(vencidas, 'fatura vencida', 'faturas vencidas')} · Total ${moeda(total)}`);
  if (doDia > 0) partes.push(vencidas > 0 ? `${doDia} ${doDia === 1 ? 'vence' : 'vencem'} hoje` : `${contar(doDia, 'fatura vence', 'faturas vencem')} hoje`);
  return partes.join(' · ');
}

// "O SGP informou 2 faturas vencidas, mas liberou 1 segunda via."
function avisoDeDivergencia(vencidas, doDia, segundasVias) {
  const hoje = doDia === 1 ? '1 que vence hoje' : `${doDia} que vencem hoje`;
  let informou;
  if (vencidas > 0 && doDia > 0) informou = `${contar(vencidas, 'fatura vencida', 'faturas vencidas')} e ${hoje}`;
  else if (vencidas > 0) informou = contar(vencidas, 'fatura vencida', 'faturas vencidas');
  else informou = contar(doDia, 'fatura que vence hoje', 'faturas que vencem hoje');
  const liberou = segundasVias === 0 ? 'não liberou segunda via' : `liberou ${contar(segundasVias, 'segunda via', 'segundas vias')}`;
  return `O SGP informou ${informou}, mas ${liberou}. Confira no SGP antes de enviar.`;
}
const estaAtivo = (contrato) => contrato.status === 'Ativo';

// Falha de envio: diz o que aconteceu (traduzido quando o backend responde),
// e não só "tente de novo".
function mensagemDeEnvio(erro) {
  if (erro instanceof ApiError) return `Não foi possível enviar. ${descreverErro(erro, 'Tente de novo.')}`;
  return 'Não foi possível enviar. Confira a conexão e tente de novo.';
}

function Marca({ escolhida }) {
  return <span className={`sgp-marca${escolhida ? ' is-escolhida' : ''}`} aria-hidden="true" />;
}

function Status({ contrato }) {
  if (!contrato.status) return null;
  return <span className={`sgp-status${estaAtivo(contrato) ? '' : ' is-atencao'}`}>{contrato.status}</span>;
}

// Um seletor compacto: fechado mostra só o escolhido; aberto, a lista inteira.
// Escolher fecha e devolve o foco à linha. Esc fecha a lista sem fechar o painel.
function Seletor({ rotulo, itens, escolhidoId, onEscolher, titulo, detalhe, opcao, contagem }) {
  const [aberto, setAberto] = useState(false);
  const idLista = useId();
  const linhaRef = useRef(null);
  const escolhidaRef = useRef(null);
  const variosItens = itens.length > 1;

  useEffect(() => {
    if (aberto && escolhidaRef.current) escolhidaRef.current.focus();
  }, [aberto]);

  function fechar() {
    setAberto(false);
    if (linhaRef.current) linhaRef.current.focus();
  }

  // Primeira linha: o que identifica (nome e status, ou vencimento e valor).
  // Segunda: o detalhe e, à direita, quantos há.
  const conteudo = (
    <>
      <Marca escolhida />
      <span className="sgp-linha-conteudo">
        {titulo}
        {(detalhe || variosItens) && (
          <span className="sgp-linha-sub">
            <span className="sgp-linha-detalhe">{detalhe}</span>
            {variosItens && <span className="sgp-contagem">{contagem}</span>}
          </span>
        )}
      </span>
    </>
  );

  if (!variosItens) return <div className="sgp-linha is-escolhida">{conteudo}</div>;

  return (
    <>
      <button
        ref={linhaRef}
        type="button"
        className="sgp-linha is-escolhida"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        onClick={() => setAberto((valor) => !valor)}
      >
        {conteudo}
        <IconeRecolher tamanho={18} className="sgp-chevron" />
      </button>
      {aberto && (
        <ul
          id={idLista}
          className="sgp-opcoes"
          aria-label={rotulo}
          onKeyDown={(evento) => {
            if (evento.key !== 'Escape') return;
            evento.stopPropagation();
            fechar();
          }}
        >
          {itens.map((item) => {
            const escolhido = String(item.id) === String(escolhidoId);
            return (
              <li key={item.id}>
                <button
                  ref={escolhido ? escolhidaRef : undefined}
                  type="button"
                  className="sgp-opcao"
                  aria-pressed={escolhido}
                  onClick={() => {
                    onEscolher(item.id);
                    fechar();
                  }}
                >
                  <Marca escolhida={escolhido} />
                  <span className="sgp-linha-conteudo">{opcao(item)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Financeiro({ contrato, estado, onConsultar, podeEnviar, idMotivo, envios }) {
  const faturas = estado && !estado.loading && !estado.error && estado.hasOpenInvoice ? estado.duplicates || [] : [];
  const [faturaId, setFaturaId] = useState(null);
  const fatura = faturas.find((item) => String(item.id) === String(faturaId)) || faturas[0] || null;
  const [enviando, setEnviando] = useState(() => new Set());
  const enviandoRef = useRef(new Set());
  const [retorno, setRetorno] = useState(null);
  const [qr, setQr] = useState({ aberto: false, codigo: null, url: null, erro: null });
  const qrRef = useRef(null);

  // Trocar de fatura fecha a prévia: o QR aberto seria o da fatura anterior.
  const faturaAtualId = fatura ? fatura.id : null;
  useEffect(() => {
    setQr({ aberto: false, codigo: null, url: null, erro: null });
    setRetorno(null);
  }, [faturaAtualId]);

  useEffect(() => {
    if (qr.url && qrRef.current && qrRef.current.scrollIntoView) qrRef.current.scrollIntoView({ block: 'nearest' });
  }, [qr.url]);

  // Duas fontes, sem casar uma com a outra: a conferência dos títulos (as
  // pendências reais, pelo vencimento original, e o total) e as 2ª vias que o
  // SGP liberou (data da reemissão e meios de pagamento). Enquanto a
  // conferência não estiver completa, o que aparece é o que a consulta do
  // contrato informou — nunca como total.
  const respondeu = Boolean(estado && !estado.loading && !estado.error);
  const conferencia = respondeu && estado.conferencia && estado.conferencia.estado === 'completa' ? estado.conferencia : null;
  const vencidas = (conferencia && conferencia.vencidas) || [];
  const doDia = (conferencia && conferencia.venceHoje) || [];
  const pendencias = [...vencidas, ...doDia];
  const divergente = Boolean(conferencia) && pendencias.length > 0 && pendencias.length !== faturas.length;
  const informado =
    !conferencia && Number(contrato.openInvoicesCount) > 0 && contrato.openAmount !== undefined && contrato.openAmount !== null
      ? `${contar(Number(contrato.openInvoicesCount), 'título informado pelo SGP', 'títulos informados pelo SGP')} · Valor informado ${moeda(contrato.openAmount)}`
      : null;
  const resumo = conferencia && pendencias.length > 0 ? resumoConferido(vencidas.length, conferencia.totalVencidas, doDia.length) : informado;

  async function enviar(chave, nome, acao) {
    if (enviandoRef.current.has(chave)) return;
    enviandoRef.current.add(chave);
    setEnviando(new Set(enviandoRef.current));
    setRetorno(null);
    try {
      await acao();
      setRetorno({ chave, tipo: 'ok', texto: `${nome} enviado para o cliente` });
    } catch (erro) {
      setRetorno({ chave, tipo: 'erro', texto: mensagemDeEnvio(erro) });
    } finally {
      enviandoRef.current.delete(chave);
      setEnviando(new Set(enviandoRef.current));
    }
  }

  async function alternarQr() {
    if (qr.aberto) {
      setQr({ aberto: false, codigo: null, url: null, erro: null });
      return;
    }
    const codigo = fatura.pixCode;
    setQr({ aberto: true, codigo, url: null, erro: null });
    try {
      const { default: QRCode } = await import('qrcode');
      const url = await QRCode.toDataURL(codigo);
      setQr((atual) => (atual.aberto && atual.codigo === codigo ? { ...atual, url } : atual));
    } catch {
      setQr((atual) => (atual.aberto && atual.codigo === codigo ? { ...atual, erro: 'Não foi possível gerar a prévia do QR.' } : atual));
    }
  }

  const acoes = fatura
    ? [
        { chave: 'pix', rotulo: 'Código Pix', nome: 'Código Pix', Icone: IconeCodigoPix, tem: fatura.pixCode, falta: 'Esta fatura não tem código Pix.', acao: () => envios.pix(contrato.id, fatura) },
        { chave: 'qr', rotulo: 'QR Pix', nome: 'QR Pix', Icone: IconeQrPix, tem: fatura.pixCode, falta: 'Esta fatura não tem código Pix.', previa: true },
        { chave: 'barras', rotulo: 'Código de barras', nome: 'Código de barras', Icone: IconeCodigoBarras, tem: fatura.barCode, falta: 'Esta fatura não tem código de barras.', acao: () => envios.barras(contrato.id, fatura) },
        { chave: 'link', rotulo: 'Link', nome: 'Link da fatura', Icone: IconeLinkFatura, tem: fatura.boletoLink, falta: 'Esta fatura não tem link.', acao: () => envios.link(fatura.boletoLink) },
        { chave: 'pdf', rotulo: 'PDF', nome: 'PDF da fatura', Icone: IconePdfFatura, tem: fatura.boletoLink, falta: 'Esta fatura não tem PDF.', acao: () => envios.pdf(contrato.id, fatura.boletoLink) },
      ]
    : [];

  return (
    <section className="sgp-secao" aria-label="Faturas">
      {resumo && (
        <p className="sgp-resumo">
          <IconeInformacoes tamanho={18} />
          <span>{resumo}</span>
        </p>
      )}
      {conferencia && pendencias.length === 0 && <p className="sgp-estado">Nenhuma fatura vencida.</p>}
      {pendencias.length > 0 && (
        <ul className="sgp-pendencias" aria-label="Pendências no SGP">
          {pendencias.map((item, indice) => (
            <li key={`${item.faturaId}-${indice}`} className="sgp-linha">
              <span className="sgp-linha-conteudo">
                <span className="sgp-linha-titulo is-entre">
                  <span>{indice < vencidas.length ? `Venceu ${dataCurta(item.vencimentoOriginal)}` : 'Vence hoje'}</span>
                  <span className="sgp-valor">{moeda(item.valor)}</span>
                </span>
                <span className="sgp-linha-sub">Nº {item.faturaId}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {estado && estado.loading && (
        <p role="status" className="sgp-estado">
          <IconSpinner size={16} />
          Consultando o SGP…
        </p>
      )}
      {estado && !estado.loading && estado.error && (
        <p role="alert" className="sgp-erro">
          {descreverErro(estado.errorMessage, 'Não foi possível consultar a 2ª via agora.')}
        </p>
      )}
      {divergente && (
        <p role="status" className="sgp-aviso">
          {avisoDeDivergencia(vencidas.length, doDia.length, faturas.length)}
        </p>
      )}
      {respondeu && !conferencia && (
        <p role="status" className="sgp-aviso">
          Não foi possível conferir todas as pendências. Confira no SGP antes de enviar.
        </p>
      )}
      {respondeu && !estado.hasOpenInvoice && !divergente && (
        <p className="sgp-estado">O SGP não liberou segunda via para este contrato.</p>
      )}

      {fatura && (
        <>
          <h3 className="sgp-rotulo">2ª via selecionada</h3>
          <Seletor
            rotulo="Segundas vias liberadas"
            itens={faturas}
            escolhidoId={fatura.id}
            onEscolher={setFaturaId}
            contagem={contar(faturas.length, 'segunda via', 'segundas vias')}
            titulo={
              <span className="sgp-linha-titulo is-entre">
                <span>{validade(fatura.dueDate)}</span>
                <span className="sgp-valor">{moeda(fatura.value)}</span>
              </span>
            }
            detalhe={
              <>
                Nº {fatura.id}
                <span className="sgp-situacao">Em aberto</span>
              </>
            }
            opcao={(item) => (
              <>
                <span className="sgp-linha-titulo is-entre">
                  <span>{validade(item.dueDate)}</span>
                  <span className="sgp-valor">{moeda(item.value)}</span>
                </span>
                <span className="sgp-linha-sub">Nº {item.id}</span>
              </>
            )}
          />
        </>
      )}

      {(!estado || (!estado.loading && estado.error)) && (
        <>
          <button type="button" className="sgp-segunda-via" onClick={onConsultar}>
            <IconeConsultarSgp tamanho={18} />
            Consultar 2ª via
          </button>
          <p className="sgp-nota">Pode gerar Pix no SGP.</p>
        </>
      )}

      {fatura && (
        <>
          <h3 className="sgp-rotulo">Enviar esta 2ª via</h3>
          <div className="sgp-acoes">
            {acoes.map(({ chave, rotulo, nome, Icone, tem, falta, acao, previa }) => {
              const semDado = !tem;
              const bloqueado = previa ? semDado : semDado || !podeEnviar;
              return (
                <button
                  key={chave}
                  type="button"
                  className={`sgp-acao${retorno && retorno.chave === chave && retorno.tipo === 'ok' ? ' is-enviado' : ''}`}
                  disabled={bloqueado || enviando.has(chave)}
                  aria-pressed={previa ? qr.aberto : undefined}
                  title={semDado ? falta : undefined}
                  aria-describedby={!previa && !podeEnviar ? idMotivo : undefined}
                  onClick={previa ? alternarQr : () => enviar(chave, nome, acao)}
                >
                  {enviando.has(chave) ? <IconSpinner size={20} /> : <Icone tamanho={20} />}
                  <span>{rotulo}</span>
                </button>
              );
            })}
          </div>

          {qr.aberto && (
            <figure ref={qrRef} className="sgp-qr">
              {qr.url && <img src={qr.url} alt="QR code do Pix" width="136" height="136" />}
              {!qr.url && !qr.erro && (
                <p role="status" className="sgp-estado">
                  <IconSpinner size={16} />
                  Gerando a prévia…
                </p>
              )}
              {qr.erro && (
                <p role="alert" className="sgp-erro">
                  {qr.erro}
                </p>
              )}
              <figcaption>Prévia. O cliente ainda não recebeu este QR.</figcaption>
              <button
                type="button"
                className="sgp-botao-principal"
                disabled={!podeEnviar || enviando.has('qr-envio')}
                aria-describedby={!podeEnviar ? idMotivo : undefined}
                onClick={() => enviar('qr-envio', 'QR Pix', () => envios.qr(contrato.id, fatura))}
              >
                {enviando.has('qr-envio') ? 'Enviando…' : 'Enviar QR Pix'}
              </button>
            </figure>
          )}

          {retorno && (
            <p role={retorno.tipo === 'ok' ? 'status' : 'alert'} className={`sgp-retorno ${retorno.tipo === 'ok' ? 'is-ok' : 'is-erro'}`}>
              {retorno.tipo === 'ok' && <IconCheck size={14} />}
              {retorno.texto}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function DadosTecnicos({ contrato }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const linhas = [
    ...(contrato.phones || []).map((telefone) => ['Telefone', telefone]),
    ...(contrato.emails || []).map((email) => ['E-mail', email]),
    ['Endereço', contrato.address],
    ['Cidade', contrato.city],
    ['Login', contrato.login],
    ['MAC', contrato.mac],
    ['VLAN', contrato.vlan],
    ['POP', contrato.popName || contrato.popId],
    ['Conexão', contrato.connectionType],
  ].filter(([, valor]) => valor !== undefined && valor !== null && String(valor).trim() !== '');
  if (linhas.length === 0) return null;
  return (
    <section className="sgp-tecnicos">
      <button type="button" className="sgp-tecnicos-botao" aria-expanded={aberto} aria-controls={aberto ? id : undefined} onClick={() => setAberto((valor) => !valor)}>
        Contatos e dados técnicos
        <IconeRecolher tamanho={18} className="sgp-chevron" />
      </button>
      {aberto && (
        <dl id={id}>
          {linhas.map(([rotulo, valor], indice) => (
            <div key={`${rotulo}-${indice}`}>
              <dt>{rotulo}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function SgpLookupPanel({
  onSendMessage,
  onSendPdf,
  onSendPix,
  onSendPixQr,
  onSendBarcode,
  onClose,
  initialCpf,
  emTela = false,
  podeEnviar = true,
  motivoSemEnvio = null,
}) {
  const vinculado = digitos(initialCpf);
  const [documento, setDocumento] = useState('');
  const [buscado, setBuscado] = useState(vinculado);
  const [outroAberto, setOutroAberto] = useState(!vinculado);
  const [contratoId, setContratoId] = useState(null);
  const { client, contracts, loading, error, errorMessage, search, fetchDuplicate, duplicateState } = useSgpLookup();
  const voltarRef = useRef(null);
  const idBusca = useId();
  const idMotivo = useId();

  // A regra de sempre: começa pelo primeiro contrato que o SGP devolve. O
  // status fica à vista para o atendente decidir se é esse mesmo.
  useEffect(() => {
    setContratoId(contracts.length > 0 ? contracts[0].id : null);
  }, [contracts]);

  // Abriu (sempre por clique): consulta o documento vinculado ao contato.
  useEffect(() => {
    if (vinculado) {
      setBuscado(vinculado);
      search(vinculado);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vinculado]);

  // No lugar da conversa, o foco entra pela volta — o único controle de saída.
  useEffect(() => {
    if (emTela && voltarRef.current) voltarRef.current.focus();
  }, [emTela]);

  function buscar(evento) {
    evento.preventDefault();
    const d = digitos(documento);
    if (!d || loading) return;
    setBuscado(d);
    search(d);
  }

  const contrato = contracts.find((item) => String(item.id) === String(contratoId)) || null;
  const relacao = !client ? null : !vinculado ? 'sem-vinculo' : digitos(buscado) === vinculado ? 'vinculado' : 'diferente';
  const envios = { pix: onSendPix, qr: onSendPixQr, barras: onSendBarcode, link: onSendMessage, pdf: onSendPdf };

  const formulario = (
    <form id={idBusca} onSubmit={buscar} className="sgp-busca">
      <input
        value={documento}
        onChange={(evento) => setDocumento(evento.target.value)}
        placeholder="CPF ou CNPJ"
        aria-label="CPF ou CNPJ do cliente"
        inputMode="numeric"
        autoComplete="off"
      />
      <button type="submit" aria-label="Buscar" title="Buscar" className="sgp-buscar" disabled={loading}>
        <IconeBuscar tamanho={18} />
      </button>
    </form>
  );

  return (
    <aside role="region" aria-label="Consulta SGP" className="sgp conv-painel">
      <header className="sgp-topo">
        {emTela ? (
          <button ref={voltarRef} type="button" className="sgp-voltar" aria-label="Voltar à conversa" title="Voltar à conversa" onClick={onClose}>
            <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
          </button>
        ) : (
          <span className="sgp-topo-icone" aria-hidden="true">
            <IconeConsultarSgp />
          </span>
        )}
        <h2 className="sgp-titulo">Verificação SGP</h2>
        {!emTela && onClose && (
          <button type="button" className="sgp-fechar" aria-label="Fechar consulta SGP" title="Fechar" onClick={onClose}>
            <IconClose size={18} />
          </button>
        )}
      </header>

      <div className="sgp-corpo chat-scroll">
        {!vinculado && (
          <>
            <p className="sgp-dica">Este contato não tem documento vinculado. Busque pelo documento para ver o contrato e enviar a fatura direto na conversa.</p>
            {formulario}
          </>
        )}

        {loading && (
          <p role="status" className="sgp-estado">
            <IconSpinner size={16} />
            Buscando no SGP…
          </p>
        )}
        {error === 'not_found' && (
          <p role="status" className="sgp-estado">
            Cliente não encontrado. Confira o documento e busque de novo.
          </p>
        )}
        {error === 'error' && (
          <p role="alert" className="sgp-erro">
            {descreverErro(errorMessage, 'Não foi possível consultar o SGP agora.')}
          </p>
        )}

        {client && (
          <section className="sgp-cliente" aria-label="Cliente no SGP">
            <span className="sgp-avatar" aria-hidden="true">
              {String(client.name || '?').trim().charAt(0).toUpperCase()}
            </span>
            <div className="sgp-cliente-dados">
              <p className="sgp-nome">{client.name}</p>
              <p className="sgp-doc">{mascararDocumento(client.document || buscado)}</p>
            </div>
            {relacao === 'vinculado' && <span className="sgp-selo is-ok">Documento vinculado</span>}
            {relacao === 'diferente' && <span className="sgp-selo is-atencao">Documento diferente do contato</span>}
            {relacao === 'sem-vinculo' && <span className="sgp-selo">Contato sem documento vinculado</span>}
          </section>
        )}

        {vinculado && (
          <div className="sgp-outro">
            <button type="button" className="sgp-link" aria-expanded={outroAberto} aria-controls={outroAberto ? idBusca : undefined} onClick={() => setOutroAberto((valor) => !valor)}>
              Consultar outro documento
            </button>
            {outroAberto && formulario}
          </div>
        )}

        {client && contracts.length === 0 && <p className="sgp-estado">Nenhum contrato encontrado para este cliente no SGP.</p>}

        {contrato && (
          <section className="sgp-secao" aria-label="Contratos">
            <h3 className="sgp-rotulo">{contracts.length > 1 ? `Contratos (${contracts.length})` : 'Contrato'}</h3>
            <Seletor
              rotulo="Contratos"
              itens={contracts}
              escolhidoId={contrato.id}
              onEscolher={setContratoId}
              contagem={contar(contracts.length, 'contrato', 'contratos')}
              titulo={
                <span className="sgp-linha-titulo">
                  <span>Contrato {mascararContrato(contrato.id)}</span>
                  <Status contrato={contrato} />
                </span>
              }
              detalhe={contrato.plan}
              opcao={(item) => (
                <>
                  <span className="sgp-linha-titulo">
                    <span>Contrato {mascararContrato(item.id)}</span>
                    <Status contrato={item} />
                  </span>
                  {item.plan && <span className="sgp-linha-sub">{item.plan}</span>}
                  {item.address && <span className="sgp-linha-sub">{item.address}</span>}
                  {!estaAtivo(item) && item.statusReason && <span className="sgp-aviso">{item.statusReason}</span>}
                </>
              )}
            />
            {!estaAtivo(contrato) && contrato.statusReason && <p className="sgp-aviso">Motivo: {contrato.statusReason}</p>}
          </section>
        )}

        {contrato && (
          <Financeiro
            key={contrato.id}
            contrato={contrato}
            estado={duplicateState[contrato.id]}
            onConsultar={() => fetchDuplicate(contrato.id)}
            podeEnviar={podeEnviar}
            idMotivo={idMotivo}
            envios={envios}
          />
        )}

        {contrato && <DadosTecnicos key={`tecnicos-${contrato.id}`} contrato={contrato} />}
      </div>

      <footer className={`sgp-rodape${podeEnviar ? '' : ' is-sem-envio'}`}>
        <IconeAssumir tamanho={18} />
        <span id={idMotivo}>{podeEnviar ? 'Atendimento sob sua responsabilidade' : motivoSemEnvio || 'Só o responsável pelo atendimento pode enviar ao cliente.'}</span>
      </footer>
    </aside>
  );
}

export default SgpLookupPanel;
