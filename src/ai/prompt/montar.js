const MODULOS = [
  require('./principios'),
  require('./fatos'),
  require('./painel'),
  require('./fluxos/privacidade'),
  require('./fluxos/terceiros'),
  require('./fluxos/identificacao'),
  require('./fluxos/sgp-indisponivel'),
  require('./fluxos/aviso-cidade'),
  require('./fluxos/multiplos-contratos'),
  require('./fluxos/noturno'),
  require('./fluxos/suporte-geral'),
  require('./fluxos/suporte-diagnostico'),
  require('./fluxos/financeiro'),
  require('./fluxos/reativacao'),
  require('./fluxos/comercial-novo'),
  require('./fluxos/comercial-cliente'),
  require('./fluxos/comprovante'),
  require('./fluxos/limite-perguntas'),
  require('./formato'),
];

/** O prompt do sistema do painel abre; os princípios vêm logo depois. */
function montarContexto(estado) {
  const linhas = [estado.config.systemPrompt || ''];
  for (const modulo of MODULOS) {
    if (modulo.entra(estado)) linhas.push(...modulo.linhas(estado));
  }
  return linhas.join('\n');
}

module.exports = { montarContexto, MODULOS };
