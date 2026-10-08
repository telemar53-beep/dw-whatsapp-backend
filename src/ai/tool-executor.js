const { findTool, perfilTriagem, temEfeitoReal, FERRAMENTAS_PERMITIDAS_EM_TERCEIRO } = require('./tool-registry');
const { documentosNoTexto, violacoesDoDocumento } = require('./documento-pendente');
const { FERRAMENTAS_DE_COBRANCA, alvoFinanceiro, AMBIGUIDADE, documentosValidos } = require('./financial-target');
const { minimizarParaTerceiro } = require('./third-party-minimize');
const { isToolEnabled } = require('./ai-config.repository');
const { mensagemSegura } = require('./safe-error-log');

const TIMEOUT_PADRAO_MS = 15000;

/**
 * `detalhe` é auditoria (pode carregar texto interno bruto: "connect
 * ECONNREFUSED 10.0.0.5:5432", um id de contrato). `instrucao` é o oposto:
 * texto escrito à mão para o MODELO ler — só uma recusa que declara uma
 * chega ao contexto dele. Os dois campos existem separados de propósito; usar
 * `detalhe` para as duas coisas devolveria o endereço do banco ao modelo.
 */
function recusa(motivo, detalhe, instrucao) {
  return {
    ok: false,
    motivo,
    detalhe: detalhe === undefined ? null : detalhe,
    ...(instrucao ? { instrucao } : {}),
  };
}

// C4 v2 (04/10/2026): erro e tempo esgotado de uma ferramenta que declara `instrucaoSemConfirmacao` (hoje só
// concluir_triagem) chegam ao modelo com esse texto. Sem ele, a recusa seca fez o modelo inventar a causa da falha.
// Nunca lança: uma falha aqui não pode trocar a recusa por uma exceção.
// Conclusão do atendimento (04/10/2026): a recusa que levou essa instrução fica marcada (semConfirmacao). O orquestrador
// grava a marca no registro das interações, e o turno seguinte sabe que o encaminhamento foi tentado e não concluído.
function marcarSemConfirmacao(r) {
  return r && r.instrucao ? { ...r, semConfirmacao: true } : r;
}

function instrucaoSemConfirmacao(nome, args) {
  try {
    const tool = findTool(nome);
    return tool && typeof tool.instrucaoSemConfirmacao === 'function' ? tool.instrucaoSemConfirmacao(args) : undefined;
  } catch (err) {
    return undefined;
  }
}

// A recusa chegava ao modelo como { erro: 'identity_not_confirmed' } seco e ele
// improvisava (defeito D, teste real 2026-09-14). Era esta linha, e não o
// prompt, que fazia a IA pedir um dado errado em produção: resultado de
// ferramenta o modelo lê como fato apurado.
const INSTRUCAO_IDENTIDADE = 'Ainda não sei quem é o cliente. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo.';
// Documento pendente (25/09/2026): com o documento de quem fala JÁ pedido e ainda não informado, a
// instrução acima fazia o modelo pedir de novo a cada tentativa de consulta (caso real: três
// pedidos seguidos). A ação continua recusada do mesmo jeito.
const INSTRUCAO_IDENTIDADE_JA_PEDIDA = 'Ainda não sei quem é o cliente, e o CPF ou CNPJ JÁ foi pedido: NÃO peça de novo agora. Responda ao que ele disse sem consultar nada; esta ferramenta só funciona depois de buscar_cliente com o documento.';
// F1 (30/09/2026, terceira revisão): com o esclarecimento da cadeia disponível, a recusa não ordena pedir
// (seria pedir em todo atendimento) nem proíbe (desmentiria a permissão). Quem decide se cabe é o modelo.
const INSTRUCAO_IDENTIDADE_ESCLARECER = 'Ainda não sei quem é o cliente, e o CPF ou CNPJ já foi pedido; esta ferramenta só funciona depois de buscar_cliente com o documento. Se ele tentou responder sem o dado, você pode esclarecer uma vez o que falta; se não, responda ao que ele disse sem pedir de novo e sem consultar nada.';

// Só entra em jogo quando o contrato pedido é o do terceiro (contexto.terceiro)
// e a ferramenta NÃO está em FERRAMENTAS_PERMITIDAS_EM_TERCEIRO — as demais
// recusas (contract_not_owned, identity_not_confirmed) já têm a própria
// instrução, ou não precisam de uma.
const INSTRUCAO_TERCEIRO = 'Este contrato é de outra pessoa. Nesse caso você só pode consultar a fatura e entregar o boleto ou o PIX. Plano, conexão, status e liberação não podem ser consultados nem executados no contrato de terceiro. Se o cliente pediu uma dessas coisas, explique que só o titular pode solicitar.';

// Caso Fulana/Beltrana (25/09/2026): o pedido de cobrança em andamento é de OUTRA pessoa e a
// ferramenta veio com um contrato que não é dela. Nada é enviado.
const INSTRUCAO_ALVO_TERCEIRO = 'O pedido de cobrança em andamento é da OUTRA pessoa (a do CPF/CNPJ informado). Só os contratos dela podem ser usados; o contrato de quem está falando NÃO pode, e nada foi enviado. Se o CPF/CNPJ dela não foi localizado, peça para conferir o número. Se não estiver claro de quem é a cobrança, pergunte, curto, se ele quer a própria cobrança ou a do titular localizado pelo CPF ou CNPJ informado, chamando esse titular pelo primeiro nome. NÃO peça o CPF de quem está falando: ele já está identificado — quando ele disser que quer a própria cobrança, ela volta a ser dele.';

