# E2.5 — Overlays da mesa — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar à base única (E.1) os oito overlays que se abrem da mesa — Encerrar, Transferir, Enviar template, Iniciar conversa, Atendimentos anteriores, visualizador de imagem, Encerrados (mestre-detalhe) e Meu perfil —, cada um com as mudanças estruturais do Apêndice E.2 e as decisões 7, 8, 9 e 10 do proprietário.

**Architecture:** Cada overlay passa a ser um `Dialog` da E2.2 (sai o `WaDialog` e o rodapé montado à mão), com `DialogFooter` (erro fixo, nota que diz o que falta), `ocupado` (nada fecha no meio do envio) e, quando é escolha de 1 entre N, a `ListaDeEscolha`. Nasce um componente compartilhado, `EscolhaDeTemplate` (lista + variáveis + prévia), usado por Enviar template e Iniciar conversa. O Histórico passa a mostrar a `MessageBubble` da conversa em modo leitura (E2.4). O Encerrados vira um diálogo mestre-detalhe — lista à esquerda, a `ConversationView` encerrada à direita —, e com ele somem o modal empilhado e a variante não compacta do `ConversationListItem`.

**Tech Stack:** React 18.3, Tailwind 4.3 (tokens E2.1), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (6.6, 14.1 decisões 7–10), Apêndice E (E.1, E.2, E.3, E.4) e anexos `grupo-A.md` (§1, §2, §3, §5), `grupo-B.md` (§1, §3), `grupo-C.md` (§2, §3). Plano mestre: `docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md`.

> **Provado antes da aprovação (24/09/2026), em cadeia:** as Tasks 1 a 8 e os Steps 1–3 da Task 9 foram aplicados a partir deste texto numa cópia descartável com E2.1, E2.2, E2.3 e E2.4 já aplicadas (`scratchpad/e25-prova/`, arquivada em `D:\dw-redesenho-arquivo\2026-09-24\`). No fim, nenhuma tarefa ficou sem passar, mas cinco da cadeia (duas da E2.4 e três desta) só passaram com correção. Os erros deste texto estão corrigidos nos trechos marcados **[Prova na cópia, 24/09/2026]** (o escape dos acentos da Task 1 já tinha sido corrigido antes):
> - o teste de apelido, que passava no vazio (T1);
> - a descrição do atendente, que saía com espaço antes da vírgula (T2);
> - a guarda do topo do visualizador, sem teste, e o `fetch` simulado, que vazava (T6);
> - na T7, o Step 5, que ao pé da letra quebrava **toda** linha da lista (apagava `formatMessageTime`, que a linha compacta usa) e apagava o único teste da hora na linha; e o erro do "Carregar mais", sem teste;
> - na T8, o auxiliar do PRF-12 e o teste da confirmação, que não navegavam até a vista de senha; e o erro de carga do perfil, que perdia a mensagem do servidor (decisão do proprietário: a mensagem do servidor fica);
> - o "Expected" e a lista mínima da T9.
>
> O texto corrigido rodou numa cópia de verificação: suíte com 1.780 testes passando e só as 3 falhas antigas de `api.qr`; build ok; cada teste novo falha quando o defeito que ele cobre volta (mutação).

## Global Constraints

Valem as do plano mestre. As que mais pesam aqui:

- **Base única (E.1):** sem ícone de cabeçalho decorativo; diálogo de **ação** sem × (`dismissible={false}`), rodapé `[Cancelar][ação principal]` pelo `DialogFooter`, perigo só no botão destrutivo final; diálogo de **consulta** (Histórico, Encerrados, visualizador) com × no cabeçalho, sem rodapé, fecha por ×, ESC e clique fora; margem de 24 px; uma geometria de botão (`Button`); erro na região fixa; nota do rodapé alterna motivo × consequência; `ocupado` como guarda única; uma largura por diálogo em todos os estados.
- **Decisão 7:** Transferir mostra **número + "Carga alta" a partir de 10**; saem "Disponível", "Em atendimento" e "Movimentado".
- **Decisão 8:** só **2 legendas** no catálogo de motivos (Financeiro, Suporte técnico); o catálogo continua aceitando legenda para motivo futuro, e ícone e legenda continuam casando **pelo nome** (memória `project_close_reason_modal_visual`).
- **Decisão 10:** Encerrados é **um diálogo mestre-detalhe**; sai o modal empilhado.
- **Pix nunca mostra o código** fora do cartão — inclusive no Histórico.
- **Lista de motivos vazia trava todo encerramento** (memória `project_close_reasons_and_report`): o vazio continua claro e o botão continua travado.
- **PRF-12 na base:** a Task 8 (Meu perfil) supõe a correção da senha atual errada (`credencialNoPedido` em `services/api.js`, commits `ed48336`, `af3c6ef`, `175c40c`) já na `main`. Sem ela, o teste "senha atual errada não desloga" falha — ver o plano mestre.
- Nenhum overlay novo usa `WaDialog`, `waInputClass`, `waPrimaryButtonClass` nem cor literal.
- **Pendências do acento em toda tarefa:** o passo de verificação de cada tarefa roda também `src/estilo`; arquivo que ficou limpo sai de `PENDENCIAS` na mesma tarefa (o teste "a lista só encolhe" exige). O Step 3 da Task 9 vira conferência.

## Review Focus

- **Enviar com o diálogo ocupado e ESC/× no meio.** Transferir, Encerrar, Enviar template e Iniciar conversa: com o pedido em curso, ESC, × (onde houver), clique fora e Cancelar **não fecham**, e as linhas/campos não trocam a escolha. Teste em cada tarefa.
- **Busca que esconde o escolhido no Transferir.** Escolher Pedro, buscar "ana": o botão continua "Transferir para Pedro" e a linha do Pedro fica fixada acima dos grupos (ATD-TRF-20). Teste na Task 2.
- **Resposta atrasada de outro canal no Iniciar conversa.** Canal A (oficial) → canal B (oficial) com os templates de A chegando depois: a lista mostra os de B (CLASSE-01, ATD-INI-27). Teste na Task 4.
- **Troca rápida entre dois atendimentos no Histórico.** Abrir o 1º, voltar, abrir o 2º com a resposta do 1º atrasada: o detalhe do 2º não é coberto pelo 1º (CV-HIS-10). Teste na Task 5.
- **Fechar Meu perfil com a senha preenchida.** Cancelar, ESC ou × com nome, telefone ou algum campo de senha alterado pedem "Descartar alterações?"; sem nada alterado, fecham direto (PRF-17). Teste na Task 8.

---

## Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `frontend/src/components/closeReasonCatalog.jsx` (+ teste) | Reescrever | ícone Tabler pelo nome; 2 legendas; sem cor |
| `frontend/src/components/CloseReasonModal.jsx` (+ teste) | Reescrever | Encerrar em `Dialog` + `ListaDeEscolha` |
| `frontend/src/components/TransferModal.jsx` (+ teste) | Reescrever | Transferir em 480 px, 2 linhas por atendente |
| `frontend/src/components/EscolhaDeTemplate.jsx` (+ teste) | Criar | lista + variáveis + prévia, compartilhada |
| `frontend/src/components/SendTemplateModal.jsx` (+ teste) | Reescrever | Enviar template em uma coluna |
| `frontend/src/components/StartConversationModal.jsx` (+ teste) | Reescrever | Iniciar conversa em uma coluna |
| `frontend/src/components/ConversationHistoryModal.jsx` (+ teste) | Reescrever | lista de 2 linhas; detalhe com a `MessageBubble` |
| `frontend/src/components/MessageAttachment.jsx` (+ teste) | Modificar | visor com barra no topo, girar, baixar por `blob:` |
| `frontend/src/components/MessageBubble.jsx` | Modificar | repassa o autor ao anexo (sem `onResponder`/`onAnalisarComprovante` ela já é só leitura) |
| `frontend/src/utils/dataCurta.js` (+ teste) | Criar | "14:32" / "ontem" / "12/09" |
| `frontend/src/components/ClosedConversationsModal.jsx` (+ teste) | Reescrever | mestre-detalhe |
| `frontend/src/components/ClosedConversationsList.jsx` | Apagar | a lista mora no diálogo |
| `frontend/src/components/ConversationListItem.jsx` (+ teste) | Modificar | sai a variante não compacta |
| `frontend/src/components/ConversationModal.jsx` (+ teste) | Modificar | diálogo de consulta, sem painel de informações |
| `frontend/src/components/ProfileModal.jsx` (+ teste) | Reescrever | duas vistas, uma ação cada |
| `frontend/src/pages/DashboardPage.jsx` | Modificar | `onTransferido`, aba Atendimento ao iniciar conversa |
| `frontend/src/components/overlays.css` | Modificar | saem as regras de cada overlay tratado |

## Interfaces

**Consome:** `Dialog`, `DialogBody`, `DialogFooter` (`nota`, `motivo`, `motivoId`, `erro`), `ocupado`, `dismissible`, `closeOnBackdrop`; `ListaDeEscolha` (`opcao: { valor, titulo, detalhe?, icone?, fim?, desabilitada? }`); `useConfirm`; `Button` (E2.1/E2.2). `MessageBubble`, `estaEncerrada`, `PainelCliente`, `ConversationView` com `onFechar` e `somente leitura` por status (E2.4). `avisarNaMesa(frase)` da `DashboardPage` (E2.3).

**Produz:**

```js
// components/closeReasonCatalog.jsx
export function describeReason(nome): { Icone: Component, hint: string|null }
export function normalizeReasonName(nome): string

// components/TransferModal.jsx (default) — { conversationId, nomeDoCliente?, onClose, onTransferido?(frase) }
export const CARGA_ALTA = 10
export function descreverCarga({ online, active }): { numero: string, alta: boolean }

// components/EscolhaDeTemplate.jsx (default)
//   { templates, status: 'loading'|'ready'|'error', onTentarDeNovo, valor, aoEscolher(id),
//     variaveis: string[], aoMudarVariavel(i, texto), desabilitada?, vazio: string }
export function faltaParaEnviar(template, variaveis): string|null

// components/SendTemplateModal.jsx (default) — { conversationId, channelId, motivo: 'fechada'|'recusada', onClose, onSent }
// components/StartConversationModal.jsx (default) — { onClose, onCreated(conversation) }  (inalterado)
// components/ConversationHistoryModal.jsx (default) — { contactId, nomeDoContato?, onClose }
// ui/Dialog.jsx — prop nova inicioDoCabecalho?: node (controle antes do título, fora do <h2>)
// components/MessageBubble.jsx — sem props novas: sem onResponder/onAnalisarComprovante é só leitura
// components/MessageAttachment.jsx — props novas autor?: string (repassada ao visor)
// utils/dataCurta.js
export function dataCurta(valor, agora = new Date()): string|null
// components/ClosedConversationsModal.jsx (default) — { onClose }  (inalterado)
// components/ProfileModal.jsx (default) — { onClose, onProfileUpdated? }  (inalterado)
```

---

### Task 1: Encerrar atendimento — linha-rádio, 2 legendas, perigo no botão final

**Files:**
- Rewrite: `frontend/src/components/closeReasonCatalog.jsx`, `frontend/src/components/closeReasonCatalog.test.jsx`
- Rewrite: `frontend/src/components/CloseReasonModal.jsx`; Modify: `frontend/src/components/CloseReasonModal.test.jsx`
- Modify: `frontend/src/components/overlays.css` (saem as regras `[data-dialog=close-reason]`)

Apêndice E.2 e `grupo-A.md` §3: 820 → **640 px**; o cartão com ladrilho colorido de 44 px vira a linha-rádio da `ListaDeEscolha` (ícone de 20 px em tinta-2, nome, legenda); sai o ícone vermelho do cabeçalho e sai a descrição — o grupo ganha a legenda **visível** "Motivo do contato"; duas colunas por `@container` (corpo ≥ 520 px); **"Sugerido pela IA"** (ícone da IA + texto) na linha do motivo sugerido; erro na região fixa; nota do rodapé "Escolha o motivo do contato." enquanto falta, e a consequência de hoje depois; **perigo no botão final** "Encerrar atendimento" (o check dentro dele sai). **Decisão 8:** só Financeiro e Suporte técnico mantêm legenda. Ícones do catálogo pela tabela D.9 do Apêndice D (`cancel`→`IconCancel`, `dollar`→`IconMoney`, `wrench`→`IconWrench`, `pin`→`IconPin`, `refresh`→`IconPower`, `robot`→`IconRobot`, `bellOff`→`IconChatSlash`, `headset`→`IconHeadset`, `key`→`IconKey`, `tag`→`IconTag`). Comportamento: ocupado com "Encerrando…" (nada fecha e nada troca de escolha); `onRetry={refresh}` no erro de carga; `suggestedReasonId` só pré-seleciona (e só ganha o selo) se estiver na lista — hoje um id fora da lista deixava o botão habilitado com um motivo invisível (ATD-ENC-09); vazio com o caminho real do menu.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/components/closeReasonCatalog.test.jsx` inteiro:

```jsx
import { describe, test, expect } from 'vitest';
import { describeReason, normalizeReasonName } from './closeReasonCatalog';

describe('catálogo de motivos (decisão 8)', () => {
  test('acha o motivo pelo nome ignorando acento, caixa e espaços extras', () => {
    expect(normalizeReasonName('  Mudança  de Endereço ')).toBe('mudanca de endereco');
    expect(describeReason('SUPORTE TÉCNICO').hint).toBe('Dúvidas, problemas técnicos');
  });

  test('só Financeiro e Suporte técnico têm legenda: as outras repetiam o nome', () => {
    expect(describeReason('Financeiro').hint).toBe('Boletos, pagamentos, faturas');
    expect(describeReason('Suporte técnico').hint).toBe('Dúvidas, problemas técnicos');
    for (const nome of ['Cancelamento', 'Instalação', 'Mudança de endereço', 'Reativação', 'Resolvido pela IA', 'Sem resposta', 'Troca de senha']) {
      expect(describeReason(nome).hint, nome).toBeNull();
    }
  });

  test('cada motivo do catálogo tem um ícone próprio; o de fora cai no ícone neutro', () => {
    const neutro = describeReason('Visita comercial').Icone;
    expect(neutro).toBeTruthy();
    const nomes = ['Cancelamento', 'Financeiro', 'Instalação', 'Mudança de endereço', 'Reativação', 'Resolvido pela IA', 'Sem resposta', 'Suporte técnico', 'Troca de senha'];
    const icones = nomes.map((nome) => describeReason(nome).Icone);
    icones.forEach((Icone, i) => expect(Icone, nomes[i]).not.toBe(neutro));
    expect(new Set(icones).size).toBe(nomes.length);
  });

  test('apelido acha o ícone do motivo certo', () => {
    // Sem esta linha o teste passava antes do catálogo novo: `undefined` dos
    // dois lados (prova em cópia, 24/09/2026).
    expect(describeReason('Senha').Icone).toBeTruthy();
    expect(describeReason('Senha').Icone).toBe(describeReason('Troca de senha').Icone);
    expect(describeReason('Endereço').Icone).toBe(describeReason('Mudança de endereço').Icone);
    expect(describeReason('Boleto atrasado').Icone).toBe(describeReason('Financeiro').Icone);
    expect(describeReason('Resolvido pela IA (triagem)').Icone).toBe(describeReason('Resolvido pela IA').Icone);
    expect(describeReason('Suporte').hint).toBe('Dúvidas, problemas técnicos');
  });

  test('sem cor: o catálogo não pinta mais nada', () => {
    const look = describeReason('Cancelamento');
    expect(look).not.toHaveProperty('color');
    expect(look).not.toHaveProperty('background');
  });
});
```

Em `CloseReasonModal.test.jsx`:

- "mostra a legenda do catálogo só para motivos conhecidos" passa a usar Financeiro (que tem legenda) e Troca de senha (que não tem mais):

```jsx
  test('mostra a legenda só onde ela acrescenta (decisão 8)', () => {
    useReasons.mockReturnValue({
      reasons: [
        { id: 'r1', name: 'Financeiro', active: true },
        { id: 'r2', name: 'Troca de senha', active: true },
      ],
      status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Financeiro' })).toHaveAccessibleDescription('Boletos, pagamentos, faturas');
    expect(screen.getByRole('radio', { name: 'Troca de senha' })).not.toHaveAccessibleDescription();
  });
```

- "o botão X do cabeçalho fecha o modal" sai (diálogo de ação não tem ×, E.1-2) e entra:

```jsx
  test('diálogo de ação: sem ×, sem ícone de cabeçalho, com a legenda visível do grupo', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    const dialogo = screen.getByRole('dialog', { name: 'Encerrar atendimento' });
    expect(within(dialogo).queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    expect(dialogo.querySelector('[data-tom]')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Motivo do contato' })).toBeInTheDocument();
    expect(screen.getByText('Motivo do contato')).toBeVisible();
  });

  test('o perigo está no botão que encerra, e o foco inicial nunca é ele', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    const encerrar = screen.getByRole('button', { name: 'Encerrar atendimento' });
    expect(encerrar).toHaveAttribute('data-danger');
    expect(encerrar).not.toHaveFocus();
  });

  test('sem motivo, a nota diz o que falta e o botão aponta para ela', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toHaveAccessibleDescription('Escolha o motivo do contato.');
  });

  test('com motivo, a nota volta à consequência', async () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Troca de senha' }));
    expect(screen.getByText('O cliente recebe a mensagem de encerramento e o motivo alimenta o Relatório.')).toBeInTheDocument();
  });

  test('"Sugerido pela IA" na linha do motivo sugerido', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r2" />);
    expect(screen.getByRole('radio', { name: 'Pagamento - sem conexão' })).toHaveAccessibleDescription(/Sugerido pela IA/);
  });

  test('sugestão fora da lista não pré-seleciona nada (ATD-ENC-09)', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r-sumiu" />);
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toBeDisabled();
    expect(screen.queryByText('Sugerido pela IA')).not.toBeInTheDocument();
  });

  test('ocupado: "Encerrando…", ESC e Cancelar não fecham, a escolha não troca', async () => {
    let terminar;
    const onConfirm = vi.fn(() => new Promise((r) => { terminar = r; }));
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Troca de senha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar atendimento' }));
    expect(screen.getByRole('button', { name: 'Encerrando…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Pagamento - sem conexão' })).toBeDisabled();
    terminar();
  });

  test('erro de carga com "Tentar de novo"', async () => {
    const refresh = vi.fn();
    useReasons.mockReturnValue({ reasons: [], status: 'error', loading: false, refresh });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('vazio: o caminho real do menu e o botão travado', () => {
    useReasons.mockReturnValue({ reasons: [], status: 'ready', loading: false, refresh: vi.fn() });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Configurações → Cadastros auxiliares → Motivos de atendimento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toBeDisabled();
  });
```

(`within` entra no import de `@testing-library/react`. Os outros testes do arquivo — rádios listados, botão desabilitado sem motivo, `onConfirm` com o id, erro em linha mantendo o modal, Cancelar, vazio desabilitado, carregando sem a frase do vazio, pré-seleção da IA, sem sugestão, troca da pré-seleção — continuam. O de erro em linha passa a achar o erro por `getByRole('alert')` se hoje procura pela classe do `WaError`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/closeReasonCatalog.test.jsx src/components/CloseReasonModal.test.jsx`
Expected: FAIL nos novos.

- [ ] **Step 3: Reescrever o catálogo**

`frontend/src/components/closeReasonCatalog.jsx` inteiro:

```jsx
import {
  IconCancel,
  IconChatSlash,
  IconHeadset,
  IconKey,
  IconMoney,
  IconPin,
  IconPower,
  IconRobot,
  IconTag,
  IconWrench,
} from './icons/IconesTrabalho';

// Ícone e legenda de cada motivo, casados pelo NOME cadastrado (os motivos vêm
// do banco sem ícone): motivo novo precisa entrar aqui para ter ícone próprio;
// sem entrada, cai no ícone neutro. Sem cor (spec P2: cor categórica só em
// gráfico) — o ícone vai em tinta-2.
//
// Legenda só onde ela ACRESCENTA ao nome (decisão 8 do proprietário, 24/09):
// as outras sete eram paráfrase ("Troca de senha" → "Alteração de senha do
// cliente"). O campo continua aceitando legenda para motivo futuro.
const CATALOG = {
  cancelamento: { Icone: IconCancel, hint: null },
  financeiro: { Icone: IconMoney, hint: 'Boletos, pagamentos, faturas' },
  instalacao: { Icone: IconWrench, hint: null },
  'mudanca de endereco': { Icone: IconPin, hint: null },
  reativacao: { Icone: IconPower, hint: null },
  'resolvido pela ia': { Icone: IconRobot, hint: null },
  'sem resposta': { Icone: IconChatSlash, hint: null },
  'suporte tecnico': { Icone: IconHeadset, hint: 'Dúvidas, problemas técnicos' },
  'troca de senha': { Icone: IconKey, hint: null },
};

export function normalizeReasonName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Nome cadastrado diferente do catálogo (ex.: "Suporte", "Senha", "Endereço")
// ainda acha o ícone certo pela palavra-chave. Ordem importa: a primeira que
// bater vence.
const ALIASES = [
  ['cancel', 'cancelamento'],
  ['financ', 'financeiro'],
  ['boleto', 'financeiro'],
  ['pagamento', 'financeiro'],
  ['fatura', 'financeiro'],
  ['instal', 'instalacao'],
  ['endereco', 'mudanca de endereco'],
  ['mudanca', 'mudanca de endereco'],
  ['reativ', 'reativacao'],
  [' ia', 'resolvido pela ia'],
  ['sem resposta', 'sem resposta'],
  ['nao respondeu', 'sem resposta'],
  ['suporte', 'suporte tecnico'],
  ['tecnic', 'suporte tecnico'],
  ['senha', 'troca de senha'],
];

function findEntry(name) {
  const key = normalizeReasonName(name);
  if (CATALOG[key]) return CATALOG[key];
  const padded = ` ${key} `;
  const alias = ALIASES.find(([needle]) => padded.includes(needle));
  return alias ? CATALOG[alias[1]] : null;
}

export function describeReason(name) {
  const entry = findEntry(name);
  return entry ? { Icone: entry.Icone, hint: entry.hint } : { Icone: IconTag, hint: null };
}
```

(O `[\u0300-\u036f]` escrito por escape: no arquivo de hoje a faixa está com os caracteres combinantes literais, invisíveis no editor. `closeReasonHeaderIcon`, `checkCircleIcon`, `TONES` e os SVGs próprios saem.)

- [ ] **Step 4: Reescrever o diálogo**

`frontend/src/components/CloseReasonModal.jsx` inteiro:

```jsx
import { useId, useState } from 'react';
import { useReasons } from '../hooks/useReasons';
import { AsyncState, Button, ListaDeEscolha } from './ui';
import { Dialog, DialogBody, DialogFooter } from './ui/Dialog';
import { describeReason } from './closeReasonCatalog';
import { descreverErro } from '../utils/errorMessages';
import { IconSpark } from './icons/IconesTrabalho';

const CONSEQUENCIA = 'O cliente recebe a mensagem de encerramento e o motivo alimenta o Relatório.';

function CloseReasonModal({ onConfirm, onClose, suggestedReasonId }) {
  const { reasons, status, refresh } = useReasons();
  // A sugestão da IA só vale se o motivo ainda está na lista: um id que sumiu
  // deixava o botão habilitado com um motivo que ninguém via (ATD-ENC-09).
  const sugestaoValida = Boolean(suggestedReasonId) && reasons.some((r) => r.id === suggestedReasonId);
  // O modal monta do zero a cada abertura; a lista pode chegar depois do
  // primeiro render, então a pré-seleção é derivada até alguém escolher.
  const [escolhido, setEscolhido] = useState(null);
  const reasonId = escolhido ?? (sugestaoValida ? suggestedReasonId : null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const motivoId = useId();

  async function handleConfirm() {
    if (!reasonId) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(reasonId);
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível encerrar este atendimento.'));
      setSubmitting(false);
    }
  }

  const opcoes = reasons.map((reason) => {
    const { Icone, hint } = describeReason(reason.name);
    const sugerido = sugestaoValida && reason.id === suggestedReasonId;
    const detalhe = hint || sugerido ? (
      <>
        {hint}
        {hint && sugerido ? ' · ' : null}
        {sugerido ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-flex"><IconSpark size={12} /></span>
            Sugerido pela IA
          </span>
        ) : null}
      </>
    ) : undefined;
    return { valor: reason.id, titulo: reason.name, detalhe, icone: <Icone size={20} /> };
  });

  return (
    <Dialog
      variant="close-reason"
      title="Encerrar atendimento"
      onClose={onClose}
      size="max-w-[640px]"
      dismissible={false}
      ocupado={submitting}
    >
      <DialogBody>
        <AsyncState
          status={status}
          isEmpty={reasons.length === 0}
          onRetry={refresh}
          emptyMessage="Nenhum motivo de contato cadastrado ainda. Peça a um administrador para cadastrar ao menos um motivo em Configurações → Cadastros auxiliares → Motivos de atendimento antes de encerrar este atendimento."
        >
          <ListaDeEscolha
            legenda="Motivo do contato"
            nome="close-reason"
            opcoes={opcoes}
            valor={reasonId}
            aoEscolher={setEscolhido}
            desabilitada={submitting}
            colunas={2}
          />
        </AsyncState>
      </DialogBody>
      <DialogFooter
        nota={CONSEQUENCIA}
        motivo={reasonId ? null : 'Escolha o motivo do contato.'}
        motivoId={motivoId}
        erro={error}
      >
        <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
        <Button
          variant="danger"
          onClick={handleConfirm}
          disabled={!reasonId}
          loading={submitting}
          aria-describedby={reasonId ? undefined : motivoId}
        >
          {submitting ? 'Encerrando…' : 'Encerrar atendimento'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default CloseReasonModal;
```

(`AsyncState` já aceita `onRetry` — é o "Tentar de novo" do erro; `ListaDeEscolha` exportada pelo barril na E2.2. O `Button` com `loading` fica `disabled` e `aria-busy`. O `IconSpark` é o ícone da IA do produto — o mesmo da bolha.)

Em `overlays.css`, apagar as regras de `[data-dialog=close-reason]` (conferir com `grep -n "close-reason" src/components/overlays.css`).

- [ ] **Step 5: Rodar e ver passar; e o encerramento dentro da conversa**

Run: `cd frontend && npx vitest run src/components/closeReasonCatalog.test.jsx src/components/CloseReasonModal.test.jsx src/components/ConversationView src/components/ConversationModal.test.jsx`
Expected: PASS — os testes de encerramento da `ConversationView` acham "Encerrar atendimento" pelo nome.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/closeReasonCatalog.jsx frontend/src/components/closeReasonCatalog.test.jsx frontend/src/components/CloseReasonModal.jsx frontend/src/components/CloseReasonModal.test.jsx frontend/src/components/overlays.css
git commit -m "E2.5: Encerrar em linha-radio, duas legendas, sugestao da IA assinada e perigo no botao final"
```

---

### Task 2: Transferir — 480 px, número de atendimentos e "Carga alta"

**Files:**
- Rewrite: `frontend/src/components/TransferModal.jsx`; Modify: `frontend/src/components/TransferModal.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx` (`nomeDoCliente`, `onTransferido`)
- Modify: `frontend/src/components/overlays.css` (saem `.dialog-transfer-*` e `[data-dialog=transfer]`)

Apêndice E.2 e `grupo-A.md` §2: 760 → **480 px**; a linha de 9 elementos e 5 cores vira **2 linhas e 4 elementos** — avatar 36 com ponto de presença **por forma** (cheio = online, vazado = offline, em tinta), nome, "N atendimentos" (+ "· Carga alta" com ícone de aviso a partir de 10 — **decisão 7**), marca de rádio; saem pílula, divisória, ícone de conversa, dica e 2ª pílula; sai a descrição e o ícone do cabeçalho; barra de 36 px com "Ordenar por" numa linha (valor visível, nome acessível mantido); grupos "Online"/"Offline" (sai "Disponíveis", que colidia com o nível); **a escolha sobrevive à busca** (fixada acima dos grupos quando a busca a esconde); nota do rodapé "Escolha quem vai receber o atendimento." enquanto falta, e com escolhido **offline** acrescenta "{Nome} está offline agora."; esqueleto na forma da linha; erro na região fixa; ocupado com "Transferindo…" e linhas desabilitadas; `onRetry={refresh}`. No sucesso, a mesa mostra "Atendimento de {cliente} transferido para {Nome}." (E.3).

- [ ] **Step 1: Escrever/atualizar os testes**

Em `TransferModal.test.jsx`, o import passa a `import TransferModal, { descreverCarga, CARGA_ALTA } from './TransferModal';` e `useAgents.mockReturnValue` ganha `refresh: vi.fn()` no `beforeEach`. "mostra nome, chip de carga e contagem de atendimentos por atendente" passa a:

```jsx
  test('linha de 2 linhas: nome; número de atendimentos e, a partir de 10, "Carga alta" (decisão 7)', () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'Agnieska Amorim', email: 'a@dw.com', activeConversations: 0 },
        { id: 'agent-3', name: 'Pedro Henrique', email: 'p@dw.com', activeConversations: 15 },
        { id: 'agent-4', name: 'Berg', email: 'b@dw.com', activeConversations: 1 },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Agnieska Amorim' })).toHaveAccessibleDescription('online, 0 atendimentos');
    expect(screen.getByRole('radio', { name: 'Pedro Henrique' })).toHaveAccessibleDescription('online, 15 atendimentos, carga alta');
    expect(screen.getByRole('radio', { name: 'Berg' })).toHaveAccessibleDescription('offline, 1 atendimento');
    expect(screen.getAllByText('Carga alta')).toHaveLength(1);
    for (const sumiu of ['Disponível', 'Em atendimento', 'Movimentado', 'Atendendo normalmente', 'Alta carga de atendimentos', 'Não está disponível no momento']) {
      expect(screen.queryByText(sumiu)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('radiogroup', { name: 'Online 2' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Offline 1' })).toBeInTheDocument();
    expect(screen.queryByText(/Disponíveis/)).not.toBeInTheDocument();
  });
```

"ordena por menor carga (online primeiro) e, se pedido, por nome" troca o leitor de nomes por um seletor estável:

```jsx
    const names = () => screen.getAllByRole('radio').map((r) => r.closest('label').querySelector('[data-nome]').textContent);
```

"selecting an agent transfers the conversation and closes the modal" (e os outros que clicam um atendente) passam a clicar o rádio pelo nome (`getByRole('radio', { name: … })`) e o botão `/transferir para/i`. E, no fim do `describe('TransferModal')`:

```jsx
  test('diálogo de ação: sem ×, sem descrição, sem ícone de cabeçalho', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    const dialogo = screen.getByRole('dialog', { name: 'Transferir atendimento' });
    expect(within(dialogo).queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    expect(dialogo).not.toHaveAccessibleDescription();
  });

  test('sem escolha, a nota diz o que falta; escolhido offline, avisa', async () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Transferir' })).toHaveAccessibleDescription('Escolha quem vai receber o atendimento.');
    await userEvent.click(screen.getByRole('radio', { name: 'other@dw.com' }));
    expect(screen.getByText(/other@dw\.com está offline agora\./)).toBeInTheDocument();
  });

  test('a escolha sobrevive à busca que a esconderia (ATD-TRF-20)', async () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'Pedro', email: 'p@dw.com' },
        { id: 'agent-3', name: 'Ana', email: 'a@dw.com' },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Pedro' }));
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar atendente/i }), 'ana');
    expect(screen.getByRole('radio', { name: 'Pedro' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Transferir para Pedro' })).toBeEnabled();
  });

  test('ocupado: "Transferindo…", ESC e Cancelar não fecham, as linhas não trocam', async () => {
    let terminar;
    api.transferConversation.mockReturnValue(new Promise((r) => { terminar = r; }));
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('radio', { name: 'other@dw.com' }));
    await userEvent.click(screen.getByRole('button', { name: /transferir para/i }));
    expect(screen.getByRole('button', { name: 'Transferindo…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'other@dw.com' })).toBeDisabled();
    terminar({});
  });

  test('sucesso avisa a mesa com o cliente e o destino', async () => {
    api.transferConversation.mockResolvedValue({});
    const onTransferido = vi.fn();
    useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Eu' }, { id: 'agent-2', name: 'Pedro Henrique' }], status: 'ready', refresh: vi.fn() });
    render(<TransferModal conversationId="c1" nomeDoCliente="Maria" onClose={vi.fn()} onTransferido={onTransferido} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Pedro Henrique' }));
    await userEvent.click(screen.getByRole('button', { name: 'Transferir para Pedro' }));
    await waitFor(() => expect(onTransferido).toHaveBeenCalledWith('Atendimento de Maria transferido para Pedro Henrique.'));
  });

  test('erro de carga com "Tentar de novo"', async () => {
    const refresh = vi.fn();
    useAgents.mockReturnValue({ agents: [], status: 'error', refresh });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
```

O `describe('loadLevel')` vira:

```jsx
describe('descreverCarga (decisão 7)', () => {
  test('número por extenso, singular e plural', () => {
    expect(descreverCarga({ online: true, active: 0 }).numero).toBe('0 atendimentos');
    expect(descreverCarga({ online: true, active: 1 }).numero).toBe('1 atendimento');
  });

  test('carga alta a partir de 10, online ou não', () => {
    expect(CARGA_ALTA).toBe(10);
    expect(descreverCarga({ online: true, active: 9 }).alta).toBe(false);
    expect(descreverCarga({ online: true, active: 10 }).alta).toBe(true);
    expect(descreverCarga({ online: false, active: 12 }).alta).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/TransferModal.test.jsx`
Expected: FAIL — `descreverCarga` não existe; linhas com 9 elementos.

- [ ] **Step 3: Reescrever o diálogo**

`frontend/src/components/TransferModal.jsx` inteiro:

```jsx
import { useId, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { transferConversation } from '../services/api';
import AgentAvatar from './AgentAvatar';
import { AsyncState, Button, ListaDeEscolha } from './ui';
import { Dialog, DialogBody, DialogFooter } from './ui/Dialog';
import { IconChevronDown, IconSearch, IconWarning } from './icons/IconesTrabalho';
import { descreverErro } from '../utils/errorMessages';

// Decisão 7 do proprietário (24/09): o número é o dado; a partir de 10 abertos
// o atendente ganha "Carga alta" para desencorajar mais uma transferência. Os
// outros níveis ("Disponível", "Em atendimento", "Movimentado") saíram —
// "Em atendimento" colidia com o nome do estado da conversa.
export const CARGA_ALTA = 10;

export function descreverCarga({ active }) {
  return {
    numero: `${active} ${active === 1 ? 'atendimento' : 'atendimentos'}`,
    alta: active >= CARGA_ALTA,
  };
}

const SORTS = [
  { key: 'load', label: 'Menor carga' },
  { key: 'name', label: 'Nome' },
];

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function nomeDe(a) {
  return a.name || a.email;
}

// Só o primeiro nome no botão: o nome inteiro estourava o rodapé em telas
// estreitas. O nome completo continua na linha escolhida.
function primeiroNomeDe(a) {
  const partes = String(nomeDe(a) || '').trim().split(/\s+/).filter(Boolean);
  return partes[0] || 'atendente';
}

// Linha do atendente (2 linhas, 4 elementos). Presença por FORMA (P8): ponto
// cheio online, vazado offline — a cor da carga saiu do ponto. O detalhe
// (lido como descrição do rádio) diz presença, número e carga alta por extenso.
function opcaoDoAtendente(a, online) {
  const active = a.activeConversations || 0;
  const carga = descreverCarga({ active });
  return {
    valor: a.id,
    titulo: <span data-nome="">{nomeDe(a)}</span>,
    icone: (
      <span className="relative inline-flex">
        <AgentAvatar agentId={a.id} avatarPath={a.avatarPath} name={nomeDe(a)} size={36} />
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-elevado ${online ? 'bg-tinta-2' : 'bg-elevado ring-2 ring-inset ring-tinta-3'}`} />
      </span>
    ),
    // A descrição do rádio vem de UM texto só-leitura, inteiro: "online, 15
    // atendimentos, carga alta"; a parte visível fica toda aria-hidden. Em
    // pedaços, cada elemento ganhava espaço em volta e saía "15 atendimentos ,
    // carga alta" (prova em cópia, 24/09/2026).
    detalhe: (
      <>
        <span className="sr-only">{`${online ? 'online' : 'offline'}, ${carga.numero}${carga.alta ? ', carga alta' : ''}`}</span>
        <span aria-hidden="true">
          {carga.numero}
          {carga.alta ? (
            <span className="text-aviso">
              {' · '}
              <span className="inline-flex align-[-2px]"><IconWarning size={14} /></span> <span>Carga alta</span>
            </span>
          ) : null}
        </span>
      </>
    ),
  };
}

