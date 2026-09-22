# Cadastros estruturados e contexto dinâmico para a IA — design

**Data:** 2026-09-22
**Branch de partida:** `main`, HEAD `77f629e`
**Estado:** design aprovado seção a seção pelo proprietário. **Nenhuma linha de código foi escrita.**

---

## O que este documento é

O desenho de uma etapa que organiza três cadastros do painel — **Empresa**, **Cidades/Localidades** e **Planos** —, define como essas informações chegam à IA sem serem coladas no prompt em toda conversa, e cria uma regra financeira determinística para faturas vencidas.

A frase que orienta tudo aqui já existe no projeto, em [[Decisões de Arquitetura|ADR-001]]:

> O código decide o que é permitido.
> O SGP e as ferramentas dizem o que é verdade.
> **O painel diz o que a empresa oferece.**
> A IA entende o cliente e conduz a conversa.

O ADR-001 já lista "planos, preços, localidades" como responsabilidade do painel. **Esta etapa não muda a arquitetura: implementa uma decisão aprovada em 18/09/2026 e ainda não cumprida.**

## O que este documento NÃO é

- Não é plano de implementação. Nenhuma tarefa, nenhum arquivo, nenhuma ordem de commits.
- Não autoriza tocar em área protegida. As Etapas 3, 4 e 5 encostam em IA, prompts, compositor, tool-registry e ferramentas financeiras, e **cada uma exige aprovação própria do proprietário** antes de começar.
- Não trata as incertezas do SGP como resolvidas. Duas delas bloqueiam a Etapa 5 e estão listadas em *Verificações pendentes*.

---

## Premissas verificadas no código

Registradas porque o desenho depende delas. Se alguma deixar de valer, o desenho precisa ser revisto.

| Premissa | Como foi verificada |
|---|---|
| **O sistema é de uma empresa só por instalação.** Não há multiempresa | Zero ocorrências de `tenant`, `company_id`, `organization`, `org_id` em `migrations/` e `src/`. `company_config` é lido com `ORDER BY created_at ASC LIMIT 1`. O SGP tem credencial única em `sgp_query_config` |
| **O projeto enumera colunas; não usa `SELECT *`** | Confirmado nos três repositórios envolvidos. Coluna nova não chega sozinha à aplicação |
| **Não existe catálogo de planos** | Varredura por `plano\|velocidade\|mega\|mbps\|preco\|price\|mensalidade\|instalacao` em migrations, src, frontend e scripts |
| **`sectors` não tem conceito de ativo/inativo** | Colunas reais: `id`, `name`, `ai_hint`, `created_at` |
| **O SGP devolve POP** | `popId` e `popNome` em `/api/ura/consultacliente` |
| **A regra dos 90 dias existe só como texto de prompt** | Única ocorrência viva: `src/ai/prompt/fluxos/reativacao.js:68` |
| **PostgreSQL de produção é 16.15** | Consulta de leitura em produção, 2026-09-22. Atende ao PG ≥ 15 exigido pela FK composta de A6 |
| **`cities` em produção tem 13 registros, sem duplicata exata nem normalizada** | Consulta de leitura em produção, 2026-09-22 |
| **Nem todo registro de `cities` é município** | Consulta de leitura em produção, 2026-09-22. Ver A11 |

### Uma referência de documentação que está errada

`docs/superpowers/specs/2026-09-17-ia-atendimento-humana-design.md:139` afirma que o corte de 90 dias está em `ai-orchestrator.js:577`. **No HEAD atual isso é falso** — aquela linha trata de registro de ferramentas. A regra migrou para o módulo de prompt durante a refatoração e a doc não acompanhou. Quem for implementar não deve confiar em números de linha daquele documento.

---

# Seção A — Cidades, localidades e POP

## A1. O problema

O cadastro de Cidades resolve o que foi criado para resolver: guarda a cidade do cliente e permite aviso de falha por cidade. Mas uma localidade real — o povoado de **Barão de Tromai**, no município de **Cândido Mendes** — não tem como ser representada. No SGP, o cliente continua com a cidade oficial `Cândido Mendes`; quem identifica melhor onde ele está é o **POP da rede**, algo como `Barão`.

## A2. Estrutura: uma tabela só, evolução aditiva

`cities` passa a representar municípios **e** localidades. Nenhuma linha existente muda de significado.

```
kind         TEXT     NOT NULL DEFAULT 'unclassified'  -- 'city' | 'locality' | 'unclassified'
parent_id    UUID     REFERENCES cities(id)
sgp_pop      TEXT     NULL                              -- valor como o SGP devolve
sgp_pop_key  TEXT     NULL                              -- normalizado (ver A4)
active       BOOLEAN  NOT NULL DEFAULT true
served       BOOLEAN  NOT NULL DEFAULT false
note         TEXT     NOT NULL DEFAULT ''
```

**Por que `kind` nasce `'unclassified'` e não `'city'`.** A consulta de produção de 2026-09-22 mostrou que **três dos treze registros são povoados, não municípios** (ver A11). Marcar todos como `'city'` gravaria uma afirmação falsa no banco. `'unclassified'` significa *"registro legado, ainda não classificado"* — preserva o comportamento atual sem mentir, e faz a pendência **aparecer na tela** em vez de ficar escondida.

**Por que `served` nasce `false`.** O cadastro de Cidades foi criado para **localizar contatos**, não para declarar cobertura comercial. Assumir `true` seria deduzir cobertura da mera existência do registro. `false` é seguro por construção: nunca produz negativa, apenas `precisa_verificar_viabilidade` (ver B3). A marcação real acontece na Etapa 2, com o proprietário decidindo uma a uma.

`active` nasce `true` porque os registros existentes **estão** em uso operacional hoje — há contatos vinculados a eles.

Exemplo canônico, depois da conversão de A11:

| name | kind | parent_id | sgp_pop | sgp_pop_key | served |
|---|---|---|---|---|---|
| Cândido Mendes | `city` | — | NULL | NULL | ✓ |
| Barão de Tromaí | `locality` | → Cândido Mendes | `Barão` | `barao` | ✓ |

**Travas no banco, não só na rota:**

- `CHECK (kind IN ('city','locality','unclassified'))`
- `CHECK ((kind='locality' AND parent_id IS NOT NULL) OR (kind IN ('city','unclassified') AND parent_id IS NULL))` — localidade **sempre** tem município; município e legado nunca têm
- Hierarquia de dois níveis (localidade não pode ser pai) fica no repositório: nenhum `CHECK` alcança outra linha
- **`'unclassified'` não pode ser escolhido em criação nem em edição.** É valor de migração, aceito apenas nas linhas que já existiam. A rota recusa; só a conversão de A11 o remove

### Semântica de `active` e `served`

São duas dimensões independentes e não devem ser confundidas: `active` é sobre **operar com o registro**; `served` é sobre **afirmar cobertura**.

**`active = false`**

