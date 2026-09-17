# IA de atendimento: revisão profunda do comportamento

**Data:** 2026-09-17
**Status:** spec para revisão — nenhuma linha de código alterada ainda
**Escopo:** comportamento da IA na triagem (perfil `triagem`), montagem do prompt, ferramentas, schemas e regras de fluxo

---

## 1. Diagnóstico

Tudo nesta seção foi verificado lendo o código, com arquivo e linha. Nada aqui é suposição.

### 1.1 Como o prompt é montado hoje

**Não existem três prompts.** Existe um único construtor, `montarContextoTriagem`
(`src/ai/ai-orchestrator.js:332-668`), que monta um array `linhas` com condicionais e o
entrega inteiro como mensagem `system`. As três versões observadas (identificado, não
identificado, noturno) são três *renderizações* do mesmo construtor com entradas
diferentes.

São 44 KB de código-fonte de strings. O prompt renderizado vai **inteiro, em toda
mensagem** — incluindo os roteiros de Suporte quando o assunto é Comercial, e os roteiros
de Comercial quando o assunto é Suporte.

Existe um segundo construtor, `montarContextoSistema` (`ai-orchestrator.js:200-248`), bem
menor, usado no perfil `assistente` (quando há um humano acompanhando). Está fora do
escopo desta entrega, exceto pelos pontos que compartilha.

Origem de cada bloco:

| Bloco | Origem | Situação |
|---|---|---|
| Prompt do sistema | `config.systemPrompt` (tabela `ai_config`, editável no painel) | preservar |
| Instruções adicionais da operação | `config.triageExtraInstructions` (painel) | preservar |
| Setores | `listSectors()` — inclui `aiHint` ("dicas dos setores") | preservar |
| Motivos | `listActiveReasons()` | preservar |
| Nome da empresa | `getCompanyConfig()` | já correto |
| Cidades (transcrição de áudio) | `listCities()` | já correto |
| Todo o resto | literal em `ai-orchestrator.js` | é o objeto desta revisão |

### 1.2 A origem da data de nascimento

São cinco caminhos independentes. O primeiro é a causa provável dos prints de produção e
**não depende de nenhuma configuração**.

**Caminho 1 — `tool-executor.js:25` e `:106` (causa raiz).**

> `'Identidade ainda não confirmada. Pergunte a data de nascimento e chame confirmar_nascimento; depois chame esta ferramenta de novo. Não peça o CPF de novo.'`

Esse texto é devolvido ao modelo como **resultado de ferramenta** sempre que qualquer uma
das **7 ferramentas** marcadas com `exigeIdentidadeForte` é chamada enquanto
`identidade.nivel !== 'forte'` no perfil de triagem. Não há nenhuma verificação da flag
`triageRequireBirthdate`.

Três consequências:

- Resultado de ferramenta é lido pelo modelo como **fato apurado**, não como sugestão.
  Pesa mais do que qualquer proibição escrita no prompt. É por isso que a regra "NUNCA
  peça data de nascimento" foi ignorada duas vezes em produção.
- `analisar_comprovante` tem `exigeIdentidadeForte: true`. Um cliente ainda não
  identificado que envia o comprovante produz exatamente esta sequência: ferramenta
  recusada → modelo recebe "Pergunte a data de nascimento" → modelo pede a data. É o
  print de 2026-09-17 17:53.
- A ferramenta que essa instrução manda chamar (`confirmar_nascimento`) é **removida da
  lista do turno** quando a flag está desligada (`ai-orchestrator.js:301-305`). A
  instrução manda chamar algo que não existe.

**Caminho 2 — `ai-orchestrator.js:470`.** O ramo `identidade.nivel === 'fraca'` emite:

> "Identificação por CPF ainda NÃO confirmada: para entregar boleto ou PIX, pergunte a
> data de nascimento e chame confirmar_nascimento."

Esse ramo **não consulta** `exigeNascimento`, ao contrário de todos os outros pontos do
mesmo arquivo. Chega-se a `nivel: 'fraca'` com a flag desligada por
`identity-resolver.js:116` (`porDocumentoPendente`), que reconstrói identidade fraca a
partir da coluna `ai_triage_pending_document` — lida pelo worker em **todo** turno
(`ai-worker.js:196`).

**Caminho 3 — `tool-registry.js:395`.** `buscar_cliente` devolve
`proximoPasso: 'Identificação por CPF ainda não confirmada. Pergunte a data de
nascimento…'`. Está corretamente atrás da flag, mas é a mesma classe de problema:
instrução de nascimento dentro de um retorno de ferramenta.

