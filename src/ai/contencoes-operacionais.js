// Contenções operacionais da triagem (25/09/2026). Três lugares onde a IA preenchia lacuna com
// suposição:
// A) EQUIPAMENTO COM DEFEITO FÍSICO (queimou, não liga, não acende, sem energia): seguia o roteiro
//    comum (reiniciar, teste de velocidade) e podia orientar reparo ou procedimento elétrico. À
//    noite, o roteiro de conexão manda desligar da tomada. Com aviso de cidade ativo, "não acende"
//    passava como reclamação de conexão e a trava do aviso trocava a resposta pela ocorrência.
// B) TROCA DE NOME/SENHA DO WI-FI: a empresa faz remotamente, mas o prompt tratava "como troco a
//    senha?" como dúvida a responder direto — convite a ensinar o painel do roteador (192.168…).
//    Só o titular identificado pode pedir; a exceção de terceiro é SÓ para boleto/PIX.
// C) EXPLICAÇÃO FINANCEIRA: as faturas do SGP trazem valor, vencimento e pagamento — nunca
//    período, proporcional, ciclo ou a próxima fatura. Nada impedia o modelo de deduzir isso.
//
// O CÓDIGO decide: os sinais saem da fala do cliente (palavras, sem OpenAI), as violações saem da
// resposta do modelo, e a fonte oficial é o que as ferramentas devolveram NESTE turno ou o texto
// do painel. Tudo aqui é puro; o orquestrador aplica (correção no laço + troca final).

const normalizar = (texto) => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const algum = (lista, texto) => lista.some((r) => r.test(texto));

// Frases da resposta, com a pontuação final (é por ela que se sabe se a frase pergunta).
const frasesDe = (texto) => String(texto || '').split(/(?<=[.!?\n])\s*/).map((f) => f.trim()).filter(Boolean);
// Pedido ao cliente: imperativo ou "me ...". Infinitivo solto ("vou enviar") não conta.
const PEDIDO = /\b(?:informe|me informa|envie|me envia|mande|me manda|passe|me passa|digite|confirme|me confirma|diga|me diz|escolha|me fala|pode me (?:dizer|informar|passar|enviar|mandar|confirmar)|pode confirmar|preciso (?:da|do|de|que)|precisamos (?:da|do|de|que))\b/;
const perguntaNaFrase = (frase) => /\?\s*$/.test(frase) || PEDIDO.test(normalizar(frase));

// As falas recentes do cliente, sem a autorresposta provável (Fase 1C) — o mesmo recorte que o
// aviso de cidade usa no orquestrador.
const RECENTES = 5;
function recentesDoCliente(historico) {
  return (Array.isArray(historico) ? historico : [])
    .map((m, indice) => ({ m, indice }))
    .filter(({ m }) => m && m.direction === 'inbound' && !(m.metadata && m.metadata.autorrespostaProvavel === true))
    .slice(-RECENTES)
    .map(({ m, indice }) => ({ indice, texto: (m.messageType === 'audio' ? m.transcription : m.content) || '' }))
    .filter((r) => r.texto);
}

// ------------------------------------------------------------------------------------------------
// A) Equipamento com defeito físico
const EQUIPAMENTO = 'roteador|rotiador|modem|onu|ont|fonte|carregador|equipamento|aparelho|aparelhinho|caixinha|antena|wifi|wi fi';
// "não liga" com "no wifi"/"na internet" logo depois é o aparelho que não conecta, não o que não liga.
const DEFEITO = 'queimou|queimad[oa]|queimando|pifou|pifad[oa]|nao liga(?! (?:no|na|o|a) (?:wifi|wi fi|internet|rede|net))|nao esta ligando|nao ta ligando|nao quer ligar|parou de ligar|nao acende|nao esta acendendo|nao ta acendendo|apagou|apagad[oa]|sem energia|sem luz|pegou fogo|derreteu|estourou|explodiu|deu curto|em curto|estragou|estragad[oa]|quebrou|quebrad[oa]|molhou|molhad[oa]';
const DEFEITO_DO_EQUIPAMENTO = [
  new RegExp(`\\b(?:${EQUIPAMENTO})\\b(?: \\S+){0,4}? (?:${DEFEITO})\\b`),
  new RegExp(`\\b(?:${DEFEITO})\\b(?: \\S+){0,3}? (?:${EQUIPAMENTO})\\b`),
  /\b(?:fonte|carregador) (?:parou|morreu)\b/,
  /\bcheiro de queimado\b/, /\bpegou fogo\b/, /\bsoltando fumaca\b/, /\bdeu curto\b/,
];

