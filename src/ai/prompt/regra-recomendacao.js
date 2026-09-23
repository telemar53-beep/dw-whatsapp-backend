// O que basta — e o que NÃO basta — para escolher uma velocidade.
//
// Teste real de 2026-09-22, depois de c29c6d1: o cliente disse "Tenho 2 TVs e
// 7 filhos" e a IA recomendou 600 Mega justificando com "vários aparelhos ao
// mesmo tempo". Ele nunca disse isso.
//
// A frase não veio do histórico: o prompt a fabricou. A regra antiga deixava o
// modelo julgar ("se o que ele já contou bastar, recomende direto") e ao mesmo
// tempo exigia "uma frase curta de motivo", tendo definido que o único motivo
// válido é o uso SIMULTÂNEO. Decidida a recomendação, afirmar simultaneidade
// era a única saída que obedecia às três ordens juntas.
//
// A guarda anterior ("não escolha pela quantidade de pessoas ou de filhos")
// não impediu nada: trocou a REDAÇÃO da justificativa, não a DECISÃO — e o
// resultado ficou menos rastreável, porque "porque você tem 7 filhos" ao menos
// mostrava o raciocínio errado.
//
// Aqui a quantidade é nomeada como insuficiente e a pergunta deixa de ser
// opcional. Mora num arquivo só porque comercial-novo e comercial-cliente
// carregam a MESMA regra: corrigir os dois com textos parecidos porém
// diferentes foi como a incoerência comercial nasceu da primeira vez.
const QUANTIDADE_NAO_E_USO = 'QUANTIDADE NÃO É USO: número de filhos, de pessoas na casa, de TVs, de celulares ou de aparelhos, sozinho, NÃO diz como a internet é usada e NÃO basta para escolher velocidade — "tenho 2 TVs e 7 filhos" é quantidade, não uso. Sem saber o uso SIMULTÂNEO, faça UMA pergunta útil antes de recomendar (se esses aparelhos costumam ficar ligados ao mesmo tempo, e se há streaming em TV, trabalho ou jogo online) e NÃO recomende neste mesmo turno. Só recomende depois que ele responder sobre o uso ao mesmo tempo. NUNCA afirme que ele usa vários aparelhos ao mesmo tempo se ele não disse isso: não invente o uso para justificar o plano.';

// Consultar o catálogo de novo é obrigação (o preço tem de vir do cadastro) e
// não autoriza reapresentar nada. Era essa confusão que fazia a tabela inteira
// voltar toda vez que consultar_planos era chamada.
const CATALOGO_JA_APRESENTADO = 'Se os planos JÁ foram apresentados antes nesta conversa (o histórico acima mostra), NÃO repita a tabela: repetir faz a conversa andar para trás. Você PODE chamar consultar_planos de novo para ter o preço atualizado — consultar NÃO é reapresentar, e uma nova consulta não manda mostrar os planos outra vez. Reapresente todas as opções SÓ se ele pedir para rever, comparar ou ver os planos de novo; para comparar dois, mostre só esses dois.';

module.exports = { QUANTIDADE_NAO_E_USO, CATALOGO_JA_APRESENTADO };
