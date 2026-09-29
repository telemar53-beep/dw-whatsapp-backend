import './cartoes-de-canais.css';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { IconeBuscar } from '../../../components/icones';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import { formatPhone } from '../../../utils/phone';
import { ConnectionStatus, providerLabel, conexaoLabel } from './ChannelsTable';
import { channelSummary } from './channelSummary';

// Números conectados em cartões (Fatia S1, mockup aprovado): duas colunas
// quando há espaço, uma no celular. A hierarquia de cada cartão:
//   1. o emblema do tipo (API, BSP, BL), o nome e o número, e o estado;
//   2. os fatos: como conecta e, no oficial, a qualidade que a Meta informa;
//   3. o que precisa de atenção (os avisos do resumo de sempre);
//   4. os recursos ativos e a ação em texto.
// Nada aqui é dado novo: tudo vem do canal e do resumo que a lista já usava.

// O tipo dito em letras, sem marca de terceiro: API é a da Meta, BSP é a da
// 360dialog e BL é o Baileys (não oficial).
const SIGLAS = { meta_cloud: 'API', '360dialog': 'BSP', baileys: 'BL' };
export function siglaDoTipo(type) {
  return SIGLAS[type] || String(type || '?').slice(0, 3).toUpperCase();
}

const TYPE_OPTIONS = [
  ['all', 'Todos os tipos'],
  ['baileys', 'Baileys'],
  ['meta_cloud', 'Meta Cloud'],
  ['360dialog', '360dialog'],
];
// Os nomes curtos do resumo de atendimento; o resumo continua sendo a fonte.
const CHIP_LABELS = { IA: 'IA ativa' };
// A qualidade que a Meta atribui ao número. UNKNOWN (número novo) não é dito.
const QUALIDADE = { GREEN: 'Alta', YELLOW: 'Média', RED: 'Baixa' };

// O que merece o cartão em destaque: um aviso do resumo, a conexão do
// Baileys fora do ar ou esperando o QR, o oficial com erro ou desconectado, ou
// a qualidade da Meta abaixo de alta. "Não verificada" (a Meta não respondeu,
// ou a 360dialog, que não é verificada) é neutro: não sabemos.
export function precisaDeAtencao(channel, warnings) {
  if (warnings.length > 0) return true;
  if (!isOfficialChannelType(channel.type)) return channel.status !== 'connected';
  const conexao = channel.connection;
  if (!conexao) return false;
  if (conexao.state === 'error' || conexao.state === 'disconnected') return true;
  return conexao.state === 'connected' && (conexao.quality === 'YELLOW' || conexao.quality === 'RED');
}

// Botão de reticências com as ações do canal; fecha ao clicar fora, no Esc ou
// ao escolher. O mesmo de antes, na lista.
function RowMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="cfg-canal-menu">
      <button type="button" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((prev) => !prev)} className="cfg-canal-mais">
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div onClick={() => setOpen(false)} className="channel-row-menu cfg-canal-menu-lista">
          {children}
        </div>
      )}
    </div>
  );
}

