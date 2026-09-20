# Configurações — inventário e arquitetura proposta

**Proposta para aprovação. Sem alterações de código, dados, permissões ou regras de negócio.** Base: rotas e componentes atuais em `frontend/src/pages/settings`, `frontend/src/components` e `frontend/src/navigation/navItems.js`, examinados em 19/09/2026.

## 1. Diagnóstico em uma frase

A área já separa assuntos, mas mistura três perguntas diferentes — **o que a operação faz**, **em qual canal isso está ligado** e **qual serviço externo permite a função**. Algumas páginas são páginas completas, outras são abas escondidas atrás de um único item, e a entrada de Configurações abre diretamente Canais em vez de oferecer um mapa. O administrador precisa conhecer a implementação para prever onde procurar.

## 2. Inventário do que existe hoje

| Local atual | Configurações e ações reais | Escopo e observação |
|---|---|---|
| Canais WhatsApp → Canais | Criar canal Baileys, Meta Cloud ou 360dialog; listar, buscar, filtrar; ocultar/reexibir e excluir. | Por canal; ações de criação e manutenção exigem acesso de credenciais. |
| Canal → Conexão | Nome, provedor, tipo, número, status; QR e reconexão para Baileys; WABA ID e credenciais de canal oficial; ações avançadas. | Por canal; QR/reconectar têm uso operacional quando há falha. |
| Canal → Atendimento | Ativar triagem por menu, atendimento com IA, triagem com IA e atendimento noturno; resumos com links para regras globais. | Quatro ativações por canal. A IA requer dependências próprias; não são quatro configurações globais. |
| Automação e IA → Triagem por menu | Pergunta, mensagem de confirmação, número de tentativas; opções numeradas com setor e frases gatilho. | Regras globais; só rodam nos canais em que a triagem por menu está ligada e há opções. |
| Automação e IA → Atendimento e triagem com IA | Sugestões de resposta ao humano; confiança mínima, máximo de perguntas, tempo limite, motivo para encerrar após boleto/Pix, instruções adicionais; resumo do estado OpenAI e dos canais com IA. | Configuração global; o resumo de canais é informativo. Sugestões ao humano são uma função diferente da triagem autônoma. |
| Automação e IA → Identificação e comprovantes | Ler comprovantes também durante o dia sem desbloquear; texto informa identificação por CPF e aponta para nomes de favorecido. | A página tem uma única chave editável; o título sugere mais controles do que realmente existem. |
| Automação e IA → Transcrição de áudio | Ativar transcrição; modelo; duração e tamanho máximos; enviar texto à IA; vocabulário da operação; buscar modelos. | Global. Modelo, limites e vocabulário são ajustes técnicos. |
| Automação e IA → Atendimento noturno | Início e fim da janela diária da IA; lista de canais em que o modo noturno está ativo. | Janela global + ativação no canal. Diferente do horário humano. |
| Automação e IA → Ferramentas autorizadas | Permissões da IA para consultar cliente, contrato, conexão, plano, financeiro e faturas; analisar comprovante; registrar motivo; transferir, concluir triagem, encerrar; gerar segunda via/Pix, liberar em confiança e enviar boleto. | Permissões globais agrupadas por consulta, ação e ação sensível; identificadores internos aparecem na interface. |
| Regras de atendimento → Horário de atendimento | Ativar horário humano, hora inicial/final, mensagem fora do expediente. | Global; atualmente segunda a sexta. Não é a janela noturna da IA. |
| Mensagens e templates → Boas-vindas | Texto inicial por canal, antes das demais automações. | Por canal; edição exige acesso de credenciais. |
| Mensagens e templates → Abertura e encerramento | Ativar mensagem automática; textos ao assumir e encerrar; selecionar atendentes e canais em que se aplica. | Regra global com seleção de escopo. O antigo nome “Atribuição” descreve mal essa função. |
| Mensagens e templates → Avisos por cidade | Texto e ativação por cidade, além da boas-vindas. | Por cidade; depende do cadastro de cidades. |
| Mensagens e templates → Respostas rápidas | Criar, editar e excluir textos prontos usados pelo atendente. | Catálogo global. |
| Mensagens e templates → Templates WhatsApp | Criar, registrar existente, sincronizar, buscar, filtrar, inspecionar, classificar uso e excluir templates. | Só canais oficiais; pertence ao domínio WhatsApp e tem estados do provedor. |
| Equipe e acesso → Usuários | Criar usuário com nome, e-mail, senha e perfil; marcar acesso a credenciais para gerente na criação; ativar/desativar; editar setores; gerar nova senha. | Não há edição livre de perfil ou permissões após a criação na interface/API atual. |
| Equipe e acesso → Setores | Criar, editar e excluir setor; nome e orientação para a IA. | Catálogo global usado em triagem e equipe. |
| Equipe e acesso → Perfis de acesso | Matriz informativa de páginas e ações para atendente, gerente, gerente com credenciais e administrador. | Somente leitura; não é editor de papéis. |
| Integrações → SGP → Consultas | URL, app, token e ativação da consulta. | Conexão global usada no chat e pela IA para clientes, contratos e faturas. |
| Integrações → SGP → Envios por canal | Criar conexão de envio por canal, descrição, canal, template padrão para canal oficial, ativação, chave de API e rotação. | Fluxo **SGP → WhatsApp**; diferente da consulta **chat/IA → SGP**. |
| Integrações → OpenAI | Chave, modelo, modo Desativado/Assistente, teste de conexão. | Integração global. O rótulo “Modo” não explica seu efeito. |
| Cadastros auxiliares → Motivos | Criar, editar, ativar/desativar e buscar motivos; um motivo pode estar em uso pela IA ao encerrar. | Catálogo de encerramento e relatório. |
| Cadastros auxiliares → Cidades | Criar, buscar e excluir cidades. | Catálogo usado em contatos e avisos por cidade. |
| Empresa → Empresa | Nome da empresa e nomes aceitos como favorecido na análise de comprovantes. | Ambos salvos juntos hoje, mas respondem a tarefas diferentes. |

