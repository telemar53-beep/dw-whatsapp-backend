# Análise e proposta de UX/UI — DW Atendimento

**Versão para discussão, 19/09/2026. Nenhuma implementação realizada.**

**Direção visual escolhida pelo proprietário:** grafite médio, conforme a comparação de três tons da mesa de atendimento. Referência: `output/uxui/04-mesa-grafite-medio.png`. Esta escolha fixa a base de cor para as próximas propostas; dimensões, componentes e fluxos ainda precisam de revisão.

## 1. Base e alcance

Esta análise usa as rotas e componentes atuais de `frontend/src`, o inventário funcional de 15/09 e as capturas em `output/reorganizacao`. As capturas são registros do projeto; não substituem observação de atendentes usando dados reais por oito horas. Os números e limites abaixo são hipóteses de design a validar, não métricas já medidas. A proposta preserva a identidade escura e o laranja como ponto de partida; a intensidade visual pode ser ajustada na validação.

Há cinco áreas principais implementadas: **Atendimento**, **Supervisão**, **Campanhas**, **Relatórios** e **Configurações**. Clientes aparecem como dados, edição e histórico dentro da conversa, sem área própria. Notificações são hoje principalmente som, aviso de transferência e indicadores pontuais. Reabrir, devolver à fila, prioridade operacional e SLA explícito não aparecem como ações dedicadas na interface atual; exigem decisão de produto e possivelmente suporte de dados/API antes de serem prometidos no design.

## 2. Diagnóstico executivo

| Prioridade | Achado observável | Efeito no trabalho | Direção proposta |
|---|---|---|---|
| Crítica | Em 820 px, a captura do atendimento mantém menu e lista largos; a conversa fica estreita a ponto de quebrar palavras. | Leitura e resposta inviáveis em largura intermediária. | Navegação compacta e modo de uma coluna antes de a conversa cair abaixo da largura útil mínima. |
| Crítica | A lista usa ponto para “não lido”, sem quantidade nem idade da última mensagem; não oferece ordenação operacional ou filtros além das três abas e busca textual. | Com 10–15 conversas, o atendente precisa varrer visualmente a lista. | Ordenação por próxima ação, atraso e não lidas; contagem visível; filtros curtos e persistentes. |
| Alta | Itens da lista gastam altura com avatar de 52 px e chips de cidade, atendente e setor, e podem quebrar a segunda linha. | Menos conversas visíveis sem rolagem. | Linha compacta, metadados de uma linha e detalhes sob demanda. |
| Alta | O painel de informações do cliente aparece no modal de Supervisão, mas não no fluxo principal do atendente; SGP abre um painel à parte. | A consulta exige troca de contexto e disputa espaço com o chat. | Resumo lateral contextual no atendimento, com abertura controlada e abas Cliente, SGP e Histórico. |
| Alta | O cabeçalho expõe várias ações e chips; o compositor mostra anexo, respostas rápidas e emoji o tempo inteiro. | O espaço horizontal do texto diminui justamente no trabalho intenso. | Duas ações principais no cabeçalho e um menu “Mais”; compositor centrado no texto com menu de inserção. |
| Alta | A marcação de IA aparece como “IA” em certas mensagens e a triagem concluída aparece na lista, mas não há trilha operacional compacta para estado, falha, transferência e ação executada. | É difícil saber quem controla a conversa e o que a IA fez. | Estado de controle em texto no cabeçalho e eventos discretos na linha do tempo. |
| Alta | Configurações já têm grupos e páginas, mas o menu é longo, não tem busca e mistura configurações do canal, automação, conteúdo e credenciais. | Localização lenta e dependências difíceis de entender. | Índice pesquisável com categoria → subcategoria → configuração, trilha de navegação e estado de escopo. |
| Média | Supervisão usa três colunas grandes, com pouca informação por item e bastante espaço vazio; relatórios usam muitos cartões e gráficos. | A visão operacional fica menos acionável. | Tabela ou lista densa com riscos e ações; relatórios com resumo, comparações e detalhamento. |
| Média | Campanhas e listas administrativas seguem padrões visuais diferentes da área operacional. | O sistema parece dividido em produtos. | Um conjunto único de padrões de cabeçalho, tabela, filtro, estados, diálogos e feedback. |