// Decisão do dono (25/09/2026): intenção de alvo dos dois lados na mensagem do cliente (ou
// menção a outra pessoa sem o CPF dela). Nenhuma cobrança sai até ele esclarecer.
const INSTRUCAO_ALVO_AMBIGUO = 'Não está claro de quem é a cobrança. NÃO envie nada. Pergunte, curto: "Você quer a sua cobrança ou a da outra pessoa?". Se for de outra pessoa, peça o CPF ou CNPJ do titular dela.';
// F2 (decisão 4 do gerente, 30/09/2026): com um terceiro já registrado, o cliente citou uma pessoa por
// relação ("minha mãe") e nada prova que é o titular registrado. Nenhum dos dois é cobrado por suposição;
// só um documento consultado resolve. O sistema não conhece a relação entre as pessoas: a instrução não
// a afirma nem a repete.
// Revisão da F2 (30/09/2026): com terceiro localizado, a dúvida é entre a própria cobrança e a DELE — a
// pergunta nomeia esse titular, para a resposta apontar para ele ("a da Beltrana", "a dela") e não para
// "a outra pessoa", que agora significa alguém novo.
const INSTRUCAO_ALVO_AMBIGUO_COM_TERCEIRO = 'Não está claro de quem é a cobrança. NÃO envie nada. Pergunte, curto, se ele quer a própria cobrança ou a do titular localizado pelo CPF ou CNPJ já informado, chamando esse titular pelo primeiro nome. Se for de uma terceira pessoa, peça o CPF ou CNPJ do titular dela.';
// O worker não conseguiu ler o escopo do turno: não se sabe se há terceiro nem dúvida gravada.
const INSTRUCAO_ALVO_NAO_CONFIRMADO = 'Não foi possível confirmar agora de quem é a cobrança. NÃO envie nada e não diga que enviou: diga, curto, que não dá para seguir com a cobrança neste momento e continue com o que não depende dela.';
// Terceira revisão da F2 (30/09/2026): o escopo venceu com uma dúvida gravada. O prazo encerra a autorização,
// não a dúvida: nenhum contrato vale (nem o de antes, nem o de quem fala) até ele dizer que é a própria
// cobrança ou informar o documento.
const INSTRUCAO_TERCEIRO_EXPIRADO = 'O pedido de cobrança de outra pessoa feito antes nesta conversa não vale mais, e ainda não ficou claro de quem é a cobrança. NÃO envie nada — nem da outra pessoa, nem de quem está falando. Pergunte, curto, se ele quer a própria cobrança ou a de outra pessoa; se for de outra pessoa, peça o CPF ou CNPJ do titular, mesmo que seja o mesmo já informado. Não diga que sabe quem é essa pessoa.';
// Pedido por endereço (06/10/2026): a rua citada bate com mais de um contrato dele — ou, com a dúvida gravada, ele disse que é
// a dele e tem mais de um (revisão do v4, achado A5). Não é dúvida sobre outra pessoa: não se pede documento.
const INSTRUCAO_ENDERECO_AMBIGUO = 'Não ficou claro de qual contrato dele é a cobrança: o endereço citado bate com mais de um contrato dele, ou ele disse que é a dele e tem mais de um. NÃO envie nada. Pergunte, curto, de qual endereço é a cobrança, citando o endereço completo (com o número) de cada contrato dele; se os endereços forem iguais, cite também o plano de cada um. NÃO peça CPF nem CNPJ: os contratos são dele.';
// Dúvida de endereço (07/10/2026): a rua que ele citou não se liga com segurança a um contrato dele. Pergunta o endereço, sem
// pedir documento e sem dizer que é de outra pessoa; o documento só se ele disser que é de outra pessoa.
const INSTRUCAO_ENDERECO_DESCONHECIDO = 'O que ele citou não dá para ligar com segurança a um contrato dele: um endereço que não é o de nenhum contrato, um número que não é o do cadastro, ou um nome que tanto pode ser o do endereço dele quanto o de uma pessoa. NÃO envie nada, não diga que é de outra pessoa e NÃO peça CPF ou CNPJ agora. Pergunte, curto, de qual endereço é a cobrança, citando os endereços (com o número) dos contratos dele. Só se ele disser que é de outra pessoa, peça o CPF ou CNPJ do titular dela.';
// Rodada 9 (N4-C): a última fala dele pode ser a desistência do pedido. Nada sai; ele decide se ainda quer.
const INSTRUCAO_DESISTENCIA = 'NADA foi enviado: a mensagem dele pode ser uma desistência do pedido. Não envie nada agora e não diga que enviou; pergunte, curto, se ele ainda quer a cobrança.';
const instrucaoDoEnderecoEscolhido = (contratos) => (contratos.length === 1
  ? `O cliente pediu a cobrança do endereço do contrato ${contratos[0]}. NÃO use outro contrato e nada foi enviado: chame a ferramenta de novo com contratoId ${contratos[0]}.`
  : `O cliente pediu a cobrança dos endereços dos contratos ${contratos.join(' e ')}. NÃO use outro contrato e nada foi enviado: chame a ferramenta de novo com um desses contratoId.`);
// Os contratos que o cliente escolheu pela rua: um, ou mais de um em falas seguidas.
function contratosEscolhidosDoContexto(contexto) {
  if (contexto && Array.isArray(contexto.contratosEscolhidos) && contexto.contratosEscolhidos.length) return contexto.contratosEscolhidos.map(String);
  return contexto && contexto.contratoEscolhido ? [String(contexto.contratoEscolhido)] : null;
}
const INSTRUCAO_TERCEIRO_NAO_VINCULADO = 'Ele citou uma pessoa que não dá para ligar com segurança ao titular do CPF ou CNPJ já informado nesta conversa. NÃO envie nada — nem desse titular, nem de quem está falando. Pergunte, curto, de quem é a cobrança e peça o CPF ou CNPJ desse titular, mesmo que seja o mesmo já informado: só com o documento consultado a cobrança pode sair. Não diga que sabe quem é essa pessoa nem qual a relação dela com quem fala.';

