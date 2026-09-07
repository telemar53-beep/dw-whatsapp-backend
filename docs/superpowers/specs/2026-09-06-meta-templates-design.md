# Meta Cloud Templates & Conversation Initiation — Design

Extends `docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md`
(Meta Cloud webhook adapter) and
`docs/superpowers/specs/2026-09-06-attendant-initiated-conversations-design.md`
(`POST /api/conversations/start`, currently Baileys-only).

## Context

WhatsApp's official Cloud API only allows a business to freely message a
customer inside a 24-hour window that starts when the customer messages
first. Outside that window, the only way to reach a customer is a
**message template** pre-approved by Meta. `POST /api/conversations/start`
exists today for Baileys (unofficial, no such restriction) and explicitly
400s for any `meta_cloud` channel. This is the last major gap from the
user's original 8-item target-feature checklist: "(5) API Oficial da Meta
com templates aprovados."

The user already has a working WhatsApp Business Account (WABA) and plans
to operate more than one, possibly across different WABAs — so WABA
becomes a first-class concept in the data model, not an assumed singleton.

## Scope

**In scope:**
- Creating, submitting, and tracking approval status of message templates
  directly from this system's admin UI (no need to touch Meta's own
  Business Manager).
- Body-only text templates with positional variables (`{{1}}`, `{{2}}`,
  ...). No header/footer/buttons/media header in v1.
- Two categories: `MARKETING`, `UTILITY`. `AUTHENTICATION` (OTP codes) is
  out of scope — not a fit for this ISP's use cases.
- Real-time approval-status tracking via Meta's webhook
  (`message_template_status_update`), plus a manual "sync now" fallback
  per WABA.
- Extending `POST /api/conversations/start` to accept `meta_cloud`
  channels, always via an approved template (never free text — there is
  no other way to legally open a new window on the official API).
- A `wabaId` on each `meta_cloud` channel, since one WABA can hold several
  phone numbers and a template belongs to the WABA, not to one number.

**Out of scope (explicitly deferred):**
- Header (text/media), footer, and interactive buttons on templates.
- Editing an existing template's content — Meta doesn't support this;
  the only path is delete + recreate a new template.
- `AUTHENTICATION`-category templates.
- Any SGP-driven automated billing outreach (separate future topic,
  already recorded in project memory — unrelated to this spec).
- Migrating already-existing meta_cloud channels' `config` automatically;
  if any exist without a `wabaId` at deploy time, an admin sets it via the
  channel-edit path described below before templates can be created
  against that channel.

## Data model

**`channels.config` (existing JSONB, no migration needed for the column
itself)** gains a `wabaId` key for `type = 'meta_cloud'` rows, alongside
the existing `phoneNumberId`/`accessToken`. Required on creation from now
on; settable after the fact via channel edit (see API section).

**New table `message_templates`** (migration required):
- `id` UUID PK (`gen_random_uuid()`)
- `waba_id` TEXT NOT NULL — the WABA this template belongs to
- `meta_template_id` TEXT NOT NULL — the id Meta assigns on creation
- `name` TEXT NOT NULL — Meta's naming rule: lowercase letters, digits,
  underscores only (`^[a-z0-9_]+$`)
- `language` TEXT NOT NULL — e.g. `pt_BR`
- `category` TEXT NOT NULL CHECK (`category IN ('MARKETING', 'UTILITY')`)
- `body_text` TEXT NOT NULL — raw body with `{{1}}`, `{{2}}` placeholders
- `variable_count` INTEGER NOT NULL DEFAULT 0 — derived from `body_text`
  at creation time, used to know how many fill-in fields the
  start-conversation UI needs to render
- `status` TEXT NOT NULL DEFAULT `'PENDING'` CHECK (`status IN ('PENDING',
  'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')`) — all 5 real Meta
  statuses; an approved template can later be paused/disabled by Meta for
  quality reasons, so all 5 are tracked, not just the first 3
- `rejection_reason` TEXT NULL — populated from the webhook's `reason`
  field when status becomes `REJECTED`
- `created_at`, `updated_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`
- `UNIQUE (waba_id, name, language)` — mirrors Meta's own uniqueness rule