**Fora de Configurações hoje:** o som de notificações é uma preferência pessoal no menu principal; troca da própria senha fica em Meu perfil. **Não há páginas de configuração implementadas para Zabbix, telefonia ou notificações administrativas.** Não devem aparecer como opções vazias. Da mesma forma, a área “Segurança” sugerida como exemplo não tem ainda um conjunto de controles globais próprio.

## 3. Problemas que explicam a dificuldade de encontrar opções

1. **Profundidade inconsistente.** A navegação lateral lista individualmente seis páginas da IA, mas Mensagens, Equipe e Cadastros entram como um único item e só depois revelam abas. Integrações acrescenta cartões e mais abas internas.
2. **Sem índice nem busca global.** `/configuracoes` leva à primeira página permitida, Canais. Não há visão geral que responda “o que posso configurar?”.
3. **Assunto, escopo e dependência misturados.** Exemplo: janela noturna é global, ativação noturna é por canal, conexão OpenAI fica em Integrações. O sistema mostra links, mas não oferece uma visão única de “o que falta para a IA funcionar neste canal?”.
4. **Rótulos que prometem outra função.** “Atribuição” configura mensagens, não distribuição; “Identificação e comprovantes” quase só configura leitura diurna; “Atendimento noturno” não explicita que é da IA; “Perfis de acesso” parece editável, mas é informativo.
5. **Fontes de verdade aparentando duplicação.** “Triagem por menu” e “Atendimento noturno” aparecem em páginas globais e no canal. Não são dados duplicados: em um lugar se define a regra, no outro se ativa para aquele número. O texto atual não torna essa distinção consistente.
6. **Conteúdo de canal espalhado.** A boas-vindas é por canal, mas fica em Mensagens; templates oficiais também. O detalhe do canal mostra resumos desses conteúdos, chamados genericamente de “globais”, mesmo quando não são.
7. **Ajustes técnicos na mesma hierarquia das decisões de operação.** IDs internos de ferramentas, modelo de transcrição, limite de MB, token, WABA ID e rotação de chave competem visualmente com horários, textos e ativações.
8. **Páginas curtas e páginas longas têm o mesmo peso.** Uma única chave de comprovantes ocupa uma página; templates e canais exigem gestão completa. A arquitetura deveria refletir a complexidade da tarefa.

## 4. Regra de organização proposta

Toda configuração deve responder às três perguntas, sempre na mesma ordem:

1. **Assunto:** o que quero configurar? Define a categoria e a subcategoria.
2. **Escopo:** vale para toda a operação, para um canal, para uma cidade ou para determinadas pessoas?
3. **Dependências:** o que precisa estar configurado para produzir efeito?

Cada configuração terá **um único endereço de edição**. Páginas relacionadas podem mostrar o valor e oferecer um link “Configurar em…”, sem repetir o formulário. Isso evita divergência e preserva as regras atuais.

