import { useId, useState } from 'react';
import { Dialog } from './Dialog';
// A folha vem com o componente, e não com o barril ui/index.js: pelo barril ela
// entraria no CSS de entrada (ver useConfirm).
import './dialogo-claro.css';

// Um segredo que aparece uma vez só: a chave de API do SGP e a senha
// temporária de um usuário (Fatia S0, 29/09/2026). Mesma moldura clara da
// Confirmação e do Aviso — não é uma família nova de diálogo.
//
// O que o protege de sumir sem ter sido guardado:
//   - sem "x", sem Escape e sem clique no fundo: sai só pelo botão que diz que
//     o segredo foi guardado;
//   - o segredo fica num campo só de leitura, selecionável, para a cópia à mão
//     quando a área de transferência falha (navegador sem permissão, http).
// Quem abre este diálogo guarda o segredo FORA da lista que ele descreve: uma
// releitura que falhe troca a lista por um erro e não pode levar o segredo junto.
export function SegredoGeradoDialog({ open, titulo, explicacao, rotulo, segredo, rotuloCopiar, confirmacaoCopia, rotuloFechar, onClose }) {
  const id = useId();
  const tituloId = `${id}-titulo`;
  const textoId = `${id}-texto`;
  const campoId = `${id}-campo`;
  // O resultado da cópia vale para o segredo copiado: um segredo novo no mesmo
  // diálogo não herda o "copiado" do anterior.
  const [ultimaCopia, setUltimaCopia] = useState({ de: null, estado: null });
  const copia = ultimaCopia.de === segredo ? ultimaCopia.estado : null;

  if (!open) return null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(segredo);
      setUltimaCopia({ de: segredo, estado: 'ok' });
    } catch {
      setUltimaCopia({ de: segredo, estado: 'erro' });
    }
  }

  return (
    <Dialog
      claro
      role="alertdialog"
      variant="alert"
      size=""
      labelledBy={tituloId}
      describedBy={textoId}
      dismissible={false}
      closeOnEsc={false}
      closeOnBackdrop={false}
      onClose={() => {}}
      className="mc-pequeno"
    >
      <div className="mc-aviso" data-tom="sucesso">
        <h2 id={tituloId} className="mc-aviso-titulo">{titulo}</h2>
        <p id={textoId} className="mc-aviso-texto">{explicacao}</p>
        <div className="mc-campo mt-4">
          <label htmlFor={campoId} className="mc-rotulo">{rotulo}</label>
          <input
            id={campoId}
            readOnly
            value={segredo}
            spellCheck={false}
            autoComplete="off"
            onFocus={(evento) => evento.target.select()}
            className="mc-entrada"
          />
          <p role="status" className="mc-ajuda">{copia === 'ok' ? confirmacaoCopia : ''}</p>
        </div>
        {copia === 'erro' && (
          <p role="alert" className="mc-erro">
            Não foi possível copiar automaticamente. Selecione o texto do campo e copie com Ctrl+C.
          </p>
        )}
      </div>
      <div className="mc-rodape is-aviso">
        <div className="mc-acoes">
          <button type="button" data-autofocus="" className="mc-botao" onClick={copiar}>{rotuloCopiar}</button>
          <button type="button" className="mc-botao is-principal" onClick={onClose}>{rotuloFechar}</button>
        </div>
      </div>
    </Dialog>
  );
}