// Título do grupo com a contagem: é a legenda visível da própria lista, então
// também é o nome do radiogroup ("Online 3").
function legendaDoGrupo(titulo, total) {
  return (
    <>
      {titulo} <span className="tabular-nums text-tinta-3">{total}</span>
    </>
  );
}

function TransferModal({ conversationId, nomeDoCliente, onClose, onTransferido }) {
  const { token, agent } = useAuth();
  const { agents: allAgents, status, refresh } = useAgents();
  const onlineIds = usePresence(allAgents);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('load');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [escolhido, setEscolhido] = useState(null);
  const motivoId = useId();

  const isOnline = (a) => onlineIds.has(a.id);
  const outros = allAgents.filter((a) => a.id !== agent.id);
  const query = normalize(search.trim());
  const visiveis = outros
    .filter((a) => !query || normalize(nomeDe(a)).includes(query))
    .sort((a, b) => {
      const nameOrder = String(nomeDe(a)).localeCompare(String(nomeDe(b)));
      if (sort === 'name') return nameOrder;
      // Menor carga: online antes de offline, depois menos atendimentos, depois nome.
      if (isOnline(a) !== isOnline(b)) return isOnline(a) ? -1 : 1;
      const loadOrder = (a.activeConversations || 0) - (b.activeConversations || 0);
      return loadOrder || nameOrder;
    });

  // A escolha vem da lista INTEIRA, não da filtrada: a busca não pode apagar o
  // que a pessoa escolheu (ATD-TRF-20). Escondida pela busca, a linha dela
  // fica fixada acima dos grupos.
  const escolhidoAgora = outros.find((a) => a.id === escolhido) || null;
  const escolhidoEscondido = escolhidoAgora && !visiveis.includes(escolhidoAgora);

  // Agrupar é a ordem "Menor carga". Pedir "Nome" é pedir lista alfabética:
  // agrupar ali quebraria a ordem que a pessoa acabou de escolher.
  const agrupar = sort !== 'name';
  const online = agrupar ? visiveis.filter(isOnline) : visiveis;
  const offline = agrupar ? visiveis.filter((a) => !isOnline(a)) : [];

  async function transferir() {
    if (!escolhidoAgora) return;
    setError(null);
    setEnviando(true);
    try {
      await transferConversation(conversationId, escolhidoAgora.id, token);
      if (onTransferido && nomeDoCliente) onTransferido(`Atendimento de ${nomeDoCliente} transferido para ${nomeDe(escolhidoAgora)}.`);
      onClose();
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível transferir este atendimento.'));
      setEnviando(false);
    }
  }

  const lista = (atendentes, legenda, legendaVisivel = true) => (
    <ListaDeEscolha
      legenda={legenda}
      legendaVisivel={legendaVisivel}
      className="mb-3 last:mb-0"
      nome="transfer-agent"
      opcoes={atendentes.map((a) => opcaoDoAtendente(a, isOnline(a)))}
      valor={escolhido}
      aoEscolher={setEscolhido}
      desabilitada={enviando}
    />
  );

  const nota = escolhidoAgora && !isOnline(escolhidoAgora)
    ? `A transferência fica registrada no histórico. ${primeiroNomeDe(escolhidoAgora)} está offline agora.`
    : 'A transferência fica registrada no histórico.';

  return (
    <Dialog variant="transfer" title="Transferir atendimento" onClose={onClose} size="max-w-[480px]" dismissible={false} ocupado={enviando}>
      <div className="flex shrink-0 gap-2 px-6 pb-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-ui-md bg-campo px-3 focus-within:outline focus-within:outline-2 focus-within:outline-focus-ring">
          <span aria-hidden="true" className="text-tinta-3"><IconSearch size={16} /></span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar atendente…"
            aria-label="Buscar atendente por nome"
            className="min-w-0 flex-1 bg-transparent text-corpo text-tinta outline-none placeholder:text-tinta-3"
          />
        </label>
        <label className="relative flex h-9 shrink-0 items-center rounded-ui-md bg-campo pl-3 pr-8 focus-within:outline focus-within:outline-2 focus-within:outline-focus-ring">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Ordenar por"
            className="cursor-pointer appearance-none bg-transparent text-corpo font-medium text-tinta outline-none"
          >
            {SORTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <span aria-hidden="true" className="pointer-events-none absolute right-2 text-tinta-2"><IconChevronDown size={16} /></span>
        </label>
      </div>
      <DialogBody className="pt-1">
        <AsyncState status={status} isEmpty={outros.length === 0} onRetry={refresh} esqueleto="linhas" emptyMessage="Nenhum outro atendente disponível.">
          {escolhidoEscondido ? lista([escolhidoAgora], 'Escolhido') : null}
          {visiveis.length === 0 ? (
            <p className="px-1 py-4 text-center text-rotulo text-tinta-2">Nenhum atendente encontrado com esse nome.</p>
          ) : agrupar ? (
            <>
              {online.length > 0 ? lista(online, legendaDoGrupo('Online', online.length)) : null}
              {offline.length > 0 ? lista(offline, legendaDoGrupo('Offline', offline.length)) : null}
            </>
          ) : (
            lista(visiveis, 'Atendentes', false)
          )}
        </AsyncState>
      </DialogBody>
      <DialogFooter nota={nota} motivo={escolhidoAgora ? null : 'Escolha quem vai receber o atendimento.'} motivoId={motivoId} erro={error}>
        <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button onClick={transferir} disabled={!escolhidoAgora} loading={enviando} aria-describedby={escolhidoAgora ? undefined : motivoId}>
          {enviando ? 'Transferindo…' : escolhidoAgora ? `Transferir para ${primeiroNomeDe(escolhidoAgora)}` : 'Transferir'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default TransferModal;
```

Três observações de desenho:

- Cada grupo é um `radiogroup` próprio da `ListaDeEscolha` com o mesmo `name` — o navegador trata os rádios de mesmo `name` como um grupo só para as setas e a marcação —, e o título visível do grupo com a contagem é a legenda da lista, portanto o nome do `radiogroup` ("Online 3"). O rádio escondido pela busca, fixado no topo, entra num grupo "Escolhido".
- A nota do escolhido offline usa o **primeiro nome** (o mesmo do botão); sem nome cadastrado, o "primeiro nome" é o e-mail inteiro, como no botão de hoje.
- `esqueleto="linhas"` é a prop da E2.3 (Task 6) no `AsyncState`.

Em `overlays.css`, apagar `.dialog-transfer-linha`, `.dialog-transfer-marca`, `.dialog-transfer-grupo` e as regras de `[data-dialog=transfer]` (conferir com `grep -n "transfer" src/components/overlays.css`).

- [ ] **Step 4: Ligar a confirmação na mesa**

Em `DashboardPage.jsx` (`:315`), o `TransferModal` recebe o nome do cliente e o aviso da mesa (`avisarNaMesa` da E2.3, Task 9):

```jsx
      {transferringId && (
        <TransferModal
          conversationId={transferringId}
          nomeDoCliente={nomeDoClienteEmTransferencia}
          onTransferido={avisarNaMesa}
          onClose={() => setTransferringId(null)}
        />
      )}
```

com, perto de onde `transferringId` é declarado:

```jsx
  // O Transferir não conhece a conversa, só o id; o nome sai das listas da mesa.
  const conversaEmTransferencia = transferringId ? [...queue, ...myConversations].find((c) => c.id === transferringId) : null;
  const nomeDoClienteEmTransferencia = conversaEmTransferencia
    ? conversaEmTransferencia.contactDisplayName || conversaEmTransferencia.contactPhoneNumber || 'cliente'
    : undefined;
```

(A Supervisão continua sem `onTransferido`: a mesa vazia é da mesa. `queue` e `myConversations` são os nomes das listas na `DashboardPage` (`:48-49`), os mesmos que o `selectedConversation` já usa (`:115-117`); a E2.3 não os renomeia.)

Em `DashboardPage.test.jsx` — que não testa o Transferir por dentro (o `useAgents` do arquivo é simulado com lista vazia) —, simular o diálogo e provar a ligação. No topo, junto dos outros `vi.mock`:

```jsx
// O Transferir tem os próprios testes; aqui só importa o que a mesa passa a ele
// e o que ela faz quando ele avisa.
vi.mock('../components/TransferModal', () => ({
  default: ({ nomeDoCliente, onTransferido, onClose }) => (
    <button type="button" onClick={() => { onTransferido(`Atendimento de ${nomeDoCliente} transferido para Pedro.`); onClose(); }}>
      confirmar transferência
    </button>
  ),
}));
```

e o teste:

```jsx
  test('transferir: o nome do cliente vai ao diálogo e a mesa vazia confirma (E.3)', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria', status: 'assigned', assignedAgentId: 'agent-1' }], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByText('Maria'));
    await userEvent.click(screen.getByRole('button', { name: 'Transferir atendimento' }));
    // Como o socket faz de verdade: a conversa transferida sai de "Meus". O
    // onClose do diálogo re-renderiza a mesa, que então fica vazia.
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    await userEvent.click(screen.getByRole('button', { name: 'confirmar transferência' }));
    expect(await screen.findByText('Atendimento de Maria transferido para Pedro.')).toBeInTheDocument();
  });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/TransferModal.test.jsx src/pages/DashboardPage.test.jsx src/pages/SupervisionPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TransferModal.jsx frontend/src/components/TransferModal.test.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/components/overlays.css
git commit -m "E2.5: Transferir em 480 px com numero de atendimentos, carga alta e escolha que sobrevive a busca"
```

---

### Task 3: Escolha de template compartilhada e Enviar template

**Files:**
- Create: `frontend/src/components/EscolhaDeTemplate.jsx`, `frontend/src/components/EscolhaDeTemplate.test.jsx`
- Rewrite: `frontend/src/components/SendTemplateModal.jsx`; Modify: `frontend/src/components/SendTemplateModal.test.jsx`
- Modify: `frontend/src/components/overlays.css` (saem `.dialog-send-template*`, `.dialog-template-compose` e o `@media(max-width:680px)` deles)

Apêndice E.1-12 e `grupo-A.md` §5: a mesma tarefa (mandar um template a um cliente) tinha duas telas — `<select>` sem o texto no Iniciar, lista + prévia no Enviar. Passa a um componente só: **lista de escolha** (nome + 1ª linha do corpo), **variáveis**, **prévia** como bolha de saída com os botões em tinta neutra, e a explicação do que o botão faz (cada tela dá a sua). Enviar template: 864 → **576 px**, uma coluna (acaba a metade vazia); o texto do template aparece **uma vez** (na prévia); diálogo de ação, sem ×; **descrição conforme o aviso que abriu** (prop `motivo` da E2.4 Task 7 — hoje é falsa quando vem do aviso "indeterminada", CV-TPL-01); nota do rodapé com o que falta ("Escolha um template." / "Preencha a Variável 2."); carregando com esqueleto, erro com "Tentar de novo", vazio com o caminho real do menu; sem `channelId`, erro em vez de carga eterna (CV-TPL-02); ocupado com "Enviando…" e lista/campos travados (CV-TPL-15). **Pré-seleção:** o Enviar template continua sem pré-selecionar e o Iniciar continua pré-selecionando o 1º — quem decide é quem usa o componente (`grupo-A.md` §5.5: não unificar em silêncio).

**Interfaces:**
- Produces: `EscolhaDeTemplate({ templates, status, erro?, onTentarDeNovo, valor, aoEscolher, variaveis, aoMudarVariavel, desabilitada?, vazio: node, ajuda?: string, explicarBotoes?: (temBotao) => string|null })` e `faltaParaEnviar(template, variaveis) → string|null`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/components/EscolhaDeTemplate.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EscolhaDeTemplate, { faltaParaEnviar } from './EscolhaDeTemplate';

const T1 = { id: 't1', name: 'confirmar_visita', bodyText: 'Olá {{1}}, podemos agendar para {{2}}?\nResponda por aqui.', variableCount: 2, buttons: [] };
const T2 = { id: 't2', name: 'agendar_botao', bodyText: 'Podemos agendar?', variableCount: 0, buttons: ['Sim', 'Outro dia'] };

function Montado({ inicial = null, ...props }) {
  const [valor, setValor] = useState(inicial);
  const [variaveis, setVariaveis] = useState(inicial === 't1' ? ['', ''] : []);
  return (
    <EscolhaDeTemplate
      templates={[T1, T2]}
      status="ready"
      onTentarDeNovo={vi.fn()}
      valor={valor}
      aoEscolher={(id) => { setValor(id); setVariaveis(Array([T1, T2].find((t) => t.id === id).variableCount).fill('')); }}
      variaveis={variaveis}
      aoMudarVariavel={(i, texto) => setVariaveis((v) => v.map((x, j) => (j === i ? texto : x)))}
      vazio="Nenhum template."
      explicarBotoes={(temBotao) => (temBotao ? 'Com botão.' : 'Sem botão.')}
      {...props}
    />
  );
}

describe('escolha de template (E.1-12)', () => {
  test('lista de escolha única: nome e só a 1ª linha do corpo', () => {
    render(<Montado />);
    expect(screen.getByRole('radiogroup', { name: 'Template' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'confirmar_visita' })).toHaveAccessibleDescription('Olá {{1}}, podemos agendar para {{2}}?');
  });

  test('o texto inteiro aparece uma vez só, na prévia, com as variáveis trocadas', async () => {
    render(<Montado />);
    await userEvent.click(screen.getByRole('radio', { name: 'confirmar_visita' }));
    await userEvent.type(screen.getByLabelText('Variável 1'), 'Maria');
    const previa = within(screen.getByRole('group', { name: 'Prévia da mensagem' }));
    expect(previa.getByText(/Olá Maria, podemos agendar para \{\{2\}\}\?/)).toBeInTheDocument();
    expect(screen.getAllByText(/Responda por aqui\./)).toHaveLength(1);
  });

  test('botões na prévia em tinta neutra e a explicação de quem usa', async () => {
    render(<Montado />);
    await userEvent.click(screen.getByRole('radio', { name: 'agendar_botao' }));
    const previa = screen.getByRole('group', { name: 'Prévia da mensagem' });
    expect(within(previa).getByText('Sim').className).not.toMatch(/53bdeb|accent/);
    expect(within(previa).getByText('Com botão.')).toBeInTheDocument();
  });

  test('carregando, erro com "Tentar de novo" e vazio', async () => {
    const onTentarDeNovo = vi.fn();
    const { rerender } = render(<EscolhaDeTemplate templates={[]} status="loading" onTentarDeNovo={onTentarDeNovo} valor={null} aoEscolher={vi.fn()} variaveis={[]} aoMudarVariavel={vi.fn()} vazio="Nenhum template." />);
    expect(screen.queryByText('Nenhum template.')).not.toBeInTheDocument();
    rerender(<EscolhaDeTemplate templates={[]} status="error" erro="Não foi possível carregar os templates." onTentarDeNovo={onTentarDeNovo} valor={null} aoEscolher={vi.fn()} variaveis={[]} aoMudarVariavel={vi.fn()} vazio="Nenhum template." />);
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(onTentarDeNovo).toHaveBeenCalledTimes(1);
    rerender(<EscolhaDeTemplate templates={[]} status="ready" onTentarDeNovo={onTentarDeNovo} valor={null} aoEscolher={vi.fn()} variaveis={[]} aoMudarVariavel={vi.fn()} vazio="Nenhum template." />);
    expect(screen.getByText('Nenhum template.')).toBeInTheDocument();
  });

  test('desabilitada trava lista e variáveis', () => {
    render(<Montado inicial="t1" desabilitada />);
    expect(screen.getByRole('radio', { name: 'agendar_botao' })).toBeDisabled();
    expect(screen.getByLabelText('Variável 1')).toBeDisabled();
  });
});

describe('faltaParaEnviar', () => {
  test('diz o que falta, na ordem', () => {
    expect(faltaParaEnviar(null, [])).toBe('Escolha um template.');
    expect(faltaParaEnviar(T1, ['Maria', ' '])).toBe('Preencha a Variável 2.');
    expect(faltaParaEnviar(T1, ['Maria', 'terça'])).toBeNull();
    expect(faltaParaEnviar(T2, [])).toBeNull();
  });
});
```

Em `SendTemplateModal.test.jsx`: toda busca `findByRole('button', { name: /aviso_tecnico/ })` (e `confirmar_visita`, `agendar_botao`) passa a `findByRole('radio', { name: … })`. Em "titulo e acoes ficam fora do unico eixo de rolagem", a última linha inverte — diálogo de ação não tem × (E.1-2):

```jsx
    expect(painel.querySelector('[data-dialog-close]')).toBeNull();
```

E, no fim do `describe`:

```jsx
  test('576 px, uma coluna, sem a metade vazia', async () => {
    montar();
    await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[576px\]/);
  });

  test('a descrição segue o aviso que abriu o diálogo (CV-TPL-01)', async () => {
    const { unmount } = montar({ motivo: 'fechada' });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Janela de 24h fechada: só template aprovado é entregue até o cliente responder.');
    unmount();
    montar({ motivo: 'recusada' });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('O WhatsApp recusou uma mensagem fora da janela de 24h: só template aprovado é entregue até o cliente responder.');
    await screen.findByRole('radio', { name: /aviso_tecnico/ });
  });

  test('o rodapé diz o que falta, e o botão aponta para lá', async () => {
    montar();
    await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveAccessibleDescription('Escolha um template.');
    await userEvent.click(screen.getByRole('radio', { name: /confirmar_visita/ }));
    await userEvent.type(screen.getByLabelText('Variável 1'), 'Maria');
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveAccessibleDescription('Preencha a Variável 2.');
  });

  test('vazio com o caminho real do menu e a finalidade', async () => {
    api.listTemplatesForChannel.mockResolvedValue([]);
    montar();
    expect(await screen.findByText(/com a finalidade Atendimento em Configurações → Mensagens → Templates WhatsApp/)).toBeInTheDocument();
  });

  test('sem canal: erro, não "Carregando…" para sempre (CV-TPL-02)', () => {
    montar({ channelId: null });
    expect(screen.getByRole('alert')).toHaveTextContent('Este atendimento está sem canal');
    expect(api.listTemplatesForChannel).not.toHaveBeenCalled();
  });

  test('erro de carga com "Tentar de novo"', async () => {
    api.listTemplatesForChannel.mockRejectedValueOnce(new Error('rede'));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));
    expect(await screen.findByRole('radio', { name: /aviso_tecnico/ })).toBeInTheDocument();
  });

  test('ocupado: "Enviando…", ESC e Cancelar não fecham, a lista não troca (CV-TPL-15)', async () => {
    let terminar;
    api.sendConversationTemplate.mockReturnValue(new Promise((r) => { terminar = r; }));
    const onClose = vi.fn();
    montar({ onClose });
    await userEvent.click(await screen.findByRole('radio', { name: /aviso_tecnico/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /agendar_botao/ })).toBeDisabled();
    terminar({});
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/EscolhaDeTemplate.test.jsx src/components/SendTemplateModal.test.jsx`
Expected: FAIL — módulo inexistente; itens são `button` com `aria-pressed`.

- [ ] **Step 3: Implementar a escolha de template**

`frontend/src/components/EscolhaDeTemplate.jsx`:

```jsx
import { useId } from 'react';
import { AsyncState, ListaDeEscolha } from './ui';
import { substituirVariaveis } from '../utils/templatePreview';

const CAMPO = 'h-9 w-full rounded-ui-md bg-campo px-3 text-corpo text-tinta outline-none placeholder:text-tinta-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-60';

// O que falta para mandar: o rodapé diz isso no lugar da nota, e o botão aponta
// para a frase (E.1-6). Variável só com espaços conta como vazia — o backend
// recusaria do mesmo jeito.
export function faltaParaEnviar(template, variaveis) {
  if (!template) return 'Escolha um template.';
  const vazia = variaveis.findIndex((valor) => !String(valor || '').trim());
  return vazia === -1 ? null : `Preencha a Variável ${vazia + 1}.`;
}

function primeiraLinha(texto) {
  return String(texto || '').split('\n')[0] || undefined;
}

// A mesma escolha de template no Iniciar conversa e no Enviar template (E.1-12):
// lista (nome + 1ª linha), variáveis e prévia. O texto inteiro aparece uma vez
// só, na prévia — como bolha de saída, que é o que o cliente recebe. Quem usa
// decide a pré-seleção, a ajuda e a explicação dos botões.
function EscolhaDeTemplate({
  templates,
  status,
  erro,
  onTentarDeNovo,
  valor,
  aoEscolher,
  variaveis,
  aoMudarVariavel,
  desabilitada = false,
  vazio,
  ajuda,
  explicarBotoes,
}) {
  const id = useId();
  const escolhido = templates.find((t) => t.id === valor) || null;
  const botoes = (escolhido && escolhido.buttons) || [];
  const explicacao = escolhido && explicarBotoes ? explicarBotoes(botoes.length > 0) : null;

  return (
    <div className="@container space-y-4">
      <div>
        {/* O nome do grupo é a legenda (invisível) da lista; este é o título
            que se vê, e continua lá quando a lista ainda não existe. */}
        <p aria-hidden="true" className="text-rotulo font-medium text-tinta-2">Template</p>
        {ajuda ? <p className="mt-0.5 text-rotulo text-tinta-2">{ajuda}</p> : null}
        <div className="mt-2">
          <AsyncState
            status={status}
            error={erro}
            isEmpty={templates.length === 0}
            onRetry={onTentarDeNovo}
            emptyMessage={vazio}
            esqueleto="linhas"
            skeletonLines={3}
          >
            <ListaDeEscolha
              legenda="Template"
              legendaVisivel={false}
              nome={`${id}-template`}
              opcoes={templates.map((t) => ({ valor: t.id, titulo: t.name, detalhe: primeiraLinha(t.bodyText) }))}
              valor={valor}
              aoEscolher={aoEscolher}
              desabilitada={desabilitada}
            />
          </AsyncState>
        </div>
      </div>

      {escolhido && variaveis.length > 0 ? (
        <div className="grid gap-3 @min-[420px]:grid-cols-2">
          {variaveis.map((texto, i) => (
            <div key={i}>
              <label htmlFor={`${id}-var-${i}`} className="mb-1 block text-rotulo font-medium text-tinta-2">Variável {i + 1}</label>
              <input id={`${id}-var-${i}`} value={texto} onChange={(e) => aoMudarVariavel(i, e.target.value)} disabled={desabilitada} className={CAMPO} />
            </div>
          ))}
        </div>
      ) : null}

      {/* A prévia existe porque template não dá para corrigir depois: uma
          variável no lugar errado chega assim ao cliente. */}
      {escolhido ? (
        <div role="group" aria-label="Prévia da mensagem">
          <p aria-hidden="true" className="mb-1 text-rotulo font-medium text-tinta-2">Prévia</p>
          <div className="ml-auto max-w-[85%] rounded-ui-md rounded-tr-sm bg-bolha-saida px-3 py-2">
            <p className="whitespace-pre-wrap break-words text-corpo text-tinta">{substituirVariaveis(escolhido.bodyText, variaveis)}</p>
          </div>
          {/* Um template com botão é a única saída de um toque para o cliente
              responder e reabrir a conversa: mostrar os botões diz se dá para
              continuar. */}
          {botoes.map((texto) => (
            <div key={texto} className="ml-auto mt-1 max-w-[85%] rounded-ui-md bg-bolha-saida px-3 py-2 text-center text-corpo font-medium text-tinta">
              {texto}
            </div>
          ))}
          {explicacao ? <p className="mt-2 text-rotulo text-tinta-2">{explicacao}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export default EscolhaDeTemplate;
```

(`esqueleto="linhas"` é a prop do `AsyncState` da E2.3, Task 6.)

- [ ] **Step 4: Reescrever o Enviar template**

`frontend/src/components/SendTemplateModal.jsx` inteiro:

```jsx
import { useCallback, useEffect, useId, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listTemplatesForChannel, sendConversationTemplate } from '../services/api';
import { Button } from './ui';
import { Dialog, DialogBody, DialogFooter } from './ui/Dialog';
import EscolhaDeTemplate, { faltaParaEnviar } from './EscolhaDeTemplate';
import { descreverErro } from '../utils/errorMessages';

// A descrição diz de onde o atendente veio (CV-TPL-01): a frase fixa "a janela
// está fechada" era falsa quando o diálogo abria do aviso "não deu para
// conferir a janela" depois de uma recusa do WhatsApp.
const DESCRICAO = {
  fechada: 'Janela de 24h fechada: só template aprovado é entregue até o cliente responder.',
  recusada: 'O WhatsApp recusou uma mensagem fora da janela de 24h: só template aprovado é entregue até o cliente responder.',
};

// Com a janela de 24h fechada, template aprovado é a única coisa que o WhatsApp
// entrega. Isto não contorna a regra: o texto continua sendo o pré-aprovado,
// com variáveis. A lista pede só os de 'atendimento': template de disparo é do
// SGP e da campanha.
function SendTemplateModal({ conversationId, channelId, motivo = 'fechada', onClose, onSent }) {
  const { token } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [status, setStatus] = useState(channelId ? 'loading' : 'error');
  const [erroDeCarga, setErroDeCarga] = useState(channelId ? null : 'Este atendimento está sem canal: não dá para listar os templates.');
  const [templateId, setTemplateId] = useState(null);
  const [variaveis, setVariaveis] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const motivoId = useId();
  const vazioId = useId();

  const carregar = useCallback(() => {
    // Sem canal a lista não existe: antes ficava "Carregando…" para sempre.
    if (!channelId) return;
    setStatus('loading');
    setErroDeCarga(null);
    listTemplatesForChannel(channelId, token, 'atendimento')
      .then((data) => {
        setTemplates(data);
        setStatus('ready');
      })
      .catch(() => {
        setErroDeCarga('Não foi possível carregar os templates.');
        setStatus('error');
      });
  }, [channelId, token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function escolher(id) {
    const template = templates.find((t) => t.id === id);
    setTemplateId(id);
    setVariaveis(Array.from({ length: template ? template.variableCount : 0 }, () => ''));
    setError(null);
  }

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      await sendConversationTemplate(conversationId, templateId, variaveis, token);
      onSent();
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível enviar o template.'));
      setEnviando(false);
    }
  }

  const escolhido = templates.find((t) => t.id === templateId) || null;
  const semTemplates = status === 'ready' && templates.length === 0;
  const falta = status === 'ready' && !semTemplates ? faltaParaEnviar(escolhido, variaveis) : null;
  const pronto = status === 'ready' && !semTemplates && !falta;

  return (
    <Dialog
      variant="send-template"
      size="max-w-[576px]"
      title="Enviar template"
      description={DESCRICAO[motivo] || DESCRICAO.fechada}
      onClose={onClose}
      dismissible={false}
      // Há variável digitada aqui dentro: não fecha por clique no fundo.
      closeOnBackdrop={false}
      ocupado={enviando}
    >
      <DialogBody>
        <EscolhaDeTemplate
          templates={templates}
          status={status}
          erro={erroDeCarga}
          onTentarDeNovo={channelId ? carregar : undefined}
          valor={templateId}
          aoEscolher={escolher}
          variaveis={variaveis}
          aoMudarVariavel={(i, texto) => setVariaveis((atuais) => atuais.map((v, j) => (j === i ? texto : v)))}
          desabilitada={enviando}
          vazio={
            <span id={vazioId}>
              Nenhum template de atendimento aprovado neste canal. Cadastre um com a finalidade Atendimento em Configurações → Mensagens → Templates WhatsApp.
            </span>
          }
          explicarBotoes={(temBotao) => (temBotao ? 'Se o cliente tocar num botão, a resposta chega no chat e reabre a janela de 24h.' : null)}
        />
      </DialogBody>
      <DialogFooter motivo={falta} motivoId={motivoId} erro={error}>
        <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button onClick={enviar} disabled={!pronto} loading={enviando} aria-describedby={falta ? motivoId : semTemplates ? vazioId : undefined}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default SendTemplateModal;
```

Em `overlays.css`, apagar `.dialog-send-template`, `.dialog-template-compose` (inclusive o `:empty`), `.dialog-send-template-error` e as regras de `[data-dialog=send-template]`, junto com o trecho deles no `@media(max-width:680px)` (conferir com `grep -n "send-template\|template-compose" src/components/overlays.css`).

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/EscolhaDeTemplate.test.jsx src/components/SendTemplateModal.test.jsx src/components/ConversationView.test.jsx`
Expected: PASS — inclusive os da janela de 24 h da `ConversationView`, que abrem o diálogo por "Enviar template".

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EscolhaDeTemplate.jsx frontend/src/components/EscolhaDeTemplate.test.jsx frontend/src/components/SendTemplateModal.jsx frontend/src/components/SendTemplateModal.test.jsx frontend/src/components/overlays.css
git commit -m "E2.5: escolha de template compartilhada; Enviar template em uma coluna com a descricao do aviso que abriu"
```

---

### Task 4: Iniciar conversa — uma coluna, Telefone primeiro

**Files:**
- Rewrite: `frontend/src/components/StartConversationModal.jsx`; Modify: `frontend/src/components/StartConversationModal.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx` (aba Atendimento no sucesso), `frontend/src/pages/DashboardPage.test.jsx`
- Modify: `frontend/src/components/overlays.css` (saem `.dialog-inicio-*` e `[data-dialog=start-conversation]`)

Apêndice E.2 e `grupo-A.md` §1: 768 → **576 px**, uma coluna; ordem **Telefone → Canal → conteúdo** ("para quem, por onde, o quê"), foco inicial no Telefone (hoje caía no País); País e Telefone lado a lado por `@container` (limiar 330 px — o invariante de hoje); canal com uma opção vira **texto**; o estado dos canais é dito **uma vez**, no lugar do campo (sai o 2º `role="status"` do rodapé), e o botão aponta para a frase; saem a faixa "Este canal requer o uso de template…!" e o h3 — a regra vira a ajuda do campo Template; o template pela `EscolhaDeTemplate` (com o texto à vista); o conteúdo só aparece depois que os canais chegam; validação em linha (`noValidate`, erro sob cada campo; mensagem só com espaços dá erro); ajuda do "9" **só em Baileys** (no oficial o número segue como digitado — `src/api/conversations.routes.js:152,179`); erro na região fixa; rodapé sem fundo próprio; cor de aviso deixa de pintar estado normal ("Iniciando…" vai para o botão). Comportamento: ocupado (ATD-INI-26); **resposta de templates de um canal que não é mais o escolhido é descartada** (ATD-INI-27, CLASSE-01); templates com carregando e erro + "Tentar de novo" (ATD-INI-13, -14); canais com "Tentar de novo" (ATD-INI-03); erro do telefone some ao editar (ATD-INI-10); no sucesso a mesa vai para a aba **Atendimento** (ATD-MESA-16: o `/start` já atribui a conversa a quem iniciou).

- [ ] **Step 1: Atualizar e escrever os testes**

Em `StartConversationModal.test.jsx`:

- "shows a message when there is no eligible channel" passa a afirmar a frase **uma vez** e o botão apontando para ela:

```jsx
  test('sem canal elegível: a frase uma vez só, no lugar do campo, e o botão aponta para ela', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('Nenhum canal conectado no momento.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum canal disponível para iniciar.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar conversa' })).toHaveAccessibleDescription('Nenhum canal conectado no momento.');
  });
```

- "shows the template banner and dropdown for a meta_cloud channel" passa a:

```jsx
  test('canal oficial: a regra é ajuda do campo Template, sem faixa nem título', async () => {
    listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' }]);
    listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida', variableCount: 2 }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByRole('radiogroup', { name: 'Template' })).toBeInTheDocument();
    expect(screen.getByText('Canal oficial só inicia conversa com template aprovado.')).toBeInTheDocument();
    expect(screen.queryByText(/requer o uso de template/i)).not.toBeInTheDocument();
  });
```

- "excludes a disconnected baileys channel but still includes a disconnected meta_cloud one": com um canal só, ele vira texto; e o motivo do botão passa a ser a frase do corpo:

```jsx
    await waitFor(() => expect(screen.getByText('Oficial')).toBeInTheDocument());
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Canal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar conversa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Iniciar conversa' })).toHaveAccessibleDescription(/Nenhum template de atendimento aprovado neste canal/);
```

(no lugar das 4 linhas finais de hoje.)

- "shows a distinct error message when the channel fetch fails…" ganha, no fim: `expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();`.

E acrescentar:

```jsx
describe('E2.5: Iniciar conversa em uma coluna', () => {
  const BAILEYS = { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' };
  const OFICIAL_A = { id: 'ch-a', type: 'meta_cloud', name: 'Oficial A', status: 'connected' };
  const OFICIAL_B = { id: 'ch-b', type: 'meta_cloud', name: 'Oficial B', status: 'connected' };

  test('foco inicial no Telefone', async () => {
    api.listChannelsForAgent.mockResolvedValue([BAILEYS]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    expect(screen.getByLabelText('Telefone')).toHaveFocus();
  });

  test('canal único vira texto e ainda envia o channelId', async () => {
    api.listChannelsForAgent.mockResolvedValue([BAILEYS]);
    api.startConversation.mockResolvedValue({ id: 'conv-1' });
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    expect(screen.queryByRole('combobox', { name: 'Canal' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Telefone'), '98999990000');
    await userEvent.type(screen.getByLabelText('Mensagem inicial'), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar conversa' }));
    await waitFor(() => expect(api.startConversation).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'ch-1' }), 'tok-123'));
  });

  test('ajuda do "9" só em Baileys', async () => {
    api.listChannelsForAgent.mockResolvedValue([BAILEYS, OFICIAL_A]);
    api.listTemplatesForChannel.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText(/Com ou sem o 9/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Canal' }), 'ch-a');
    expect(screen.queryByText(/Com ou sem o 9/)).not.toBeInTheDocument();
  });

  test('mensagem só com espaços dá erro em linha e não chama a API', async () => {
    api.listChannelsForAgent.mockResolvedValue([BAILEYS]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText('Telefone'), '98999990000');
    await userEvent.type(screen.getByLabelText('Mensagem inicial'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar conversa' }));
    expect(screen.getByLabelText('Mensagem inicial')).toHaveAccessibleDescription('Escreva a mensagem inicial.');
    expect(api.startConversation).not.toHaveBeenCalled();
  });

  test('o erro do telefone some ao editar (ATD-INI-10)', async () => {
    api.listChannelsForAgent.mockResolvedValue([BAILEYS]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar conversa' }));
    expect(screen.getByText('Informe o telefone com DDD.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Telefone'), '9');
    expect(screen.queryByText('Informe o telefone com DDD.')).not.toBeInTheDocument();
  });

  test('templates de um canal que deixou de ser o escolhido não aparecem (ATD-INI-27)', async () => {
    api.listChannelsForAgent.mockResolvedValue([OFICIAL_A, OFICIAL_B]);
    let entregarA;
    api.listTemplatesForChannel.mockImplementation((canal) =>
      canal === 'ch-a'
        ? new Promise((r) => { entregarA = r; })
        : Promise.resolve([{ id: 'tpl-b', name: 'do_canal_b', bodyText: 'B', variableCount: 0, buttons: [] }])
    );
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Canal' }), 'ch-b');
    expect(await screen.findByRole('radio', { name: 'do_canal_b' })).toBeInTheDocument();
    entregarA([{ id: 'tpl-a', name: 'do_canal_a', bodyText: 'A', variableCount: 0, buttons: [] }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('radio', { name: 'do_canal_a' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'do_canal_b' })).toBeChecked();
  });

  test('templates com erro e "Tentar de novo" (ATD-INI-14)', async () => {
    api.listChannelsForAgent.mockResolvedValue([OFICIAL_A]);
    api.listTemplatesForChannel.mockRejectedValueOnce(new Error('rede')).mockResolvedValue([{ id: 'tpl-1', name: 'boas_vindas', bodyText: 'Oi', variableCount: 0, buttons: [] }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));
    expect(await screen.findByRole('radio', { name: 'boas_vindas' })).toBeChecked();
  });

  test('ocupado: "Iniciando…", ESC e Cancelar não fecham (ATD-INI-26)', async () => {
    api.listChannelsForAgent.mockResolvedValue([BAILEYS]);
    let terminar;
    api.startConversation.mockReturnValue(new Promise((r) => { terminar = r; }));
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText('Telefone'), '98999990000');
    await userEvent.type(screen.getByLabelText('Mensagem inicial'), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar conversa' }));
    expect(screen.getByRole('button', { name: 'Iniciando…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    terminar({ id: 'conv-1' });
  });

  test('variável que falta: o rodapé diz qual, e o botão aponta para lá', async () => {
    api.listChannelsForAgent.mockResolvedValue([OFICIAL_A]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura', bodyText: 'Olá {{1}}', variableCount: 1, buttons: [] }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByRole('radio', { name: 'fatura' });
    expect(screen.getByRole('button', { name: 'Iniciar conversa' })).toHaveAccessibleDescription('Preencha a Variável 1.');
  });
});
```

Os testes que digitam a mensagem por `getByLabelText(/mensagem/i)` continuam achando o campo (o rótulo passa a "Mensagem inicial"); os que clicam `/iniciar/i` continuam (o botão é "Iniciar conversa").

Em `DashboardPage.test.jsx`, acrescentar:

```jsx
  test('conversa iniciada abre na aba Atendimento (ATD-MESA-16)', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Nova conversa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mock Start Conversation' }));
    expect(screen.getByRole('tab', { name: /^atendimento/i })).toHaveAttribute('aria-selected', 'true');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/StartConversationModal.test.jsx src/pages/DashboardPage.test.jsx`
Expected: FAIL nos novos e nos reescritos.

- [ ] **Step 3: Reescrever o diálogo**

`frontend/src/components/StartConversationModal.jsx` inteiro:

```jsx
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, startConversation, listTemplatesForChannel } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import { Button } from './ui';
import { Dialog, DialogBody, DialogFooter } from './ui/Dialog';
import EscolhaDeTemplate, { faltaParaEnviar } from './EscolhaDeTemplate';
import { descreverErro } from '../utils/errorMessages';

const COUNTRY_CODES = [
  { code: '55', label: 'Brasil (+55)' },
  { code: '351', label: 'Portugal (+351)' },
  { code: '1', label: 'EUA/Canadá (+1)' },
  { code: '54', label: 'Argentina (+54)' },
  { code: '595', label: 'Paraguai (+595)' },
  { code: '598', label: 'Uruguai (+598)' },
  { code: '34', label: 'Espanha (+34)' },
];

const CAMPO = 'h-9 w-full rounded-ui-md bg-campo px-3 text-corpo text-tinta outline-none placeholder:text-tinta-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-60';
const ROTULO = 'mb-1 block text-rotulo font-medium text-tinta-2';

function ErroDoCampo({ id, children }) {
  return children ? <p id={id} role="alert" className="mt-1 text-rotulo text-perigo">{children}</p> : null;
}

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [statusDosCanais, setStatusDosCanais] = useState('loading');
  const [channelId, setChannelId] = useState('');
  const [ddi, setDdi] = useState('55');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState(null);
  const [content, setContent] = useState('');
  const [contentError, setContentError] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [statusDosTemplates, setStatusDosTemplates] = useState('ready');
  const [templateId, setTemplateId] = useState(null);
  const [variaveis, setVariaveis] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const canalDoPedidoRef = useRef(null);
  const id = useId();
  const canalMotivoId = `${id}-canal-motivo`;
  const vazioId = `${id}-templates-vazio`;
  const motivoId = `${id}-motivo`;

  const phoneDigits = phone.replace(/\D/g, '');

  const carregarCanais = useCallback(() => {
    setStatusDosCanais('loading');
    listChannelsForAgent(token)
      .then((data) => {
        const eligible = data.filter(
          (channel) => (channel.type === 'baileys' && channel.status === 'connected') || isOfficialChannelType(channel.type)
        );
        setChannels(eligible);
        setChannelId((atual) => (atual && eligible.some((c) => c.id === atual) ? atual : eligible[0]?.id || ''));
        setStatusDosCanais('ready');
      })
      .catch(() => setStatusDosCanais('error'));
  }, [token]);

  useEffect(() => {
    carregarCanais();
  }, [carregarCanais]);

  const selectedChannel = channels.find((channel) => channel.id === channelId) || null;
  const isOfficialChannel = Boolean(selectedChannel) && isOfficialChannelType(selectedChannel.type);
  const escolhido = templates.find((t) => t.id === templateId) || null;

  const carregarTemplates = useCallback(() => {
    canalDoPedidoRef.current = isOfficialChannel ? channelId : null;
    setTemplates([]);
    setTemplateId(null);
    setVariaveis([]);
    if (!isOfficialChannel || !channelId) {
      setStatusDosTemplates('ready');
      return;
    }
    const pedido = channelId;
    setStatusDosTemplates('loading');
    listTemplatesForChannel(channelId, token, 'atendimento')
      .then((data) => {
        // A resposta de um canal que não é mais o escolhido é descartada: antes
        // ela chegava depois e punha os templates de A no canal B (ATD-INI-27).
        if (canalDoPedidoRef.current !== pedido) return;
        setTemplates(data);
        // O Iniciar pré-seleciona o 1º, como sempre fez.
        const primeiro = data[0] || null;
        setTemplateId(primeiro ? primeiro.id : null);
        setVariaveis(primeiro ? Array.from({ length: primeiro.variableCount || 0 }, () => '') : []);
        setStatusDosTemplates('ready');
      })
      .catch(() => {
        if (canalDoPedidoRef.current === pedido) setStatusDosTemplates('error');
      });
  }, [isOfficialChannel, channelId, token]);

  useEffect(() => {
    carregarTemplates();
  }, [carregarTemplates]);

  function escolherTemplate(novo) {
    const template = templates.find((t) => t.id === novo);
    setTemplateId(novo);
    setVariaveis(Array.from({ length: template ? template.variableCount || 0 : 0 }, () => ''));
  }

  const canaisProntos = statusDosCanais === 'ready' && channels.length > 0;
  const semTemplates = isOfficialChannel && statusDosTemplates === 'ready' && templates.length === 0;
  const faltaNoTemplate = isOfficialChannel && statusDosTemplates === 'ready' && !semTemplates ? faltaParaEnviar(escolhido, variaveis) : null;
  const bloqueado = !canaisProntos || (isOfficialChannel && (statusDosTemplates !== 'ready' || semTemplates || Boolean(faltaNoTemplate)));
  // O motivo do botão desabilitado é a frase que JÁ está no corpo (estado dito
  // uma vez); só o que falta no template vai para o rodapé.
  const descricaoDoBotao = !canaisProntos ? canalMotivoId : semTemplates ? vazioId : faltaNoTemplate ? motivoId : undefined;

  async function handleSubmit(event) {
    event.preventDefault();
    if (bloqueado || enviando) return;
    setError(null);
    let invalido = false;
    if (phoneDigits.length < 8) {
      setPhoneError('Informe o telefone com DDD.');
      invalido = true;
    }
    if (!isOfficialChannel && !content.trim()) {
      setContentError('Escreva a mensagem inicial.');
      invalido = true;
    }
    if (invalido) return;
    const phoneNumber = `${ddi}${phoneDigits}`;
    setEnviando(true);
    try {
      const conversation = isOfficialChannel
        ? await startConversation({ channelId, phoneNumber, templateId, templateVariables: variaveis }, token)
        : await startConversation({ channelId, phoneNumber, content }, token);
      onCreated(conversation);
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível iniciar a conversa.'));
      setEnviando(false);
    }
  }

  return (
    <Dialog variant="start-conversation" title="Iniciar conversa" onClose={onClose} size="max-w-[576px]" dismissible={false} ocupado={enviando}>
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          {/* Para quem: País e Telefone lado a lado pela LARGURA DO DIÁLOGO
              (@container, limiar de 330 px), não da janela. */}
          <div className="@container">
            <div className="grid gap-3 @min-[330px]:grid-cols-[minmax(120px,0.8fr)_minmax(0,1.6fr)]">
              <div>
                <label htmlFor={`${id}-ddi`} className={ROTULO}>País</label>
                <select id={`${id}-ddi`} value={ddi} onChange={(e) => setDdi(e.target.value)} disabled={enviando} className={CAMPO}>
                  {COUNTRY_CODES.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-phone`} className={ROTULO}>Telefone</label>
                <input
                  id={`${id}-phone`}
                  data-autofocus=""
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setPhoneError(null); }}
                  placeholder="98 98500-4187"
                  inputMode="tel"
                  disabled={enviando}
                  aria-invalid={phoneError ? 'true' : 'false'}
                  aria-describedby={phoneError ? `${id}-phone-erro` : `${id}-phone-ajuda`}
                  className={CAMPO}
                />
              </div>
            </div>
            <p id={`${id}-phone-ajuda`} className="mt-1 flex flex-wrap justify-between gap-x-3 text-rotulo text-tinta-2">
              <span>
                Digite com DDD.
                {/* A conferência do "9" só roda em Baileys; no oficial o número
                    segue como digitado — a frase prometia o que não acontece. */}
                {selectedChannel && !isOfficialChannel ? ' Com ou sem o 9, conferimos no WhatsApp.' : null}
              </span>
              {phoneDigits.length > 0 ? <span className="shrink-0 tabular-nums">Número completo: {ddi}{phoneDigits}</span> : null}
            </p>
            <ErroDoCampo id={`${id}-phone-erro`}>{phoneError}</ErroDoCampo>
          </div>

          {/* Por onde: o estado dos canais é dito UMA vez, aqui. */}
          <div>
            {statusDosCanais === 'loading' ? (
              <>
                <p className={ROTULO}>Canal</p>
                <p id={canalMotivoId} className="h-9 rounded-ui-md bg-hover motion-safe:animate-pulse"><span className="sr-only">Carregando canais…</span></p>
              </>
            ) : statusDosCanais === 'error' ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ui-md bg-perigo-fundo px-3 py-2 text-rotulo text-perigo">
                <span id={canalMotivoId}>Não foi possível carregar os canais.</span>
                <Button size="sm" variant="secondary" onClick={carregarCanais}>Tentar de novo</Button>
              </div>
            ) : channels.length === 0 ? (
              <>
                <p className={ROTULO}>Canal</p>
                <p id={canalMotivoId} className="text-corpo text-tinta-2">Nenhum canal conectado no momento.</p>
              </>
            ) : channels.length === 1 ? (
              // Um canal só: um <select> que não decide nada vira texto.
              <>
                <p className={ROTULO}>Canal</p>
                <p className="flex h-9 items-center text-corpo text-tinta">{selectedChannel.name}</p>
              </>
            ) : (
              <>
                <label htmlFor={`${id}-canal`} className={ROTULO}>Canal</label>
                <select id={`${id}-canal`} value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={enviando} className={CAMPO}>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
              </>
            )}
          </div>

          {/* O quê: só depois de saber o tipo do canal (antes o formulário
              Baileys aparecia durante a carga e trocava quando a lista chegava). */}
          {canaisProntos ? (
            isOfficialChannel ? (
              <EscolhaDeTemplate
                templates={templates}
                status={statusDosTemplates}
                erro={statusDosTemplates === 'error' ? 'Não foi possível carregar os templates.' : undefined}
                onTentarDeNovo={carregarTemplates}
                valor={templateId}
                aoEscolher={escolherTemplate}
                variaveis={variaveis}
                aoMudarVariavel={(i, texto) => setVariaveis((atuais) => atuais.map((v, j) => (j === i ? texto : v)))}
                desabilitada={enviando}
                ajuda="Canal oficial só inicia conversa com template aprovado."
                vazio={<span id={vazioId}>Nenhum template de atendimento aprovado neste canal.</span>}
                explicarBotoes={(temBotao) =>
                  temBotao
                    ? 'O cliente responde com um toque no botão — e é essa resposta que abre a conversa para você escrever.'
                    : 'Este template não tem botões: a conversa só continua depois que o cliente responder.'
                }
              />
            ) : (
              <div>
                <label htmlFor={`${id}-mensagem`} className={ROTULO}>Mensagem inicial</label>
                <textarea
                  id={`${id}-mensagem`}
                  value={content}
                  onChange={(e) => { setContent(e.target.value); setContentError(null); }}
                  rows={3}
                  disabled={enviando}
                  aria-invalid={contentError ? 'true' : 'false'}
                  aria-describedby={contentError ? `${id}-mensagem-erro` : undefined}
                  className={`${CAMPO} h-auto resize-y py-2`}
                />
                <ErroDoCampo id={`${id}-mensagem-erro`}>{contentError}</ErroDoCampo>
              </div>
            )
          ) : null}
        </DialogBody>
        <DialogFooter motivo={faltaNoTemplate} motivoId={motivoId} erro={error}>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button type="submit" disabled={bloqueado} loading={enviando} aria-describedby={descricaoDoBotao}>
            {enviando ? 'Iniciando…' : 'Iniciar conversa'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export default StartConversationModal;
```

Em `overlays.css`, apagar `.dialog-inicio-linha`, `.dialog-inicio-fone` (e o `@container` deles, `:127-129`) e as regras de `[data-dialog=start-conversation]` — a regra do limiar de 330 px passou ao utilitário `@min-[330px]:` acima.

- [ ] **Step 4: A mesa vai para a aba Atendimento**

Em `DashboardPage.jsx`, o `onCreated` do `StartConversationModal` (`:319-323`) ganha `setActiveTab('inProgress');` antes do `setSelectedId` — o `/start` já atribui a conversa a quem a iniciou (`src/api/conversations.routes.js:204,210,225`), então ela é da aba Atendimento.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/StartConversationModal.test.jsx src/components/EscolhaDeTemplate.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Provar a guarda do canal por mutação**

Em `carregarTemplates`, apagar a linha `if (canalDoPedidoRef.current !== pedido) return;`. Rodar `StartConversationModal.test.jsx`.
Expected: FAIL em "templates de um canal que deixou de ser o escolhido não aparecem". Desfazer.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/StartConversationModal.jsx frontend/src/components/StartConversationModal.test.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/components/overlays.css
git commit -m "E2.5: Iniciar conversa em uma coluna, telefone primeiro, estado dos canais dito uma vez"
```

---

### Task 5: Atendimentos anteriores — lista de 2 linhas e a bolha da conversa no detalhe

**Files:**
- Create: `frontend/src/utils/linhaDoTempo.js` (sai de `ConversationView.jsx:56-139`)
- Modify: `frontend/src/components/ConversationView.jsx` (importa `buildTimeline`; passa `nomeDoContato` ao Histórico)
- Modify: `frontend/src/components/ui/Dialog.jsx`, `ui/Dialog.test.jsx` (prop `inicioDoCabecalho`)
- Rewrite: `frontend/src/components/ConversationHistoryModal.jsx`; Modify: `frontend/src/components/ConversationHistoryModal.test.jsx`
- Modify: `frontend/src/components/overlays.css` (saem `.dialog-history-*` e `[data-dialog=history]`)

Apêndice E.2 e `grupo-B.md` §1: diálogo de **consulta** — × no cabeçalho, sem rodapé (o "Fechar" duplicava o ×; "Somente leitura." vai para a descrição do detalhe). **Lista:** sem ícone de cabeçalho (E.1-1: o anexo falava em ícone neutro; vale o apêndice); descrição só com a lista pronta — "{n} encerrados" ou "Últimos 50 encerrados" quando vierem 50 (a consulta tem `LIMIT 50`); item vira **linha de 2 linhas** — linha 1 motivo (ou "Sem motivo registrado") e a data à direita (ou "Início não informado"); linha 2 hora · quem atendeu · canal; sai o bloco de data, sai "Finalizado" (constante: a consulta só devolve encerrados), sai o glifo "›" (ícone da família); o nome acessível da linha leva tudo. **Detalhe:** o "←" ocupa o lugar do ícone (é controle, E.1-1); título "{motivo} · {data} · {hora}"; descrição "{quem atendeu/encerrou} · {canal} · somente leitura"; saem a migalha e o resumo (100% redundantes); mensagens com **a mesma `MessageBubble` da conversa** (sem Responder nem Analisar comprovante — ela é só leitura quando não recebe esses callbacks), com separador de dia, sobre fundo liso; carregando, erro com "Tentar de novo" e vazio "Nenhuma mensagem neste atendimento."; ao abrir outro atendimento as mensagens zeram e a resposta de um que não é mais o aberto é descartada (CV-HIS-10); ao voltar, o foco vai para a linha que estava aberta (N1).

- [ ] **Step 1: Atualizar e escrever os testes**

Em `ConversationHistoryModal.test.jsx`:

- "calls onClose when Fechar is clicked" passa a fechar pelo × (o botão do rodapé sumiu):

```jsx
  test('diálogo de consulta: fecha pelo ×, sem rodapé', async () => {
    api.getConversationHistory.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<ConversationHistoryModal contactId="contact-1" onClose={onClose} />);
    await screen.findByText(/nenhum atendimento anterior/i);
    expect(screen.getByRole('dialog').querySelector('.dw-dialog-footer')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
```

- Em "distingue três atendimentos no mesmo dia…", a data e a hora deixam de ser um texto só ("19/09/2026 · 20:03") e passam a duas linhas; o nome acessível continua com tudo. As asserções da lista passam a:

```jsx
    const rows = await screen.findAllByRole('button', { name: /19\/09\/2026/ });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAccessibleName('Troca de senha · 19/09/2026 · 20:03 · Ana Clara');
    expect(rows[1]).toHaveAccessibleName('Segunda via · 19/09/2026 · 09:10 · Bruno');
    expect(rows[2]).toHaveAccessibleName('Sem motivo registrado · 19/09/2026 · 14:35 · Carla');
    expect(rows[0]).not.toHaveTextContent('Finalizado');
    expect(screen.queryByText(/23:59/)).not.toBeInTheDocument();
```

  e as do detalhe (depois do `click(rows[0])`):

```jsx
    expect(await screen.findByRole('heading', { name: /Troca de senha · 19\/09\/2026 · 20:03/ })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Ana Clara · somente leitura');
    expect(screen.queryByText('Responsável')).not.toBeInTheDocument();
    expect(screen.queryByText('Finalizado')).not.toBeInTheDocument();
    expect(screen.queryByText(/Duração|Setor|Assumido|Encerramento/)).not.toBeInTheDocument();
```

- "em carregamento não mostra…" continua (o esqueleto tem `role="status"`).

E acrescentar:

```jsx
describe('E2.5: lista, detalhe e estados', () => {
  const HIST = [
    { id: 'a', createdAt: '2026-09-19T09:10:00', assignedAgentName: 'Bruno', channelName: 'Loja', closeReasonName: 'Segunda via', status: 'closed' },
    { id: 'b', createdAt: '2026-09-18T15:00:00', assignedAgentName: 'Carla', channelName: 'Loja', closeReasonName: 'Troca de senha', status: 'closed' },
  ];

  test('descrição da lista só quando pronta', async () => {
    api.getConversationHistory.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).not.toHaveAccessibleDescription();
    unmount();
    api.getConversationHistory.mockResolvedValue(HIST);
    render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    await screen.findAllByRole('button', { name: /Loja/ });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('2 encerrados');
  });

  test('com 50 vindos, avisa que são os últimos 50', async () => {
    api.getConversationHistory.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, createdAt: '2026-09-19T09:10:00', status: 'closed' })));
    render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    await screen.findAllByRole('button', { name: /19\/09\/2026/ });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Últimos 50 encerrados');
  });

  test('erro da lista com "Tentar de novo"', async () => {
    api.getConversationHistory.mockRejectedValueOnce(new Error('rede')).mockResolvedValue(HIST);
    render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));
    expect(await screen.findByRole('button', { name: /Segunda via/ })).toBeInTheDocument();
  });

  test('o detalhe usa a bolha da conversa, sem Responder, e nunca mostra o código Pix', async () => {
    api.getConversationHistory.mockResolvedValue(HIST);
    api.getMessages.mockResolvedValue([
      { id: 'm1', direction: 'outbound', sentBy: 'ai', content: 'Segue a segunda via.', messageType: 'text', createdAt: '2026-09-19T09:11:00', status: 'read' },
      { id: 'm2', direction: 'outbound', messageType: 'pix', content: '00020126580014BR.GOV.BCB.PIX', createdAt: '2026-09-19T09:12:00' },
    ]);
    render(<ConversationHistoryModal contactId="k1" nomeDoContato="Maria" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Segunda via/ }));
    expect(await screen.findByText('Segue a segunda via.')).toBeInTheDocument();
    expect(screen.getByText('Assistente IA')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Lida' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument();
    expect(screen.queryByText('00020126580014BR.GOV.BCB.PIX')).not.toBeInTheDocument();
    expect(document.querySelector('[data-separador-dia]')).not.toBeNull();
  });

  test('detalhe: esqueleto, erro com "Tentar de novo" e vazio', async () => {
    api.getConversationHistory.mockResolvedValue(HIST);
    api.getMessages.mockRejectedValueOnce(new Error('rede')).mockResolvedValue([]);
    render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Segunda via/ }));
    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));
    expect(await screen.findByText('Nenhuma mensagem neste atendimento.')).toBeInTheDocument();
  });

  test('resposta atrasada de outro atendimento não cobre o aberto (CV-HIS-10)', async () => {
    api.getConversationHistory.mockResolvedValue(HIST);
    let entregarA;
    api.getMessages.mockImplementation((id) =>
      id === 'a'
        ? new Promise((r) => { entregarA = r; })
        : Promise.resolve([{ id: 'mb', direction: 'inbound', content: 'Mensagem do B', messageType: 'text', createdAt: '2026-09-18T15:01:00' }])
    );
    render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Segunda via/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para atendimentos anteriores' }));
    await userEvent.click(screen.getByRole('button', { name: /Troca de senha/ }));
    expect(await screen.findByText('Mensagem do B')).toBeInTheDocument();
    entregarA([{ id: 'ma', direction: 'inbound', content: 'Mensagem do A', messageType: 'text', createdAt: '2026-09-19T09:11:00' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Mensagem do A')).not.toBeInTheDocument();
  });

  test('ao voltar, o foco vai para a linha que estava aberta (N1)', async () => {
    api.getConversationHistory.mockResolvedValue(HIST);
    api.getMessages.mockResolvedValue([]);
    render(<ConversationHistoryModal contactId="k1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Troca de senha/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar para atendimentos anteriores' }));
    expect(screen.getByRole('button', { name: /Troca de senha/ })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ConversationHistoryModal.test.jsx`
Expected: FAIL nos novos e nos reescritos.

- [ ] **Step 3: Extrair a linha do tempo**

Criar `frontend/src/utils/linhaDoTempo.js` com as funções de `ConversationView.jsx:56-139` **como estão** — `startOfDay`, `diaDaMensagem`, `mesmoDiaDoCalendario`, `dayLabel`, `DIA_DESCONHECIDO` e `buildTimeline` (o `clockLabel` já saiu na E2.4) —, exportando só `buildTimeline`. Na `ConversationView`, apagar as seis e importar `import { buildTimeline } from '../utils/linhaDoTempo';`. Os testes de separador de dia da `ConversationView` são a prova de que nada mudou:

Run: `cd frontend && npx vitest run src/components/ConversationView`
Expected: PASS, sem mudança de teste.

- [ ] **Step 4: Reescrever o diálogo**

`frontend/src/components/ConversationHistoryModal.jsx` inteiro:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getConversationHistory, getMessages } from '../services/api';
import MessageBubble from './MessageBubble';
import { AsyncState } from './ui';
import { Dialog } from './ui/Dialog';
import { IconArrowLeft, IconChevronRight } from './icons/IconesTrabalho';
import { buildTimeline } from '../utils/linhaDoTempo';

