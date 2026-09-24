// Cliente CDP minimo sobre o WebSocket nativo do Node 22 + lancamento do Chrome.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chrome as chromeExe } from './config.mjs';

export function chromeArgs({ profileDir, width, height }) {
  return [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-breakpad',
    '--metrics-recording-only',
    '--no-pings',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--disable-features=OptimizationHints,MediaRouter,Translate,AutofillServerCommunication,InterestFeedContentSuggestions,CalculateNativeWinOcclusion,PrivacySandboxSettings4',
    // Rede de seguranca: nenhum nome resolve, exceto localhost. Mesmo que algo
    // escape da interceptacao, nao existe caminho para a internet.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',
    'about:blank',
  ];
}

export async function launchChrome({ profileDir, width = 1366, height = 768 }) {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const args = chromeArgs({ profileDir, width, height });
  const proc = spawn(chromeExe(), args, { stdio: 'ignore', windowsHide: true });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const inicio = Date.now();
  while (!fs.existsSync(portFile)) {
    if (Date.now() - inicio > 20000) throw new Error('Chrome nao abriu a porta de depuracao em 20 s');
    await new Promise((r) => setTimeout(r, 50));
  }
  let linhas = [];
  while (linhas.length < 2) {
    try {
      // No Windows o arquivo pode estar travado enquanto o Chrome escreve (EBUSY).
      linhas = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    } catch {
      linhas = [];
    }
    if (linhas.length < 2) {
      if (Date.now() - inicio > 20000) throw new Error('DevToolsActivePort ilegivel em 20 s');
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  const wsUrl = `ws://127.0.0.1:${linhas[0]}${linhas[1]}`;
  return { proc, wsUrl, args };
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(Object.assign(new Error(`${p.method}: ${msg.error.message}`), { cdp: msg.error }));
        else p.resolve(msg.result);
        return;
      }
      const hs = this.handlers.get(msg.method);
      if (hs) for (const h of [...hs]) {
        try {
          h(msg.params, msg.sessionId);
        } catch (err) {
          console.error('handler', msg.method, err);
        }
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('CDP fechado'));
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)), { once: true });
      ws.addEventListener('error', (e) => reject(new Error('falha ao conectar CDP: ' + (e.message || url))), { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method).delete(handler);
  }

  waitFor(method, predicate = () => true, timeoutMs = 30000, sessionId) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        off();
        reject(new Error(`timeout esperando ${method}`));
      }, timeoutMs);
      const off = this.on(method, (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        if (!predicate(params)) return;
        clearTimeout(t);
        off();
        resolve(params);
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

// Uma sessao de pagina (flatten), com atalhos.
export class Page {
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }
  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }
  on(method, handler) {
    return this.cdp.on(method, (params, sid) => {
      if (sid === this.sessionId) handler(params);
    });
  }
  waitFor(method, predicate, timeoutMs) {
    return this.cdp.waitFor(method, predicate, timeoutMs, this.sessionId);
  }
  async eval(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('eval: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }
  // Espera uma condicao JS ficar verdadeira (poll leve).
  async waitForExpr(expression, { timeoutMs = 30000, intervalMs = 50 } = {}) {
    const inicio = Date.now();
    for (;;) {
      let ok = false;
      try {
        ok = await this.eval(`Boolean(${expression})`);
      } catch {
        ok = false;
      }
      if (ok) return Date.now() - inicio;
      if (Date.now() - inicio > timeoutMs) throw new Error('timeout: ' + expression);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  async screenshot(file, clip) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await this.send('Page.captureScreenshot', params);
    const buf = Buffer.from(data, 'base64');
    if (file) fs.writeFileSync(file, buf);
    return buf;
  }
}

export async function newBrowser({ profileDir, width = 1366, height = 768 }) {
  const chrome = await launchChrome({ profileDir, width, height });
  const cdp = await CDP.connect(chrome.wsUrl);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  // Fecha a aba inicial: fica so a que controlamos.
  for (const t of targetInfos) if (t.type === 'page' && t.targetId !== targetId) await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, targetId);
  const version = await cdp.send('Browser.getVersion');
  async function close() {
    try {
      await cdp.send('Browser.close');
    } catch {
      /* ja fechou */
    }
    cdp.close();
    const inicio = Date.now();
    while (chrome.proc.exitCode === null && Date.now() - inicio < 5000) await new Promise((r) => setTimeout(r, 100));
    if (chrome.proc.exitCode === null) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(chrome.proc.pid), '/T', '/F'], { stdio: 'ignore' });
        else chrome.proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
  return { cdp, page, chrome, version, close };
}