- não aparece para novos cadastros nem para seleções operacionais;
- **não participa** do preenchimento automático por cidade nem por POP;
- não pode ser escolhida para **novos** avisos;
- **vínculos históricos existentes continuam sendo exibidos corretamente** — um contato já vinculado não perde a cidade, e um aviso já criado não some.

**`served = false`**

- a cidade ou localidade **continua existindo** normalmente;
- não pode gerar resposta de cobertura confirmada;
- `verificar_cobertura` devolve `precisa_verificar_viabilidade`.

> **`served = false` nunca vira resposta automática "não atendemos".** Vira "a equipe confirma a viabilidade" — a mesma regra comercial de B3.

**`active = true` e `served = true`** — pode confirmar que a localidade é atendida, respeitadas as demais regras de cobertura.

## A3. Compatibilidade: `listCities()` continua significando municípios

**Decisão do proprietário, e é a proteção mais importante desta seção.**

Hoje "cities" significa município para seis consumidores: o preenchimento automático, o vocabulário do Whisper, a tela de avisos, o `GET /api/cities`, o seletor de cidade do contato e a busca do dashboard. Fazer `listCities()` passar a devolver povoados obrigaria a corrigir os seis, um a um, para impedir que Barão de Tromai aparecesse como município.

> **A compatibilidade é segura por padrão. Quem precisa de localidade pede explicitamente.**

```
listCities()                           → kind IN ('city','unclassified')   (inalterado na prática)
GET /api/cities                        → o mesmo conjunto                  (inalterado na prática)
GET /api/cities?includeLocalities=true → hierarquia completa               (novo, opt-in)
```

**`'unclassified'` entra no conjunto legado de propósito.** Enquanto os três povoados de produção não forem convertidos (A11), eles precisam continuar aparecendo exatamente onde aparecem hoje — inclusive no seletor de cidade do contato, que é como os 66 contatos vinculados a eles foram cadastrados. Excluí-los seria a regressão que esta seção existe para impedir.

Depois da conversão, esses registros saem do conjunto naturalmente, porque passam a ser `'locality'`.

Consequência: **esquecer de atualizar um consumidor não causa regressão** — causa, no máximo, ausência de um recurso novo. É a direção correta do erro.

## A4. `sgp_pop`: ausência é `NULL`, e a unicidade é sobre o valor normalizado

O desenho inicial usava `DEFAULT ''` mais índice único, o que tornaria impossível existirem duas cidades sem POP. **Corrigido:** `sgp_pop` é `NULL` quando não há POP. Nunca string vazia.

A unicidade tem de ser **a mesma normalização que o matcher usa** — senão `Barão`, `BARAO` e ` barão ` entram como três registros e depois casam todos com a mesma chave.

**Forma mínima e segura:** coluna derivada persistida, escrita pelo repositório com a **mesma função** de normalização já usada em `src/cities/city-matcher.js` (NFD → remove diacríticos → minúsculas → colapsa espaços → trim):

```sql
sgp_pop_key TEXT NULL
CREATE UNIQUE INDEX cities_sgp_pop_key_unico ON cities (sgp_pop_key) WHERE sgp_pop_key IS NOT NULL;
CHECK ((sgp_pop IS NULL AND sgp_pop_key IS NULL) OR (sgp_pop IS NOT NULL AND sgp_pop_key IS NOT NULL));
```

**Por que não um índice sobre expressão SQL:** exigiria `unaccent()`, que não é `IMMUTABLE` (depende de dicionário) e por isso não pode entrar em índice sem um wrapper que mente sobre a imutabilidade. A alternativa, `translate()` com mapa de caracteres, seria `IMMUTABLE` mas **não produziria exatamente o mesmo resultado** que a normalização NFD do JavaScript — e divergência entre a chave do banco e a chave do matcher é exatamente o defeito que estamos evitando.

**O preço, dito com clareza:** `sgp_pop_key` é derivada e o banco não garante a derivação. A mitigação é caminho de escrita único no repositório (`sgp_pop_key` nunca é aceita da rota nem preenchida à mão) mais teste que prove que gravar `" BARÃO "` produz chave `barao`.

## A5. O contato guarda município e localidade

```
contacts.locality_id UUID NULL REFERENCES cities(id)
```

`city_id` continua sendo **o município**, com o mesmo significado de hoje. `locality_id` é novo e opcional. Nenhum contato existente é tocado.

**Povoado nunca ocupa o lugar de município.** Um cliente pode ter município `Cândido Mendes` e localidade `Barão de Tromai` ao mesmo tempo — as duas informações são preservadas.

## A6. A invariante município ↔ localidade

> Se `locality_id` estiver preenchido, a localidade **obrigatoriamente** tem `parent_id = contacts.city_id`.

Combinação inválida a recusar: município `Carutapera` + localidade `Barão de Tromai`, cujo pai é `Cândido Mendes`.

A invariante vale em **todos** os caminhos: edição manual do contato, preenchimento pelo POP e qualquer automação futura.

### Como garantir

**Opção preferida — chave estrangeira composta**, que empurra a garantia para o banco:

```sql
ALTER TABLE cities   ADD CONSTRAINT cities_id_parent_unico UNIQUE (id, parent_id);
ALTER TABLE contacts ADD FOREIGN KEY (locality_id, city_id) REFERENCES cities (id, parent_id);
ALTER TABLE contacts ADD CHECK (locality_id IS NULL OR city_id IS NOT NULL);
```

O `CHECK` é indispensável: o padrão `MATCH SIMPLE` considera a FK satisfeita quando **qualquer** coluna é nula, então sem ele um contato poderia ter localidade sem município.

**Atenção ao `ON DELETE`.** Numa FK composta, `ON DELETE SET NULL` sem lista de colunas anula **todas** as colunas referenciadoras — apagar um povoado zeraria também o município do contato, o que é errado. A variante com lista, `ON DELETE SET NULL (locality_id)`, existe a partir do **PostgreSQL 15**.

✅ **Resolvido.** Produção roda **PostgreSQL 16.15** (consulta de leitura, 2026-09-22).

> A FK composta é **viável**, com `ON DELETE SET NULL (locality_id)`. A alternativa de validar a invariante apenas no repositório fica descartada como plano principal — permanece apenas como comportamento complementar da rota, que precisa limpar antes para o atendente ver erro previsível em vez de violação de FK.

### Quando o município do contato muda

Se o município for alterado e a localidade atual deixar de pertencer a ele:

> **Limpar `locality_id` de forma explícita e previsível.** Nunca manter combinação inválida, nunca silenciosamente "corrigir" o município para o pai da localidade.

Vale para a rota de edição e para qualquer automação. Com FK composta, o banco recusaria o update inconsistente — a rota deve limpar **antes**, para o atendente ver um comportamento previsível em vez de um erro.

**Testes obrigatórios:** rejeição da combinação inválida; limpeza ao trocar de município; POP que aponta para localidade de outro município não preenche nada.

## A7. Como o POP preenche a localidade

O preenchimento atual por nome de cidade (`endereco_cidade`, com Levenshtein ≤2 e candidata única, em `src/cities/city-matcher.js`) **não muda**. Acrescenta-se um segundo, independente:

```
popNome do SGP
  → normaliza (acento, caixa, espaços) com a MESMA função do matcher
  → casa EXATO contra cities.sgp_pop_key
  → exige exatamente uma linha, com kind='locality'
  → exige que parent_id dela seja o município já preenchido do contato
  → grava contacts.locality_id, e somente se estiver vazio
```

Três decisões deliberadas:

1. **Casamento exato, sem fuzzy.** POP é identificador de sistema, não texto digitado por humano. Levenshtein num identificador aceitaria `Barão` onde está escrito `Barra`. Normalizar acento, caixa e espaço é permitido; adivinhar nome parecido, não.
2. **Confere o pai.** POP apontando para localidade de outro município **não preenche** e registra. Dado inconsistente não vira fato.
3. **Só preenche se estiver vazio**, como `setContactCityIfEmpty` já faz. Escolha manual do atendente nunca é sobrescrita.

**⚠ Bloqueia a Etapa 3.** `'POP CENTRO'` é o único valor versionado no repositório (fixture derivada da sondagem de 11/09). Não se sabe se os POPs reais vêm como `Barão`, `POP BARÃO` ou `BARAO DE TROMAI`. Se houver prefixo fixo, a normalização precisa tratá-lo — e esse tratamento não pode ser inventado antes de ver o dado. Ver *Verificações pendentes*.

## A8. Avisos por localidade — sem migration nenhuma

`city_notices.city_id` já é FK para `cities`. Como a localidade **é uma linha de `cities`**, criar um aviso só para Barão de Tromai **não exige alterar nenhuma tabela**. `city_notices` e `city_notice_deliveries` ficam intactas — é o ganho concreto de manter uma tabela só em vez de criar uma segunda lista.

O que muda é a **consulta**, que passa a ser hierárquica:

```
cliente sem localidade   → verifica aviso do município
cliente com localidade   → verifica primeiro o aviso ativo da localidade
                           existe?  → usa o da localidade
                           não existe? → usa o do município pai como fallback
```

> **Nunca os dois avisos no mesmo atendimento.** O mais específico vence.

A idempotência continua sendo a de hoje — `city_notice_deliveries` com `UNIQUE (city_notice_id, contact_id)` —, e como a chave é por aviso, nada nela precisa mudar.

## A9. O que cada tela mostra

Respeitando a regra de que **povoado não aparece como cidade**:

| Lugar | Hoje | Passa a ser |
|---|---|---|
| Cadastro do contato | 1 select "Cidade" | 2 selects encadeados: **Município** (`kind='city'`) e **Localidade** (só filhas do município escolhido) |
| Avisos por cidade | lista chapada | agrupada por município, localidades aninhadas |
| Chip da lista / painel | `Cidade` | `Barão de Tromai · Cândido Mendes` quando houver localidade; só o município quando não |
| Busca do dashboard | casa nome da cidade | casa município **e** localidade, preservando a hierarquia |
| Vocabulário do Whisper | nomes das cidades | municípios **e** localidades (com a ressalva de D5.3) |
| Cadastros auxiliares | 1 coluna + Excluir | Nome, Tipo, Município, POP, Ativa, Atendida + **Editar** |

## A10. Editar deixa de ser opcional

Hoje não existe `updateCity`: nem função, nem rota, nem formulário. Corrigir um nome exige excluir e recriar — e o `DELETE` derruba o aviso em cascade e zera `contacts.city_id` de todos os contatos daquela cidade.

Com POP entrando em jogo, um mapeamento errado **precisa** ser corrigível sem destruir vínculo. **IDs e vínculos de contatos e avisos são preservados.**

### Edição comum e edição estrutural são coisas diferentes

**Edição comum** — `name`, `sgp_pop`, `active`, `served`, `note`: editáveis normalmente, respeitadas as validações da seção A (unicidade normalizada de POP, `NULL` como ausência).

**Edição estrutural** — `kind` e `parent_id`: mudam o **significado** do registro dentro da hierarquia e podem invalidar vínculos que já existem.

> Se a alteração invalidar vínculos existentes: **409 de conflito, com tratamento explícito.**
>
> **Não** corrigir registros em massa em silêncio. **Não** mover clientes automaticamente.

Exemplo concreto: `Barão de Tromai` tem contatos vinculados e pertence a `Cândido Mendes`. Trocar o pai para `Carutapera` **não pode** deixar esses contatos numa combinação inválida (município `Cândido Mendes` + localidade cujo pai virou `Carutapera`), nem movê-los para `Carutapera` por conta própria. São clientes reais em lugares reais — o sistema não decide isso sozinho.

**Dependências a verificar antes de permitir a alteração:**

| Mudança | O que verificar |
|---|---|
| `parent_id` de uma localidade | Existem contatos com `locality_id` = esta linha? Se sim, o `city_id` deles deixaria de casar com o novo pai (viola a invariante de A6) → **409** |
| `kind` de `city` → `locality` | A linha tem localidades filhas? Viraria pai de localidade, quebrando a hierarquia de dois níveis → **409**. Existem contatos com `city_id` = esta linha? Passariam a ter um povoado como município → **409** |
| `kind` de `locality` → `city` | Existem contatos com `locality_id` = esta linha? A localidade deixaria de ter pai e a invariante cairia → **409**. O `parent_id` precisa ser removido no mesmo movimento, o que só é aceitável sem vínculos |
| Qualquer das duas | Existem avisos (`city_notices`) apontando para a linha? Não invalidam por si, mas o alcance do aviso muda — a resposta deve dizer isso |

A mensagem do 409 precisa **nomear o que está no caminho** (quantos contatos, quantas filhas), não devolver "conflito" seco. Quem administra tem de saber o que tratar antes de tentar de novo.

## A11. Dados legados: `cities` já contém povoados

Consulta de leitura em produção, **2026-09-22**. A premissa inicial de que todo registro existente seria município **não representa a realidade**.

`cities` tem **13 registros**, sem duplicata exata nem normalizada, e **nenhum aviso ativo em `city_notices`** vinculado a eles neste momento. Três deles são povoados com contatos vinculados:

| Registro | `id` | Contatos | Município |
|---|---|---|---|
| Aurizona | `c55ba683-e8f3-4ab5-80a0-5ba96eb393af` | 10 | **Godofredo Viana** |
| Barão de Tromaí | `7da9519e-78ac-442f-a8c4-98f54e769ca6` | 24 | **Cândido Mendes** (`e0713c35-f6d9-429e-a89f-bd1232a04d45`) |
| Chega tudo | `95a5648d-6e88-4356-a923-1f140c82ab10` | 32 | **Centro Novo do Maranhão** |

✅ **Mapeamentos confirmados pela operação em 2026-09-22.** Nenhum foi deduzido.

⚠️ **"Centro Novo do Maranhão" está no cadastro como "Centro Novo".** O registro existente é **reutilizado**: não criar outro município e **não renomear** nesta tarefa. Renomear, se for desejado, é edição comum e decisão à parte.