**Caminho 4 — a chave do painel.** "Exigir data de nascimento depois do CPF"
(`frontend/src/pages/settings/automation/IdentificationPage.jsx:22`). O padrão do banco é
`false` (`migrations/1789090000000`), mas se estiver marcada em produção, explica todos os
prints sozinha.

**Caminho 5 (não verificável daqui) — o texto salvo no painel.** Se o *Prompt do sistema*
ou as *Instruções adicionais da operação* mencionarem confirmação de identidade ou data de
nascimento, nenhuma correção em código resolve. Precisa ser conferido com o conteúdo real.

**Sobre a rede em código do commit `f6aa39b`** (`garantirSemDataDeNascimento`,
`ai-orchestrator.js:115-139`): é uma correção *depois* do erro. Custa uma chamada extra à
OpenAI quando dispara e, se essa chamada falhar, corta frases inteiras da resposta. Ela
existe porque as causas acima nunca foram removidas.

### 1.3 Contradições encontradas

| # | Onde | Contradição |
|---|---|---|
| 1 | `ai-orchestrator.js:544-552` vs `:556` | O prompt manda `responda EXATAMENTE` um modelo que termina em *"você está sem internet, com lentidão ou a conexão está caindo?"* e, quatro linhas abaixo, **proíbe essa frase exata**. O `EXATAMENTE` ganha. **Esta é a causa do TESTE 9 e do item 7.** |
| 2 | `ai-orchestrator.js:371` vs `:906` | O prompt diz *"NUNCA diga ao cliente que não conseguiu verificar"*; o fallback de limite de ferramentas, no mesmo arquivo, instrui *"diga o que não conseguiu verificar"*. |
| 3 | `tool-executor.js:25` vs `ai-orchestrator.js:301-305` | Manda chamar uma ferramenta que foi removida da lista do turno. |
| 4 | `ai-orchestrator.js:470` vs `:378` | O mesmo prompt proíbe pedir a data (linha 378) e manda pedir a data (linha 470). |
| 5 | `ai-orchestrator.js:487` vs `:620-628` | *"Preço, planos e cobertura: informe SOMENTE o que estiver nas INSTRUÇÕES ADICIONAIS"* — e logo abaixo o próprio código entrega uma tabela de preços fixa. |
| 6 | `ai-orchestrator.js:347` vs os modelos `EXATAMENTE` | *"NUNCA repita uma mensagem que você já enviou"* vs. roteiros que obrigam a mesma frase literal sempre que a condição se repete. |

### 1.4 Duplicações

Dentro de **uma única renderização** (não entre as três):

- "não repita pergunta já respondida" aparece em 4 redações diferentes:
  `ai-orchestrator.js:347`, `:556`, `:571`, e mais uma em `tool-registry.js:645`.
- "nunca encaminhe sem responder a pergunta" aparece 3 vezes: `:506`, `:507`, `:590`.
- A regra de formatação WhatsApp aparece 2 vezes: início e fim do mesmo prompt.
- "NÃO peça CPF" aparece em 3 ramos distintos do bloco de identidade.
- Os nomes de setor aparecem como literal em ~20 pontos, embora a lista real de setores
  seja injetada logo acima, com os ids.

### 1.5 Dados operacionais escritos no código (hardcode real)

Só o que está **fora** dos blocos que vêm do painel.

| Arquivo:linha | Conteúdo | Impacto |
|---|---|---|
| `ai-orchestrator.js:620-628` | Tabela `• 500 Mega por R$ 100/mês`, `• 600 Mega por R$ 135/mês`, `• 800 Mega por R$ 185/mês` | **O mais grave.** Cliente já identificado que pergunta preço recebe a tabela do código, não a do painel. Reajuste exige deploy. |
| `ai-orchestrator.js:610` | `"Temos planos de internet 100% fibra óptica"` | Afirmação comercial fixa, dita a todo cliente novo |
| `ai-orchestrator.js:614` | `"Instalação grátis."` | Promoção fixa |
| `ai-orchestrator.js:604` | formato de reserva `"• 500 Mega por R$ 100/mês"` | Preço real usado como exemplo de formato; o modelo pode colar |
| `ai-orchestrator.js` (~20 pontos) | `Financeiro`, `Suporte`, `Comercial`, `Reativação`, motivo `Comprovante` como string literal | Operação que nomear os setores de outro jeito perde os roteiros |
| `tool-registry.js:559, 921, 953, 1116, 1203, 1288` | mesmos nomes de setor/motivo literais, agora em retorno de ferramenta | idem |
| `courtesy-message.js:26` | `'dw', 'telecom'` no classificador de cortesia | "obrigado DW Telecom" é reconhecido como cortesia; "obrigado [outro provedor]" vira atendimento novo |
| `ai-orchestrator.js:468, 504, 505, 617, 621` | nomes reais de clientes (Willemberg, Laureny, Jureildson) e cidade real em modelos de frase | risco de o modelo colar literalmente; e são nomes de pessoas reais versionados no repositório |
| `trust-unlock-rules.js:108` | `'Só é possível uma liberação em confiança a cada 30 dias.'` com o "30" escrito à mão | mudar a constante `DIAS_ENTRE_LIBERACOES` faz a mensagem ao cliente mentir |
| `migrations/1788960000000:1` | `Você é a assistente virtual da DW Telecom` | valor semeado no banco em instalação nova; fora do escopo desta entrega, registrado |

