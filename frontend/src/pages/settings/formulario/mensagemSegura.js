import { descreverErro } from '../../../utils/errorMessages';

// Mensagem segura para os diálogos de formulário de Configurações (Fatia S3).
//
// O backend dos cadastros fala em dois registros: frases já traduzidas pelo
// tradutor geral (descreverErro) e validações técnicas em inglês ("name is
// required", "monthlyPrice is invalid"). As primeiras chegam à pessoa; as
// segundas viram a frase de cada formulário, ou a mensagem padrão do diálogo.
// Texto técnico em inglês que sobrar (erro de banco, rede) nunca vai à tela.
const LOCAIS = {
  'name, email, password and role are required': 'Preencha nome, e-mail, senha e perfil.',
  'role must be agent, manager or admin': 'Escolha um perfil válido.',
  'name is required': 'Informe o nome.',
  'name must be a non-empty string': 'Informe o nome.',
  'monthlyPrice is invalid': 'Informe a mensalidade em reais, por exemplo 100,00.',
  'speedMbps is invalid': 'A velocidade deve ser um número inteiro de megabits, ou ficar em branco.',
  'sortOrder is invalid': 'A ordem de exibição deve ser um número inteiro.',
};

function textoDoServidor(erro) {
  if (erro && erro.body && typeof erro.body.error === 'string') return erro.body.error;
  if (erro && typeof erro.message === 'string') return erro.message;
  return null;
}

export function mensagemSegura(erro, padrao) {
  const cru = textoDoServidor(erro);
  if (!cru) return padrao;
  if (LOCAIS[cru]) return LOCAIS[cru];
  const traduzida = descreverErro(erro, padrao);
  // Sem tradução, o texto volta igual: se for só ASCII, é inglês técnico.
  if (traduzida === cru && /^[\x20-\x7E]+$/.test(cru)) return padrao;
  return traduzida || padrao;
}