// A lista vem com LIMIT 50 no backend: com 50, pode haver mais.
const LIMITE_DA_LISTA = 50;

// Quem atendeu e quem encerrou nem sempre é a mesma pessoa: o admin pode
// encerrar sem estar atribuído. Um nome só no caso comum, os dois quando
// divergem.
function quemAtendeu(conversation) {
  const { assignedAgentName: atendeu, closedByAgentName: encerrou } = conversation;
  if (atendeu && encerrou && atendeu !== encerrou) {
    return `Atendido por ${atendeu}, encerrado por ${encerrou}`;
  }
  return atendeu || (encerrou ? `Encerrado por ${encerrou}` : null);
}

function dataEHora(createdAt) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return {
    data: date.toLocaleDateString('pt-BR'),
    hora: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

function motivoDe(conversation) {
  return conversation.closeReasonName || 'Sem motivo registrado';
}

// Linha de 2 linhas (P3): motivo e data; hora, quem e canal. O nome acessível
// leva tudo, com a data completa. "Finalizado" saiu: a consulta só devolve
// encerrados, então dizia sempre a mesma coisa.
function LinhaDoHistorico({ conversation, onAbrir, linhaRef }) {
  const quando = dataEHora(conversation.createdAt);
  const apoio = [quando && quando.hora, quemAtendeu(conversation), conversation.channelName].filter(Boolean).join(' · ');
  const nome = [motivoDe(conversation), quando ? `${quando.data} · ${quando.hora}` : 'Início não informado', quemAtendeu(conversation), conversation.channelName]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="border-b border-linha last:border-b-0">
      <button
        ref={linhaRef}
        type="button"
        onClick={() => onAbrir(conversation)}
        aria-label={nome}
        className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors duration-120 hover:bg-hover focus-visible:bg-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-3">
            <span className={`min-w-0 flex-1 truncate text-corpo font-semibold ${conversation.closeReasonName ? 'text-tinta' : 'text-tinta-2'}`}>{motivoDe(conversation)}</span>
            <span className="shrink-0 text-meta tabular-nums text-tinta-3">{quando ? quando.data : 'Início não informado'}</span>
          </span>
          {apoio ? <span className="block truncate text-rotulo text-tinta-2">{apoio}</span> : null}
        </span>
        <span aria-hidden="true" className="shrink-0 text-tinta-3"><IconChevronRight size={16} /></span>
      </button>
    </li>
  );
}