**Classificados como regra de negócio (ficam em código, não são dado da operação):** o
corte de 90 dias da Reativação (`ai-orchestrator.js:577`), os 30/60 dias do desbloqueio em
confiança (`trust-unlock-rules.js:27-28`), os 15 dias e a tolerância de valor do
comprovante (`comprovante.js:13-17`), e as faixas de saudação (`saudacao.js:18-20`).

### 1.6 O que torna a conversa um formulário — a causa está em código

Não é redação. São três mecanismos:

1. **`concluir_triagem.confianca`** (`tool-registry.js:1434, 1436, 1472-1475`). O modelo é
   **obrigado** a informar um número de 0 a 1 avaliando a própria classificação — um
   palpite sobre si mesmo. Se vier abaixo do limiar (padrão 0,8) e ainda houver orçamento
   de perguntas, a ferramenta **recusa concluir e força o modelo a fazer mais uma pergunta
   ao cliente**. Um número inventado vira uma pergunta real na tela do cliente. É a causa
   mecânica dos itens 5 e 15 do pedido.
2. **`contratoId` obrigatório, sem `description`, em 9 ferramentas.** Não é dado do cliente
   (vem do contexto do servidor), mas o modelo escolhe e erra — a ponto de existir uma
   função inteira de código defensivo (`faturaEmAlgumContrato`, `tool-registry.js:122-164`)
   só para corrigir a escolha errada, e duas ferramentas `*_todos_contratos` criadas porque
   o roteiro contrato-a-contrato estourava o teto do turno.
3. **O prompt inteiro em toda mensagem.** Com todos os roteiros presentes sempre, o modelo
   tende a executar o roteiro mais próximo em vez de ouvir o cliente.

**`confirmar_nascimento.data`** (`tool-registry.js:1182-1186`) é o único `required` do
sistema que exige um dado que **só o cliente pode fornecer** — e a tentativa é contada no
banco *antes* da comparação (`:1210`), então uma chamada com data chutada queima uma das
duas tentativas do cliente.

### 1.7 Código morto encontrado

`tool-registry.js`: `fs` (linha 1), `getMediaFilePath` (16), `analyzeImage` (26),
`MIMES_COMPROVANTE` (38), `TAMANHO_MAXIMO_COMPROVANTE` (39) — importados ou definidos e
nunca usados, sobras da mudança que moveu a leitura do comprovante para
`receipt-analysis.js`.

### 1.8 O que era apenas exemplo no arquivo gerado (preservado)

Confirmado como conteúdo do painel, **não** hardcode, e preservado integralmente: o Prompt
do sistema, as Instruções adicionais da operação (incluindo a lista de cidades e a tabela
de planos que aparecem lá dentro), os setores, os motivos e as dicas dos setores. A
arquitetura de campos editáveis não é tocada.

---

## 2. Arquitetura proposta

### 2.1 Princípio de separação

```
CÓDIGO    → regras determinísticas e o QUE é permitido
PAINEL    → dados operacionais configuráveis pela empresa
SGP/TOOLS → os fatos daquele cliente, naquele momento
MODELO    → entende o cliente, escolhe a próxima ação permitida, escreve a resposta
```

Nenhum dado operacional configurável fica em código. Nenhuma decisão determinística fica a
cargo do modelo.

### 2.2 Camadas do prompt

Novo diretório `src/ai/prompt/`. `montarContextoTriagem` vira um compositor fino.

```
PRINCÍPIOS   (sempre)       como atender, com hierarquia de prioridade explícita
FATOS        (sempre)       o que o sistema já sabe com certeza
FLUXOS       (condicional)  só os roteiros que servem para o estado atual
PAINEL       (sempre)       systemPrompt + instruções + setores + motivos
FORMATO      (sempre)       WhatsApp, uma vez só
```

