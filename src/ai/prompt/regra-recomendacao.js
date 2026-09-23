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

// Teste real de 2026-09-22, terceira rodada: depois de recomendar 700 Mega, o
// cliente disse "Ok muito obrigado" e a IA respondeu "Vou encaminhar você para
// o Comercial".
//
// Cortesia de fim de conversa não é intenção de contratar. O fluxo financeiro
// já sabia disso (fluxos/financeiro.js trata "obrigado"/"valeu"/"ok" com uma
// despedida); o comercial não tinha regra nenhuma para esse momento, e o
// agradecimento caiu na cláusula de encaminhamento por falta de lugar melhor.
//
// O gatilho passa a exigir presença de intenção dita com todas as letras, em vez
// de ausência de assunto pendente — ausência é exatamente o que um "obrigado"
// significa.
const AGRADECIMENTO_NAO_E_INTENCAO = 'Agradecer ou fechar a conversa com cordialidade ("ok", "obrigado", "valeu", "entendi", "tá bom", uma despedida) NÃO é escolha de plano, NÃO é pedido para contratar e NÃO é pedido de atendente: não encaminhe e não conclua por causa disso. Responda curto e cordial, deixando a porta aberta, no modelo: "Por nada 😊 Se quiser seguir com a instalação, é só me chamar." Só encaminhe quando ele disser com todas as letras que quer avançar ("quero contratar", "pode instalar", "vamos fechar", "quero esse plano") ou pedir para falar com um atendente.';

module.exports = { QUANTIDADE_NAO_E_USO, CATALOGO_JA_APRESENTADO, AGRADECIMENTO_NAO_E_INTENCAO };
