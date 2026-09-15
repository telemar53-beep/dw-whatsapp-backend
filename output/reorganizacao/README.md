# Conferência visual — reorganização da interface (Task 20)

Prints do Chrome headless contra as páginas reais, montadas em `MemoryRouter` +
`AuthProvider` com `fetch` falsificado por rota. Nenhuma API real, nenhuma
credencial real: nomes, telefones e números são inventados. O arranjo de preview
foi apagado no fim da task.

Três larguras por tela: **520** (menor largura real do headless nesta máquina —
`--window-size=520` dá 504 px de viewport), **820** (dá 802 px) e **1440**.

| Arquivo | O que mostra |
|---|---|
| `atendimento-lista-{520,820,1440}.png` | Atendimento com a lista de conversas e nenhuma aberta; faixa de canal desconectado no topo, painel Equipe no pé da lista. Brilho de fundo cheio (tela não densa). |
| `atendimento-conversa-{520,820,1440}.png` | Atendimento com uma conversa aberta. Confirma que a superfície do chat (balões, cabeçalho, composer) não foi mexida. Em 520 a conversa toma a tela e o botão do menu some. |
| `supervisao-todos-{520,820,1440}.png` | Supervisão, aba "Todos atendimentos": três colunas em 1440, empilhadas em 520; barra de filtros com abas, três seletores e as duas buscas. |
| `supervisao-encerrados-{520,820,1440}.png` | Supervisão, aba "Encerrados hoje": grade de cartões e o botão "Carregar mais". Mostra os selos de atendente/setor caindo para a linha de baixo em cartão estreito, em vez de espremer a prévia. |
| `relatorios-{520,820,1440}.png` | Relatórios com dados de admin: faixa de indicadores, quatro gráficos, e as barras neutras de "Sem setor" e "Sem motivo" com a nota explicando cada uma. |
| `campanhas-lista-{520,820,1440}.png` | Campanhas: lista de disparos com canal, data e contagem de enviados/falhas/pulados. |
| `campanhas-modal-{520,820,1440}.png` | Modal de nova campanha já no passo de revisão, com canal, destinatários válidos e o conteúdo da mensagem. |
| `canais-{520,820,1440}.png` | Configurações › Canais: cartões dos três canais com selo de situação, chips de automação e avisos. Em 1440 aparece o menu de grupos com um ícone por grupo. |
| `canal-conexao-{520,820,1440}.png` | Canal › Conexão: selo "Conectado" (ponto + texto) e a zona de ações com cuidado. |
| `canal-atendimento-{520,820,1440}.png` | Canal › Atendimento: interruptores do canal e o resumo das configurações globais que valem para ele. Aba ativa com preenchimento laranja. |
| `automacao-ia-{520,820,1440}.png` | Automação e IA › Atendimento e triagem com IA: cartão de situação e o formulário, limitado a 720 px. |
| `boas-vindas-{520,820,1440}.png` | Mensagens › Boas-vindas: explicação e a lista por canal. |
| `equipe-perfis-{520,820,1440}.png` | Equipe › Perfis de acesso: tabela gerada da mesma lista que controla menu e rotas, com rolagem horizontal própria em tela estreita. |
| `acesso-negado-{520,820,1440}.png` | Atendente entrando em `/supervisao`: tela de sem acesso com o caminho de volta. |
| `confirmacao-{520,820,1440}.png` | `ConfirmDialog` aberto pelo Excluir de um canal, com o foco no Cancelar (anel visível). |
| `menu-compacto-{520,820,1440}.png` | Menu principal recolhido (`dw_nav_collapsed=1`): só ícones, e a largura que sobra deixa os rótulos das configurações aparecerem inteiros. |
| `menu-celular-520.png` | Painel do menu aberto por cima do conteúdo no celular, com a cortina escura atrás. |

`a11y.md`, ao lado, traz a conferência de acessibilidade item a item com as
evidências.