### 2.3 Hierarquia de prioridade (item 24)

Vai no topo dos PRINCÍPIOS, numerada e explícita, para o modelo resolver conflitos sozinho:

```
1. Segurança e privacidade
2. A intenção da mensagem mais recente do cliente
3. Fatos já conhecidos (não perguntar o que já se sabe)
4. Resultados das ferramentas
5. Resolver o que o cliente pediu
6. Coletar apenas o que é indispensável para o próximo passo
7. Encaminhar quando for preciso ação humana
8. Estilo e tom da resposta

Uma regra de estilo nunca justifica ignorar a mensagem atual do cliente.
```

### 2.4 Corte condicional dos fluxos

O corte usa **apenas o que o código sabe com certeza**. Intenção (Suporte vs. Comercial)
continua sendo julgamento do modelo — cortar por palavra-chave seria reintroduzir
exatamente o erro do item 13.

| Fluxo | Condição de inclusão |
|---|---|
| Suporte com consulta de status | `identidade.nivel === 'forte'` |
| Comercial — abertura de cliente novo | `identidade.nivel === 'none'` |
| Comercial — cliente identificado | `identidade.nivel === 'forte'` |
| Comprovante — noturno | `analisar_comprovante` e `desbloqueio_confianca` na lista do turno |
| Comprovante — diurno | `analisar_comprovante` na lista do turno |
| Desbloqueio em confiança | `desbloqueio_confianca` na lista do turno |
| Múltiplos contratos | `contratos.length > 1` |
| Aviso de falha regional | há aviso ativo na cidade do contato |
| Modo noturno | `triagem.noturno.ativo` |
| Limite de perguntas | `triagem.forcarConclusao` |
| SGP indisponível | `identidade.sgpIndisponivel` |

Os PRINCÍPIOS ficam sempre — é o que garante que uma virada de assunto no meio da conversa
continue bem atendida mesmo sem o roteiro específico carregado.

### 2.5 Os "RESPONDA EXATAMENTE"

Regra: frase literal **somente** quando o texto vem de uma ferramenta que já executou, ou
quando há obrigação legal ou de negócio real.

| Ocorrência | Decisão | Motivo |
|---|---|---|
| `ai-orchestrator.js:544` — modelo de suporte ativo/online | **vira objetivo** | É a causa do TESTE 9. Sem motivo técnico. |
| `ai-orchestrator.js:467` — "responda no modelo que a ferramenta devolver" | **fica** | A frase só existe depois de a entrega ter acontecido de verdade |
| `ai-orchestrator.js:401` — frase do desbloqueio | **fica** | idem |
| `ai-orchestrator.js:604` — copiar o bloco de planos das instruções | **fica** | Preço precisa sair literal do painel, sem paráfrase |
| Os ~13 "responda no modelo" de conversa | **viram objetivo + um exemplo** | |
| `tool-registry.js:843, 921, 953, 1116, 1419` — `EXATAMENTE` de retorno de ferramenta | **ficam** | São frases pós-execução |

O modelo substituído pelo objetivo fica assim:

> Contrato ativo e conexão online: informe isso de forma natural; **não trate ONLINE como
> prova de que a internet está funcionando bem**; reconheça o problema relatado com as
> palavras dele; faça somente a próxima pergunta útil para *aquele* problema; nunca
> pergunte de novo algo que ele já informou.

### 2.6 Remoção da data de nascimento

Remoção completa, em todos os caminhos:

| Item | Ação |
|---|---|
| ferramenta `confirmar_nascimento` | removida do registry |
| nível de identidade `'fraca'` | removido — só `'forte'` e `'none'` |
| `triageRequireBirthdate` | removida da config, da API e do painel |
| `INSTRUCAO_IDENTIDADE` | reescrita: *"Ainda não sei quem é o cliente. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo."* |
| `proximoPasso` de `buscar_cliente` | ramo inteiro removido |
| busca de `dataNascimento` no SGP | removida de `sgp-client.js` e `identity-resolver.js` |
| `src/ai/data-nascimento.js` | arquivo apagado (com o teste) |
| `garantirSemDataDeNascimento` | removida — a causa deixa de existir |
| leitura de `ai_triage_pending_document` | removida do worker e do resolvedor |
| rótulo `cpf_confirmed: 'CPF + nascimento'` | removido do painel do atendente |

**Sem migração.** As colunas `ai_triage_pending_document` e `ai_triage_birthdate_attempts`
permanecem no banco; o código apenas deixa de lê-las. Nenhum dado é apagado.

