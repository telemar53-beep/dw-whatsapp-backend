import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchChannelQrImage } from '../../../services/api';

// O QR do Baileys, renovado enquanto está à vista (Fatia S2).
//
// O Baileys troca o código em memória a cada atualização da conexão, e o
// código antigo deixa de valer. Antes a tela buscava o QR uma vez só e relia a
// LISTA de canais a cada 5 s: quem demorava a ler o celular lia um código
// vencido. Agora:
//
// - busca o QR a cada INTERVALO_DO_QR_MS, e só enquanto ele pode ser visto: a
//   aba do navegador visível e o quadro na tela (IntersectionObserver);
// - pausa com a aba oculta e retoma na hora quando ela volta;
// - para ao sair da tela ou quando o canal conecta (quem monta este quadro só
//   o monta com o canal aguardando o QR);
// - nunca pede de novo com um pedido em curso, e uma resposta atrasada não
//   sobrescreve um código mais novo;
// - sem QR (404) relê o canal: é assim que a tela descobre que o celular leu
//   o código e a conexão abriu — um pedido por volta, não dois.
//
// O token vai no cabeçalho (fetchChannelQrImage), nunca na URL. Não existe
// validade, contagem nem "expirado": o Baileys não expõe o tempo de vida do
// código, e inventar isso seria mentir.
export const INTERVALO_DO_QR_MS = 5000;

function horaCurta(momento) {
  return new Date(momento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const TEXTOS = {
  carregando: 'Gerando QR code…',
  indisponivel: 'O código ainda não chegou. Ele aparece aqui sozinho; se demorar, use Reconectar.',
  semPermissao: 'Sua conta não tem acesso às credenciais deste canal.',
  formatoInesperado: 'O servidor respondeu num formato que esta tela não reconhece.',
  erro: 'Não foi possível buscar o QR code. A tela tenta de novo sozinha.',
};

function QrDoCanal({ channel, onRefresh }) {
  const { token } = useAuth();
  const aguardando = channel.status === 'awaiting_qr';
  const [estado, setEstado] = useState('carregando');
  const [imagem, setImagem] = useState(null);
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const quadroRef = useRef(null);
  const sequencia = useRef(0);
  const emCurso = useRef(false);
  const naTela = useRef(true);
  const semPermissao = useRef(false);
  const aoRefrescar = useRef(onRefresh);
  aoRefrescar.current = onRefresh;

  const buscar = useCallback(() => {
    if (!token || semPermissao.current) return;
    const minha = ++sequencia.current;
    emCurso.current = true;
    fetchChannelQrImage(channel.id, token)
      .then((dataUrl) => {
        if (minha !== sequencia.current) return;
        setImagem(dataUrl);
        setAtualizadoEm(Date.now());
        setEstado('pronto');
      })
      .catch((err) => {
        if (minha !== sequencia.current) return;
        const motivo = err && err.motivo ? err.motivo : 'erro';
        if (motivo === 'semPermissao') semPermissao.current = true;
        setEstado(motivo);
        if (motivo === 'indisponivel' && aoRefrescar.current) aoRefrescar.current();
      })
      .finally(() => {
        if (minha === sequencia.current) emCurso.current = false;
      });
  }, [channel.id, token]);

  useEffect(() => {
    if (!aguardando) return undefined;
    semPermissao.current = false;
    setEstado('carregando');
    setImagem(null);
    buscar();

    const podeRenovar = () => document.visibilityState !== 'hidden' && naTela.current && !emCurso.current;
    const relogio = setInterval(() => { if (podeRenovar()) buscar(); }, INTERVALO_DO_QR_MS);
    const aoMudarAba = () => { if (document.visibilityState === 'visible' && naTela.current && !emCurso.current) buscar(); };
    document.addEventListener('visibilitychange', aoMudarAba);

    let observador = null;
    if (typeof window.IntersectionObserver === 'function' && quadroRef.current) {
      observador = new window.IntersectionObserver((entradas) => {
        const agora = entradas.some((e) => e.isIntersecting);
        const voltou = agora && !naTela.current;
        naTela.current = agora;
        if (voltou && document.visibilityState !== 'hidden' && !emCurso.current) buscar();
      });
      observador.observe(quadroRef.current);
    }

    return () => {
      clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoMudarAba);
      if (observador) observador.disconnect();
      naTela.current = true;
      // Qualquer resposta que ainda chegue fica sem dono.
      sequencia.current += 1;
      emCurso.current = false;
    };
  }, [aguardando, buscar]);

  if (!aguardando) return null;

  const pronto = estado === 'pronto' && imagem;
  return (
    <div className="cfg-qr" ref={quadroRef}>
      <div className="cfg-qr-quadro">
        {pronto ? (
          <img src={imagem} alt={`QR code para conectar ${channel.name}`} className="cfg-qr-imagem" />
        ) : (
          <p className="cfg-qr-vazio" role="status">{TEXTOS[estado] || TEXTOS.erro}</p>
        )}
      </div>
      <div className="cfg-qr-texto">
        <h3>Leia este código no WhatsApp</h3>
        <p>No celular deste número, abra Aparelhos conectados e leia o código. A tela muda para “Conectado” assim que terminar.</p>
        <p className="cfg-qr-outro-aparelho">Se esta tela estiver aberta no próprio celular do número, mostre o código em outro aparelho.</p>
        {pronto && atualizadoEm && (
          <p className="cfg-qr-renovado">Código renovado automaticamente às {horaCurta(atualizadoEm)}</p>
        )}
        {estado !== 'semPermissao' && estado !== 'carregando' && (
          <button type="button" className="cfg-botao" onClick={buscar}>
            {pronto ? 'Atualizar agora' : 'Tentar agora'}
          </button>
        )}
      </div>
    </div>
  );
}

export default QrDoCanal;