### O que já funciona bem

- Menu principal com cinco destinos, versão compacta e acesso por perfil.
- Separação atual entre andamento, espera e automação; busca por nome, telefone, cidade, setor e prévia.
- Rascunho de texto preservado por conversa e anexo/áudio descartados ao trocar de cliente, reduzindo envio para o destinatário errado.
- Linha do tempo separa dias e agrupa mensagens próximas; mensagens de IA enviadas recebem identificação; falha de entrega aparece na mensagem.
- Transferência mostra presença e carga do destinatário sem impedir a escolha; encerramento solicita motivo; SGP já permite consultar e enviar boleto/Pix; avisos da janela de 24 horas são contextuais.
- Componentes compartilhados de botão, campo, abas, estado assíncrono e diálogo já são um começo de sistema visual.

## 3. Arquitetura do produto e menu

**Navegação primária recomendada:** Atendimento, Supervisão, Campanhas, Relatórios, Configurações. Manter essa estrutura, pois corresponde às tarefas reais. Exibir Supervisão somente aos perfis autorizados; no perfil de atendente, o acesso diário deve começar em Atendimento. Perfil, som e sair permanecem no menu de conta, sem competir com tarefas. Acesso a encerrados e ao histórico deve estar também no contexto do atendimento, pois procurá-los no rodapé do menu quebra o fluxo.

**Dentro de Atendimento:** Minha mesa (meus atendimentos), Fila, Automação e Histórico/encerrados, com contagens e acesso rápido. “Minha mesa” é a visão padrão. A busca deve encontrar conversas ativas e, se o usuário escolher, ampliar para histórico; o resultado deve indicar claramente a origem. “Clientes” só vira destino primário se houver tarefas próprias de cadastro/consulta fora do atendimento; hoje, recomendar **Clientes** como módulo futuro secundário e tratar identificação, edição e histórico como um painel da conversa.

**Supervisão** responde “onde há risco agora?”; **Relatórios** responde “o que aconteceu no período?”. Essa distinção deve orientar título, filtros, métricas e detalhes. **Campanhas** é uma atividade separada e merece lista, criação em revisão e detalhe de entrega; sua posição no menu pode depender da frequência por perfil.

## 4. Estrutura da mesa de atendimento

### Layout e larguras

Em desktop amplo: menu principal compacto por padrão na mesa (72 px), lista de conversas ajustável em torno de **320–380 px**, conversa ocupando todo o espaço restante e painel contextual de **280–320 px** somente quando aberto ou fixado. A conversa deve preservar uma largura útil aproximada de **560 px**; se a janela não comportar isso, o painel contextual vira sobreposição, não estreita a leitura. Permitir que o atendente recolha o menu e redimensione a lista dentro de limites seguros. Em 820 px, mostrar lista **ou** conversa como foco principal, com botão de retorno e estado preservado; a captura atual mostra por que manter as duas lado a lado não serve. No celular, uma coluna, sem perda das ações críticas.

As medidas são pontos de partida. Validar com nomes longos, zoom de 125% e 150%, 1366×768, 1440×900, 1920×1080 e largura intermediária.

### Lista de conversas

Topo fixo: título e total de atendimentos, busca, abas **Meus / Fila / IA / Encerrados** e uma linha de filtros. Filtros iniciais: **Não lidas**, **Aguardando resposta**, **Atrasadas**, **Setor**, **Canal** e **Atendente** quando fizer sentido ao perfil. Mostrar filtros ativos e “Limpar”. Ordenação explícita: **Próxima ação** como padrão, **Mais recente**, **Mais antiga na fila**. Não mover um item sob o cursor por cada evento recebido; estabilizar a posição por alguns segundos durante interação e sinalizar “novas atualizações”.