**Risco registrado:** sem a confirmação, quem souber um CPF consegue boleto e PIX daquele
cliente. Isso **já é o comportamento de produção hoje** (a flag é desligada por padrão) e é
o mesmo do site do SGP, que autentica só por CPF. A remoção não afrouxa a segurança atual;
ela fecha o caminho que a reabria sozinha. Continuam protegidos: senha de Wi-Fi, dados
cadastrais, endereço e qualquer informação pessoal de terceiro.

### 2.7 Uma única fonte de verdade

| Hoje | Depois |
|---|---|
| Tabela 500/600/800 no código | `[bloco de planos das instruções]`, igual ao roteiro de cliente novo |
| "Instalação grátis", "100% fibra óptica" | saem do código; se a operação oferece, entra nas Instruções adicionais |
| Formato de reserva com preço real | `"• [velocidade] por R$ [valor]/mês"` |
| Nomes de setor/motivo literais | referência por papel ("o setor que cuida de financeiro, na lista acima"); os nomes reais continuam vindo do banco |
| `'dw', 'telecom'` na cortesia | derivados de `getCompanyConfig().name` |
| Nomes reais em modelos de frase | `[nome]`, `[cidade]` |
| `'... a cada 30 dias'` escrito à mão | interpola `DIAS_ENTRE_LIBERACOES` |

### 2.8 Correções nas ferramentas e schemas

| Ferramenta | Mudança | Motivo |
|---|---|---|
| `concluir_triagem` | `confianca` sai de `required`; **deixa de forçar pergunta ao cliente**; continua indo para o resumo do atendente | Item 5/15 — um palpite do modelo não pode virar pergunta ao cliente. O limite de perguntas já configurado continua sendo o freio. |
| `concluir_triagem` | `resumo` continua obrigatório, com descrição melhor (ver 2.10) | É o que o atendente lê |
| `transferir_atendimento` | `resumo` continua obrigatório, mesma descrição | idem |
| 9 ferramentas com `contratoId` | vira opcional quando o cliente tem **um** contrato só; o executor preenche a partir de `contexto.contracts`; ganha `description` | Reduz erro do modelo e perguntas desnecessárias |
| `confirmar_nascimento` | removida | Seção 2.6 |
| `tool-registry.js` | código morto removido (linhas 1, 16, 26, 38, 39) | |

### 2.9 Regras de conversa — o que entra nos PRINCÍPIOS

**Não repetir pergunta (prioridade máxima).** Uma regra só, em vez das quatro espalhadas.
Antes de perguntar: conferir a mensagem atual, o histórico, o contexto do cliente e os
resultados das ferramentas. Perguntar o que o cliente acabou de dizer é o pior erro de
atendimento.

**Dado obrigatório vs. dado desejável.** Obrigatório = sem ele a ação não roda
tecnicamente. Desejável = ajuda o resumo. Só o obrigatório bloqueia o fluxo. Endereço nunca
bloqueia. Se o cliente ignorar um pedido e perguntar outra coisa, responder a pergunta dele
e só voltar ao dado se ele for realmente necessário para concluir.

**Mudança de assunto.** A mensagem mais recente manda. Se o cliente estava em diagnóstico e
pede o boleto, o assunto agora é pagamento.

**Online não significa internet boa.** Status online é o que o sistema vê naquele instante,
não prova de que a internet funciona. Pode haver lentidão, Wi-Fi ruim, perda de pacotes,
oscilação, problema de alcance ou de aplicativo. Nunca usar o status para invalidar o
relato do cliente.

