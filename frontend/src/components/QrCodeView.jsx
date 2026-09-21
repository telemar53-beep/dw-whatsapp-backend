import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchChannelQrImage } from '../services/api';
import { Button } from './ui';

// O QR do Baileys, no tema do produto.
//
// Antes isto era um <iframe> de 256px com fundo branco apontando para
// `/qr?token=<JWT>`: um quadrado branco no meio de uma tela escura, sem estado
// de carregando, sem erro, e com o token do administrador na URL.
//
// O endpoint devolve um DOCUMENTO HTML (não JSON, não imagem), e essa dívida
// continua sendo do backend. O que dá para fazer só aqui é buscar esse HTML com
// `Authorization: Bearer`, ler o `src` da imagem e desenhar a imagem no tema.
// Nenhum token vai para a URL por este caminho.
//
// Estados: só os que os dados atuais permitem determinar. NÃO existe tempo
// restante, validade nem "expirado": o Baileys troca a string do QR em memória
// sem timestamp, e nada expõe TTL. Inventar contagem aqui seria mentira.
function QrCodeView({ channel, onRefresh }) {
  const { token } = useAuth();
  const [estado, setEstado] = useState('carregando');
  const [imagem, setImagem] = useState(null);
  const [tentativa, setTentativa] = useState(0);

  const precisaDeQr = channel.status === 'awaiting_qr';

  useEffect(() => {
    if (!precisaDeQr || !token) return undefined;
    let cancelado = false;
    setEstado('carregando');
    setImagem(null);

    fetchChannelQrImage(channel.id, token)
      .then((dataUrl) => {
        if (cancelado) return;
        setImagem(dataUrl);
        setEstado('pronto');
      })
      .catch((err) => {
        if (cancelado) return;
        setEstado(err && err.motivo ? err.motivo : 'erro');
      });

    return () => { cancelado = true; };
  }, [channel.id, precisaDeQr, token, tentativa]);

  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);

  if (!precisaDeQr) return null;

  return (
    <div className="channel-qr" role="group" aria-label="QR code de conexão">
      <div className="channel-qr-quadro">
        {estado === 'pronto' && imagem ? (
          <img src={imagem} alt={`QR code para conectar ${channel.name}`} className="channel-qr-imagem" />
        ) : (
          <div className="channel-qr-vazio" role="status">
            {estado === 'carregando' && 'Gerando QR code…'}
            {estado === 'indisponivel' && 'Nenhum QR code disponível agora.'}
            {estado === 'semPermissao' && 'Sua conta não tem acesso às credenciais deste canal.'}
            {estado === 'formatoInesperado' && 'O servidor respondeu num formato que esta tela não reconhece.'}
            {estado === 'erro' && 'Não foi possível buscar o QR code.'}
          </div>
        )}
      </div>

      <div className="channel-qr-lado">
        <p className="channel-qr-instrucao">
          {estado === 'pronto'
            ? 'Abra o WhatsApp no celular deste número, vá em Aparelhos conectados e leia o código. A situação muda para “Conectado” sozinha quando o celular terminar.'
            : estado === 'indisponivel'
              ? 'O canal está aguardando leitura, mas o código ainda não chegou. Gere um novo pelo “Reconectar”, em Ações avançadas.'
              : estado === 'semPermissao'
                ? 'Peça a um administrador com acesso a Canais e Integrações.'
                : estado === 'carregando'
                  ? 'Buscando o código no servidor.'
                  : 'Tente de novo. Se continuar, gere um novo código pelo “Reconectar”, em Ações avançadas.'}
        </p>
        {estado !== 'carregando' && estado !== 'semPermissao' && (
          <Button variant="secondary" size="sm" onClick={() => { tentarDeNovo(); if (onRefresh) onRefresh(); }}>
            {estado === 'pronto' ? 'Atualizar código' : 'Tentar de novo'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default QrCodeView;