Cada item deve ter, em até duas linhas principais: nome legível, horário com semântica clara (última mensagem em Meus; chegada em Fila), prévia de uma linha, quantidade de mensagens não lidas e tempo aguardando quando aplicável. Uma linha curta de metadados mostra setor e estado da IA; canal e atendente entram quando distinguem conversas. Cidade aparece se for relevante à operação e pode ser filtro; não deve competir sempre com a prévia. Um sinal de prioridade deve ter texto ou tooltip, não depender só de cor. Usar altura alvo de **64–76 px** em densidade padrão, com opção confortável; conferir em sessões reais. Com 15 conversas, isso coloca mais itens em uma tela de 900 px e deixa a rolagem previsível.

O selecionado deve ter borda/realce claro. “Não lida” não deve desaparecer só ao abrir sem que o atendente tenha visto a parte nova; definir leitura por foco e visibilidade da última mensagem. Indicar mensagens que chegaram enquanto a conversa estava aberta e o atendente rolou para cima. Erros, transferências e clientes esperando exigem ícone + texto curto no item.

### Conversa e linha do tempo

Cabeçalho: nome, telefone/canal secundários, estado de atendimento em texto (**Com IA**, **Aguardando humano**, **Com você**, **Com outro atendente**, **Encerrado**) e tempo desde a última mensagem do cliente. Uma ação primária contextual: **Assumir** quando na fila, **Encerrar** quando sob responsabilidade do atendente. **Transferir** e **Mais** ao lado; “Mais” contém voltar à fila, reabrir, alterar motivo, observação, histórico e editar cliente quando tais operações existirem. Ações indisponíveis explicam o motivo. Confirmar ações de alto impacto com destino, motivo e consequência claros.

Mensagens do cliente e do atendente precisam de diferenciação mais clara que as duas superfícies translúcidas atuais. Usar alinhamento, contraste e rótulo de autor; IA mantém a mesma direção da mensagem enviada, com selo discreto “IA”. Mensagens automáticas e eventos internos (transferência, assunção, IA aguardando, ação do SGP, falha) entram como **eventos centrais compactos**, sem imitar fala do cliente. Agrupar mensagens próximas do mesmo autor; data permanece separador persistente e horário aparece na mensagem ou ao foco. Limitar largura de texto para leitura longa sem criar bolhas estreitas em telas médias. Mostrar estado enviado/entregue/lido/falhou com texto acessível no detalhe.

Imagem, documento, áudio, transcrição, Pix e boleto usam um cartão de conteúdo com título e ação principal claros. Áudio: play, duração, velocidade e transcrição recolhível; se a transcrição ainda não está pronta, mostrar andamento/erro. Pix e boleto: valor, vencimento e tipo quando disponíveis; cópia do código apenas em ação explícita. Falha de envio deve oferecer **Tentar novamente** quando suportado. Mensagens de sistema usam linguagem curta e autoria inequívoca.

### Campo de mensagem

Deixar **texto e envio** dominarem. Um botão de inserção abre Anexo, Resposta rápida, Emoji e, se pertinente, Template, Pix e Boleto; microfone continua acessível quando o campo está vazio. Respostas rápidas devem aceitar busca por nome e atalho de teclado; a escolha preenche o campo para revisão. O menu deve recordar a última opção usada apenas se isso não surpreender. Manter colar imagem com prévia antes de enviar e rascunhos por conversa. Exibir de forma persistente qual cliente receberá o envio em situações de troca rápida. Reduzir o crescimento máximo atual do campo (320 px) em janelas baixas para preservar mensagens visíveis; permitir expansão manual. Enter/Shift+Enter e atalhos devem ser explícitos e configuráveis se a pesquisa mostrar preferências distintas.

**Pix e boleto** devem nascer da consulta ao SGP, com identificação do contrato e confirmação do destinatário antes do envio. Não criar botões soltos no compositor que possam operar sem contexto financeiro. Se houver mais de um contrato/fatura, obrigar seleção clara e exibir o que foi enviado no histórico.

### Painel do cliente e SGP

