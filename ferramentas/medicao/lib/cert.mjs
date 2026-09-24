// Certificado autoassinado para o servidor HTTP/2 local, gerado EM MEMORIA a
// cada rodada. Nada de chave privada no Git e nada de certificado que expira
// entre uma etapa e outra do redesenho. O Chrome aceita o certificado porque a
// sessao liga Security.setIgnoreCertificateErrors (lib/session.mjs).
//
// DER montado a mao (X.509 v3, RSA 2048 + sha256WithRSAEncryption, CN e SAN
// localhost/127.0.0.1) — so node:crypto, sem openssl e sem pacote npm.
import crypto from 'node:crypto';

function comprimento(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, conteudo) => Buffer.concat([Buffer.from([tag]), comprimento(conteudo.length), conteudo]);
const seq = (...itens) => tlv(0x30, Buffer.concat(itens));
const conjunto = (...itens) => tlv(0x31, Buffer.concat(itens));
const nulo = () => Buffer.from([0x05, 0x00]);
function inteiro(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(texto) {
  const p = texto.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const pilha = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) pilha.unshift((x & 0x7f) | 0x80);
    out.push(...pilha);
  }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(d) {
  const z = (n) => String(n).padStart(2, '0');
  const s = `${z(d.getUTCFullYear() % 100)}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii'));
}
const nome = (cn) => seq(conjunto(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
const pem = (rotulo, der) => `-----BEGIN ${rotulo}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${rotulo}-----\n`;

export function certificadoLocalhost() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algoritmo = seq(oid('1.2.840.113549.1.1.11'), nulo()); // sha256WithRSAEncryption
  const agora = Date.now();
  const san = seq(tlv(0x82, Buffer.from('localhost', 'ascii')), tlv(0x87, Buffer.from([127, 0, 0, 1])));
  const extensoes = tlv(0xa3, seq(seq(oid('2.5.29.17'), tlv(0x04, san))));
  const tbs = seq(
    tlv(0xa0, inteiro(Buffer.from([2]))), // v3
    inteiro(crypto.randomBytes(12)),
    algoritmo,
    nome('localhost'),
    seq(utcTime(new Date(agora - 86400000)), utcTime(new Date(agora + 7 * 86400000))),
    nome('localhost'),
    publicKey.export({ type: 'spki', format: 'der' }),
    extensoes
  );
  const assinatura = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, algoritmo, tlv(0x03, Buffer.concat([Buffer.from([0]), assinatura])));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', der) };
}

// Execucao direta: confere que o Node le e valida o que foi gerado.
if (process.argv[1] && import.meta.filename === (await import('node:path')).resolve(process.argv[1])) {
  const { key, cert } = certificadoLocalhost();
  const x = new crypto.X509Certificate(cert);
  console.log(x.subject, '|', x.subjectAltName, '|', x.validFrom, '->', x.validTo);
  console.log('chave confere:', x.checkPrivateKey(crypto.createPrivateKey(key)), '| assinatura confere:', x.verify(x.publicKey));
}