const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

// A recusa por alvo em dúvida. O valor de alvoAmbiguo é o motivo (financial-target.js, AMBIGUIDADE): vai no
// detalhe, que fica em ai_interactions, e escolhe a instrução.
const DUVIDAS_ENTRE_PROPRIO_E_TERCEIRO = new Set([AMBIGUIDADE.DOIS_LADOS, AMBIGUIDADE.REFERENCIA_INCOMPLETA, AMBIGUIDADE.PROPRIO_NAO_AFIRMADO]);
function recusaPorAlvoEmDuvida(contexto) {
  const motivo = typeof contexto.alvoAmbiguo === 'string' ? contexto.alvoAmbiguo : null;
  const terceiroLocalizado = Boolean(contexto.terceiro && Array.isArray(contexto.terceiro.contratos) && contexto.terceiro.contratos.length > 0);
  let instrucao = INSTRUCAO_ALVO_AMBIGUO;
  if (motivo === AMBIGUIDADE.TERCEIRO_NAO_VINCULADO) instrucao = INSTRUCAO_TERCEIRO_NAO_VINCULADO;
  else if (motivo === AMBIGUIDADE.TERCEIRO_EXPIRADO) instrucao = INSTRUCAO_TERCEIRO_EXPIRADO;
  else if (motivo === AMBIGUIDADE.ESCOPO_NAO_LIDO || motivo === AMBIGUIDADE.TRANSICAO_NAO_GRAVADA) instrucao = INSTRUCAO_ALVO_NAO_CONFIRMADO;
  else if (motivo === AMBIGUIDADE.ENDERECO_AMBIGUO) instrucao = INSTRUCAO_ENDERECO_AMBIGUO;
  else if (motivo === AMBIGUIDADE.ENDERECO_DESCONHECIDO) instrucao = INSTRUCAO_ENDERECO_DESCONHECIDO;
  else if (motivo === AMBIGUIDADE.DESISTENCIA) instrucao = INSTRUCAO_DESISTENCIA;
  else if (terceiroLocalizado && DUVIDAS_ENTRE_PROPRIO_E_TERCEIRO.has(motivo)) instrucao = INSTRUCAO_ALVO_AMBIGUO_COM_TERCEIRO;
  return recusa('financial_target_ambiguous', motivo, instrucao);
}

// O documento do titular DA CONVERSA: o vínculo gravado no contato, ou o da identidade forte
// resolvida neste turno (a identificação pelo telefone também traz o documento).
function documentoDoTitularDaConversa(contexto) {
  const doContato = soDigitos(contexto && contexto.contact && contexto.contact.sgpDocument);
  if (doContato) return doContato;
  const identidade = contexto && contexto.identidade;
  if (identidade && identidade.nivel === 'forte' && identidade.client) return soDigitos(identidade.client.document);
  return '';
}

