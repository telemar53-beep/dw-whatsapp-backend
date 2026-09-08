# Consulta ao SGP pelo atendente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an attendant type a customer's CPF inside the chat panel and see
real SGP data (client + contracts), then generate a 2nd-copy invoice (boleto)
with its PIX code — without leaving the conversation screen.

**Architecture:** Our backend proxies all calls to SGP's own API (Token+App
auth, form-urlencoded, the same mechanism as Chat Mix's "Gerenciar Sgp"
screen). A new isolated `sgp-client.js` module owns all outbound HTTP to
SGP; new authenticated routes expose normalized JSON to the frontend; a new
collapsible sidebar panel inside `ConversationView` (same visual pattern as
the existing `TeamPanel`) is where the attendant searches and acts.

**Tech Stack:** Node.js/Express/PostgreSQL backend (existing stack, `axios`
already used for outbound HTTP in `meta-cloud.adapter.js`), React 18 +
Tailwind frontend (existing stack).

**Spec:** `docs/superpowers/specs/2026-09-08-sgp-attendant-lookup-design.md`

## Global Constraints

- Manual only — no automation/triage bot wires into this feature.
- No extra permission restriction beyond the existing JWT login — any
  authenticated agent can search a CPF and generate a boleto; only the
  admin-only config screen requires the `admin` role.
