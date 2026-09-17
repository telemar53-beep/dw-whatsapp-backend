const fs = require('fs');
const { getMediaFilePath } = require('../media/media-storage');
const { analyzeImage } = require('./openai-client');
const { conferirComprovante, PROMPT_VISAO } = require('./comprovante');
const { getCompanyConfig } = require('../company/company-config.repository');
const { findReceiptUsage } = require('./receipt-usage.repository');
const { descreverUsoAnterior } = require('./receipt-usage-text');
const { mensagemSegura } = require('./safe-error-log');
const sgpClient = require('../integrations/sgp-client');

// A imagem só sai do servidor depois de passar por estes dois filtros: o que a
// OpenAI consegue ler de verdade, e um teto de bytes.
const MIMES_COMPROVANTE = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANHO_MAXIMO_COMPROVANTE = 5 * 1024 * 1024;

/**
 * Lê um comprovante pela visão e o confere EM CÓDIGO. O modelo nunca digita
 * valor, data ou favorecido: quem lê é a visão, quem decide é `conferirComprovante`.
 *
 * Extraído da ferramenta `analisar_comprovante` da triagem para o atendente
 * humano poder pedir a mesma análise pelo chat. Os dois caminhos compartilham
 * este código de propósito — duplicar a conferência é como as duas versões
 * passam a discordar sem ninguém notar.
 *
 * Sem contratos (cliente ainda não identificado no SGP) a análise continua
 * valendo: ela confere se é um comprovante, se o favorecido é a empresa, se a
 * data está na janela e — o que mais importa para o atendente — se aquele
 * mesmo comprovante já foi usado antes. O que falta é só casar com uma fatura.
 */
async function analisarComprovante({ conversationId, imagem, contratos = [], config }) {
  if (!imagem) return { analisado: false, motivo: 'Nenhuma imagem para analisar.' };
  // MIME e tamanho são conferidos ANTES de qualquer leitura do disco.
  if (!MIMES_COMPROVANTE.includes(imagem.mediaMimeType)) {
    return { analisado: false, motivo: 'A imagem não está num formato que dá para ler (use JPG, PNG ou WEBP).' };
  }

  // Os nomes aceitos como favorecido são configuração da empresa. Sem nenhum
  // nome não há conferência possível — e a recusa sai ANTES da visão, que é
  // cobrada por imagem.
  const empresa = await getCompanyConfig();
  const nomesAceitos = [...((empresa && empresa.acceptedPayeeNames) || [])];
  if (nomesAceitos.length === 0) {
    return { analisado: false, motivo: 'Nenhum nome de favorecido cadastrado em Empresa; não é possível conferir comprovantes.' };
  }

  let buffer;
  try {
    const caminho = getMediaFilePath(imagem.mediaPath);
    const info = await fs.promises.stat(caminho);
    if (info.size > TAMANHO_MAXIMO_COMPROVANTE) {
      return { analisado: false, motivo: 'A imagem é grande demais para ler (limite 5 MB).' };
    }
    buffer = await fs.promises.readFile(caminho);
  } catch (err) {
    // O caminho do arquivo não entra no log nem na resposta.
    console.error(`analisarComprovante: arquivo indisponível na conversa ${conversationId}: ${mensagemSegura(err)}`);
    return { analisado: false, motivo: 'Não foi possível abrir a imagem.' };
  }

  let leitura;
  try {
    leitura = await analyzeImage({
      apiKey: config.apiKey,
      model: config.model,
      imageBuffer: buffer,
      mimeType: imagem.mediaMimeType,
      prompt: PROMPT_VISAO,
    });
  } catch (err) {
    console.error(`analisarComprovante: visão falhou na conversa ${conversationId}: ${mensagemSegura(err)}`);
    return { analisado: false, motivo: 'Não foi possível ler a imagem agora.' };
  }

  // Faturas em aberto de TODOS os contratos: o comprovante pode ser do outro ponto.
  const faturas = [];
  if (contratos.length > 0) {
    const segundasVias = await Promise.allSettled(contratos.map((c) => sgpClient.getDuplicateInvoice(c.id)));
    segundasVias.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value && r.value.hasOpenInvoice) {
        for (const d of r.value.duplicates) faturas.push({ id: d.id, value: d.value, dueDate: d.dueDate, contratoId: contratos[i].id });
      }
    });
  }

  const conferencia = conferirComprovante({ leitura, faturas, nomesAceitos });
  const fatura = conferencia.faturaId ? faturas.find((f) => f.id === conferencia.faturaId) : null;

  // O mesmo comprovante, emprestado ou reenviado, não pode passar duas vezes —
  // e é o id da transação que denuncia, não o SGP. O banco fora do ar aqui não
  // derruba a leitura: sem a consulta, a conferência ainda vale, só fica sem o
  // aviso de reuso.
  let usoAnterior = null;
  if (conferencia.idTransacao) {
    try {
      const uso = await findReceiptUsage(conferencia.idTransacao);
      if (uso) usoAnterior = { contractId: uso.contractId, usedAt: uso.usedAt, descricao: descreverUsoAnterior(uso) };
    } catch (err) {
      console.error(`analisarComprovante: uso anterior indisponível na conversa ${conversationId}: ${mensagemSegura(err)}`);
    }
  }

  return {
    analisado: true,
    ...conferencia,
    contratoId: fatura ? fatura.contratoId : null,
    usoAnterior,
    jaUtilizado: Boolean(usoAnterior),
  };
}

module.exports = { analisarComprovante, MIMES_COMPROVANTE, TAMANHO_MAXIMO_COMPROVANTE };
