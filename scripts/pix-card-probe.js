/**
 * Sonda do cartão de Pix no canal oficial (Meta Cloud ou 360dialog).
 *
 * Monta EXATAMENTE o mesmo corpo order_details que o backend envia e o posta
 * na API, imprimindo a resposta completa — inclusive o erro estruturado que a
 * Meta devolve quando recusa o cartão. Serve para provar o cartão num número
 * de teste sem esperar deploy, e para ler o motivo de uma recusa.
 *
 * Uso (360dialog):
 *   D360_API_KEY=... node scripts/pix-card-probe.js 360dialog <telefone> <arquivo-com-o-codigo-pix> \
 *     [--value 135.00] [--due 2026-09-30] [--fatura 4321]
 *
 * Uso (Meta Cloud):
 *   META_ACCESS_TOKEN=... node scripts/pix-card-probe.js meta_cloud <telefone> <arquivo-com-o-codigo-pix> \
 *     --phone-number-id <id>
 *
 * O recebedor (nome, chave e tipo) sai de dentro do próprio código Pix, como no
 * envio de verdade — não há nada para informar na linha de comando.
 *
 * O código Pix vem de um arquivo (cole o copia e cola do Financeiro do SGP num
 * .txt) porque na linha de comando ele quebra. A chave/token vem do ambiente e
 * nunca é impressa.
 */
const fs = require('fs');
const axios = require('axios');
const { buildPixOrderDetailsBody } = require('../src/whatsapp-adapters/meta-cloud.adapter');
const { lerRecebedorDoPix } = require('../src/payments/pix-emv');

function lerOpcoes(argv) {
  const opcoes = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      opcoes[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return opcoes;
}

async function main() {
  const [, , tipo, telefone, arquivoCodigo, ...resto] = process.argv;
  const o = lerOpcoes(resto);
  if (!tipo || !telefone || !arquivoCodigo) {
    console.error('Uso: node scripts/pix-card-probe.js <360dialog|meta_cloud> <telefone> <arquivo-codigo-pix> [--value 135.00] [--due AAAA-MM-DD] [--fatura ID] [--phone-number-id ID]');
    process.exitCode = 1;
    return;
  }
  const pixCode = fs.readFileSync(arquivoCodigo, 'utf8').trim();
  // Mesmo caminho do envio: o recebedor é lido de dentro do código.
  const merchant = lerRecebedorDoPix(pixCode);
  if (!merchant || !merchant.key) {
    console.error('O código do arquivo não traz a chave do recebedor: o cartão oficial não pode ser montado com ele.');
    process.exitCode = 1;
    return;
  }
  // Nome e tipo da chave saem impressos — a chave e o código, nunca.
  console.log(`Recebedor lido do código: ${merchant.name || '(sem nome no código)'} · ${merchant.keyType}`);
  const card = {
    pixCode,
    value: o.value || '1.00',
    dueDate: o.due || new Date().toISOString().slice(0, 10),
    faturaId: o.fatura || `PROBE${Date.now()}`,
    merchant,
  };
  const body = buildPixOrderDetailsBody(telefone.replace(/\D/g, ''), card);

  let url;
  let headers;
  if (tipo === '360dialog') {
    if (!process.env.D360_API_KEY) throw new Error('Defina D360_API_KEY no ambiente');
    url = 'https://waba-v2.360dialog.io/messages';
    headers = { 'D360-API-KEY': process.env.D360_API_KEY };
  } else if (tipo === 'meta_cloud') {
    if (!process.env.META_ACCESS_TOKEN || !o['phone-number-id']) throw new Error('Defina META_ACCESS_TOKEN e --phone-number-id');
    url = `https://graph.facebook.com/v20.0/${o['phone-number-id']}/messages`;
    headers = { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` };
  } else {
    throw new Error('tipo deve ser 360dialog ou meta_cloud');
  }

  // O corpo impresso omite o código Pix: é longo e não ajuda a ler o erro.
  const semCodigo = JSON.parse(JSON.stringify(body));
  semCodigo.interactive.action.parameters.payment_settings[0].pix_dynamic_code.code = `<${pixCode.length} caracteres>`;
  console.log('Corpo enviado:', JSON.stringify(semCodigo, null, 2));

  try {
    const response = await axios.post(url, body, { headers });
    console.log('Resposta:', JSON.stringify(response.data, null, 2));
  } catch (err) {
    const status = err.response && err.response.status;
    const data = err.response && err.response.data;
    console.error(`Recusado (HTTP ${status || '?'}):`, JSON.stringify(data || err.message, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Falha:', err.message);
  process.exitCode = 1;
});
