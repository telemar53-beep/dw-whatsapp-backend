# IA de atendimento humana — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a IA da triagem se comportar como uma boa atendente humana — sem pedir data de nascimento, sem repetir pergunta, sem virar formulário, sem dado da operação escrito no código — preservando todas as funcionalidades e a arquitetura configurável do painel.

**Architecture:** O prompt da triagem deixa de ser um construtor único de 44 KB e vira um compositor de módulos (`src/ai/prompt/`), onde cada fluxo declara a condição determinística sob a qual entra no contexto. A data de nascimento é removida de todos os caminhos, inclusive do retorno de ferramenta que é a causa raiz. O pedido de boleto de terceiro ganha um escopo de contratos separado, persistido, com lista de permissão fechada e minimização de dados — sem afrouxar a proteção `contract_not_owned`.

**Tech Stack:** Node.js, Express, PostgreSQL (`node-pg-migrate`), Bull/Redis, Jest, OpenAI SDK, React + Vite + Vitest no frontend.

**Spec:** `docs/superpowers/specs/2026-09-17-ia-atendimento-humana-design.md` (commit `80cc862`)

## Global Constraints

- **Idioma:** todo comentário, nome de teste e texto de prompt em português do Brasil.
- **Nenhum dado operacional configurável no código.** Planos, preços, velocidades, cidades, promoções e documentação vêm exclusivamente do painel (`config.triageExtraInstructions`). Nomes de setor e motivo nunca aparecem como string literal: referencie por papel.
- **Nenhuma menção a data de nascimento** em prompt, schema, descrição de ferramenta, `instrucao`, `proximoPasso` ou rótulo de UI.
- **Segredos:** a chave da OpenAI só é lida de `process.env.OPENAI_API_KEY`. Nunca em arquivo versionado, log, commit ou mensagem. Nunca impressa, nem mascarada.
- **Dados pessoais em log:** CPF, CNPJ e documento de terceiro nunca vão a `console.*`. Use `mensagemSegura(err)` para erros, como o resto do projeto já faz.
- **O escopo de terceiro nunca persiste nem duplica o CPF.** Ele guarda ids de contrato e primeiro nome. O documento continua existindo no histórico da conversa, porque o cliente o digitou numa mensagem — o que este plano garante é que o escopo de autorização não cria uma segunda cópia dele.
- **Os 30 minutos são TTL de autorização, não de retenção.** A validade é conferida na leitura, em memória, antes de qualquer uso. Sem limpeza ativa, o JSON expirado pode continuar na coluna até a próxima leitura daquela conversa — mas expirado ele nunca autoriza nada.
- **Autorização falha fechado.** Se gravar ou limpar `ai_triage_third_party` falhar, a ferramenta falha. Nunca `catch` que siga em frente: um escopo antigo que sobreviva a uma limpeza malsucedida é autorização viva sobre o contrato de um estranho.
- **Testes de backend:** `npm test` (roda `migrate:test` antes). Exige Docker com `dw-whatsapp-postgres` e `dw-whatsapp-redis` de pé.
- **Testes de frontend:** `npm test` dentro de `frontend/`.
- **Nenhum assert de IA compara frase literal de resposta.** Valide invariantes de comportamento.
- **Commits frequentes**, um por tarefa concluída, em português, terminando com:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Branch:** `ia-atendimento-humana`. Nunca commitar em `main`.

---

## Estrutura de arquivos

### Criados

| Arquivo | Responsabilidade |
|---|---|
| `migrations/1789200000000_add-ai-triage-third-party.js` | coluna `ai_triage_third_party` |
| `src/ai/third-party-scope.js` | ciclo de vida do escopo de terceiro: montar, validar, expirar |
| `src/ai/third-party-minimize.js` | projeção de campos permitidos no retorno de ferramenta de terceiro |
| `src/ai/prompt/montar.js` | compositor: ordem de montagem e seleção de módulos |
| `src/ai/prompt/principios.js` | hierarquia de prioridade, precedência do painel, regras de conversa |
| `src/ai/prompt/fatos.js` | estado determinístico (identidade, contratos, data/hora) |
| `src/ai/prompt/painel.js` | systemPrompt, instruções da operação, setores, motivos |
| `src/ai/prompt/formato.js` | regras de formatação do WhatsApp |
| `src/ai/prompt/fluxos/privacidade.js` | dados de outra pessoa |
| `src/ai/prompt/fluxos/terceiros.js` | boleto/PIX/fatura de outra pessoa |
| `src/ai/prompt/fluxos/identificacao.js` | pedir documento, identidade contestada |
| `src/ai/prompt/fluxos/suporte-geral.js` | alcance de Wi-Fi, equipamento, dados móveis |
| `src/ai/prompt/fluxos/suporte-diagnostico.js` | relato de falha, offline, suspenso, velocidade |
| `src/ai/prompt/fluxos/financeiro.js` | pagamento, boleto, PIX, sem fatura |
| `src/ai/prompt/fluxos/reativacao.js` | atraso longo |
| `src/ai/prompt/fluxos/comercial-novo.js` | cobertura, planos, endereço, documentação |
| `src/ai/prompt/fluxos/comercial-cliente.js` | upgrade, ponto adicional, mudança de endereço |
| `src/ai/prompt/fluxos/comprovante.js` | leitura de comprovante |
| `src/ai/prompt/fluxos/noturno.js` | modo noturno e desbloqueio em confiança |
| `src/ai/prompt/fluxos/multiplos-contratos.js` | desambiguação por endereço |
| `src/ai/prompt/fluxos/aviso-cidade.js` | falha regional ativa |
| `src/ai/prompt/fluxos/sgp-indisponivel.js` | SGP fora do ar |
| `src/ai/prompt/fluxos/limite-perguntas.js` | conclusão forçada |
| `scripts/dump-prompt.js` | renderiza os prompts em arquivo para revisão humana |
| `src/ai/simulacao-real.test.js` | harness multiturno com a OpenAI real |

Cada arquivo de `src/ai/` e `src/ai/prompt/` acompanha seu `.test.js` irmão.

### Modificados

`src/ai/ai-orchestrator.js`, `src/ai/tool-executor.js`, `src/ai/tool-registry.js`,
`src/ai/identity-resolver.js`, `src/ai/sgp-normalizer.js`, `src/integrations/sgp-client.js`,
`src/queue/ai-worker.js`, `src/ai/ai-config.repository.js`, `src/api/admin-ai.routes.js`,
`src/conversations/conversation.repository.js`, `src/conversations/courtesy-message.js`,
`src/ai/trust-unlock-rules.js`, `.gitignore`,
`frontend/src/pages/settings/automation/IdentificationPage.jsx`,
`frontend/src/pages/settings/automation/useAiTriageForm.js`,
`frontend/src/pages/settings/automation/aiToolLabels.js`,
`frontend/src/pages/settings/automation/AiTriagePage.jsx`,
`frontend/src/components/ConversationInfoPanel.jsx`.

### Apagados

`src/ai/data-nascimento.js`, `src/ai/data-nascimento.test.js`.

---

## Ordem das fases e dependências

```
FASE 1  Remoção da data de nascimento          Tasks 1-3    (independente)
FASE 2  Escopo de terceiro                     Tasks 4-8    (depende de 1-3: mexe no mesmo buscar_cliente)
FASE 3  Ferramentas e schemas                  Tasks 9-11   (depende de 4-8: o resumo cita o escopo)
FASE 4  Prompt em camadas                      Tasks 12-18  (depende de 1-3 e 9-11: não migra texto que será apagado)
FASE 5  Hardcode residual e validação          Tasks 19-20  (depende de tudo)
```

Cada fase termina com `npm test` verde e é um ponto de rollback. Ver "Pontos de rollback" no fim.

---

# FASE 1 — Remoção da data de nascimento

### Task 1: A causa raiz — `INSTRUCAO_IDENTIDADE`