// Pendências do atendimento (04/10/2026; avaliação real r2 E12 #4 e r3 E6 #4): o modelo inventou um documento para
// buscar_cliente ("00000000000") com quem fala já identificado. Na triagem, um CPF diferente do titular vira consulta de
// terceiro, que grava o pendente e troca o alvo antes de o SGP responder — e o modelo passou a pedir documento a quem já
// estava identificado. O documento só vale com ORIGEM: escrito pelo cliente numa fala desta conversa (a janela que o modelo
// vê: texto, transcrição ou legenda), ou o do titular já confirmado no cadastro. Formato e dígito verificador não provam
// origem. Sem origem, nada é consultado nem gravado: a identidade confirmada e o alvo ficam como estavam. Vale quando o
// turno informa as falas do cliente (o orquestrador, único chamador em produção, sempre informa).
// Revisão (04/10/2026): igualdade com um número de 11 ou 14 dígitos que ele escreveu (documentosNoTexto, o mesmo leitor do
// documento pendente) — nunca pedaço de número, como o do contrato. Vale também: a fala cujos dígitos, todos, formam o
// documento ("529, 982, 247-25", "529.982.247 - 25", ditado dígito a dígito com pausas); o ditado por extenso (áudio
// transcrito: "cinco dois nove", "meia"), só em sequências de duas ou mais palavras-dígito — "uma dúvida" e "um abraço"
// não viram dígito; e o partido em duas falas seguidas ("529.982" e depois "247-25").
const DIGITO_FALADO = { zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', meia: '6', sete: '7', oito: '8', nove: '9' };
const SEQUENCIA_FALADA = /\b(?:zero|uma?|dois|duas|tres|quatro|cinco|seis|meia|sete|oito|nove)(?:[\s,.-]+(?:zero|uma?|dois|duas|tres|quatro|cinco|seis|meia|sete|oito|nove))+\b/g;
const PALAVRA_DIGITO = /\b(?:zero|uma?|dois|duas|tres|quatro|cinco|seis|meia|sete|oito|nove)\b/g;
const comDigitosFalados = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(SEQUENCIA_FALADA, (sequencia) => sequencia.replace(PALAVRA_DIGITO, (palavra) => DIGITO_FALADO[palavra]));
// Fechamento limitado (04/10/2026; não impeditivo B4 da conferência das pendências, e revisão do delta): somar os dígitos
// de uma fala inteira, ou de duas falas seguidas, juntava números sem relação (telefone e "12", contrato, dia e valor, um
// CPF e "123" virando CNPJ), e a igualdade com o número do modelo passava por origem. Igualdade numérica sozinha não prova
// origem:
// - CPF ou CNPJ com dígito verificador válido é condição necessária, nunca suficiente: o número ainda tem de estar numa
//   fala do cliente;
// - o número escrito de uma vez (o leitor do documento pendente, documentosNoTexto) vale em qualquer fala dele: "Bom dia
//   52998224725", "manda o boleto da minha mãe 111.444.777-35", "esse cadastro não é meu, é 52998224725";
// - o número montado de pedaços — com pausas (vírgulas, traço com espaços) ou partido em duas falas seguidas — só vale com
//   contexto de documento: a palavra cpf/cnpj/documento na fala dele (fora os marcadores do sistema, como "[cliente enviou
//   um documento]"), a fala ser só o número, ou a resposta anterior da IA marcada como pedido de documento (a marca, não
//   uma palavra solta no texto da IA). Na junção, o primeiro pedaço não pode já ser um documento completo.
// Sem a janela em ordem (chamador sem as mensagens), valem as falas do cliente, sem o pedido da IA. Resta (registrado): um
// número de 11 ou 14 dígitos escrito de uma vez, ou uma junção com contexto, que por acaso tenha dígito verificador válido
// (cerca de 1 em 100) e que o modelo passe exatamente como documento.
const EXPRESSAO_NUMERICA = /\d(?:[\s.,\-–/]*\d)*/g;
const NUMERO_NO_FIM = /(\d(?:[\s.,\-–/]*\d)*)[\s.,;:!?\-–/]*$/;
const SO_NUMERO = /^[\d\s.,\-–/]+$/;
const PALAVRA_DE_DOCUMENTO = /\b(?:cpf|cnpj|documento)\b/;
const MARCADOR_DO_SISTEMA = /\[cliente [^\]]*\]/g;
const ehDocumento = (digitos) => digitos.length === 11 || digitos.length === 14;
const documentoValido = (digitos) => documentosValidos(digitos).includes(digitos);
function janelaDaOrigem(contexto) {
  if (Array.isArray(contexto.mensagensDaJanela)) return contexto.mensagensDaJanela.filter((m) => m && (m.de === 'cliente' || m.de === 'ia'));
  return contexto.falasDoCliente.map((texto) => ({ de: 'cliente', texto }));
}
function documentosApresentados(contexto) {
  const documentos = new Set();
  const falas = [];
  let pedidoDaIa = false;
  for (const mensagem of janelaDaOrigem(contexto)) {
    if (mensagem.de === 'ia') {
      pedidoDaIa = mensagem.pediuDocumento === true;
      continue;
    }
    const original = String(mensagem.texto || '').replace(MARCADOR_DO_SISTEMA, ' ');
    const texto = comDigitosFalados(original);
    for (const d of [...documentosNoTexto(original), ...documentosNoTexto(texto)]) if (documentoValido(d)) documentos.add(d);
    const comPalavraOuPedido = pedidoDaIa || PALAVRA_DE_DOCUMENTO.test(texto);
    if (comPalavraOuPedido || SO_NUMERO.test(texto.trim())) {
      for (const d of (texto.match(EXPRESSAO_NUMERICA) || []).map(soDigitos)) if (documentoValido(d)) documentos.add(d);
    }
    falas.push({ texto, comPalavraOuPedido });
  }
  for (let i = 0; i + 1 < falas.length; i += 1) {
    const [a, b] = [falas[i], falas[i + 1]];
    if (!(a.comPalavraOuPedido || b.comPalavraOuPedido) || !SO_NUMERO.test(b.texto.trim())) continue;
    const fim = a.texto.match(NUMERO_NO_FIM);
    if (!fim) continue;
    const pedaco = soDigitos(fim[1]);
    const junto = pedaco + soDigitos(b.texto);
    if (!ehDocumento(pedaco) && documentoValido(junto)) documentos.add(junto);
  }
  return documentos;
}
function documentoTemOrigem(documento, contexto) {
  if (!contexto || !Array.isArray(contexto.falasDoCliente)) return true;
  if (documento && documento === documentoDoTitularDaConversa(contexto)) return true;
  return Boolean(documento) && documentosApresentados(contexto).has(documento);
}