Resumo sempre disponível no cabeçalho ou na borda do painel: nome, identificador parcialmente mascarado, contrato selecionado, situação do contrato, conexão e pendência financeira relevante. Dados de ação imediata (conexão interrompida, velocidade reduzida, fatura vencida, bloqueio) merecem linha curta com estado, fonte e atualização. O restante fica em abas **Cliente**, **SGP**, **Financeiro**, **Histórico**. IP e outros detalhes técnicos ficam em expansão. Observação interna deve ter autoria/data e ser claramente privada. Informações ausentes, carregando, erro de consulta e dados desatualizados são estados distintos. O painel pode ser fixado em monitor amplo e sobreposto em largura menor. A área de chat mantém o contexto ao abrir/fechar o painel.

## 5. Alta carga: comportamento por volume

| Volume simultâneo | Comportamento recomendado |
|---|---|
| 5 | Lista padrão; não lidas e espera visíveis; nenhuma intervenção especial. |
| 10 | Mostrar resumo de carga e conversas sem resposta; ordenar por próxima ação; destacar atrasos com intensidade moderada. |
| 15 | Priorizar explicitamente atrasos, novas mensagens, transferências e casos críticos; filtros salvos e alternância rápida; evitar toasts repetidos. |
| Mais de 15 | Manter todas as ações; reforçar resumo de risco, agrupamento por estado e indicação ao supervisor; permitir transferir com carga visível. Nunca impedir assumir ou receber atendimento só pelo número. |

O indicador de carga deve representar **risco de atraso**, não apenas contagem. A regra exata depende da operação: tempo desde última mensagem do cliente, primeiro retorno, prioridade e horário de atendimento. Começar com limiares configuráveis por operação, sem fingir um SLA já definido. Os valores atuais de 5 e 10 no modal de transferência são apenas avisos para o destinatário; devem ser harmonizados com o indicador da mesa e validados com supervisores. Notificações sonoras devem ser agrupadas sob alta frequência, mas erros e transferências direcionadas continuam distinguíveis. Medir tempo para localizar conversa, troca de contexto, respostas atrasadas e envio ao cliente errado em cenários de 5/10/15/20 conversas.

## 6. IA, triagem e passagem para humano

Separar **estado da conversa** de **quem tem o controle**. “Em automação” descreve fila/etapa; “IA atendendo” descreve autoria e responsabilidade. O estado textual do cabeçalho e da lista deve vir de eventos do sistema, não de inferência visual a partir da última bolha. Eventos discretos: IA iniciou, fez consulta, enviou boleto/Pix, aguardou resposta, concluiu, falhou, encaminhou ao setor/atendente, humano assumiu. Cada evento mostra horário e resultado; detalhes técnicos ficam em expansão para supervisão. Uma sugestão da IA é rascunho assistido e nunca se confunde com mensagem já enviada. Quando a IA falha, mostrar a ação requerida ao humano; evitar uma faixa grande permanente para a IA.

Triagem por menu e triagem por IA devem compartilhar vocabulário de estados, mas manter suas regras próprias. A passagem deve trazer resumo, motivo sugerido, identificação e confiança de forma compacta. Se a confiança for baixa, sinalizar “Revisar triagem” e expor a origem dos dados. O atendente pode corrigir setor/motivo, sem apagar o registro do que a IA fez.

## 7. Fluxos transversais

| Fluxo | Proposta de comportamento |
|---|---|
| Assumir | Ação visível na conversa da fila; feedback imediato; se alguém assumiu antes, informar e atualizar a lista. |
| Transferir | Selecionar setor ou atendente conforme regra do produto, mostrar presença/carga, incluir observação de passagem opcional e confirmar destino; não bloquear por carga. |
| Encerrar | Motivo obrigatório, sugestão da IA editável, revisão curta e confirmação; continuar visível no histórico. |
| Reabrir / voltar à fila | Projetar como ações futuras até confirmar suporte e regra de negócio; definir permissão, evento de auditoria e responsabilidade após a mudança. |
| Alterar motivo / observação | No painel contextual, com histórico de autoria; alteração após encerramento pede regra de permissão. |
| Cliente e SGP | Seleção de contrato e origem dos dados sempre claras; Pix/boleto com confirmação e retorno de sucesso/erro na linha do tempo. |
| Notificações | Central operacional para transferências recebidas, falhas e atrasos; som como preferência, sem depender dele para transmitir informação. |