**Files:**
- Modify: `src/ai/tool-executor.js:23-25`
- Test: `src/ai/tool-executor.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `INSTRUCAO_IDENTIDADE` com novo texto. Nenhuma mudança de assinatura.

- [ ] **Step 1: Escrever o teste que falha**

Em `src/ai/tool-executor.test.js`, no describe de recusas:

```js
test('a recusa por identidade não confirmada nunca manda pedir data de nascimento', async () => {
  const contexto = {
    ferramentasPermitidas: ['enviar_boleto'],
    identidade: { nivel: 'none' },
    contracts: [{ id: 1 }],
    contact: {},
  };
  const r = await executeTool('enviar_boleto', { contratoId: 1 }, contexto);
  expect(r.ok).toBe(false);
  expect(r.motivo).toBe('identity_not_confirmed');
  expect(r.instrucao).not.toMatch(/nascimento/i);
  expect(r.instrucao).not.toMatch(/confirmar_nascimento/);
  expect(r.instrucao).toMatch(/CPF ou CNPJ/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-executor.test.js -t "nunca manda pedir data de nascimento"`
Expected: FAIL — `instrucao` contém "data de nascimento".

- [ ] **Step 3: Trocar o texto**

Em `src/ai/tool-executor.js`, substituir as linhas 23-25 por:

```js
// A recusa chegava ao modelo como { erro: 'identity_not_confirmed' } seco e ele
// improvisava (defeito D, teste real 2026-09-14). O texto antigo mandava pedir a
// data de nascimento e chamar confirmar_nascimento — ferramenta que nem existia
// na lista do turno. Era esta linha, e não o prompt, que fazia a IA pedir a data
// em produção: resultado de ferramenta o modelo lê como fato apurado.
const INSTRUCAO_IDENTIDADE = 'Ainda não sei quem é o cliente. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo.';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-executor.test.js`
Expected: PASS em todo o arquivo.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tool-executor.js src/ai/tool-executor.test.js
git commit -m "IA: a recusa por identidade para de mandar pedir data de nascimento

Era a causa raiz. tool-executor.js devolvia ao modelo, como resultado de
ferramenta, a ordem de perguntar a data e chamar confirmar_nascimento — sem
checar a flag, e com a ferramenta fora da lista do turno. Resultado de
ferramenta pesa mais que proibicao no prompt, e por isso a regra era ignorada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Remover a ferramenta e o nível de identidade fraca

**Files:**
- Modify: `src/ai/tool-registry.js` (remove a ferramenta `confirmar_nascimento`, linhas 1177-1291; remove o ramo fraca de `buscar_cliente`, linhas 355-397; remove o import de `data-nascimento` na linha 34)
- Modify: `src/ai/identity-resolver.js` (remove `porDocumentoPendente`, `dataNascimento`, `nascimentoTentado`)
- Modify: `src/ai/ai-orchestrator.js:295-306` (`ferramentasDaTriagem` para de filtrar)
- Test: `src/ai/tool-registry.test.js`, `src/ai/identity-resolver.test.js`, `src/ai/ai-orchestrator.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `resolverIdentidade({ contact, ignorarTelefone })` — **sem** o parâmetro `documentoPendente`. Retorna `{ nivel: 'forte'|'none', origem, primeiroNome, contracts, client, contestado, sgpIndisponivel? }`. Os campos `dataNascimento` e `nascimentoTentado` deixam de existir.
  - `ferramentasDaTriagem(triagem, config)` — assinatura igual, sem o filtro de `confirmar_nascimento`.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/ai/tool-registry.test.js`:

```js
// listTools() e findTool() ja sao exportados; TOOLS nao e. findTool devolve
// null (nao undefined) quando nao acha.
const { listTools, findTool, toOpenAiTools } = require('./tool-registry');
const todasAsFerramentas = () => toOpenAiTools(listTools().map((t) => t.nome));

test('confirmar_nascimento não existe mais no registro de ferramentas', () => {
  expect(findTool('confirmar_nascimento')).toBeNull();
  expect(todasAsFerramentas().map((t) => t.function.name)).not.toContain('confirmar_nascimento');
});

test('nenhuma descrição ou parâmetro de ferramenta menciona nascimento', () => {
  expect(JSON.stringify(todasAsFerramentas())).not.toMatch(/nascimento/i);
});

test('buscar_cliente deixa a identidade forte e não devolve proximoPasso', async () => {
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 9, name: 'MARIA SILVA', document: '52998224725' },
    contracts: [{ id: 1, status: 1, address: 'Rua A' }],
  });
  const contexto = { ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1', contact: { id: 'ct1' }, identidade: { nivel: 'none' } };
  const r = await executeTool('buscar_cliente', { cpf: '52998224725' }, contexto);
  expect(r.ok).toBe(true);
  expect(r.resultado.proximoPasso).toBeUndefined();
  expect(contexto.identidade.nivel).toBe('forte');
});
```

Em `src/ai/identity-resolver.test.js`:

```js
test('a identidade nunca volta como fraca', async () => {
  sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 9, cpfcnpj: '52998224725' } });
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 9, name: 'MARIA SILVA', document: '52998224725' },
    contracts: [{ id: 1, status: 1, address: 'Rua A' }],
  });
  const id = await resolverIdentidade({ contact: { id: 'ct1', phoneNumber: '5598985120338' } });
  expect(['forte', 'none']).toContain(id.nivel);
  expect(id).not.toHaveProperty('dataNascimento');
  expect(id).not.toHaveProperty('nascimentoTentado');
});
```

Em `src/ai/ai-orchestrator.test.js`:

```js
test('confirmar_nascimento não entra na lista da triagem em nenhuma configuração', () => {
  for (const config of [{ triageRequireBirthdate: true }, { triageRequireBirthdate: false }, {}]) {
    for (const triagem of [{ noturno: { ativo: true } }, { noturno: { ativo: false } }]) {
      expect(ferramentasDaTriagem(triagem, config)).not.toContain('confirmar_nascimento');
    }
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-registry.test.js src/ai/identity-resolver.test.js -t "nascimento"`
Expected: FAIL — a ferramenta ainda existe.

- [ ] **Step 3: Remover**

Em `src/ai/tool-registry.js`:
1. Apagar o objeto inteiro de `confirmar_nascimento` (linhas 1177-1291).
2. Apagar o import da linha 34 (`normalizarDataNascimento`).
3. Em `buscar_cliente`, apagar o `if (!(configIa && configIa.triageRequireBirthdate)) {` e o `}` que o fecha, promovendo o corpo dele um nível. Apagar todo o bloco que vem depois — a busca de `dataNascimento`, a montagem da identidade `'fraca'`, o `setTriagePendingDocument(...args.cpf)` e o `return { cliente, quantidadeContratos, proximoPasso }` (linhas 355-397 do original). A leitura `const configIa = await getAiConfig();` some junto, se não for usada em mais nada na função.
4. Apagar as chamadas a `setTriagePendingDocument(..., null)` das linhas 343, 1261 e 1329 — a coluna deixa de ser usada.

Em `src/ai/identity-resolver.js`:
1. Apagar `porDocumentoPendente` inteira.
2. Em `resolverIdentidade`, remover o parâmetro `documentoPendente` e as duas linhas `if (documentoPendente) return await porDocumentoPendente(documentoPendente);`.
3. Em `porCpf`, apagar o bloco `try { const rec = await sgpClient.findClientRecord({ cpfcnpj: cpf }); dataNascimento = ... } catch` e o campo `dataNascimento` do retorno.
4. Remover `dataNascimento` e `nascimentoTentado` de `vazio()` e de `porMemoriaSemSgp()`.

Em `src/ai/ai-orchestrator.js`, em `ferramentasDaTriagem`, apagar as três últimas linhas (o comentário sobre a exigência, o `if (config && config.triageRequireBirthdate) return lista;` e o `return lista.filter(...)`), deixando só `return lista;`. Remover `'confirmar_nascimento'` da constante `FERRAMENTAS_TRIAGEM`.

- [ ] **Step 4: Rodar a suíte inteira e consertar o que quebrar**

Run: `npm test`
Expected: os testes antigos que exercitavam `confirmar_nascimento` e identidade fraca falham. **Apague-os** — são testes de um comportamento que deixou de existir. Não os reescreva.

Os testes a apagar estão em `src/ai/tool-registry.test.js` (describe de `confirmar_nascimento`), `src/ai/ai-orchestrator.test.js` (o bloco `com a data de nascimento dispensada` e os testes de identidade fraca por volta das linhas 519-560, 778-850, 960-1030) e `src/ai/identity-resolver.test.js`.

- [ ] **Step 5: Commit**

```bash
git add -A src/ai
git commit -m "IA: remover confirmar_nascimento e a identidade fraca

Sem a ferramenta, nao existe mais o estado em que o prompt mandava pedir a
data. buscar_cliente deixa a identidade forte direto, como ja fazia com a
flag desligada (que era o padrao).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Remover a flag, o painel e as sobras

**Files:**
- Modify: `src/ai/ai-config.repository.js:26,87-96`
- Modify: `src/api/admin-ai.routes.js:34,158-171`
- Modify: `src/integrations/sgp-client.js:4-6,222-250`
- Modify: `src/queue/ai-worker.js:7,190-197`
- Modify: `src/conversations/conversation.repository.js` (remove `incrementBirthdateAttempts`, `setTriagePendingDocument`, `getTriagePendingDocument` e seus exports)
- Modify: `src/ai/ai-orchestrator.js` (remove `garantirSemDataDeNascimento`, `PEDE_NASCIMENTO`, `INSTRUCAO_SEM_NASCIMENTO`, `pedeDataDeNascimento`, `semFraseDeNascimento`, `CHAVE_DATA_NASCIMENTO` e a chamada no fim de `runAiTurn`)
- Delete: `src/ai/data-nascimento.js`, `src/ai/data-nascimento.test.js`
- Modify: `frontend/src/pages/settings/automation/IdentificationPage.jsx`, `useAiTriageForm.js`, `aiToolLabels.js`, `frontend/src/components/ConversationInfoPanel.jsx`
- Test: os `.test.js` correspondentes

**Interfaces:**
- Consumes: Task 2.
- Produces: `getAiConfig()` sem a chave `triageRequireBirthdate`. `sgpClient.findClientRecord()` devolve `{ total, cliente: { id, cpfcnpj } | null }` — **sem** `dataNascimento`.

- [ ] **Step 1: Escrever o teste de varredura que falha**

Crie `src/ai/sem-nascimento.test.js`. É a rede permanente contra regressão:

```js
const fs = require('fs');
const path = require('path');

// Varre o codigo de producao (nao os testes) atras de qualquer mencao a data de
// nascimento. O pedido em producao voltou duas vezes por caminhos diferentes;
// esta e a guarda que impede a terceira.
const RAIZ = path.join(__dirname, '..');
const IGNORAR = /\.test\.js$|[\\/]node_modules[\\/]/;

function arquivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivosJs(p);
    return e.isFile() && p.endsWith('.js') && !IGNORAR.test(p) ? [p] : [];
  });
}

test('nenhum arquivo de produção menciona data de nascimento', () => {
  const culpados = arquivosJs(RAIZ)
    .filter((p) => /nascimento|birthdate|birth_date|dataNascimento/i.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(RAIZ, p));
  expect(culpados).toEqual([]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/sem-nascimento.test.js`
Expected: FAIL, listando `integrations/sgp-client.js`, `queue/ai-worker.js`, `ai/ai-orchestrator.js`, `ai/data-nascimento.js`, `conversations/conversation.repository.js`, `api/admin-ai.routes.js`, `ai/ai-config.repository.js`.

- [ ] **Step 3: Limpar cada um**

`src/ai/ai-config.repository.js`: remover `triageRequireBirthdate: Boolean(row.triage_require_birthdate)` do mapeamento, o parâmetro de `updateTriageConfig`, a coluna `triage_require_birthdate = $8` do UPDATE e o valor correspondente. **Renumere os parâmetros `$n` seguintes.**

`src/api/admin-ai.routes.js`: remover o campo da resposta (linha 34), o bloco de validação (158-162) e o campo passado a `updateTriageConfig` (171).

`src/integrations/sgp-client.js`: remover o import de `../ai/data-nascimento`, o campo `dataNascimento` do retorno de `findClientRecord` e os comentários que o explicam. Manter `omitir_*` e o `limit 2` como estão.

`src/queue/ai-worker.js`: remover o import de `getTriagePendingDocument`, a leitura `const documentoPendente = ...` e o argumento na chamada a `resolverIdentidade`.

`src/conversations/conversation.repository.js`: apagar as três funções e seus exports.

`src/ai/ai-orchestrator.js`: apagar `CHAVE_DATA_NASCIMENTO` e seu uso em `mascararArgsParaAuditoria`, `PEDE_NASCIMENTO`, `INSTRUCAO_SEM_NASCIMENTO`, `pedeDataDeNascimento`, `semFraseDeNascimento`, `garantirSemDataDeNascimento` inteira, e o bloco que a chama no fim de `runAiTurn` (`const semNascimento = await garantirSemDataDeNascimento({...})` e as três linhas seguintes).

```bash
git rm src/ai/data-nascimento.js src/ai/data-nascimento.test.js
```

- [ ] **Step 4: Limpar o frontend**

`IdentificationPage.jsx`: remover o `<Checkbox label="Exigir data de nascimento depois do CPF" ...>` e o que ficar órfão.
`useAiTriageForm.js`: remover `requireBirthdate` do estado inicial e do payload de salvamento.
`aiToolLabels.js`: remover a entrada `confirmar_nascimento`.
`ConversationInfoPanel.jsx`: remover a entrada `cpf_confirmed`.

Ajustar os `.test.jsx` que asseguravam esses campos: apague os casos, não os reescreva.

- [ ] **Step 5: Rodar tudo e ver passar**

Run: `npm test`
Expected: PASS, incluindo `sem-nascimento.test.js`.

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "IA: apagar a exigencia de data de nascimento do sistema inteiro

Flag do painel, busca no SGP, coluna pendente, rede de contencao em codigo e
rotulos da UI. Nenhuma migracao: as colunas ficam no banco, o codigo so para
de le-las. Teste de varredura em sem-nascimento.test.js impede a volta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# FASE 2 — Escopo de terceiro

### Task 4: Persistência do escopo

**Files:**
- Create: `migrations/1789200000000_add-ai-triage-third-party.js`
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `setThirdPartyScope(conversationId, escopo)` → `Promise<void>`. `escopo` é `{ nome: string, contratos: number[], expiraEm: string ISO }` ou `null` para limpar.
  - `getThirdPartyScope(conversationId)` → `Promise<{ nome, contratos, expiraEm } | null>`.

**Por que consulta dedicada:** o projeto enumera colunas em vez de `SELECT *` — `ai_triage_resolved_by_ai` aparece em 18 consultas. Uma coluna lida só pela própria consulta dedicada (como `ai_triage_pending_document` fazia) não entra em nenhuma das 18. Não adicione `ai_triage_third_party` às enumerações.

- [ ] **Step 1: Escrever a migração**

`migrations/1789200000000_add-ai-triage-third-party.js`:

```js
exports.up = (pgm) => {
  // Escopo do pedido de boleto/PIX de OUTRA pessoa, vivo por alguns minutos e
  // só nesta conversa. Guarda ids de contrato e o primeiro nome do titular —
  // NUNCA o CPF dele: depois da primeira consulta, as ferramentas de pagamento
  // operam por contratoId. Lida só por consulta dedicada, então não entra nas
  // enumerações de colunas das outras consultas de conversations.
  pgm.sql(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_third_party JSONB;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_third_party;
  `);
};
```

- [ ] **Step 2: Escrever o teste que falha**

Em `src/conversations/conversation.repository.test.js`:

```js
test('guarda, lê e limpa o escopo de terceiro da conversa', async () => {
  const conversation = await createConversation(contactId, channelId);
  expect(await getThirdPartyScope(conversation.id)).toBeNull();

  const escopo = { nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T23:00:00.000Z' };
  await setThirdPartyScope(conversation.id, escopo);
  expect(await getThirdPartyScope(conversation.id)).toEqual(escopo);

  await setThirdPartyScope(conversation.id, null);
  expect(await getThirdPartyScope(conversation.id)).toBeNull();
});

test('o escopo de terceiro de uma conversa inexistente é nulo', async () => {
  expect(await getThirdPartyScope('00000000-0000-0000-0000-000000000000')).toBeNull();
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run migrate:test -- up && npx dotenv -e .env.test -o -- npx jest src/conversations/conversation.repository.test.js -t "escopo de terceiro"`
Expected: FAIL — `setThirdPartyScope is not a function`.

- [ ] **Step 4: Implementar**

Em `src/conversations/conversation.repository.js`, junto das outras consultas dedicadas:

```js
/**
 * Escopo do pedido de boleto de outra pessoa. Vive na conversa porque o
 * atendimento pode levar mais de um turno (várias faturas, o cliente escolhe
 * uma). NUNCA guarda o documento do terceiro: os ids de contrato bastam para
 * as ferramentas de pagamento, e o CPF já não é necessário depois da consulta.
 */
async function setThirdPartyScope(conversationId, escopo) {
  await getPool().query(
    `UPDATE conversations SET ai_triage_third_party = $2 WHERE id = $1`,
    [conversationId, escopo ? JSON.stringify(escopo) : null]
  );
}

async function getThirdPartyScope(conversationId) {
  const result = await getPool().query(
    `SELECT ai_triage_third_party FROM conversations WHERE id = $1`,
    [conversationId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].ai_triage_third_party || null;
}
```

Adicionar os dois ao `module.exports`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/conversations/conversation.repository.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/1789200000000_add-ai-triage-third-party.js src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "Terceiro: coluna e consultas dedicadas do escopo na conversa

Guarda ids de contrato e primeiro nome do titular, nunca o CPF dele.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Ciclo de vida do escopo

**Files:**
- Create: `src/ai/third-party-scope.js`
- Test: `src/ai/third-party-scope.test.js`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `MINUTOS_DE_VIDA = 30`
  - `montarEscopo(nome, contratos, agora = new Date())` → `{ nome, contratos: number[], expiraEm: string }`
  - `escopoValido(escopo, agora = new Date())` → `boolean`
  - `paraContexto(escopo)` → `{ nome, contratos: [{ id }] } | null` — o formato que o turno usa.

- [ ] **Step 1: Escrever os testes que falham**

`src/ai/third-party-scope.test.js`:

```js
const { montarEscopo, escopoValido, paraContexto, MINUTOS_DE_VIDA } = require('./third-party-scope');

const AGORA = new Date('2026-09-17T20:00:00.000Z');

test('monta o escopo com só os ids dos contratos e uma validade de 30 minutos', () => {
  const escopo = montarEscopo('Maria', [{ id: 10, address: 'Rua A', status: 1 }, { id: 11 }], AGORA);
  expect(escopo).toEqual({ nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T20:30:00.000Z' });
  expect(MINUTOS_DE_VIDA).toBe(30);
});

// Endereco e status do terceiro NUNCA entram no escopo: sao dados cadastrais
// de outra pessoa, e o fluxo de pagamento nao precisa deles.
test('o escopo nunca guarda endereço, status, nome completo nem documento', () => {
  const escopo = montarEscopo('Maria', [{ id: 10, address: 'Rua A', status: 1, document: '52998224725' }], AGORA);
  expect(JSON.stringify(escopo)).not.toMatch(/Rua A|52998224725/);
  expect(Object.keys(escopo).sort()).toEqual(['contratos', 'expiraEm', 'nome']);
});

test('o escopo vale até o instante de expirar e não depois', () => {
  const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);
  expect(escopoValido(escopo, new Date('2026-09-17T20:29:59.000Z'))).toBe(true);
  expect(escopoValido(escopo, new Date('2026-09-17T20:30:01.000Z'))).toBe(false);
});

test('escopo ausente ou malformado nunca é válido', () => {
  for (const ruim of [null, undefined, {}, { nome: 'Maria' }, { contratos: [] }, { contratos: [1], expiraEm: 'xx' }]) {
    expect(escopoValido(ruim, AGORA)).toBe(false);
  }
});

test('paraContexto devolve os contratos no formato da checagem de propriedade', () => {
  expect(paraContexto({ nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T20:30:00.000Z' }))
    .toEqual({ nome: 'Maria', contratos: [{ id: 10 }, { id: 11 }] });
  expect(paraContexto(null)).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/third-party-scope.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/ai/third-party-scope.js`:

```js
// Pedir o boleto da esposa, do marido ou de um parente é atendimento normal, e
// pode levar mais de um turno: o titular tem duas faturas e o cliente precisa
// escolher uma. O escopo abaixo é o que sobrevive entre os turnos.
//
// Três coisas que ele NÃO faz, de propósito:
// - não substitui contexto.contracts (os contratos do próprio contato);
// - não torna o terceiro dono do contato (nada é persistido no contato);
// - não guarda o documento do terceiro — só os ids de contrato, que é tudo de
//   que as ferramentas de pagamento precisam depois da primeira consulta. O CPF
//   continua no histórico da conversa, onde o cliente o digitou; o que não
//   existe é uma segunda cópia dele aqui.
//
// Os 30 minutos são TTL de AUTORIZAÇÃO, não de retenção: escopoValido() confere
// na leitura, em memória, antes de qualquer uso. Um JSON expirado pode
// continuar na coluna até a próxima leitura daquela conversa — e expirado ele
// não autoriza nada.
const MINUTOS_DE_VIDA = 30;

function montarEscopo(nome, contratos, agora = new Date()) {
  return {
    nome: nome || null,
    contratos: (contratos || []).map((c) => c.id),
    expiraEm: new Date(agora.getTime() + MINUTOS_DE_VIDA * 60 * 1000).toISOString(),
  };
}

// Formato ISO completo, como .toISOString() produz. A checagem de tipo e de
// forma vem ANTES do Date.parse de propósito: Date.parse('12345') não é lixo
// para o V8 — é o ano 12345, uma data válida e distante, que transformaria um
// campo corrompido numa autorização de séculos. Falhar fechado é o ponto
// inteiro desta função.
const ISO_COMPLETO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function escopoValido(escopo, agora = new Date()) {
  if (!escopo || typeof escopo !== 'object') return false;
  if (!Array.isArray(escopo.contratos) || escopo.contratos.length === 0) return false;
  if (typeof escopo.expiraEm !== 'string' || !ISO_COMPLETO.test(escopo.expiraEm)) return false;
  const expira = Date.parse(escopo.expiraEm);
  if (Number.isNaN(expira)) return false;
  return agora.getTime() <= expira;
}

/** O formato que a checagem de propriedade espera: uma lista de { id }. */
function paraContexto(escopo) {
  if (!escopo) return null;
  return { nome: escopo.nome, contratos: escopo.contratos.map((id) => ({ id })) };
}

module.exports = { montarEscopo, escopoValido, paraContexto, MINUTOS_DE_VIDA };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/third-party-scope.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/third-party-scope.js src/ai/third-party-scope.test.js
git commit -m "Terceiro: ciclo de vida do escopo, com 30 minutos e sem CPF

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Criar, carregar e limpar o escopo

**Files:**
- Modify: `src/ai/tool-registry.js` (`buscar_cliente` ramo `titularEOutraPessoa`; `concluir_triagem`; `encerrar_atendimento`; `esquecer_identificacao`)
- Modify: `src/ai/ai-orchestrator.js` (montagem do `contexto` na triagem)
- Modify: `src/queue/ai-worker.js` (carrega o escopo e passa a `runAiTurn`)
- Test: `src/ai/tool-registry.test.js`, `src/ai/ai-orchestrator.test.js`

**Interfaces:**
- Consumes: Tasks 4 e 5.
- Produces:
  - `runAiTurn({ ..., terceiro })` — novo parâmetro opcional `terceiro`, no formato de `paraContexto()`.
  - `contexto.terceiro` = `{ nome, contratos: [{ id }] } | null` durante o turno.

**Regras do ciclo de vida** (todas viram teste):

| Evento | Efeito |
|---|---|
| `buscar_cliente` com `titularEOutraPessoa: true` | cria o escopo, substituindo qualquer anterior |
| `buscar_cliente` **sem** a marcação | limpa o escopo — a conversa voltou a ser sobre o próprio contato |
| `esquecer_identificacao` | limpa |
| `concluir_triagem` | limpa |
| `encerrar_atendimento` | limpa |
| passados 30 minutos | inválido na leitura, e a leitura limpa a coluna |

- [ ] **Step 1: Escrever os testes que falham**

Primeiro, o ajudante usado por este e pelos próximos testes. Adicione ao topo de
`src/ai/tool-registry.test.js`, junto dos outros mocks:

```js
jest.mock('../conversations/conversation.repository');
const { setThirdPartyScope, completeTriage } = require('../conversations/conversation.repository');

const SETOR = '11111111-1111-1111-1111-111111111111';
const FATURA_ABERTA = { id: 5, value: 135, dueDate: '2026-09-10', status: 'aberta' };

/** Contexto de um turno de triagem já identificado, com o que cada teste variar. */
function contextoDeTriagemCom(extra = {}) {
  return {
    conversationId: 'c1',
    contact: { id: 'ct1', sgpDocument: '11122233344' },
    contracts: [{ id: 1, address: 'Minha rua' }],
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', client: { id: 5 } },
    ferramentasPermitidas: FERRAMENTAS_TRIAGEM,
    registroFerramentas: [], sgpCache: {}, terceiro: null,
    triagem: { threshold: 0.8, maxQuestions: 2, attempts: 0, noturno: { ativo: false } },
    ...extra,
  };
}
```

E os testes:

```js
test('buscar_cliente de terceiro cria o escopo e NÃO toca em contexto.contracts', async () => {
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
    contracts: [{ id: 77, status: 1, address: 'Rua da Maria' }],
  });
  const proprios = [{ id: 1, address: 'Minha rua' }];
  const contexto = {
    ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1',
    contact: { id: 'ct1', sgpDocument: null }, contracts: proprios,
    identidade: { nivel: 'forte', primeiroNome: 'João', origem: 'phone' },
  };

  const r = await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);

  expect(r.ok).toBe(true);
  expect(contexto.contracts).toBe(proprios);                 // intocado
  expect(contexto.terceiro.contratos).toEqual([{ id: 77 }]);
  expect(contexto.identidade.primeiroNome).toBe('João');     // quem fala continua sendo quem fala
  expect(setContactSgpLink).not.toHaveBeenCalled();          // o terceiro nao vira dono do contato
  expect(setThirdPartyScope).toHaveBeenCalledWith('c1', expect.objectContaining({ nome: 'Maria', contratos: [77] }));
});

// Digitar o CPF de outra pessoa nao pode promover ninguem. Ate 2026-09-17 este
// ramo escrevia nivel: 'forte' em contexto.identidade, elevando quem nem era
// cliente. A autorizacao mora no escopo, nunca na identidade do solicitante.
test('buscar_cliente de terceiro NUNCA eleva a identidade de quem está falando', async () => {
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
    contracts: [{ id: 77, status: 1 }],
  });
  const identidade = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const contexto = {
    ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1',
    contact: { id: 'ct1', sgpDocument: null }, contracts: [], identidade,
  };

  await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);

  expect(contexto.identidade).toEqual(identidade);   // objeto inteiro intocado
  expect(contexto.identidade.nivel).toBe('none');
});

// Falha fechado: sem gravacao no banco nao ha autorizacao neste turno.
test('se a gravação do escopo falhar, a ferramenta falha e o escopo não vale', async () => {
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
    contracts: [{ id: 77, status: 1 }],
  });
  setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
  const contexto = contextoDeTriagemCom({ contracts: [] });

  const r = await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);

  expect(r.ok).toBe(false);
  expect(contexto.terceiro).toBeNull();
});

test.each(['concluir_triagem', 'encerrar_atendimento', 'esquecer_identificacao'])(
  'se a limpeza do escopo falhar, %s aborta em vez de seguir com a autorização viva',
  async (nome) => {
    setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
    const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
    const args = nome === 'concluir_triagem' ? { setorId: SETOR, resumo: 'x', confianca: 0.9 } : {};

    const r = await executeTool(nome, args, contexto);

    expect(r.ok).toBe(false);
    expect(completeTriage).not.toHaveBeenCalled();
    expect(contexto.terceiro).not.toBeNull();   // nada foi dado por limpo
  }
);

// Endereco do titular e dado cadastral de outra pessoa: nao vai ao modelo.
test('o retorno do buscar_cliente de terceiro não traz endereço nem status do titular', async () => {
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
    contracts: [{ id: 77, status: 4, address: 'Rua da Maria' }],
  });
  const contexto = {
    ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1',
    contact: { id: 'ct1' }, contracts: [], identidade: { nivel: 'forte', primeiroNome: 'João' },
  };
  const r = await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);
  expect(JSON.stringify(r.resultado)).not.toMatch(/Rua da Maria/);
  expect(r.resultado.contratos).toEqual([{ id: 77 }]);
});

test.each([
  ['concluir_triagem', { setorId: SETOR, resumo: 'x', confianca: 0.9 }],
  ['encerrar_atendimento', {}],
  ['esquecer_identificacao', {}],
])('%s limpa o escopo de terceiro', async (nome, args) => {
  const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
  await executeTool(nome, args, contexto);
  expect(setThirdPartyScope).toHaveBeenCalledWith(contexto.conversationId, null);
});

test('buscar_cliente sem a marcação de terceiro limpa um escopo anterior', async () => {
  sgpClient.lookupClientByCpf.mockResolvedValue({
    client: { id: 5, name: 'JOAO', document: '11122233344' }, contracts: [{ id: 1, status: 1 }],
  });
  const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
  await executeTool('buscar_cliente', { cpf: '11122233344' }, contexto);
  expect(contexto.terceiro).toBeNull();
  expect(setThirdPartyScope).toHaveBeenCalledWith(contexto.conversationId, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-registry.test.js -t "terceiro"`
Expected: FAIL — `contexto.contracts` foi substituído.

- [ ] **Step 3: Implementar em `tool-registry.js`**

Em `buscar_cliente.executar`, **remover** a linha `contexto.contracts = contracts;` de onde ela está hoje (logo após o `lookupClientByCpf`) e passar a atribuir só no caminho do próprio contato.

No ramo `if (args.titularEOutraPessoa)`, trocar o corpo por:

```js
// O CPF do titular abre o contrato dele — igual à segunda via do site do SGP —,
// mas NADA disso vira o contato: sem persistência no contato, sem cidade, sem
// trocar o nome de quem fala. E, principalmente, SEM MEXER EM
// contexto.identidade: quem está falando pode não ser cliente nenhum, e digitar
// o CPF de outra pessoa não pode elevar a identidade de ninguém. A autorização
// mora no escopo, não na identidade do solicitante.
const escopo = montarEscopo(nome, contracts);

// Falha fechado: a gravação vem ANTES de o escopo valer neste turno. Sem
// persistência não há autorização — nem agora nem no turno seguinte. Deixar o
// turno seguir com um escopo que o banco não conhece é o começo de um escopo
// órfão. O documento nunca entra no log.
try {
  await setThirdPartyScope(contexto.conversationId, escopo);
} catch (err) {
  console.error(`Failed to store the third party scope for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
  return erro('third_party_scope_not_stored');
}
contexto.terceiro = paraContexto(escopo);

return {
  titular: { nome },
  contratos: contracts.map((c) => ({ id: c.id })),
  instrucao: `O CPF é de OUTRA pessoa (${nome}), não de quem está falando. Você pode consultar a fatura e entregar o boleto ou o PIX desse contrato; plano, conexão e status do contrato dela não podem ser consultados. NUNCA diga "seu contrato" nem "sua fatura": diga que localizou o contrato no CPF informado e, ao entregar, diga de quem é ("o boleto do contrato de ${nome}"). Continue chamando quem fala pelo nome dela. Ao concluir, registre no resumo que quem pediu não é o titular.`,
};
```

No caminho do próprio contato, **adicionar** `contexto.contracts = contracts;` e a limpeza.

A limpeza é idêntica nos quatro lugares, então escreva o ajudante uma vez, acima do array
`TOOLS`:

```js
/**
 * Derruba a autorização sobre o contrato de terceiro. Falha FECHADO: se o banco
 * não confirmar a limpeza, quem chamou precisa abortar. Um escopo que sobrevive
 * a uma limpeza malsucedida é autorização viva sobre o contrato de um estranho,
 * e reapareceria no próximo turno como se nada tivesse acontecido.
 */
async function limparEscopoDeTerceiro(contexto) {
  try {
    await setThirdPartyScope(contexto.conversationId, null);
  } catch (err) {
    console.error(`Failed to clear the third party scope for conversation ${contexto.conversationId}: ${mensagemSegura(err)}`);
    return false;
  }
  contexto.terceiro = null;
  return true;
}
```

Em `buscar_cliente` (caminho do próprio contato):

```js
contexto.contracts = contracts;
if (!(await limparEscopoDeTerceiro(contexto))) return erro('third_party_scope_not_cleared');
```

Em `concluir_triagem.executar`, `encerrar_atendimento.executar` e
`esquecer_identificacao.executar`, a limpeza vem **antes** da ação principal, e aborta se
falhar:

```js
// Antes de concluir/encerrar/esquecer, e não depois: se a limpeza falhar, o
// atendimento NÃO avança. Concluir com uma autorização de terceiro ainda viva
// deixaria o escopo válido pelos 30 minutos seguintes numa conversa que já saiu
// da triagem.
if (contexto.terceiro && !(await limparEscopoDeTerceiro(contexto))) {
  return erro('third_party_scope_not_cleared');
}
```

O `if (contexto.terceiro ...)` é de propósito: sem escopo não há o que limpar, e a
esmagadora maioria dos atendimentos não passa por terceiro — não faz sentido um UPDATE a
cada conclusão.

No perfil assistente, `buscar_cliente` continua atribuindo `contexto.contracts` como hoje.

**Segunda camada, no leitor.** Mesmo com a limpeza falhando, um escopo não pode
ressuscitar. O worker só carrega o escopo quando a conversa ainda está em triagem por IA —
que é a única condição em que ele roda — e a validade é conferida em memória antes de
qualquer uso. Um JSON órfão na coluna nunca autoriza: ou o TTL já passou, ou a conversa
saiu da triagem e o worker nem chega a ler.

- [ ] **Step 4: Carregar o escopo no worker e no orquestrador**

Em `src/queue/ai-worker.js`, depois de `resolverIdentidade`:

```js
// O escopo do boleto de terceiro sobrevive ao turno: o titular pode ter duas
// faturas e o cliente precisa escolher uma. Expirado, morre aqui e a coluna é
// limpa — nunca fica um resto autorizando um contrato alheio.
let terceiro = null;
try {
  const escopo = await getThirdPartyScope(conversation.id);
  if (escopoValido(escopo)) {
    terceiro = paraContexto(escopo);
  } else if (escopo) {
    await setThirdPartyScope(conversation.id, null);
  }
} catch (err) {
  console.error(`Failed to load the third party scope for conversation ${conversation.id}: ${mensagemSegura(err)}`);
}
```

e passar `terceiro` na chamada a `runAiTurn`.

Em `src/ai/ai-orchestrator.js`, `runAiTurn` recebe `terceiro = null` e o coloca no contexto da triagem: `terceiro,` junto de `identidade`. E acrescenta ao objeto de retorno, junto de `identidade`:

```js
    // O harness de simulação encadeia roteiros e precisa do escopo de saída; o
    // worker ignora este campo, porque quem persiste é a própria ferramenta.
    terceiro: contexto.terceiro || null,
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/ai src/queue
git commit -m "Terceiro: escopo separado, multiturno, que nunca vira dono do contato

contexto.contracts passa a conter SO os contratos do proprio contato. Os do
terceiro vivem em contexto.terceiro, persistido na conversa por 30 minutos e
limpo ao concluir, encerrar, esquecer a identificacao ou identificar o proprio
contato. O endereco do titular deixa de ir ao modelo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Checagem de propriedade com lista de permissão

**Files:**
- Modify: `src/ai/tool-registry.js` (exporta `FERRAMENTAS_PERMITIDAS_EM_TERCEIRO`)
- Modify: `src/ai/tool-executor.js:84-97`
- Test: `src/ai/tool-executor.test.js`

**Interfaces:**
- Consumes: Task 6.
- Produces: `FERRAMENTAS_PERMITIDAS_EM_TERCEIRO: string[]`; novo motivo de recusa `third_party_tool_not_allowed`.

- [ ] **Step 1: Escrever os testes que falham**

Os args de cada ferramenta precisam ser **mínimos e válidos**, senão o teste morre em
`invalid_args` no passo 3 e nunca chega na autorização, que é o passo 4. Todas as
ferramentas desta tabela usam `validarContratoId`, então `{ contratoId }` basta — mas o mapa
fica explícito para o dia em que alguma passar a exigir outra coisa:

```js
const ARGS_MINIMOS = {
  consultar_faturas: { contratoId: 77 },
  enviar_boleto: { contratoId: 77 },
  gerar_pix: { contratoId: 77 },
  gerar_segunda_via: { contratoId: 77 },
  consultar_plano: { contratoId: 77 },
  consultar_status_conexao: { contratoId: 77 },
  consultar_status_contrato: { contratoId: 77 },
  consultar_financeiro: { contratoId: 77 },
  desbloqueio_confianca: { contratoId: 77 },
};

const PERMITIDAS = ['consultar_faturas', 'enviar_boleto', 'gerar_pix', 'gerar_segunda_via'];
const BLOQUEADAS = [
  'consultar_plano', 'consultar_status_conexao', 'consultar_status_contrato',
  'consultar_financeiro', 'desbloqueio_confianca',
];

function contextoComTerceiro(ferramentas, identidade = { nivel: 'forte', primeiroNome: 'João' }) {
  return {
    ferramentasPermitidas: ferramentas, conversationId: 'c1', contact: { id: 'ct1' },
    contracts: [{ id: 1 }],
    terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
    identidade, sgpCache: {}, registroFerramentas: [],
  };
}

// Guarda do proprio teste: se os args pararem de ser validos, o teste passa a
// medir invalid_args em vez de autorizacao, e ninguem percebe.
test.each([...PERMITIDAS, ...BLOQUEADAS])('os args de teste de %s chegam na checagem de autorização', async (nome) => {
  const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome]));
  expect(r.motivo).not.toBe('invalid_args');
});

test.each(PERMITIDAS)('%s é autorizada no contrato de terceiro', async (nome) => {
  const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome]));
  expect(r.motivo).not.toBe('third_party_tool_not_allowed');
  expect(r.motivo).not.toBe('contract_not_owned');
  expect(r.motivo).not.toBe('identity_not_confirmed');
});

test.each(BLOQUEADAS)('%s é recusada no contrato de terceiro', async (nome) => {
  const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome]));
  expect(r.ok).toBe(false);
  expect(r.motivo).toBe('third_party_tool_not_allowed');
  expect(r.instrucao).toMatch(/outra pessoa/i);
});

// Quem pede o boleto da esposa pode nao ser cliente nenhum. Tres das quatro
// ferramentas da allowlist exigem identidade forte; sem esta excecao, o fluxo
// inteiro morria em identity_not_confirmed para quem estava com nivel 'none'.
const SEM_IDENTIDADE = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };

test.each(PERMITIDAS)('%s funciona no contrato de terceiro mesmo com quem fala não identificado', async (nome) => {
  const contexto = contextoComTerceiro([nome], SEM_IDENTIDADE);
  const r = await executeTool(nome, ARGS_MINIMOS[nome], contexto);
  expect(r.motivo).not.toBe('identity_not_confirmed');
  expect(contexto.identidade.nivel).toBe('none');   // e continua nao identificado
});

// A excecao vale SO no escopo de terceiro. Nos contratos proprios, quem nao
// esta identificado continua barrado.
test.each(PERMITIDAS)('%s continua exigindo identidade forte nos contratos próprios', async (nome) => {
  const contexto = contextoComTerceiro([nome], SEM_IDENTIDADE);
  const r = await executeTool(nome, { contratoId: 1 }, contexto);
  expect(r.ok).toBe(false);
  expect(r.motivo).toBe('identity_not_confirmed');
});

// E nunca escapa para uma ferramenta fora da allowlist, nem no escopo.
test.each(BLOQUEADAS)('%s não ganha a exceção de identidade pelo escopo de terceiro', async (nome) => {
  const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome], SEM_IDENTIDADE));
  expect(r.motivo).toBe('third_party_tool_not_allowed');
});

// A noite desbloqueio_confianca entra na lista da triagem. Continua barrada no
// contrato alheio: e acao de servico, nao consulta.
test('desbloqueio_confianca é recusada no contrato de terceiro também à noite', async () => {
  const contexto = contextoComTerceiro(['desbloqueio_confianca']);
  contexto.triagem = { noturno: { ativo: true, retornoAs: '08:00' } };
  const r = await executeTool('desbloqueio_confianca', { contratoId: 77 }, contexto);
  expect(r.motivo).toBe('third_party_tool_not_allowed');
});

test('contrato que não é de ninguém continua dando contract_not_owned', async () => {
  const r = await executeTool('enviar_boleto', { contratoId: 999 }, contextoComTerceiro(['enviar_boleto']));
  expect(r.motivo).toBe('contract_not_owned');
});

test('sem escopo de terceiro, nada muda para os contratos próprios', async () => {
  const contexto = contextoComTerceiro(['consultar_plano']);
  contexto.terceiro = null;
  const r = await executeTool('consultar_plano', { contratoId: 1 }, contexto);
  expect(r.motivo).not.toBe('third_party_tool_not_allowed');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-executor.test.js -t "terceiro"`
Expected: FAIL — hoje as bloqueadas dão `contract_not_owned`, não `third_party_tool_not_allowed`.

- [ ] **Step 3: Implementar**

Em `src/ai/tool-registry.js`, perto do topo, e exportar:

```js
// Lista FECHADA: só o que o fluxo de pagamento de outra pessoa precisa. Tudo o
// mais no contrato alheio é recusado — plano devolve o login de acesso do
// titular, conexão diz se a casa dele está online, e o desbloqueio executa uma
// ação de serviço no contrato de um estranho.
const FERRAMENTAS_PERMITIDAS_EM_TERCEIRO = ['consultar_faturas', 'enviar_boleto', 'gerar_pix', 'gerar_segunda_via'];
```

Em `src/ai/tool-executor.js`, junto de `INSTRUCAO_IDENTIDADE`:

```js
const INSTRUCAO_TERCEIRO = 'Este contrato é de outra pessoa. Nesse caso você só pode consultar a fatura e entregar o boleto ou o PIX. Plano, conexão, status e liberação não podem ser consultados nem executados no contrato de terceiro. Se o cliente pediu uma dessas coisas, explique que só o titular pode solicitar.';
```

E substituir o bloco de propriedade (linhas 84-97) por:

```js
} else if (!tool.isentoDeProprietario) {
  if (typeof tool.chaveProprietario !== 'string') return recusa('tool_misconfigured', nome);
  const valor = argsValidados[tool.chaveProprietario];
  const proprio = (contexto.contracts || []).some((c) => c.id === valor);
  if (!proprio) {
    const deTerceiro = ((contexto.terceiro && contexto.terceiro.contratos) || []).some((c) => c.id === valor);
    if (!deTerceiro) return recusa('contract_not_owned', valor);
    if (!FERRAMENTAS_PERMITIDAS_EM_TERCEIRO.includes(nome)) {
      return recusa('third_party_tool_not_allowed', nome, INSTRUCAO_TERCEIRO);
    }
    emTerceiro = true;
  }
}
```

Declare `let emTerceiro = false;` no início do `try` — a Task 8 também usa essa marca.

**E a exceção ao gate de identidade.** Três das quatro ferramentas da lista de permissão
(`enviar_boleto`, `gerar_pix`, `gerar_segunda_via`) têm `exigeIdentidadeForte: true`. Quem
pede o boleto da esposa pode não ser cliente nenhum — e não pode ser promovido a cliente
por digitar o CPF dela. Sem exceção, o fluxo inteiro morria em `identity_not_confirmed`.

Trocar a checagem de identidade (hoje na linha 106) por:

```js
// A exceção vale EXCLUSIVAMENTE para contrato dentro do escopo de terceiro E
// ferramenta da lista de permissão — as duas condições juntas são o que emTerceiro
// significa, porque qualquer outra combinação já retornou acima. A identidade de
// quem está falando não é elevada em momento nenhum: a autorização vem do
// escopo, e morre com ele.
if (tool.exigeIdentidadeForte && perfilTriagem(contexto) && !emTerceiro
    && !(contexto.identidade && contexto.identidade.nivel === 'forte')) {
  return recusa('identity_not_confirmed', nome, INSTRUCAO_IDENTIDADE);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tool-executor.js src/ai/tool-registry.js src/ai/tool-executor.test.js
git commit -m "Terceiro: lista de permissao fechada na checagem de propriedade

contract_not_owned continua valendo. Contrato de terceiro ganha um terceiro
desfecho: so consultar fatura e entregar boleto ou PIX. Plano, conexao, status,
financeiro e desbloqueio sao recusados, inclusive a noite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: A fronteira do fallback e a minimização de dados

**Files:**
- Create: `src/ai/third-party-minimize.js`
- Modify: `src/ai/tool-registry.js` (`escopoDoContrato`, `faturaEmAlgumContrato`, e as 3 chamadas)
- Modify: `src/ai/tool-executor.js` (aplica a minimização depois de executar)
- Test: `src/ai/third-party-minimize.test.js`, `src/ai/tool-registry.test.js`, `src/ai/tool-executor.test.js`

**Interfaces:**
- Consumes: Task 7 (`emTerceiro`).
- Produces:
  - `escopoDoContrato(contexto, contratoId)` → `{ contratos: [...], terceiro: boolean } | null`
  - `faturaEmAlgumContrato(contratoPedido, contexto)` — assinatura igual, mas internamente usa `escopoDoContrato` e **nunca** atravessa a fronteira.
  - `minimizarParaTerceiro(nome, resultado)` → objeto projetado. Falha fechado.

- [ ] **Step 1: Escrever os testes da minimização**

`src/ai/third-party-minimize.test.js`:

```js
const { minimizarParaTerceiro } = require('./third-party-minimize');

test('consultar_faturas devolve só id, vencimento e status', () => {
  const bruto = { faturas: [{ id: 5, vencimento: '2026-09-10', status: 'aberta', valor: 135.0, pagador: 'MARIA SILVA', linhaDigitavel: '0001...' }] };
  expect(minimizarParaTerceiro('consultar_faturas', bruto))
    .toEqual({ faturas: [{ id: 5, vencimento: '2026-09-10', status: 'aberta' }] });
});

test('enviar_boleto devolve só a confirmação e a instrução, sem valor', () => {
  const bruto = { enviado: true, valor: 135.0, vencimento: '2026-09-10', linhaDigitavelEnviada: true, instrucao: 'texto' };
  const r = minimizarParaTerceiro('enviar_boleto', bruto);
  expect(r).toEqual({ enviado: true, linhaDigitavelEnviada: true, instrucao: 'texto' });
  expect(r).not.toHaveProperty('valor');
});

test('gerar_pix devolve só a confirmação e a instrução', () => {
  expect(minimizarParaTerceiro('gerar_pix', { enviado: true, valor: 135.0, codigo: '000201...', instrucao: 'texto' }))
    .toEqual({ enviado: true, instrucao: 'texto' });
});

// Falha fechado: uma ferramenta nova que entre na lista de permissao sem
// projecao devolve o minimo, em vez de despejar o payload do SGP no modelo.
test('ferramenta sem projeção definida não vaza nada', () => {
  expect(minimizarParaTerceiro('ferramenta_nova', { segredo: 'x', dadosCadastrais: {} }))
    .toEqual({ ok: true });
});

test('nenhum dado cadastral do titular sobrevive a nenhuma projeção', () => {
  const envenenado = {
    faturas: [{ id: 1, vencimento: 'd', status: 's', endereco: 'Rua X', cpf: '52998224725', nomeCompleto: 'MARIA DA SILVA', telefone: '98999', email: 'a@b.c' }],
    enviado: true, instrucao: 'texto',
  };
  for (const nome of ['consultar_faturas', 'enviar_boleto', 'gerar_pix', 'gerar_segunda_via']) {
    const texto = JSON.stringify(minimizarParaTerceiro(nome, envenenado));
    expect(texto).not.toMatch(/Rua X|52998224725|MARIA DA SILVA|98999|a@b\.c/);
  }
});
```

- [ ] **Step 2: Escrever o teste da fronteira**

Em `src/ai/tool-registry.test.js`:

```js
// O fallback procura a fatura em OUTROS contratos quando o pedido nao tem. Com
// dois escopos no turno, ele nao pode atravessar a fronteira em nenhum sentido.
test('o fallback de fatura nunca atravessa do terceiro para os contratos próprios', async () => {
  const contexto = {
    contracts: [{ id: 1 }, { id: 2 }],
    terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
    sgpCache: {},
  };
  sgpClient.listInvoices.mockImplementation((id) => Promise.resolve({ faturas: id === 2 ? [FATURA_ABERTA] : [] }));
  const busca = await faturaEmAlgumContrato(77, contexto);
  expect(busca.contratoUsado).toBeUndefined();
  expect(busca.fatura).toBeUndefined();
  expect(sgpClient.listInvoices).not.toHaveBeenCalledWith(1);
  expect(sgpClient.listInvoices).not.toHaveBeenCalledWith(2);
});

test('o fallback de fatura nunca atravessa dos próprios para o terceiro', async () => {
  const contexto = {
    contracts: [{ id: 1 }],
    terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
    sgpCache: {},
  };
  sgpClient.listInvoices.mockImplementation((id) => Promise.resolve({ faturas: id === 77 ? [FATURA_ABERTA] : [] }));
  const busca = await faturaEmAlgumContrato(1, contexto);
  expect(sgpClient.listInvoices).not.toHaveBeenCalledWith(77);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/third-party-minimize.test.js src/ai/tool-registry.test.js -t "fronteira|minimiz|vaza"`
Expected: FAIL — módulo ausente e fallback atravessando.

- [ ] **Step 4: Implementar a minimização**

`src/ai/third-party-minimize.js`:

```js
// Requisito de minimização: o que a IA recebe de um contrato de OUTRA pessoa é
// só o necessário ao fluxo de pagamento. Nunca o payload do SGP, nunca dado
// cadastral. Cada ferramenta nomeia os campos que passam — mesma disciplina de
// allowlist de sgp-normalizer.js, e pelo mesmo motivo: um campo novo da API não
// pode vazar por acaso.
const PROJECOES = {
  consultar_faturas: (r) => ({
    faturas: (r.faturas || []).map((f) => ({ id: f.id, vencimento: f.vencimento, status: f.status })),
  }),
  enviar_boleto: (r) => ({
    enviado: r.enviado === true,
    ...(r.linhaDigitavelEnviada !== undefined ? { linhaDigitavelEnviada: r.linhaDigitavelEnviada } : {}),
    ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  }),
  gerar_pix: (r) => ({
    enviado: r.enviado === true,
    ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  }),
  gerar_segunda_via: (r) => ({
    gerado: true,
    ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  }),
};

/** Falha fechado: sem projeção, devolve o mínimo em vez do payload inteiro. */
function minimizarParaTerceiro(nome, resultado) {
  const projecao = PROJECOES[nome];
  if (!projecao) return { ok: true };
  return projecao(resultado || {});
}

module.exports = { minimizarParaTerceiro, PROJECOES };
```

Em `src/ai/tool-executor.js`, logo depois de `const resultado = await comTimeout(...)` e das duas checagens de falha:

```js
// Minimização: o resultado de um contrato de terceiro passa pela projeção antes
// de chegar ao modelo. Aplicada aqui, e não em cada ferramenta, para que uma
// ferramenta futura na lista de permissão não possa esquecer de aplicá-la.
if (emTerceiro) return { ok: true, resultado: minimizarParaTerceiro(nome, resultado) };
return { ok: true, resultado };
```

- [ ] **Step 5: Implementar a fronteira**

Em `src/ai/tool-registry.js`, acima de `faturaEmAlgumContrato`:

```js
/**
 * Onde este contrato pode ser resolvido. Os contratos do próprio contato e os
 * de um terceiro consultado são dois conjuntos SEPARADOS, e nada — nem o
 * fallback de fatura — atravessa de um para o outro.
 */
function escopoDoContrato(contexto, contratoId) {
  const proprios = (contexto && contexto.contracts) || [];
  if (proprios.some((c) => c.id === contratoId)) return { contratos: proprios, terceiro: false };
  const deTerceiro = (contexto && contexto.terceiro && contexto.terceiro.contratos) || [];
  if (deTerceiro.some((c) => c.id === contratoId)) return { contratos: deTerceiro, terceiro: true };
  return null;
}
```

Em `faturaEmAlgumContrato`, trocar a linha 130 por:

```js
const escopo = escopoDoContrato(contexto, contratoPedido);
const outros = ((escopo && escopo.contratos) || []).filter((c) => c.id !== contratoPedido);
```

Fazer o mesmo nos acessos crus das linhas 214 e 223 (os ajudantes de endereço e de busca de contrato): recebem o contrato por id e devem resolver pelo escopo.

**Não mexer** nas linhas 523, 605, 869, 1152 e 1483 — as agregadas, o desbloqueio, o comprovante e o resumo continuam lendo `contexto.contracts`, que agora contém garantidamente só os contratos próprios. É isso que os bloqueia para terceiros sem regra nova.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/ai
git commit -m "Terceiro: fronteira do fallback e minimizacao do retorno

faturaEmAlgumContrato passa a resolver pelo escopo e nunca atravessa entre os
contratos proprios e os do terceiro. O retorno das ferramentas liberadas passa
por projecao de campos no executor, que falha fechado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# FASE 3 — Ferramentas e schemas

### Task 9: A confiança perde o gate

**Files:**
- Modify: `src/ai/tool-registry.js:1470-1475`
- Modify: `frontend/src/pages/settings/automation/AiTriagePage.jsx` (texto de ajuda)
- Test: `src/ai/tool-registry.test.js`

**Interfaces:**
- Consumes: Task 8.
- Produces: `concluir_triagem` nunca devolve `{ concluido: false, motivo: 'baixa_confianca' }`.

- [ ] **Step 1: Escrever o teste que falha**

```js
test.each([0, 0.1, 0.5, 0.79, 0.8, 1])('confiança %s conclui a triagem e nunca gera pergunta', async (confianca) => {
  const contexto = contextoDeTriagemCom({ triagem: { threshold: 0.8, maxQuestions: 5, attempts: 0 } });
  const r = await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'Cliente quer o boleto.', confianca }, contexto);
  expect(r.ok).toBe(true);
  expect(r.resultado.concluido).not.toBe(false);
  expect(r.resultado.motivo).not.toBe('baixa_confianca');
  expect(JSON.stringify(r.resultado)).not.toMatch(/pergunta/i);
});

test('a confiança baixa continua marcada no resumo do atendente', async () => {
  const contexto = contextoDeTriagemCom({ triagem: { threshold: 0.8, maxQuestions: 5, attempts: 0 } });
  await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'x', confianca: 0.4 }, contexto);
  expect(completeTriage).toHaveBeenCalledWith(expect.objectContaining({
    summary: expect.stringContaining('40% (BAIXA)'),
  }));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-registry.test.js -t "confiança"`
Expected: FAIL para os valores abaixo de 0.8.

- [ ] **Step 3: Apagar o gate**

Em `src/ai/tool-registry.js`, apagar:

```js
      if (baixa && t.attempts < t.maxQuestions) {
        return { concluido: false, motivo: 'baixa_confianca', instrucao: 'Faça UMA pergunta curta de esclarecimento ao cliente e chame concluir_triagem de novo depois da resposta.' };
      }
```

`const baixa = args.confianca < t.threshold;` **fica** — é ela que marca `(BAIXA)` no resumo. Trocar o comentário acima do bloco removido por:

```js
      // A confiança é um palpite do modelo sobre si mesmo. Até 2026-09-17 um
      // palpite baixo RECUSAVA a conclusão e forçava mais uma pergunta ao
      // cliente — um número inventado virava pergunta na tela de quem estava
      // esperando ser atendido. Agora ela só marca o resumo: quem decide se a
      // classificação está ruim é o atendente, que tem a conversa na frente.
```

- [ ] **Step 4: Atualizar o texto de ajuda no painel**

Em `AiTriagePage.jsx`, o texto do campo *Limiar de confiança* passa a ser:
`"Abaixo deste valor, o resumo entregue ao atendente é marcado como confiança baixa. Não gera pergunta ao cliente."`

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test && cd frontend && npm test`
Expected: PASS. Apague os testes antigos que exercitavam `baixa_confianca`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Triagem: confianca baixa nao gera mais pergunta ao cliente

Um numero que o modelo inventa sobre si mesmo virava pergunta real na conversa.
Agora so marca (BAIXA) no resumo, para o atendente decidir.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `contratoId` opcional com contrato único

**Files:**
- Modify: `src/ai/tool-registry.js` (schema das 9 ferramentas com `contratoId`)
- Modify: `src/ai/tool-executor.js` (preenche antes de validar)
- Test: `src/ai/tool-executor.test.js`

**Interfaces:**
- Consumes: Task 9.
- Produces: as 9 ferramentas aceitam `args` sem `contratoId` quando `contexto.contracts.length === 1`.

- [ ] **Step 1: Escrever os testes que falham**

Use `consultar_status_conexao`, que chama `sgpClient.checkConnection(contratoId)` — dá para
assertar a chamada. `consultar_plano` não serve: ela lê do cache do contexto, não do SGP.

```js
test('contratoId ausente com um contrato só é preenchido pelo sistema', async () => {
  const contexto = { ferramentasPermitidas: ['consultar_status_conexao'], contracts: [{ id: 42 }], contact: {}, identidade: { nivel: 'forte' }, conversationId: 'c1' };
  await executeTool('consultar_status_conexao', {}, contexto);
  expect(sgpClient.checkConnection).toHaveBeenCalledWith(42);
});

test('contratoId ausente com vários contratos continua sendo erro de argumento', async () => {
  const contexto = { ferramentasPermitidas: ['consultar_status_conexao'], contracts: [{ id: 1 }, { id: 2 }], contact: {}, identidade: { nivel: 'forte' }, conversationId: 'c1' };
  const r = await executeTool('consultar_status_conexao', {}, contexto);
  expect(r.ok).toBe(false);
  expect(r.motivo).toBe('invalid_args');
});

// O preenchimento nunca pode alcancar um contrato de terceiro: ele exige
// escolha explicita do modelo.
test('contratoId ausente nunca é preenchido com um contrato de terceiro', async () => {
  const contexto = {
    ferramentasPermitidas: ['enviar_boleto'], contracts: [], contact: {},
    terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
    identidade: { nivel: 'forte' }, conversationId: 'c1',
  };
  const r = await executeTool('enviar_boleto', {}, contexto);
  expect(r.ok).toBe(false);
  expect(r.motivo).toBe('invalid_args');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-executor.test.js -t "contratoId"`
Expected: FAIL — `invalid_args` no primeiro caso.

- [ ] **Step 3: Implementar**

Em `src/ai/tool-executor.js`, **antes** de `const validacao = tool.validar(args);`:

```js
// Com um contrato só, o contratoId é dedutível — e obrigar o modelo a escolher
// um número que ele não vê direito é de onde vinham escolhas erradas e
// perguntas desnecessárias ao cliente. Só os contratos PRÓPRIOS entram aqui: um
// contrato de terceiro sempre exige escolha explícita.
const proprios = (contexto && contexto.contracts) || [];
if (tool.chaveProprietario === 'contratoId'
    && (!args || args.contratoId === undefined || args.contratoId === null)
    && proprios.length === 1) {
  args = { ...(args || {}), contratoId: proprios[0].id };
}
```

Em `src/ai/tool-registry.js`, nas 9 ferramentas, **manter `required: ['contratoId']`** e só
acrescentar a descrição que falta:

```js
contratoId: { type: 'integer', description: 'Id de um contrato do cliente, como veio do contexto ou de uma consulta. Com um contrato só, o sistema preenche sozinho se você omitir.' },
```

O `required` fica porque o preenchimento acontece **antes** de `tool.validar`, e é essa
ordem que dá o comportamento certo de graça:

| Situação | O que acontece |
|---|---|
| Um contrato próprio, sem id | o executor preenche, `validar` aprova |
| Vários contratos, sem id | nada a preencher, `validar` recusa com `invalid_args` |
| Contrato de terceiro, sem id | nada a preencher (o escopo não é fonte de preenchimento), `invalid_args` |

Tirar o `required` do schema só aliviaria a pressão sobre o modelo sem mudar nada no
comportamento, já que quem recusa de fato é `validarContratoId`, não o schema — o `required`
do JSON Schema não é verificado em lugar nenhum do código.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tool-executor.js src/ai/tool-registry.js src/ai/tool-executor.test.js
git commit -m "Ferramentas: contratoId deduzido quando o cliente tem um contrato so

Nunca deduz um contrato de terceiro: esse exige escolha explicita.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: O resumo para o atendente

**Files:**
- Modify: `src/ai/tool-registry.js` (descrição de `resumo` em `concluir_triagem` e `transferir_atendimento`; linha `Ferramentas:`; linha de terceiro)
- Test: `src/ai/tool-registry.test.js`

**Interfaces:**
- Consumes: Task 10.
- Produces: resumo com a linha `Pedido de terceiro: ...` quando houver escopo, e `Ferramentas:` legível.

- [ ] **Step 1: Escrever os testes que falham**

```js
test('o resumo registra que o pedido era de outra pessoa, sem o documento dela', async () => {
  const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
  await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'Boleto entregue.', confianca: 0.9 }, contexto);
  const { summary } = completeTriage.mock.calls[0][0];
  expect(summary).toMatch(/Pedido de terceiro: titular Maria, contrato 77/);
  expect(summary).not.toMatch(/\d{11}/);
});

test('a linha de ferramentas do resumo é legível, não JSON cru', async () => {
  const contexto = contextoDeTriagemCom({
    registroFerramentas: [{ nome: 'consultar_status_todos_contratos', resultado: '{"contratos":[{"status":"ativo","conexao":"online"}]}' }],
  });
  await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'x', confianca: 0.9 }, contexto);
  const { summary } = completeTriage.mock.calls[0][0];
  expect(summary).toMatch(/consultar_status_todos_contratos →/);
  expect(summary).not.toMatch(/\{"contratos"/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/tool-registry.test.js -t "resumo"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Descrição do campo `resumo`, nas duas ferramentas:

```js
resumo: {
  type: 'string',
  description: 'Resumo para o atendente humano, em 2 a 4 frases: o que o cliente pediu COM AS PALAVRAS DELE, o que as consultas mostraram, o que você já resolveu, e o que falta. Bom: "Cliente relata quedas desde cedo. Cadastro localizado, contrato ativo e conexão online na consulta. Diz que acontece em todos os aparelhos." Ruim: "Cliente com problema de internet."',
},
```

Em `concluir_triagem.executar`, depois da linha `Confiança:`:

```js
// O titular aparece pelo primeiro nome e pelo contrato; o documento dele nunca
// entra no resumo — não está nem guardado.
if (contexto.terceiro) {
  linhas.push(`Pedido de terceiro: titular ${contexto.terceiro.nome || 'não informado'}, contrato ${contexto.terceiro.contratos.map((c) => c.id).join(', ')}`);
}
```

E a linha `Ferramentas:` passa a resumir em vez de despejar JSON:

```js
if (Array.isArray(contexto.registroFerramentas) && contexto.registroFerramentas.length > 0) {
  linhas.push(`Ferramentas: ${contexto.registroFerramentas.map((r) => `${r.nome} → ${legivel(r.resultado)}`).join('; ')}`);
}
```

com, acima do objeto da ferramenta:

```js
/** Transforma o JSON gravado do resultado numa frase curta para o atendente. */
function legivel(serializado) {
  try {
    const dado = JSON.parse(serializado);
    if (dado && typeof dado === 'object') {
      const partes = Object.entries(dado)
        .filter(([chave]) => chave !== 'instrucao' && chave !== 'proximoPasso')
        .map(([chave, valor]) => `${chave} ${typeof valor === 'object' ? JSON.stringify(valor) : valor}`);
      if (partes.length > 0) return partes.join(', ').slice(0, 160);
    }
  } catch (err) { /* resultado truncado não é JSON válido: cai no texto cru */ }
  return String(serializado).slice(0, 160);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tool-registry.js src/ai/tool-registry.test.js
git commit -m "Resumo: pedido de terceiro registrado e linha de ferramentas legivel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# FASE 4 — Prompt em camadas

### Task 12: O compositor e as camadas fixas

**Files:**
- Create: `src/ai/prompt/montar.js`, `principios.js`, `fatos.js`, `painel.js`, `formato.js` + testes
- Create: `scripts/dump-prompt.js`
- Test: `src/ai/prompt/montar.test.js` e um por módulo

**Interfaces:**
- Consumes: Tasks 1-11.
- Produces:
  - **Interface de módulo** (todos os módulos de fluxo seguem):
    ```js
    module.exports = {
      nome: 'suporte-diagnostico',
      entra(estado) { return boolean; },
      linhas(estado) { return string[]; },
    };
    ```
  - **`estado`**: `{ config, identidade, contratos, triagem, avisoCidade, empresa, ferramentas, setores, motivos, terceiro, agora }`.
    - `contratos` já passou por `normalizeContract`.
    - `ferramentas` é o array de nomes do turno (`ferramentasDaTriagem(...)`).
  - `montarContexto(estado)` → `string`.
  - `MODULOS` — array na ordem de montagem.

- [ ] **Step 1: Escrever o teste do compositor**

`estadoBase` é usada pelos testes de **todos** os módulos (Tasks 13-17), que são outros
arquivos. Escreva-a uma vez em `src/ai/prompt/estado-de-teste.js` (não é `.test.js`, para o
jest não tentar rodá-la como suíte) e importe-a nos testes.

`src/ai/prompt/estado-de-teste.js`:

```js
/** Estado de entrada do compositor, com o que cada teste variar. */
function estadoBase(extra = {}) {
  return {
    config: { systemPrompt: 'Você é a assistente da empresa.', triageExtraInstructions: null, triageResolvedReasonId: null },
    identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
    contratos: [], triagem: { noturno: { ativo: false }, forcarConclusao: false },
    avisoCidade: null, empresa: 'Provedor X', ferramentas: ['buscar_cliente', 'concluir_triagem'],
    setores: [{ id: 's1', name: 'Suporte', aiHint: 'internet com problema' }],
    motivos: [{ id: 'r1', name: 'Lentidão' }],
    terceiro: null, agora: new Date('2026-09-17T14:00:00.000Z'),
    ...extra,
  };
}

module.exports = { estadoBase };
```

`src/ai/prompt/montar.test.js`:

```js
const { montarContexto, MODULOS } = require('./montar');
const { estadoBase } = require('./estado-de-teste');

test('a ordem de montagem começa pelo prompt do sistema e põe os princípios em seguida', () => {
  const texto = montarContexto(estadoBase());
  expect(texto.indexOf('Você é a assistente da empresa.')).toBe(0);
  expect(texto.indexOf('PRIORIDADE')).toBeGreaterThan(0);
  expect(texto.indexOf('PRIORIDADE')).toBeLessThan(texto.indexOf('Setores'));
});

test('as instruções da operação vêm com a frase de precedência no cabeçalho', () => {
  const texto = montarContexto(estadoBase({
    config: { systemPrompt: 'p', triageExtraInstructions: 'Planos: 500 Mega R$ 100', triageResolvedReasonId: null },
  }));
  expect(texto).toContain('Planos: 500 Mega R$ 100');
  const cabecalho = texto.slice(texto.indexOf('INSTRUÇÕES ADICIONAIS') - 400, texto.indexOf('Planos: 500'));
  expect(cabecalho).toMatch(/vale o princípio/i);
});

test('cliente não identificado não recebe nenhum roteiro de cliente identificado', () => {
  const texto = montarContexto(estadoBase());
  expect(texto).not.toMatch(/consultar_status_todos_contratos/);
  expect(texto).not.toMatch(/REATIVAÇÃO/);
});

test('cliente identificado não recebe a abertura de cliente novo', () => {
  const texto = montarContexto(estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
    contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
  }));
  expect(texto).not.toMatch(/bloco de planos das instruções/);
});

test('privacidade e terceiros entram nos dois estados de identidade', () => {
  for (const nivel of ['none', 'forte']) {
    const texto = montarContexto(estadoBase({ identidade: { nivel, origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false } }));
    expect(texto).toMatch(/DADOS DE OUTRA PESSOA/);
    expect(texto).toMatch(/de outra pessoa/i);
  }
});

test('todo módulo declara nome, entra e linhas', () => {
  for (const m of MODULOS) {
    expect(typeof m.nome).toBe('string');
    expect(typeof m.entra).toBe('function');
    expect(typeof m.linhas).toBe('function');
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt/montar.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Escrever `principios.js`**

O texto abaixo é novo, não é migração. Ele substitui as quatro redações duplicadas de "não repita pergunta" e implementa as seções 2.3, 2.3.1 e 2.9 da spec:

```js
module.exports = {
  nome: 'principios',
  entra() { return true; },
  linhas(estado) {
    return [
      '',
      'PRIORIDADE — quando duas regras conflitarem, vale a de cima:',
      '1. Segurança e privacidade.',
      '2. A intenção da mensagem mais recente do cliente.',
      '3. Os fatos que você já sabe (nunca pergunte o que já está no contexto ou no histórico).',
      '4. Os resultados das ferramentas.',
      '5. Resolver o que ele pediu.',
      '6. Coletar só o que for indispensável para o próximo passo.',
      '7. Encaminhar quando precisar de gente.',
      '8. O estilo da resposta.',
      'Uma regra de estilo NUNCA justifica ignorar a mensagem atual do cliente. As INSTRUÇÕES ADICIONAIS DA OPERAÇÃO mandam em preço, planos, cobertura e política comercial, mas não sobrepõem os itens 1 a 4.',
      '',
      `Você é a primeira atendente virtual da ${estado.empresa || 'empresa'}. Resolva sozinha tudo o que as regras e as ferramentas permitirem. Quando precisar de ação humana, colete só o necessário, escreva um resumo útil e encaminhe ao setor certo. Não tente resolver o que depende de gente.`,
      '',
      'NUNCA repita uma pergunta que ele já respondeu, nem com outras palavras. Antes de perguntar qualquer coisa, confira: a mensagem atual, o histórico, o que você já sabe do cliente e o que as ferramentas devolveram. Perguntar o que ele acabou de dizer é o pior erro de atendimento que existe.',
      'A mensagem mais recente manda. Se ele muda de assunto no meio de um diagnóstico, siga o assunto novo.',
      'Um dado só pode travar o próximo passo quando a ação que ELE pediu não roda sem esse dado. Nunca trave para completar cadastro, classificação ou resumo. Se ele ignorar um pedido seu e perguntar outra coisa, responda a pergunta dele e só volte ao dado se ele for mesmo necessário.',
      'Uma pergunta por vez. Dados do mesmo objetivo podem ir juntos ("seu bairro e sua rua"); uma lista de campos, nunca.',
      '',
      'CLIENTE IRRITADO: reclamar do serviço com palavrão ("essa internet tá uma merda") é reclamação, não ataque a você. NUNCA repreenda, nunca peça respeito, nunca corrija o cliente e nunca responda como se a mensagem fosse neutra. Reconheça a insatisfação em poucas palavras e vá resolver. Só mude de postura diante de ameaça ou ofensa dirigida a você.',
      'Adapte a abertura à situação, não use a mesma frase para tudo: cliente tranquilo, cliente irritado, cliente muito insatisfeito, pedido de boleto, assunto comercial e pergunta simples pedem aberturas diferentes. Pergunta simples se responde.',
      'Leia o SENTIDO, não as palavras soltas: "minha internet de 600 mega vive caindo" é suporte, não interesse no plano de 600; "pago 135 e não funciona" é reclamação, não pergunta de preço.',
      '',
      'Se uma consulta que você precisava falhar: nunca invente o resultado e nunca diga que verificou o que não verificou. Responda com o que estiver confirmado, encaminhe se for o caso, e escreva o que faltou no resumo interno. Não exponha erro técnico ao cliente.',
      'NUNCA cite o funcionamento interno: nada de "aqui na triagem", "meu sistema", "minha ferramenta". Fale do que você pode fazer, não de como funciona por dentro.',
      'Quando decidir encaminhar, chame concluir_triagem NA MESMA resposta em que avisa. Nunca escreva "vou encaminhar" sem concluir, e nunca espere um "ok" para encaminhar. Nunca conclua no mesmo turno em que pede algo ao cliente: ou você pergunta, ou você encaminha.',
      'Nunca encaminhe deixando a pergunta dele sem resposta: responda primeiro, e só então diga que está encaminhando.',
      '',
      'Tom: caloroso e direto, como uma recepcionista simpática. Frases completas. Uma mensagem por resposta. Os exemplos de frase são base para adaptar, nunca texto para colar.',
      'Assim que souber o primeiro nome do cliente, use-o na resposta seguinte e de vez em quando depois. Entregar algo sem nunca chamar a pessoa pelo nome soa robótico.',
    ];
  },
};
```

- [ ] **Step 4: Escrever `fatos.js`, `painel.js` e `formato.js`**

`fatos.js` migra, sem mudar o sentido, os blocos de identidade e contratos de `ai-orchestrator.js:409-480` e as linhas de data/hora de `:379-380`. Regras da migração:
- a linha de saudação continua igual (é regra de negócio, `saudacao.js` é quem garante);
- o ramo de identidade fraca **não existe mais** — só `forte`, `none` e `sgpIndisponivel`;
- `nemDataDeNascimento` e `eDataDeNascimento` somem de todas as frases.

`painel.js` produz, nesta ordem: a lista de setores com `aiHint`, a lista de motivos, e o bloco de instruções com o cabeçalho de precedência:

```js
linhas(estado) {
  const l = ['', 'Setores (use o id exato em concluir_triagem):'];
  for (const s of estado.setores) l.push(`- ${s.id} = ${s.name}${s.aiHint ? ` — ${s.aiHint}` : ''}`);
  l.push('', 'Motivos (use o id exato, ou null se nenhum se aplica):');
  for (const m of estado.motivos) l.push(`- ${m.id} = ${m.name}`);
  if (estado.config.triageExtraInstructions) {
    l.push(
      '',
      'INSTRUÇÕES ADICIONAIS DA OPERAÇÃO — única fonte de preço, planos, cobertura, promoções e documentação. Elas mandam nesses assuntos; no que for segurança, privacidade, fato de ferramenta ou regra do sistema, vale o princípio acima.',
      estado.config.triageExtraInstructions
    );
  } else {
    l.push('', 'Não há instruções adicionais da operação: preço, planos e cobertura são sempre com o setor comercial.');
  }
  return l;
}
```

`formato.js` migra a linha de formatação **uma vez só** (hoje aparece duas).

- [ ] **Step 5: Escrever `montar.js`**

```js
const MODULOS = [
  require('./principios'),
  require('./fatos'),
  require('./fluxos/privacidade'),
  require('./fluxos/terceiros'),
  require('./fluxos/identificacao'),
  require('./fluxos/sgp-indisponivel'),
  require('./fluxos/aviso-cidade'),
  require('./fluxos/multiplos-contratos'),
  require('./fluxos/suporte-geral'),
  require('./fluxos/suporte-diagnostico'),
  require('./fluxos/financeiro'),
  require('./fluxos/reativacao'),
  require('./fluxos/comercial-novo'),
  require('./fluxos/comercial-cliente'),
  require('./fluxos/comprovante'),
  require('./fluxos/noturno'),
  require('./fluxos/limite-perguntas'),
  require('./painel'),
  require('./formato'),
];

/** O prompt do sistema do painel abre; os princípios vêm logo depois. */
function montarContexto(estado) {
  const linhas = [estado.config.systemPrompt || ''];
  for (const modulo of MODULOS) {
    if (modulo.entra(estado)) linhas.push(...modulo.linhas(estado));
  }
  return linhas.join('\n');
}

module.exports = { montarContexto, MODULOS };
```

Nas Tasks 13-17 os módulos de fluxo ainda não existem. Crie-os agora como esqueletos com `entra: () => false` e `linhas: () => []`, para o compositor carregar. Cada task seguinte preenche o seu.

- [ ] **Step 6: Escrever `scripts/dump-prompt.js`**

```js
// Renderiza os prompts em arquivo para revisão humana, sem subir nada nem
// chamar a OpenAI. Uso: node scripts/dump-prompt.js [pasta]
const fs = require('fs');
const path = require('path');
const { montarContexto } = require('../src/ai/prompt/montar');

const CENARIOS = {
  'nao-identificado': { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
  identificado: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
};

// Setores, motivos e os dois textos do painel são exemplos: em produção vêm do
// banco. O que este script serve para conferir é o que o CÓDIGO acrescenta.
function estadoDe(identidade, noturno) {
  return {
    config: {
      systemPrompt: '[Prompt do sistema do painel]',
      triageExtraInstructions: '[Instruções adicionais da operação do painel]',
      triageResolvedReasonId: null,
      triageReadReceiptsDaytime: false,
    },
    identidade,
    contratos: identidade.nivel === 'forte'
      ? [{ id: 1, plano: 'Plano exemplo', velocidade: '000 Mega', endereco: '[endereço]', status: 'ativo' }]
      : [],
    triagem: { noturno: { ativo: noturno, retornoAs: '08:00' }, forcarConclusao: false, threshold: 0.8, maxQuestions: 2, attempts: 0 },
    avisoCidade: null,
    empresa: '[Empresa]',
    ferramentas: noturno ? FERRAMENTAS_TRIAGEM_NOTURNO : FERRAMENTAS_TRIAGEM,
    setores: [{ id: 's1', name: '[Setor 1]', aiHint: '[dica do setor]' }],
    motivos: [{ id: 'r1', name: '[Motivo 1]' }],
    terceiro: null,
    agora: new Date(),
  };
}

const destino = process.argv[2] || path.join(__dirname, '..', 'output', 'prompt');
fs.mkdirSync(destino, { recursive: true });

for (const [nome, identidade] of Object.entries(CENARIOS)) {
  for (const noturno of [false, true]) {
    if (nome === 'nao-identificado' && noturno) continue;
    const texto = montarContexto(estadoDe(identidade, noturno));
    const arquivo = path.join(destino, `${nome}${noturno ? '-noturno' : ''}.txt`);
    fs.writeFileSync(arquivo, texto, 'utf8');
    console.log(`${arquivo} — ${texto.length} caracteres`);
  }
}
```

`FERRAMENTAS_TRIAGEM` e `FERRAMENTAS_TRIAGEM_NOTURNO` já são exportadas por
`src/ai/ai-orchestrator.js`.

- [ ] **Step 7: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ai/prompt scripts/dump-prompt.js
git commit -m "Prompt: compositor em camadas e as camadas fixas

Principios com hierarquia de prioridade e a precedencia do painel escrita no
proprio prompt. Fatos, painel e formato separados. Modulos de fluxo entram como
esqueleto e sao preenchidos nas tarefas seguintes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Fluxos que entram sempre — privacidade e terceiros

**Files:**
- Modify: `src/ai/prompt/fluxos/privacidade.js`, `src/ai/prompt/fluxos/terceiros.js` + testes

**Interfaces:**
- Consumes: Task 12.
- Produces: os dois módulos com `entra: () => true`.

- [ ] **Step 1: Escrever os testes**

```js
test('privacidade entra em qualquer estado', () => {
  for (const nivel of ['none', 'forte']) expect(privacidade.entra(estadoBase({ identidade: { nivel } }))).toBe(true);
});

test('terceiros entra em qualquer estado e nunca pede outro dado além do documento', () => {
  const texto = terceiros.linhas(estadoBase()).join('\n');
  expect(terceiros.entra(estadoBase())).toBe(true);
  expect(texto).toMatch(/CPF( ou CNPJ)? do titular/i);
  expect(texto).not.toMatch(/nascimento|parentesco|nome da mãe/i);
});

test('terceiros avisa que plano, conexão e status do titular não podem ser consultados', () => {
  const texto = terceiros.linhas(estadoBase()).join('\n');
  expect(texto).toMatch(/plano.*conex|conex.*plano/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt/fluxos`
Expected: FAIL — os esqueletos devolvem `false` e `[]`.

- [ ] **Step 3: Preencher**

`privacidade.js` migra `ai-orchestrator.js:497-503` (a recusa de dado de outra pessoa, a ressalva de que relatar problema do vizinho não é pedido de dado, e a senha da rede do próprio cliente). Troque `Suporte`/`Financeiro` literais pela referência de papel.

**Nos dois módulos, troque os nomes reais de clientes por marcador.** As linhas 504 e 505
do original usam "a fatura da cliente Laureny" e "quero a fatura do Jureildson" como
exemplo: viram "a fatura da cliente [nome]" e "quero a fatura do [nome]". São nomes de
pessoas reais versionados no repositório, e o próprio código já documenta um caso em que o
modelo copiou um exemplo ao pé da letra.

`terceiros.js` migra `ai-orchestrator.js:504-505` e acrescenta o limite novo da Task 7:

```js
'FATURA, BOLETO OU PIX DE OUTRA PESSOA é atendimento normal, não interrogatório: se ele disser que é de outra pessoa ("quero a fatura do meu marido", "o boleto da minha esposa"), peça APENAS o CPF ou CNPJ do titular e chame buscar_cliente com titularEOutraPessoa: true. Nunca peça nada além disso — nem parentesco, nem endereço, nem telefone.',
'Com o contrato do titular localizado, você pode consultar a fatura e entregar o boleto ou o PIX. Plano, conexão e status do contrato dele NÃO podem ser consultados: se ele pedir, diga que só o titular consegue essas informações.',
'Se ele citar o NOME de outra pessoa junto com o pedido, isso já é pedido de terceiro: passe titularEOutraPessoa: true. NUNCA diga "seu contrato" nem "sua fatura" nesse caso, e NUNCA chame quem está falando pelo nome do titular — ao entregar, diga de quem é o boleto.',
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompt/fluxos
git commit -m "Prompt: fluxos de privacidade e de terceiros, presentes em todo estado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Fluxos de cliente não identificado

**Files:**
- Modify: `src/ai/prompt/fluxos/identificacao.js`, `comercial-novo.js` + testes

**Interfaces:**
- Consumes: Task 13.
- Produces: `identificacao.entra` = `nivel === 'none' || identidade.contestado`; `comercial-novo.entra` = `nivel === 'none'`.

- [ ] **Step 1: Escrever os testes**

```js
test('identificação entra sem identidade e com identidade contestada, e sai com identidade forte', () => {
  expect(identificacao.entra(estadoBase())).toBe(true);
  expect(identificacao.entra(estadoBase({ identidade: { nivel: 'forte', contestado: true } }))).toBe(true);
  expect(identificacao.entra(estadoBase({ identidade: { nivel: 'forte', contestado: false } }))).toBe(false);
});

test('comercial de cliente novo só entra sem identidade', () => {
  expect(comercialNovo.entra(estadoBase())).toBe(true);
  expect(comercialNovo.entra(estadoBase({ identidade: { nivel: 'forte', contestado: false } }))).toBe(false);
});

// O hardcode que esta entrega existe para matar.
test('o comercial de cliente novo não traz preço, velocidade, cidade nem promoção', () => {
  const texto = comercialNovo.linhas(estadoBase()).join('\n');
  expect(texto).not.toMatch(/R\$\s*\d/);
  expect(texto).not.toMatch(/\d{3}\s*Mega/i);
  expect(texto).not.toMatch(/instalação grátis|fibra óptica/i);
});

test('o comercial de cliente novo manda copiar o bloco de planos das instruções', () => {
  expect(comercialNovo.linhas(estadoBase()).join('\n')).toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt/fluxos -t "identifica|comercial de cliente novo"`
Expected: FAIL.

- [ ] **Step 3: Preencher**

`identificacao.js` migra `ai-orchestrator.js:422-424`, sem `nemDataDeNascimento`.

`comercial-novo.js` migra `ai-orchestrator.js:602-619` e `:635-641`, **removendo o hardcode**:
- a linha 610 perde `"100% fibra óptica"` → a abertura passa a ser `"Boa noite! 😊 Temos estes planos:"` seguida de `[bloco de planos copiado das INSTRUÇÕES ADICIONAIS DA OPERAÇÃO]`;
- a linha 614 (`Instalação grátis.`) é **apagada** — se a operação oferece, entra nas instruções;
- o formato de reserva da linha 604 vira `"• [velocidade] por R$ [valor]/mês"`;
- `"Perfeito, Centro de Godofredo Viana 👍"` vira `"Perfeito, [bairro] de [cidade] 👍"`;
- os nomes de setor literais viram referência de papel.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompt/fluxos
git commit -m "Prompt: fluxos de cliente nao identificado, sem preco no codigo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Fluxos de suporte

**Files:**
- Modify: `src/ai/prompt/fluxos/suporte-geral.js`, `suporte-diagnostico.js` + testes

**Interfaces:**
- Consumes: Task 14.
- Produces: `suporte-geral.entra` = `true`; `suporte-diagnostico.entra` = `nivel === 'forte'`.

- [ ] **Step 1: Escrever os testes**

```js
test('suporte geral entra em qualquer estado; o diagnóstico só com identidade forte', () => {
  expect(suporteGeral.entra(estadoBase())).toBe(true);
  expect(suporteDiagnostico.entra(estadoBase())).toBe(false);
  expect(suporteDiagnostico.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
});

// A contradicao que fazia a IA perguntar o que o cliente acabou de dizer.
test('o diagnóstico não obriga nenhuma frase exata nem a pergunta de três opções', () => {
  const texto = suporteDiagnostico.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');
  expect(texto).not.toMatch(/EXATAMENTE/);
  expect(texto).not.toMatch(/sem internet, com lentidão ou a conexão está caindo/i);
});

test('o diagnóstico diz que online não prova que a internet está boa', () => {
  const texto = suporteDiagnostico.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');
  expect(texto).toMatch(/online/i);
  expect(texto).toMatch(/não (é |significa )?prova|não trate/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt/fluxos -t "suporte"`
Expected: FAIL.

- [ ] **Step 3: Preencher**

`suporte-geral.js` migra, sem mudar o sentido: alcance do Wi-Fi (`:562`), velocidade abaixo da contratada (`:564`), mudar o equipamento de lugar (`:568`), dados móveis (`:574`), equipamento na casa de outra pessoa (`:573`), piora em horário certo (`:572`), problema sem roteiro próprio (`:571`), e dúvida não é falha (`:555`).

`suporte-diagnostico.js` migra `:553-560`, `:575-576`, `:578` e `:590`, com **uma mudança**: o modelo `EXATAMENTE` das linhas 544-552 é substituído por:

```js
'- Contrato ativo e conexão online: acolha o relato em uma frase, diga que consultou o cadastro e que o contrato está ativo e a conexão aparece online NESTE MOMENTO, e faça a próxima pergunta útil para o problema que ELE já descreveu. ONLINE não prova que a internet está funcionando bem: pode haver lentidão, Wi-Fi fraco, oscilação, perda de pacotes ou problema de aplicativo. NUNCA use o status para dizer que está tudo certo, e NUNCA pergunte o que ele já respondeu — se ele já disse que está lento, que cai ou que está sem acesso, vá direto ao roteiro daquele problema.',
'Só quando ele NÃO tiver dito qual é o problema, pergunte o que está acontecendo, com as suas palavras.',
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompt/fluxos
git commit -m "Prompt: suporte em dois modulos, sem a pergunta de diagnostico obrigatoria

A frase EXATAMENTE mandava perguntar "sem internet, lentidao ou caindo?" quatro
linhas depois de o proprio prompt proibir essa pergunta. Virou objetivo, com
online nao valendo como prova de internet boa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Fluxos de cliente identificado — financeiro, reativação, comercial

**Files:**
- Modify: `src/ai/prompt/fluxos/financeiro.js`, `reativacao.js`, `comercial-cliente.js` + testes

**Interfaces:**
- Consumes: Task 15.
- Produces: os três com `entra` = `nivel === 'forte'`.

- [ ] **Step 1: Escrever os testes**

```js
test.each([financeiro, reativacao, comercialCliente])('%# só entra com identidade forte', (modulo) => {
  expect(modulo.entra(estadoBase())).toBe(false);
  expect(modulo.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
});

// O hardcode mais grave da spec.
test('o comercial de cliente identificado não traz tabela de preços', () => {
  const texto = comercialCliente.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');
  expect(texto).not.toMatch(/R\$\s*\d/);
  expect(texto).not.toMatch(/\d{3}\s*Mega/i);
  expect(texto).toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO/);
});

test('o comercial manda parar de vender quando o cliente já escolheu', () => {
  const texto = comercialCliente.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');
  expect(texto).toMatch(/já escolheu|não liste os planos de novo/i);
});

test('nenhum fluxo cita nome de setor como texto fixo', () => {
  for (const modulo of [financeiro, reativacao, comercialCliente]) {
    const texto = modulo.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');
    expect(texto).not.toMatch(/\b(Financeiro|Comercial|Reativação|Suporte)\b/);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt/fluxos -t "identidade forte|comercial|setor como texto"`
Expected: FAIL.

- [ ] **Step 3: Preencher**

`financeiro.js` migra `:453-480` (entrega, despedida, sem fatura), `:551` (prioridade do pedido de pagamento) e `:579` (a internet volta depois de pagar). Setores por papel, e **a despedida da linha 468 perde o nome real**: `"Imagina, Willemberg! 😊 …"` vira `"Imagina, [nome]! 😊 …"`, nas duas ocorrências da linha (a com emoji e a sem).

`reativacao.js` migra `:577`, trocando `"vai para o setor de Reativação"` por `"vai para o setor que cuidar de reativação ou retorno de clientes, se houver um na lista de setores acima; se não houver, vá para o que cuidar de financeiro"`.

`comercial-cliente.js` migra `:600` e `:642-643` (mudança de endereço), **apagando** a tabela `500/600/800` das linhas 620-628 e trocando o modelo por:

```js
'- Cliente JÁ identificado que pede preço ou upgrade com todas as letras: cumprimente pelo nome, diga que vai ajudar, e apresente os planos copiando o bloco das INSTRUÇÕES ADICIONAIS DA OPERAÇÃO exatamente como está lá. Pergunte qual interessa e, com a escolha, conclua para o setor comercial com o plano escolhido no resumo.',
'Se ele JÁ escolheu um plano, não liste os planos de novo: siga para o próximo passo.',
'Antes de recomendar, entenda a necessidade (quantas pessoas usam, para quê). Recomende apoiado no que as instruções permitirem; se elas não trouxerem critério, explique que a diferença é a velocidade e pergunte quantas pessoas ou aparelhos vão usar. Nunca empurre o mais caro e nunca invente vantagem que não esteja nas instruções.',
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompt/fluxos
git commit -m "Prompt: financeiro, reativacao e comercial de cliente identificado

A tabela 500/600/800 sai do codigo: preco vem so do painel. Setores citados por
papel, nunca pelo nome fixo. Comercial consultivo, e para de vender quando o
cliente ja escolheu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Fluxos de estado

**Files:**
- Modify: `src/ai/prompt/fluxos/comprovante.js`, `noturno.js`, `multiplos-contratos.js`, `aviso-cidade.js`, `sgp-indisponivel.js`, `limite-perguntas.js` + testes

**Interfaces:**
- Consumes: Task 16.
- Produces:
  - `comprovante.entra` = `estado.ferramentas.includes('analisar_comprovante')`
  - `noturno.entra` = `estado.triagem.noturno.ativo`
  - `multiplos-contratos.entra` = `estado.contratos.length > 1`
  - `aviso-cidade.entra` = `Boolean(estado.avisoCidade)`
  - `sgp-indisponivel.entra` = `Boolean(estado.identidade.sgpIndisponivel)`
  - `limite-perguntas.entra` = `Boolean(estado.triagem.forcarConclusao)`

- [ ] **Step 1: Escrever os testes**

```js
test('comprovante só entra quando a ferramenta está na lista do turno', () => {
  expect(comprovante.entra(estadoBase({ ferramentas: ['buscar_cliente'] }))).toBe(false);
  expect(comprovante.entra(estadoBase({ ferramentas: ['analisar_comprovante'] }))).toBe(true);
});

test('o comprovante de cliente não identificado pede o documento, nunca outro dado', () => {
  const texto = comprovante.linhas(estadoBase({ ferramentas: ['analisar_comprovante'] })).join('\n');
  expect(texto).toMatch(/CPF ou CNPJ/);
  expect(texto).not.toMatch(/nascimento|titularidade/i);
});

test.each([
  [noturno, 'triagem', { noturno: { ativo: true, retornoAs: '08:00' } }],
  [avisoCidade, 'avisoCidade', { cidade: 'X', mensagem: 'falha' }],
  [limitePerguntas, 'triagem', { noturno: { ativo: false }, forcarConclusao: true }],
])('%# entra só com seu estado ativo', (modulo, chave, valor) => {
  expect(modulo.entra(estadoBase())).toBe(false);
  expect(modulo.entra(estadoBase({ [chave]: valor }))).toBe(true);
});

test('múltiplos contratos entra só com mais de um contrato', () => {
  expect(multiplosContratos.entra(estadoBase({ contratos: [{ id: 1 }] }))).toBe(false);
  expect(multiplosContratos.entra(estadoBase({ contratos: [{ id: 1 }, { id: 2 }] }))).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt/fluxos`
Expected: FAIL.

- [ ] **Step 3: Preencher**

Migre, sem mudar o sentido: `comprovante.js` de `:511-515`; `noturno.js` de `:394-404`; `multiplos-contratos.js` de `:469-472`; `aviso-cidade.js` de `:387-390`; `sgp-indisponivel.js` de `:418`; `limite-perguntas.js` de `:650-656`.

Em todos: setores por papel, e nenhuma menção a nascimento. Os `EXATAMENTE` que citam frase devolvida por ferramenta (`:401`) **ficam** — são pós-execução.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompt/fluxos
git commit -m "Prompt: fluxos de estado (comprovante, noturno, avisos, limites)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Trocar o construtor antigo e migrar os asserts

**Files:**
- Modify: `src/ai/ai-orchestrator.js` (apaga `montarContextoTriagem`, linhas 332-668, e chama `montarContexto`)
- Modify: `src/ai/ai-orchestrator.test.js` (os 260 asserts de texto literal)
- Test: `src/ai/ai-orchestrator.test.js`

**Interfaces:**
- Consumes: Tasks 12-17.
- Produces: `runAiTurn` inalterado por fora; `montarContextoTriagem` deixa de existir.

**Regra da migração dos asserts:** cada `expect(sys).toContain('...')` atual guarda a lição de um print real de produção. Nenhum é apagado sem virar outro teste. Para cada um, decida entre três destinos e **anote o destino no nome do novo teste**:
1. **Vira teste de módulo** — a regra migrou para um módulo; o assert vai para o `.test.js` dele, testando comportamento e não a frase.
2. **Vira teste de composição** em `montar.test.js` — a lição é sobre qual módulo entra em qual estado.
3. **É apagado** — e só quando a regra deixou de existir por decisão da spec (data de nascimento, identidade fraca, gate de confiança, a pergunta de diagnóstico obrigatória). Nesse caso o commit cita a seção da spec que decidiu.

- [ ] **Step 1: Inventariar**

Run: `grep -n "expect(sys)" src/ai/ai-orchestrator.test.js > /tmp/asserts.txt && wc -l /tmp/asserts.txt`
Expected: 260 linhas. Percorra a lista em ordem e marque o destino de cada uma antes de mexer em qualquer arquivo.

- [ ] **Step 2: Escrever o teste da troca**

```js
test('o contexto da triagem é montado pelo compositor de módulos', async () => {
  createChatCompletion.mockResolvedValue({ message: { content: 'oi' }, usage: {} });
  await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENTIDADE_NONE, triagem: TRIAGEM });
  const sys = createChatCompletion.mock.calls[0][0].messages[0].content;
  expect(sys).toContain('PRIORIDADE');
  expect(sys.indexOf('Você é a assistente')).toBe(0);
});
```

- [ ] **Step 3: Trocar**

Em `src/ai/ai-orchestrator.js`: apagar `montarContextoTriagem` inteira, `horaDeBrasilia`, `dataDeBrasilia` e `NOME_GENERICO_EMPRESA` se migraram para `fatos.js`/`principios.js`. No ramo de triagem de `runAiTurn`:

```js
systemContent = montarContexto({
  config,
  identidade: identidadeEfetiva,
  contratos: (identidadeEfetiva.contracts || []).map(normalizeContract),
  triagem: triagem || { noturno: { ativo: false }, forcarConclusao: false },
  avisoCidade,
  empresa: empresa.name,
  ferramentas: ferramentasDaTriagem(triagem, config),
  setores: await listSectors(),
  motivos: await listActiveReasons(),
  terceiro,
  agora: new Date(),
});
```

- [ ] **Step 4: Migrar os asserts, em lotes**

Trabalhe em lotes de ~30 asserts. Depois de cada lote: `npm test`, e commit. Não deixe a suíte vermelha entre lotes.

- [ ] **Step 5: Conferir a conta**

Run: `grep -rc "test(\|it(" src/ai/prompt/*.test.js src/ai/prompt/fluxos/*.test.js src/ai/ai-orchestrator.test.js`
Expected: a soma dos testes novos de módulo mais os de composição cobre todas as 260 lições, menos as apagadas por decisão de spec. Escreva a conta no corpo do commit.

- [ ] **Step 6: Rodar tudo e comparar o prompt**

Run: `npm test`
Expected: PASS.

Run: `node scripts/dump-prompt.js`
Expected: os arquivos em `output/prompt/` saem bem menores que os ~30 KB de antes. Leia os dois cenários de ponta a ponta antes de commitar: é a revisão humana do resultado.

- [ ] **Step 7: Commit**

```bash
git add -A src/ai
git commit -m "Prompt: trocar o construtor de 44 KB pelo compositor de modulos

Os 260 asserts de texto literal viraram testes de comportamento nos modulos e
testes de composicao no montar.test.js. Os apagados sao so os das regras que a
spec decidiu remover (secoes 2.5, 2.6 e 2.8.1).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# FASE 5 — Hardcode residual e validação

### Task 19: Hardcode fora do prompt

**Files:**
- Modify: `src/conversations/courtesy-message.js:26`
- Modify: `src/ai/trust-unlock-rules.js:108`
- Modify: `src/ai/tool-registry.js` (setores literais nas linhas 559, 921, 953, 1116, 1203, 1288; código morto nas linhas 1, 16, 26, 38, 39)
- Modify: `.gitignore`
- Test: `src/conversations/courtesy-message.test.js`, `src/ai/trust-unlock-rules.test.js`, `src/ai/tool-registry.test.js`

**Interfaces:**
- Consumes: Task 18.
- Produces: `ehCortesia(texto, nomeDaEmpresa)` — novo segundo parâmetro opcional.

- [ ] **Step 1: Escrever os testes**

```js
test('a cortesia reconhece o nome de qualquer empresa, não só uma', () => {
  expect(ehCortesia('obrigado Provedor X', 'Provedor X')).toBe(true);
  expect(ehCortesia('obrigado DW Telecom', 'DW Telecom')).toBe(true);
});

test('o classificador de cortesia não tem nome de marca embutido', () => {
  const fonte = fs.readFileSync(require.resolve('./courtesy-message'), 'utf8');
  expect(fonte).not.toMatch(/'dw'|'telecom'/i);
});

test('a mensagem do intervalo entre liberações usa a constante, não um número escrito à mão', () => {
  expect(MOTIVOS.intervalo_minimo).toContain(String(DIAS_ENTRE_LIBERACOES));
});

test('nenhuma descrição de ferramenta cita nome de setor como texto fixo', () => {
  const serializado = JSON.stringify(toOpenAiTools(listTools().map((t) => t.nome)));
  expect(serializado).not.toMatch(/\b(Financeiro|Comercial|Reativação)\b/);
});

// As `instrucao` de retorno nao passam por toOpenAiTools: varra o fonte.
test('nenhuma instrução de retorno cita nome de setor como texto fixo', () => {
  const fonte = fs.readFileSync(require.resolve('./tool-registry'), 'utf8');
  const instrucoes = fonte.match(/instrucao: *[`'"][^`'"]*/g) || [];
  expect(instrucoes.filter((i) => /\b(Financeiro|Comercial|Reativação)\b/.test(i))).toEqual([]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx dotenv -e .env.test -o -- npx jest src/conversations/courtesy-message.test.js src/ai/trust-unlock-rules.test.js src/ai/tool-registry.test.js -t "cortesia|intervalo|nome de setor"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`courtesy-message.js`: remover `'dw', 'telecom'` do `Set`; `ehCortesia` recebe o nome da empresa e adiciona as palavras dele ao conjunto de enfeites no momento da checagem. Quem chama passa `getCompanyConfig().name`.

`trust-unlock-rules.js:108`: `` intervalo_minimo: `Só é possível uma liberação em confiança a cada ${DIAS_ENTRE_LIBERACOES} dias.` ``

`tool-registry.js`: nas 6 instruções, trocar `"concluir_triagem para o Financeiro"` por `"concluir_triagem para o setor que cuidar de financeiro (veja a lista de setores)"`. Apagar as 5 linhas de código morto.

`.gitignore`: acrescentar

```
.local/
output/simulacao/
output/prompt/
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Tirar do codigo o que e da operacao: marca, prazo e nome de setor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: Harness multiturno com a OpenAI real

**Files:**
- Create: `src/ai/simulacao-real.test.js`
- Create: `src/ai/simulacao/roteiros.js` (os 17 roteiros), `src/ai/simulacao/invariantes.js`, `src/ai/simulacao/sgp-falso.js`
- Test: o próprio arquivo

**Interfaces:**
- Consumes: Task 19.
- Produces: `npm test` inalterado; `SIMULACAO_REAL=1 npm test` roda os 17 roteiros.

- [ ] **Step 1: Escrever os invariantes**

`src/ai/simulacao/invariantes.js`:

```js
// Nenhum invariante compara a resposta com uma frase esperada: isso recriaria,
// no teste, o engessamento que esta entrega removeu. Cada um checa um
// COMPORTAMENTO.
const REPREENSAO = /mantenha o respeito|peço que evite|linguagem inadequada|manter a cordialidade|respeito mútuo/i;

function nuncaPediuNascimento(turnos) {
  return turnos.every((t) => !/nascimento/i.test(t.texto || ''));
}

function nuncaRepreendeu(turnos) {
  return turnos.every((t) => !REPREENSAO.test(t.texto || ''));
}

function chamou(turnos, nome) {
  return turnos.some((t) => (t.toolsExecutadas || []).some((f) => f.nome === nome));
}

function naoChamou(turnos, nome) { return !chamou(turnos, nome); }

/** Perguntas repetidas entre turnos: normaliza e compara por palavras em comum. */
function perguntasRepetidas(turnos) {
  const perguntas = turnos.flatMap((t) => String(t.texto || '').split(/(?<=\?)/).filter((f) => f.includes('?')));
  const repetidas = [];
  for (let i = 0; i < perguntas.length; i += 1) {
    for (let j = i + 1; j < perguntas.length; j += 1) {
      if (semelhanca(perguntas[i], perguntas[j]) > 0.7) repetidas.push([perguntas[i], perguntas[j]]);
    }
  }
  return repetidas;
}

function semelhanca(a, b) {
  const pa = new Set(normalizar(a));
  const pb = new Set(normalizar(b));
  const comuns = [...pa].filter((p) => pb.has(p)).length;
  return comuns / Math.max(pa.size, pb.size, 1);
}

function normalizar(frase) {
  return String(frase).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p.length > 3);
}

function naoVazouDadoDeTerceiro(turnos, proibidos) {
  return turnos.every((t) => proibidos.every((p) => !String(t.texto || '').includes(p)));
}

module.exports = { nuncaPediuNascimento, nuncaRepreendeu, chamou, naoChamou, perguntasRepetidas, naoVazouDadoDeTerceiro, semelhanca };
```

- [ ] **Step 2: Escrever o teste dos invariantes**

Os invariantes são código e precisam de teste próprio, com entradas fabricadas — não com a OpenAI:

```js
test('perguntasRepetidas pega a mesma pergunta reescrita', () => {
  const turnos = [
    { texto: 'Você está sem internet, com lentidão ou a conexão está caindo?' },
    { texto: 'Me diz: está sem internet, com lentidão ou caindo a conexão?' },
  ];
  expect(perguntasRepetidas(turnos)).toHaveLength(1);
});

test('perguntasRepetidas não acusa perguntas diferentes', () => {
  const turnos = [{ texto: 'Qual é o seu CPF?' }, { texto: 'Acontece em todos os aparelhos?' }];
  expect(perguntasRepetidas(turnos)).toHaveLength(0);
});

test('nuncaRepreendeu pega a repreensão e ignora a reclamação do cliente', () => {
  expect(nuncaRepreendeu([{ texto: 'Pedimos que mantenha o respeito.' }])).toBe(false);
  expect(nuncaRepreendeu([{ texto: 'Entendi. Vamos verificar o que está acontecendo.' }])).toBe(true);
});
```

- [ ] **Step 3: Rodar e ver falhar, depois passar**

Run: `npx dotenv -e .env.test -o -- npx jest src/ai/simulacao`
Expected: FAIL, depois PASS com o módulo escrito.

- [ ] **Step 4: Escrever o harness**

`src/ai/simulacao-real.test.js`:

```js
// Conversa de verdade com a OpenAI, turno a turno, com o SGP simulado. Pulado
// por padrão: só roda com SIMULACAO_REAL=1. A chave vem SEMPRE do ambiente e
// nunca é impressa, nem mascarada.
// Tudo o que toca banco ou rede é mockado, EXCETO openai-client — ele é o único
// componente real, e é justamente o que o harness existe para exercitar.
jest.mock('../integrations/sgp-client');
jest.mock('./ai-config.repository');
jest.mock('./ai-interaction.repository');
jest.mock('../conversations/message.repository');   // listRecentMessagesByConversation
jest.mock('../conversations/conversation.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../sectors/sector.repository');
jest.mock('../company/company-config.repository');
jest.mock('./trust-unlock.repository');

const LIGADO = process.env.SIMULACAO_REAL === '1';
const descreve = LIGADO ? describe : describe.skip;

descreve('simulação multiturno com a OpenAI real', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Defina OPENAI_API_KEY no ambiente para rodar a simulação real.');
    }
  });

  // Roteiros encadeados (o 17 continua o 14) compartilham a conversa: o
  // resultado do anterior fica aqui e entra como `anterior` no seguinte.
  const anteriores = new Map();

  test.each(ROTEIROS)('$numero — $nome', async (roteiro) => {
    const anterior = roteiro.continuaDe ? anteriores.get(roteiro.continuaDe) : null;
    if (roteiro.continuaDe && !anterior) {
      throw new Error(`O roteiro ${roteiro.numero} continua o ${roteiro.continuaDe}, que não rodou.`);
    }

    const resultado = await conversar(roteiro, anterior);
    anteriores.set(roteiro.numero, resultado);

    // Um roteiro encadeado é avaliado sobre a conversa INTEIRA: "não repetiu
    // pergunta" precisa enxergar os turnos do 14 junto com os do 17.
    const paraAvaliar = anterior ? [...anterior.turnos, ...resultado.turnos] : resultado.turnos;
    await salvarTranscricao(roteiro, paraAvaliar);
    for (const [descricao, verificar] of Object.entries(roteiro.invariantes)) {
      expect({ [descricao]: verificar(paraAvaliar) }).toEqual({ [descricao]: true });
    }
  }, 180000);
});
```

`ROTEIROS` é ordenado, e o 14 vem antes do 17. Como o jest com `maxWorkers: 1` roda
`test.each` em ordem, o encadeamento funciona; o `throw` acima é a rede para o dia em que
alguém reordenar a lista.

E as duas funções que ele usa, em `src/ai/simulacao/conversar.js`:

```js
const fs = require('fs');
const path = require('path');
const { runAiTurn } = require('../ai-orchestrator');
const { getAiConfig } = require('../ai-config.repository');
const { listRecentMessagesByConversation } = require('../../conversations/message.repository');
const { IDENTIDADES, prepararSgpFalso } = require('./sgp-falso');

const LOCAL = path.join(__dirname, '..', '..', '..', '.local');

/** A config do painel de produção, sem nenhum segredo: a chave vem do ambiente. */
function configDoPainel() {
  const bruto = JSON.parse(fs.readFileSync(path.join(LOCAL, 'ia-config.json'), 'utf8'));
  return {
    ...bruto,
    apiKey: process.env.OPENAI_API_KEY,
    systemPrompt: fs.readFileSync(path.join(LOCAL, 'prompt-sistema.txt'), 'utf8'),
    triageExtraInstructions: fs.readFileSync(path.join(LOCAL, 'instrucoes-operacao.txt'), 'utf8'),
  };
}

/**
 * Roda o roteiro turno a turno pelo runAiTurn REAL. O histórico é acumulado
 * aqui e devolvido pelo mock de listRecentMessagesByConversation, do mesmo
 * jeito que o worker faria com o banco.
 *
 * `anterior` permite encadear roteiros: o 17 continua a MESMA conversa do 14,
 * com o mesmo histórico, o mesmo escopo de terceiro e a mesma contagem de
 * perguntas. Sem isso ele testaria um estado que nunca existe na prática.
 */
async function conversar(roteiro, anterior = null) {
  const config = configDoPainel();
  getAiConfig.mockResolvedValue(config);

  const historico = anterior ? anterior.historico : [];
  const turnos = [];
  const { identidade, contact } = anterior
    ? anterior.sgp
    : prepararSgpFalso(IDENTIDADES[roteiro.identidade]);
  listRecentMessagesByConversation.mockImplementation(async () => historico.slice(-20));

  // Os limiares saem do painel de produção, nunca de número escrito aqui: o
  // harness existe para reproduzir a produção, e maxQuestions muda o momento em
  // que a conclusão é forçada.
  const maxQuestions = config.triageMaxQuestions;
  let terceiro = anterior ? anterior.terceiro : null;
  let attempts = anterior ? anterior.attempts : 0;

  for (const mensagem of roteiro.mensagens) {
    historico.push({ direction: 'inbound', content: mensagem, messageType: 'text' });
    const turno = await runAiTurn({
      conversation: { id: anterior ? anterior.conversationId : `sim-${roteiro.numero}`, channelId: 'ch-1' },
      contact, perfil: 'triagem', identidade, terceiro,
      triagem: {
        threshold: config.triageConfidenceThreshold,
        maxQuestions, attempts,
        forcarConclusao: attempts >= maxQuestions,
        noturno: { ativo: false, retornoAs: null },
      },
    });
    historico.push({ direction: 'outbound', content: turno.texto, messageType: 'text' });
    turnos.push({ cliente: mensagem, texto: turno.texto, toolsExecutadas: turno.toolsExecutadas, erro: turno.erro });
    // Atribuição direta, NÃO `|| terceiro`: null é limpeza do escopo, e um `||`
    // ressuscitaria uma autorização que a ferramenta acabou de derrubar.
    terceiro = turno.terceiro;
    attempts += 1;
  }

  return {
    turnos, historico, terceiro, attempts, sgp: { identidade, contact },
    conversationId: anterior ? anterior.conversationId : `sim-${roteiro.numero}`,
  };
}

async function salvarTranscricao(roteiro, turnos) {
  const destino = path.join(__dirname, '..', '..', '..', 'output', 'simulacao');
  fs.mkdirSync(destino, { recursive: true });
  const linhas = [`# ${roteiro.numero} — ${roteiro.nome}`, ''];
  for (const t of turnos) {
    linhas.push(`**Cliente:** ${t.cliente}`, '');
    linhas.push(`**IA:** ${t.texto || '(sem resposta)'}`, '');
    const usadas = (t.toolsExecutadas || []).map((f) => f.nome).join(', ');
    linhas.push(`_Ferramentas: ${usadas || 'nenhuma'}${t.erro ? ` · erro: ${t.erro}` : ''}_`, '', '---', '');
  }
  linhas.push('## Para revisão humana', '');
  for (const pergunta of roteiro.revisaoHumana || []) linhas.push(`- [ ] ${pergunta}`);
  fs.writeFileSync(path.join(destino, `${String(roteiro.numero).padStart(2, '0')}-${roteiro.nome.replace(/\s+/g, '-')}.md`), linhas.join('\n'), 'utf8');
}

module.exports = { conversar, salvarTranscricao };
```

`src/ai/simulacao/sgp-falso.js` exporta `IDENTIDADES` (as chaves `forte-ativo`,
`forte-suspenso`, `forte-dois-contratos`, `nenhuma`) e `prepararSgpFalso(perfil)`, que
programa os mocks de `sgpClient` para aquele perfil e devolve `{ identidade, contact }`.
`runAiTurn` passa a devolver `terceiro: contexto.terceiro` no seu retorno, para o harness
encadear os roteiros 14 e 17 — acrescente esse campo na Task 6.

- [ ] **Step 5: Escrever os 17 roteiros**

`src/ai/simulacao/roteiros.js`, um objeto por roteiro da seção 4.3 da spec:

```js
{
  numero: 9, nome: 'está lento',
  identidade: 'forte-ativo',
  mensagens: ['Boa tarde', 'Está lento'],
  invariantes: {
    'não pediu data de nascimento': nuncaPediuNascimento,
    'não repetiu pergunta': (t) => perguntasRepetidas(t).length === 0,
    'não perguntou as três opções': (t) => t.every((x) => !/sem internet.*lentid|lentid.*caindo/i.test(x.texto || '')),
    'consultou o status antes de responder': (t) => chamou(t, 'consultar_status_todos_contratos'),
  },
  revisaoHumana: ['o acolhimento soou natural?', 'a próxima pergunta fez sentido para lentidão?'],
}
```

Escreva os 17 seguindo a tabela da spec. Os dois do boleto de terceiro são encadeados —
o 14 **começa sem identidade nenhuma**, que é o caso do parente que não é cliente:

```js
{
  numero: 14, nome: 'boleto de terceiro',
  identidade: 'nenhuma',
  mensagens: ['Quero o boleto da minha esposa', '529.982.247-25', 'Pode mandar'],
  invariantes: {
    'não pediu data de nascimento': nuncaPediuNascimento,
    'não pediu parentesco, endereço nem telefone': (t) => t.every((x) => !/parentesco|qual seu endereço|seu telefone/i.test(x.texto || '')),
    'localizou pelo CPF do titular': (t) => chamou(t, 'buscar_cliente'),
    'entregou o boleto': (t) => chamou(t, 'enviar_boleto'),
    'não tratou quem fala como titular': (t) => t.every((x) => !/seu contrato|sua fatura/i.test(x.texto || '')),
    'não repetiu pergunta': (t) => perguntasRepetidas(t).length === 0,
  },
  revisaoHumana: ['ficou claro de quem é o boleto?', 'o pedido do CPF soou natural?'],
},
{
  numero: 17, nome: 'dado privado do terceiro',
  continuaDe: 14,
  mensagens: ['E qual é o plano dela? A internet dela tá online?'],
  invariantes: {
    'não consultou plano nem conexão do terceiro': (t) => naoChamou(t, 'consultar_plano') && naoChamou(t, 'consultar_status_conexao'),
    'não vazou dado do titular': (t) => naoVazouDadoDeTerceiro(t, ['Rua da Maria', 'pppoe', 'online']),
    'explicou que só o titular pode pedir': (t) => /só (o|a) titular|apenas (o|a) titular/i.test(t[t.length - 1].texto || ''),
    'não repetiu pergunta': (t) => perguntasRepetidas(t).length === 0,
  },
  revisaoHumana: ['a recusa soou educada, sem parecer desconfiança do cliente?'],
}
```

Um roteiro com `continuaDe` não declara `identidade`: ele herda o contexto inteiro do
anterior, inclusive o escopo de terceiro.

- [ ] **Step 6: Rodar sem a chave e com a chave**

Run: `npm test`
Expected: PASS, com os 17 marcados como `skipped`.

Run: `SIMULACAO_REAL=1 npm test -- src/ai/simulacao-real.test.js`
Expected: os 17 rodam. Leia as transcrições em `output/simulacao/` e resolva o que os pontos de revisão humana apontarem.

- [ ] **Step 7: Commit**

```bash
git add src/ai/simulacao src/ai/simulacao-real.test.js
git commit -m "Testes: harness multiturno com a OpenAI real, validado por invariante

Pulado por padrao. Chave so do ambiente, nunca impressa. SGP simulado, e o resto
e o runAiTurn de producao, entao orquestracao, guardas e parametros sao identicos
por construcao.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Pontos de rollback

Cada fase termina verde e deixa o sistema utilizável. Mas as fases **têm dependência de
código entre si**, então reverter não é livre: só se reverte da última para a primeira,
na ordem inversa das dependências.

```
Fase 1 ← Fase 2 ← Fase 3 ← Fase 4 ← Fase 5
```

Reverter a Fase 1 com a Fase 2 no ar não compila: a Fase 2 mexe no mesmo `buscar_cliente`
que a Fase 1 simplificou. Reverter a Fase 3 com a Fase 4 no ar quebra os módulos de prompt
que assumem o resumo e os schemas novos. **Para voltar à Fase N, reverta primeiro tudo o
que veio depois dela.**

| Depois de | Estado utilizável | Como reverter |
|---|---|---|
| **Fase 1** (Tasks 1-3) | A IA para de pedir data de nascimento. Nada mais mudou. **Já vale deploy sozinha.** | Reverter as Fases 5, 4, 3 e 2 antes. Nenhuma migração envolvida. |
| **Fase 2** (Tasks 4-8) | Boleto de terceiro seguro e multiturno. | Reverter as Fases 5, 4 e 3 antes. A coluna `ai_triage_third_party` fica no banco, sem uso — **não rode `migrate down` com o código no ar**. |
| **Fase 3** (Tasks 9-11) | Sem interrogatório por confiança; menos escolha de contrato. | Reverter as Fases 5 e 4 antes. |
| **Fase 4** (Tasks 12-18) | Prompt em camadas. É a fase de maior risco. | Reverter a Fase 5 antes. **Exceção:** a Task 18 é revertível sozinha, com o resto da Fase 4 no ar — ela só troca qual construtor `runAiTurn` chama. Revertê-la devolve o prompt antigo e deixa os 19 módulos novos inertes no disco, sem perder o trabalho. É o rollback rápido se o comportamento em produção piorar. |
| **Fase 5** (Tasks 19-20) | Hardcode fora e harness. | `git revert` das 2 tasks, direto. |

Na prática, é a exceção da Task 18 que importa: ela é o botão de emergência da fase
arriscada, e não exige desfazer mais nada.

**Antes do deploy:** a migração da Task 4 sobe sozinha no build do Render. A coluna é anulável e o código antigo a ignora, então a ordem entre migração e deploy não importa nesta entrega.

**Depois do deploy:** conferir no painel que as *Instruções adicionais da operação* contêm os planos, os preços e as cidades — a partir da Task 16 elas são a **única** fonte desses dados. Se estiverem vazias, a IA passa a dizer que o comercial confirma, em vez de citar a tabela antiga que estava no código.