function CartaoDoCanal({ channel, summaryContext, actions, canManage }) {
  const { chips, warnings } = channelSummary(channel, summaryContext);
  const recursos = chips.length > 0 ? chips.map((chip) => CHIP_LABELS[chip] || chip) : ['Humano'];
  const oficial = isOfficialChannelType(channel.type);
  const atencao = precisaDeAtencao(channel, warnings);
  const qualidade = oficial && channel.connection?.state === 'connected' ? QUALIDADE[channel.connection.quality] : undefined;
  const busy = actions && actions.busyChannelId === channel.id;
  const detailTo = `/configuracoes/canais/${channel.id}/conexao`;
  const idDoNome = `canal-${channel.id}-nome`;

  return (
    <li className={`cfg-canal ${atencao ? 'precisa-atencao' : ''} ${channel.hidden ? 'is-oculto' : ''}`} data-tipo={channel.type} aria-labelledby={idDoNome}>
      <div className="cfg-canal-topo">
        <span className={`cfg-emblema ${oficial ? '' : 'is-nao-oficial'}`} aria-hidden="true">{siglaDoTipo(channel.type)}</span>
        <div className="cfg-canal-id">
          <Link id={idDoNome} to={detailTo} className="cfg-canal-nome">{channel.name}</Link>
          <p className="cfg-canal-numero">
            {formatPhone(channel.phoneNumber)}
            {channel.hidden ? ' · oculto' : ''}
          </p>
        </div>
        <div className="cfg-canal-estado"><ConnectionStatus channel={channel} /></div>
      </div>

      <dl className="cfg-canal-fatos">
        <div>
          <dt>Conexão</dt>
          <dd>{providerLabel(channel.type)} · {conexaoLabel(channel.type)}</dd>
        </div>
        {qualidade && (
          <div>
            <dt>Qualidade</dt>
            <dd data-qualidade={channel.connection.quality}>{qualidade}</dd>
          </div>
        )}
      </dl>

      {warnings.length > 0 && (
        <ul className="cfg-canal-avisos" aria-label="Precisa de atenção">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <div className="cfg-canal-rodape">
        <ul className="cfg-recursos" aria-label="Recursos ativos">
          {recursos.map((recurso) => <li key={recurso} data-attendance={recurso}>{recurso}</li>)}
        </ul>
        <div className="cfg-canal-acoes">
          <Link to={detailTo} className="cfg-canal-acao">{atencao ? 'Revisar canal' : 'Configurar'}</Link>
          {actions && canManage && (
            <RowMenu label={`Mais ações para ${channel.name}`}>
              {channel.type === 'baileys' && (
                <button type="button" onClick={() => actions.reconnect(channel)} disabled={busy}>Reconectar</button>
              )}
              <button type="button" onClick={() => actions.toggleHidden(channel)} disabled={busy}>{channel.hidden ? 'Reexibir' : 'Ocultar'}</button>
              <button type="button" onClick={() => actions.remove(channel)} disabled={busy} className="dw-menu-item-danger">Excluir</button>
            </RowMenu>
          )}
        </div>
      </div>
    </li>
  );
}

// Resumo, busca e filtro + os cartões. `extraControls` entra ao lado dos
// filtros (a página usa para "Mostrar ocultos"). `actions` liga o menu "⋯".
export function CartoesDeCanais({ channels, summaryContext, actions = null, canManage = false, extraControls = null, emptyMessage }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const term = search.trim().toLowerCase();

  const visible = useMemo(
    () =>
      channels.filter((channel) => {
        if (type !== 'all' && channel.type !== type) return false;
        if (!term) return true;
        return [channel.name, channel.phoneNumber].some((field) => String(field || '').toLowerCase().includes(term));
      }),
    [channels, type, term]
  );
  const oficiais = channels.filter((channel) => isOfficialChannelType(channel.type)).length;
  const baileys = channels.filter((channel) => channel.type === 'baileys').length;
  const comAtencao = channels.filter((channel) => precisaDeAtencao(channel, channelSummary(channel, summaryContext).warnings)).length;
  const filtrando = visible.length !== channels.length;

  return (
    <div className="cfg-canais">
      <ul className="cfg-canais-resumo" aria-label="Resumo dos canais">
        <li><strong>{channels.length}</strong> {channels.length === 1 ? 'número' : 'números'}</li>
        <li><strong>{oficiais}</strong> {oficiais === 1 ? 'oficial' : 'oficiais'}</li>
        <li><strong>{baileys}</strong> Baileys</li>
        {comAtencao > 0 && <li className="is-atencao"><strong>{comAtencao}</strong> {comAtencao === 1 ? 'precisa de atenção' : 'precisam de atenção'}</li>}
      </ul>

      <div className="cfg-canais-ferramentas">
        <label className="cfg-canais-busca">
          <span aria-hidden="true"><IconeBuscar tamanho={17} /></span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome ou número"
            aria-label="Buscar por nome ou número"
          />
        </label>
        <select aria-label="Tipo de conexão" value={type} onChange={(event) => setType(event.target.value)} className="cfg-canais-tipo">
          {TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {extraControls}
      </div>

      {filtrando && <p className="cfg-canais-contagem">{visible.length} de {channels.length} {channels.length === 1 ? 'canal' : 'canais'}</p>}

      {visible.length === 0 ? (
        <p className="cfg-canais-vazio">
          {channels.length === 0 ? emptyMessage || 'Nenhum canal cadastrado ainda.' : 'Nenhum canal com esse filtro.'}
        </p>
      ) : (
        <ul className="cfg-canais-grade" aria-label="Canais">
          {visible.map((channel) => (
            <CartaoDoCanal key={channel.id} channel={channel} summaryContext={summaryContext} actions={actions} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default CartoesDeCanais;
