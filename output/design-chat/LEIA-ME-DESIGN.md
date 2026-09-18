# DW Telecom — especificação para implementação

## Entrega e fidelidade

- `dw-chat-aprovado.png`: conceito aprovado; referência principal de composição.
- `dw-chat-hd.png`: nova geração para apresentação, resolução real 1585 × 992 px. Não é 4K nem arquivo vetorial; pode apresentar pequenas diferenças em relação ao aprovado.
- As imagens foram criadas com o gerador de imagens integrado. Não existe um arquivo Figma ou uma fonte identificável embutida. Cores, medidas e fontes abaixo são propostas de implementação, aproximadas visualmente, não propriedades extraídas da imagem.
- Referência de direção visual: https://dribbble.com/shots/23626622-Dashboard-glassmorphism-style — Oleksandr Kosholap.

## Direção visual

Vidro fumê fosco, fundo carvão, iluminação cobre localizada no centro e malva discreto à esquerda. Superfícies translúcidas e amplas, contornos quase imperceptíveis, menu preto à esquerda. Não usar brilho neon, degradê animado, papel de parede ou transparência aplicada ao texto. Usar logotipo real da DW Telecom; o monograma na imagem é ilustrativo.

## Tipografia sugerida

Usar Outfit, com fallback sans-serif, para aproximar a geometria arredondada da proposta. Fonte: https://fonts.google.com/specimen/Outfit . Não é uma identificação da fonte original do Dribbble.

| Elemento | Tamanho desktop | Peso | Entrelinha |
| --- | --- | --- | --- |
| Atendimento | 40 px | 600 | 48 px |
| Título Conversas / contato | 22 px | 500 | 28 px |
| Nomes na lista | 16 px | 500 | 24 px |
| Mensagens e controles | 15 px | 400 / 500 | 23 px |
| Prévias e contexto | 14 px | 400 | 21 px |
| Horários e metadados | 12 px | 400 | 18 px |

## Paleta sugerida

| Uso | Valor |
| --- | --- |
| Fundo externo | #1C1C1E |
| Menu | #111212 |
| Base do aplicativo | #373739 |
| Texto principal | #F7F5F3 |
| Texto secundário | #D1CDD0 |
| Luz cobre | #AC7155, opacidade 25–35% |
| Luz malva | #766783, opacidade 20–30% |
| Indicador creme | #EDF1C8 |
| Notificação laranja | #FF790A |
| Online | #26BD93 |
| Painéis | rgba(255,255,255,0.08) |
| Seleção e resposta do agente | rgba(255,255,255,0.14) |
| Mensagem recebida | rgba(20,20,22,0.38) |
| Divisórias | rgba(255,255,255,0.12) |

Os valores de transparência dependem do fundo. Verificar contraste na implementação, especialmente horários e placeholder; aumentar a opacidade da superfície quando necessário.

## Layout e medidas

Referência de implementação desktop: viewport 1600 × 1000. Usar layout fluido, não imagem como fundo da interface.

- Margem externa: 32–48 px; reduzir em notebooks para aproveitar a tela.
- Shell: raio 36–40 px, padding 18–24 px.
- Menu à esquerda: 80–88 px; raio 26 px; ícones 24 px; alvos clicáveis 44–48 px.
- Cabeçalho: 90–110 px, com título à esquerda e busca/notificações/perfil à direita.
- Lista de conversas: 340–400 px; chat ocupa o restante, com `min-width: 0`.
- Intervalo entre regiões: 12–16 px.
- Painéis principais: raio 28–32 px; padding 24 px.
- Busca e botões: altura 44–48 px, raio 14–18 px.
- Linha de conversa: 84–96 px; avatar 44–48 px; prévia truncada em uma linha.
- Bolhas: largura máxima min(70%, 560 px), padding 14–18 px, raio 18 px, sem cauda.
- Composer: altura inicial 64 px, expansão limitada a 160 px; raio 24 px.
- Lista e histórico com rolagem independente. Cabeçalho e composer permanecem visíveis dentro do chat.

## Efeito de vidro

