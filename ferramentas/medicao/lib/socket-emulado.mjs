// SUPLEMENTAR (fora da regra de bloqueio): emula o transporte polling do
// Engine.IO v4 / socket.io na interceptacao, so para produzir o estado "nao lida"
// — que so nasce de eventos message:new — e o estado "conectado" do menu.
// As medicoes principais NAO usam isto: nelas o socket.io cai por transporte.
const SEP = '\x1e';

export class SocketEmulado {
  constructor({ origin, eventos = [], atrasoEventosMs = 400 }) {
    this.origin = origin;
    this.eventos = eventos; // [[nome, payload], ...] entregues uma vez apos conectar
    this.atraso = atrasoEventosMs;
    this.fila = [];
    this.pendente = null; // requestId do GET em espera (long-poll)
    this.timer = null;
    this.entregues = false;
    this.log = [];
  }

  headers(tamanho) {
    return [
      { name: 'Content-Type', value: 'text/plain; charset=UTF-8' },
      { name: 'Access-Control-Allow-Origin', value: this.origin },
      { name: 'Content-Length', value: String(tamanho) },
    ];
  }

  async responder(page, requestId, texto) {
    const body = Buffer.from(texto, 'utf8');
    await page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: this.headers(body.length), body: body.toString('base64') });
  }

  async despachar(page) {
    if (!this.pendente || !this.fila.length) return;
    const id = this.pendente;
    this.pendente = null;
    clearTimeout(this.timer);
    const pacotes = this.fila.splice(0);
    this.log.push({ saiu: pacotes.map((p) => p.slice(0, 60)) });
    await this.responder(page, id, pacotes.join(SEP)).catch(() => {});
  }

  async tratar(page, requestId, request) {
    const u = new URL(request.url);
    const sid = u.searchParams.get('sid');
    if (request.method === 'GET' && !sid) {
      this.log.push({ handshake: true });
      await this.responder(page, requestId, '0' + JSON.stringify({ sid: 'emulado1', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 }));
      return;
    }
    if (request.method === 'POST') {
      const corpo = request.postData || '';
      for (const pacote of corpo.split(SEP)) {
        if (pacote.startsWith('40')) {
          // CONNECT do socket.io com { token }: aceita (nunca recusa — recusa = logout).
          this.fila.push('40' + JSON.stringify({ sid: 'socket-emulado' }));
          if (!this.entregues) {
            this.entregues = true;
            setTimeout(() => {
              for (const [nome, payload] of this.eventos) this.fila.push('42' + JSON.stringify([nome, payload]));
              this.despachar(page);
            }, this.atraso);
          }
        }
      }
      await this.responder(page, requestId, 'ok');
      await this.despachar(page);
      return;
    }
    // GET com sid: long-poll. Segura ate haver pacote; ping a cada 20 s.
    this.pendente = requestId;
    if (this.fila.length) {
      await this.despachar(page);
      return;
    }
    this.timer = setTimeout(() => {
      this.fila.push('2');
      this.despachar(page);
    }, 20000);
  }
}