### Regras da conversão

> **Estrutura e conversão são operações separadas.** A estrutura aditiva pode ser preparada mantendo os dados legados como estão. A conversão acontece depois, explicitamente autorizada, quando os consumidores envolvidos estiverem preparados.

- **Preservar os `id` existentes.** Não excluir, não recriar, não duplicar. Os 66 contatos vinculados dependem deles
- O registro do povoado **passa a ser** `kind='locality'` com `parent_id` correto — é `UPDATE`, nunca `INSERT` de um registro novo
- Os contatos daquele povoado passam a ter `city_id` = município e `locality_id` = o povoado
- **Transacional**, respeitando as FKs e a invariante de A6
- Demais dados, vínculos e avisos preservados
- **Contatos vinculados apenas ao município não são alterados.** Estar em Cândido Mendes não prova a qual povoado a pessoa pertence — deduzir isso inventaria endereço de cliente real

### Duas fronteiras que a conversão não pode atravessar

1. **Não enfraquece o 409 de A10.** A conversão é caminho próprio, explícito e auditado — **não** é uma flag de bypass na rota normal de edição. A edição estrutural comum continua recusando com 409 exatamente como descrito
2. **Não entra na migration automática do Render.** O Build Command do Render roda `npm run migrate -- up` sozinho a cada deploy. Uma conversão de dados embutida em `migrations/` seria executada **sem autorização, em produção, no meio de um deploy**. A conversão é operação administrativa à parte, disparada por decisão humana

### Cobertura não se deduz da existência

`served` nasce `false` justamente por causa disto: este cadastro nasceu para **localizar contatos**. Que Aurizona esteja em `cities` não significa que haja cobertura comercial em Aurizona. Essa marcação é decisão do proprietário na Etapa 2, registro a registro.

---

# Seção B — Planos e contexto dinâmico da IA

## B1. O cadastro de Planos

Não existe nada parecido hoje. O catálogo comercial vive como **texto livre** em `ai_config.triage_extra_instructions`, colado verbatim em `src/ai/prompt/painel.js:22-30`, e o prompt manda copiá-lo "exatamente como está escrito, mesmos ícones, mesmos preços".

Tabela nova:

| coluna | tipo | papel |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | `"500 Mega"` — nome comercial, independente do número |
| `speed_mbps` | INTEGER **NULL** | `500`. Número, nunca texto |
| `monthly_price` | NUMERIC(10,2) NOT NULL | `100.00`. Nunca texto formatado |
| `install_condition` | TEXT NOT NULL DEFAULT `''` | `"Grátis"` |
| `active` | BOOLEAN NOT NULL DEFAULT true | |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | ordem de exibição |
| `note` | TEXT NOT NULL DEFAULT `''` | observação **interna** |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Velocidade como inteiro.** Não há motivo no projeto para ser texto: não existe catálogo legado a preservar, e o plano contratado do cliente vem do SGP em campo próprio (`planointernet`), que é outra coisa. Inteiro permite ordenar, comparar, filtrar e recomendar, e lida com 1000 Mbps sem parsing. É **nullable** porque o SGP já tem `planotv`: um plano futuro de TV ou combo não tem velocidade, e nulo é mais honesto que zero.

**Preço como `NUMERIC`.** É o que elimina de fato o risco de preço desatualizado. A formatação `R$ 100,00` é responsabilidade da camada de exibição.

## B2. `note` nunca sai do escopo administrativo

Duas formas de resposta, e a separação é estrutural — não depende de a IA ignorar o campo:

| Consumidor | Recebe `note`? |
|---|---|
| Rotas de administração | **Sim** |
| Rota operacional, ferramenta da IA, qualquer consulta pública | **Não. A chave não existe na resposta** |

Aplicação direta de [[Decisões de Arquitetura|ADR-008]], e do mesmo padrão já usado na nota interna do contato: quem não pode ver recebe a resposta **sem a chave** — não `null`, não string vazia.

## B3. Planos e cobertura chegam por ferramenta, não por prompt

O caminho intuitivo seria um módulo de prompt novo, como `fluxos/aviso-cidade.js`. **Esta spec recomenda não fazer isso**, por três razões concretas:

1. **O compositor não tem noção de intenção nem de setor.** Os condicionais de `src/ai/prompt/montar.js` são identidade, nº de contratos, aviso ativo, modo noturno e limite de perguntas. Não há onde pendurar "o assunto é comercial".
2. **Existe teste proibindo** preço, velocidade e termos como "fibra/grátis/ilimitado" em módulo de prompt (`src/ai/prompt/montar.test.js:260-292`). Só `painel` pode repassar texto do operador. Um módulo de planos nasceria brigando com uma trava criada de propósito.
3. **Módulo entra por estado, não por necessidade.** Continuaríamos mandando a tabela de planos em conversa de boleto — o objetivo de tokens não seria atingido.

### As duas ferramentas

```
consultar_planos()
  → [{ id, name, speedMbps, monthlyPrice, installCondition }]
```

Dados estruturados vindos do cadastro, nunca texto hardcoded. **Sem `note`.** Apenas planos ativos, na ordem de exibição. A IA só a consulta quando realmente precisa — lista de planos não entra em conversa de boleto ou de suporte.

```
verificar_cobertura(nome)
  → { situacao: 'atendida' | 'precisa_verificar_viabilidade', localidade, municipio }
```

**Não é binário, e isso é regra comercial.** Ausência no cadastro **não** vira "não atendemos":

| Condição | Resultado |
|---|---|
| Cadastrada, `active=true` e `served=true` | `atendida` |
| Sem correspondência suficiente, ou configuração que não permita confirmar | `precisa_verificar_viabilidade` |

Com `precisa_verificar_viabilidade`, a IA encaminha a confirmação ao Comercial — **nunca nega cobertura por conta própria.**

A ferramenta **não devolve a lista de cidades**: devolve o veredito e o nome canônico. É o mesmo padrão já provado com os nomes aceitos no comprovante, onde a lista nunca chega ao modelo e só o resultado atravessa.

## B4. Guarda contra preço sem fonte: proveniência, não regex

O risco de B3 é o modelo não chamar a ferramenta e inventar preço.

**O regex de oferta da simulação (`src/ai/simulacao/invariantes.js:372`) serve de referência inicial, não de juiz.** Ele confundiria frases legítimas:

- `"seu plano é de 600 Mega"` — suporte, falando do plano contratado
- `"o teste mostrou 300 Mbps"` — repetindo o que o cliente disse

### A regra: autoridade por domínio, não rastreabilidade genérica

> Uma informação só pode sair como fato se vier de uma fonte **com autoridade para aquele tipo de afirmação**.

Rastreabilidade sozinha não basta. O histórico da conversa é uma fonte rastreável e **não tem autoridade comercial**:

```
Cliente: "Me falaram que 800 Mega é R$ 100."
```

Esse número está no histórico, é perfeitamente rastreável — e **não autoriza** a IA a afirmar *"800 Mega custa R$ 100"*.