// O roteiro comum de diagnóstico (o que vale para "internet lenta", não para equipamento queimado).
const ROTEIRO_COMUM = [
  /\breinici/, /\b(?:desligue|desligar|desliga|religue|religar|ligue de novo|ligar de novo|ligue novamente)\b/, /\btomada\b/,
  /\bteste de velocidade\b/, /\bspeed ?test\b/, /\bfast com\b/, /\bmedidor de velocidade\b/,
  /\b(?:outros?|outras?|demais) (?:aparelhos?|dispositivos?|celulares?)\b/,
  /\b(?:verifique|confira|troque|teste|reconecte|conecte|desconecte|encaixe|aperte) (?:os |o |a |as )?cabos?\b/,
  /\b(?:reset|resete|resetar|restaure|restaurar)\b/, /\bbotao\b/, /\bconfigur/,
];
// Reparo caseiro ou procedimento elétrico.
const PROCEDIMENTO_INSEGURO = [
  /\b(?:abra|abrir|abrindo|desmonte|desmontar|desparafuse)\b(?: \S+){0,2}? (?:equipamento|aparelho|roteador|modem|onu|ont|fonte|carcaca|tampa|caixa)\b/,
  /\b(?:medir|meca|medicao|multimetro|voltimetro|tensao|voltagem|volts?|bivolt)\b/,
  /\b(?:fusivel|capacitor|componente|placa|solda|soldar|emende|emendar|fita isolante)\b/,
  /\b(?:improvis\w*|gambiarra)\b/, /\boutra fonte\b/,
  /\bfonte (?:de outro|de outra|parecida|compativel|generica|universal|emprestada|igual)\b/,
  /\bcarregador (?:de|do) (?:celular|outro)\b/,
  /\b(?:troque|trocar|substitua|substituir|compre|comprar|use|usar) (?:a |uma )?fonte\b/,
];
// Visita, troca ou prazo: nenhuma ferramenta da triagem devolve isso.
const PROMESSA_SEM_FONTE = [
  /\bvisita\b/, /\btecnico (?:vai|ira|passa|passara|sera enviado|agendado)\b/, /\b(?:enviar|mandar|enviaremos|mandaremos) (?:um )?tecnico\b/,
  /\b(?:vamos|iremos|vai ser|sera) (?:trocad\w*|substituid\w*|trocar|substituir)\b/,
  /\b(?:troca|substituicao) (?:do|da|de) (?:equipamento|roteador|modem|onu|ont|fonte|aparelho)\b/,
  /\b(?:equipamento|roteador|modem|fonte|aparelho) novo\b/, /\bnov[oa] (?:equipamento|roteador|modem|aparelho|fonte)\b/,
  /\b(?:em|dentro de|nas proximas|ate) \d+ ?(?:h|hs|hora|horas|min|minutos|dia|dias)\b/, /\b(?:ate|ainda) (?:amanha|hoje)\b/,
  /\bprevisao\b/, /\bem breve\b/,
];
// A falha regional como explicação: com defeito físico relatado, o aviso não pode encobri-lo.
const ATRIBUI_AO_AVISO = [/\bocorrencia\b/, /\bfalha (?:regional|na rede|na regiao|geral)\b/, /\binstabilidade\b/, /\bproblema (?:na rede|na regiao|geral)\b/, /\bmanutencao\b/];

