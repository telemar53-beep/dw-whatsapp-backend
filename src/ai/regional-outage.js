// Aviso de cidade/localidade como FATO OPERACIONAL (25/09/2026). Caso auditado: com aviso ativo
// na cidade, a IA mandava o cliente reiniciar o roteador e fazer teste de velocidade — o prompt
// do turno foi montado antes de buscar_cliente descobrir a cidade, e a instrução da ferramenta
// de status ("siga o roteiro daquele problema") atropelava o aviso.
//
// O painel/banco diz QUAL aviso está ativo; este módulo diz, em código e sem OpenAI, o que é
// permitido responder enquanto ele vale. Tudo aqui é puro.
//
// O aviso de hoje não tem tipo de impacto nem prazo (city_notices: mensagem, enabled,
// activated_at). `impacto` já existe na forma do fato para a Fase 5 (geral, lentidao,
// instabilidade, sem_conexao, manutencao); enquanto for null, vale como GERAL: explica
// qualquer reclamação de conexão — e nada além disso.

const normalizar = (texto) => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Reclamação de conexão (o que um aviso geral explica).
const CONEXAO = [
  /\bsem (internet|net|conexao|acesso|sinal)\b/, /\b(caiu|caindo|cai toda hora|oscilando|oscila|instavel|instabilidade)\b/,
  /\b(lenta|lento|lentidao)\b/, /\bnao (conecta|esta conectando|funciona|carrega|abre)\b/, /\b(fora do ar|offline|travando)\b/,
  /\b(internet|net|conexao) (ruim|parou|nao)\b/,
];
// Equipamento/instalação danificados: o aviso NÃO explica (não vira desculpa automática).
const DANO = [
  /\b(queimou|queimad[oa]|quebrou|quebrad[oa]|derreteu|arrebentou|pegou fogo|molhou)\b/, /\braio\b/,
  /\b(cabo|fio) (cortado|rompido|partido|arrebentado)\b/, /\bfoi cortado\b/, /\bnao liga (mais)?\b/,
];

function reclamaDeConexao(textos) {
  const lista = (Array.isArray(textos) ? textos : [textos]).map(normalizar).filter(Boolean);
  if (lista.some((t) => DANO.some((r) => r.test(t)))) return false;
  return lista.some((t) => CONEXAO.some((r) => r.test(t)));
}

/**
 * O aviso regional NÃO explica suspensão (a regra de consultar_status_todos_contratos, 25/09/2026;
 * P1-1 da auditoria final: a mesma regra em todos os caminhos). `contratos`: os do atendimento, com
 * `status` normalizado ('suspenso', 'ativo'…). Com o contrato da reclamação determinado (e presente
 * na lista), vale o status DELE; sem alvo determinado, qualquer contrato suspenso afasta o aviso —
 * um contrato ativo nunca mascara a suspensão de outro, e sem saber de qual contrato ele fala não há
 * causa única.
 */
function suspensaoAfastaOAviso(contratos, contratoAlvoId = null) {
  const lista = (Array.isArray(contratos) ? contratos : []).filter(Boolean);
  const alvo = contratoAlvoId == null ? null : lista.find((c) => c.id === contratoAlvoId);
  if (alvo) return alvo.status === 'suspenso';
  return lista.some((c) => c.status === 'suspenso');
}

/** O aviso explica a reclamação? Sem tipo (hoje), vale como geral: só reclamação de conexão. */
function avisoExplicaReclamacao(aviso, textos) {
  if (!aviso) return false;
  return reclamaDeConexao(textos);
}

