# Modo noturno com IA — design

Data: 2026-09-13. Base: `main` @ 5399915 (triagem com IA em produção, com entrega de boleto/PIX, encerramento sozinha, roteiros de Suporte e Comercial, janela de cortesia, identidade pela memória).

## 1. Objetivo

Fora do horário comercial, a IA atende o cliente do começo ao fim sem um atendente por trás: entrega boleto e PIX, lê comprovante de pagamento, faz o desbloqueio em confiança quando a regra da casa permite, orienta problemas de conexão e deixa na fila da manhã tudo o que precisa de gente, com o resumo do que já foi feito.

Não é um motor novo. É a **triagem de hoje com um perfil noturno**: as mesmas ferramentas, mais duas (desbloqueio em confiança e leitura de comprovante), frases de desfecho diferentes e um limite de perguntas maior.

## 2. Decisões do dono (2026-09-13)

| # | Decisão |
|---|---------|
| 1 | Comprovante é **lido com visão** (OpenAI): valor, data, favorecido, tipo. Não vale a palavra do cliente. |
| 2 | Janela noturna = **fora do horário comercial já configurado** no admin (mesma configuração da auto-resposta). Sábado e domingo contam como fora. |
| 3 | Com o modo noturno ligado no canal, a **auto-resposta fora do horário não é enviada**: a IA é a primeira a falar. |
| 4 | À noite, depois de entregar boleto ou PIX, a IA **encerra sozinha** como de dia (mesmo motivo configurado no cartão de triagem). |
| 5 | **Desbloqueio em confiança só no modo noturno.** De dia a triagem continua sem ele. |

## 3. Quando o modo noturno está ativo

Por turno da IA (não por conversa), para o canal da conversa:

```
noturno = channel.aiEnabled
       && channel.aiTriageEnabled
       && channel.aiNightModeEnabled          (coluna nova, sai false)
       && businessHours.enabled
       && isOutsideBusinessHours(businessHours)
```

Uma conversa que começa 19:55 e continua 20:10 vira noturna no turno das 20:10. Uma que começa 07:50 e continua 08:05 volta a ser diurna. O horário de retorno citado ao cliente é `businessHours.startTime` ("a partir das 08:00"), nunca um número fixo no prompt. Se o horário comercial estiver desligado no admin, o modo noturno nunca ativa (não há "fora do horário").

## 4. Ativação e configuração

- **Canal:** interruptor "Atendimento noturno com IA" em Admin → Canais, ao lado de "Triagem com IA". Só habilitável com a triagem ligada; desligar a triagem desliga o noturno junto (mesma cascata que hoje desliga a triagem quando "Usar IA" desliga). Coluna `channels.ai_night_mode_enabled BOOLEAN NOT NULL DEFAULT false`.
- **Nenhum campo novo de horário.** Vale o cartão "Horário comercial" existente.
- **Motivos:** o admin cadastra "Comprovante" e "Desbloqueio em confiança" em Motivos de contato; o prompt manda usar esses nomes se existirem, senão `null`.
- **Sem cartão novo na tela de IA.** O que muda de comportamento à noite está no prompt e no código, não em configuração.

## 5. O perfil noturno na triagem

`handleTriageTurn` (ai-worker) calcula `noturno` e passa `triagem.noturno = { ativo: true, retornoAs: '08:00' }` para `runAiTurn`. Com isso:

1. **Ferramentas:** a lista fixa da triagem ganha `desbloqueio_confianca` e `analisar_comprovante` **só quando `noturno.ativo`**. De dia elas não existem para o modelo (regra: não descrever capacidade ausente).
2. **Limite de perguntas:** `triageMaxQuestions + 2` à noite. O roteiro de conexão pede "uma etapa por vez" (luzes, reiniciar, aguardar), e de madrugada não há custo em perguntar mais uma vez.
3. **Frases de desfecho** trocam "um atendente continua daqui" por "nossa equipe dá continuidade a partir das 08:00". As instruções das ferramentas `concluir_triagem` e `encerrar_atendimento` recebem `retornoAs` e devolvem a frase certa.
4. **Fluxos que não mudam:** boleto/PIX com vários contratos, encerramento após entrega, Comercial, janela de cortesia, identidade pela memória, saudação da hora, "nunca diga que não conseguiu verificar", anúncio obriga conclusão.
5. **Bloco noturno no prompt** (só quando ativo):
   - "Estamos fora do horário comercial: não há atendente agora. Você atende sozinha o que as ferramentas permitem e deixa na fila, com resumo, o que precisa de gente. A equipe volta às {retornoAs}. Nunca prometa solução imediata."
   - Roteiro do comprovante (seção 6), roteiro de conexão noturno (seção 7).

## 6. Comprovante e desbloqueio em confiança

### 6.1 Leitura do comprovante — ferramenta `analisar_comprovante`

