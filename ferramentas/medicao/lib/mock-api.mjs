// API simulada. Responde como o Express de producao responderia, incluindo os
// cabecalhos do pacote `cors` com maxAge 7200 (src/server.js:70).
import * as F from './fixtures.mjs';

const JSON_CT = 'application/json; charset=utf-8';

export class MockApi {
  constructor({ perfil = 'atendente', pageOrigin }) {
    this.perfil = perfil;
    this.pageOrigin = pageOrigin;
    this.eu = perfil === 'admin' ? F.EU_ADMIN : F.EU_ATENDENTE;
    this.minhas = F.minhasConversas(this.eu);
    this.fila = F.fila();
    this.todas = new Map([...this.minhas, ...this.fila].map((c) => [c.id, c]));
    this.naoAtendidos = [];
  }

  cors(origin) {
    return [
      { name: 'Access-Control-Allow-Origin', value: origin || this.pageOrigin },
      { name: 'Vary', value: 'Origin' },
    ];
  }

  preflight(headers) {
    const origin = headers.Origin || headers.origin;
    const reqHeaders = headers['Access-Control-Request-Headers'] || headers['access-control-request-headers'];
    const h = [
      ...this.cors(origin),
      { name: 'Access-Control-Allow-Methods', value: 'GET,HEAD,PUT,PATCH,POST,DELETE' },
      { name: 'Access-Control-Max-Age', value: '7200' },
      { name: 'Content-Length', value: '0' },
    ];
    if (reqHeaders) {
      h.push({ name: 'Access-Control-Allow-Headers', value: reqHeaders });
      h.push({ name: 'Vary', value: 'Access-Control-Request-Headers' });
    }
    return { status: 204, headers: h, body: Buffer.alloc(0) };
  }

  json(status, obj, origin) {
    const body = Buffer.from(JSON.stringify(obj));
    return {
      status,
      headers: [...this.cors(origin), { name: 'Content-Type', value: JSON_CT }, { name: 'Content-Length', value: String(body.length) }],
      body,
    };
  }

  png(buf, origin) {
    return {
      status: 200,
      headers: [
        ...this.cors(origin),
        { name: 'Content-Type', value: 'image/png' },
        { name: 'Content-Length', value: String(buf.length) },
        { name: 'Cache-Control', value: 'private, max-age=86400' },
      ],
      body: buf,
    };
  }

  mensagensDe(id) {
    const conv = this.todas.get(id);
    if (!conv) return [];
    if (conv.id === this.minhas.find((c) => c.contactDisplayName && c.contactDisplayName.startsWith('Maria José')).id) return F.mensagensDaConversaA(id);
    if (conv.contactDisplayName && conv.contactDisplayName.startsWith('Antônio Carlos')) return F.mensagensDaConversaB(id);
    return F.mensagensGenericas(conv);
  }

  // Historico longo so para o diagnostico de "Carregar mensagens anteriores"
  // (MEDICAO_HISTORICO_LONGO=<n>): n mensagens mais antigas antes das 50 da
  // conversa A. Sem a variavel, nada muda — as etapas oficiais nao a usam, e a
  // conversa A continua com 50 mensagens (sem o botao de anteriores).
  comHistoricoLongo(id, lista) {
    const n = Number(process.env.MEDICAO_HISTORICO_LONGO || 0);
    const idA = this.minhas.find((c) => c.contactDisplayName && c.contactDisplayName.startsWith('Maria José')).id;
    if (!n || id !== idA || !lista.length) return lista;
    const primeira = Date.parse(lista[0].createdAt);
    // Uma em cada quatro é foto (as de número 2, 6, 10…): foto não reserva
    // altura e carrega DEPOIS de o trecho entrar na tela, que é o caso em que a
    // posição de leitura escorrega sem ancoragem (Safari).
    const antigas = Array.from({ length: n }, (_, i) => {
      const numero = i + 1;
      const foto = numero % 4 === 2;
      return {
        ...lista[0],
        id: `${id}-hist-${String(numero).padStart(3, '0')}`,
        direction: 'inbound',
        sentBy: null,
        messageType: foto ? 'image' : 'text',
        mediaPath: foto ? `media/2026/09/hist-${numero}.jpg` : null,
        mediaMimeType: foto ? 'image/jpeg' : null,
        mediaFilename: foto ? `IMG-HIST-${numero}.jpg` : null,
        repliedToPreview: null,
        content: foto ? null : `Mensagem antiga ${numero}`,
        createdAt: new Date(primeira - (n - i) * 60000).toISOString(),
      };
    });
    return [...antigas, ...lista];
  }