// ------------------------------------------------------------------------------------------------
// B) Troca de nome/senha do Wi-Fi
const CONTEXTO_WIFI = /\b(?:wifi|wi fi|wireless|rede|internet|roteador|modem)\b/;
const REDE_SEM_FIO = /\b(?:wifi|wi fi|rede|wireless)\b/;
const VERBO_DE_TROCA = /\b(?:troca|trocar|troco|troque|mudar|muda|mudo|mude|alterar|altera|altero|altere|modificar|modifica|redefinir|redefine|renomear|renomeia|colocar|coloca|botar|bota|cadastrar|nova|novo|outra|outro)\b/;
const SENHA_DE_OUTRA_COISA = /\bsenha (?:do|da|de) (?:app|aplicativo|central|sgp|boleto|login|pppoe|email|e mail|cartao|banco)\b/;
const NOME_DE_OUTRA_COISA = /\b(?:titular|cadastro|contrato|meu nome|seu nome|nome completo)\b/;
const PARENTES = 'mae|pai|filho|filha|irmao|irma|avo|tio|tia|sogro|sogra|vizinho|vizinha|amigo|amiga|namorado|namorada|primo|prima|patrao|patroa|marido|esposo|esposa|mulher|cunhado|cunhada';
const DE_OUTRA_PESSOA = new RegExp(`\\b(?:d[aoe]|pr[ao]|para [ao]) (?:minha |meu )?(?:${PARENTES})\\b|\\b(?:dela|dele)\\b|\\boutra pessoa\\b`);

function pedidoDeWifi(t) {
  if (!VERBO_DE_TROCA.test(t) || !CONTEXTO_WIFI.test(t)) return null;
  const senha = /\bsenha\b/.test(t) && !SENHA_DE_OUTRA_COISA.test(t);
  const nome = /\bnome\b/.test(t) && REDE_SEM_FIO.test(t) && !NOME_DE_OUTRA_COISA.test(t);
  return senha || nome ? { senha, nome } : null;
}