- **Só à noite, só com identidade forte, sem parâmetros.** O modelo nunca escolhe arquivo: a ferramenta busca no banco a **última imagem recebida do cliente nesta conversa nas últimas 24 h** (`messages` com `direction = 'inbound'`, `message_type = 'image'`). Documento PDF não entra na versão 1 (só imagem).
- **Validação antes de sair do servidor:** MIME em `image/jpeg`, `image/png`, `image/webp`; tamanho até 5 MB; arquivo existe em `media-storage`. Fora disso → `{ analisado: false, motivo }`.
- **Visão:** `openai-client.analyzeImage({ apiKey, model, imageBuffer, mimeType, prompt })` → `chat/completions` com `content: [{ type: 'text' }, { type: 'image_url', image_url: { url: 'data:<mime>;base64,...' } }]` e `response_format: { type: 'json_object' }`. Modelo: `config.model` (o mesmo do chat; gpt-4o-mini, gpt-4.1 e superiores leem imagem). Se o modelo recusar imagem (erro 400), a ferramenta devolve `analisado: false`. Timeout 60 s.
- **Prompt de visão** (fixo, em código): extrair `{ ehComprovante, tipo: 'pix'|'boleto'|'transferencia'|'outro', valor (número em reais), data (AAAA-MM-DD), favorecido, banco, confianca (0-1) }`. Só JSON.
- **Conferência em código, nunca pelo modelo:**
  - `ehComprovante === true` e `confianca >= 0.6`;
  - `favorecido` contém "DW" ou o nome do recebedor Pix cadastrado no SGP (`pixMerchantName`), comparação sem acento/caixa;
  - `data` nos últimos 7 dias (fuso de São Paulo), inclusive hoje;
  - `valor` igual ao de alguma fatura em aberto do contrato (`getDuplicateInvoice`), tolerância de R$ 0,05; com vários contratos, procura em todos (mesma busca de `faturaEmAlgumContrato`) e devolve o contrato encontrado.
- **Retorno:** `{ analisado: true, valido: boolean, tipo, valor, data, favorecidoConfere, dataConfere, valorConfere, contratoId, faturaId, motivos: [...] }`. O CPF, o nome completo e a imagem não entram no retorno. A auditoria (`ai_interactions`) grava o retorno com `valor`/`data` (não são dados sensíveis); nunca a imagem nem o texto bruto da visão.
- **Marca no contexto:** `contexto.comprovante = { valido, contratoId, faturaId, valor, data }`.

### 6.2 Desbloqueio — ferramenta `desbloqueio_confianca` (existente)

- Continua com a regra da casa (`trust-unlock-rules`): contrato suspenso; uma liberação a cada 30 dias; nunca se a anterior não foi paga; `promessasPagamentoMes` do SGP.
- À noite, **antes de executar**, a IA envia a frase de aviso; **só depois do sucesso** a frase de "prontinho"; **só depois de concluir na fila** a frase "já deixei seu atendimento na fila". As três garantias são de código (seção 8), não de prompt.
- Pedido de desbloqueio **sem comprovante** ("paguei, libera"): a ferramenta decide pela regra da casa. Se liberar, a mesma frase de "pagamento será conferido". Se recusar, frase de acolhimento com o motivo e fila do Financeiro.
- Comprovante **inválido** (valor não bate, favorecido errado, data velha): não desbloqueia. A IA diz que não conseguiu conferir o pagamento com esse comprovante, pede outro se fizer sentido (uma vez), e deixa na fila do Financeiro com o que a visão leu no resumo.
- Comprovante válido com **contrato ativo** (não suspenso): só agradece, fila do Financeiro para baixa, sem desbloqueio.

### 6.3 Frases (ditadas pelo dono)

- Aviso antes de executar: "Recebi seu comprovante, {Nome}! Como nossa equipe retorna a partir das {retornoAs}, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência."
- Sucesso: "Prontinho, {Nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das {retornoAs}. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?"
- Falha/recusa: "{Nome}, recebi seu comprovante e ele já está registrado para a equipe conferir a partir das {retornoAs}. Não consegui liberar o acesso em confiança agora: {motivo em uma frase}. Assim que o pagamento for confirmado, a liberação é automática."

### 6.4 Fila da manhã

`concluir_triagem` para o Financeiro, motivo "Desbloqueio em confiança" (ou "Comprovante", se não liberou), resumo prefixado por:

```
Modo noturno · 23:12
Comprovante (visão): PIX R$ 135,00 em 13/09/2026, favorecido confere, fatura 4321 do contrato 17402 — Agenor Costa, 523
Desbloqueio em confiança: REALIZADO (3 dias) | RECUSADO: <motivo>
Pendente: conferir pagamento e dar baixa
```

O comprovante já fica na conversa (é a mensagem de imagem); o painel do atendente mostra o resumo e a aba do SGP abre com o cliente.

## 7. Problemas de conexão à noite