function ConversationHistoryModal({ contactId, nomeDoContato, onClose }) {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('loading');
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesStatus, setMessagesStatus] = useState('loading');
  const abertoRef = useRef(null);
  const voltarRef = useRef(null);
  const linhaDoAbertoRef = useRef(null);
  const ultimoAbertoRef = useRef(null);

  const carregarLista = useCallback(() => {
    setHistoryStatus('loading');
    getConversationHistory(contactId, token)
      .then((data) => {
        setHistory(data);
        setHistoryStatus('ready');
      })
      .catch((err) => setHistoryStatus(err && err.status === 403 ? 'forbidden' : 'error'));
  }, [contactId, token]);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  const carregarMensagens = useCallback((conversation) => {
    // Zera e marca QUAL atendimento está aberto: a resposta de outro, que
    // chegue depois, é descartada (CV-HIS-10, CLASSE-01).
    abertoRef.current = conversation.id;
    setMessages([]);
    setMessagesStatus('loading');
    getMessages(conversation.id, token)
      .then((data) => {
        if (abertoRef.current !== conversation.id) return;
        setMessages(data);
        setMessagesStatus('ready');
      })
      .catch(() => {
        if (abertoRef.current === conversation.id) setMessagesStatus('error');
      });
  }, [token]);

  function abrir(conversation) {
    ultimoAbertoRef.current = conversation.id;
    setSelected(conversation);
    carregarMensagens(conversation);
  }

  function voltar() {
    abertoRef.current = null;
    setSelected(null);
  }

  // Detalhe: o foco vai para o "←". Lista de volta: para a linha que estava
  // aberta — antes o botão focado desmontava e o foco caía no <body> (N1).
  useEffect(() => {
    if (selected && voltarRef.current) voltarRef.current.focus();
    if (!selected && linhaDoAbertoRef.current) linhaDoAbertoRef.current.focus();
  }, [selected]);

  const quando = selected ? dataEHora(selected.createdAt) : null;
  const titulo = selected
    ? `${motivoDe(selected)} · ${quando ? `${quando.data} · ${quando.hora}` : 'Início não informado'}`
    : 'Atendimentos anteriores';
  const descricao = selected
    ? [quemAtendeu(selected), selected.channelName, 'somente leitura'].filter(Boolean).join(' · ')
    : historyStatus === 'ready' && history.length > 0
      ? history.length >= LIMITE_DA_LISTA
        ? `Últimos ${LIMITE_DA_LISTA} encerrados`
        : `${history.length} ${history.length === 1 ? 'encerrado' : 'encerrados'}`
      : undefined;

  return (
    <Dialog
      variant="history"
      title={titulo}
      // O "←" é controle, não ícone decorativo (E.1-1), e fica FORA do <h2>:
      // dentro dele, "Voltar para atendimentos anteriores" entraria no nome do
      // diálogo.
      inicioDoCabecalho={
        selected ? (
          <button
            ref={voltarRef}
            type="button"
            onClick={voltar}
            aria-label="Voltar para atendimentos anteriores"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-tinta-2 hover:bg-hover hover:text-tinta"
          >
            <IconArrowLeft size={20} />
          </button>
        ) : null
      }
      description={descricao}
      onClose={onClose}
      closeOnBackdrop
      size="max-w-[640px]"
    >
      {selected ? (
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto bg-fundo px-4 py-2">
          <AsyncState
            status={messagesStatus}
            isEmpty={messages.length === 0}
            onRetry={() => carregarMensagens(selected)}
            emptyMessage="Nenhuma mensagem neste atendimento."
          >
            {buildTimeline(messages).map((row) =>
              row.kind === 'day' ? (
                <div key={row.key} data-separador-dia="" className="my-3 flex justify-center">
                  <span className="rounded-full bg-painel px-3 py-1 text-meta font-medium text-tinta-2">{row.label}</span>
                </div>
              ) : (
                // A mesma bolha da conversa: sem onResponder nem
                // onAnalisarComprovante, ela é só leitura.
                <MessageBubble
                  key={row.key}
                  message={row.message}
                  primeiraDoGrupo={row.firstOfGroup}
                  nomeDoContato={nomeDoContato || 'Cliente'}
                  contactId={contactId}
                />
              )
            )}
          </AsyncState>
        </div>
      ) : (
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <AsyncState
            status={historyStatus}
            isEmpty={history.length === 0}
            onRetry={carregarLista}
            esqueleto="linhas"
            emptyMessage="Nenhum atendimento anterior encontrado."
          >
            <ul>
              {history.map((conversation) => (
                <LinhaDoHistorico
                  key={conversation.id}
                  conversation={conversation}
                  onAbrir={abrir}
                  linhaRef={conversation.id === ultimoAbertoRef.current ? linhaDoAbertoRef : undefined}
                />
              ))}
            </ul>
          </AsyncState>
        </div>
      )}
    </Dialog>
  );
}