// O VALOR novo dito junto do campo ("senha para X", "nome da rede: X", "a senha nova é X"). Cada
// valor vai para o campo citado por último antes dele: em "a senha e o nome da rede para CASA",
// CASA é o nome. Só se sabe QUE foi informado — o valor nunca sai daqui (nem para log, nem para o
// resumo: está na conversa).
const CONECTORES = new Set(['para', 'pra', 'p/', 'como', 'ser', 'sera', 'fica', 'ficar', 'ficara', 'e', ':', '=']);
const NAO_E_VALOR = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'por', 'com', 'sem', 'e', 'ou',
  'que', 'se', 'qual', 'quando', 'outra', 'outro', 'nova', 'novo', 'mais', 'mim', 'voce', 'ela', 'ele', 'isso', 'isto', 'algo',
  'alguma', 'algum', 'qualquer', 'forte', 'segura', 'seguro', 'diferente', 'facil', 'mesma', 'mesmo', 'melhor', 'tambem', 'agora',
  'hoje', 'amanha', 'depois', 'favor', 'gentileza', 'ja', 'minha', 'meu', 'sua', 'seu', 'nossa', 'nosso', 'rede', 'wifi', 'wi-fi',
  'wi', 'fi', 'internet', 'roteador', 'modem', 'senha', 'nome', 'trocar', 'mudar', 'alterar', 'colocar', 'botar', 'por', 'ser',
]);
const semAcento = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavrasComValor = (texto) => semAcento(texto).replace(/([:=])/g, ' $1 ').split(/\s+/)
  .map((p) => p.replace(/^["'“”‘’(]+|["'“”‘’),.;!?]+$/g, '')).filter(Boolean);

function valoresInformados(texto) {
  const informados = { senha: false, nome: false };
  const palavras = palavrasComValor(texto);
  let campo = null;
  palavras.forEach((p, i) => {
    if (p === 'senha') { campo = 'senha'; return; }
    if (p === 'nome') { campo = 'nome'; return; }
    const proxima = palavras[i + 1];
    if (campo && CONECTORES.has(p) && proxima && !CONECTORES.has(proxima) && !NAO_E_VALOR.has(proxima)) informados[campo] = true;
  });
  return informados;
}

// A IA (ou um atendente) perguntou o campo e o cliente respondeu logo em seguida, curto: é o valor.
const NEGATIVA = /^(?:nao|ainda nao|depois|nao sei|sei la)\b/;
function camposPerguntados(texto) {
  const campos = { senha: false, nome: false };
  for (const frase of frasesDe(texto)) {
    if (!perguntaNaFrase(frase)) continue;
    const f = normalizar(frase);
    if (/\bsenha\b/.test(f) && !/\badmin/.test(f)) campos.senha = true;
    if (/\bnome\b/.test(f) && REDE_SEM_FIO.test(f)) campos.nome = true;
  }
  return campos;
}

function sinalDoWifi(historico, recentes) {
  const pedidos = recentes.map((r) => ({ r, pedido: pedidoDeWifi(normalizar(r.texto)) })).filter((x) => x.pedido);
  if (pedidos.length === 0) return null;
  const wifi = {
    senha: pedidos.some((x) => x.pedido.senha),
    nome: pedidos.some((x) => x.pedido.nome),
    senhaInformada: false,
    nomeInformado: false,
    deOutraPessoa: pedidos.some((x) => DE_OUTRA_PESSOA.test(normalizar(x.r.texto))),
  };
  for (const r of recentes) {
    const ditos = valoresInformados(r.texto);
    const anterior = historico[r.indice - 1];
    if (anterior && anterior.direction === 'outbound') {
      const t = normalizar(r.texto);
      const curta = t.split(' ').length <= 6 && !/\?/.test(r.texto) && !NEGATIVA.test(t);
      const perguntados = camposPerguntados(anterior.content);
      if (curta && perguntados.senha) ditos.senha = true;
      if (curta && perguntados.nome) ditos.nome = true;
    }
    wifi.senhaInformada = wifi.senhaInformada || ditos.senha;
    wifi.nomeInformado = wifi.nomeInformado || ditos.nome;
  }
  return wifi;
}

// Ensinar o painel do roteador: barrado em qualquer resposta da triagem, com ou sem o pedido
// detectado — a decisão de produto (a empresa altera remotamente) não depende da frase do cliente.
const PAINEL_DO_ROTEADOR = [
  /\b192 168\b/, /\b10 0 0 1\b/,
  /\b(?:painel|pagina|interface) (?:do|de|da) (?:roteador|modem|configuracao|administracao|admin)\b/,
  /\b(?:acesse|acessar|acessa|entre|entrar|abra|abrir|digite|digitar) (?:o |no |na |a |ao )?(?:roteador|modem|painel|navegador|endereco ip|ip do roteador)\b/,
  /\b(?:usuario|login|senha) (?:de )?(?:admin|administrador|administrativ\w*)\b/, /\badmin\b/,
  /\b(?:aplicativo|app) (?:do|da|de) (?:fabricante|roteador|modem)\b/, /\btether\b/,
];
// Com o pedido detectado, mexer na configuração do equipamento também é ensinar.
const CONFIGURAR_O_EQUIPAMENTO = /\b(?:configuracoes|configuracao|configurar|configure) (?:do |da |de |o |a )?(?:roteador|modem|rede sem fio|wireless|wifi|wi fi)\b/;
// O que não se pede para trocar o Wi-Fi (o endereço só com mais de um contrato: é ele que diz qual rede).
// O radical (nascim) e não a palavra inteira: a guarda de sem-nascimento.test.js lê a palavra em
// qualquer linha de código — aqui ela é justamente o que a resposta está PROIBIDA de pedir.
const DADO_DESNECESSARIO = [/\bnascim\w*/, /\b(?:modelo|marca) (?:do|da|de) (?:roteador|modem|equipamento|aparelho)\b/, /\busuario\b/, /\bsenha (?:de )?(?:admin|administrador|administrativ\w*|de acesso|do painel)\b/];
const AFIRMA_TROCA = /\b(?:vamos|vou|iremos|a equipe vai|nossa equipe vai|sera) (?:trocar|alterar|mudar|fazer a (?:troca|alteracao))\b/;

// ------------------------------------------------------------------------------------------------
// C) Explicação financeira específica do contrato (não pedido de pagamento; não pergunta genérica)
const EXPLICACAO_FINANCEIRA = [
  /\b(?:por que|porque|pq|por q)\b.*\b(?:fatura|boleto|conta|mensalidade|valor|cobranca|cobrado|cobrou|cobraram|veio|vindo|aumentou|subiu|mais cara|mais caro|mais alta|mais alto)\b/,
  /\b(?:quanto|qual valor|qual o valor|que valor)\b.*\b(?:vai vir|vai ficar|vai ser|vem|vou pagar|mes que vem|proxim[oa])\b/,
  /\bvai vir quanto\b/, /\bproxim[oa] (?:fatura|boleto|conta|mensalidade|cobranca)\b/,
  /\bmes que vem\b.*\b(?:fatura|boleto|conta|valor|pagar|mensalidade|quanto)\b/, /\b(?:fatura|boleto|conta|valor|pagar|mensalidade|quanto)\b.*\bmes que vem\b/,
  /\b(?:teve|tem|houve|veio|vem|cobrou|cobraram|cobrado|cobrada|foi)\b.*\bproporcional\b/,
  /\b(?:minha|meu|nessa|nesta|dessa|desta)\b.*\bproporcional\b/, /\bproporcional\b.*\b(?:minha|meu|nessa|nesta|dessa|desta|veio|cobr\w*)\b/,
  /\b(?:qual|que) periodo\b/, /\bperiodo (?:cobrado|da fatura|dessa fatura|desta fatura|de cobranca|que (?:esta|ta) sendo cobrado)\b/,
  /\breferente a (?:que|qual)\b/, /\bquantos dias\b.*\bcobr/, /\bdias cobrados\b/,
  /\b(?:mudei|troquei|alterei|mudanca|troca|alteracao) (?:de |do |o )?plano\b.*\b(?:fatura|boleto|cobr\w*|valor|pagar|conta)\b/,
  /\b(?:fatura|boleto|cobr\w*|valor|conta)\b.*\b(?:mudei|troquei|alterei|mudanca|troca|alteracao) (?:de |do |o )?plano\b/,
  /\b(?:aumentou|aumento|reajuste|subiu)\b.*\b(?:fatura|boleto|conta|mensalidade|valor|plano)\b/,
  /\b(?:fatura|boleto|conta|mensalidade|valor)\b.*\b(?:aumentou|reajuste|subiu)\b/,
  /\b(?:valor|fatura|boleto|conta)\b.*\b(?:errad[oa]|diferente|a mais|mais car[oa]|mais alt[oa])\b/,
  /\b(?:cobrado|cobraram|cobrou|veio) a mais\b/,
  /\bciclo de (?:faturamento|cobranca)\b/, /\bdata de corte\b/, /\bfechamento da fatura\b/,
];
// Termos de explicação que só valem se a FONTE também os tiver (ferramenta do turno ou painel).
const TERMOS_FINANCEIROS = [
  'proporcional', 'pro rata', 'periodo', 'ciclo', 'referente', 'dias de uso', 'dias cobrados', 'dias utilizados',
  'data de corte', 'fechamento', 'juros', 'multa', 'acrescimo', 'encargo', 'reajuste', 'aumento', 'desconto', 'taxa',
  'adicional', 'mudanca de plano', 'troca de plano', 'alteracao de plano', 'proxima fatura', 'proximo boleto',
  'proxima mensalidade', 'mes que vem', 'proximo mes', 'vai vir', 'deve vir', 'vai ficar', 'ficara', 'todo mes', 'todos os meses',
].map((termo) => ({ termo, regex: new RegExp(`\\b${termo}\\b`) }));

const DINHEIRO = /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|R\$\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*reais\b/gi;
const NUMERO = /\d+(?:[.,]\d+)*/g;
const DATA_BR = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g;
const DATA_ISO = /\b\d{4}-(\d{2})-(\d{2})\b/g;

function centavos(bruto) {
  let s = String(bruto).replace(/[^\d.,]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const diaMes = (dia, mes) => `${Number(dia)}/${Number(mes)}`;

function fatosDaFonte(fontes) {
  const texto = String(fontes || '');
  const valores = new Set((texto.match(NUMERO) || []).map(centavos).filter((v) => v != null));
  const datas = new Set();
  for (const m of texto.matchAll(DATA_ISO)) datas.add(diaMes(m[2], m[1]));
  for (const m of texto.matchAll(DATA_BR)) datas.add(diaMes(m[1], m[2]));
  return { valores, datas, normalizado: normalizar(texto) };
}

function afirmaFinanceiroSemFonte(texto, fontes) {
  const fonte = fatosDaFonte(fontes);
  const t = normalizar(texto);
  const termoSemFonte = TERMOS_FINANCEIROS.some(({ regex }) => regex.test(t) && !regex.test(fonte.normalizado));
  const diasSemFonte = (t.match(/\b\d+ dias\b/g) || []).some((d) => !fonte.normalizado.includes(d));
  const valorSemFonte = (String(texto).match(DINHEIRO) || []).some((v) => !fonte.valores.has(centavos(v)));
  const dataSemFonte = [...String(texto).matchAll(DATA_BR)].some((m) => !fonte.datas.has(diaMes(m[1], m[2])));
  return termoSemFonte || diasSemFonte || valorSemFonte || dataSemFonte;
}

// ------------------------------------------------------------------------------------------------

/** Os sinais do turno, lidos da fala recente do cliente (e da pergunta anterior, para o Wi-Fi). */
function sinaisOperacionais(historico) {
  const lista = Array.isArray(historico) ? historico : [];
  const recentes = recentesDoCliente(lista);
  const textos = recentes.map((r) => normalizar(r.texto));
  return {
    defeitoFisico: textos.some((t) => algum(DEFEITO_DO_EQUIPAMENTO, t)),
    wifi: sinalDoWifi(lista, recentes),
    explicacaoFinanceira: textos.some((t) => algum(EXPLICACAO_FINANCEIRA, t)),
  };
}

function temSinal(sinais) {
  return Boolean(sinais && (sinais.defeitoFisico || sinais.wifi || sinais.explicacaoFinanceira));
}

const identificado = (contexto) => Boolean(contexto && contexto.identidade && contexto.identidade.nivel === 'forte');

/**
 * Quem está pedindo a troca do Wi-Fi. O titular identificado pede para a própria rede; quem fala
 * da rede de outra pessoa, ou age num escopo de terceiro sem ser identificado, NÃO é o titular.
 */
function situacaoDoWifi(contexto) {
  const c = contexto || {};
  const wifi = c.contencoes && c.contencoes.wifi;
  if (wifi && wifi.deOutraPessoa) return 'terceiro';
  if (identificado(c)) return 'titular';
  if (c.terceiro || c.alvoTerceiro) return 'terceiro';
  return 'nao_identificado';
}

function faltaNoWifi(wifi) {
  return {
    senha: Boolean(wifi && wifi.senha && !wifi.senhaInformada),
    nome: Boolean(wifi && wifi.nome && !wifi.nomeInformado),
  };
}

function violacoesDoWifi(texto, contexto) {
  const t = normalizar(texto);
  const violacoes = [];
  const wifi = contexto.contencoes && contexto.contencoes.wifi;
  if (algum(PAINEL_DO_ROTEADOR, t) || (wifi && CONFIGURAR_O_EQUIPAMENTO.test(t))) violacoes.push('wifi_painel');
  if (!wifi) return violacoes;

  const situacao = situacaoDoWifi(contexto);
  const variosContratos = (contexto.contracts || []).length > 1;
  let desnecessario = false;
  let repete = false;
  let semTitular = situacao === 'terceiro' && AFIRMA_TROCA.test(t);
  for (const frase of frasesDe(texto)) {
    if (!perguntaNaFrase(frase)) continue;
    const f = normalizar(frase);
    const pedeSenha = /\bsenha\b/.test(f) && !/\badmin/.test(f);
    const pedeNome = /\bnome\b/.test(f) && REDE_SEM_FIO.test(f);
    if (algum(DADO_DESNECESSARIO, f) || (/\bendereco\b/.test(f) && !variosContratos) || (identificado(contexto) && /\b(?:cpf|cnpj)\b/.test(f))) desnecessario = true;
    if (situacao !== 'titular') {
      if (pedeSenha || pedeNome) semTitular = true;
      continue;
    }
    if (pedeSenha && (!wifi.senha || wifi.senhaInformada)) repete = true;
    if (pedeNome && (!wifi.nome || wifi.nomeInformado)) repete = true;
  }
  if (desnecessario) violacoes.push('wifi_dado_desnecessario');
  if (repete) violacoes.push('wifi_repergunta');
  if (semTitular) violacoes.push('wifi_sem_titular');
  return violacoes;
}

/**
 * O que a resposta do modelo NÃO pode dizer neste turno. `fontes`: o texto do que as ferramentas
 * devolveram neste turno mais o painel — é contra ele que um fato financeiro é conferido.
 */
function violacoesDaResposta(texto, { contexto, fontes = '' } = {}) {
  const c = contexto || {};
  const sinais = c.contencoes || {};
  const t = normalizar(texto);
  if (!t) return [];
  const violacoes = [];
  if (sinais.defeitoFisico) {
    if (algum(ROTEIRO_COMUM, t)) violacoes.push('equipamento_roteiro');
    if (algum(PROCEDIMENTO_INSEGURO, t)) violacoes.push('equipamento_inseguro');
    if (algum(PROMESSA_SEM_FONTE, t)) violacoes.push('equipamento_promessa');
    if (c.avisoCidade && !c.triagemConcluida && algum(ATRIBUI_AO_AVISO, t)) violacoes.push('equipamento_mascarado');
  }
  violacoes.push(...violacoesDoWifi(texto, c));
  if (sinais.explicacaoFinanceira && afirmaFinanceiroSemFonte(texto, fontes)) violacoes.push('financeiro_sem_fonte');
  return violacoes;
}

const doEquipamento = (v) => v.startsWith('equipamento_');
const doWifi = (v) => v.startsWith('wifi_');

function descreverFalta(falta) {
  if (falta.senha && falta.nome) return 'o nome e a senha novos da rede';
  if (falta.senha) return 'a senha nova';
  if (falta.nome) return 'o nome novo da rede';
  return null;
}

/**
 * A correção dentro do laço: o texto que o modelo recebe e se o código já exige a conclusão
 * (setor escolhido pelo modelo — os nomes de setor são do painel). Conclusão só quando o próximo
 * passo não depende de perguntar nada ao cliente.
 */
function correcaoDaResposta(violacoes, contexto) {
  const c = contexto || {};
  const partes = [];
  let concluir = null;
  const pedir = () => { concluir = false; };
  const exigirConclusao = () => { if (concluir === null) concluir = true; };

  if (violacoes.some(doEquipamento)) {
    partes.push('O cliente relatou DEFEITO FÍSICO ou falta de energia no equipamento. NÃO oriente teste, reinício, tomada, cabos, configuração, reparo nem procedimento elétrico, e não prometa visita, prazo ou troca de equipamento. O aviso de cidade não explica esse defeito.');
    if (identificado(c)) {
      partes.push('Chame concluir_triagem AGORA para o setor da lista que cuida de suporte, com o defeito relatado no resumo, e responda ao cliente em uma frase, sem orientação nenhuma no equipamento.');
      exigirConclusao();
    } else {
      partes.push('Responda de novo pedindo SÓ o CPF ou CNPJ do titular para encaminhar ao suporte, sem orientação nenhuma no equipamento.');
      pedir();
    }
  }
  if (violacoes.some(doWifi)) {
    partes.push('A troca do nome ou da senha do Wi-Fi é feita pela empresa, remotamente: NUNCA ensine a entrar no roteador (endereço numérico, painel, usuário ou senha administrativa, aplicativo do fabricante) nem a mudar nada no equipamento.');
    const wifi = c.contencoes && c.contencoes.wifi;
    const situacao = wifi ? situacaoDoWifi(c) : null;
    if (situacao === 'titular') {
      const falta = descreverFalta(faltaNoWifi(wifi));
      if (falta) {
        partes.push(`Peça só ${falta}, sem nenhum outro dado e sem repetir o que ele já informou.`);
        pedir();
      } else {
        partes.push('Ele já informou tudo o que pediu para trocar: NÃO pergunte de novo. Chame concluir_triagem AGORA para o setor da lista que cuida de suporte, com o pedido no resumo (sem repetir a senha nova), e responda em uma frase.');
        exigirConclusao();
      }
    } else if (situacao === 'nao_identificado') {
      partes.push('Quem pede ainda não foi identificado: peça SÓ o CPF ou CNPJ do titular antes de pedir o nome ou a senha nova.');
      pedir();
    } else if (situacao === 'terceiro') {
      partes.push('A alteração do Wi-Fi só pode ser pedida pelo próprio titular do contrato — a autorização de outra pessoa vale só para boleto e PIX. Diga isso em uma frase, sem pedir o nome ou a senha nova e sem encaminhar a alteração.');
      pedir();
    } else {
      partes.push('Responda de novo sem ensinar nada no roteador.');
      pedir();
    }
  }
  if (violacoes.includes('financeiro_sem_fonte')) {
    partes.push('Você afirmou fato financeiro do contrato (valor, período, proporcional, ciclo ou previsão) que nenhuma ferramenta deste atendimento devolveu e que não está nas instruções da operação. NÃO calcule, NÃO deduza, NÃO preveja e não complete lacunas: use só o que as ferramentas devolveram.');
    if (identificado(c)) {
      partes.push('Chame concluir_triagem AGORA para o setor da lista que cuida do financeiro, com a pergunta dele no resumo, e diga em uma frase que não tem essa informação confirmada no sistema.');
      exigirConclusao();
    } else {
      partes.push('Diga em uma frase que não tem essa informação confirmada no sistema e peça o CPF ou CNPJ para localizar o cadastro.');
      pedir();
    }
  }
  return { instrucao: partes.join(' '), concluir: concluir === true };
}

function fraseDoEncaminhamento(contexto) {
  const setor = contexto.triagemConcluida && contexto.triagemConcluida.setor;
  if (!setor) return null;
  const noturno = contexto.triagem && contexto.triagem.noturno;
  return noturno && noturno.ativo
    ? `Seu atendimento ficou registrado para o setor ${setor} e nossa equipe dá continuidade a partir das ${noturno.retornoAs}.`
    : `Seu atendimento vai para o setor ${setor} e um atendente continua daqui.`;
}

const PEDIR_DOCUMENTO = 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.';
const junto = (...partes) => partes.filter(Boolean).join(' ');

/** A resposta que sai quando o modelo insiste depois da correção. Equipamento > Wi-Fi > financeiro. */
function respostaSeguraDaContencao(violacoes, contexto) {
  const c = contexto || {};
  const encaminhado = fraseDoEncaminhamento(c);
  if (violacoes.some(doEquipamento)) {
    const base = 'Entendi. Não mexa no equipamento nem tente consertar.';
    if (encaminhado) return junto(base, encaminhado);
    return identificado(c) ? base : junto(base, 'Para eu encaminhar ao suporte, me informe o CPF ou CNPJ do titular, por favor.');
  }
  if (violacoes.some(doWifi)) {
    const wifi = c.contencoes && c.contencoes.wifi;
    if (!wifi) return 'Essa alteração é feita pela nossa equipe, sem você precisar mexer no equipamento.';
    const situacao = situacaoDoWifi(c);
    if (situacao === 'terceiro') return 'A alteração do Wi-Fi só pode ser pedida pelo próprio titular do contrato.';
    const base = 'Nós fazemos essa alteração para você, sem precisar mexer no equipamento.';
    if (situacao === 'nao_identificado') return junto(base, PEDIR_DOCUMENTO);
    const falta = faltaNoWifi(wifi);
    if (falta.nome && falta.senha) return junto(base, 'Qual nome e qual senha você quer para a rede Wi-Fi?');
    if (falta.senha) return junto(base, 'Qual senha você quer usar no Wi-Fi?');
    if (falta.nome) return junto(base, 'Qual nome você quer para a rede Wi-Fi?');
    return junto(base, encaminhado);
  }
  const base = 'Não tenho essa informação confirmada no sistema.';
  if (encaminhado) return junto(base, encaminhado);
  return identificado(c) ? base : junto(base, PEDIR_DOCUMENTO);
}

/** A linha do resumo do concluir_triagem: o atendente vê, em código, se pode fazer a troca. */
function linhaDoWifiNoResumo(contexto) {
  const wifi = contexto && contexto.contencoes && contexto.contencoes.wifi;
  if (!wifi) return null;
  const campos = [wifi.nome ? 'nome da rede' : null, wifi.senha ? 'senha' : null].filter(Boolean).join(' e ');
  return situacaoDoWifi(contexto) === 'titular'
    ? `Alteração do Wi-Fi (${campos}) pedida pelo titular identificado; os valores novos estão na conversa.`
    : `Alteração do Wi-Fi (${campos}) pedida por quem NÃO é o titular identificado: NÃO fazer a alteração.`;
}

module.exports = {
  sinaisOperacionais, temSinal, situacaoDoWifi, faltaNoWifi, violacoesDaResposta, correcaoDaResposta,
  respostaSeguraDaContencao, linhaDoWifiNoResumo,
};