| Tipo de afirmação | Única fonte com autoridade |
|---|---|
| Preço, plano disponível, condição comercial | Resultado válido de `consultar_planos` |
| Plano contratado e demais fatos do contrato | SGP |
| Cobertura | `verificar_cobertura` |
| Velocidade de teste, quantidade ou valor **relatado pelo cliente** | O histórico — mas **somente como informação atribuída ao cliente**, nunca como fato oficial da empresa |

A última linha é a que resolve os falsos positivos sem abrir buraco: *"o teste mostrou 300 Mbps"* é legítimo porque está sendo **atribuído ao cliente**, não afirmado como dado da empresa. Afirmar preço com a mesma origem não é.

O detector pode continuar encontrando candidatos por regex ou por estrutura. O que decide é se a fonte tem autoridade **para aquele tipo** — não se o número aparece em algum lugar.

### Restrições

- **Nenhum fallback hardcoded.** A guarda nunca substitui valor por conta própria.
- Se for preciso regenerar a resposta depois da ferramenta, usar **o fluxo controlado que já existe** no orquestrador — o mesmo mecanismo de `AFIRMA_ENVIO`, que força a chamada e reescreve. Não inventar caminho paralelo.
- **Auditável depois:** o registro guarda **qual fonte cobriu cada afirmação e se ela tinha autoridade para aquele tipo**, de modo que seja possível saber que determinado preço veio de `consultar_planos` e não da memória do modelo, de prompt antigo ou de algo que o cliente disse.
- **Testes específicos antes de produção**, cobrindo os dois falsos positivos acima e o caso do número sem fonte.

## B5. Localidade no contexto da IA

A localidade entra como fato quando relevante, junto com o município:

```
Localidade: Barão de Tromai
Município: Cândido Mendes
```

**Não existe proibição absoluta de mencionar a localidade.** A regra é de proporção:

- não oferecer dado cadastral espontaneamente, sem necessidade;
- usar município e localidade normalmente quando forem pertinentes ao assunto.

Se o cliente perguntar *"vocês atendem Barão de Tromai?"*, responder usando o resultado de `verificar_cobertura` é legítimo e desejado.

Empresa continua como está: um único campo, `name`, injetado em `src/ai/prompt/principios.js:18`. Nada a mudar.

## B6. Vínculo plano ↔ cidade: porta aberta, sem abstração morta

**Não criar `plan_coverage` agora.** Hoje os planos são gerais.

**Também não criar um parâmetro `localityId` que seria ignorado.** A porta para evolução é a **separação em serviço/repositório**, não um argumento fantasma:

```
hoje:   listarPlanosDisponiveis()
futuro: listarPlanosDisponiveis({ localityId })   // quando existir cobertura por plano
```

## B7. Como retirar as listas fixas das Instruções adicionais

A ordem importa, e invertê-la derruba o atendimento comercial no mesmo instante:

1. Cadastros existem e **populados** — planos ativos e `served` marcado nas localidades
2. Ferramentas ligadas e **provadas** por teste e mock, mais o `scripts/dump-prompt.js`, sem gastar OpenAI real
3. Contexto validado no dump
4. Teste controlado com conversa real própria
5. **Só então** o bloco de planos e cobertura sai das Instruções adicionais

> **Não remover o caminho atual antes de provar o novo.**

Dois detalhes que só aparecem lendo o código:

- **O campo não some.** `triage_extra_instructions` continua existindo para política comercial, tom e documentação. Sai o bloco de planos e cobertura, não o campo.
- **O `else` de `src/ai/prompt/painel.js:22-30` precisa ser reescrito antes.** Hoje, campo vazio dispara um texto mandando a IA dizer que não tem como confirmar preço e encaminhar ao comercial. Esvaziar as instruções sem mexer nesse `else` faz a IA parar de vender — mesmo com o cadastro cheio e as ferramentas no ar.

---

# Seção C — Regra financeira das faturas vencidas

## C1. O problema

Um cliente pode ter um carnê com doze faturas geradas. **A quantidade total não pode definir o fluxo** — o que importa é quantas estão **vencidas e ainda em aberto**.

## C2. A regra

```
0 vencidas em aberto  → comportamento financeiro atual permanece
1 vencida em aberto   → a IA pode entregar EXATAMENTE essa fatura,
                        mesmo que esteja atrasada há vários meses
2+ vencidas em aberto → nenhuma entrega automática de boleto, Pix
                        ou segunda via → Reativação
contrato cancelado    → nenhuma entrega automática → Reativação,
                        independentemente da quantidade de vencidas
```

**Fatura que vence hoje não conta como vencida.** Comparação estrita, granularidade de dia.

Com exatamente uma vencida, o `daMaisAntiga()[0]` atual já selecionaria a fatura certa — mas por coincidência de ordenação, não por decisão. **A regra devolve a fatura aplicável, e a ferramenta usa a que ela apontou.** Acertar por acidente não é acertar.

## C3. De onde vêm os fatos — e por que não do status textual

O status da fatura no SGP é inutilizável para decisão:

- `status` é **texto livre**: `'Aberto'`, `'Gerado'`, `'Em aberto'`, `'Pago'`. O próprio código registra em comentário (`src/ai/tool-registry.js:691-694`) que *"não dá para interpretar com segurança"*
- `statusid` existe, mas **só o valor `1`** aparece em qualquer fixture, teste ou documento. Não há tabela de tradução
- **Renegociada não tem representação.** A única pista seria `vencimento_atualizado ≠ vencimento`, e isso vive num comentário, sem validação contra dado real
- `/api/central/titulos` **devolve pagas junto com abertas** (9 faturas num contrato com `contratoTitulosAReceber = 2`)

`/api/ura/fatura2via` é a **candidata a fonte autoritativa das faturas em aberto** — é dela que já saem os boletos entregues hoje, e o Financeiro a trata como quem sabe o que está em aberto.

> **Candidata, não fonte autoritativa.** Ela só passa a ser tratada como autoritativa depois de provado, com dado real, que exclui pagas e canceladas e como representa fatura renegociada e vencimento atualizado. Até lá, a regra desta seção é desenho, não contrato.

Na hipótese a validar:

> Vencida em aberto = fatura vinda do `fatura2via` cujo vencimento é anterior a hoje.

Quem decidiria "em aberto" é o SGP; a data apenas separaria vencida de futura **dentro do que o SGP já classificou**. Não seria comparação de data pura.

**⚠ Bloqueia a Etapa 5.** As perguntas 2 e 3 de *Verificações pendentes* precisam de dado real antes de qualquer implementação, e **continuam bloqueadoras** enquanto não forem respondidas. A comparação com `contratoTitulosAReceber`, que já vem do `consultacliente` sem custo de chamada, começa como **observabilidade/log, nunca como trava**. Havendo divergência, investigar antes de fixar a regra.

## C4. Forma: função pura, decisão estruturada

Módulo novo, sem I/O, espelhando `src/ai/trust-unlock-rules.js` — formato já provado no projeto, com suíte própria.

