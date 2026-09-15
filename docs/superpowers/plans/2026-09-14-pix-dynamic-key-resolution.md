# Resolve the Pix Receiver Key for Dynamic Codes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today the official WhatsApp channels (Meta Cloud / 360dialog) only send the
native Pix payment card when the invoice's copy-paste code is a *static* Pix code (one
that carries the receiver's key inside the EMV/BR Code itself). Most real invoices from
this SGP account carry a *dynamic* code instead (an EMV/BR Code whose merchant-account
block only carries a lookup URL, no key) — those always fall back to plain text today,
which is most of the traffic. This plan resolves the missing key automatically, by
fetching the code's own lookup URL (a public, unauthenticated Pix "cobrança" endpoint
per the Central Bank's Pix API — confirmed live: a GET against
`https://qrcodespix.sejaefi.com.br/bolix/v2/cobv/<id>` returns a JSON body in the
`https://pix.bcb.gov.br/api/v2/error/...` error schema, i.e. this really is a BCB-spec
Pix charge-location endpoint), so the same official card the static-code path already
builds also goes out for dynamic codes, with no manual receiver registration (that was
explicitly rejected and removed in commit b808c0e).

**Architecture:** `src/payments/pix-emv.js` already exports the pure, synchronous
`lerRecebedorDoPix(codigo)`, which returns `{ name, key, keyType }` — `key` is `null` for
a dynamic code. This plan adds a second, async export in the same file,
`resolverRecebedorPix(codigo)`, that calls `lerRecebedorDoPix` first and, only when the
key came back `null`, extracts the location URL (EMV subtag `25` inside the same
merchant-account block that carries the GUI, id range 26–51 — same block `lerTlvs`/
`valorDaTag` already parse) and does one `axios.get` against `https://` + that URL to
resolve the missing key from the response body's `chave` field. Any failure (no URL
found, network error, timeout, non-2xx, missing `chave`) resolves to the same shape
`lerRecebedorDoPix` would have returned — `key: null` — so the caller's existing
text-fallback path is completely unchanged; nothing about this feature can leave the
customer without the copy-paste code. `src/queue/outbound-worker.js`'s
`sendPixOrFallback` is changed to call this new async resolver instead of the sync one,
but **only for official channels** — Baileys never needed a key (it uses the whole
copy-paste code as its own button payload) and must keep making zero network calls for
Pix sends.

**Tech Stack:** Node.js/Express, `axios` (already a dependency, already used by every
adapter in `src/whatsapp-adapters/`), Jest with mocked `axios.get` for the new tests —
no real network call in the test suite.

**Spec:** No separate spec document — this is a bounded fix approved in chat during
brainstorming (2026-09-14/15). This plan file is the sole authority.

## Global Constraints

- The Pix copy-paste code itself must never appear in a `console.log`/`console.error`
  call, in this plan's new code or anywhere it touches — this is an existing, strict
  project convention (`mensagemSegura`, see `src/queue/outbound-worker.js`'s existing
  comments). The resolved `chave` value is fine to omit from logs too; keep any new log
  line limited to a fixed string plus non-sensitive identifiers (e.g. the channel id),
  matching the style of the existing `console.error('Pix code carries no merchant key...')`
  line.
- `resolverRecebedorPix` must never throw — every failure mode (parse failure, no
  location URL, network error, timeout, bad JSON, missing `chave` field) resolves to the
  same `{ name, key: null, keyType: null }` (or `null` when `lerRecebedorDoPix` itself
  returned `null`) that the synchronous function would already produce, so
  `sendPixOrFallback`'s existing `semChaveNoOficial` / `motivoTexto = 'codigo_sem_chave'`
  branch keeps working unchanged. Do not add a new `motivoTexto` value — the existing
  frontend copy ("O código Pix deste boleto não traz a chave do recebedor...") already
  covers "no key available," regardless of whether that's because none existed or
  because the lookup failed.
