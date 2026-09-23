// Como a linha de um plano se escreve, em UM lugar só.
//
// Teste real de 2026-09-22: a IA ofereceu "500 Mega — 500 Mbps — R$ 100/mês".
// Três módulos (comercial-novo, comercial-cliente e fatos) mandavam "manter
// junto o nome, a velocidade, a mensalidade e a instalação" — a ordem estava
// certa contra TROCAR valores entre planos, e errada ao exigir a velocidade
// sempre. Corrigir os três com textos parecidos, mas diferentes, é como a
// incoerência comercial nasceu da primeira vez: a frase mora aqui e eles a
// citam.
//
// Quem decide se a velocidade entra é consultar_planos, não o modelo: o
// `rotulo` já vem montado do tool-registry (ver nomeJaDizVelocidade). Aqui só
// se diz para usá-lo como veio.
const ROTULO_DE_PLANO = 'escreva o `rotulo` de cada plano EXATAMENTE como veio (ele já traz o nome, a mensalidade e a velocidade SÓ quando o nome não a diz) e nunca acrescente a velocidade a um rótulo que não a traz; com `instalacaoComum`, escreva a instalação UMA vez depois da lista, nunca por linha';

module.exports = { ROTULO_DE_PLANO };