  // Devolve { status, headers, body } ou null (rota desconhecida).
  handle({ method, url, headers = {} }) {
    const u = new URL(url);
    const origin = headers.Origin || headers.origin || this.pageOrigin;
    if (method === 'OPTIONS') return this.preflight(headers);
    const p = u.pathname;
    const q = u.searchParams;
    let m;
    const ok = (obj) => this.json(200, obj, origin);

    if (method === 'GET' && p === '/api/public/company') return ok({ name: 'DW Telecom' });
    if (method === 'POST' && p === '/api/auth/media-token') return ok({ mediaToken: 'mt.simulado.0001' });
    if (method === 'POST' && p === '/api/auth/login') return ok({ token: 'jwt.simulado.' + this.perfil, agent: this.eu });
    if (method === 'GET' && p === '/api/conversations/queue') return ok(this.fila);
    if (method === 'GET' && p === '/api/conversations/mine') return ok(this.minhas);
    if (method === 'GET' && p === '/api/conversations/mine/closed') return ok([]);
    if (method === 'GET' && (m = p.match(/^\/api\/conversations\/([^/]+)\/messages$/))) {
      const todas = this.comHistoricoLongo(m[1], this.mensagensDe(m[1]));
      const limit = Number(q.get('limit')) || todas.length;
      // `before` como a rota real: as `limit` imediatamente anteriores ao id dado.
      const antesDe = q.get('before');
      const base = antesDe ? todas.slice(0, Math.max(0, todas.findIndex((x) => x.id === antesDe))) : todas;
      return ok(base.slice(-limit));
    }
    if (method === 'GET' && (m = p.match(/^\/api\/conversations\/([^/]+)\/ai-suggestion$/))) return ok({ suggestion: null });
    if (method === 'GET' && (m = p.match(/^\/api\/conversations\/contacts\/([^/]+)\/history$/))) return ok([]);
    if (method === 'GET' && p === '/api/agents') return ok(F.listaDeAtendentes());
    if (method === 'GET' && p === '/api/agents/me') return ok({ ...this.eu, phone: null });
    if (method === 'GET' && /^\/api\/agents\/[^/]+\/avatar$/.test(p)) return this.png(F.PNG_AVATAR, origin);
    if (method === 'GET' && /^\/api\/contacts\/[^/]+\/avatar$/.test(p)) return this.png(F.PNG_AVATAR, origin);
    if (method === 'GET' && /^\/api\/media\/[^/]+$/.test(p)) return this.png(F.PNG_FOTO, origin);
    if (method === 'GET' && p === '/api/quick-replies') return ok(F.RESPOSTAS_RAPIDAS);
    if (method === 'GET' && p === '/api/sectors') return ok(F.SETORES);
    if (method === 'GET' && p === '/api/cities') {
      const comLocalidades = q.get('includeLocalities') === 'true';
      return ok(comLocalidades ? [...F.CIDADES, ...F.LOCALIDADES] : F.CIDADES);
    }
    if (method === 'GET' && p === '/api/reasons') return ok(F.MOTIVOS);
    if (method === 'GET' && p === '/api/channels') return ok(F.CANAIS.map(({ id, name, type }) => ({ id, name, type })));
    if (method === 'GET' && p === '/api/sgp/clientes') {
      const cpf = (q.get('cpf') || '').replace(/\D/g, '');
      if (cpf === '12345678909') return ok(F.SGP_CLIENTE);
      return this.json(404, { error: 'Cliente não encontrado' }, origin);
    }
    if (method === 'GET' && p === '/api/templates') return ok([]);
    if (method === 'GET' && p === '/api/metrics' && this.perfil !== 'admin') {
      return ok({ period: q.get('period') || 'today', scope: 'agent', own: { closedCount: 14, avgResolutionMinutes: 42.5, avgFirstResponseMinutes: 3.2 } });
    }

    // ---- area administrativa (perfil admin) ----
    if (this.perfil === 'admin') {
      const r = this.handleAdmin(method, p, q, origin);
      if (r) return r;
    } else if (p.startsWith('/api/admin/')) {
      return this.json(403, { error: 'Forbidden' }, origin);
    }
    return null;
  }

  handleAdmin(method, p, q, origin) {
    const ok = (obj) => this.json(200, obj, origin);
    if (method === 'GET' && p === '/api/admin/channels') {
      return ok(
        F.CANAIS.map((c, i) => ({
          ...c,
          hidden: false,
          triageEnabled: i === 0,
          aiEnabled: i !== 1,
          aiTriageEnabled: i === 0,
          aiNightModeEnabled: false,
          wabaId: c.type === 'meta_cloud' ? '102938475610' : null,
          welcomeMessage: i === 0 ? 'Olá! Você está falando com a DW Telecom.' : null,
          createdAt: F.quando(-120, '10:00'),
        }))
      );
    }
    if (method === 'GET' && p === '/api/admin/dashboard/conversations') {
      const s = F.supervisao();
      return ok(s);
    }
    if (method === 'GET' && p === '/api/admin/dashboard/conversations/closed-today') {
      const itens = F.encerradasHoje();
      return ok({ items: itens, total: itens.length, hasMore: false });
    }
    if (method === 'GET' && p === '/api/metrics') return ok(F.metricasAdmin(q.get('period') || 'today'));
    if (method === 'GET' && p === '/api/admin/triage') {
      return ok({
        questionText: 'Olá! Escolha uma opção: 1) Suporte 2) Financeiro 3) Comercial',
        confirmationText: 'Certo! Vou te encaminhar.',
        maxAttempts: 2,
        options: F.SETORES.slice(0, 3).map((s, i) => ({ id: F.uuid('triagem-' + i), number: i + 1, label: s.name, sectorId: s.id, keywords: [] })),
      });
    }
    if (method === 'GET' && p === '/api/admin/ai/config') {
      return ok({ mode: 'suggest', configured: true, model: 'gpt-5.4-mini', nightStartTime: '22:00', nightEndTime: '06:00', assistantSuggestionsEnabled: true });
    }
    if (method === 'GET' && p === '/api/admin/agents') return ok(F.listaDeAtendentes().map((a) => ({ ...a, active: true, sectorIds: [] })));
    if (method === 'GET' && p === '/api/admin/reasons') return ok(F.MOTIVOS);
    if (method === 'GET' && p === '/api/admin/templates') return ok([]);
    if (method === 'GET' && p === '/api/admin/company') return ok({ name: 'DW Telecom', acceptedNames: ['DW TELECOM'] });
    return null;
  }
}