```
src/ai/overdue-invoice-rules.js

avaliarFaturasVencidas({ faturasEmAberto, statusContrato, hoje })
  → { permiteEntrega, motivo, vencidas, faturaAplicavel }
```

`motivo` é **código estável**, nunca frase:

- `none`
- `multiple_overdue_invoices`
- `cancelled_contract`

> **Texto para a IA ou para o atendente é construído fora da regra.** Nenhuma lógica posterior deve interpretar frases para controlar fluxo.

## C5. A data `hoje` é parâmetro, nunca `new Date()`

O protocolo diário já trabalha no fuso de São Paulo, e uma revisão pegou ali um bug real de locale no `Intl.DateTimeFormat`. Some-se que os testes do backend rodam com `TZ=UTC` forçado em `jest.global-setup.js`.

Se a regra chamasse `new Date()` internamente, o teste passaria em UTC e o cliente das 21h em São Paulo seria avaliado como se fosse o dia seguinte.

**`hoje` é injetado pelo chamador**, calculado uma vez em `America/Sao_Paulo`, comparado em granularidade de dia — como `avaliarElegibilidade` já faz.

## C6. Onde a regra é aplicada

`gerar_pix` e `enviar_boleto` já compartilham o mesmo caminho: `faturaEmAlgumContrato()` devolve as faturas em aberto e só depois vem `daMaisAntiga`. **A avaliação entra entre os dois** — um lugar, duas ferramentas.

| Caminho | Aplica a regra? |
|---|---|
| `gerar_pix` | Sim |
| `enviar_boleto` | Sim |
| `gerar_segunda_via` | **Sim.** Não envia, mas entrega a linha digitável ao modelo — liberar num fluxo bloqueado seria porta dos fundos |
| Instrução de `consultar_faturas_todos_contratos` | **Sim** — ver C7 |
| Painel humano (`src/api/sgp-query.routes.js`) | **Não.** Fora da restrição por decisão do proprietário |

### Confirmação: não existe um quarto caminho

Busca concluída em 2026-09-22. Os caminhos da IA capazes de fornecer linha digitável, boleto, Pix, link de pagamento ou código de cobrança são exatamente três:

| Caminho | Evidência |
|---|---|
| `gerar_segunda_via` | `src/ai/tool-registry.js:921` — devolve `linhaDigitavel` e `linkBoleto` ao modelo |
| `gerar_pix` | `src/ai/tool-registry.js:978` — devolve `pixCopiaCola` |
| `enviar_boleto` | `src/ai/tool-registry.js:1471-1536` |

`consultar_faturas` e `consultar_faturas_todos_contratos` **não conseguem vazar** código de pagamento: `normalizeInvoices` descarta `linhadigitavel` e `codigopix` de propósito (`src/ai/sgp-normalizer.js:66`). `payment-sender`, `outbound-worker` e os adapters são transporte, sempre a jusante das três.

**Esta busca deve ser refeita no início da Etapa 5**, porque uma ferramenta nova criada entre hoje e lá seria justamente o quarto caminho que não pode existir.

## C7. `consultar_faturas_todos_contratos` muda junto

Hoje essa ferramenta gera uma instrução determinística mandando *"entregue dele AGORA, sem perguntar nada"* (`src/ai/tool-registry.js:711-723`).

Se ela não conhecer o bloqueio, o modelo recebe ordem de entregar e a ferramenta seguinte recusa — o turno vira pingue-pongue e o cliente recebe mensagem contraditória.

> A ferramenta precisa **receber e considerar a mesma decisão determinística**. Nenhuma ordem contraditória entre ferramentas.

## C8. Escopo: terceiro entra, atendente humano não

**Terceiro é bloqueado também.** A regra pertence ao contrato, não à identidade de quem solicitou. Não bloquear abriria um desvio trivial: bastaria entrar como terceiro para furar a regra. As regras existentes de segurança e isolamento de terceiro continuam intactas.

**Atendente humano continua livre.** O caminho do painel não passa por nada disso.

## C9. O setor de Reativação

```
ai_config.reactivation_sector_id UUID NULL REFERENCES sectors(id) ON DELETE SET NULL
```

Espelha `ai_config.triage_resolved_reason_id`, precedente exato desse padrão no projeto. **O painel é a fonte de qual setor representa Reativação.**

| Situação | Comportamento |
|---|---|
| 2+ vencidas, setor configurado | Não entrega. Encaminha para o setor configurado |
| 2+ vencidas, **setor não configurado** | **Não entrega.** Não cai no Financeiro. Segue para a fila humana pelo fallback seguro que já existe (conclusão sem setor) e **registra claramente que o Setor de Reativação precisa ser configurado** |
| Setor apagado do cadastro | Ponteiro vira nulo; cai no caso acima |

> **Nenhum hardcode de "Reativação" nem de "Financeiro" como regra de roteamento.**

Existe teste global proibindo nome de setor literal no prompt (`src/ai/prompt/montar.test.js:263-264`) — esta decisão é coerente com ele.

Na tela, cartão de aviso quando o ponteiro estiver vazio, no mesmo padrão do cartão de Empresa que avisa *"sem nomes aceitos, nenhum comprovante confere"*.

**Condição futura:** `sectors` não tem coluna `active` hoje. Se um dia tiver, a checagem do ponteiro deve tratar **setor inativo como configuração indisponível**, caindo no mesmo fallback.

## C10. O encaminhamento é disparado por dado estruturado

O orquestrador **não** pode descobrir que é caso de Reativação lendo uma frase da ferramenta.

A recusa carrega campos estruturados, conceitualmente:

```
reason              = multiple_overdue_invoices
requiresHumanHandoff = true
targetSectorId       = <uuid ou null>
```

A partir deles, o código força o caminho de conclusão **que já existe** — o mesmo mecanismo que hoje força `toolChoice = 'concluir_triagem'` quando o modelo anuncia encaminhamento sem executar. **Mecanismo existente, gatilho novo.**

> A IA pode redigir a mensagem ao cliente. **A IA não decide se a regra se aplica.**

## C11. A regra dos 90 dias sai quando a nova entra

Não podem coexistir duas regras competindo. A decisão passa a ser: **quantidade de vencidas em aberto** e **status cancelado do contrato**.

**Busca concluída em 2026-09-22 — não há segunda versão escondida.** Em produção, a regra existe num único lugar: a string de `src/ai/prompt/fluxos/reativacao.js:68`. Os demais achados:

| Local | O que é | Ação |
|---|---|---|
| `src/ai/prompt/fluxos/reativacao.js:68` | a regra viva | **sai** |
| `src/ai/prompt/fluxos/reativacao.js:1-56` | comentários de projeto | reescrever para refletir a regra nova |
| `src/ai/prompt/fluxos/reativacao.test.js:34-49` | asserções que **exigem** o texto dos 90 dias | **reescrever, nunca apagar** — teste que protege regra não é removido junto com ela |
| doc de 2026-09-17, linha 139 | referência a `ai-orchestrator.js:577` | **já está errada hoje.** Não confiar |