**Cliente bravo e cliente mal-educado.** Reclamação de serviço com palavrão ("essa internet
tá uma merda") é reclamação, não ataque ao atendente. Nunca repreender, nunca pedir
respeito, nunca corrigir o cliente, nunca responder como se a mensagem fosse neutra.
Reconhecer a insatisfação em poucas palavras e partir para resolver. Só há mudança de
postura em ameaça ou abuso dirigido à pessoa que atende.

**Acolhimento contextual.** A abertura combina com a situação, não é uma frase única.
Cliente normal, cliente irritado, cliente muito insatisfeito, pedido de boleto, assunto
comercial e pergunta simples pedem aberturas diferentes. Pergunta simples se responde.

**Reclamação não é interesse comercial.** "Minha internet de 600 mega vive caindo" é
Suporte. "Pago 135 e isso não funciona" é reclamação. "Quanto custa o plano de 600?" é
Comercial. Classificar pelo sentido, não por palavra-chave.

**Comercial consultivo.** Entender a necessidade antes de despejar a tabela; recomendar com
base no que as instruções da operação permitem, sem inventar; nunca empurrar o mais caro;
quando o cliente já escolheu, parar de vender e seguir para o próximo passo.

**Uma pergunta por vez, com bom senso.** Informações do mesmo objetivo podem ir juntas
("seu bairro e sua rua"). Nunca uma lista de campos.

**Falha de ferramenta (item 22).** Substitui a regra atual *"NUNCA diga que não conseguiu
verificar"*, que contradiz o próprio fallback do orquestrador:

> Se uma consulta necessária falhar: nunca invente resultado; nunca diga que verificou o
> que não verificou; responda com o que estiver confirmado; encaminhe se for preciso. O
> detalhe técnico do erro vai no resumo interno, nunca para o cliente.

**Papel da IA (item 18).** Substitui "você é a recepcionista":

> Você é a primeira atendente virtual da empresa. Resolva sozinha tudo o que as regras e as
> ferramentas permitirem. Quando precisar de ação humana, colete só o necessário, escreva
> um resumo útil e encaminhe ao setor correto.

**Boleto, PIX ou fatura de terceiro.** Fluxo normal, não interrogatório: entender que é de
outra pessoa → pedir **apenas** o CPF/CNPJ do titular → `buscar_cliente` com
`titularEOutraPessoa: true` → seguir. Nunca pedir data de nascimento, endereço, nome da
mãe, grau de parentesco ou telefone. Continuam protegidos senha de Wi-Fi, dados cadastrais,
endereço e informações pessoais do titular. Quem está falando continua sendo chamado pelo
próprio nome, nunca pelo nome do titular.

### 2.10 Resumo para o atendente (item 23)

O cabeçalho determinístico já existe e fica (`tool-registry.js:1479-1492`): setor, motivo,
cliente, contratos, forma de identificação, origem, confiança, ferramentas usadas,
comprovante lido, desbloqueio.

Duas melhorias:

1. A descrição do campo `resumo` passa a pedir explicitamente: o que o cliente pediu **com
   as palavras dele**, o que já foi apurado pelas consultas, o que já foi feito e o que
   falta. Com um exemplo bom e um ruim no próprio schema.
2. A linha `Ferramentas:` hoje despeja JSON truncado em 200 caracteres. Passa a ser legível
   ("consultar_status_todos_contratos → contrato ativo, conexão online").

---

## 3. Arquivos que pretendo alterar

### 3.1 Novos

| Arquivo | Conteúdo |
|---|---|
| `src/ai/prompt/principios.js` | regras base, hierarquia de prioridade, tom, formatação |
| `src/ai/prompt/fatos.js` | estado determinístico: identidade, contratos, data/hora, aviso de cidade, limite de perguntas |
| `src/ai/prompt/fluxos/suporte.js` | roteiros de falha, alcance de Wi-Fi, velocidade, horário, equipamento |
| `src/ai/prompt/fluxos/comercial.js` | cobertura, planos, contratação, mudança de endereço |
| `src/ai/prompt/fluxos/financeiro.js` | pagamento, boleto, PIX, suspenso, terceiros, reativação |
| `src/ai/prompt/fluxos/comprovante.js` | leitura de comprovante, diurno e noturno |
| `src/ai/prompt/fluxos/noturno.js` | modo noturno e desbloqueio em confiança |
| `src/ai/prompt/fluxos/privacidade.js` | dados de outra pessoa |
| `src/ai/prompt/painel.js` | injeção de systemPrompt, instruções, setores com dica, motivos |
| `src/ai/prompt/montar.js` | o compositor |
| `src/ai/prompt/*.test.js` | um por módulo |
| `scripts/dump-prompt.js` | renderiza os prompts em arquivo, para revisão — é como conferir o prompt sem subir nada |
| `src/ai/simulacao-real.test.js` | harness multiturno (seção 4.2) |

### 3.2 Alterados

| Arquivo | Mudança |
|---|---|
| `src/ai/ai-orchestrator.js` | `montarContextoTriagem` passa a chamar o compositor; remove `garantirSemDataDeNascimento`, `PEDE_NASCIMENTO`, `semFraseDeNascimento`, `CHAVE_DATA_NASCIMENTO`; remove `confirmar_nascimento` das listas; corrige a instrução de fallback do limite |
| `src/ai/tool-executor.js` | `INSTRUCAO_IDENTIDADE` reescrita; `contratoId` preenchido quando houver contrato único |
| `src/ai/tool-registry.js` | remove `confirmar_nascimento`; remove o ramo de identidade fraca de `buscar_cliente`; `confianca` opcional e sem gate de pergunta; `contratoId` opcional com descrição; setores por papel; descrição do `resumo`; remove código morto |
| `src/ai/identity-resolver.js` | remove `'fraca'`, `dataNascimento`, `porDocumentoPendente`, `nascimentoTentado` |
| `src/integrations/sgp-client.js` | para de trazer `dataNascimento`; remove o import de `data-nascimento` |
| `src/queue/ai-worker.js` | para de ler `getTriagePendingDocument` |
| `src/ai/ai-config.repository.js` | remove `triageRequireBirthdate` |
| `src/api/admin-ai.routes.js` | remove `triageRequireBirthdate` da leitura e da validação |
| `src/conversations/conversation.repository.js` | remove as funções mortas `incrementBirthdateAttempts`, `setTriagePendingDocument`, `getTriagePendingDocument` |
| `src/conversations/courtesy-message.js` | tira `'dw', 'telecom'`; deriva do nome da empresa |
| `src/ai/trust-unlock-rules.js` | interpola `DIAS_ENTRE_LIBERACOES` na mensagem |
| `frontend/src/pages/settings/automation/IdentificationPage.jsx` | remove a caixa "Exigir data de nascimento depois do CPF" |
| `frontend/src/pages/settings/automation/useAiTriageForm.js` | remove o campo |
| `frontend/src/pages/settings/automation/aiToolLabels.js` | remove `confirmar_nascimento` |
| `frontend/src/components/ConversationInfoPanel.jsx` | remove `cpf_confirmed` |

### 3.3 Apagados

`src/ai/data-nascimento.js` e `src/ai/data-nascimento.test.js`.

### 3.4 Sem migração

Nenhuma migração nesta entrega. As colunas ficam no banco; o código para de lê-las.

### 3.5 Funcionalidades preservadas (item 26)

SGP, identificação automática por telefone e memória, `buscar_cliente`, contratos,
múltiplos contratos, status de contrato e de conexão, boleto, PIX, comprovante, desbloqueio
em confiança, Financeiro, Suporte, Comercial, Reativação, modo noturno, setores, motivos,
dicas dos setores, resumo, `concluir_triagem`, `encerrar_atendimento`, regras de horário,
histórico, avisos de cidade, guardas de anúncio (encaminhamento, entrega, liberação),
guarda de idioma, saudação garantida, e os três commits locais recentes — cujas lições
viram testes nomeados, não são revertidas.

---

## 4. Plano de testes

### 4.1 Jest determinístico

Os **260 asserts** de `ai-orchestrator.test.js` que hoje comparam texto literal do prompt
são **reescritos, não apagados**. Cada um é a lição de um print real de produção; cada um
vira um teste nomeado pelo comportamento em vez de pelo texto. Regra de trabalho: nenhum
assert sai sem que exista outro cobrindo a mesma lição.

Testes novos:

- nenhum caminho do sistema produz um pedido de data de nascimento — varredura no prompt
  renderizado nos três estados, no `INSTRUCAO_IDENTIDADE`, e em todos os retornos de
  ferramenta;
- o prompt renderizado não contém preço, velocidade de plano, nome de cidade nem promoção;
- a pergunta fixa de diagnóstico não é mandatória em nenhum estado;
- cliente identificado não recebe o roteiro de cliente novo, e vice-versa;
- `concluir_triagem` com confiança baixa **conclui**, e a confiança aparece no resumo;
- `contratoId` ausente com contrato único é preenchido pelo executor;
- as guardas existentes (anúncio de encaminhamento, entrega, liberação, idioma, saudação)
  continuam disparando.

Comando: `npm test` (roda `migrate:test` antes, contra o Postgres do Docker).

### 4.2 Harness multiturno com a OpenAI real

Arquivo: `src/ai/simulacao-real.test.js`, rodando sob o jest já existente.

- **Pulado por padrão.** Só roda com `SIMULACAO_REAL=1`.
- **Chave da API:** lida de `process.env.OPENAI_API_KEY`. Nunca escrita em arquivo, nunca
  impressa em log, nunca commitada, nunca citada na conversa. O `.gitignore` já cobre
  `.env` e `.env.test`.
- **Textos do painel:** lidos de `.local/prompt-sistema.txt` e
  `.local/instrucoes-operacao.txt`. A pasta `.local/` entra no `.gitignore`.
- **SGP mockado**, com um cliente de teste fixo (contratos ativo, suspenso e múltiplos),
  reaproveitando os mocks que os testes atuais já usam. Nenhuma chamada real ao SGP.
- **OpenAI real** — é o único componente não mockado.
- **Saída:** transcrição de cada conversa em `output/simulacao/NN-nome.md`, turno a turno,
  incluindo as ferramentas chamadas.

### 4.3 Os 16 roteiros e o comportamento esperado

| # | Entrada | Esperado | Reprova se |
|---|---|---|---|
| 1 | "Quero o boleto da minha esposa." | Pede só o CPF/CNPJ dela; com o CPF, localiza e entrega | Pedir data de nascimento, parentesco, endereço ou telefone |
| 2 | "Essa internet tá uma merda, caindo desde cedo." | Acolhe a irritação em poucas palavras, identifica se preciso, consulta, e continua a partir de "caindo" | Repreender; perguntar depois se está caindo |
| 3 | "Net não presta." | Entende como Suporte, acolhimento curto, identifica se preciso | Tratar como neutro; despejar tabela de planos |
| 4 | IA pediu a rua → cliente: "Quanto custa o plano de 600?" | Responde o preço pelas instruções da operação | Repetir o pedido da rua imediatamente |
| 5 | "Quero o plano de 600." | Segue para a próxima etapa | Listar os planos de novo |
| 6 | "Qual plano você recomenda para 5 pessoas?" | Venda consultiva, orientação sustentada pelas instruções | Inventar recomendação; empurrar o mais caro |
| 7 | "Pago 135 e essa internet vive caindo." | Classifica como Suporte | Classificar como Comercial |
| 8 | Cliente identificado pelo telefone | Atende sem pedir documento | Pedir CPF |
| 9 | "Está lento." | Vai direto ao roteiro de lentidão | Perguntar "sem internet, lentidão ou caindo?" |
| 10 | Cliente ignora o pedido de endereço e pergunta outra coisa | Responde a nova pergunta primeiro | Insistir no endereço |
| 11 | SGP online + "fica caindo" | Informa que aparece online **naquele momento** e segue o diagnóstico da queda | Usar o online para invalidar o relato |
| 12 | Palavrão reclamando do serviço | Segue profissional e resolve | Pedir respeito; repreender |
| 13 | Quer boleto com contrato suspenso | Prioriza o pagamento e entrega | Perguntar "você chegou a pagar?" |
| 14 | Boleto de terceiro | CPF/CNPJ do titular; nunca trata quem fala como titular | Pedir data de nascimento |
| 15 | Cliente já disse tudo para encaminhar | Encaminha com resumo | Perguntar mais para preencher campo desejável |
| 16 | Muda de assunto no meio do diagnóstico | Segue a intenção mais recente | Continuar o diagnóstico anterior |

Cada roteiro roda **multiturno** (2 a 4 mensagens), não uma mensagem isolada.

### 4.4 Frontend

`npm test` dentro de `frontend/` para as páginas alteradas.

---

## 5. Riscos e pontos a acompanhar

1. **Os 260 asserts de texto literal** são o maior risco da entrega. Cada um guarda uma
   lição paga com um print real. Mitigação: nenhum é removido sem virar outro teste, e a
   revisão final confere a lista de lições contra os commits de origem.
2. **Cortar fluxo por estado** pode tirar um roteiro de que o modelo precisaria numa virada
   de assunto — por exemplo, cliente identificado que passa a perguntar preço. Mitigação: o
   corte usa só o que é determinístico, os PRINCÍPIOS ficam sempre, e os roteiros 4, 5, 6 e
   16 do harness cobrem exatamente essa transição.
3. **Remover o gate de confiança** pode deixar passar uma classificação ruim. Mitigação: a
   confiança baixa fica visível no resumo do atendente, que é quem pode corrigir — em vez
   de virar mais uma pergunta ao cliente.
4. **Sem confirmação por nascimento**, o CPF sozinho libera boleto e PIX. Já é o
   comportamento atual e o do site do SGP; registrado como decisão consciente.
5. **O texto salvo no painel** pode conter instruções velhas (pedido de nascimento, tabela
   de planos antiga, roteiros que brigam com os novos princípios). Só dá para conferir com
   o conteúdo real — é o caminho 5 do diagnóstico e o único que nenhuma alteração em código
   resolve.
6. **A remoção de `confirmar_nascimento`** deixa dados antigos nas colunas do banco. Se um
   dia a confirmação voltar, o histórico ainda está lá.
7. **Custo do harness real**: cada execução completa dos 16 roteiros faz dezenas de chamadas
   à OpenAI. Por isso ele é pulado por padrão e roda sob demanda.