// Rodada 8 (N1, avaliação real do endereço: 3 de 3 conversas): com a terceira localizada e a dúvida gravada por "a rua do
// João", o modelo reconsultou o CPF dela, que estava na abertura, e a consulta gravou de novo a terceira localizada — a dúvida
// sumiu e o boleto dela podia ser reenviado. Depois de "a minha fatura", a mesma reconsulta trouxe a terceira de volta e barrou
// a cobrança dele. A presença do documento no histórico não prova que a dúvida de agora foi esclarecida: com dúvida financeira
// no turno (gravada no escopo ou do próprio turno; as técnicas não contam), ou depois de ele voltar à própria cobrança neste
// turno, o documento de OUTRA pessoa só vale se estiver numa fala NOVA deste turno (a origem efetiva: as falas que o worker
// aplicou agora). Mandado de novo por ele, segue as regras de sempre. Sem a lista das falas novas (outro chamador), nada muda.
const DUVIDAS_TECNICAS = new Set(['escopo_nao_lido', 'transicao_nao_gravada']);
function restricaoDoHistorico(contexto) {
  if (!contexto || !Array.isArray(contexto.falasNovasDoCliente)) return null;
  const gravada = contexto.terceiro && contexto.terceiro.alvoPendente;
  const doTurno = typeof contexto.alvoAmbiguo === 'string' && !DUVIDAS_TECNICAS.has(contexto.alvoAmbiguo);
  if (gravada || doTurno) return 'duvida';
  return contexto.alvoVoltouAoTitular === true ? 'titular' : null;
}
// A origem efetiva: a entrada que deixou o alvo como está — a da dúvida gravada (duvidaDesde) ou, para a dúvida só do turno e
// para a volta ao titular, a do lote deste turno (origemDoAlvoNoTurno). Revisão da rodada 8 (achado 2): só a janela A PARTIR
// dela vale; o documento numa fala anterior, mesmo no lote do turno, não. O pedido de terceiro que já trazia o CPF na mesma
// mensagem continua valendo (a origem é ela). Origem desconhecida (escopo de antes desta versão, ou fora da janela): só as
// falas novas do turno.
function origemDaRestricao(contexto, restricao) {
  if (restricao === 'titular') return contexto.origemDoAlvoNoTurno || null;
  const gravada = contexto.terceiro && contexto.terceiro.alvoPendente;
  // Revisão do incremento (achado C): a origem do lote deste turno, quando há, é sempre posterior à gravada — vale ela (a mesma
  // dúvida desfeita e refeita no lote não deixa a janela antiga valendo).
  return (gravada ? (contexto.origemDoAlvoNoTurno || contexto.terceiro.duvidaDesde) : contexto.origemDoAlvoNoTurno) || null;
}
function documentoSoDoHistorico(documento, contexto) {
  const restricao = restricaoDoHistorico(contexto);
  if (!restricao || !documento || documento === documentoDoTitularDaConversa(contexto)) return null;
  // Revisão do incremento (achado D): as falas do lote não foram lidas — a origem efetiva é desconhecida, e nenhum documento de
  // outra pessoa esclarece a dúvida neste turno (o seguinte relê o lote).
  if (contexto.falasNovasLidas === false) return restricao;
  const desde = origemDaRestricao(contexto, restricao);
  const janela = Array.isArray(contexto.mensagensDaJanela) ? contexto.mensagensDaJanela : [];
  const i = desde ? janela.findIndex((m) => m && m.id === desde) : -1;
  const valem = i >= 0 ? documentosApresentados({ mensagensDaJanela: janela.slice(i) }) : documentosDasFalasNovas(contexto, janela);
  return valem.has(documento) ? null : restricao;
}
// Revisão da rodada 8 (achado 3): sem a origem na janela, as falas novas do turno lidas pela janela EM ORDEM — a partir da primeira
// delas, com a mensagem da IA logo antes (o pedido de documento marcado, que vale para o documento partido em duas falas). Sem
// os ids, os textos soltos (o chamador antigo).
function documentosDasFalasNovas(contexto, janela) {
  const ids = new Set(Array.isArray(contexto.idsDasFalasNovas) ? contexto.idsDasFalasNovas : []);
  const i = janela.findIndex((m) => m && ids.has(m.id));
  if (i < 0) return documentosApresentados({ falasDoCliente: contexto.falasNovasDoCliente });
  return documentosApresentados({ mensagensDaJanela: janela.slice(i > 0 && janela[i - 1] && janela[i - 1].de === 'ia' ? i - 1 : i) });
}
// Revisão da rodada 8 (achado 1): a instrução segue a mesma divisão da guarda do documento (documento-pendente.js) — só a
// dúvida que pede documento manda pedi-lo de novo; com a dúvida fraca ou de endereço, pedir documento seria barrado.
const DUVIDAS_QUE_PEDEM_DOCUMENTO = new Set(['terceiro_nao_vinculado', 'outra_pessoa_sem_documento', 'terceiro_expirado']);
const DUVIDAS_DE_ENDERECO = new Set(['endereco_ambiguo', 'endereco_desconhecido']);
// A frase do pedido que a instrução manda fazer, conferida pela guarda do documento antes de mandar pedir.
const PEDIDO_DO_DOCUMENTO_DO_TITULAR = 'Se for de outra pessoa, me mande o CPF ou CNPJ do titular.';
function instrucaoDoDocumentoDoHistorico(restricao, contexto) {
  if (restricao === 'titular') {
    // Rodada 10 (S5 r3 #2): a recusa dizia só "siga com a cobrança dele" — o modelo devolveu a ação ao cliente ("me peça para
    // enviar o boleto ou o PIX"). Com ele identificado, a recusa devolve o pedido dele com o bloco do alvo (contrato e meio).
    const identidade = contexto && contexto.identidade;
    if (identidade && identidade.nivel === 'forte' && !identidade.contestado) {
      return 'NADA foi consultado, e não precisa: ele acabou de dizer que a cobrança é dele, e ele já está identificado. O CPF ou CNPJ de outra pessoa que já estava na conversa não vale agora. O pedido dele continua valendo — não peça que ele repita o pedido nem documento: siga com a cobrança dele como está em ALVO FINANCEIRO AGORA. Com o contrato e o meio definidos lá, entregue por esse meio (enviar_boleto ou gerar_pix); sem contrato definido, pergunte só de qual endereço é; sem meio definido lá, pergunte só se ele quer boleto ou PIX.';
    }
    return 'NADA foi consultado: ele acabou de dizer que a cobrança é dele. O CPF ou CNPJ de outra pessoa que já estava na conversa não vale agora: siga com a cobrança dele, pelo cadastro que você já tem.';
  }
  const motivo = (contexto.terceiro && contexto.terceiro.alvoPendente) || contexto.alvoAmbiguo;
  // Revisão da rodada 8 (achados 3 e 4): o número pode só não ter vindo numa mensagem dele depois da dúvida (não "já estava na
  // conversa"), e pode ser dele mesmo, se ele ainda não está identificado — a instrução não diz de quem é.
  const inicio = 'NADA foi consultado: este CPF ou CNPJ não veio numa mensagem dele depois da dúvida de agora, e consultá-lo assim não esclarece a cobrança. Não envie nada de ninguém.';
  if (DUVIDAS_QUE_PEDEM_DOCUMENTO.has(motivo)) {
    // Revisão do incremento (achado B): a guarda do documento barraria o pedido (ele se irritou, ou a cadeia de pedidos se
    // esgotou) — sem a contradição "peça de novo" × "NÃO peça de novo": não pede, e oferece o atendente.
    if (violacoesDoDocumento(PEDIDO_DO_DOCUMENTO_DO_TITULAR, contexto).length > 0) {
      return `${inicio} NÃO peça o CPF ou CNPJ de novo, nem com outras palavras: o pedido já foi feito. Diga, curto e sem repreender, que por aqui não dá para confirmar de quem é a conta, e pergunte se ele prefere seguir com um atendente; só diga que encaminhou depois de chamar concluir_triagem.`;
    }
    return `${inicio} Pergunte, curto, de quem é a cobrança e peça que ele mande de novo, nesta conversa, o CPF ou CNPJ do titular da conta, mesmo que seja o mesmo de antes.`;
  }
  if (DUVIDAS_DE_ENDERECO.has(motivo)) {
    return `${inicio} A dúvida de agora é de qual endereço dele é a conta: pergunte, curto, citando os endereços dele; não peça documento.`;
  }
  return `${inicio} Pergunte, curto, se a cobrança é dele ou da pessoa já citada; não peça documento.`;
}