**Repetir esta busca no início da Etapa 5.**

## C12. Trade-off aprovado conscientemente

| Antes | Depois |
|---|---|
| Contrato cancelado ainda podia chegar à entrega automática da cobrança | Contrato cancelado vai para Reativação e aguarda atendimento humano |

Mais controle, menos automação. Decisão operacional aprovada pelo proprietário, registrada aqui para não virar surpresa.

---

# Seção D — Consolidação

## D1. Migrations

**Etapa 1 — três migrations:**

| # | Conteúdo |
|---|---|
| 1 | `cities`: `kind` (default `'unclassified'`), `parent_id`, `sgp_pop`, `sgp_pop_key`, `active`, `served` (default `false`), `note`; os `CHECK`; índice único de `sgp_pop_key`; `UNIQUE (id, parent_id)`; **índice em `contacts.city_id`** (lacuna que já existe hoje — a FK não cria índice do lado filho, e o `DELETE` de cidade faz varredura sequencial) |
| 2 | `contacts.locality_id` + índice + **FK composta** `(locality_id, city_id) → cities(id, parent_id)` com `ON DELETE SET NULL (locality_id)` + `CHECK (locality_id IS NULL OR city_id IS NOT NULL)` |
| 3 | tabela `plans` |

**Nenhuma dessas migrations converte dado.** Os 13 registros existentes recebem os defaults e continuam funcionando como hoje. A conversão dos três povoados (A11) **não é migration** — é operação administrativa separada e autorizada, fora do `migrate up` automático do Render.

**Etapa 5 — uma migration:**

| # | Conteúdo |
|---|---|
| 4 | `ai_config.reactivation_sector_id` |

> **`ai_config` não é tocado na Etapa 1.** Antecipar a coluna "porque seria inerte" quebraria a separação de etapas que a própria ordem de implementação estabeleceu.

### Aditiva não significa sem risco

As migrations da Etapa 1 são aditivas, com default, e nenhuma linha existente muda de comportamento. **Isso não as torna automaticamente seguras.** `CHECK`, FK, índices e defaults precisam ser validados contra o **estado real dos dados**:

- um `CHECK` novo é verificado contra todas as linhas existentes e **falha a migration** se alguma violar;
- um índice único encontra duplicatas que ninguém sabia que existiam;
- uma FK falha se houver referência órfã.

A implementação deve testar `up` **e** `down` e provar compatibilidade com registros existentes.

O ambiente local está com `cities` em **zero** e **não é representativo**: produção tem **13 registros**, três deles povoados com 66 contatos vinculados. Qualquer teste de migration que só rode contra o local está testando a tabela vazia. A suíte precisa de fixtures que reproduzam o formato de produção — inclusive uma linha `'unclassified'` com contatos.

## D2. Endpoints

**Novos:**

- `PATCH /api/admin/cities/:id` — a edição que não existe hoje
- `GET/POST/PATCH/DELETE /api/admin/plans`
- `GET /api/plans` — operacional, **sem `note`**

**Ampliados de forma aditiva (ADR-010 — nenhum contrato existente quebra):**

- `POST /api/admin/cities` — campos novos, todos opcionais com default
- `GET /api/cities` — **comportamento padrão inalterado**; `?includeLocalities=true` é opt-in
- `GET /api/admin/cities/notices` — passa a listar localidades
- `PATCH /api/contacts/:id` — aceita `localityId`, com a invariante de A6
- whitelist do `PATCH /api/admin/ai/triage` — ganha `reactivationSectorId` **na Etapa 5**

Ao apagar um município que tenha localidade filha, a rota deve devolver **409 com explicação**, não deixar o erro de FK virar 500. O mesmo vale para as **edições estruturais** de `kind` e `parent_id` descritas em A10, com as dependências listadas lá.

## D3. Telas

| Tela | Mudança | Etapa |
|---|---|---|
| Cadastros → Cidades | vira "Cidades e localidades": Tipo, Município, POP, Ativa, Atendida + **Editar** | 1 |
| Cadastros → **Planos** | **nova**, mesmo padrão de Cidades (`ui/DataTable` + `ui/Dialog`) | 1 |
| Editar contato | 2 selects encadeados | 1 |
| Mensagens → Avisos | agrupado por município, localidades aninhadas | 3 |
| Lista / painel / Supervisão | exibem a localidade quando houver | 3 |
| Automação → Triagem | select do Setor de Reativação + cartão de aviso quando vazio | 5 |

## D4. O que NÃO muda

- **`company_config` inteiro.** Empresa já funciona e continua sendo a fonte da identidade. Nenhum cadastro duplicado é criado
- **`city_notices` e `city_notice_deliveries`** — nenhuma migration. É o ganho de manter uma tabela só
- **`src/cities/city-matcher.js`** — o casamento por nome de cidade fica como está
- **A tabela `sectors`**
- **Idempotência e `ai_billing_deliveries`**
- **`trust-unlock-rules.js`** e a regra dos 30/60 dias do desbloqueio em confiança
- **O módulo de comprovante** e a validação de favorecido
- **Baileys, Meta Cloud, 360dialog**; janela de 24h; triagem numérica
- **O painel humano do SGP** (`src/api/sgp-query.routes.js`)
- **`daMaisAntiga`**, que continua valendo no caso de zero vencidas

## D5. Riscos de regressão, em ordem de probabilidade

1. **Colunas enumeradas.** 4 queries em `city.repository`, 7 em `contact.repository`, 10 funções com JOIN em `conversation.repository`. Esquecer uma faz a localidade sumir numa tela só, e ninguém nota até produção.
2. **Consumidores antigos recebendo povoados.** Mitigado por desenho em A3: `listCities()` e `GET /api/cities` continuam significando municípios. Esquecer de atualizar um consumidor causa ausência de recurso, não regressão. **Esta mitigação não pode ser revertida sem revisar a seção A inteira.**
3. **Vocabulário do Whisper.** O campo `prompt` da API tem limite prático (~224 tokens). Somar dezenas de localidades pode **empurrar para fora** o vocabulário técnico que hoje ajuda (`src/ai/transcription.service.js:37-46`). Precisa ser **medido**, não presumido — talvez só localidades marcadas entrem.
4. **A busca hierárquica de aviso.** Um erro ali faz clientes pararem de receber aviso de falha **em silêncio**: nada quebra, apenas deixa de acontecer.
5. **Esvaziar as Instruções adicionais cedo demais**, ou esquecer o `else` de `painel.js`: a IA para de vender no mesmo instante.
6. **As premissas do `fatura2via`.** Se o vencimento renegociado não for o esperado, bloqueamos cliente que negociou — o pior erro possível desta regra.
7. **Apagar município com localidade filha.** A FK sem `ON DELETE` definido recusa por padrão — comportamento correto, mas vira 500 se a rota não tratar.
8. **Testes que quebram de propósito:** `reativacao.test.js` e os do repositório de cidades. **Reescrever, nunca apagar.**
9. **`sgp_pop_key` derivada.** O banco não garante a derivação. Mitigado por caminho de escrita único mais teste.