## 8. Configurações: arquitetura de três níveis

Entrada de Configurações com **busca por nome, sinônimo e descrição**. Resultado aponta para a configuração exata e seu caminho; respeita permissões. À esquerda ficam categorias, no centro subcategorias, à direita a página de configuração. Em tela menor, usar lista hierárquica e breadcrumb, preservando contexto. Cada configuração mostra escopo (**operação**, **canal**, **atendente**), estado atual, dependência, último salvamento e ação de teste quando houver. Busca deve encontrar “boleto” em SGP, financeiro e ferramentas da IA sem duplicar a fonte de verdade.

| Categoria | Subcategorias e configurações atuais sugeridas |
|---|---|
| Operação | Empresa; horários de atendimento; atribuição; motivos; cidades. |
| Atendimento | Mensagens de boas-vindas; abertura/encerramento; respostas rápidas; avisos por cidade; templates. |
| IA e automação | Triagem por menu; atendimento e triagem por IA; identificação/comprovantes; transcrição; atendimento noturno; ferramentas autorizadas. |
| Canais WhatsApp | Lista de canais; conexão; comportamento; status; templates por canal quando aplicável. |
| Integrações | Consulta ao SGP; envio SGP por canal; OpenAI e teste de conexão. |
| Equipe e acesso | Usuários; setores; perfis e permissões efetivas. |
| Financeiro e cobrança | Página de orientação/atalho para regras de Pix e boleto existentes em SGP e IA; criar configuração própria apenas se houver regras independentes. |
| Notificações | Preferências de som e, quando implementados, alertas por evento e limites. |
| Segurança | Sessões/credenciais/acesso somente conforme capacidades reais; evitar menu vazio. |
| Avançado | Diagnósticos, logs e opções técnicas somente quando existirem. |

Não criar dez categorias vazias. Começar pelas seis categorias que já têm conteúdo e adicionar Financeiro, Notificações, Segurança e Avançado quando houver configurações próprias. “Atendimento” e “Operação” podem ser fundidos após teste de localização. A estrutura deve mapear configurações existentes sem mudar seu significado nem suas dependências. Evitar cartões enormes por campo; usar seções compactas, ajuda ao lado do rótulo, salvamento explícito por conjunto coeso, confirmação apenas para ações sensíveis e mensagem clara de sucesso/erro.

## 9. Proposta visual e Design System

**Princípios:** alta legibilidade, densidade moderada, baixo ruído, hierarquia por função e conforto em turno longo. A direção escolhida é **grafite médio**: superfícies sólidas em cinzas médios, menos brilho decorativo e menos transparência sobre o conteúdo de trabalho. Testar contraste real no monitor dos atendentes. Oferecer alternativa clara ou de contraste elevado se a pesquisa indicar necessidade. Usar laranja para ação principal e foco, não para todo status; verde para sucesso/conexão, âmbar para atenção e vermelho para erro. Estado nunca depende só da cor.

**Tokens propostos para validar:** escala de espaçamento 4/8/12/16/24 px; texto operacional 14–16 px, metadados 12–13 px com contraste suficiente; linha de texto de conversa em torno de 1,4; raios 8 px em controle, 12 px em painel, 16 px em diálogo; sombra apenas para camadas flutuantes. O raio atual de 22–30 px e o vidro em quase todas as superfícies tornam a interface mais decorativa do que precisa ser. Esses valores são direção, não especificação final sem teste visual.

**Componentes únicos:** botão (primário, secundário, texto, perigo); campo/select/busca; menu de ações; chip de estado; contador; item de conversa; barra de filtros; tabela densa com ordenação; abas; painel contextual; diálogo; confirmação; tooltip; toast; alerta persistente; estado de carregamento/vazio/erro/permissão; cartão de mídia; evento de sistema; formulário com escopo e dependência. Definir tokens de foco, hover, seleção, desabilitado, erro e carregando. O mesmo verbo e consequência devem ter o mesmo rótulo e feedback em todas as telas.