Construir luzes com gradientes radiais atrás dos painéis. Aplicar fundo RGBA e `backdrop-filter: blur(20px)` nos painéis, sem usar `opacity` no contêiner inteiro. Sombra sugerida: `0 16px 48px rgba(0,0,0,.16)`. Contorno opcional de 1 px branco a 6% de opacidade. Evitar várias camadas de blur sobrepostas. Se blur não estiver disponível, usar superfície sólida #454246.

## Componentes e ações

- Menu: Atendimento, Contatos, Equipe, Relatórios, Automação; Notificações e Configurações no rodapé. Ícones com tooltip, nome acessível e estado selecionado persistente.
- Ícones sugeridos: Lucide, traço 1.5–1.75 px, 24 px, mesma família em toda a interface. https://lucide.dev/
- Abas: Andamento, Espera, Automação; contadores vindos dos dados reais.
- Cabeçalho: nome do contato, setor, Transferir, Encerrar e mais ações.
- Contexto: plano, protocolo e atendente. Ocultar campos inexistentes, sem inventar valores.
- Mensagens: remetente, conteúdo, horário e estado real de envio. Separadores de data e opção de carregar histórico.
- Áudio: play/pause, duração, progresso acessível e velocidade. Forma de onda deve corresponder ao áudio real.
- Composer: anexos, emoji, mensagem e microfone. Enter envia e Shift+Enter quebra linha, com preferência configurável. Desabilitar envio vazio e apresentar falhas com opção de tentar novamente.
- Encerrar deve seguir as regras existentes do produto, preservando o histórico.

## Dados necessários

| Entidade | Campos |
| --- | --- |
| Contato | id, nome, avatar opcional, telefone |
| Conversa | id, contato, status, setor, responsável, protocolo, última mensagem, atualização, não lidas |
| Contexto opcional | plano do cliente, etiquetas |
| Mensagem | id, conversa, remetente, tipo, texto ou mídia, horário, estado de envio |
| Áudio | URL autorizada, duração, progresso local de reprodução |
| Operador | id, nome, foto, disponibilidade |

Nomes, fotos, plano, protocolo, contadores e horários da imagem são fictícios. Não confundir disponibilidade do atendente com presença online do cliente. Se a integração não fornece presença do cliente, não mostrar indicador online para ele.

## Adaptação e qualidade

- Acima de 1200 px: menu + lista + chat.
- Entre 900 e 1199 px: menu 64 px, lista 280 px e espaçamentos menores.
- Abaixo de 900 px: mostrar lista ou conversa por vez, com voltar; menu recolhível.
- Abaixo de 600 px: interface ocupa a tela, margens reduzidas, botões acessíveis, composer acima do teclado.
- Testar nomes longos, texto extenso, links, anexos, áudio, carregamento, lista vazia, erro de rede e mensagens não lidas.
- Estados de hover/foco/seleção distintos; foco visível por teclado; não depender apenas de cor.
- Contraste a verificar: 4.5:1 para texto normal. Respeitar preferência por movimento reduzido; transições discretas de 150–200 ms.

## Instrução para quem vai implementar

Reproduzir a composição de dw-chat-aprovado.png com elementos reais de interface e as especificações deste documento. Manter o menu à esquerda, vidro fumê, luz cobre localizada, malva discreto, cartões arredondados e fonte geométrica. Preservar funcionalidades existentes e ajustar as medidas conforme o tamanho da tela. A imagem é referência visual, não um componente funcional nem um arquivo de design editável.

## Registro da geração

Ferramenta: gerador de imagens integrado, sem CLI.

Prompt da versão HD: Produce a high resolution HD presentation version of this EXACT approved DW Telecom chat UI screenshot, aim for 3840x2400 pixels or highest available resolution, landscape same aspect ratio. Preserve the design rigorously: identical left black icon sidebar, panels, layout, colors, warm copper and mauve ambient smoky glass, typography appearance, Portuguese wording, avatars and all components. This is fidelity enhancement only, not redesign. Sharpen typography and thin icon edges, retain matte frosted surfaces and subtle gradients, no new elements, no content changes, no extra decoration, no watermark. Entire original frame visible.

Apesar da resolução solicitada no prompt, a ferramenta retornou 1585 × 992 px, conferidos no arquivo.
