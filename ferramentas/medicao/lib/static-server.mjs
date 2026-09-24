// Servidor estatico do build de producao, com fallback de SPA e gzip.
// Escuta so em loopback (127.0.0.1 e ::1), para "localhost" funcionar nas duas
// pilhas — e na MESMA porta nas duas, senao o Chrome pode cair num processo
// alheio que esteja ouvindo em ::1. Porta 0 = escolhe uma livre.
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRIMIVEIS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
export const GZIP_LEVEL = 6; // nivel padrao do zlib (o mais comum em compressao dinamica)

// h2 = { key, cert }: serve HTTP/2 sobre TLS (como um CDN de producao), com
// fallback HTTP/1.1. Sem h2: HTTP/1.1 em texto claro.
export async function startStaticServer({ root, port = 4273, gzip = true, log = null, h2 = null } = {}) {
  const raiz = path.resolve(root);
  const cache = new Map();

  function carregar(arquivo) {
    if (cache.has(arquivo)) return cache.get(arquivo);
    const raw = fs.readFileSync(arquivo);
    const ext = path.extname(arquivo).toLowerCase();
    const gz = COMPRIMIVEIS.has(ext) ? zlib.gzipSync(raw, { level: GZIP_LEVEL }) : null;
    const etag = '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"';
    const item = { raw, gz, etag, ext };
    cache.set(arquivo, item);
    return item;
  }

  function handler(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let arquivo = path.join(raiz, pathname);
    if (!arquivo.startsWith(raiz)) {
      res.writeHead(403).end();
      return;
    }
    let existe = false;
    try {
      existe = fs.statSync(arquivo).isFile();
    } catch {
      existe = false;
    }
    if (!existe) {
      // Asset que nao existe e 404 de verdade; o resto cai no index.html (SPA).
      if (pathname.startsWith('/assets/') || path.extname(pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        if (log) log({ method: req.method, url: req.url, status: 404 });
        return;
      }
      arquivo = path.join(raiz, 'index.html');
    }
    const item = carregar(arquivo);
    const headers = {
      'Content-Type': MIME[item.ext] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: item.etag,
    };
    if (item.gz) headers.Vary = 'Accept-Encoding';
    if (req.headers['if-none-match'] === item.etag) {
      res.writeHead(304, headers).end();
      if (log) log({ method: req.method, url: req.url, status: 304 });
      return;
    }
    const aceitaGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    let corpo = item.raw;
    if (gzip && item.gz && aceitaGzip) {
      corpo = item.gz;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = corpo.length;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(corpo);
    if (log) log({ method: req.method, url: req.url, status: 200, bytes: corpo.length, gzip: headers['Content-Encoding'] === 'gzip' });
  }

  const criar = () => (h2 ? http2.createSecureServer({ key: h2.key, cert: h2.cert, allowHTTP1: true }, handler) : http.createServer(handler));
  const ouvir = (s, p, host) =>
    new Promise((resolve, reject) => {
      s.once('error', reject);
      s.listen(p, host, () => {
        s.off('error', reject);
        resolve(s.address().port);
      });
    });
  const fechar = (s) => new Promise((r) => s.close(() => r()));
  const ocupada = (p, host) =>
    new Error(`porta ${p} ocupada em ${host} — passe outra com --porta-h2/--porta-h1 (0 = escolher uma livre); a 4173 costuma estar com um vite preview`);

  let servidores = null;
  let porta = null;
  for (let tentativa = 0; tentativa < 10 && !servidores; tentativa++) {
    const s4 = criar();
    try {
      porta = await ouvir(s4, port, '127.0.0.1');
    } catch (err) {
      if (err.code === 'EADDRINUSE') throw ocupada(port, '127.0.0.1');
      throw err;
    }
    const s6 = criar();
    try {
      await ouvir(s6, porta, '::1');
      servidores = [s4, s6];
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        await fechar(s4);
        if (port !== 0) throw ocupada(port, '::1');
        continue; // porta automatica: tenta outra
      }
      // ::1 pode nao existir na maquina; 127.0.0.1 basta.
      servidores = [s4];
    }
  }
  if (!servidores) throw new Error('nao achei porta livre nas duas pilhas (127.0.0.1 e ::1) em 10 tentativas');

  return {
    port: porta,
    origin: `${h2 ? 'https' : 'http'}://localhost:${porta}`,
    protocolo: h2 ? 'h2 (TLS, com fallback http/1.1)' : 'http/1.1',
    gzip,
    gzipLevel: GZIP_LEVEL,
    close: () => Promise.all(servidores.map(fechar)),
    sizes(relPath) {
      const it = carregar(path.join(raiz, relPath));
      return { raw: it.raw.length, gzip: it.gz ? it.gz.length : null };
    },
  };
}

// Execucao direta: node lib/static-server.mjs <dist> [porta] [--sem-gzip]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2];
  const port = Number(process.argv[3] || 4273);
  const gzip = !process.argv.includes('--sem-gzip');
  startStaticServer({ root: dist, port, gzip, log: (e) => console.log(JSON.stringify(e)) }).then((s) => {
    console.log(`servindo ${dist} em ${s.origin} (gzip=${gzip}, nivel ${GZIP_LEVEL})`);
  });
}