export default ConversationHistoryModal;
```

No `Dialog` (`ui/Dialog.jsx`, E2.2), a prop nova `inicioDoCabecalho` (nó, padrão `null`) entra no cabeçalho **antes** do bloco do título — `<div className="dw-dialog-heading …">{inicioDoCabecalho}<div className="min-w-0 flex-1"><h2 …>` —, e o `items-start` do cabeçalho passa a `items-center` quando ela existe. Em `ui/Dialog.test.jsx`:

```jsx
  test('inicioDoCabecalho fica fora do título e do nome do diálogo', () => {
    render(<Dialog title="Detalhe" inicioDoCabecalho={<button type="button" aria-label="Voltar">←</button>} onClose={() => {}}>corpo</Dialog>);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Detalhe');
    expect(screen.getByRole('button', { name: 'Voltar' }).closest('h2')).toBeNull();
  });
```

A descrição some enquanto a lista carrega (CV-HIS-01): `description` `undefined` não gera `aria-describedby`. No teste "distingue três atendimentos…", acrescentar `expect(screen.getByRole('dialog')).toHaveAccessibleName(/^Troca de senha · 19\/09\/2026 · 20:03$/);` depois de abrir o detalhe.

Na `ConversationView`, a montagem do Histórico passa `nomeDoContato={nameLabel}`:

```jsx
        <ConversationHistoryModal contactId={conversation.contactId} nomeDoContato={nameLabel} onClose={() => setShowingHistory(false)} />
```

Em `overlays.css`, apagar `.dialog-history-*` e as regras de `[data-dialog=history]` (e o trecho deles no `@media(max-width:680px)`).

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ConversationHistoryModal.test.jsx src/components/ConversationView`
Expected: PASS.