function instrucaoDoDocumentoSemOrigem(contexto) {
  const identidade = contexto && contexto.identidade;
  const identificado = Boolean(identidade && identidade.nivel === 'forte' && !identidade.contestado);
  return identificado
    ? 'NADA foi consultado: este número não foi informado pelo cliente como documento nesta conversa (telefone, contrato, dia ou valor não são documento). Não invente nem complete CPF ou CNPJ. Quem está falando JÁ está identificado: não peça CPF ou CNPJ dele e não consulte de novo; siga com o que ele pediu usando o cadastro que você já tem. Se ele pedir algo de OUTRA pessoa, peça o CPF ou CNPJ dessa pessoa e use só o que ele escrever.'
    : 'NADA foi consultado: este número não foi informado pelo cliente como documento nesta conversa (telefone, contrato, dia ou valor não são documento). Não invente nem complete CPF ou CNPJ: use só o que ele escrever. Se ele ainda não informou, peça o CPF ou CNPJ do titular.';
}

function comTimeout(promise, ms) {
  let timer;
  const estouro = new Promise((resolve) => {
    timer = setTimeout(() => resolve(Symbol.for('timeout')), ms);
  });
  return Promise.race([promise, estouro]).finally(() => clearTimeout(timer));
}

// Nunca loga o objeto de erro inteiro: para chamadas ao SGP, err.cause carrega
// a config do axios (token, cpf/cnpj) e o console imprime a cadeia de causa
// inteira. Mesma disciplina já usada em sgp-client.js (só {status} ou
// {message}); mensagemSegura é a implementação compartilhada, para não
// divergir dela (ver ai-orchestrator.js, que loga a mesma classe de erro).
function logFalha(nome, err) {
  console.error(`AI tool ${nome} failed: ${mensagemSegura(err)}`);
}

// CONTENÇÃO (22/09/2026). Caso real: no perfil assistente, o turno executou
// desbloqueio_confianca e o SGP liberou o acesso da cliente por 3 dias ANTES de
// a atendente ver a sugestão. Sugerir não pode agir.
//
// No assistente há uma pessoa no comando, e é ela quem decide o efeito. A
// ferramenta de leitura continua rodando — é o que monta a sugestão. A de ação
// para aqui, antes de tudo: antes da posse, antes da identidade, antes de
// qualquer chamada externa.
//
// Vale por CLASSIFICAÇÃO (tool-registry: temEfeitoReal), nunca por lista de
// nomes. Categoria desconhecida ou ausente também bloqueia — falha fechada.
//
// A triagem não é tocada: lá não há atendente, e a execução automática é o
// desenho. O gate só atua onde o perfil diz, com todas as letras, "assistente".
const INSTRUCAO_ACAO_HUMANA = 'Esta ação NÃO foi executada e NÃO vai acontecer sozinha: neste atendimento quem executa é a atendente. NÃO diga que fez, que liberou, que transferiu, que encerrou nem que está em andamento. Escreva a sugestão explicando à ATENDENTE o que dá para fazer e o que ela precisa confirmar, e deixe a decisão com ela.';

function exigeAprovacaoHumana(contexto, tool) {
  return contexto && contexto.perfil === 'assistente' && temEfeitoReal(tool);
}

/**
 * A ordem destas verificações é parte do design:
 * existe → habilitada → precisa de aprovação humana → argumentos válidos →
 * o contrato é deste contato → executa com timeout. Nada toca o SGP antes da
 * quinta verificação passar.
 *
 * Tudo fica dentro do try: uma recusa nunca é uma exceção, então qualquer
 * falha inesperada em qualquer um destes passos (inclusive um erro transitório
 * de isToolEnabled, ou um contexto malformado) também vira execution_error
 * em vez de escapar como uma promise rejeitada.
 */