## D6. Ordem de implementação

| Etapa | Conteúdo | Toca área protegida? |
|---|---|---|
| **1** | **Estrutura.** Evolução de `cities`; `contacts.locality_id`; tabela `plans`; endpoints; telas; edição; validações. Dados legados **intocados** | **Não.** Nasce inteira e inerte |
| **1C** | **Conversão dos dados legados** (A11): os três povoados viram `locality` com pai correto; seus contatos ganham `locality_id`. Operação separada, transacional, **autorizada uma a uma**, fora do `migrate up` do Render | Não |
| **2** | Proprietário popula localidades, POPs e planos, e marca `served`. **Validação do formato real de `popNome` e das duas incertezas do `fatura2via`** | Não |
| **3** | POP → localidade automático; localidade no contexto; aviso hierárquico | Sim: `contact-city.service`, módulo de aviso |
| **4** | `consultar_planos`, `verificar_cobertura`, guarda de proveniência. **Só depois de provado**, o bloco sai das Instruções adicionais | Sim: tool-registry, autorização, `painel.js`, orquestrador |
| **5** | Regra das vencidas; setor de Reativação; saída dos 90 dias | Sim: ferramentas financeiras, `reativacao.js`, `ai_config` |

**Cada etapa exige aprovação própria e explícita do proprietário.**

Sobre a Etapa 1, com precisão:

> A Etapa 1 **não altera intencionalmente** IA, SGP, WhatsApp nem regras de atendimento. Entretanto, como **modifica estruturas e APIs já usadas por cidades e contatos**, exige **testes de regressão desses fluxos existentes**.

Ou seja: é a etapa de menor risco *de mudança de comportamento*, não uma etapa sem risco. Ela toca `cities`, `contacts`, três repositórios, os endpoints de cidade e de contato e o seletor de cidade da tela — tudo isso já em uso hoje. A compatibilidade segura por padrão de `listCities()` e `GET /api/cities` (seção A3) é o que mantém esse risco baixo, e **não pode ser revertida** sem revisar a seção A inteira.

A Etapa 5 **depende** de a Etapa 2 ter respondido as duas perguntas do `fatura2via`. Se a resposta for ruim — por exemplo, se o vencimento renegociado não vier —, **a regra precisa ser redesenhada, não forçada.**

---

# Verificações pendentes

Não são tarefas de desenvolvimento. São perguntas que só dado real responde, e cada uma bloqueia a etapa indicada.

| # | Pergunta | Bloqueia | Como responder |
|---|---|---|---|
| 1 | Qual o formato real de `popNome`? (`Barão`, `POP BARÃO`, `BARAO DE TROMAI`?) Há prefixo fixo? | Etapa 3 | Leitura real de ao menos um cliente conhecido, sem escrita |
| 2 | `fatura2via` realmente exclui pagas e canceladas? | Etapa 5 | Leitura real, comparando com `/api/central/titulos` no mesmo contrato |
| 3 | O vencimento devolvido pelo `fatura2via` representa a fatura renegociada ou o original? | Etapa 5 | Leitura real de um contrato com fatura renegociada |
| 4 | ~~Versão do PostgreSQL~~ | ~~Etapa 1~~ | ✅ **Respondida 2026-09-22: 16.15.** FK composta de A6 viável |
| 5 | ~~Quantas cidades em produção, há duplicadas?~~ | ~~Etapa 1~~ | ✅ **Respondida 2026-09-22: 13 registros, nenhuma duplicata.** Revelou o achado de A11 |
| 6 | ~~Município de Aurizona e de "Chega tudo"~~ | ~~conversão de A11~~ | ✅ **Respondida 2026-09-22 pela operação:** Godofredo Viana e Centro Novo do Maranhão. Ver A11 |

Nenhuma dessas consultas pode ser destrutiva ou paga.

---

# Achados registrados, não implementados

Encontrados durante a investigação. **Não são fila de trabalho** e só viram tarefa por decisão explícita, com escopo próprio — seguindo a prática já estabelecida no projeto.

- **`migrations/1788960000000_create-ai-tables.js:1`** — o seed de `ai_config.system_prompt` começa com *"Você é a assistente virtual da DW Telecom"*, e esse texto é a **primeira linha de todo prompt de triagem**. Numa instalação nova de outro provedor, o modelo se apresenta com a marca errada, contradizendo `principios.js:18`, que usa o nome configurado. `src/ai/ai-config.repository.test.js:30` cristaliza o comportamento.
- **`migrations/1788970000000_add-audio-transcription.js:2`** — o vocabulário padrão da transcrição também traz a marca.
- **`logo_url`, `symbol_url` e `brand_color` são feature morta.** Existem em `company_config`, no repositório, na validação e na rota pública, com **zero consumidores**. O frontend ainda importa PNG de marca no build (`frontend/src/branding/index.js:18-19`), e o comentário daquele arquivo, que diz que o backend não entrega marca, já está desatualizado.
- **`upsertCompanyConfig` não protege `name` nem `acceptedPayeeNames`** contra reset lateral. Só os três campos visuais têm a lógica de "não mexe" do ADR-011.
- **`cities.name` sem UNIQUE e sem normalização na criação.** Dá para cadastrar `Bahia`, `bahia` e `BAHIA` como três registros; duas cidades que normalizem igual fazem o preenchimento automático **desistir em silêncio** (`city-matcher.js:51-52`). Com localidades, o risco muda de forma: `Centro` como povoado de dois municípios diferentes é legítimo, então **unicidade global de nome seria errada**. A forma correta seria unicidade normalizada por `(parent_id, name)` — mas isso **depende de não haver duplicatas em produção** e, portanto, da verificação nº 5.
- **`hasContactReceivedNotice`** (`src/city-notices/city-notice.repository.js:65-71`) está exportada e testada, sem chamador em produção.
- **`city_notices.activated_at`** é gravada e nunca lida para decidir nada.
- **O aviso de cidade é gravado como `sentBy: 'human'`** (default de `createMessage`), indistinguível de mensagem de atendente no histórico e nas métricas.
- **O aviso determinístico sai mesmo com atendente humano já atribuído**, ao contrário do aviso de horário comercial, que verifica.
- **O aviso só existe no perfil `triagem`.** No perfil assistente, a IA que sugere resposta ao atendente não sabe da falha regional.
- **Não há cache em `getCompanyConfig`** — uma query por turno de IA, por cartão Pix e por conversa nova.

---

# Documentação relacionada

- [[Arquitetura do Chat]] — princípio da separação entre código, SGP, painel e IA
- [[Decisões de Arquitetura]] — ADR-001 (painel), ADR-008 (dado interno não vaza), ADR-010 (evolução aditiva), ADR-011 (configuração parcial)
- [[Regras da IA]] — seção "Planos, preços e cobertura"
- [[SGP]] — campos e limites conhecidos da integração
- [[Próximos Passos]] — estado do projeto em 22/09/2026