- [ ] **Step 6: Provar a guarda do detalhe por mutação**

Em `carregarMensagens`, apagar `if (abertoRef.current !== conversation.id) return;`. Rodar. Expected: FAIL em "resposta atrasada de outro atendimento não cobre o aberto". Desfazer.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/linhaDoTempo.js frontend/src/components/ConversationView.jsx frontend/src/components/ConversationHistoryModal.jsx frontend/src/components/ConversationHistoryModal.test.jsx frontend/src/components/ui/Dialog.jsx frontend/src/components/ui/Dialog.test.jsx frontend/src/components/overlays.css
git commit -m "E2.5: Atendimentos anteriores com linha de duas linhas e a bolha da conversa no detalhe"
```

---

### Task 6: Visualizador de imagem — barra no topo, Girar, Baixar sem sair do app

**Files:**
- Modify: `frontend/src/components/MessageAttachment.jsx:305-514` (`ImageBubble` e `ViewerButton`), `:703,758-769` (props `autor`, `quando`, `legenda`)
- Modify: `frontend/src/components/MessageBubble.jsx` (passa o autor ao anexo)
- Modify: `frontend/src/components/MessageAttachment.test.jsx`
- Modify: `frontend/src/components/overlays.css` (sai a regra do ✕ do visor, `.dialog-image-viewer …`)

Apêndice E.2 e `grupo-B.md` §3: **uma barra no topo que reserva espaço** (autor · data e hora à esquerda; à direita Diminuir · {n}% · Aumentar · Ajustar — só com zoom > 100 % — · **Girar** · Baixar · divisória · Fechar); sai o ✕ solto no canto e a barra flutuante do rodapé; a imagem fica **abaixo** da barra e nunca é coberta em 100 % (N10); **legenda** da mensagem embaixo, até 3 linhas com rolagem própria; fundo `--color-fundo` sólido (sai o `#0b141a` translúcido e o desfoque); glifos ✕ − + viram ícones da família; nome acessível "Imagem de {autor}, {data}"; foco inicial no Fechar (marcado com `data-autofocus`). Comportamento: clique simples em 100 % amplia 2× **no ponto clicado** (o cursor já prometia); duplo clique continua voltando; o percentual num `aria-live` (sem `role`); arrasto também por toque; setas movem a imagem com zoom > 100 %, e as teclas só valem com o visor no topo da pilha; **Baixar** busca o arquivo e salva por `blob:` — se a busca falhar, abre numa **nova aba** (a aba do app nunca navega para a imagem crua, MSG-IMG-12). Galeria anterior/próxima fica fora da E2 (E.3).

- [ ] **Step 1: Atualizar e escrever os testes**

Em `MessageAttachment.test.jsx`:

- "ESC fecha o visualizador pela pilha de dialogos": o nome do diálogo passa a `/^Imagem/` nas duas buscas.
- "oferece baixar a imagem" passa a:

```jsx
  test('Baixar salva pelo blob:, sem navegar a aba', async () => {
    const objeto = 'blob:imagem';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })) }));
    const criar = vi.spyOn(URL, 'createObjectURL').mockReturnValue(objeto);
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.getAttribute('href')).toBe(objeto);
      expect(this.getAttribute('download')).toBe('comprovante.jpg');
    });
    await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar' }));
    await waitFor(() => expect(clique).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    criar.mockRestore();
    clique.mockRestore();
  });

  test('Baixar que falha abre numa nova aba', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede')));
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar' }));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener'));
    abrir.mockRestore();
  });
```

**[Prova na cópia, 24/09/2026]** Os dois testes do Baixar trocam o `fetch` global por `vi.stubGlobal`, com `afterEach(() => vi.unstubAllGlobals());` no `describe` do visualizador (logo antes do `abrirVisualizador`) e `afterEach` no import do `vitest`. Atribuído direto, o `fetch` simulado vazava para os testes seguintes. O arquivo passa a importar também `import { useDialogLayer } from './ui/Dialog';`, para o teste da guarda do topo.

E acrescentar, no mesmo `describe` do visualizador:

```jsx
  test('uma barra no topo: autor e data, controles na ordem, Fechar por último', async () => {
    render(<MessageAttachment message={{ ...MENSAGEM, createdAt: '2026-09-24T14:32:00', content: 'Segue o comprovante' }} autor="Maria" />);
    await userEvent.click(screen.getByRole('button', { name: /abrir imagem em tela cheia/i }));
    const visor = screen.getByRole('dialog', { name: /^Imagem de Maria, 24\/09\/2026/ });
    const nomes = within(visor).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent);
    expect(nomes).toEqual(['Diminuir zoom', 'Aumentar zoom', 'Girar', 'Baixar', 'Fechar imagem']);
    expect(within(visor).getByText('Maria')).toBeInTheDocument();
    expect(within(visor).getByText('Segue o comprovante')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar imagem' })).toHaveFocus();
  });

  test('"Ajustar" só aparece com zoom acima de 100%', async () => {
    await abrirVisualizador();
    expect(screen.queryByRole('button', { name: /^ajustar$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    expect(screen.getByRole('button', { name: /^ajustar$/i })).toBeInTheDocument();
  });

  test('clique simples em 100% amplia 2× no ponto clicado', async () => {
    const dialog = await abrirVisualizador();
    const imagem = within(dialog).getByAltText('comprovante.jpg');
    fireEvent.click(imagem, { clientX: 40, clientY: 30 });
    expect(screen.getByText('200%')).toBeInTheDocument();
    expect(imagem.style.transform).toContain('translate(-40px, -30px)');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('Girar gira 90° por clique', async () => {
    const dialog = await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: 'Girar' }));
    expect(within(dialog).getByAltText('comprovante.jpg').style.transform).toContain('rotate(90deg)');
  });

  test('o percentual é anunciado sem role="status"', async () => {
    await abrirVisualizador();
    const pct = screen.getByText('100%');
    expect(pct).toHaveAttribute('aria-live', 'polite');
    expect(pct).not.toHaveAttribute('role');
  });

  test('arrasto por toque com a imagem ampliada', async () => {
    const dialog = await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    const imagem = within(dialog).getByAltText('comprovante.jpg');
    fireEvent.touchStart(imagem, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 200, clientY: 120 }] });
    fireEvent.touchEnd(window);
    expect(imagem.style.transform).not.toContain('translate(0px, 0px)');
  });

  test('setas movem a imagem ampliada', async () => {
    const dialog = await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(within(dialog).getByAltText('comprovante.jpg').style.transform).toContain('translate(40px, 0px)');
  });

  // A guarda do topo não tinha teste: apagá-la não quebrava nada (prova em
  // cópia, 24/09/2026).
  test('com outra camada por cima, as setas não mexem na imagem', async () => {
    const dialog = await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    function CamadaPorCima() {
      useDialogLayer(true, () => {});
      return null;
    }
    render(<CamadaPorCima />);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(within(dialog).getByAltText('comprovante.jpg').style.transform).toContain('translate(0px, 0px)');
  });
```

(`within`, `waitFor` e `fireEvent` entram no import de `@testing-library/react` se ainda não estiverem.) Os testes de zoom pelos botões, roda do mouse, arrasto por mouse, "fechar e abrir de novo" e "clicar no fundo fecha, mas arrastar a imagem não" continuam como estão.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/MessageAttachment.test.jsx`
Expected: FAIL nos novos e nos dois reescritos.

- [ ] **Step 3: Implementar**

Props: `MessageAttachment({ message, avatar, dark = false, onAnalyzeReceipt, autor })` (`:703`), e a chamada do `ImageBubble` (`:761-769`) passa também `autor={autor} quando={message.createdAt} legenda={message.content || null}`. Na `MessageBubble` (E2.4), o anexo recebe o autor — o mesmo rótulo da bolha:

```jsx
        <MessageAttachment
          message={message}
          dark
          autor={saida ? (daIa ? 'Assistente IA' : 'Atendente') : nomeDoContato}
          onAnalyzeReceipt={onAnalisarComprovante}
          avatar={…como está…}
        />
```

No `ImageBubble` (`:307`), assinatura `function ImageBubble({ url, urlAgora, onFalha, alt, filename, hasCaption, dark, autor, quando, legenda })`, e:

- Estado novo `const [giro, setGiro] = useState(0);`; `resetView` continua zerando zoom e deslocamento; `closeViewer` também zera o giro.
- O foco inicial (`:336-345`) passa a preferir o marcado: `const alvo = visorRef.current.querySelector('[data-autofocus]') || primeiroFocavel(visorRef.current) || visorRef.current;`.
- O ouvinte de teclado (`:356-367`) só age com o visor no topo e ganha as setas:

```jsx
  useEffect(() => {
    if (!open) return undefined;
    const PASSO = 40;
    const onKey = (event) => {
      // ESC é da pilha. As teclas daqui só valem com o visor no topo: um
      // diálogo aberto por cima não pode ter o zoom mexido por baixo.
      if (!camadaDoVisualizador.topo) return;
      if (event.key === '+' || event.key === '=') applyZoom(zoom + ZOOM_STEP);
      if (event.key === '-') applyZoom(zoom - ZOOM_STEP);
      if (event.key === '0') resetView();
      if (zoom > ZOOM_MIN) {
        const passos = { ArrowLeft: [PASSO, 0], ArrowRight: [-PASSO, 0], ArrowUp: [0, PASSO], ArrowDown: [0, -PASSO] };
        const passo = passos[event.key];
        if (passo) {
          event.preventDefault();
          setOffset((o) => ({ x: o.x + passo[0], y: o.y + passo[1] }));
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, zoom, camadaDoVisualizador.topo]);
```

- O arrasto (`:369-392`) ganha o toque, com a mesma guarda:

```jsx
  useEffect(() => {
    if (!open) return undefined;
    function mover(x, y) {
      if (!dragRef.current) return;
      draggedRef.current = true;
      setOffset({ x: dragRef.current.offsetX + (x - dragRef.current.startX), y: dragRef.current.offsetY + (y - dragRef.current.startY) });
    }
    const onMove = (event) => mover(event.clientX, event.clientY);
    const onTouchMove = (event) => event.touches[0] && mover(event.touches[0].clientX, event.touches[0].clientY);
    const soltar = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', soltar);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', soltar);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', soltar);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', soltar);
    };
  }, [open]);

  function comecarArrasto(x, y) {
    if (zoom <= ZOOM_MIN) return false;
    draggedRef.current = false;
    dragRef.current = { startX: x, startY: y, offsetX: offset.x, offsetY: offset.y };
    return true;
  }
```

- Baixar:

```jsx
  // Baixar pelo blob: (mesma origem, o `download` vale). O `download` num link
  // para outra origem é ignorado, e a rota de imagem não manda
  // Content-Disposition: a aba do app navegava para a imagem crua (MSG-IMG-12).
  // Se a busca falhar, abre numa nova aba — nunca na do app.
  async function baixar(event) {
    event.stopPropagation();
    const endereco = urlAgora ? urlAgora() : url;
    try {
      const resposta = await fetch(endereco);
      if (!resposta.ok) throw new Error(String(resposta.status));
      const objeto = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a');
      link.setAttribute('href', objeto);
      link.setAttribute('download', filename || 'imagem');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objeto), 0);
    } catch {
      window.open(endereco, '_blank', 'noopener');
    }
  }
```

  (`useHrefNaHoraDoClique` e a variável `baixar` do topo do `ImageBubble` saem — o `urlAgora()` é chamado na hora do clique, que era o que ele garantia. O `DocumentCard` continua usando o hook.)

- O portal (`:415-500`) passa a:

```jsx
      {open && failedUrl !== url && createPortal(
        <div
          ref={visorRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={nomeDoVisor}
          onKeyDown={(event) => prenderTabEm(visorRef.current, event)}
          onClick={() => {
            // Soltar o mouse fora da imagem depois de arrastar não pode fechar.
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            closeViewer();
          }}
          onWheel={(event) => applyZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))}
          style={{ zIndex: camadaDoVisualizador.zIndex }}
          className="chat-theme fixed inset-0 flex flex-col bg-fundo"
        >
          {/* Uma barra só, que RESERVA espaço: nada fica por cima da imagem
              (N10). Quebra em duas linhas estreita — continua reservada. */}
          <div onClick={(event) => event.stopPropagation()} className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-linha bg-painel px-4 py-2">
            {autor || dataDaMensagem ? (
              <div className="hidden min-w-0 flex-1 min-[360px]:block">
                {autor ? <p className="truncate text-corpo font-semibold text-tinta">{autor}</p> : null}
                {dataDaMensagem ? <p className="text-meta tabular-nums text-tinta-2">{dataDaMensagem}</p> : null}
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <ViewerButton label="Diminuir zoom" onClick={() => applyZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
                <IconZoomOut size={20} />
              </ViewerButton>
              <span aria-live="polite" className="min-w-[3.5rem] text-center text-rotulo tabular-nums text-tinta">
                {Math.round(zoom * 100)}%
              </span>
              <ViewerButton label="Aumentar zoom" onClick={() => applyZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
                <IconZoomIn size={20} />
              </ViewerButton>
              {zoom > ZOOM_MIN ? (
                <button type="button" onClick={resetView} className="h-9 rounded-ui-md px-3 text-rotulo font-medium text-tinta hover:bg-hover">
                  Ajustar
                </button>
              ) : null}
              <ViewerButton label="Girar" onClick={() => setGiro((g) => (g + 90) % 360)}>
                <IconRefresh size={20} />
              </ViewerButton>
              <button type="button" onClick={baixar} className="flex h-9 items-center gap-1.5 rounded-ui-md px-3 text-rotulo font-medium text-tinta hover:bg-hover">
                <span aria-hidden="true" className="inline-flex"><IconDownload size={18} /></span>
                Baixar
              </button>
              <span aria-hidden="true" className="mx-1 h-6 w-px bg-linha" />
              <ViewerButton label="Fechar imagem" onClick={closeViewer} autofoco>
                <IconClose size={20} />
              </ViewerButton>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
            <img
              src={url}
              alt={alt || 'Imagem'}
              onError={() => { if (!onFalha || !onFalha()) { setFailedUrl(url); setOpen(false); } }}
              draggable={false}
              onClick={(event) => {
                event.stopPropagation();
                // Em 100 % o clique amplia 2× NO PONTO clicado (o cursor
                // prometia). Com translate por fora do scale, manter o ponto
                // parado é deslocar pelo oposto da distância ao centro.
                if (zoom !== ZOOM_MIN || draggedRef.current) return;
                const caixa = event.currentTarget.getBoundingClientRect();
                const cx = caixa.left + caixa.width / 2;
                const cy = caixa.top + caixa.height / 2;
                setZoom(2);
                setOffset({ x: -(event.clientX - cx), y: -(event.clientY - cy) });
              }}
              onDoubleClick={() => (zoom > ZOOM_MIN ? resetView() : applyZoom(2))}
              onMouseDown={(event) => { if (comecarArrasto(event.clientX, event.clientY)) event.preventDefault(); }}
              onTouchStart={(event) => { const t = event.touches[0]; if (t) comecarArrasto(t.clientX, t.clientY); }}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${giro}deg)`,
                cursor: zoom > ZOOM_MIN ? 'grab' : 'zoom-in',
              }}
              className="max-h-full max-w-full select-none object-contain transition-transform duration-75"
            />
          </div>

          {legenda ? (
            <p onClick={(event) => event.stopPropagation()} className="max-h-[4.5rem] shrink-0 overflow-y-auto whitespace-pre-wrap break-words border-t border-linha bg-painel px-4 py-2 text-corpo text-tinta">
              {legenda}
            </p>
          ) : null}
        </div>,
        document.body
      )}
```

  com, antes do `return`:

```jsx
  const dataDaMensagem = quando && !Number.isNaN(new Date(quando).getTime())
    ? new Date(quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  const nomeDoVisor = [autor ? `Imagem de ${autor}` : 'Imagem', dataDaMensagem].filter(Boolean).join(', ');
```

- `ViewerButton` (`:503-514`) em tokens, com o `data-autofocus` opcional e sem `title`:

```jsx
function ViewerButton({ label, onClick, disabled, autofoco = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-autofocus={autofoco ? '' : undefined}
      className="grid h-9 w-9 place-items-center rounded-ui-md text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
```

- Imports de ícone do arquivo ganham `IconClose`, `IconZoomIn`, `IconZoomOut`, `IconRefresh` e `IconDownload` (de `./icons/IconesTrabalho`).

O giro por `rotate()` no mesmo `transform` não troca a caixa da imagem: uma foto alta girada 90° pode passar das bordas do palco em 100 % — aceitável (o palco tem `overflow-hidden` e o zoom/arrasto alcançam o resto); conferir no harness que nada **cobre** a barra.

Em `overlays.css`, apagar a regra do ✕ do visor (`.dialog-image-viewer …`, `:206`) e as de `.dialog-image-zoom`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/MessageAttachment.test.jsx src/components/ConversationView src/components/ConversationHistoryModal.test.jsx`
Expected: PASS.

**[Prova na cópia, 24/09/2026]** Provar a guarda do topo: apagar `if (!camadaDoVisualizador.topo) return;` e rodar `MessageAttachment.test.jsx -t "outra camada"`.
Expected: FAIL (a seta move a imagem por baixo da camada de cima). Desfazer.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageAttachment.jsx frontend/src/components/MessageAttachment.test.jsx frontend/src/components/MessageBubble.jsx frontend/src/components/overlays.css
git commit -m "E2.5: visualizador com barra no topo que reserva espaco, girar e baixar sem sair do app"
```

---

### Task 7: Encerrados como diálogo mestre-detalhe; o modal de conversa como consulta

**Files:**
- Create: `frontend/src/utils/dataCurta.js`, `frontend/src/utils/dataCurta.test.js`
- Rewrite: `frontend/src/components/ClosedConversationsModal.jsx`; Modify: `frontend/src/components/ClosedConversationsModal.test.jsx`
- Delete: `frontend/src/components/ClosedConversationsList.jsx`
- Modify: `frontend/src/hooks/useMyClosedConversations.js` (erro do "Carregar mais"); `frontend/src/hooks/useMyClosedConversations.test.jsx` (existe; ganha o teste do erro)
- Modify: `frontend/src/estilo/acentoUnico.test.js` (`ConversationListItem.jsx` sai de `PENDENCIAS`)
- Modify: `frontend/src/components/ConversationListItem.jsx` (sai a variante não compacta; `previaDe` exportado); `ConversationListItem.test.jsx`
- Modify: `frontend/src/components/ConversationModal.jsx`, `ConversationModal.test.jsx`
- Modify: `frontend/src/components/overlays.css` (saem `.dialog-closed-*`, `[data-dialog=closed]`, `[data-dialog=conversation]` e as larguras declaradas)

**Decisão 10 (B):** um diálogo só, **mestre-detalhe**, de largura fixa — lista de 332 px à esquerda, a conversa encerrada à direita, em modo leitura, com os mesmos botões de cabeçalho (Histórico, SGP, Cliente); abaixo de 1052 px de janela, lista → detalhe no mesmo envelope com "← Encerrados" (o padrão do Histórico). Sai o modal empilhado (ler 5 atendimentos eram 10 cliques). `grupo-C.md` §2.3 "em qualquer opção": item de **2 linhas** — nome e **data de encerramento** ("14:32" se hoje, "ontem", "12/09"; hoje só a hora da última mensagem, numa lista que atravessa dias); prévia na linha 2; localidade, setor e triagem no nome acessível e no painel Cliente; a ficha do dono sai (é sempre o próprio atendente); seleção visível (`aria-current` + fundo + barra); "Carregar mais" que falha diz e oferece "Tentar de novo" sem apagar o que já está na tela (CVM-ENC-11); erro da 1ª carga com "Tentar de novo"; a contagem "{n}+" sai. A variante não compacta do `ConversationListItem` deixa de ter uso e sai. O `ConversationModal` (Supervisão) vira diálogo de consulta: o × já mora no cabeçalho da conversa desde a E2.4 e o painel de informações já saiu; aqui ele perde as regras de `overlays.css` que vazavam para o compositor (CVM-MOD-07).

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/utils/dataCurta.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { dataCurta } from './dataCurta';

const AGORA = new Date(2026, 8, 24, 16, 0);

describe('dataCurta', () => {
  test('hoje: a hora; ontem: "ontem"; este ano: dia/mês; antes: com o ano', () => {
    expect(dataCurta(new Date(2026, 8, 24, 14, 32), AGORA)).toBe('14:32');
    expect(dataCurta(new Date(2026, 8, 23, 9, 5), AGORA)).toBe('ontem');
    expect(dataCurta(new Date(2026, 8, 12, 9, 5), AGORA)).toBe('12/09');
    expect(dataCurta(new Date(2025, 11, 30, 9, 5), AGORA)).toBe('30/12/2025');
  });

  test('sem data ou data ilegível: null', () => {
    expect(dataCurta(null, AGORA)).toBeNull();
    expect(dataCurta('não é data', AGORA)).toBeNull();
  });
});
```

Em `ClosedConversationsModal.test.jsx`, o `describe('empilhamento…')` inteiro sai (não há mais modal empilhado) e entra:

```jsx
describe('E2.5: mestre-detalhe (decisão 10)', () => {
  const HOJE = new Date();
  const ITENS = [
    { ...CLOSED_CONVERSATION, closedAt: HOJE.toISOString(), lastMessageContent: 'Obrigado!', contactCityName: 'Cândido Mendes', sectorName: 'Financeiro', assignedAgentName: 'Eu' },
    { id: 'c-2', contactDisplayName: 'Bruno', status: 'closed', assignedAgentId: 'agent-1', closedAt: '2026-01-05T10:00:00.000Z', lastMessageType: 'image' },
  ];

  beforeEach(() => {
    useMyClosedConversations.mockReturnValue({ items: ITENS, hasMore: false, loading: false, status: 'ready', loadMore: vi.fn(), refresh: vi.fn(), erroAoCarregarMais: false });
  });

  test('a conversa abre no MESMO diálogo, sem modal empilhado', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^Ana Encerrada/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.querySelector('[data-dialog="conversation"]')).toBeNull();
  });

  test('linha de 2 linhas: nome e data de encerramento; prévia; sem ficha do dono', () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    const ana = screen.getByRole('button', { name: /^Ana Encerrada/ });
    expect(ana).toHaveTextContent(/\d{2}:\d{2}/);
    expect(ana).toHaveTextContent('Obrigado!');
    expect(ana).not.toHaveTextContent('Eu');
    expect(screen.getByRole('button', { name: /^Bruno/ })).toHaveTextContent('05/01');
    expect(screen.getByRole('button', { name: /^Bruno/ })).toHaveTextContent('Foto');
  });

  test('localidade e setor vão para o nome acessível', () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Ana Encerrada/ })).toHaveAccessibleName(/Cândido Mendes.*Financeiro/);
  });

  test('largo: lista e conversa lado a lado; a escolhida marcada', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1366 });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByText('Escolha um atendimento na lista.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Ana Encerrada/ }));
    expect(screen.getByRole('button', { name: /^Ana Encerrada/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^Bruno/ })).toBeInTheDocument();
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
  });

  test('estreito: lista → detalhe com "← Encerrados" e volta', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 800 });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^Ana Encerrada/ }));
    expect(screen.queryByRole('button', { name: /^Bruno/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Encerrados' }));
    expect(screen.getByRole('button', { name: /^Bruno/ })).toBeInTheDocument();
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
  });

  test('a conversa encerrada fica só leitura, com o rodapé de encerrada', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^Ana Encerrada/ }));
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
    expect(screen.getByText(/somente leitura/)).toBeInTheDocument();
  });

  test('"Carregar mais" que falha diz e oferece "Tentar de novo", sem apagar a lista', async () => {
    const loadMore = vi.fn();
    useMyClosedConversations.mockReturnValue({ items: ITENS, hasMore: true, loading: false, status: 'ready', loadMore, refresh: vi.fn(), erroAoCarregarMais: true });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar mais atendimentos.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^Bruno/ })).toBeInTheDocument();
  });

  test('erro da 1ª carga com "Tentar de novo"', async () => {
    const refresh = vi.fn();
    useMyClosedConversations.mockReturnValue({ items: [], hasMore: false, loading: false, status: 'error', loadMore: vi.fn(), refresh, erroAoCarregarMais: false });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('sem a contagem "{n}+" no título', () => {
    useMyClosedConversations.mockReturnValue({ items: ITENS, hasMore: true, loading: false, status: 'ready', loadMore: vi.fn(), refresh: vi.fn(), erroAoCarregarMais: false });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Encerrados');
  });
});
```

Os testes que já existem continuam: "shows the agent's closed conversations", "closing the dialog calls onClose" (pelo ×), "selecting a closed conversation opens it read-only…", "clicking Carregar mais calls loadMore" e "em carregamento não mostra…". O mock do `useMyClosedConversations` no `beforeEach` do arquivo ganha `erroAoCarregarMais: false`, e o arquivo simula também `useSgpLookup`, `useCities`, `useSectors`, `useReasons` e `useAiSuggestion` como `ConversationView.test.jsx` faz (a `ConversationView` do detalhe os chama).

**[Prova na cópia, 24/09/2026]** Em `ConversationListItem.test.jsx`, os testes da variante não compacta (os que renderizam sem `compact` nem `rail`) saem junto com ela — conferir com `grep -n "compact\|rail" src/components/ConversationListItem.test.jsx`. **Exceto o `describe('hora mostrada na linha')`**. A hora continua na linha compacta (a de chegada, na fila, por `showArrivalTime`), e ele era o único teste dela: o teste da linha da E2.3 passa `showArrivalTime`, mas não afirma a hora. Ele fica, com `compact` nas duas montagens (a do `renderItem` e a do terceiro teste). Ao pé da letra, a regra apagava 49 testes, entre eles este. O que os outros cobriam e continua valendo (rótulo de mídia sem emoji, Pix sem código) está nos testes da linha compacta da E2.3.

**[Prova na cópia, 24/09/2026]** Em `useMyClosedConversations.test.jsx`, o erro do "Carregar mais" ganha teste. Sem ele, apagar o `setErroAoCarregarMais(true)` não quebrava nada, porque o teste do diálogo simula o hook:

```jsx
  test('"Carregar mais" que falha avisa e não apaga a lista; a nova tentativa limpa o aviso (CVM-ENC-11)', async () => {
    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c1' }], hasMore: true });
    const { result } = renderHook(() => useMyClosedConversations());
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'c1' }]));
    expect(result.current.erroAoCarregarMais).toBe(false);

    api.getMyClosedConversations.mockRejectedValue({ status: 500, body: {} });
    await act(() => result.current.loadMore());
    expect(result.current.erroAoCarregarMais).toBe(true);
    expect(result.current.items).toEqual([{ id: 'c1' }]);
    expect(result.current.loading).toBe(false);

    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c2' }], hasMore: false });
    await act(() => result.current.loadMore());
    expect(result.current.erroAoCarregarMais).toBe(false);
    expect(result.current.items).toEqual([{ id: 'c1' }, { id: 'c2' }]);
  });
