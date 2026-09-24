# Apêndice B — Para onde vai o que sai da vista principal

> Parte do spec `2026-09-24-redesenho-simplicidade-design.md`. Restrição 3: **nenhuma funcionalidade
> some** — o que deixa a vista principal tem destino declarado aqui. Este apêndice cobre a E2 (mesa,
> moldura, menu e overlays da mesa). Cada etapa seguinte acrescenta a sua tabela **antes** de
> implementar, no mesmo formato, e o registro de mudanças da etapa (seção 12.3) cita a linha daqui.

Legenda da última coluna: **dado** = informação continua disponível; **ação** = o que se fazia
continua fazendo-se; **nada** = só decoração, sem informação (o motivo está na linha).

## B.1 Moldura e menu

| Sai | Vai para | Tipo |
|---|---|---|
| Títulos de grupo do menu ("Trabalho", "Acompanhamento", "Administração") | Nada: com no máximo seis destinos, o grupo não orienta ninguém — dois deles tinham um item só | nada |
| Modo expandido do menu (196 px) e o botão "Recolher menu" | Rótulo de cada destino na dica flutuante e no nome acessível; no celular a gaveta de 216 px **continua com rótulos** | dado |
| Moldura flutuante da casca (margem, cantos, halos) | Linha de 1 px entre menu, lista e conversa | nada |

## B.2 Lista

| Sai | Vai para | Tipo |
|---|---|---|
| Botão laranja cheio "Nova" | Botão de ícone "Nova conversa" no mesmo cabeçalho, com dica e nome acessível | ação |
| Ficha de **cidade/localidade** no item | Linha 2 do item na **Espera** (a localidade abre a linha, decisão B do proprietário) · busca (já casa cidade) · painel **Cliente** · nome acessível da linha | dado |
| Ficha de **setor** no item | Linha 2 do cabeçalho da conversa · busca (já casa setor) · painel **Cliente** · nome acessível da linha | dado |
| Texto lilás da IA no item (Automação) | Linha 2 da **Automação**: ícone da IA + estado ("Em triagem" ou o motivo) | dado |
| Chip com o nome do responsável | Na aba Atendimento era sempre o próprio atendente (decisão de 21/09 restaurada); o responsável segue na **Supervisão** e no painel **Cliente** | dado |
| Filete colorido de estado | Nada: toda linha de uma aba tinha o mesmo filete — o estado é a própria aba | nada |
| Gradiente e contorno de seleção | Fundo `--color-selecionado` + barra de 3 px do acento | dado |
| Emoji na prévia ("📷 Foto", "🎤 Áudio"…) | Ícone da família + o mesmo rótulo | dado |

## B.3 Conversa

| Sai | Vai para | Tipo |
|---|---|---|
| Barra de contexto (o setor pela terceira vez na tela) | Linha 2 do cabeçalho (estado · setor · telefone · protocolo · localidade) e botões de ícone **Histórico, SGP, Cliente** à direita | dado + ação |
| Terceira linha do cabeçalho | Linha 2 em texto corrido, que encolhe por prioridade (`@container`) | dado |
| Disco laranja→cobre do avatar | Avatar neutro com as iniciais | nada |
| Encerrar sempre vermelho | Encerrar secundário neutro; o vermelho fica na confirmação destrutiva (decisão revogada em 24/09) | ação |
| Bolha lilás e filete da IA | Bolha de saída com o rótulo "Assistente IA" e o ícone da IA na meta | dado |
| Pílula da nota "Este atendimento fica registrado…" | O mesmo texto em 12 px, sem pílula | dado |
| Gradiente do fundo da linha do tempo | Fundo liso `--color-fundo` | nada |
| Botões separados de Enviar e microfone | Um só lugar: microfone com o campo vazio, Enviar com texto ou anexo | ação |

## B.4 Painéis e mesa vazia

| Sai | Vai para | Tipo |
|---|---|---|
| Aninhamento de até 4 camadas no painel SGP | Uma superfície, seções separadas por linha; as mesmas ações | dado + ação |
| Título de 32 px em Sora light da mesa vazia | Ícone da conversa + "Selecione um atendimento na lista" + a nota de registro | dado |
| (destino novo) | O painel **Cliente** passa a reunir identidade, estado, telefone, canal, protocolo, localidade/cidade, setor, atendente, nota interna e a triagem por IA (motivo, resumo, confiança baixa, resolvido pela IA) | dado |

## B.5 Conferência

No fim da E2, o registro de mudanças (`2026-09-24-redesenho-registro-E2.md`) marca, para cada
linha das tabelas acima, onde o item foi encontrado na tela nova — com print — e o teste de
conteúdo da variante `compact` (E0) confirma pelo nome acessível que cidade, setor e estado da IA
continuam na linha.