- The network call needs a short timeout (5000ms) so a slow/unreachable PSP endpoint
  cannot stall the outbound queue's Pix job.
- Baileys sends must not change at all: no new `await`, no new network call, identical
  behavior and identical test expectations for that path.
- `lerRecebedorDoPix` stays exactly as it is (pure, synchronous, no I/O, same exports) —
  don't fold the network logic into it. Add the new function alongside it in the same
  file and export both.
- This project enumerates DB columns and is careful about `SELECT *`
  ([[project_columns_enumerated_not_star]]) — not relevant to this plan (no schema
  changes, no migration needed), noted only so no task invents one.

---

## Task 1: `resolverRecebedorPix` in `src/payments/pix-emv.js`

**Files:**
- Modify: `src/payments/pix-emv.js`
- Modify: `src/payments/pix-emv.test.js`

**Interfaces:**
- Produces: `async function resolverRecebedorPix(codigo)`, exported alongside the
  existing `lerRecebedorDoPix`. Same return shape as `lerRecebedorDoPix`:
  `null` (code isn't a parseable Pix EMV code) or `{ name, key, keyType }`.
- Consumed by: Task 2, in `src/queue/outbound-worker.js`.

**Step-by-step:**
1. Add `const axios = require('axios');` to the top of `src/payments/pix-emv.js`.
2. Write `resolverRecebedorPix(codigo)`:
   - Call the existing `lerRecebedorDoPix(codigo)`. If it returns `null`, return `null`
     immediately (not a valid Pix code at all — nothing to resolve).
   - If the result already has a non-null `key` (static code), return it unchanged. Do
     **not** make a network call in this case.
   - Otherwise (dynamic code, `key` is `null`): find the location URL. Re-run the same
     TLV walk `lerRecebedorDoPix` uses internally (`lerTlvs`/`valorDaTag`, already
     defined in this file, module-scoped — reuse them directly, don't duplicate the
     parsing) over `codigo`, find the same merchant-account block (id 26–51 whose
     subtag `00` GUI matches `br.gov.bcb.pix`, case-insensitive, already the logic
     `lerRecebedorDoPix` uses), and read subtag `25` from that block. That's the
     location URL, stored *without* a scheme (e.g.
     `qrcodespix.sejaefi.com.br/bolix/v2/cobv/<id>` — confirmed by manual test against
     production data during brainstorming). If subtag `25` isn't present, return the
     original result unchanged (`key: null`) — nothing to fetch.
   - If a location URL was found, `await axios.get('https://' + url, { timeout: 5000 })`
     inside a `try`. On success, read `response.data.chave` (BCB Pix "cobrança" JSON
     schema — top-level string field). If it's a non-empty string, return
     `{ name: resultado.name, key: chave.trim(), keyType: tipoDaChave(chave.trim()) }`
     (`tipoDaChave` is already defined in this file — reuse it, same as
     `lerRecebedorDoPix` does for the static-key path). If `chave` is missing/empty, or
     the request throws for any reason (network error, timeout, 4xx/5xx — a 404 in
     particular is expected and normal for an expired/already-paid charge, not a bug),
     catch it and return the original result unchanged (`key: null`) — never let the
     error propagate.
3. Export `resolverRecebedorPix` from `module.exports` alongside `lerRecebedorDoPix`.

**Tests to add in `src/payments/pix-emv.test.js`** (mock `axios.get` with
`jest.mock('axios')`; assert `axios.get` call count in each case to prove the
skip-when-static and skip-when-no-url paths never touch the network):
1. Static code (has an embedded key already) → `resolverRecebedorPix` returns the exact
   same object `lerRecebedorDoPix` would, and `axios.get` is **not** called.
2. Dynamic code (location URL present, no embedded key) + `axios.get` resolves
   `{ data: { chave: 'financeiro@example.com' } }` → returns
   `{ name, key: 'financeiro@example.com', keyType: 'EMAIL' }`.
3. Same dynamic code + `axios.get` rejects (simulate a network error) → returns
   `{ name, key: null, keyType: null }`, does not throw.
4. Same dynamic code + `axios.get` resolves but `response.data` has no `chave` field →
   returns `{ name, key: null, keyType: null }`, does not throw.
5. A code that isn't a valid Pix EMV code at all (same fixture `lerRecebedorDoPix`'s
   existing tests use to get `null`) → `resolverRecebedorPix` also returns `null`, and
   `axios.get` is **not** called.