```

Em `ConversationModal.test.jsx`, acrescentar:

```jsx
  test('diálogo de consulta: nada de overlays.css vaza para o compositor', () => {
    render(<ConversationModal conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Ana' }} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-dialog', 'conversation');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/utils/dataCurta.test.js src/components/ClosedConversationsModal.test.jsx src/components/ConversationModal.test.jsx src/hooks/useMyClosedConversations.test.jsx`
Expected: FAIL nos novos.

- [ ] **Step 3: Implementar a data curta e o erro do "Carregar mais"**

`frontend/src/utils/dataCurta.js`:

```js
function pad(n) {
  return String(n).padStart(2, '0');
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Data curta para lista que atravessa dias: "14:32" (hoje), "ontem", "12/09"
// (este ano), "30/12/2025" (antes). No fuso do navegador.
export function dataCurta(valor, agora = new Date()) {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  if (mesmoDia(data, agora)) return `${pad(data.getHours())}:${pad(data.getMinutes())}`;
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(data, ontem)) return 'ontem';
  const diaMes = `${pad(data.getDate())}/${pad(data.getMonth() + 1)}`;
  return data.getFullYear() === agora.getFullYear() ? diaMes : `${diaMes}/${data.getFullYear()}`;
}
```

`useMyClosedConversations.js`: estado novo `const [erroAoCarregarMais, setErroAoCarregarMais] = useState(false);`; no `loadMore`, `setErroAoCarregarMais(false)` antes do pedido e, no `.catch`, `setErroAoCarregarMais(true)` junto do `setLoading(false)` — antes o erro voltava calado (CVM-ENC-11); o retorno passa a `{ items, hasMore, loading, status, loadMore, refresh, erroAoCarregarMais }`.

- [ ] **Step 4: Reescrever o diálogo**

`frontend/src/components/ClosedConversationsModal.jsx` inteiro:

```jsx
import { useEffect, useState } from 'react';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import ConversationView from './ConversationView';
import { previaDe } from './ConversationListItem';
import { AsyncState, Button } from './ui';
import { Dialog } from './ui/Dialog';
import { dataCurta } from '../utils/dataCurta';
import { nomeDoLocal } from '../utils/place';
import { IconArrowLeft } from './icons/IconesTrabalho';

// Abaixo disto a lista (332) e a conversa (piso de 420 + painel) não cabem
// lado a lado no diálogo: lista → detalhe no mesmo envelope, como o Histórico.
const LARGURA_MESTRE_DETALHE = 1052;

function useLargo() {
  const [largo, setLargo] = useState(() => window.innerWidth >= LARGURA_MESTRE_DETALHE);
  useEffect(() => {
    const medir = () => setLargo(window.innerWidth >= LARGURA_MESTRE_DETALHE);
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);
  return largo;
}

// Linha de 2 linhas: nome e DATA de encerramento (a lista atravessa dias —
// antes era só a hora da última mensagem); a prévia embaixo. A ficha do dono
// saiu: é sempre o próprio atendente. Localidade, setor e triagem ficam no
// nome acessível e no painel Cliente.
function LinhaDoEncerrado({ conversation, selecionada, onAbrir }) {
  const nome = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const quando = dataCurta(conversation.closedAt);
  const contexto = [
    nomeDoLocal(conversation.contactLocalityName, conversation.contactCityName),
    conversation.sectorName,
    conversation.aiTriageResolvedByAi ? 'resolvido pela IA' : null,
  ].filter(Boolean);
  return (
    <li className="border-b border-linha last:border-b-0">
      <button
        type="button"
        onClick={() => onAbrir(conversation)}
        aria-current={selecionada ? 'true' : undefined}
        className={`relative flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors duration-120 ${selecionada ? 'bg-selecionado' : 'hover:bg-hover'}`}
      >
        {selecionada ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" /> : null}
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-nome font-semibold text-tinta">{nome}</span>
          {quando ? <span className="shrink-0 text-meta tabular-nums text-tinta-3">{quando}</span> : null}
        </span>
        <span className="truncate text-rotulo text-tinta-2">{previaDe(conversation).rotulo}</span>
        {contexto.length > 0 ? <span className="sr-only">, {contexto.join(', ')}</span> : null}
      </button>
    </li>
  );
}

function ClosedConversationsModal({ onClose }) {
  const { items, hasMore, loading, status, loadMore, refresh, erroAoCarregarMais } = useMyClosedConversations();
  const [selecionada, setSelecionada] = useState(null);
  const largo = useLargo();

  const lista = (
    <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
      <AsyncState status={status} isEmpty={items.length === 0} onRetry={refresh} esqueleto="linhas" emptyMessage="Nenhum atendimento encerrado ainda.">
        <ul>
          {items.map((conversation) => (
            <LinhaDoEncerrado key={conversation.id} conversation={conversation} selecionada={selecionada?.id === conversation.id} onAbrir={setSelecionada} />
          ))}
        </ul>
        {hasMore ? (
          <div className="p-3">
            {erroAoCarregarMais ? <p role="alert" className="mb-2 text-rotulo text-perigo">Não foi possível carregar mais atendimentos.</p> : null}
            <Button variant="secondary" size="sm" className="w-full" onClick={loadMore} disabled={loading}>
              {loading ? 'Carregando…' : erroAoCarregarMais ? 'Tentar de novo' : 'Carregar mais'}
            </Button>
          </div>
        ) : null}
      </AsyncState>
    </div>
  );

  // A conversa encerrada em modo leitura, com os botões de cabeçalho de sempre
  // (Histórico, SGP, Cliente) e o rodapé "Atendimento encerrado em …".
  const detalhe = selecionada ? (
    <ConversationView key={selecionada.id} conversation={selecionada} onTransferClick={() => {}} />
  ) : (
    <p className="m-auto px-6 text-center text-corpo text-tinta-2">Escolha um atendimento na lista.</p>
  );

  return (
    <Dialog
      variant="closed-list"
      title="Encerrados"
      onClose={onClose}
      closeOnBackdrop
      size="max-w-[1100px]"
      className="h-[min(760px,calc(100dvh-2rem))]"
    >
      {largo ? (
        <div className="flex min-h-0 flex-1 border-t border-linha">
          <div className="flex w-[332px] shrink-0 flex-col border-r border-linha">{lista}</div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{detalhe}</div>
        </div>
      ) : selecionada ? (
        <div className="flex min-h-0 flex-1 flex-col border-t border-linha">
          <button
            type="button"
            onClick={() => setSelecionada(null)}
            className="flex h-11 shrink-0 items-center gap-2 border-b border-linha bg-painel px-4 text-rotulo font-semibold text-accent-soft"
          >
            <IconArrowLeft size={18} />
            Encerrados
          </button>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{detalhe}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t border-linha">{lista}</div>
      )}
    </Dialog>
  );
}

export default ClosedConversationsModal;
```

(`variant="closed-list"` e não `"closed"`: as regras antigas de `[data-dialog=closed]` — três larguras declaradas — saem de `overlays.css` nesta tarefa, e o nome novo garante que nenhuma sobra pega. O `key` na `ConversationView` monta uma por atendimento: aqui não há rascunho a preservar, e todo estado da conversa anterior morre junto.)

Apagar `ClosedConversationsList.jsx` (a lista mora no diálogo).

- [ ] **Step 5: Tirar a variante não compacta do item da lista**

Em `ConversationListItem.jsx`: a variante não compacta (o ramo final do `return`, `:199-295` na numeração de hoje, depois de `if (rail)` e `if (compact)`) sai, e com ela as props `divided` e `soLocalidade` e o que só ela usava — na prova, `local` e `previewText` (conferir cada nome e cada import com `grep` depois de apagar). **[Prova na cópia, 24/09/2026]** **`showArrivalTime` e `formatMessageTime` ficam**: a linha compacta os usa (`formatMessageTime(showArrivalTime ? conversation.createdAt : conversation.lastMessageAt)`). Apagá-los, como este passo dizia, quebra **toda** linha da lista ("formatMessageTime is not defined"). `previaDe` passa a `export function previaDe`. Se, sem a variante, o componente só tiver `compact` e `rail`, o ramo `compact` vira o padrão: `compact` continua aceito (os chamadores da E2.3 o passam) e sem efeito.

- [ ] **Step 6: O modal de conversa como diálogo de consulta**

`ConversationModal.jsx` (depois da E2.4, que tirou o painel de informações e pôs o × no cabeçalho):

```jsx
import ConversationView from './ConversationView';
import { Dialog } from './ui/Dialog';

// Aberto a partir da Supervisão. Diálogo de CONSULTA (E.1-2): o fechar mora no
// cabeçalho da própria conversa ("Fechar conversa", E2.4); ESC fecha, clique
// no fundo não — há uma caixa de mensagem aqui dentro, e texto digitado e não
// enviado é trabalho que não pode sumir por engano.
function ConversationModal({ conversation, onClose, onTransferClick }) {
  return (
    <Dialog
      variant="conversa-modal"
      size="max-w-6xl"
      ariaLabel="Conversa"
      initialFocus="dialog"
      onClose={onClose}
      dismissible={false}
      closeOnBackdrop={false}
      className="h-[min(820px,calc(100dvh-2rem))]"
    >
      <ConversationView conversation={conversation} onTransferClick={onTransferClick} onFechar={onClose} />
    </Dialog>
  );
}

export default ConversationModal;
```

(`variant` deixa de ser `"conversation"`: as regras de `[data-dialog=conversation]` em `overlays.css` — que davam ao compositor 13 px, raio 7 e alça de redimensionar (CVM-MOD-07) — saem, e nenhuma sobra pega pelo nome novo. `orientation="row"` e `className="chat-workspace"` saem: o painel lateral mora dentro da `ConversationView` desde a E2.4, e o CSS da conversa não depende mais de `.chat-workspace`.)

Em `overlays.css`, apagar `.dialog-closed-*`, `.dialog-conversation-info`, e toda regra de `[data-dialog=closed]` e `[data-dialog=conversation]` (conferir com `grep -n "closed\|conversation" src/components/overlays.css`).

- [ ] **Step 7: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/utils/dataCurta.test.js src/components/ClosedConversationsModal.test.jsx src/components/ConversationModal.test.jsx src/components/ConversationListItem.test.jsx src/components/SideNav src/pages/SupervisionPage.test.jsx src/hooks src/estilo`
Expected: PASS — inclusive a Supervisão, que abre o `ConversationModal`. **[Prova na cópia, 24/09/2026]** O acento único acusa `components/ConversationListItem.jsx` limpo: ele sai de `PENDENCIAS`.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src/utils/dataCurta.js frontend/src/utils/dataCurta.test.js frontend/src/components/ClosedConversationsModal.jsx frontend/src/components/ClosedConversationsModal.test.jsx frontend/src/components/ClosedConversationsList.jsx frontend/src/hooks/useMyClosedConversations.js frontend/src/hooks/useMyClosedConversations.test.jsx frontend/src/components/ConversationListItem.jsx frontend/src/components/ConversationListItem.test.jsx frontend/src/components/ConversationModal.jsx frontend/src/components/ConversationModal.test.jsx frontend/src/components/overlays.css frontend/src/estilo/acentoUnico.test.js
git commit -m "E2.5: Encerrados como dialogo mestre-detalhe, sem modal empilhado; modal de conversa como consulta"
```

---

### Task 8: Meu perfil — duas vistas, uma ação em cada

**Files:**
- Rewrite: `frontend/src/components/ProfileModal.jsx`; Modify: `frontend/src/components/ProfileModal.test.jsx`
- Modify: `frontend/src/components/overlays.css` (saem as regras de `[data-dialog=profile]`)

Apêndice E.2 e `grupo-C.md` §3: largura **única de 520 px**, uma coluna, **duas vistas no mesmo envelope**. **"Meu perfil":** linha do avatar (foto 64 + "Alterar foto" e "Remover foto" como botões secundários **neutros** — sai o vermelho, que não é confirmação destrutiva; enviando, "Enviando foto…"); Nome e Telefone empilhados (nome aparado; vazio → "Informe o nome." no campo); "E-mail — é o seu acesso; não muda por aqui." uma vez só; linha "Senha › Trocar senha" que abre a segunda vista; rodapé `[Cancelar][Salvar]` com "Salvando…" e "Perfil salvo." que some na próxima edição. **"Trocar senha":** "← Meu perfil" no topo; Senha atual, Nova, Confirmar empilhadas; "As senhas não coincidem." **no campo Confirmar**; senha atual errada → "A senha atual está incorreta." **no campo Senha atual**, sem deslogar (PRF-12); rodapé `[Voltar][Trocar senha]` ("Trocando…"); sucesso volta à vista principal com "Senha alterada." no mesmo lugar do status. **Carregando:** o mesmo envelope com esqueleto; **erro:** frase + "Tentar de novo" + rodapé `[Fechar]`. **Fechar com edição** (Cancelar, ESC; não há ×) com nome/telefone alterados ou algum campo de senha preenchido → "Descartar alterações?" `[Continuar editando][Descartar]`, perigo só no "Descartar". Saem: cartão de identidade, h3 "Dados pessoais" e a frase, `<details>`, a grade de 3 colunas, o e-mail repetido, as duas ações de envio na mesma vista (hoje "Salvar alterações" ignora a senha preenchida e nada avisa).

- [ ] **Step 1: Atualizar e escrever os testes**

Em `ProfileModal.test.jsx`:

- "changes the password from the embedded section" passa a navegar para a vista de senha:

```jsx
  test('troca a senha pela vista própria, e o sucesso volta ao perfil', async () => {
    api.changePassword.mockResolvedValue({});
    render(<ProfileModal onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /trocar senha/i }));
    await userEvent.type(screen.getByLabelText('Senha atual'), 'velha123');
    await userEvent.type(screen.getByLabelText('Nova senha'), 'nova12345');
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'nova12345');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('velha123', 'nova12345', 'tok-123'));
    expect(await screen.findByText('Senha alterada.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });
```

- "shows an error when the confirmation password does not match": **[Prova na cópia, 24/09/2026]** a navegação muda — o clique em `getByText('Atualize sua senha de acesso.')` (o `<details>`, que sai) passa a `getByRole('button', { name: /trocar senha/i })` —, e o erro passa a ser **do campo** Confirmar — `expect(screen.getByLabelText('Confirmar nova senha')).toHaveAccessibleDescription('As senhas não coincidem.')`.
- "shows an error and a working Fechar button when the initial profile fetch fails" **continua achando "Sessão expirada"** e ganha "Tentar de novo": `expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();`. **[Prova na cópia, 24/09/2026]** Decisão do proprietário (24/09): a mensagem do servidor fica. Trocar "Sessão expirada" por uma frase genérica tira a única informação que diz ao atendente o que fazer; a frase fixa é só a reserva. E acrescentar:

```jsx
  test('Tentar de novo recarrega o perfil depois da falha', async () => {
    api.getMyProfile.mockRejectedValueOnce({ body: { error: 'Sessão expirada' } });
    render(<ProfileModal onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));
    expect(await screen.findByDisplayValue('Ana')).toBeInTheDocument();
  });
```
- "saves name and phone" passa a clicar `'Salvar'` (era "Salvar alterações") e o rótulo do campo é "Nome" (era "Nome completo").

E acrescentar:

```jsx
describe('E2.5: duas vistas, uma ação em cada', () => {
  test('uma largura em todos os estados', async () => {
    let entregar;
    api.getMyProfile.mockReturnValue(new Promise((r) => { entregar = r; }));
    render(<ProfileModal onClose={vi.fn()} />);
    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[520px\]/);
    entregar(PERFIL);
    await screen.findByLabelText('Nome');
    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[520px\]/);
  });

  test('uma ação por vista: o perfil não tem campo de senha nem outro envio', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByLabelText('Nome');
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^salvar$/i })).toHaveLength(1);
    expect(screen.getAllByText(PERFIL.email)).toHaveLength(1);
  });

  test('senha atual errada: erro NO CAMPO e a sessão fica (PRF-12)', async () => {
    api.changePassword.mockRejectedValue({ status: 401, body: { error: 'Current password is incorrect' } });
    render(<ProfileModal onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /trocar senha/i }));
    await userEvent.type(screen.getByLabelText('Senha atual'), 'errada');
    await userEvent.type(screen.getByLabelText('Nova senha'), 'nova12345');
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'nova12345');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await waitFor(() => expect(screen.getByLabelText('Senha atual')).toHaveAccessibleDescription('A senha atual está incorreta.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('nome só com espaços: "Informe o nome." no campo, sem chamar a API', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    const nome = await screen.findByLabelText('Nome');
    await userEvent.clear(nome);
    await userEvent.type(nome, '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(nome).toHaveAccessibleDescription('Informe o nome.');
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  test('"Salvando…" e "Perfil salvo." que some na próxima edição', async () => {
    let terminar;
    api.updateMyProfile.mockReturnValue(new Promise((r) => { terminar = r; }));
    render(<ProfileModal onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText('Telefone'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    terminar({ ...PERFIL, phone: `${PERFIL.phone || ''}9` });
    expect(await screen.findByText('Perfil salvo.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Telefone'), '1');
    expect(screen.queryByText('Perfil salvo.')).not.toBeInTheDocument();
  });

  test('fechar com edição pede confirmação; sem edição fecha direto (PRF-17)', async () => {
    const onClose = vi.fn();
    render(<ProfileModal onClose={onClose} />);
    await userEvent.type(await screen.findByLabelText('Telefone'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('sem edição, Cancelar fecha sem perguntar', async () => {
    const onClose = vi.fn();
    render(<ProfileModal onClose={onClose} />);
    await screen.findByLabelText('Nome');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('"Remover foto" é neutro e "Alterar foto" mostra o envio', async () => {
    api.getMyProfile.mockResolvedValue({ ...PERFIL, avatarPath: 'a.jpg' });
    let terminar;
    api.uploadMyAvatar.mockReturnValue(new Promise((r) => { terminar = r; }));
    render(<ProfileModal onClose={vi.fn()} />);
    expect((await screen.findByRole('button', { name: 'Remover foto' })).className).not.toMatch(/perigo|error/);
    await userEvent.upload(screen.getByLabelText('Alterar foto'), new File(['x'], 'f.png', { type: 'image/png' }));
    expect(screen.getByText('Enviando foto…')).toBeInTheDocument();
    terminar({ avatarPath: 'b.jpg' });
  });
});
```

(`PERFIL` é o perfil que o arquivo já monta no `getMyProfile.mockResolvedValue` do `beforeEach` — se ele estiver escrito inline, extrair para uma constante `PERFIL` no topo e usar nos dois lugares. `ProfileModal.senhaErrada.test.jsx`, do PRF-12, continua valendo — ele exercita a `apiFetch` real e o `AuthProvider` —, com um ajuste de navegação no fim do Step 3.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ProfileModal.test.jsx src/components/ProfileModal.senhaErrada.test.jsx`
Expected: FAIL nos novos e nos reescritos; `senhaErrada` PASS (o PRF-12 já está na base).

- [ ] **Step 3: Reescrever o diálogo**

`frontend/src/components/ProfileModal.jsx` inteiro:

```jsx
import { useCallback, useEffect, useId, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadMyAvatar, deleteMyAvatar, changePassword } from '../services/api';
import AgentAvatar from './AgentAvatar';
import { Button } from './ui';
import { Dialog, DialogBody, DialogFooter } from './ui/Dialog';
import { useConfirm } from '../hooks/useConfirm';
import { descreverErro } from '../utils/errorMessages';
import { IconArrowLeft, IconCheck, IconChevronRight } from './icons/IconesTrabalho';

const CAMPO = 'h-9 w-full rounded-ui-md bg-campo px-3 text-corpo text-tinta outline-none placeholder:text-tinta-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-60';
const ROTULO = 'mb-1 block text-rotulo font-medium text-tinta-2';

function Campo({ id, rotulo, erro, ...props }) {
  return (
    <div>
      <label htmlFor={id} className={ROTULO}>{rotulo}</label>
      <input id={id} aria-invalid={erro ? 'true' : 'false'} aria-describedby={erro ? `${id}-erro` : undefined} className={CAMPO} {...props} />
      {erro ? <p id={`${id}-erro`} role="alert" className="mt-1 text-rotulo text-perigo">{erro}</p> : null}
    </div>
  );
}

// Um envelope, duas vistas (grupo C §3.3): cada uma com UMA ação principal.
// Antes "Salvar alterações" e "Trocar senha" dividiam a vista, e quem
// preenchia a senha e clicava "Salvar alterações" não trocava a senha.
function ProfileModal({ onClose, onProfileUpdated }) {
  const { token, updateAgent } = useAuth();
  const { confirm: confirmar, confirmDialog } = useConfirm();
  const id = useId();
  const [profile, setProfile] = useState(null);
  const [loadStatus, setLoadStatus] = useState('loading');
  const [erroDeCarga, setErroDeCarga] = useState(null);
  const [vista, setVista] = useState('perfil');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [status, setStatus] = useState(null); // 'Perfil salvo.' | 'Senha alterada.' | null
  const [avatarBusy, setAvatarBusy] = useState(null); // 'enviando' | 'removendo' | null
  const [avatarError, setAvatarError] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errosDaSenha, setErrosDaSenha] = useState({});
  const [submittingPassword, setSubmittingPassword] = useState(false);

  const carregar = useCallback(() => {
    setLoadStatus('loading');
    getMyProfile(token)
      .then((data) => {
        setProfile(data);
        setName(data.name);
        setPhone(data.phone || '');
        setLoadStatus('ready');
      })
      .catch((err) => {
        // O motivo do servidor fica ("Sessão expirada" diz ao atendente o que
        // fazer); a frase fixa é só a reserva (decisão do proprietário, 24/09).
        setErroDeCarga(descreverErro(err, 'Não foi possível carregar o seu perfil.'));
        setLoadStatus('error');
      });
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const editado = Boolean(profile) && (name !== profile.name || phone !== (profile.phone || ''));
  const senhaPreenchida = Boolean(currentPassword || newPassword || confirmPassword);

  // Fechar com edição pergunta (PRF-17); sem edição fecha direto. Vale para
  // Cancelar e ESC — o diálogo é de ação, sem ×.
  async function fecharComCuidado() {
    if (!editado && !senhaPreenchida) {
      onClose();
      return;
    }
    const descartar = await confirmar('O que você mudou aqui ainda não foi salvo.', {
      title: 'Descartar alterações?',
      confirmLabel: 'Descartar',
      cancelLabel: 'Continuar editando',
      danger: true,
    });
    if (descartar) onClose();
  }

  function editarNome(valor) {
    setName(valor);
    setNameError(null);
    setStatus(null);
  }

  function editarTelefone(valor) {
    setPhone(valor);
    setStatus(null);
  }

  async function handleSaveProfile(event) {
    event.preventDefault();
    setProfileError(null);
    setStatus(null);
    // O `required` nativo deixava passar só espaços e voltava com o nome
    // técnico do campo (PRF-06/08).
    const nomeAparado = name.trim();
    if (!nomeAparado) {
      setNameError('Informe o nome.');
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await updateMyProfile({ name: nomeAparado, phone }, token);
      setProfile(updated);
      setName(updated.name);
      setPhone(updated.phone || '');
      updateAgent({ name: updated.name });
      setStatus('Perfil salvo.');
      if (onProfileUpdated) onProfileUpdated();
    } catch (err) {
      setProfileError(descreverErro(err, 'Não foi possível salvar o perfil.'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy('enviando');
    try {
      const result = await uploadMyAvatar(file, token);
      setProfile((prev) => ({ ...prev, avatarPath: result.avatarPath }));
      updateAgent({ avatarPath: result.avatarPath });
      if (onProfileUpdated) onProfileUpdated();
    } catch (err) {
      setAvatarError(descreverErro(err, 'Não foi possível enviar a foto.'));
    } finally {
      setAvatarBusy(null);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarBusy('removendo');
    try {
      await deleteMyAvatar(token);
      setProfile((prev) => ({ ...prev, avatarPath: null }));
      updateAgent({ avatarPath: null });
      if (onProfileUpdated) onProfileUpdated();
    } catch (err) {
      setAvatarError(descreverErro(err, 'Não foi possível remover a foto.'));
    } finally {
      setAvatarBusy(null);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setErrosDaSenha({});
    if (newPassword !== confirmPassword) {
      setErrosDaSenha({ confirmar: 'As senhas não coincidem.' });
      return;
    }
    setSubmittingPassword(true);
    try {
      await changePassword(currentPassword, newPassword, token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus('Senha alterada.');
      setVista('perfil');
    } catch (err) {
      // Senha atual errada é erro DO CAMPO — e não desloga (PRF-12: a rota
      // de troca manda a credencial no pedido; o 401 dela não é sessão).
      const texto = descreverErro(err, 'Não foi possível trocar a senha.');
      if (err && err.status === 401) setErrosDaSenha({ atual: texto });
      else setErrosDaSenha({ geral: texto });
    } finally {
      setSubmittingPassword(false);
    }
  }

  const ocupado = savingProfile || submittingPassword || Boolean(avatarBusy);

  let conteudo;
  if (loadStatus !== 'ready') {
    conteudo = (
      <>
        <DialogBody>
          {loadStatus === 'loading' ? (
            <div role="status" className="flex items-center gap-4">
              <span className="sr-only">Carregando…</span>
              <span aria-hidden="true" className="h-16 w-16 rounded-full bg-hover motion-safe:animate-pulse" />
              <span aria-hidden="true" className="flex flex-1 flex-col gap-3">
                <span className="h-9 rounded-ui-md bg-hover motion-safe:animate-pulse" />
                <span className="h-9 rounded-ui-md bg-hover motion-safe:animate-pulse" />
              </span>
            </div>
          ) : (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ui-md bg-perigo-fundo px-3 py-2 text-rotulo text-perigo">
              <span>{erroDeCarga}</span>
              <Button size="sm" variant="secondary" onClick={carregar}>Tentar de novo</Button>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </>
    );
  } else if (vista === 'senha') {
    conteudo = (
      <form onSubmit={handleChangePassword} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-3">
          <button type="button" onClick={() => setVista('perfil')} className="flex items-center gap-1.5 text-rotulo font-semibold text-accent-soft">
            <IconArrowLeft size={16} />
            Meu perfil
          </button>
          <Campo id={`${id}-atual`} rotulo="Senha atual" type="password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setErrosDaSenha({}); }} erro={errosDaSenha.atual} disabled={submittingPassword} />
          <Campo id={`${id}-nova`} rotulo="Nova senha" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={submittingPassword} />
          <Campo id={`${id}-confirmar`} rotulo="Confirmar nova senha" type="password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setErrosDaSenha({}); }} erro={errosDaSenha.confirmar} disabled={submittingPassword} />
        </DialogBody>
        <DialogFooter erro={errosDaSenha.geral || null}>
          <Button variant="secondary" onClick={() => setVista('perfil')} disabled={submittingPassword}>Voltar</Button>
          <Button type="submit" loading={submittingPassword}>{submittingPassword ? 'Trocando…' : 'Trocar senha'}</Button>
        </DialogFooter>
      </form>
    );
  } else {
    conteudo = (
      <form onSubmit={handleSaveProfile} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <AgentAvatar agentId={profile.id} avatarPath={profile.avatarPath} name={profile.name} size={64} />
            <div className="flex flex-wrap items-center gap-2">
              <label className={`inline-flex h-9 cursor-pointer items-center rounded-ui-md border border-linha px-3 text-rotulo font-medium text-tinta hover:bg-hover ${avatarBusy ? 'pointer-events-none opacity-60' : ''}`}>
                {avatarBusy === 'enviando' ? 'Enviando foto…' : 'Alterar foto'}
                <input type="file" aria-label="Alterar foto" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarChange} disabled={Boolean(avatarBusy)} className="sr-only" />
              </label>
              {profile.avatarPath ? (
                <Button variant="secondary" size="sm" onClick={handleRemoveAvatar} disabled={Boolean(avatarBusy)}>
                  {avatarBusy === 'removendo' ? 'Removendo…' : 'Remover foto'}
                </Button>
              ) : null}
            </div>
          </div>
          {avatarError ? <p role="alert" className="text-rotulo text-perigo">{avatarError}</p> : null}
          <Campo id={`${id}-nome`} rotulo="Nome" value={name} onChange={(e) => editarNome(e.target.value)} erro={nameError} disabled={savingProfile} />
          <Campo id={`${id}-telefone`} rotulo="Telefone" value={phone} onChange={(e) => editarTelefone(e.target.value)} disabled={savingProfile} />
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-linha pt-3">
            <span className="text-rotulo text-tinta-3">E-mail</span>
            <span className="min-w-0">
              <span className="block truncate text-corpo text-tinta">{profile.email}</span>
              <span className="block text-rotulo text-tinta-2">É o seu acesso; não muda por aqui.</span>
            </span>
            <span className="text-rotulo text-tinta-3">Senha</span>
            <button type="button" onClick={() => { setStatus(null); setVista('senha'); }} className="flex items-center gap-1 justify-self-start text-corpo font-medium text-accent-soft">
              Trocar senha
              <IconChevronRight size={16} />
            </button>
          </div>
          {/* O status do perfil: "Perfil salvo." ou "Senha alterada." — some na
              próxima edição (PRF-09). Com ícone em tinta: não existe cor de
              sucesso (5.2.2). */}
          <p role="status" className="flex min-h-5 items-center gap-1.5 text-rotulo text-tinta">
            {status ? <><span aria-hidden="true" className="text-tinta-2"><IconCheck size={16} /></span>{status}</> : null}
          </p>
        </DialogBody>
        <DialogFooter erro={profileError}>
          <Button variant="secondary" onClick={fecharComCuidado} disabled={savingProfile}>Cancelar</Button>
          <Button type="submit" loading={savingProfile}>{savingProfile ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <>
      <Dialog
        variant="perfil"
        title={vista === 'senha' ? 'Trocar senha' : 'Meu perfil'}
        onClose={fecharComCuidado}
        size="max-w-[520px]"
        dismissible={false}
        ocupado={ocupado}
      >
        {conteudo}
      </Dialog>
      {confirmDialog}
    </>
  );
}

export default ProfileModal;
```

Três conferências ao implementar:

- **`useConfirm`** devolve `{ confirm, confirmDialog }` (`hooks/useConfirm.jsx:38`, com `title` desde a E2.2). O diálogo de confirmação empilha sobre o perfil pela pilha: ESC fecha só a confirmação, e o foco volta ao "Cancelar".
- **ESC com edição:** o `onClose` do `Dialog` é o `fecharComCuidado` — o ESC passa pela mesma pergunta que o Cancelar.
- **O `role="status"` do perfil** é o único do diálogo; o esqueleto do carregando também usa `role="status"`, mas os dois nunca estão montados juntos.

Em `overlays.css`, apagar as regras de `[data-dialog=profile]`.

**[Prova na cópia, 24/09/2026]** Com a vista nova, o auxiliar `trocarSenha` de `ProfileModal.senhaErrada.test.jsx` (PRF-12) quebra ("Unable to find an element with the text: Atualize sua senha de acesso."): ele abria a troca de senha clicando no `<details>`, que saiu. Trocar `await userEvent.click(screen.getByText('Atualize sua senha de acesso.'));` por `await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));`. O resto do auxiliar fica, e os dois testes continuam provando o PRF-12: senha atual errada não desloga.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ProfileModal.test.jsx src/components/ProfileModal.senhaErrada.test.jsx src/components/SideNav src/services/api.test.js`
Expected: PASS — inclusive o PRF-12 (a troca com senha errada não desloga; um 401 de sessão expirada em outra rota ainda desloga).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProfileModal.jsx frontend/src/components/ProfileModal.test.jsx frontend/src/components/ProfileModal.senhaErrada.test.jsx frontend/src/components/overlays.css
git commit -m "E2.5: Meu perfil em duas vistas com uma acao cada; descartar alteracoes pergunta"
```

---

### Task 9: Fechamento da E2.5

- [ ] **Step 1: `overlays.css` só com a base e o legado**

Run: `cd frontend && grep -n "data-dialog=\|\.dialog-" src/components/overlays.css`
Expected: nenhuma regra dos overlays da mesa (`close-reason`, `transfer`, `send-template`, `start-conversation`, `history`, `closed`, `conversation`, `profile`, `image-viewer`, `sgp-panel`, `quick-replies`, `emoji-picker`, `contact-fields`); o que sobrar de algum deles sai agora. **[Prova na cópia, 24/09/2026]** Sobram, e ficam, a base da E2.2 (`.dw-dialog-*`), as regras opt-in `.dw-dialog--legado …` e as dos diálogos de fora da mesa, que são de outras etapas. Na prova, sobraram:

- Campanhas: `[data-dialog=campaign]` e `.dialog-campaign-*`;
- Configurações: `[data-dialog=templates|users|sector|reason|city]`, `.dialog-provider-*`, `.dialog-channel-*` e `.dialog-sector-assignment`;
- Supervisão: `.dialog-filter-options`;
- `DataTable`: `.dialog-context-menu`;
- ajuda de seção: `[data-dialog=help]`.

Cada seletor que sobrar tem de ter dono fora da mesa (`grep -rn` no JSX).

- [ ] **Step 2: Nenhum overlay da mesa passa pelo `WaDialog`**

Run: `cd frontend && grep -ln "WaDialog" src/components/*.jsx src/pages/*.jsx`
Expected: só arquivos de Configurações (E6) — nenhum de `CloseReasonModal`, `TransferModal`, `StartConversationModal`, `SendTemplateModal`, `ConversationHistoryModal`, `ClosedConversationsModal`, `ConversationModal`, `ProfileModal`, `EditContactModal` (apagado), `TeamModal` (apagado na E2.3).

- [ ] **Step 3: Pendências do acento**

Run: `cd frontend && npx vitest run src/estilo`
Expected: **[Prova na cópia, 24/09/2026]** passa, e `PENDENCIAS` já não tem os arquivos que as Tasks 1–8 limparam. Na prova, saíram `components/closeReasonCatalog.jsx`, `components/TransferModal.jsx`, `components/SendTemplateModal.jsx` e `components/ConversationListItem.jsx`. `components/MessageAttachment.jsx` continua na lista, porque o áudio escuro fica. `StartConversationModal`, `ConversationHistoryModal`, `ProfileModal` e `ClosedConversationsList` nunca estiveram nela (a lista da E2.1 não os tem). Se o teste acusar outro arquivo limpo, tirar da lista até passar.

- [ ] **Step 4: Registro S × C**

Acrescentar ao registro da E2 (`docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md`) a seção "E2.5 — overlays", uma linha por mudança do Apêndice E.2 que a tarefa fez, com a classe. Exemplo:

| Overlay | Antes | Depois | Classe |
|---|---|---|---|
| Encerrar | cartões de 68 px com ladrilho colorido, 820 px | linhas-rádio, 640 px, legenda visível do grupo | S |
| Encerrar | vermelho no ícone de abertura | vermelho no botão que encerra | C |
| Transferir | 9 elementos e 5 cores por linha, 760 px | 4 elementos em 2 linhas, 480 px | S |
| Transferir | escolha some com a busca | escolha fixada acima dos grupos | S |
| Enviar template | 2 colunas com a direita vazia, 864 px | uma coluna, 576 px | S |
| Iniciar conversa | estado dos canais dito 2×, 2 `role="status"` | dito 1× no lugar do campo | S |
| Histórico | migalha + resumo redundantes; bolha própria | "←" no cabeçalho; a bolha da conversa | S |
| Visualizador | controles flutuando sobre a imagem | barra no topo que reserva espaço | S |
| Encerrados | popup + modal empilhado; grade de cartões | um diálogo mestre-detalhe; lista de 2 linhas com data | S |
| Meu perfil | duas ações de envio numa vista, 896 px | duas vistas, uma ação cada, 520 px | S |

- [ ] **Step 5: Suíte e commit**

Run: `cd frontend && npx vitest run`
Expected: só as falhas antigas conhecidas (ver plano mestre).

```bash
git add frontend/src/estilo/acentoUnico.test.js frontend/src/components/overlays.css docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md
git commit -m "E2.5: pendencias do acento, overlays.css so com base e legado, registro S x C"
```