- `contratoCentralSenha` and `servico_senha` (the customer's plaintext
  account passwords, present in SGP's raw `consultacliente` response) must
  **never** appear in any response this backend sends to the frontend.
- The SGP query token is stored in plaintext in `sgp_query_config.token`
  (same accepted tradeoff as the Meta Cloud access token in
  `channels.config` elsewhere in this codebase) and is **never** returned
  in full by any route — only the last 4 characters (`tokenLast4`).
- Every outbound call to SGP uses a 15s axios timeout, no automatic retry.
- "Liberação em confiança" (trust-based unlock) is explicitly **out of
  scope** for this plan — do not add any route, button, or SGP call for it.

---

### Task 1: `sgp_query_config` table + repository

**Files:**
- Create: `migrations/1788830000000_create-sgp-query-config-table.js`
- Create: `src/integrations/sgp-query-config.repository.js`
- Test: `src/integrations/sgp-query-config.repository.test.js`

**Interfaces:**
- Produces: `getSgpQueryConfig()` → `Promise<{id, baseUrl, app, token, enabled} | null>`;
  `upsertSgpQueryConfig({baseUrl, app, token, enabled})` → `Promise<{id, baseUrl, app, token, enabled}>`
  (`token` may be `null`/falsy on update — keeps the existing stored token).

- [ ] **Step 1: Write the migration**

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sgp_query_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_url TEXT NOT NULL,
      app TEXT NOT NULL,
      token TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE sgp_query_config;`);
};
```

- [ ] **Step 2: Run the migration against the local test DB**

Run: `npm run migrate -- up` (uses `.env.test`'s `DATABASE_URL`, same as
every prior plan in this project).
Expected: migration `1788830000000_create-sgp-query-config-table` applied,
no errors.

- [ ] **Step 3: Write the failing repository tests**

```js
const { getPool, closePool } = require('../db/pool');
const { getSgpQueryConfig, upsertSgpQueryConfig } = require('./sgp-query-config.repository');

describe('sgp query config repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE sgp_query_config');
  });

  afterAll(async () => {
    await closePool();
  });

  test('getSgpQueryConfig returns null when nothing is configured', async () => {
    expect(await getSgpQueryConfig()).toBeNull();
  });

  test('upsertSgpQueryConfig creates the row on first save', async () => {
    const config = await upsertSgpQueryConfig({
      baseUrl: 'https://dwtelecom.sgp.tsmx.com.br',
      app: 'chatmix',
      token: 'secret-token',
      enabled: true,
    });
    expect(config.baseUrl).toBe('https://dwtelecom.sgp.tsmx.com.br');
    expect(config.app).toBe('chatmix');
    expect(config.token).toBe('secret-token');
    expect(config.enabled).toBe(true);

    const fetched = await getSgpQueryConfig();
    expect(fetched.id).toBe(config.id);
  });

  test('upsertSgpQueryConfig updates the existing row instead of creating a second one', async () => {
    await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true });
    const updated = await upsertSgpQueryConfig({ baseUrl: 'https://b.example', app: 'chatmix', token: 'tok-2', enabled: false });

    expect(updated.baseUrl).toBe('https://b.example');
    expect(updated.token).toBe('tok-2');
    expect(updated.enabled).toBe(false);

    const all = await getPool().query('SELECT id FROM sgp_query_config');
    expect(all.rowCount).toBe(1);
  });

  test('upsertSgpQueryConfig keeps the existing token when a falsy token is passed', async () => {
    await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true });
    const updated = await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: null, enabled: true });

    expect(updated.token).toBe('tok-1');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest src/integrations/sgp-query-config.repository.test.js`
Expected: FAIL — `Cannot find module './sgp-query-config.repository'`

- [ ] **Step 5: Implement the repository**

```js
const { getPool } = require('../db/pool');

function toConfig(row) {
  return {
    id: row.id,
    baseUrl: row.base_url,
    app: row.app,
    token: row.token,
    enabled: row.enabled,
  };
}

async function getSgpQueryConfig() {
  const result = await getPool().query('SELECT * FROM sgp_query_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) return null;
  return toConfig(result.rows[0]);
}

async function upsertSgpQueryConfig({ baseUrl, app, token, enabled }) {
  const existing = await getPool().query('SELECT id, token FROM sgp_query_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const result = await getPool().query(
      `INSERT INTO sgp_query_config (base_url, app, token, enabled)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [baseUrl, app, token, enabled]
    );
    return toConfig(result.rows[0]);
  }
  const nextToken = token || existing.rows[0].token;
  const result = await getPool().query(
    `UPDATE sgp_query_config SET base_url = $2, app = $3, token = $4, enabled = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.rows[0].id, baseUrl, app, nextToken, enabled]
  );
  return toConfig(result.rows[0]);
}

module.exports = { getSgpQueryConfig, upsertSgpQueryConfig };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/integrations/sgp-query-config.repository.test.js`
Expected: PASS (4/4)

- [ ] **Step 7: Commit**

```bash
git add migrations/1788830000000_create-sgp-query-config-table.js src/integrations/sgp-query-config.repository.js src/integrations/sgp-query-config.repository.test.js
git commit -m "Add sgp_query_config table and repository"
```

---

### Task 2: `sgp-client.js` (outbound HTTP client to SGP)

**Files:**
- Create: `src/integrations/sgp-client.js`
- Test: `src/integrations/sgp-client.test.js`

**Interfaces:**
- Consumes: `getSgpQueryConfig()` from Task 1's `src/integrations/sgp-query-config.repository.js`.
- Produces: `lookupClientByCpf(cpf)` → `Promise<{client: {id, name, document}, contracts: [{id, status, plan, openInvoicesCount, openAmount, address, phones, emails}]}>`;
  `getDuplicateInvoice(contratoId)` → `Promise<{hasOpenInvoice, duplicates: [{id, dueDate, value, barCode, pixCode, boletoLink}]}>`;
  error classes `SgpNotConfiguredError`, `SgpDisabledError`, `SgpClientNotFoundError`, `SgpRequestError` (all `Error` subclasses, used by Task 4's routes to pick the right HTTP status).

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('axios');
jest.mock('./sgp-query-config.repository');
const axios = require('axios');
const { getSgpQueryConfig } = require('./sgp-query-config.repository');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('./sgp-client');

const CONFIG = { baseUrl: 'https://dwtelecom.sgp.tsmx.com.br', app: 'chatmix', token: 'tok-123', enabled: true };

describe('sgp-client', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('lookupClientByCpf', () => {
    test('throws SgpNotConfiguredError when there is no config', async () => {
      getSgpQueryConfig.mockResolvedValue(null);
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpNotConfiguredError);
      expect(axios.post).not.toHaveBeenCalled();
    });

    test('throws SgpDisabledError when the integration is disabled', async () => {
      getSgpQueryConfig.mockResolvedValue({ ...CONFIG, enabled: false });
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpDisabledError);
    });

    test('calls consultacliente and normalizes the response, excluding password fields', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({
        data: {
          msg: 'Contrato(s) Localizado(s)',
          contratos: [
            {
              contratoId: 17402,
              clienteId: 16957,
              cpfCnpj: '036.668.113-37',
              razaoSocial: 'CLIENTE EXEMPLO',
              contratoStatus: 1,
              contratoStatusDisplay: 'Ativo',
              contratoTitulosAReceber: 1,
              contratoValorAberto: 89.9,
              servico_plano: '1GB',
              servico_senha: 'segredo-login',
              contratoCentralSenha: 'segredo-central',
              endereco_logradouro: 'RUA EXEMPLO',
              endereco_numero: 523,
              endereco_bairro: 'CENTRO',
              endereco_cidade: 'CANDIDO MENDES',
              endereco_uf: 'MA',
              telefones: [{ tipoContato: 'WhatsApp Número', contato: '(98) 98512-0338' }],
              emails: [{ tipoContato: 'E-Mail', contato: 'exemplo@dominio.com' }],
            },
          ],
        },
      });

      const result = await lookupClientByCpf('03666811337');

      expect(axios.post).toHaveBeenCalledWith(
        'https://dwtelecom.sgp.tsmx.com.br/api/ura/consultacliente',
        expect.stringContaining('cpfcnpj=03666811337'),
        expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
      );
      expect(result.client).toEqual({ id: 16957, name: 'CLIENTE EXEMPLO', document: '036.668.113-37' });
      expect(result.contracts).toEqual([
        {
          id: 17402,
          status: 'Ativo',
          plan: '1GB',
          openInvoicesCount: 1,
          openAmount: 89.9,
          address: 'RUA EXEMPLO, 523 - CENTRO - CANDIDO MENDES/MA',
          phones: ['(98) 98512-0338'],
          emails: ['exemplo@dominio.com'],
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('segredo');
    });

    test('throws SgpClientNotFoundError when contratos is empty', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockResolvedValue({ data: { msg: 'Nada encontrado', contratos: [] } });
      await expect(lookupClientByCpf('00000000000')).rejects.toBeInstanceOf(SgpClientNotFoundError);
    });

    test('throws SgpRequestError when the SGP call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post.mockRejectedValue(new Error('timeout of 15000ms exceeded'));
      await expect(lookupClientByCpf('03666811337')).rejects.toBeInstanceOf(SgpRequestError);
    });
  });

  describe('getDuplicateInvoice', () => {
    test('returns hasOpenInvoice: false when fatura2via has no links', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [] } }) // titulos
        .mockResolvedValueOnce({ data: { status: 0, links: [] } }); // fatura2via

      const result = await getDuplicateInvoice(17402);

      expect(result).toEqual({ hasOpenInvoice: false, duplicates: [] });
    });

    test('chains titulos -> fatura2via -> pagamento/pix and normalizes duplicates', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [{ status: 'aberto' }] } }) // titulos
        .mockResolvedValueOnce({
          data: {
            status: 1,
            links: [
              {
                id: '999',
                fatura: '1',
                vencimento: '2026-09-20',
                valor: 89.9,
                linhadigitavel: '836100000012',
                codigopix: 'stale-pix-from-fatura2via',
                link: 'https://dwtelecom.sgp.tsmx.com.br/boleto/999',
              },
            ],
          },
        }) // fatura2via
        .mockResolvedValueOnce({ data: { status: 1, msg: 'Dados do Pix', pix: '000201-fresh-pix-emv' } }); // pagamento/pix/999

      const result = await getDuplicateInvoice(17402);

      expect(axios.post).toHaveBeenNthCalledWith(
        3,
        'https://dwtelecom.sgp.tsmx.com.br/api/ura/pagamento/pix/999',
        expect.stringContaining('contrato=17402'),
        expect.any(Object)
      );
      expect(result).toEqual({
        hasOpenInvoice: true,
        duplicates: [
          {
            id: '999',
            dueDate: '2026-09-20',
            value: 89.9,
            barCode: '836100000012',
            pixCode: '000201-fresh-pix-emv',
            boletoLink: 'https://dwtelecom.sgp.tsmx.com.br/boleto/999',
          },
        ],
      });
    });

    test('falls back to fatura2via\'s own codigopix when the dedicated pix call fails', async () => {
      getSgpQueryConfig.mockResolvedValue(CONFIG);
      axios.post
        .mockResolvedValueOnce({ data: { faturas: [] } })
        .mockResolvedValueOnce({
          data: { status: 1, links: [{ id: '999', vencimento: '2026-09-20', valor: 89.9, linhadigitavel: '836...', codigopix: 'fallback-pix', link: 'https://x' }] },
        })
        .mockRejectedValueOnce(new Error('timeout'));

      const result = await getDuplicateInvoice(17402);

      expect(result.duplicates[0].pixCode).toBe('fallback-pix');
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/integrations/sgp-client.test.js`
Expected: FAIL — `Cannot find module './sgp-client'`

- [ ] **Step 3: Implement `sgp-client.js`**

```js
const axios = require('axios');
const { getSgpQueryConfig } = require('./sgp-query-config.repository');

class SgpNotConfiguredError extends Error {}
class SgpDisabledError extends Error {}
class SgpClientNotFoundError extends Error {}
class SgpRequestError extends Error {}

async function requireConfig() {
  const config = await getSgpQueryConfig();
  if (!config) throw new SgpNotConfiguredError('SGP integration is not configured');
  if (!config.enabled) throw new SgpDisabledError('SGP integration is not enabled');
  return config;
}

async function postSgp(config, path, params) {
  try {
    return await axios.post(`${config.baseUrl}${path}`, new URLSearchParams({ token: config.token, app: config.app, ...params }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
  } catch (err) {
    throw new SgpRequestError(`Failed to reach SGP at ${path}`);
  }
}

function formatAddress(c) {
  const parts = [];
  if (c.endereco_logradouro) {
    parts.push(c.endereco_numero ? `${c.endereco_logradouro}, ${c.endereco_numero}` : c.endereco_logradouro);
  }
  if (c.endereco_bairro) parts.push(c.endereco_bairro);
  const cityUf = [c.endereco_cidade, c.endereco_uf].filter(Boolean).join('/');
  if (cityUf) parts.push(cityUf);
  return parts.join(' - ');
}

function toContract(c) {
  return {
    id: c.contratoId,
    status: c.contratoStatusDisplay,
    plan: c.servico_plano,
    openInvoicesCount: c.contratoTitulosAReceber,
    openAmount: c.contratoValorAberto,
    address: formatAddress(c),
    phones: (c.telefones || []).map((t) => t.contato),
    emails: (c.emails || []).map((e) => e.contato),
  };
}

async function lookupClientByCpf(cpf) {
  const config = await requireConfig();
  const response = await postSgp(config, '/api/ura/consultacliente', { cpfcnpj: cpf });
  const contratos = response.data.contratos;
  if (!Array.isArray(contratos) || contratos.length === 0) {
    throw new SgpClientNotFoundError('Client not found');
  }
  return {
    client: { id: contratos[0].clienteId, name: contratos[0].razaoSocial, document: contratos[0].cpfCnpj },
    contracts: contratos.map(toContract),
  };
}

async function getDuplicateInvoice(contratoId) {
  const config = await requireConfig();
  // Mirrors the exact call chain observed in the user's real Chat Mix test
  // captures. This first call's response is unused — it exists only to
  // replicate the real flow.
  await postSgp(config, '/api/central/titulos', { contrato: contratoId, nao_gerar_os: 1 });

  const generated = await postSgp(config, '/api/ura/fatura2via', { contrato: contratoId, nao_gerar_os: 1 });
  const links = generated.data.links;
  if (!generated.data.status || !Array.isArray(links) || links.length === 0) {
    return { hasOpenInvoice: false, duplicates: [] };
  }

  const duplicates = await Promise.all(
    links.map(async (link) => {
      let pixCode = link.codigopix || null;
      try {
        const pixResponse = await postSgp(config, `/api/ura/pagamento/pix/${link.id}`, { contrato: contratoId });
        if (pixResponse.data.pix) pixCode = pixResponse.data.pix;
      } catch (err) {
        // Keep fatura2via's own codigopix as a fallback rather than failing the whole action.
      }
      return {
        id: link.id,
        dueDate: link.vencimento,
        value: link.valor,
        barCode: link.linhadigitavel,
        pixCode,
        boletoLink: link.link,
      };
    })
  );

  return { hasOpenInvoice: true, duplicates };
}

module.exports = {
  lookupClientByCpf,
  getDuplicateInvoice,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/integrations/sgp-client.test.js`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/sgp-client.js src/integrations/sgp-client.test.js
git commit -m "Add sgp-client module for outbound SGP client/invoice lookups"
```

---

### Task 3: Admin config routes (`sgp-query-config`)

**Files:**
- Modify: `src/api/admin-integrations.routes.js`
- Modify: `src/api/admin-integrations.routes.test.js`

**Interfaces:**
- Consumes: `getSgpQueryConfig`, `upsertSgpQueryConfig` from Task 1.
- Produces: `GET /api/admin/integrations/sgp-query-config`, `PUT /api/admin/integrations/sgp-query-config` (mounted automatically — this router is already mounted at `/api/admin/integrations` in `server.js`, no server.js change needed for this task).

- [ ] **Step 1: Write the failing tests**

Append to `src/api/admin-integrations.routes.test.js` (add the import at the
top alongside the existing ones):

```js
// add to the existing jest.mock/require block at the top of the file:
jest.mock('../integrations/sgp-query-config.repository');
const { getSgpQueryConfig, upsertSgpQueryConfig } = require('../integrations/sgp-query-config.repository');
```

```js
describe('GET /api/admin/integrations/sgp-query-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns configured: false when nothing is saved', async () => {
    getSgpQueryConfig.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  test('returns the config with only the last 4 characters of the token', async () => {
    getSgpQueryConfig.mockResolvedValue({ id: 'cfg-1', baseUrl: 'https://x.example', app: 'chatmix', token: '4c3b1ec5-1308-4120-88be-cf83debe5c7a', enabled: true });
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(getSgpQueryConfig).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/integrations/sgp-query-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when baseUrl is missing', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ app: 'chatmix', token: 'tok', enabled: true });
    expect(res.status).toBe(400);
  });

  test('returns 400 when creating for the first time without a token', async () => {
    getSgpQueryConfig.mockResolvedValue(null);
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ baseUrl: 'https://x.example', app: 'chatmix', enabled: true });
    expect(res.status).toBe(400);
    expect(upsertSgpQueryConfig).not.toHaveBeenCalled();
  });

  test('saves the config and returns it masked', async () => {
    getSgpQueryConfig.mockResolvedValue(null);
    upsertSgpQueryConfig.mockResolvedValue({ id: 'cfg-1', baseUrl: 'https://x.example', app: 'chatmix', token: 'brand-new-token', enabled: true });

    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ baseUrl: 'https://x.example', app: 'chatmix', token: 'brand-new-token', enabled: true });

    expect(upsertSgpQueryConfig).toHaveBeenCalledWith({ baseUrl: 'https://x.example', app: 'chatmix', token: 'brand-new-token', enabled: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: 'oken', enabled: true });
  });

  test('allows updating without a token when already configured', async () => {
    getSgpQueryConfig.mockResolvedValue({ id: 'cfg-1', baseUrl: 'https://old.example', app: 'chatmix', token: 'kept-token', enabled: true });
    upsertSgpQueryConfig.mockResolvedValue({ id: 'cfg-1', baseUrl: 'https://new.example', app: 'chatmix', token: 'kept-token', enabled: false });

    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ baseUrl: 'https://new.example', app: 'chatmix', enabled: false });

    expect(upsertSgpQueryConfig).toHaveBeenCalledWith({ baseUrl: 'https://new.example', app: 'chatmix', token: null, enabled: false });
    expect(res.status).toBe(200);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ baseUrl: 'https://x.example', app: 'chatmix', token: 'tok', enabled: true });
    expect(res.status).toBe(403);
    expect(upsertSgpQueryConfig).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/api/admin-integrations.routes.test.js`
Expected: FAIL — the new `describe` blocks 404 (routes don't exist yet).

- [ ] **Step 3: Implement the routes**

Add to `src/api/admin-integrations.routes.js` (new import at the top, new
routes at the bottom before `module.exports`):

```js
const { getSgpQueryConfig, upsertSgpQueryConfig } = require('../integrations/sgp-query-config.repository');
```

```js
function toQueryConfigResponse(config) {
  if (!config) return { configured: false };
  return {
    configured: true,
    baseUrl: config.baseUrl,
    app: config.app,
    tokenLast4: config.token.slice(-4),
    enabled: config.enabled,
  };
}

router.get('/sgp-query-config', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getSgpQueryConfig();
  res.json(toQueryConfigResponse(config));
});

router.put('/sgp-query-config', requireAuth, requireRole('admin'), async (req, res) => {
  const { baseUrl, app, token, enabled } = req.body || {};
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ error: 'baseUrl is required' });
  }
  if (typeof app !== 'string' || !app.trim()) {
    return res.status(400).json({ error: 'app is required' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const existing = await getSgpQueryConfig();
  const hasToken = typeof token === 'string' && token.trim().length > 0;
  if (!existing && !hasToken) {
    return res.status(400).json({ error: 'token is required' });
  }
  const config = await upsertSgpQueryConfig({
    baseUrl: baseUrl.trim(),
    app: app.trim(),
    token: hasToken ? token.trim() : null,
    enabled,
  });
  res.json(toQueryConfigResponse(config));
});
```

(Keep `module.exports = router;` as the last line of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/api/admin-integrations.routes.test.js`
Expected: PASS (all tests, old + new)

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-integrations.routes.js src/api/admin-integrations.routes.test.js
git commit -m "Add admin routes for the SGP query (client/boleto) config"
```

---

### Task 4: Attendant-facing query routes

**Files:**
- Create: `src/api/sgp-query.routes.js`
- Test: `src/api/sgp-query.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `lookupClientByCpf`, `getDuplicateInvoice`, and the 4 error
  classes from Task 2's `src/integrations/sgp-client.js`.
- Produces: `GET /api/sgp/clientes?cpf=`, `POST /api/sgp/contratos/:contratoId/boleto`, mounted at `/api/sgp`.

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../integrations/sgp-client');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('../integrations/sgp-client');
const sgpQueryRoutes = require('./sgp-query.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sgp', sgpQueryRoutes);
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/sgp/clientes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sgp/clientes?cpf=03666811337');
    expect(res.status).toBe(401);
  });

  test('returns 400 when cpf is missing', async () => {
    const res = await request(buildApp())
      .get('/api/sgp/clientes')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(lookupClientByCpf).not.toHaveBeenCalled();
  });

  test('strips non-digit characters from cpf before calling the client', async () => {
    lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
    await request(buildApp())
      .get('/api/sgp/clientes?cpf=036.668.113-37')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(lookupClientByCpf).toHaveBeenCalledWith('03666811337');
  });

  test('returns 200 with the normalized result', async () => {
    lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
  });

  test('returns 400 when SGP is not configured', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpNotConfiguredError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SGP integration is not configured' });
  });

  test('returns 400 when SGP is disabled', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpDisabledError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SGP integration is not enabled' });
  });

  test('returns 404 when the client is not found', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpClientNotFoundError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=00000000000')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Client not found' });
  });

  test('returns 502 when SGP cannot be reached', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to reach SGP' });
  });

  test('forwards an unexpected error to the error middleware', async () => {
    lookupClientByCpf.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/sgp/contratos/:contratoId/boleto', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 200 with the normalized duplicate invoice result', async () => {
    getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' }] });
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(getDuplicateInvoice).toHaveBeenCalledWith('17402');
    expect(res.status).toBe(200);
    expect(res.body.hasOpenInvoice).toBe(true);
  });

  test('returns 502 when SGP cannot be reached', async () => {
    getDuplicateInvoice.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(502);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/sgp/contratos/17402/boleto');
    expect(res.status).toBe(401);
    expect(getDuplicateInvoice).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/api/sgp-query.routes.test.js`
Expected: FAIL — `Cannot find module './sgp-query.routes'`

- [ ] **Step 3: Implement the routes**

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('../integrations/sgp-client');

const router = express.Router();

function handleSgpError(err, res) {
  if (err instanceof SgpNotConfiguredError) return res.status(400).json({ error: 'SGP integration is not configured' });
  if (err instanceof SgpDisabledError) return res.status(400).json({ error: 'SGP integration is not enabled' });
  if (err instanceof SgpClientNotFoundError) return res.status(404).json({ error: 'Client not found' });
  if (err instanceof SgpRequestError) return res.status(502).json({ error: 'Failed to reach SGP' });
  throw err;
}

router.get('/clientes', requireAuth, async (req, res) => {
  const cpf = typeof req.query.cpf === 'string' ? req.query.cpf.replace(/\D/g, '') : '';
  if (!cpf) {
    return res.status(400).json({ error: 'cpf is required' });
  }
  try {
    const result = await lookupClientByCpf(cpf);
    res.json(result);
  } catch (err) {
    handleSgpError(err, res);
  }
});

router.post('/contratos/:contratoId/boleto', requireAuth, async (req, res) => {
  try {
    const result = await getDuplicateInvoice(req.params.contratoId);
    res.json(result);
  } catch (err) {
    handleSgpError(err, res);
  }
});

module.exports = router;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/api/sgp-query.routes.test.js`
Expected: PASS (13/13)

- [ ] **Step 5: Mount the router in `server.js`**

Add the import next to the other route requires (near
`integrationsSgpRoutes`):

```js
const sgpQueryRoutes = require('./api/sgp-query.routes');
```

Add the mount next to the other `app.use('/api/...)` lines:

```js
app.use('/api/sgp', sgpQueryRoutes);
```

- [ ] **Step 6: Run the full backend test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS, same count as before plus this task's new tests.

- [ ] **Step 7: Commit**

```bash
git add src/api/sgp-query.routes.js src/api/sgp-query.routes.test.js src/server.js
git commit -m "Add attendant-facing SGP client/boleto lookup routes"
```

---

### Task 5: Frontend API functions + `useSgpQueryConfig` hook

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useSgpQueryConfig.js`
- Test: `frontend/src/hooks/useSgpQueryConfig.test.jsx`

**Interfaces:**
- Produces: `getSgpQueryConfig(token)`, `updateSgpQueryConfig(payload, token)`
  in `services/api.js`; `useSgpQueryConfig()` → `{config, loading, refresh}`.

- [ ] **Step 1: Add the API functions**

Append to `frontend/src/services/api.js`:

```js
export function getSgpQueryConfig(token) {
  return apiFetch('/api/admin/integrations/sgp-query-config', { token });
}

export function updateSgpQueryConfig(payload, token) {
  return apiFetch('/api/admin/integrations/sgp-query-config', { method: 'PUT', body: payload, token });
}
```

- [ ] **Step 2: Write the failing hook test**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpQueryConfig } from './useSgpQueryConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpQueryConfig', () => {
  test('fetches the config on mount', async () => {
    api.getSgpQueryConfig.mockResolvedValue({ configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true });

    const { result } = renderHook(() => useSgpQueryConfig());

    await waitFor(() => expect(result.current.config.configured).toBe(true));
    expect(api.getSgpQueryConfig).toHaveBeenCalledWith('tok-123');
  });

  test('starts with configured: false before the fetch resolves', () => {
    api.getSgpQueryConfig.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useSgpQueryConfig());
    expect(result.current.config).toEqual({ configured: false });
  });

  test('refresh refetches the config', async () => {
    api.getSgpQueryConfig.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useSgpQueryConfig());
    await waitFor(() => expect(api.getSgpQueryConfig).toHaveBeenCalledTimes(1));

    api.getSgpQueryConfig.mockResolvedValue({ configured: true, baseUrl: 'https://y.example', app: 'chatmix', tokenLast4: '1234', enabled: true });
    await act(() => result.current.refresh());

    expect(result.current.config.baseUrl).toBe('https://y.example');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run frontend/src/hooks/useSgpQueryConfig.test.jsx`
Expected: FAIL — `Cannot find module './useSgpQueryConfig'`

- [ ] **Step 4: Implement the hook**

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSgpQueryConfig } from '../services/api';

export function useSgpQueryConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState({ configured: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getSgpQueryConfig(token)
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/src/hooks/useSgpQueryConfig.test.jsx`
Expected: PASS (3/3)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useSgpQueryConfig.js frontend/src/hooks/useSgpQueryConfig.test.jsx
git commit -m "Add useSgpQueryConfig hook and its API functions"
```

---

### Task 6: `SgpQueryConfigCard` + wire into `IntegrationsAdminTab`

**Files:**
- Create: `frontend/src/components/SgpQueryConfigCard.jsx`
- Test: `frontend/src/components/SgpQueryConfigCard.test.jsx`
- Modify: `frontend/src/components/IntegrationsAdminTab.jsx`
- Modify: `frontend/src/components/IntegrationsAdminTab.test.jsx`

**Interfaces:**
- Consumes: `useSgpQueryConfig` (Task 5), `updateSgpQueryConfig` (Task 5).

- [ ] **Step 1: Write the failing component test**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SgpQueryConfigCard from './SgpQueryConfigCard';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSgpQueryConfig');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('SgpQueryConfigCard', () => {
  test('shows an empty form and requires a token when nothing is configured yet', async () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    render(<SgpQueryConfigCard />);

    await userEvent.type(screen.getByLabelText(/url de acesso ao sgp/i), 'https://x.example');
    await userEvent.type(screen.getByLabelText(/^app$/i), 'chatmix');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(api.updateSgpQueryConfig).not.toHaveBeenCalled();
    expect(screen.getByText(/token é obrigatório/i)).toBeInTheDocument();
  });

  test('shows only the last 4 characters of an already-saved token', () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);
    expect(screen.getByText(/5c7a/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^token$/i)).not.toBeInTheDocument();
  });

  test('saves without a token when already configured', async () => {
    const refresh = vi.fn();
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh,
    });
    api.updateSgpQueryConfig.mockResolvedValue({});
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateSgpQueryConfig).toHaveBeenCalledWith(
        { baseUrl: 'https://x.example', app: 'chatmix', token: undefined, enabled: true },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('lets the attendant reveal the token field to replace it', async () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /trocar token/i }));

    expect(screen.getByLabelText(/^token$/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/components/SgpQueryConfigCard.test.jsx`
Expected: FAIL — `Cannot find module './SgpQueryConfigCard'`

- [ ] **Step 3: Implement `SgpQueryConfigCard.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { updateSgpQueryConfig } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const cardClass = 'space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

function SgpQueryConfigCard() {
  const { token } = useAuth();
  const { config, refresh } = useSgpQueryConfig();
  const [baseUrl, setBaseUrl] = useState('');
  const [app, setApp] = useState('');
  const [newToken, setNewToken] = useState('');
  const [changingToken, setChangingToken] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (config.configured) {
      setBaseUrl(config.baseUrl);
      setApp(config.app);
      setEnabled(config.enabled);
    }
  }, [config]);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    if (!baseUrl.trim()) {
      setError('URL é obrigatória');
      return;
    }
    if (!app.trim()) {
      setError('App é obrigatório');
      return;
    }
    if (!config.configured && !newToken.trim()) {
      setError('Token é obrigatório');
      return;
    }
    setSaving(true);
    try {
      await updateSgpQueryConfig(
        { baseUrl: baseUrl.trim(), app: app.trim(), token: newToken.trim() || undefined, enabled },
        token
      );
      refresh();
      setChangingToken(false);
      setNewToken('');
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-ink-950">Consulta ao SGP (cliente/boleto)</h3>
      <div>
        <label htmlFor="sgp-query-base-url" className={labelClass}>URL de acesso ao SGP</label>
        <input id="sgp-query-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="sgp-query-app" className={labelClass}>App</label>
        <input id="sgp-query-app" value={app} onChange={(e) => setApp(e.target.value)} className={inputClass} />
      </div>
      <div>
        {config.configured && !changingToken ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-950/60">Token terminando em ...{config.tokenLast4}</span>
            <button type="button" onClick={() => setChangingToken(true)} className="text-sm font-medium text-teal-signal underline">
              Trocar token
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="sgp-query-token" className={labelClass}>Token</label>
            <input id="sgp-query-token" value={newToken} onChange={(e) => setNewToken(e.target.value)} className={inputClass} />
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-950/70">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-teal-signal" />
        Ativo
      </label>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Salvar
      </button>
    </form>
  );
}

export default SgpQueryConfigCard;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/components/SgpQueryConfigCard.test.jsx`
Expected: PASS (4/4)

- [ ] **Step 5: Wire it into `IntegrationsAdminTab.jsx`**

Add the import at the top:

```js
import SgpQueryConfigCard from './SgpQueryConfigCard';
```

Render it as the first child inside the outer `<div className="space-y-6">`,
before the existing `<div className="space-y-3">{integrations.map(...)}</div>`:

```jsx
return (
  <div className="space-y-6">
    <SgpQueryConfigCard />
    <div className="space-y-3">
      {integrations.map((integration) => (
        <IntegrationCard key={integration.id} integration={integration} channels={channels} templates={approvedTemplates} onChanged={refresh} />
      ))}
    </div>
    {/* ...unchanged form below... */}
```

- [ ] **Step 6: Update `IntegrationsAdminTab.test.jsx`**

Add near the top, alongside the existing mocks:

```js
vi.mock('../hooks/useSgpQueryConfig');
```

```js
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
```

In the top-level `beforeEach`, add:

```js
useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
```

- [ ] **Step 7: Run the frontend test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS, same count as before plus this task's new tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/SgpQueryConfigCard.jsx frontend/src/components/SgpQueryConfigCard.test.jsx frontend/src/components/IntegrationsAdminTab.jsx frontend/src/components/IntegrationsAdminTab.test.jsx
git commit -m "Add SgpQueryConfigCard and wire it into the Integrações admin tab"
```

---

### Task 7: Frontend lookup API functions + `useSgpLookup` hook

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useSgpLookup.js`
- Test: `frontend/src/hooks/useSgpLookup.test.jsx`

**Interfaces:**
- Produces: `lookupSgpClient(cpf, token)`, `generateSgpDuplicateInvoice(contratoId, token)`
  in `services/api.js`; `useSgpLookup()` →
  `{client, contracts, loading, error, search, fetchDuplicate, duplicateState}`.

- [ ] **Step 1: Add the API functions**

Append to `frontend/src/services/api.js`:

```js
export function lookupSgpClient(cpf, token) {
  return apiFetch(`/api/sgp/clientes?cpf=${encodeURIComponent(cpf)}`, { token });
}

export function generateSgpDuplicateInvoice(contratoId, token) {
  return apiFetch(`/api/sgp/contratos/${contratoId}/boleto`, { method: 'POST', token });
}
```

- [ ] **Step 2: Write the failing hook test**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpLookup } from './useSgpLookup';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';
import { ApiError } from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, lookupSgpClient: vi.fn(), generateSgpDuplicateInvoice: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpLookup', () => {
  test('search populates client and contracts on success', async () => {
    api.lookupSgpClient.mockResolvedValue({ client: { id: 1, name: 'Cliente X', document: '000' }, contracts: [{ id: 17402, status: 'Ativo' }] });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(api.lookupSgpClient).toHaveBeenCalledWith('03666811337', 'tok-123');
    expect(result.current.client.name).toBe('Cliente X');
    expect(result.current.contracts).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  test('search sets error "not_found" on a 404', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(404, { error: 'Client not found' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('00000000000'));

    expect(result.current.error).toBe('not_found');
    expect(result.current.client).toBeNull();
  });

  test('search sets error "error" on any other failure', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(502, { error: 'Failed to reach SGP' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(result.current.error).toBe('error');
  });

  test('fetchDuplicate stores the result keyed by contratoId', async () => {
    api.generateSgpDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '999' }] });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.fetchDuplicate(17402));

    expect(api.generateSgpDuplicateInvoice).toHaveBeenCalledWith(17402, 'tok-123');
    expect(result.current.duplicateState[17402]).toEqual({ loading: false, error: null, hasOpenInvoice: true, duplicates: [{ id: '999' }] });
  });

  test('fetchDuplicate stores a loading state per contratoId while pending', () => {
    api.generateSgpDuplicateInvoice.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSgpLookup());

    act(() => {
      result.current.fetchDuplicate(17402);
    });

    expect(result.current.duplicateState[17402]).toEqual({ loading: true, error: null });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run frontend/src/hooks/useSgpLookup.test.jsx`
Expected: FAIL — `Cannot find module './useSgpLookup'`

- [ ] **Step 4: Implement the hook**

```js
import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { lookupSgpClient, generateSgpDuplicateInvoice, ApiError } from '../services/api';

export function useSgpLookup() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [client, setClient] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [duplicateState, setDuplicateState] = useState({});

  const search = useCallback(
    (cpf) => {
      setLoading(true);
      setError(null);
      setClient(null);
      setContracts([]);
      setDuplicateState({});
      return lookupSgpClient(cpf, token)
        .then((data) => {
          setClient(data.client);
          setContracts(data.contracts);
          setLoading(false);
        })
        .catch((err) => {
          setError(err instanceof ApiError && err.status === 404 ? 'not_found' : 'error');
          setLoading(false);
        });
    },
    [token]
  );

  const fetchDuplicate = useCallback(
    (contratoId) => {
      setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: true, error: null } }));
      return generateSgpDuplicateInvoice(contratoId, token)
        .then((data) => {
          setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: false, error: null, ...data } }));
        })
        .catch(() => {
          setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: false, error: 'error' } }));
        });
    },
    [token]
  );

  return { client, contracts, loading, error, search, fetchDuplicate, duplicateState };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/src/hooks/useSgpLookup.test.jsx`
Expected: PASS (5/5)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useSgpLookup.js frontend/src/hooks/useSgpLookup.test.jsx
git commit -m "Add useSgpLookup hook and its API functions"
```

---

### Task 8: `SgpLookupPanel` component

**Files:**
- Create: `frontend/src/components/SgpLookupPanel.jsx`
- Test: `frontend/src/components/SgpLookupPanel.test.jsx`

**Interfaces:**
- Consumes: `useSgpLookup` (Task 7), `IconSearch` from `./icons/WaIcons`.
- Produces: default export `SgpLookupPanel` (no props — it is entirely
  self-contained, per the spec's decision not to auto-bind the CPF to the
  open conversation's contact).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SgpLookupPanel from './SgpLookupPanel';
import { useSgpLookup } from '../hooks/useSgpLookup';

vi.mock('../hooks/useSgpLookup');

const BASE_HOOK = {
  client: null,
  contracts: [],
  loading: false,
  error: null,
  search: vi.fn(),
  fetchDuplicate: vi.fn(),
  duplicateState: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SgpLookupPanel', () => {
  test('typing a CPF and submitting calls search with only digits', async () => {
    const search = vi.fn();
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, search });
    render(<SgpLookupPanel />);

    await userEvent.type(screen.getByLabelText(/cpf do cliente/i), '036.668.113-37');
    await userEvent.click(screen.getByLabelText(/^buscar$/i));

    expect(search).toHaveBeenCalledWith('03666811337');
  });

  test('shows "cliente não encontrado" on a not_found error', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, error: 'not_found' });
    render(<SgpLookupPanel />);
    expect(screen.getByText(/cliente não encontrado/i)).toBeInTheDocument();
  });

  test('renders the client and a card per contract', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO, 523' }],
    });
    render(<SgpLookupPanel />);
    expect(screen.getByText('Cliente Exemplo')).toBeInTheDocument();
    expect(screen.getByText(/1GB/)).toBeInTheDocument();
  });

  test('clicking "Gerar 2ª via + PIX" calls fetchDuplicate with the contract id', async () => {
    const fetchDuplicate = vi.fn();
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO' }],
      fetchDuplicate,
    });
    render(<SgpLookupPanel />);

    await userEvent.click(screen.getByRole('button', { name: /gerar 2ª via/i }));

    expect(fetchDuplicate).toHaveBeenCalledWith(17402);
  });

  test('shows the generated duplicate\'s bar code and PIX code', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO' }],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [{ id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' }] } },
    });
    render(<SgpLookupPanel />);
    expect(screen.getByText('836...')).toBeInTheDocument();
    expect(screen.getByText('000201...')).toBeInTheDocument();
  });

  test('shows "nenhuma fatura em aberto" when hasOpenInvoice is false', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO' }],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: false, duplicates: [] } },
    });
    render(<SgpLookupPanel />);
    expect(screen.getByText(/nenhuma fatura em aberto/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/components/SgpLookupPanel.test.jsx`
Expected: FAIL — `Cannot find module './SgpLookupPanel'`

- [ ] **Step 3: Implement `SgpLookupPanel.jsx`**

```jsx
import { useState } from 'react';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { IconSearch } from './icons/WaIcons';

function DuplicateResult({ state }) {
  if (!state) return null;
  if (state.loading) return <p className="mt-2 text-sm text-wa-muted">Gerando 2ª via...</p>;
  if (state.error) return <p className="mt-2 text-sm text-red-600">Não foi possível gerar a 2ª via agora.</p>;
  if (state.hasOpenInvoice === false) {
    return <p className="mt-2 text-sm text-wa-muted">Nenhuma fatura em aberto para este contrato.</p>;
  }
  if (!state.duplicates) return null;
  return (
    <div className="mt-2 space-y-2">
      {state.duplicates.map((duplicate) => (
        <div key={duplicate.id} className="rounded-lg border border-wa-border bg-white p-2 text-sm">
          <p>Vencimento: {duplicate.dueDate}</p>
          <p>Valor: R$ {duplicate.value}</p>
          {duplicate.barCode && (
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate">{duplicate.barCode}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(duplicate.barCode)} className="text-teal-signal underline">
                Copiar
              </button>
            </div>
          )}
          {duplicate.pixCode && (
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate">{duplicate.pixCode}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(duplicate.pixCode)} className="text-teal-signal underline">
                Copiar PIX
              </button>
            </div>
          )}
          {duplicate.boletoLink && (
            <a href={duplicate.boletoLink} target="_blank" rel="noreferrer" className="mt-1 block text-teal-signal underline">
              Abrir boleto
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function SgpLookupPanel() {
  const [cpf, setCpf] = useState('');
  const { client, contracts, loading, error, search, fetchDuplicate, duplicateState } = useSgpLookup();

  function handleSubmit(event) {
    event.preventDefault();
    const digits = cpf.replace(/\D/g, '');
    if (digits) search(digits);
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-wa-border bg-wa-panel p-3">
      <h2 className="mb-2 font-semibold text-wa-text">Consultar SGP</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
          placeholder="CPF do cliente"
          aria-label="CPF do cliente"
          className="flex-1 rounded-lg border border-wa-border px-2 py-1.5 text-sm"
        />
        <button type="submit" aria-label="Buscar" className="flex h-9 w-9 items-center justify-center rounded-lg bg-wa-green text-white">
          <IconSearch size={18} />
        </button>
      </form>

      {loading && <p className="mt-3 text-sm text-wa-muted">Buscando...</p>}
      {error === 'not_found' && <p className="mt-3 text-sm text-wa-muted">Cliente não encontrado.</p>}
      {error === 'error' && <p className="mt-3 text-sm text-red-600">Não foi possível consultar o SGP agora.</p>}

      {client && (
        <div className="mt-3">
          <p className="font-medium text-wa-text">{client.name}</p>
          <p className="text-sm text-wa-muted">{client.document}</p>
          <div className="mt-2 space-y-2">
            {contracts.map((contract) => (
              <div key={contract.id} className="rounded-lg border border-wa-border bg-white p-2">
                <p className="text-sm font-medium">
                  {contract.plan} — {contract.status}
                </p>
                <p className="text-xs text-wa-muted">{contract.address}</p>
                <button
                  type="button"
                  onClick={() => fetchDuplicate(contract.id)}
                  className="mt-2 rounded-lg bg-wa-green px-2 py-1 text-xs font-medium text-white"
                >
                  Gerar 2ª via + PIX
                </button>
                <DuplicateResult state={duplicateState[contract.id]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

export default SgpLookupPanel;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/components/SgpLookupPanel.test.jsx`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SgpLookupPanel.jsx frontend/src/components/SgpLookupPanel.test.jsx
git commit -m "Add SgpLookupPanel component"
```

---

### Task 9: Wire the panel into `ConversationView`

**Files:**
- Modify: `frontend/src/components/ConversationView.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: `SgpLookupPanel` (Task 8, which itself calls `useSgpLookup`).

- [ ] **Step 1: Write the failing tests**

Add to the top of `ConversationView.test.jsx`, alongside the existing mocks:

```js
vi.mock('../hooks/useSgpLookup');
```

```js
import { useSgpLookup } from '../hooks/useSgpLookup';
```

In the file's top-level `beforeEach`, add a default mock return so every
existing test keeps working unchanged:

```js
useSgpLookup.mockReturnValue({ client: null, contracts: [], loading: false, error: null, search: vi.fn(), fetchDuplicate: vi.fn(), duplicateState: {} });
```

Add a new `describe` block:

```js
describe('SGP lookup panel', () => {
  test('the panel is hidden until the "Consultar SGP" button is clicked', () => {
    render(<ConversationView conversation={CONVERSATION} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    // The header button's accessible name is "Consultar SGP" via aria-label, but the button
    // has no visible text content, so this only matches the panel's own <h2> once it renders.
    expect(screen.queryByText('Consultar SGP')).not.toBeInTheDocument();
  });

  test('clicking "Consultar SGP" shows the panel, clicking again hides it', async () => {
    render(<ConversationView conversation={CONVERSATION} onTransferClick={vi.fn()} onBack={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Consultar SGP'));
    expect(screen.getByText('Consultar SGP')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Consultar SGP'));
    expect(screen.queryByText('Consultar SGP')).not.toBeInTheDocument();
  });
});
```

(Use this file's existing `CONVERSATION` fixture and existing
`useConversationMessages`/`useAuth`/etc. mocks already set up earlier in the
file — do not redefine them.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/components/ConversationView.test.jsx`
Expected: FAIL — no element with `aria-label="Consultar SGP"` exists yet.

- [ ] **Step 3: Wire the panel into `ConversationView.jsx`**

Add the imports:

```js
import SgpLookupPanel from './SgpLookupPanel';
import { IconSearch } from './icons/WaIcons';
```

(`IconSearch` joins the existing icon import list from `./icons/WaIcons`.)

Add state, right next to the existing `useState` calls:

```js
const [sgpPanelOpen, setSgpPanelOpen] = useState(false);
```

(Deliberately NOT reset in the `useEffect` that resets `contactOverride`/
`editingContact`/`replyingTo` on conversation change — the panel is a
general-purpose search tool, not scoped to the open conversation's
contact, per the spec.)

Add the header button inside the existing
`<div className="flex shrink-0 items-center gap-0.5">` block, right after
the `HeaderIconButton` for "Ver atendimentos anteriores":

```jsx
<HeaderIconButton label="Consultar SGP" onClick={() => setSgpPanelOpen((prev) => !prev)}>
  <IconSearch size={22} />
</HeaderIconButton>
```

Change the component's root return to wrap the existing column plus the
conditional panel:

```jsx
return (
  <div className="flex h-full">
    <div className="flex h-full min-w-0 flex-1 flex-col bg-wa-chat font-wa">
      {/* ...everything that is currently inside the root div, unchanged... */}
    </div>
    {sgpPanelOpen && <SgpLookupPanel />}
  </div>
);
```

(Only the two wrapping `<div>` lines change — every element currently
inside the root `<div className="flex h-full flex-col bg-wa-chat font-wa">`
moves one level deeper, unmodified.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/components/ConversationView.test.jsx`
Expected: PASS, same count as before plus 2 new tests.

- [ ] **Step 5: Run the full frontend test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS, same count as before plus this plan's new tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "Add a collapsible SGP lookup panel to ConversationView"
```

---

## After all tasks: final checks

- Run the full backend suite (`npm test`) and full frontend suite
  (`cd frontend && npx vitest run`) one more time together.
- Remind the user this plan adds a migration
  (`1788830000000_create-sgp-query-config-table.js`) — `npm run migrate --
  up` must run in the Render Shell after this deploys, same as every prior
  plan with a migration in this project.
- Remind the user the admin "Consulta ao SGP (cliente/boleto)" card (new
  section in the existing "Integrações" admin tab) needs the real
  `dwtelecom.sgp.tsmx.com.br` URL / `chatmix` app / real token filled in
  before the feature works — same values already visible in Chat Mix's own
  "Gerenciar Sgp" screen.
