import { useState } from 'react';

// Campo de credencial (Access Token, API Key) nos diálogos de canal (S2).
//
// Começa mascarado (type=password) e sem autocompletar: antes era um campo de
// texto comum, legível para quem estivesse ao lado ou vendo a tela
// compartilhada. "Mostrar" é explícito, diz o que mostra e anuncia o estado
// (aria-pressed). O valor segue exatamente como foi digitado — nada é
// aparado nem transformado: o payload é o mesmo de antes.
export function CampoSecreto({ id, rotulo, valor, onChange, disabled = false, ajuda, nota }) {
  const [visivel, setVisivel] = useState(false);
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  return (
    <div className="mc-campo cfg-campo cfg-campo-inteiro">
      <div className="cfg-campo-rotulo">
        <label htmlFor={id} className="mc-rotulo">{rotulo}</label>
        {nota && <small>{nota}</small>}
      </div>
      <div className="cfg-segredo">
        <input
          id={id}
          name={id}
          type={visivel ? 'text' : 'password'}
          className="mc-entrada"
          value={valor}
          onChange={onChange}
          disabled={disabled}
          required
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          aria-describedby={ajudaId}
        />
        <button
          type="button"
          className="cfg-segredo-mostrar"
          aria-label={`${visivel ? 'Ocultar' : 'Mostrar'} ${rotulo}`}
          aria-pressed={visivel}
          aria-controls={id}
          onClick={() => setVisivel((v) => !v)}
          disabled={disabled}
        >
          {visivel ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {ajuda && <p id={ajudaId} className="mc-ajuda">{ajuda}</p>}
    </div>
  );
}
