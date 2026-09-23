// Ponto único de acesso ao localStorage. O navegador PODE lançar em qualquer
// uma dessas chamadas — não só gravar, ler também:
//
// - Safari sem permissão de armazenamento para o site lança `SecurityError` já
//   no getItem;
// - navegação privada e modos restritos lançam `QuotaExceededError` ao gravar;
// - extensão ou política de privacidade pode remover o objeto inteiro.
//
// Nada disso é erro da aplicação: é preferência de privacidade de quem usa. Um
// ajuste do usuário não pode derrubar o atendimento, então toda falha vira
// "não tem nada guardado" e a aplicação segue em memória.
//
// O padrão é o mesmo que useNavCollapsed já aplicava; aqui ele fica num lugar
// só, para o próximo lugar que precisar guardar algo não repetir o descuido.

export function lerLocal(chave) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

// Devolve se conseguiu gravar. Quase ninguém precisa saber — mas quem precisar
// não vai ter de descobrir por tentativa e erro.
export function gravarLocal(chave, valor) {
  try {
    localStorage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
}

export function apagarLocal(chave) {
  try {
    localStorage.removeItem(chave);
    return true;
  } catch {
    return false;
  }
}