## 5. Estrutura final proposta — seis categorias

### 5.1 Empresa

- **Identidade da empresa** → nome exibido no login, no chat e em mensagens da IA.
- **Conferência de comprovantes** → nomes aceitos como favorecido de Pix e transferência. É a mesma configuração hoje salva com os dados da empresa; a futura interface deve preservar esse contrato de gravação até que haja uma mudança técnica deliberada.

### 5.2 Atendimento

- **Horários e ausência** → ativação do horário humano, início/fim de segunda a sexta, texto enviado fora do expediente. A página mostra o efeito do atendimento noturno da IA como dependência, com link para a configuração correspondente.
- **Mensagens automáticas**:
  - **Boas-vindas por canal** → texto inicial por número;
  - **Ao assumir e encerrar** → ativação, duas mensagens e seleção de atendentes/canais;
  - **Avisos por cidade** → mensagens e ativação por cidade.
- **Respostas rápidas** → catálogo de textos inseridos manualmente pelo atendente.
- **Motivos de atendimento** → catálogo, situação ativa/inativa e indicação quando um motivo é usado no encerramento pela IA.
- **Cidades atendidas** → catálogo usado em clientes e avisos.

### 5.3 IA e automação

- **Visão geral da IA** → estado de OpenAI e resumo por canal. Somente leitura e atalhos para as fontes de verdade; não é outro formulário.
- **Triagem por menu** → pergunta, confirmação, tentativas, opções numeradas, setor e frases gatilho. Mostrar canais que a ativaram.
- **Triagem com IA** → confiança mínima, perguntas, tempo limite e instruções adicionais; mostrar canais com IA/triagem ligadas.
- **Ajuda ao atendente** → sugerir respostas durante o atendimento humano. Essa chave merece nome e seção próprios porque não controla a IA antes da assunção.
- **Identificação e comprovantes** → explicar a identificação por CPF que já ocorre; editar a leitura de comprovantes durante o dia; mostrar link para favorecidos aceitos em Empresa.
- **Encerramento pela IA** → motivo usado após entregar boleto/Pix e dependência da permissão para encerrar. Mantém a mesma regra atual.
- **Atendimento noturno pela IA** → janela global, canais em que está ligado e dependências; ativação de cada canal continua no detalhe do canal.
- **Transcrição de áudio** → ativar e enviar texto para a IA; modelo, duração, tamanho e vocabulário em “Ajustes técnicos” dentro desta página.
- **Ações permitidas à IA** → consultas, ações e ações sensíveis. Mostrar nomes de negócio na lista; identificadores internos só em detalhe avançado. Inclui gerar Pix, segunda via, enviar boleto, analisar comprovante e liberar em confiança.

### 5.4 WhatsApp e canais

- **Números conectados** → lista, busca, criação e situação de cada canal.
- **Detalhe de cada número**:
  - **Conexão** → nome, provedor, número, estado, QR/reconexão quando aplicável, dados de API oficial e ações de manutenção;
  - **Recursos deste canal** → as quatro ativações existentes: triagem por menu, atendimento com IA, triagem com IA e atendimento noturno. Cada linha mostra a regra global aplicável e um link, sem copiá-la;
  - **Mensagens deste canal** → resumo somente de leitura e link direto para **Atendimento › Mensagens automáticas › Boas-vindas por canal**, que é o único lugar de edição.
- **Templates oficiais do WhatsApp** → cadastro, registro de existente, sincronização, filtros, prévia, finalidade e estado. Explicar que Meta Cloud e 360dialog são canais oficiais; Baileys não usa esses templates.

### 5.5 Integrações

- **SGP**:
  - **Consultar clientes e faturas** → URL, app, token e ativação da consulta usada pelo chat e pela IA;
  - **Enviar mensagens pelo SGP** → conexões por canal, descrição, ativação, template padrão quando o canal é oficial, chave e rotação. A direção do fluxo aparece em texto: SGP → WhatsApp.
- **OpenAI** → chave, modelo, estado operacional Desativado/Assistente e teste de conexão. Link para regras e ações da IA, que permanecem na categoria IA e automação.

### 5.6 Equipe e acesso

