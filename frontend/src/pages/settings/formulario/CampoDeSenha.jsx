import { useState } from 'react';

// Senha digitada por quem cadastra (Fatia S3): começa mascarada, sem sugestão
// de senha antiga do navegador (`new-password`), e o "Mostrar"/"Ocultar" é
// texto, com o estado em aria-pressed. O valor segue exatamente como foi
// digitado; nada aqui gera, guarda ou registra a senha.
export function CampoDeSenha({ id, rotulo, valor, onChange, ajuda, required = true }) {
  const [visivel, setVisivel] = useState(false);
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  const nome = rotulo.charAt(0).toLowerCase() + rotulo.slice(1);
  return (
    <div className="mc-campo cfg-dlg-campo">
      <label htmlFor={id} className="mc-rotulo">{rotulo}</label>
      <div className="cfg-dlg-segredo">
        <input
          id={id}
          name={id}
          type={visivel ? 'text' : 'password'}
          className="mc-entrada"
          value={valor}
          onChange={onChange}
          required={required}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={ajudaId}
        />
        <button
          type="button"
          className="cfg-dlg-mostrar"
          aria-label={`${visivel ? 'Ocultar' : 'Mostrar'} ${nome}`}
          aria-pressed={visivel}
          aria-controls={id}
          onClick={() => setVisivel((v) => !v)}
        >
          {visivel ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {ajuda && <p id={ajudaId} className="cfg-dlg-ajuda">{ajuda}</p>}
    </div>
  );
}