**Acessibilidade e conforto:** navegação completa por teclado, foco visível, labels em botões de ícone, áreas clicáveis de pelo menos 40–44 px quando houver toque, contraste verificado, zoom até 200% sem colapso, preferência de movimento reduzido, anúncios discretos para nova mensagem e falha. Evitar animações contínuas, som repetido e elementos que se movem enquanto o atendente clica.

## 10. Propostas para as demais áreas

| Área | Direção de redesign |
|---|---|
| Supervisão | Trocar a ênfase de colunas vazias por resumo de riscos e lista/tabela filtrável: estado, cliente, canal, setor, responsável, tempo aguardando, última ação e IA. Manter acesso ao detalhe sem permitir ação acidental sobre conversa alheia. |
| Relatórios | Resumo de 3–5 indicadores com período e definição; comparação temporal quando houver dados; gráficos só onde ajudam; tabela de detalhe e CSV coerentes com os filtros. Explicitar denominadores e inclusão/exclusão de IA. |
| Campanhas | Lista tabular compacta com canal, data, progresso, enviados/falhas e ação de abrir; criação com revisão antes do disparo e resultado por destinatário com filtros. |
| Clientes | No presente, painel e histórico contextual. Se virar área própria: busca global, contratos, atendimentos, financeiro e notas com permissões claras. |
| Canais | Lista resumida por estado, provedor, número e modos ativos; detalhe com Conexão, Atendimento e Dependências. Alertas operacionais levam direto ao canal afetado. |
| Integrações | Mostrar saúde, última verificação, escopo e dependências; segredos mascarados; testar conexão junto à configuração. |
| Equipe e permissões | Tabela de usuários com papel, setores, status e carga; matriz de permissões legível por ação, distinguindo acesso à página e capacidade de executar. |
| Notificações | Preferências de som e central de eventos relevantes, separando aviso transitório de pendência que exige ação. |

## 11. Priorização e validação

**P0 — mesa utilizável:** corrigir layout em 820–1366 px; lista compacta com não lidas/tempo de espera; ordenação e filtros; cabeçalho/compositor enxutos; painel contextual sem comprimir conversa; estados da IA. Entregar primeiro uma proposta visual da mesa em 5, 10, 15 e 20 conversas, com nomes longos, mensagens novas, transferências e SGP aberto.

**P1 — fluxos de risco:** assumir/transferir/encerrar, Pix/boleto, falha de envio, janela WhatsApp, observações e histórico. Especificar ações futuras (reabrir/voltar à fila) com regras de negócio antes de implementar.

**P2 — sistema inteiro:** configurações pesquisáveis; padrões de componentes; supervisão, relatórios, campanhas, canais, equipe e integrações.

**Critérios para aprovar o design:** em testes com atendentes e supervisores, localizar a conversa urgente sem varredura longa; alternar entre clientes sem perder rascunho ou destinatário; concluir resposta e transferência com poucos passos; enxergar quem controla a conversa; consultar contrato e enviar cobrança sem ambiguidade; usar a interface em 1366×768 e 1440×900 com 15 conversas sem quebra de leitura. Registrar tempo, erros, pontos de hesitação e fadiga percebida após sessão prolongada. Ajustar dimensões e limiares a partir desses resultados.

## 12. Decisões para revisar com o proprietário do produto

1. Preferir painel de cliente/SGP recolhível na mesa, abrindo por padrão apenas em monitores amplos?
2. Usar “Próxima ação” como ordenação padrão dos meus atendimentos, com opção de atividade recente?
3. Quais tempos de espera devem ser considerados atenção e atraso em cada setor/horário?
4. Reabrir, voltar à fila, prioridade manual e módulo independente de Clientes fazem parte do produto desejado? Quais perfis podem usá-los?

Estas decisões não impedem a análise nem exigem código agora. A próxima revisão ideal é a **tela de atendimento** em quatro volumes de carga; depois de aprovada, suas regras passam a valer para supervisão e para o Design System das demais páginas.