- **Usuários** → criar usuário, perfil inicial, acesso de gerente a credenciais na criação, situação, setores e geração de nova senha. A interface não deve prometer editar perfil/permissões individuais posteriormente enquanto isso não existir no produto.
- **Setores** → nome e orientação usada pela IA.
- **O que cada perfil pode fazer** → matriz atual de permissões, claramente marcada como consulta. Explicar o que é fixo pela regra de negócio e o que pode ser alterado hoje.

**Por que não criar agora categorias Financeiro, Notificações, Segurança e Avançadas?** Os controles financeiros reais estão divididos entre SGP, ações da IA e conferência de comprovantes. Reuni-los em uma categoria com formulários duplicados esconderia suas fontes de verdade; a busca por “boleto” e “Pix” deve reunir essas rotas. Notificações têm hoje apenas som pessoal, acessível a todos pelo perfil/menu. Segurança não tem configuração global própria. Ajustes avançados funcionam melhor dentro da página do assunto correspondente. Essas categorias poderão nascer quando houver controles próprios, sem telas vazias.

## 6. Nomes atuais → nomes propostos

| Atual | Proposto | Razão |
|---|---|---|
| Canais WhatsApp → Canais | WhatsApp e canais → Números conectados | Remove repetição e usa o objeto que o usuário procura. |
| Canal → Atendimento | Canal → Recursos deste canal | Separa ativações do atendimento em geral. |
| Regras de atendimento → Horário de atendimento | Atendimento → Horários e ausência | Inclui claramente o aviso fora do expediente. |
| “Atribuição” / “Abertura e encerramento” | Mensagens ao assumir e encerrar | Descreve o gatilho real; não sugere regra de distribuição. |
| Atendimento e triagem com IA | Triagem com IA + Ajuda ao atendente + Encerramento pela IA | São decisões distintas hoje reunidas na mesma página. |
| Identificação e comprovantes | Leitura de comprovantes | A identificação por CPF é informativa, não um controle livre nesta página. |
| Atendimento noturno | Atendimento noturno pela IA | Evita confusão com horário humano. |
| Ferramentas autorizadas | Ações permitidas à IA | Linguagem de operação; mantém consultas e ações sensíveis separadas. |
| SGP → Consultas / Envios por canal | Consultar clientes e faturas / Enviar mensagens pelo SGP | Deixa explícita a direção de cada integração. |
| Perfis de acesso | O que cada perfil pode fazer | Indica que é uma matriz informativa. |
| Cadastros auxiliares | Motivos de atendimento / Cidades atendidas em Atendimento | Remove uma categoria técnica de baixa previsibilidade. |
| OpenAI → Modo | Estado operacional da integração | “Modo” isolado não diz o que muda; as opções continuam Desativado/Assistente. |

## 7. Busca de Configurações

A busca fica no topo da área e indexa **nome canônico, nome antigo, sinônimos, descrição, escopo e dependências**. O resultado mostra o caminho completo, por exemplo: `IA e automação › Ações permitidas à IA › Liberar em confiança`, e abre a página com foco/realce na configuração exata. Resultados em páginas sem permissão aparecem bloqueados com motivo, sem criar uma rota alternativa. Uma consulta pode trazer vários resultados legítimos quando o termo cobre funções diferentes, mas cada resultado aponta para uma fonte de edição única.

| Busca | Principais resultados esperados |
|---|---|
| triagem | Triagem por menu; Triagem com IA; ativação no número específico. |
| desbloqueio | Ações permitidas à IA → Liberar em confiança; dependência SGP se aplicável. |
| SGP | Consultar clientes e faturas; Enviar mensagens pelo SGP. |
| IA | Visão geral; triagem; ajuda ao atendente; noturno; transcrição; ações; conexão OpenAI. |
| horário | Horários e ausência; Atendimento noturno pela IA, claramente diferenciados. |
| WhatsApp | Números conectados; conexão; recursos do número; templates oficiais. |
| boleto | Encerramento pela IA; ações gerar segunda via/enviar PDF; SGP. |
| Pix | Gerar Pix; encerramento pela IA; favorecidos aceitos; SGP. |
| notificações | Preferência pessoal de som no perfil/menu; informar que não há regras administrativas de notificações. |

Se houver busca por “permissão de atendente”, priorizar **Usuários → Setores** e **O que cada perfil pode fazer**. A segunda é informativa; não mostrar botão inexistente de editar permissões. Para mudanças de papel ou permissões individuais além das atuais, será necessária uma decisão separada de produto e backend.

## 8. Layout e fluxo de uso