6. Use realistic fixture codes built the same way the existing
   `pix-emv.test.js` fixtures are built (this file already has helpers/fixtures for
   constructing EMV TLV strings — reuse them rather than hand-writing new raw strings).

Run `npx jest src/payments/pix-emv.test.js` and confirm all pass before committing.

---

## Task 2: Wire the resolver into `src/queue/outbound-worker.js`

**Files:**
- Modify: `src/queue/outbound-worker.js`
- Modify: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: `resolverRecebedorPix` from Task 1 (`src/payments/pix-emv.js`).
- No new exports from this file — `sendPixOrFallback`'s exported signature is unchanged.

**Step-by-step:**
1. In `src/queue/outbound-worker.js`, change the import line from
   `const { lerRecebedorDoPix } = require('../payments/pix-emv');` to import both
   `lerRecebedorDoPix` and `resolverRecebedorPix`.
2. Inside `sendPixOrFallback`, the function currently opens with:
   ```js
   const merchant = lerRecebedorDoPix(pixCode);
   const oficial = isOfficialChannelType(channel.type);
   ```
   Reorder so `oficial` is computed first, then choose which resolver to call based on
   it:
   ```js
   const oficial = isOfficialChannelType(channel.type);
   const merchant = oficial ? await resolverRecebedorPix(pixCode) : lerRecebedorDoPix(pixCode);
   ```
   Everything below this in `sendPixOrFallback` (the `semChaveNoOficial` check, both
   `if` branches, the try/catch around `adapter.sendPixCardMessage`, the text fallback
   at the bottom) is **unchanged** — `merchant` already flows into all of it exactly as
   before, just resolved differently for official channels.
3. Update the JSDoc comment above `sendPixOrFallback` (currently explains the
   static-key-only behavior) to mention that official channels now also resolve the key
   from a dynamic code's own lookup URL before falling back to text — keep it brief,
   match the existing comment's tone and length.

**Tests to add/update in `src/queue/outbound-worker.test.js`**
(mock `../payments/pix-emv`'s `resolverRecebedorPix` and `lerRecebedorDoPix` separately
via `jest.mock`):
1. Official channel (`meta_cloud` or `360dialog`, whichever the existing tests already
   use as their official-channel fixture) + `resolverRecebedorPix` resolves a merchant
   with a key → the card is sent via `adapter.sendPixCardMessage` (same assertion style
   the existing "sends the native card" test already uses) and `lerRecebedorDoPix` is
   **not** called for that send.
2. Official channel + `resolverRecebedorPix` resolves `{ key: null }` (i.e., resolution
   found nothing) → falls back to text with `motivoTexto: 'codigo_sem_chave'`, same as
   the existing "no merchant key" test's assertions — update that existing test to mock
   `resolverRecebedorPix` (not `lerRecebedorDoPix`) resolving to the no-key shape,
   rather than deleting the coverage.
3. Baileys channel + a dynamic code → `lerRecebedorDoPix` is called (sync path) and
   `resolverRecebedorPix` is **not** called at all — this is the regression check
   proving Baileys still makes zero network calls for Pix sends. Existing Baileys Pix
   tests should keep passing unmodified aside from whichever mock wiring this task
   needs; do not change Baileys' observed behavior.

Run `npx jest src/queue/outbound-worker.test.js` and confirm all pass before committing.
Then run the full suite (`npx jest`) once both tasks are done, to catch any fallout in
other files that import `pix-emv.js` or `outbound-worker.js`.