// O que contradiz uma falha geral conhecida: roteiro individual de equipamento.
const DIAGNOSTICO_INDIVIDUAL = [
  /\breinici/, /\b(desligue|desligar|desliga|religue|religar)\b/, /\b(tire|retire|tirar|retirar) da tomada\b/,
  /\bteste de velocidade\b/, /\bspeed ?test\b/, /\bfast com\b/, /\bmedidor de velocidade\b/,
  /\b(outros?|outras?|demais) (aparelhos?|dispositivos?|celulares?)\b/, /\b(cabo|cabos) (de rede|do roteador|da onu|da ont)\b/,
  /\b(troque|verifique|confira|verificar|conferir) (o|os) cabos?\b/, /\bluz(es)? (vermelha|piscando|do roteador|da onu|da ont|los)\b/,
];
// Prazo: o aviso de hoje não tem previsão; se a resposta tiver e o aviso não, é inventado.
const PRAZO = [
  /\b(em|dentro de|nas proximas|ate) \d+ ?(h|hs|hora|horas|min|minuto|minutos)\b/, /\bprevisao\b/,
  /\bate (amanha|hoje|o fim do dia|o final do dia|a noite)\b/, /\b(volta|voltara|normaliza|normalizara|restabelec\w*) (em breve|logo|ainda hoje)\b/,
  /\bem breve\b/, /\bas \d{1,2} ?(h|horas)\b/,
];
const ATUACAO = [/\b(estamos|equipe esta|equipe ja esta|ja estamos|tecnicos estao|equipe) (resolvendo|trabalhando|atuando)\b/, /\bequipe atuando\b/];

const algum = (lista, texto) => lista.some((r) => r.test(texto));

/** A resposta contradiz o aviso ativo? Diagnóstico individual, ou prazo/atuação que o aviso não traz. */
function contradizAviso(texto, aviso) {
  const t = normalizar(texto);
  if (!t) return false;
  const doAviso = normalizar(aviso && aviso.mensagem);
  if (algum(DIAGNOSTICO_INDIVIDUAL, t)) return true;
  if (algum(PRAZO, t) && !algum(PRAZO, doAviso)) return true;
  if (algum(ATUACAO, t) && !algum(ATUACAO, doAviso)) return true;
  return false;
}

/**
 * O que sai no lugar de uma resposta que contradiz o aviso: só o fato, sem prazo, sem atuação.
 * Com o aviso JÁ ENVIADO ao cliente neste turno (marca transitória `enviadoNesteTurno`), a
 * ocorrência não é repetida: sai só a orientação de não testar o equipamento — um aviso por turno.
 */
function respostaSeguraDoAviso(aviso) {
  if (aviso && aviso.enviadoNesteTurno === true) return 'Não é necessário fazer nenhum teste no seu equipamento agora.';
  const lugar = (aviso && aviso.cidade) ? ` em ${aviso.cidade}` : ' na sua região';
  return `Há uma ocorrência registrada pela nossa equipe na rede${lugar}, que pode estar afetando a sua conexão. Não é preciso fazer nenhum teste no seu equipamento agora.`;
}

/** Instrução para o MODELO, nas ferramentas que descobrem o aviso ou tratam de conexão. */
function instrucaoDoAvisoAtivo(aviso) {
  const jaEnviado = aviso.enviadoNesteTurno === true
    ? ' Esse aviso JÁ FOI ENVIADO ao cliente agora, em mensagem separada: NÃO repita a ocorrência nem o texto do aviso.'
    : '';
  return `Há AVISO ATIVO da empresa para ${aviso.cidade}: "${aviso.mensagem}".${jaEnviado} Se a reclamação é de internet lenta, caindo, instável ou sem acesso, é essa falha regional: informe que há uma ocorrência na rede nesse local, NÃO peça reiniciar, desligar ou testar equipamento, velocidade ou outros aparelhos, NÃO prometa previsão e NÃO diga que a equipe já está resolvendo se o aviso não disser isso; conclua para o setor da lista que cuida de suporte com "falha regional" no resumo. Se o problema for outro (equipamento danificado, cabo rompido, pedido financeiro), atenda normalmente.`;
}

/** O fato seguro que vai no resultado da ferramenta. */
function avisoParaResultado(aviso) {
  return {
    local: aviso.cidade,
    mensagem: aviso.mensagem,
    ...(aviso.desde ? { desde: aviso.desde } : {}),
    ...(aviso.enviadoNesteTurno === true ? { jaEnviadoAoCliente: true } : {}),
  };
}

module.exports = {
  reclamaDeConexao, avisoExplicaReclamacao, contradizAviso, respostaSeguraDoAviso, instrucaoDoAvisoAtivo, avisoParaResultado,
  suspensaoAfastaOAviso,
};
