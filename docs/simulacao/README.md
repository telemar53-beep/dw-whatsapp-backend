# Simulação multiturno com a OpenAI real — como preparar

Este guia é versionado. O que ele manda você criar mora em `.local/`, que **não vai
para o Git** (está no `.gitignore`) e **não contém segredo**.
Essa pasta existe para a simulação (`src/ai/simulacao-real.test.js`) conversar com a OpenAI
usando **a mesma configuração que roda em produção** — porque validar um prompt
diferente do de produção não valida nada.

---

## A chave da OpenAI NÃO entra aqui

A chave vem **só** de `process.env.OPENAI_API_KEY`, em tempo de execução.

- Ela não é escrita em arquivo nenhum, nem neste.
- Ela não é impressa, nem mascarada, nem em log, nem na transcrição, nem na mensagem
  de erro quando falta.
- Se `ia-config.json` tiver um campo `apiKey`, a simulação **recusa rodar**.

Antes de rodar, exporte a variável no seu terminal (ela vive só naquela janela):

```bash
# Git Bash / Linux / macOS
export OPENAI_API_KEY='...'
SIMULACAO_REAL=1 npm test -- src/ai/simulacao-real.test.js
```

```powershell
# PowerShell
$env:OPENAI_API_KEY = '...'
$env:SIMULACAO_REAL = '1'
npm test -- src/ai/simulacao-real.test.js
```

Sem `SIMULACAO_REAL=1` a simulação fica **pulada** e o `npm test` de todo dia não muda
em nada.

---

## O que você precisa colocar aqui

### 1. `ia-config.json` (obrigatório)

Copie de `docs/simulacao/ia-config.exemplo.json` e preencha com os valores **do seu painel**
(Configurações → Integrações → OpenAI, e a aba da triagem). Os campos obrigatórios são
`model`, `maxToolsPerInteraction`, `triageMaxQuestions` e `triageConfidenceThreshold`.

Eles não são cosméticos: `triageMaxQuestions` decide em que turno a conclusão é
forçada, e `maxToolsPerInteraction` decide quando o turno para de consultar. Um número
diferente do painel muda o comportamento e a simulação passa a validar outra coisa.

`triageResolvedReasonId` merece atenção: é o motivo de "encerramento pela IA".
**Com ele preenchido**, a IA entrega o boleto e *não* conclui a triagem (espera o
cliente agradecer) — que é o estado de que o roteiro 17 precisa para continuar o 14.
**Sem ele**, o roteiro 14 conclui a triagem ao entregar, a conversa sai da triagem, e o
17 falha dizendo exatamente isso. Se for usar, aponte para um id que exista em
`setores-motivos.json`.

### 2. `prompt-sistema.txt` (obrigatório)

O conteúdo do campo **"Prompt do sistema"** do painel, copiado e colado, sem editar.

### 3. `instrucoes-operacao.txt` (obrigatório)

O conteúdo do campo **"Instruções adicionais da operação"** do painel, copiado e colado,
sem editar.

A partir da Task 16 este texto é a **única** fonte de planos, preços, cobertura,
promoções e documentação. Se ele vier vazio, a simulação roda, mas os roteiros
comerciais (4, 5, 6, 10) validam uma IA que não tem o que responder — e a revisão
humana deles perde o sentido.

### 4. `setores-motivos.json` (opcional)

Só se você quiser rodar com os **seus** setores e motivos em vez dos de teste. Copie de
`docs/simulacao/setores-motivos.exemplo.json`. Cada item precisa do campo `papel`, que é como os
roteiros se referem ao setor sem escrever o nome dele:

- setores: `suporte`, `financeiro`, `comercial`, `reativacao`
- motivos: o `papel` é livre; `resolvido-pela-ia` é o que casa com `triageResolvedReasonId`

Sem este arquivo, a simulação usa um catálogo de teste embutido
(`src/ai/simulacao/sgp-falso.js`) — com nomes como "Suporte de Teste", que servem bem
para validar comportamento.

---

## O que NÃO vem daqui

O SGP é **simulado** (`src/ai/simulacao/sgp-falso.js`): clientes, contratos, faturas,
conexão e desbloqueio são de mentira, e nenhuma chamada sai para o SGP de verdade.
Nada é enviado ao cliente: fila, disco, socket e envio de PIX/boleto estão todos
mockados. Os nomes ali são "Fulano de Teste", "Rua de Teste, 100" — e precisam
continuar assim, porque a IA de verdade lê esses dados e pode repeti-los.

## Onde sai o resultado

`output/simulacao/NN-nome.md`, um arquivo por roteiro, com a conversa turno a turno,
as ferramentas pedidas e executadas, o estado antes e depois de cada turno, o resumo
entregue ao atendente e a lista **Para revisão humana** — as perguntas que a máquina
não decide e você precisa ler. A pasta também está no `.gitignore`.