**Desktop:** navegação lateral com as seis categorias, expansível uma categoria por vez e mostrando suas subpáginas; busca fixa no topo; conteúdo à direita. O caminho `Categoria › Subcategoria › Configuração` aparece acima do título. O título responde o que se altera; uma descrição de uma linha explica o efeito. Abaixo: estado atual, escopo e dependências. Formulários usam seções separadas por linhas leves; cards só para resumo de conexão, avisos importantes ou itens independentes. Listas extensas, como usuários, canais e templates, usam tabela/lista com busca e filtros.

**Ao entrar em Configurações:** abrir um índice curto, não redirecionar automaticamente para Canais. Mostrar busca, seis categorias e atalhos para tarefas frequentes como horário, IA, canais, SGP e usuários. Não transformar o índice em um painel de dezenas de cards.

**Salvar:** cada conjunto de campos explica o escopo e exige ação explícita de salvar. Switch apenas para estado binário real. Se a mudança tiver dependência, mostrar o motivo e link para resolvê-la; não ativar/desativar outra função silenciosamente. Mensagens de sucesso/erro ficam perto do controle. Ações irreversíveis ou que cortam integração ficam em área de risco da página correspondente.

**Celular/largura menor:** a categoria vira um seletor de navegação com busca e breadcrumb; o conteúdo ocupa a largura inteira. Não comprimir lateral e formulário em duas colunas estreitas.

## 9. O que fica avançado — sem desaparecer

- **Canal → Conexão → Detalhes técnicos:** WABA ID, credenciais da Meta, detalhes específicos do provedor. QR e Reconectar devem emergir no estado desconectado; não podem ficar escondidos quando são a ação necessária. Ocultar, excluir e rotação de credenciais ficam em área de risco.
- **Integrações → SGP/OpenAI → Credenciais:** tokens, chave de API, geração/rotação de chave e dados de endpoint. Estado da conexão e teste ficam visíveis.
- **IA → Triagem com IA → Ajustes avançados:** instruções adicionais. Confiança, perguntas e tempo limite podem continuar na página principal porque afetam diretamente o comportamento.
- **IA → Transcrição → Ajustes técnicos:** modelo, tamanho/duração máxima e vocabulário. Ativar transcrição e enviar à IA ficam visíveis.
- **IA → Ações permitidas → Detalhes técnicos:** nomes internos das ferramentas. As permissões, sobretudo liberar em confiança e enviar cobrança, ficam visíveis em sua página dedicada.

“Avançado” é um nível de apresentação **dentro do assunto**, não um depósito global que obrigue o administrador a adivinhar para onde um controle foi movido.

## 10. Cuidados para não alterar comportamento ao reorganizar

1. As quatro ativações da IA/triagem/noturno são **por canal**; parâmetros são **globais**. Não copiar chaves para outra página nem criar dois pontos de edição.
2. As páginas atuais de triagem com IA, leitura de comprovantes e janela noturna enviam campos de um mesmo conjunto ao salvar. Separar visualmente exige continuar carregando e preservando todos os valores, inclusive os que não aparecem na subpágina.
3. “Atendimento com IA” e “Triagem com IA” têm dependência; modo noturno exige triagem com IA e janela definida. A proposta muda explicação e localização, não essa regra.
4. Horário humano e janela noturna da IA continuam regras distintas. O aviso fora do expediente e a precedência do noturno não mudam.
5. Consulta ao SGP e envio do SGP por canal são integrações em direções diferentes. Nenhuma substitui a outra.
6. Boas-vindas por canal preserva a permissão específica de credenciais. Mudar a página não dá automaticamente a um gerente permissão que ele não possui.
7. Perfis de usuário permanecem os papéis atuais. A matriz é somente leitura; a API atual permite criar com papel, alterar atividade, setores e senha, mas não trocar livremente o papel depois.
8. Preferência pessoal de som e troca da própria senha continuam acessíveis aos atendentes fora da área administrativa de Configurações. Colocá-las exclusivamente aqui alteraria o acesso.

## 11. Critério de aprovação da arquitetura

Uma pessoa que nunca administrou o produto deve conseguir localizar, pelo menu ou busca, em até poucos passos: número WhatsApp, triagem, modo noturno, horário humano, SGP, Pix/boleto, desbloqueio, setor de atendente e mensagens de boas-vindas. Ao chegar, ela precisa saber **o que muda**, **onde vale**, **o que depende de outra opção** e **se tem permissão para salvar**. Validar esse teste de localização com administradores e gerentes antes de desenhar telas finais ou implementar.