async function executeTool(nome, args, contexto, { timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
  try {
    // Fica true só quando o contrato pedido é o de contexto.terceiro E a
    // ferramenta está em FERRAMENTAS_PERMITIDAS_EM_TERCEIRO — as duas coisas
    // juntas, decidido mais abaixo. É a marca que abre a exceção estreita ao
    // gate de identidade forte, logo depois. A Task 8 também lê esta marca.
    let emTerceiro = false;
    const tool = findTool(nome);
    if (!tool) return recusa('unknown_tool', nome);

    // Um perfil (a triagem) pode trazer a própria lista fixa de ferramentas:
    // ela substitui a tabela de permissões, que governa só o assistente.
    if (Array.isArray(contexto.ferramentasPermitidas)) {
      if (!contexto.ferramentasPermitidas.includes(nome)) return recusa('tool_not_in_profile', nome);
    } else if (!(await isToolEnabled(nome))) {
      return recusa('tool_disabled', nome);
    }

    // Antes de validar argumento, conferir posse ou tocar em qualquer coisa
    // externa: no assistente, ação é proposta, não execução.
    if (exigeAprovacaoHumana(contexto, tool)) {
      return recusa('action_requires_human_approval', nome, INSTRUCAO_ACAO_HUMANA);
    }

    // Com um contrato só, o contratoId é dedutível — e obrigar o modelo a escolher
    // um número que ele não vê direito é de onde vinham escolhas erradas e
    // perguntas desnecessárias ao cliente.
    //
    // Caso Fulana/Beltrana (25/09/2026): era AQUI que o PIX da Fulana saía no pedido da Beltrana —
    // "manda o pix" sem contrato caía no contrato único DA FULANA. Agora a dedução segue o alvo
    // financeiro: com pedido de terceiro em andamento, nunca o contrato de quem fala; nas
    // ferramentas permitidas em terceiro, o contrato único DO TERCEIRO; nas demais, nada é
    // deduzido (o modelo tem de dizer, explicitamente, qual contrato quer).
    const proprios = (contexto && contexto.contracts) || [];
    const alvo = alvoFinanceiro(contexto);
    if (tool.chaveProprietario === 'contratoId'
        && (!args || args.contratoId === undefined || args.contratoId === null)) {
      if (alvo.tipo === 'terceiro') {
        if (FERRAMENTAS_PERMITIDAS_EM_TERCEIRO.includes(nome) && alvo.contratos.length === 1) {
          args = { ...(args || {}), contratoId: alvo.contratos[0] };
        }
      } else if (proprios.length === 1) {
        args = { ...(args || {}), contratoId: proprios[0].id };
      } else if (FERRAMENTAS_DE_COBRANCA.includes(nome) && contexto && contexto.contratoEscolhido) {
        // Pedido por endereço (06/10/2026): o contrato que o cliente escolheu pela rua (um dos dele), só na cobrança.
        const escolhido = proprios.find((c) => String(c.id) === String(contexto.contratoEscolhido));
        if (escolhido) args = { ...(args || {}), contratoId: escolhido.id };
      }
    }

    const validacao = tool.validar(args);
    if (!validacao.ok) {
      // Com o alvo em dúvida não há contrato para deduzir: a recusa certa é a do alvo, com a instrução de
      // perguntar — não um erro de argumento que o modelo não sabe explicar.
      if (FERRAMENTAS_DE_COBRANCA.includes(nome) && contexto && contexto.alvoAmbiguo) return recusaPorAlvoEmDuvida(contexto);
      // Pendências do atendimento (04/10/2026, r3 E6 #4): texto no lugar do documento — o modelo lê o que fazer.
      if (nome === 'buscar_cliente' && perfilTriagem(contexto) && Array.isArray(contexto.falasDoCliente)) {
        return recusa('invalid_args', validacao.erro, instrucaoDoDocumentoSemOrigem(contexto));
      }
      return recusa('invalid_args', validacao.erro);
    }
    let argsValidados = validacao.args;

    if (nome === 'buscar_cliente') {
      // Exceção deliberada, e só para esta ferramenta por nome: é o passo que
      // estabelece a identificação, então não há contrato para conferir. Em
      // troca, trocar de cliente no meio da conversa é proibido — isso exige
      // um atendente humano.
      // Print 2026-09-16: a cliente mandou o CPF do vizinho e a IA respondeu
      // "preciso do CPF do titular novamente" em looping — era esta trava
      // recusando sem o modelo saber por quê. Consultar o CPF de OUTRA pessoa
      // (fatura do amigo, problema do vizinho) é pedido legítimo e não troca
      // o dono da conversa: com a marcação, buscar_cliente não persiste nada.
      //
      // Caso Fulana/Beltrana (25/09/2026): na triagem, um CPF DIFERENTE do titular da conversa É
      // um pedido de terceiro, com ou sem a marcação do modelo. Antes, sem a marcação, a busca
      // era recusada e o modelo seguia com a cobrança de quem fala. Agora ela vira consulta de
      // terceiro — que nunca troca a identidade, nem grava nada no contato.
      if (perfilTriagem(contexto)) {
        if (!documentoTemOrigem(argsValidados.cpf, contexto)) {
          return recusa('document_without_origin', null, instrucaoDoDocumentoSemOrigem(contexto));
        }
        const doHistorico = documentoSoDoHistorico(argsValidados.cpf, contexto);
        if (doHistorico) return recusa('document_before_doubt', null, instrucaoDoDocumentoDoHistorico(doHistorico, contexto));
        const titular = documentoDoTitularDaConversa(contexto);
        if (titular && titular !== argsValidados.cpf && argsValidados.titularEOutraPessoa !== true) {
          argsValidados = { ...argsValidados, titularEOutraPessoa: true };
        }
      } else {
        const jaIdentificado = contexto.contact && contexto.contact.sgpDocument;
        if (jaIdentificado && jaIdentificado !== argsValidados.cpf && argsValidados.titularEOutraPessoa !== true) {
          return recusa('client_already_identified', null);
        }
      }
    } else if (!tool.isentoDeProprietario) {
      // O padrão é fechado: uma ferramenta só escapa da checagem de propriedade
      // se declarar isentoDeProprietario explicitamente (definir_motivo_atendimento
      // e transferir_atendimento, que só usam contexto.conversationId, nunca um
      // valor vindo do modelo). Uma ferramenta que não declarar nem
      // chaveProprietario nem isentoDeProprietario é recusada — provavelmente um
      // registro incompleto, não uma decisão de segurança que alguém tomou.
      if (typeof tool.chaveProprietario !== 'string') return recusa('tool_misconfigured', nome);
      const valor = argsValidados[tool.chaveProprietario];
      const proprio = (contexto.contracts || []).some((c) => c.id === valor);
      if (!proprio) {
        // Não é do contato. Antes de recusar de vez, confere se é o contrato
        // do terceiro registrado nesta conversa (buscar_cliente com
        // titularEOutraPessoa) — e, mesmo assim, só uma lista FECHADA de
        // ferramentas pode tocar nele: o resto (plano, conexão, status,
        // financeiro, desbloqueio) é recusado, mesmo que o contrato exista.
        const deTerceiro = ((contexto.terceiro && contexto.terceiro.contratos) || []).some((c) => c.id === valor);
        if (!deTerceiro) return recusa('contract_not_owned', valor);
        if (!FERRAMENTAS_PERMITIDAS_EM_TERCEIRO.includes(nome)) {
          return recusa('third_party_tool_not_allowed', nome, INSTRUCAO_TERCEIRO);
        }
        emTerceiro = true;
      }
    }

    // Entrega de dado (boleto, PIX) só com identidade forte — regra em código,
    // não em prompt. A marcação vale sempre que o turno usa o perfil de
    // triagem (perfilTriagem: contexto.ferramentasPermitidas fixo OU já existe
    // contexto.identidade); só fica inerte quando nenhum dos dois está
    // presente (o assistente clássico, sem perfil de triagem e sem
    // resolução de identidade — um humano acompanha ali). Mesmo
    // discriminador usado em tool-registry.js, importado em vez de duplicado
    // aqui, para as duas checagens nunca divergirem.
    //
    // A exceção (!emTerceiro) vale EXCLUSIVAMENTE para contrato dentro do
    // escopo de terceiro E ferramenta da lista de permissão — as duas
    // condições juntas são o que emTerceiro significa, porque qualquer outra
    // combinação já voltou acima (contract_not_owned ou
    // third_party_tool_not_allowed). A identidade de quem está falando NÃO é
    // elevada em momento nenhum aqui: a autorização vem do escopo do
    // terceiro, e morre com ele. Quem pede o boleto da esposa pode não ser
    // cliente nenhum, e não pode ser promovido a cliente por digitar o CPF
    // dela.
    if (tool.exigeIdentidadeForte && perfilTriagem(contexto) && !emTerceiro
        && !(contexto.identidade && contexto.identidade.nivel === 'forte')) {
      const jaPedido = contexto.documento && contexto.documento.alvo === 'principal';
      if (!jaPedido) return recusa('identity_not_confirmed', nome, INSTRUCAO_IDENTIDADE);
      return recusa('identity_not_confirmed', nome, contexto.documento.esclarecimentoDisponivel
        ? INSTRUCAO_IDENTIDADE_ESCLARECER : INSTRUCAO_IDENTIDADE_JA_PEDIDA);
    }

    // GATE DO ALVO FINANCEIRO (caso Fulana/Beltrana): com pedido de terceiro em andamento, uma
    // ferramenta que entrega cobrança só age num contrato DO TERCEIRO — o que o SGP devolveu
    // para o documento informado. Contrato de quem fala, de um terceiro anterior, ou nenhum
    // (documento não encontrado): recusa antes de tocar o SGP. Sem fallback nenhum. Fica depois das
    // checagens de posse e de identidade (que continuam dando os motivos delas) e antes da execução.
    if (FERRAMENTAS_DE_COBRANCA.includes(nome) && contexto.alvoAmbiguo) return recusaPorAlvoEmDuvida(contexto);
    // Pedido por endereço (06/10/2026): com o contrato escolhido pela rua, a cobrança do próprio cliente só sai dele.
    const escolhidos = contratosEscolhidosDoContexto(contexto);
    if (FERRAMENTAS_DE_COBRANCA.includes(nome) && alvo.tipo !== 'terceiro' && escolhidos
        && !escolhidos.includes(String(argsValidados.contratoId))) {
      return recusa('financial_target_address_mismatch', null, instrucaoDoEnderecoEscolhido(escolhidos));
    }
    if (FERRAMENTAS_DE_COBRANCA.includes(nome) && alvo.tipo === 'terceiro'
        && !alvo.contratos.includes(argsValidados.contratoId)) {
      return recusa('financial_target_mismatch', null, INSTRUCAO_ALVO_TERCEIRO);
    }

    // Uma ferramenta pode declarar o próprio orçamento (tool.timeoutMs): a
    // de liberação em confiança faz duas leituras E uma escrita no SGP, cada
    // uma com 15 s de HTTP. Com o orçamento padrão (igual ao HTTP), o race
    // aqui podia vencer com "timeout" enquanto o SGP ainda liberava o serviço
    // — ação real reportada ao modelo como falha.
    const resultado = await comTimeout(tool.executar(argsValidados, contexto), tool.timeoutMs || timeoutMs);
    if (resultado === Symbol.for('timeout')) return marcarSemConfirmacao(recusa('timeout', nome, instrucaoSemConfirmacao(nome, argsValidados)));
    if (resultado && resultado.ok === false) return recusa('execution_error', resultado.erro);
    // Minimização: o resultado de um contrato de terceiro passa pela projeção antes
    // de chegar ao modelo. Aplicada aqui, e não em cada ferramenta, para que uma
    // ferramenta futura na lista de permissão não possa esquecer de aplicá-la.
    if (emTerceiro) return { ok: true, resultado: minimizarParaTerceiro(nome, resultado) };
    return { ok: true, resultado };
  } catch (err) {
    logFalha(nome, err);
    return marcarSemConfirmacao(recusa('execution_error', err && err.message, instrucaoSemConfirmacao(nome, args)));
  }
}

module.exports = { executeTool };