No `created_by_agent_id` — matches `sectors`/`quick_replies`, neither of
which track authorship.

## Template lifecycle

**Create:** admin picks an existing `meta_cloud` channel in the create
form (this is how we know which WABA + access token to use — any
`meta_cloud` channel whose `config.wabaId` matches works, since all
numbers under one WABA share template visibility), plus name, category,
language, and body text. Backend validates the name against Meta's regex,
extracts and validates the variables are sequential starting at `{{1}}`
(Meta rejects gaps), then calls:

```
POST https://graph.facebook.com/v20.0/{waba_id}/message_templates
{ name, category, language, components: [{ type: "BODY", text: body_text }] }
```

On success, Meta returns `{ id, status: "PENDING", category }` — store the
row with `meta_template_id = id`, `status = 'PENDING'`. On a Meta-side
rejection (bad name, duplicate, malformed), surface Meta's own error
message to the admin, matching this codebase's existing convention of
showing the backend's raw error body in every admin form.

**Track approval:** the existing single Meta webhook handler
(`POST /webhooks/meta` in `meta-cloud.routes.js`, today only parses
`messages` changes) gains a second parser for `change.field ===
'message_template_status_update'`. That event's `value` carries
`message_template_id`, `message_template_name`, `message_template_language`,
`event` (`APPROVED`/`REJECTED`/`PAUSED`/`DISABLED`/...), and `reason`
(only on rejection). Look the local row up by `meta_template_id` and
update `status`/`rejection_reason` in place. An event for a
`meta_template_id` with no matching local row is logged and skipped, not
an error (mirrors the "unrecognized Baileys message type" logging
pattern already used elsewhere — metadata only, never message content,
though this event carries no customer content anyway).

**Manual sync (safety net):** `POST /api/admin/templates/sync` with
`{ wabaId }` in the body. Looks up any `meta_cloud` channel whose
`config.wabaId` matches (to source a valid access token), calls:

```
GET https://graph.facebook.com/v20.0/{waba_id}/message_templates?fields=id,name,language,category,status
```

and upserts local rows by `meta_template_id` (updates `status` for
existing rows; does not import templates that don't already exist
locally, since those weren't created through this system and we have no
`body_text`/`variable_count` for them — this system is the source of
truth for templates it creates, not a full mirror of the WABA's template
library). This is a fallback for a missed webhook delivery, not a
scheduled job — no polling infrastructure needed.

**Delete:** `DELETE /api/admin/templates/:id`. Calls:

```
DELETE https://graph.facebook.com/v20.0/{waba_id}/message_templates?name={name}&hsm_id={meta_template_id}
```

(passing both `name` and `hsm_id` scopes the delete to this one
name+language pair, not every language variant of that name), then
removes the local row. **No edit endpoint exists** — Meta does not support
modifying a submitted template's content; the only path to change wording
is delete-and-recreate.

## Conversation-start flow (`POST /api/conversations/start`)

Baileys behavior is unchanged: `{ channelId, phoneNumber, content }`.

For a `meta_cloud` channel, the body becomes:
`{ channelId, phoneNumber, templateId, templateVariables }` — no
`content` field. The route:
1. Loads the channel; 400s if not `meta_cloud` (existing Baileys-only
   validation) — updated to allow `meta_cloud` down this new path instead
   of always rejecting it.
2. Loads the template by `templateId`; 404 if missing.
3. 400s if `template.status !== 'APPROVED'`.
4. 400s if `template.waba_id !== channel.config.wabaId` (blocks using a
   template from one WABA on a channel belonging to a different WABA).
5. 400s if `templateVariables.length !== template.variable_count`.
6. Substitutes `{{1}}`, `{{2}}`, ... in `template.body_text` with the
   given values — this substituted string is what gets stored as the
   message's `content` in the `messages` table, so the conversation view
   needs zero special-casing for template-originated messages; they
   render exactly like any other outbound text message.
7. Enqueues the outbound job with the raw template name/language/
   variables attached (new fields on the job payload:
   `templateName`, `templateLanguage`, `templateVariables`) alongside the
   already-substituted `content` for storage purposes.

`meta-cloud.adapter.js` gains `sendTemplateMessage(channel, toPhoneNumber,
{ name, language, variables })`, building WhatsApp's official template
message payload:

```
POST https://graph.facebook.com/v20.0/{phoneNumberId}/messages
{
  messaging_product: "whatsapp", to, type: "template",
  template: {
    name, language: { code: language },
    components: [{ type: "body", parameters: variables.map(v => ({ type: "text", text: v })) }]
  }
}
```

`outbound-worker.js`'s per-job handler branches: if the job carries a
`templateName`, call `sendTemplateMessage` instead of
`sendTextMessage`/`sendMediaMessage`; otherwise, behavior is exactly as
today. A template send is only ever enqueued from the Meta Cloud path of
`POST /api/conversations/start` — Baileys has no template concept, so
`baileys.manager.js` gets no `sendTemplateMessage` at all; this can only
matter if a future bug enqueues a template job against a Baileys channel,
which would throw and fail the job exactly like any other adapter error
does today.

## API surface

- `GET /api/templates?channelId=<id>` — any authenticated agent. Returns
  only `APPROVED` templates whose `waba_id` matches the given channel's
  `config.wabaId` — this is what powers the template dropdown in
  `StartConversationModal`. Mirrors the existing open-read convention
  (`GET /api/quick-replies`, `GET /api/channels`).
- `src/api/admin-templates.routes.js`, mounted at `/api/admin/templates`,
  admin-only (`requireAuth` + `requireRole('admin')`), mirroring
  `admin-triage.routes.js`'s conventions:
  - `GET /` — list all templates, all statuses (admin management view).
  - `POST /` — create (see lifecycle above).
  - `DELETE /:id` — delete (see lifecycle above).
  - `POST /sync` — manual per-WABA resync (see lifecycle above).
- `src/api/admin-channels.routes.js` changes:
  - `POST /` (create channel): for `type === 'meta_cloud'`, `wabaId` join
    `phoneNumberId`/`accessToken` as required fields.
  - `PATCH /:id`: gains an optional `wabaId` field (alongside the existing
    `triageEnabled`) so an admin can set/correct a `meta_cloud` channel's
    WABA after creation.

## Frontend

- **`StartConversationModal`**: when the selected channel is `meta_cloud`,
  swap the free-text message box for the Chat Mix-style flow already
  scoped during brainstorming — a blue banner ("Este canal requer o uso
  de template para iniciar o atendimento!"), a template dropdown (backed
  by `GET /api/templates?channelId=...`), and one text input per
  `{{n}}` variable the chosen template needs. For Baileys, the modal is
  unchanged.
- **New "Templates" admin tab**, mirroring `TriageAdminTab`/
  `SectorsAdminTab` structurally: a list of templates (name, language,
  category, status badge, rejection reason if rejected), a create form
  (channel picker + name/category/language/body), a delete button per
  row (with the existing `window.confirm` guard convention), and a
  "Sincronizar agora" button per distinct WABA appearing in the list.

## Error handling

- Every Meta Graph API call (create/list/delete template, send template
  message) can fail with a Meta-side error (invalid token, rate limit,
  policy violation) — surfaced as a 502 with Meta's error message
  attached, matching how other external-call failures already surface in
  this codebase (e.g. Baileys connection errors).
- A webhook template-status event for an unknown `meta_template_id` is
  logged and ignored, not a crash.
- Starting a conversation with a non-existent, non-approved, or
  wrong-WABA template all 400/404 with a clear message before any Meta
  API call is made — never a wasted or malformed Graph API request.

## Testing

- Unit tests: template name/variable validation (sequential `{{n}}`,
  rejects gaps), `sendTemplateMessage`'s payload shape, the webhook's new
  `message_template_status_update` parser.
- Repository tests: `message_templates` CRUD, the unique constraint,
  status-update-by-`meta_template_id`.
- Route tests (Meta API calls mocked via the existing `axios` mocking
  pattern already used for `meta-cloud.adapter.test.js`): create (success
  and Meta-rejection paths), list, delete, sync, and the extended
  `POST /api/conversations/start` for `meta_cloud` (approved template
  succeeds; wrong WABA, wrong status, wrong variable count each 400).
- Migration test: up → down → up, matching this project's established
  convention for every schema-changing plan.