Mesmos três roteiros de Suporte (ativo/online, offline, suspenso), com a consulta única de status antes de responder. Diferenças:

- Depois da pergunta de diagnóstico, **até duas etapas simples**, uma por mensagem: "Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?" e "A luz voltou a ficar verde?". Cabe no limite noturno.
- Desfecho: "Vou deixar seu atendimento na fila do Suporte com tudo o que verificamos. Nossa equipe dá continuidade a partir das {retornoAs}." Sem prometer técnico nem prazo.
- Suspenso por pendência: o roteiro existente, e se o cliente mandar comprovante, seção 6.

## 8. Garantias em código (o prompt não basta)

Generalização da guarda de "anúncio sem conclusão" já existente em `runAiTurn`: um **verificador de afirmações** sobre o texto final do turno na triagem, uma volta a mais no máximo:

| Se o texto afirma… | …só pode sair se | Senão |
|---|---|---|
| "vou encaminhar / repassar / setor" | `contexto.triagemConcluida` | força `concluir_triagem` (já existe) |
| "desbloqueio realizado / acesso liberado / prontinho, foi liberado" | `contexto.desbloqueioRealizado === true` neste turno | mensagem de sistema "você afirmou uma liberação que não aconteceu; responda com a frase de falha/recusa" e nova geração sem ferramentas |
| "deixei na fila / registrei para a equipe" | `contexto.triagemConcluida` | força `concluir_triagem` |

`desbloqueio_confianca` passa a marcar `contexto.desbloqueioRealizado = true` quando `liberado: true`. A frase de aviso ("vou verificar a possibilidade…") é enviada pelo próprio código da ferramenta como mensagem separada (`enqueueOutboundMessage`, `sentBy: 'ai'`) **antes** de chamar o SGP — assim ela sempre precede a execução, independente do modelo.

## 9. Auto-resposta fora do horário

Em `inbound-message.service`: o aviso de fora do horário só é enviado se o canal **não** estiver com o modo noturno ativo (mesma condição da seção 3). Com o noturno ativo, a IA responde e o `businessHoursNoticeSentAt` não é marcado.

## 10. Segurança

- A imagem sai do servidor só para a OpenAI, como base64, depois de validar MIME e tamanho; o caminho do arquivo nunca aparece em retorno de ferramenta, log ou auditoria.
- O modelo não escolhe qual imagem analisar nem informa valor/favorecido: tudo é lido pela visão e conferido em código.
- Nenhum novo dado vai para a OpenAI além do que já ia: a imagem (decisão do dono) e os campos numéricos do retorno.
- Desbloqueio: mesma regra da casa, mesma exigência de identidade forte, mesmo registro em `ai_trust_unlocks`.
- Nada de novo em log: `mensagemSegura` nos erros, sem CPF, sem valor de fatura nem texto da visão.
- Se a IA estiver desligada (canal ou global), o modo noturno não existe e a auto-resposta volta a ser enviada.

## 11. Testes

- Unitários por peça: gate `isNightModeActive` (fuso, fim de semana, flags), lista de ferramentas noturna, limite +2, frases com `retornoAs`, `analisar_comprovante` (validação de arquivo, conferência de valor/data/favorecido, modelo recusando imagem, vários contratos), guardas de afirmação (liberação sem sucesso, fila sem conclusão), auto-resposta suprimida.
- Manual (dono): mudar o fim do horário comercial para a hora atual, ligar o noturno no canal, e rodar: boleto → encerra; comprovante válido em contrato suspenso (26515) → aviso, desbloqueio, prontinho, fila do Financeiro com resumo; comprovante com valor errado → recusa e fila; "paguei, libera" sem comprovante → regra da casa; internet offline → duas etapas e fila do Suporte com "a partir das 08:00". Voltar o horário comercial ao normal.

## 12. Ordem de entrega

1. Flag do canal, migração, toggle no admin, gate `isNightModeActive`, supressão da auto-resposta.
2. Perfil noturno no worker/prompt: ferramentas, limite, frases com `retornoAs`, resumo "Modo noturno · HH:MM".
3. Visão: `analyzeImage` no cliente OpenAI + ferramenta `analisar_comprovante` com as conferências.
4. Fluxo do desbloqueio à noite: aviso enviado pela ferramenta, `desbloqueioRealizado`, verificador de afirmações, frases de sucesso/falha, motivo e resumo.
5. Roteiro de conexão noturno no prompt.
6. Teste manual (roteiro da seção 11).

## 13. Fora do escopo (fica anotado)

- Ler comprovante em PDF.
- Abrir chamado técnico no SGP à noite (`/api/ura/chamado/` existe; entra quando o roteiro de conexão estiver estável).
- Modo automático de dia (conversa inteira sem atendente no horário comercial).
- Relatório de atendimentos noturnos (o filtro "IA" do dashboard cobre o básico).
