
## 1. Acesso e estados globais


### Rede de segurança do index.html — `frontend/index.html`

Como se chega: o módulo JS falha ao carregar/ler antes de o React existir.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ACS-GLB-01 | erro | `error`/`unhandledrejection` com `#root` vazio | frontend/index.html:27-50 | "Não foi possível abrir o atendimento" / "A página não carregou. Envie o texto abaixo para quem cuida do sistema." + `<pre>` técnico | Sem botão "Recarregar" (só F5); tela clara fora do tema (proposital) |

### ErrorBoundary da raiz — `components/ErrorBoundary.jsx`

Como se chega: exceção no render de provider/App fora de um `RotaLazy`.

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| ACS-GLB-02 | erro-com-retry | exceção não tratada no 1º render | components/ErrorBoundary.jsx:139-154 | "Não foi possível abrir o atendimento" · "Tentar de novo" · "Copiar detalhes" | — (tela clara isolada, por design) |
| ACS-GLB-03 | sucesso | clique em "Copiar detalhes" | components/ErrorBoundary.jsx:152 | "Copiado" | Falha na cópia volta calada para "Copiar detalhes" (sem aviso) |
| ACS-GLB-04 | expandido | abrir `<details>` | components/ErrorBoundary.jsx:156-159 | "Ver detalhes técnicos" + pilha | — |

### Carregamento sob demanda de rotas — `components/RotaLazy.jsx` (usado em `App.jsx:67-94`)

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| ACS-GLB-05 | carregando | baixando o trecho do AppShell (logo após login, F5 em rota autenticada) | components/RotaLazy.jsx:61 | (esqueleto de 4 linhas do AsyncState) · sr-only "Carregando…" | **Esqueleto invisível**: renderiza FORA de `.chat-theme`, sobre o `body` sem fundo (branco); as barras são `bg-white/[0.08]` (ui/AsyncState.jsx:8) → tela branca vazia antes do shell escuro (flash branco) |
| ACS-GLB-06 | carregando | trocar para rota cujo trecho ainda não baixou | components/RotaLazy.jsx:61 | (esqueleto de 4 linhas no lugar do conteúdo; o menu fica) · sr-only "Carregando…" | (suspeita) rotas aninhadas de Configurações (Layout → página) têm um RotaLazy em cada nível → dois esqueletos em cascata |
| ACS-GLB-07 | erro-com-retry | trecho não baixou (deploy novo) **ou qualquer exceção de render dentro da página** | components/RotaLazy.jsx:54 | "Não foi possível carregar esta parte do sistema. Recarregue a página para tentar de novo." · "Tentar de novo" | `getDerivedStateFromError` pega QUALQUER erro de render: bug de página aparece como "não foi possível carregar"; o botão "Tentar de novo" recarrega a página inteira (perde rascunho/estado) |
| ACS-GLB-08 | variante | o mesmo erro no RotaLazy do AppShell (fora de `.chat-theme`) | components/RotaLazy.jsx:54 | "Não foi possível carregar esta parte do sistema. Recarregue a página para tentar de novo." | Sai com tokens CLAROS (wa-error-bg claro) sobre fundo branco — destoa do app escuro |

### Rota protegida / sem acesso — `components/ProtectedRoute.jsx`, `pages/AccessDeniedPage.jsx`

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| ACS-GLB-09 | variante | sem token em rota autenticada | components/ProtectedRoute.jsx:12 | (redireciona para /login) | Rota de origem é perdida: após entrar vai sempre para "/" (pages/LoginPage.jsx:66) |
| ACS-GLB-10 | sem-permissão | atendente abre /supervisao, /campanhas, /campanhas/:id, /configuracoes | pages/AccessDeniedPage.jsx:16 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." · "Ir para o Atendimento" | — |
| ACS-GLB-11 | sem-permissão | gerente sem "Pode gerenciar Canais e Integrações" abre página level="integrations" (Integrações; ver parte H) | pages/AccessDeniedPage.jsx:17 | "Esta área é liberada para administradores e para gerentes com a permissão \"Pode gerenciar Canais e Integrações\", marcada na conta pelo administrador." | — |
| ACS-GLB-12 | sem-permissão | `/configuracoes` sem nenhum item permitido | pages/settings/SettingsIndex.jsx:9 | "Sem acesso a {areaLabel}" (areaLabel "Configurações") | — |
| ACS-GLB-13 | variante | sessão expirada: qualquer 401 da API (services/api.js:34-35) ou socket recusado (contexts/SocketContext.jsx:270-272) → `logout()` | contexts/AuthContext.jsx:41 | (cai no login limpo, sem mensagem) | **Sessão expira em silêncio**: a frase "Sua sessão expirou. Entre de novo." existe (utils/errorMessages.js:20) mas nunca é mostrada nesse caminho; atendente perde o que digitava sem explicação |
| ACS-GLB-14 | erro | erro do backend sem tradução mapeada | utils/errorMessages.js:147-153 | (texto cru em inglês do servidor) | Por design mostra o original em inglês — qualquer tela pode exibir texto técnico em inglês |

### Tela de entrada — `pages/LoginPage.jsx` (rota `/login`)

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| ACS-LOG-01 | carregando | nome público da empresa ainda chegando | pages/LoginPage.jsx:113-118 | (barra pulsante 11ch) + sr-only "Carregando o nome da empresa…" | — |
| ACS-LOG-02 | variante | sem nome cadastrado ou rota pública falhou | pages/LoginPage.jsx:116 | "Atendimento" | — (proposital: erro do nome é silencioso) |
| ACS-LOG-03 | variante | rodapé com/sem nome | pages/LoginPage.jsx:125 | "Acesso restrito à equipe de atendimento da {companyName}." · "Acesso restrito à equipe de atendimento." | — |
| ACS-LOG-04 | validação | e-mail vazio/ inválido, senha vazia | pages/LoginPage.jsx:126,130 (`required`, `type=email`) | (balão nativo do navegador) | Validação nativa: balão do sistema, fora do tema, texto do navegador |
| ACS-LOG-05 | salvando | enviar | pages/LoginPage.jsx:135-141 (form `aria-busy` :123) | "Entrando…" (botão desabilitado) | — |
| ACS-LOG-06 | erro | credencial errada / conta desativada / 429 / rede / CORS | pages/LoginPage.jsx:133 (texto em utils/errorMessages.js:15) | "E-mail ou senha incorretos." · "Esta conta está desativada. Procure um administrador." · "Muitas tentativas seguidas…" · "Falha ao entrar" | Falha de rede/CORS cai no genérico "Falha ao entrar" (parece credencial errada) |
| ACS-LOG-07 | responsivo | largura < lg (1024px) | pages/LoginPage.jsx:80 (`hidden lg:flex`), :104 (`lg:hidden`) | painel "Um lugar claro para cada conversa." some; ícone aparece no cartão | — |
| ACS-LOG-08 | variante | já logado abre /login | App.jsx:122 | (formulário normal, sem redirecionar) | (suspeita) não redireciona quem já tem sessão |

## 2. Casca (AppShell, menu lateral, gaveta, menu da conta, avisos de conexão)


### Casca — `components/AppShell.jsx`

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| CAS-SHL-01 | tempo-real | socket caiu (entra em `reconnecting`) | components/AppShell.jsx:80 | "Reconectando… as mensagens novas podem demorar a aparecer." | (suspeita) `role="status"` é montado JUNTO com o texto — leitores podem não anunciar; some em 3 s mesmo sem reconectar (o estado fica só no menu) |
| CAS-SHL-02 | tempo-real | voltou de `reconnecting` para `connected` | components/AppShell.jsx:82-86 | "Conexão restabelecida." (pílula verde, 3 s) | idem (suspeita de anúncio) |
| CAS-SHL-03 | responsivo | largura < md (768px) | components/AppShell.jsx:98-109 | botão redondo "Abrir menu" (ícone de conversas) | Ícone de balão de conversa para "abrir menu" é ambíguo |
| CAS-SHL-04 | variante | conversa ocupa a tela inteira (mobile) | components/AppShell.jsx:106 (`conversationOpen ? 'hidden'`) | (botão "Abrir menu" some) | — |
| CAS-SHL-05 | responsivo | ≥ md | components/AppShell.jsx:92 (`p-0 md:p-3`) | (moldura com respiro × sangrada) | — |
| CAS-SHL-06 | variante | rotas `dense` (Relatórios, Supervisão, Configurações) | components/AppShell.jsx:61,90-91; App.jsx:144 | (brilhos de fundo mais fracos) | — |
| CAS-SHL-07 | interação:gaveta aberta | tocar "Abrir menu" | components/AppShell.jsx:97 (`inert`) + components/SideNav.jsx:115 (véu) + components/side-nav.css:9 | (gaveta 216px, véu `bg-black/50`; ESC/clique no véu fecham; foco preso) | — |
| CAS-SHL-08 | interação:modal | "Minha conta" → "Meu perfil" | components/AppShell.jsx:113-115 | abre ProfileModal | — |

### Menu lateral — `components/SideNav.jsx` + `components/side-nav.css`

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| CAS-NAV-01 | variante | recolhido (rail 64px) × expandido; preferência separada: Atendimento nasce recolhido, demais áreas expandidas | components/SideNav.jsx:72-73,121; side-nav.css:8 | (só ícones × ícone+rótulo+grupos) | — |
| CAS-NAV-02 | hover-revela | rail recolhido: nome do destino | components/SideNav.jsx:63 (`title`) | tooltip nativo "Atendimento", "Supervisão"… | Rótulo só em tooltip nativo (não aparece no toque; inconsistente com a `DicaFlutuante` do rail de conversas) |
| CAS-NAV-03 | interação:recolher | botão recolher/expandir | components/SideNav.jsx:124-126 | "Recolher menu" / title "Expandir menu" | — (escondido na gaveta mobile, side-nav.css:9) |
| CAS-NAV-04 | seleção | rota ativa | components/SideNav.jsx:64 | (item com realce cobre, `aria-current=page`) | — |
| CAS-NAV-05 | variante | papel: atendente × gerente/admin (grupos sem item somem) | components/SideNav.jsx:82,127-130 | Trabalho / Acompanhamento / Administração | — |
| CAS-NAV-06 | variante | só `role === 'agent'`: botão "Encerrados" | components/SideNav.jsx:129,138 | "Encerrados" → ClosedConversationsModal (parte D) | — |
| CAS-NAV-07 | variante | marca: arte da instalação (compacta/horizontal) × monograma com iniciais | components/SideNav.jsx:30-53 | (logo) / "DW" + nome | — |
| CAS-NAV-08 | carregando | nome da empresa chegando (sem arte) | components/SideNav.jsx:46 | (monograma vazio, sem indicador) | — (proposital) |
| CAS-NAV-09 | erro | rota pública do nome falhou (sem arte) | components/SideNav.jsx:46,50 | (monograma vazio e rótulo vazio PERMANENTES) | **Topo do menu fica com uma pílula sem texto** se o nome falhar; não há fallback visual (só o `title` diz "Atendimento") |
| CAS-NAV-10 | tempo-real | socket `reconnecting` | components/SideNav.jsx:145-151 | ⚠ "Reconectando…" | — |
| CAS-NAV-11 | hover-revela | rail recolhido + reconectando | components/SideNav.jsx:149 | "Reconectando… As mensagens novas podem demorar a aparecer." | Só hover/foco (tem `tabIndex=0`); toque não revela |
| CAS-NAV-12 | variante | som da fila ativado × desativado | components/SideNav.jsx:153 | "Som da fila" · "Desativado" · "Ativado" | — |
| CAS-NAV-13 | interação:menu aberto | clicar na conta | components/SideNav.jsx:161-164 | "Meu perfil" · "Sair" | — (decisão a registrar: "Sair" desloga sem confirmação) |
| CAS-NAV-14 | variante | agente sem nome | components/SideNav.jsx:165-167 | "Atendente" · "Minha conta" | — |
| CAS-NAV-15 | responsivo | < 768px | side-nav.css:9 | (menu some; só abre como gaveta) | — |

### Aviso de canal desconectado — `components/ChannelStatusBanner.jsx` (montado pela mesa, parte B)

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| CAS-BAN-01 | variante | canal Baileys `awaiting_qr` | components/ChannelStatusBanner.jsx:36 | "Canal {channel.name} está" · "aguardando leitura do QR code" · "ver em Configurações › Canais" | **Sem `role`** (status/alert): aviso mudo para leitor de tela |
| CAS-BAN-02 | variante | canal Baileys com qualquer status ≠ `connected` | components/ChannelStatusBanner.jsx:36 | "Canal {channel.name} está" · "desconectado" · "ver em Configurações › Canais" | (suspeita) status desconhecido também vira "desconectado"; link leva à lista, não ao canal |
| CAS-BAN-03 | variante | vários canais com problema | components/ChannelStatusBanner.jsx:24 | (uma linha por canal, sem limite) | (suspeita) cresce sem teto |
| CAS-BAN-04 | sem-permissão | atendente / gerente sem integrações | components/ChannelStatusBanner.jsx:13 | (nada) | — |
| CAS-BAN-05 | erro | falha em `listChannels` | components/ChannelStatusBanner.jsx:20 | (nada — a faixa some) | Erro silencioso: parece "tudo conectado" |
| CAS-BAN-06 | tempo-real | canal cai/volta durante o turno | components/ChannelStatusBanner.jsx:11 | (a faixa não muda) | Não se atualiza sozinha: fica velha até remontar a mesa |

### Popup "Encerrados" do atendente — `components/ClosedConversationsModal.jsx` + `components/ClosedConversationsList.jsx`

Como se chega: ícone "Encerrados" no menu lateral, só para papel `agent` (SideNav.jsx:129, :138).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CVM-ENC-01 | interação:modal aberto | abrir (fecha pelo fundo) | ClosedConversationsModal.jsx:13 | "Encerrados" | — |
| CVM-ENC-02 | variante | contagem no título | ClosedConversationsModal.jsx:13 | "N" ou "N+" (some com 0) | — |
| CVM-ENC-03 | interação:tooltip | hover na contagem | ClosedConversationsModal.jsx:13 | title "Atendimentos carregados; há mais registros disponíveis" / "Atendimentos encerrados" | o sentido do "+" só aparece por hover (title) |
| CVM-ENC-04 | carregando | 1ª carga (AsyncState) | ClosedConversationsList.jsx:11 | (esqueleto) | — |
| CVM-ENC-05 | erro | falha | ClosedConversationsList.jsx:11 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo" (onRetry não é passado; o hook tem `refresh`) |
| CVM-ENC-06 | sem-permissão | 403 | ClosedConversationsList.jsx:11 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CVM-ENC-07 | vazio | nenhum encerrado | ClosedConversationsList.jsx:11 | "Nenhum atendimento encerrado ainda." | — |
| CVM-ENC-08 | seleção | cartão aberto | ClosedConversationsList.jsx:19 | (cartão realçado) | — |
| CVM-ENC-09 | variante | há mais | ClosedConversationsList.jsx:24-33 | "Carregar mais" | — |
| CVM-ENC-10 | carregando | carregando mais | ClosedConversationsList.jsx:28, :31 | "Carregando…" (desabilitado) | — |
| CVM-ENC-11 | erro | falha em "Carregar mais" | hooks/useMyClosedConversations.js:40-42 | AUSENTE | o catch engole: o botão volta a "Carregar mais" sem aviso |
| CVM-ENC-12 | responsivo | grade de 1/2/3/4 colunas (sm/lg/xl) | ClosedConversationsList.jsx:13 | — | — |
| CVM-ENC-13 | interação:modal aberto | abrir um cartão | ClosedConversationsModal.jsx:26-32 | ConversationModal por cima | — |

## 3. Atendimento


### Mesa de atendimento — `pages/DashboardPage.jsx`

Como se chega na tela: rota do Atendimento (item "Atendimento" do menu lateral), dentro do `AppShell`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-MESA-01 | vazio | nenhuma conversa selecionada (e a lista está visível ao lado) | pages/DashboardPage.jsx:296 | (ilustração) "Selecione uma conversa na lista ao lado para ler o histórico e responder ao cliente." + "Todo atendimento fica registrado no sistema." | — |
| ATD-MESA-02 | carregando | nome da empresa ainda carregando | pages/DashboardPage.jsx:301 | (título do painel vazio fica em branco) | — |
| ATD-MESA-03 | variante | nome da empresa carregado x vazio | pages/DashboardPage.jsx:301 | "{Empresa} · Atendimento" / "Atendimento" | — |
| ATD-MESA-04 | erro | falha ao buscar o nome da empresa | pages/DashboardPage.jsx:301 | "Atendimento" (cai no genérico, sem aviso) | — (queda deliberada, documentada em useCompanyName) |
| ATD-MESA-05 | seleção | aba ativa (Atendimento / Espera / Automação), `aria-selected`, setas ←/→ trocam | pages/DashboardPage.jsx:223 | "Atendimento" · "Espera" · "Automação" (pílula laranja na ativa) | — |
| ATD-MESA-06 | tempo-real | contador em cada aba muda por socket | pages/DashboardPage.jsx:228 | (número ao lado do rótulo da aba) | — (a aba não anuncia a mudança; compensado por ATD-MESA-08) |
| ATD-MESA-07 | variante | contador = 0 | components/ui/Tabs.jsx:38 | (sem número; a aba fica só com o rótulo) | — |
| ATD-MESA-08 | tempo-real | região `aria-live` com as contagens | pages/DashboardPage.jsx:218 | "{n} em espera, {m} em andamento." (sr-only) | (suspeita) não conta Automação; fica dentro do `<aside>`, que vira `display:none` com a conversa em tela cheia (celular), e aí nada é anunciado |
| ATD-MESA-09 | filtro-ativo | digitar em "Buscar conversa" (filtra as 3 abas por nome, telefone, cidade, setor e prévia; persiste ao trocar de aba) | pages/DashboardPage.jsx:198 | placeholder "Buscar conversa" | sem indicação de filtro ativo além do texto no campo; limpar depende do "x" nativo do `type=search` |
| ATD-MESA-10 | busca-sem-resultado | busca não casa nenhum item da aba | components/QueueList.jsx:6 · components/MyConversationsList.jsx:6 | "Nenhum atendimento em espera." / "Nenhum atendimento em automação." / "Nenhum atendimento em andamento." | busca sem resultado AUSENTE: mostra a frase de lista vazia, que afirma algo falso ("nenhum em espera") |
| ATD-MESA-11 | filtro-ativo | busca ativa x contadores das abas | pages/DashboardPage.jsx:228 | "Nenhum atendimento em espera." · (o número da aba conta o total sem a busca) | contadores ignoram a busca (`tabCounts` usa as listas sem filtro) — número e lista se contradizem |
| ATD-MESA-12 | variante | conversa recém-iniciada (ou vinda por `location.state.pendingConversation`) ainda fora das listas | pages/DashboardPage.jsx:115 | (conversa aberta sem item correspondente em nenhuma aba até o socket trazê-la) | — |
| ATD-MESA-13 | tempo-real | conversa aberta sai das listas (assumida por outro, encerrada, transferida, finalizada da fila) | pages/DashboardPage.jsx:286 | (a conversa some e volta o painel "Selecione uma conversa…") | (suspeita) sem aviso de por que a conversa sumiu; `selectedId` fica guardado e reabre sozinha se a conversa voltar |
| ATD-MESA-14 | variante | conversa aberta muda de lista (ex.: assumida da Espera → vai para "Atendimento") | pages/DashboardPage.jsx:238 | (item some da aba atual; a aba não acompanha) | (suspeita) conversa aberta sem item destacado em nenhuma aba visível |
| ATD-MESA-15 | interação:abrir pelo aviso | clicar no aviso de transferência | pages/DashboardPage.jsx:84 | (troca para a aba "Atendimento", seleciona e fecha o aviso) | — |
| ATD-MESA-16 | sucesso | "Iniciar conversa" deu certo | pages/DashboardPage.jsx:319 | (modal fecha e a conversa abre no painel; aba NÃO muda) | (suspeita) se estava em Espera/Automação, a conversa aberta não aparece na aba atual |
| ATD-MESA-17 | interação:tooltip | ponteiro sobre o botão "Nova" | pages/DashboardPage.jsx:185 | title "Nova conversa" (rótulo visível "Nova") | — (CSS tem estilo `:disabled` para ele, mas o botão nunca é desabilitado) |
| ATD-MESA-18 | responsivo | há conversa selecionada e janela < 1024px (`lg`) | pages/DashboardPage.jsx:151 | (faixa de status dos canais — `ChannelStatusBanner`, outra parte — some) | (suspeita) usa largura da janela, não o espaço medido da mesa |
| ATD-MESA-19 | variante | ponto de montagem: `ConversationView` (outra parte) quando há conversa | pages/DashboardPage.jsx:287 | (recebe `painelModo`, `onPainelAbertoChange`, `onTransferClick`, `onBack` = desselecionar, `workspace`) | — |
| ATD-MESA-20 | responsivo | botão "Voltar para a lista" da conversa é `lg:hidden` (janela), mas a mesa decide colunas pelo espaço medido | components/ConversationView.jsx:568 | aria-label "Voltar para a lista" | (suspeita) entre ~500 e 1023px de janela a lista (ou o rail) já está visível ao lado e o botão ainda aparece — clicar só desseleciona |
| ATD-MESA-21 | responsivo | conversa ocupa a tela inteira (lista oculta + conversa selecionada) | pages/DashboardPage.jsx:127 | (avisa o `AppShell` para esconder o botão "Abrir menu") | — |
| ATD-MESA-22 | variante | ponto de montagem: `TransferModal` (gatilho: botão "Transferir" do cabeçalho da conversa, ConversationView:641) | pages/DashboardPage.jsx:315 | — | — |
| ATD-MESA-23 | variante | ponto de montagem: `StartConversationModal` (gatilho: botão "Nova") | pages/DashboardPage.jsx:316 | — | — |
| ATD-MESA-24 | variante | ponto de montagem: `CloseReasonModal` — montado DENTRO do `ConversationView` (gatilho: botão "Encerrar", ConversationView:651) | components/ConversationView.jsx:980 | — | — |
| ATD-MESA-25 | variante | ponto de montagem: `TeamPanel` com `key={profileVersion}` (remonta quando o perfil muda) | pages/DashboardPage.jsx:278 | — | — |
| ATD-MESA-26 | variante | ponto de montagem: `TransferNotice` (fora do `<aside>`) | pages/DashboardPage.jsx:326 | — | — |

### Larguras da mesa (lista / rail / oculta / painel) — `hooks/useWorkspaceLayout.js` + `pages/dashboard.css`

Como se chega na tela: a largura REAL da área de colunas é medida por `ResizeObserver` (inclui o menu lateral mudando de 196px para 64px). Pisos: conversa 420, lista 332, rail 72, painel 268.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-LAY-01 | responsivo | 1º render, antes da medição (palpite = janela − 90px) | hooks/useWorkspaceLayout.js:37 | (layout provisório) | — |
| ATD-LAY-02 | responsivo | largura ≥ 332 + 420 (+268 se painel aberto) → lista expandida | pages/dashboard.css:254 | (lista de 332px com cabeçalho, busca, abas e Equipe) | — |
| ATD-LAY-03 | responsivo | largura ≥ 72 + 420 (+painel) → rail | pages/dashboard.css:255 | (coluna de 72px só com avatares) | — |
| ATD-LAY-04 | responsivo | no rail somem cabeçalho, "Nova", busca, abas e a barra Equipe | pages/dashboard.css:257 | (nada disso aparece) | no rail não dá para ver qual aba está ativa nem trocar de aba / iniciar conversa sem expandir |
| ATD-LAY-05 | filtro-ativo | busca preenchida e a mesa entra em rail | pages/dashboard.css:257 | (rail mostra só os itens filtrados; o campo de busca está escondido) | filtro ativo invisível: rail mostra lista incompleta sem nenhum sinal |
| ATD-LAY-06 | responsivo | no rail, tudo que não é `<ul>` dentro do painel da aba é escondido | pages/dashboard.css:261 | (no rail, esqueleto, frase de vazio, erro e sem-permissão ficam escondidos; só o ícone de expandir aparece) | carregando/erro/sem-permissão invisíveis no rail; rail vazio = coluna em branco |
| ATD-LAY-07 | interação:expandir rail | clicar no ícone do topo do rail | pages/DashboardPage.jsx:163 | aria-label "Ver lista de atendimentos" (só ícone) | — |
| ATD-LAY-08 | interação:tooltip | ponteiro/foco no ícone de expandir | pages/DashboardPage.jsx:171 | dica "Ver lista de atendimentos" | — |
| ATD-LAY-09 | expandido | lista aberta a partir do rail (`listaAberta`): lista 100%, conversa escondida | pages/DashboardPage.jsx:175 | botão "Voltar à conversa" | — |
| ATD-LAY-10 | expandido | lista expandida do rail SEM conversa selecionada | pages/DashboardPage.jsx:175 | "Voltar à conversa" | (suspeita) rótulo promete uma conversa que não existe (volta ao painel vazio) |
| ATD-LAY-11 | responsivo | largura < 492 (lista "oculta") e nenhuma conversa selecionada | pages/DashboardPage.jsx:160 | (lista em 100%; painel da conversa escondido) | — |
| ATD-LAY-12 | responsivo | largura < 492 e conversa selecionada | pages/DashboardPage.jsx:159 | (lista escondida; conversa em 100%) | — |
| ATD-LAY-13 | responsivo | painel lateral (SGP/Cliente) não cabe como coluna → "alternado" (repassado ao ConversationView) | pages/DashboardPage.jsx:289 · pages/dashboard.css:281 | (painel ocupa a área da conversa, com "Voltar à conversa" do ConversationView) | — |
| ATD-LAY-14 | variante | ao selecionar um item com a lista expandida do rail, a lista fecha sozinha | pages/DashboardPage.jsx:79 | (volta ao rail + conversa) | — |

### Listas "Atendimento" / "Espera" / "Automação" — `components/MyConversationsList.jsx`, `components/QueueList.jsx`

Como se chega na tela: abas da mesa. "Atendimento" = `useMyConversations`; "Espera" e "Automação" = `useQueue` separado por `triageState` (pending → Automação).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-LST-01 | carregando | 1ª carga de "Atendimento" | components/MyConversationsList.jsx:6 | (esqueleto de 3 linhas) | — (escondido no rail: ver ATD-LAY-06) |
| ATD-LST-02 | carregando | 1ª carga da fila (Espera e Automação dividem o mesmo status) | components/QueueList.jsx:6 | (esqueleto de 3 linhas) | — (escondido no rail: ver ATD-LAY-06) |
| ATD-LST-03 | erro | falha em `getMyConversations` | components/MyConversationsList.jsx:6 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (role=alert) | erro sem "Tentar de novo" (sem `onRetry`; o hook nem tem `refresh`) — única saída é recarregar a página; texto genérico (o erro do hook não é passado) |
| ATD-LST-04 | erro | falha em `getQueue` (Espera e Automação) | components/QueueList.jsx:6 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (role=alert) | idem ATD-LST-03 |
| ATD-LST-05 | sem-permissão | 403 em qualquer das duas cargas | components/QueueList.jsx:6 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role (padrão do AsyncState); escondido no rail |
| ATD-LST-06 | vazio | "Atendimento" sem conversas | components/MyConversationsList.jsx:6 | "Nenhum atendimento em andamento." | — |
| ATD-LST-07 | vazio | "Espera" sem conversas | pages/DashboardPage.jsx:257 | "Nenhum atendimento em espera." | — |
| ATD-LST-08 | vazio | "Automação" sem conversas | pages/DashboardPage.jsx:271 | "Nenhum atendimento em automação." | — |
| ATD-LST-09 | recarregando | reconexão do socket / volta à aba | hooks/useQueue.js:13 · hooks/useMyConversations.js:13 | AUSENTE | os hooks não expõem `refresh` nem `reloading` e nunca recarregam — nem depois de "Reconectando…"; eventos perdidos na queda só voltam com F5 (suspeita) |
| ATD-LST-10 | tempo-real | lista em erro/sem-permissão, mas o socket continua enchendo o array | hooks/useQueue.js:29 | (o número da aba Espera/Automação sobe pelo socket enquanto o painel mostra erro ou sem permissão) | contador e painel se contradizem |

### Item da lista — variante compacta (a da mesa) — `components/ConversationListItem.jsx`

Como se chega na tela: cada `<li>` das três abas (`compact`), fora do rail. A mesma variante é usada na Supervisão.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-ITEM-01 | variante | filete lateral `data-estado="atendimento"` (tem dono ou status assigned) | components/ConversationListItem.jsx:137 · pages/dashboard.css:59 | (filete laranja) | — |
| ATD-ITEM-02 | variante | `data-estado="espera"` | components/ConversationListItem.jsx:137 · pages/dashboard.css:60 | (filete âmbar) | — |
| ATD-ITEM-03 | variante | `data-estado="automacao"` (triageState pending) | components/ConversationListItem.jsx:137 · pages/dashboard.css:61 | (filete roxo) | — |
| ATD-ITEM-04 | variante | `data-estado="encerrado"` (status closed — só aparece fora da mesa) | components/ConversationListItem.jsx:137 · pages/dashboard.css:62 | (filete verde) | — |
| ATD-ITEM-05 | seleção | item é a conversa aberta | components/ConversationListItem.jsx:136 · pages/dashboard.css:68 | (fundo em degradê, contorno laranja, filete cheio; `aria-current="true"`) | — |
| ATD-ITEM-06 | interação:hover | ponteiro sobre a linha | pages/dashboard.css:63 | (fundo de hover, filete opaco) | — |
| ATD-ITEM-07 | tempo-real | mensagem nova do cliente numa conversa não aberta | components/ConversationListItem.jsx:161 · pages/dashboard.css:78 | (nome branco, hora laranja em negrito, bolinha) title "Mensagem não lida" | (suspeita) `aria-label` numa `<span>` sem papel pode não ser anunciado; marca só existe na sessão (F5 apaga) |
| ATD-ITEM-08 | variante | hora: fila mostra a de chegada, "Atendimento" a da última mensagem | components/ConversationListItem.jsx:153 | "Horário de chegada à fila" · "Horário da última mensagem" · (hora HH:MM) | só HH:MM — conversa de ontem mostra só a hora, sem data |
| ATD-ITEM-09 | variante | sem data de mensagem/criação | components/ConversationListItem.jsx:153 | (hora some) | — |
| ATD-ITEM-10 | variante | nome: `contactDisplayName` → telefone → "Conversa" | components/ConversationListItem.jsx:152 | "Conversa" (último recurso) | — |
| ATD-ITEM-11 | interação:tooltip | ponteiro no nome (cortado com reticências) | components/ConversationListItem.jsx:152 | title = nome completo | só por hover (sem equivalente a toque) |
| ATD-ITEM-12 | variante | prévia por tipo da última mensagem | components/ConversationListItem.jsx:157 | "💠 Pix" / "📷 Foto" / "🎤 Áudio" / "🎥 Vídeo" / "📄 Documento" / "😀 Figurinha" / "📍 Localização" / (telefone se nada) | — |
| ATD-ITEM-13 | variante | última mensagem é do atendente: tiques de status | components/ConversationListItem.jsx:156 | (selo ! vermelho, ✓ cinza, ✓✓ cinza ou ✓✓ verde) | status só por glifo/cor + title: spans sem nome acessível e tiques aria-hidden |
| ATD-ITEM-14 | variante | ficha de local (na Espera só a localidade; nas outras "Localidade · Município") | components/ConversationListItem.jsx:165 | "Barão de Tromaí" / "Barão de Tromaí · Cândido Mendes" (title = texto) | — |
| ATD-ITEM-15 | variante | ficha de setor | components/ConversationListItem.jsx:166 | "{setor}" | — |
| ATD-ITEM-16 | variante | triagem da IA em andamento | components/ConversationListItem.jsx:167 | "IA em triagem" | — |
| ATD-ITEM-17 | variante | triagem da IA concluída | components/ConversationListItem.jsx:172 | "IA · {motivo}" ou "IA" | — |
| ATD-ITEM-18 | variante | triagem com confiança baixa | components/ConversationListItem.jsx:173 | "A triagem da IA ficou com confiança baixa" · "Triagem com confiança baixa" · "⚠" | (suspeita) sentido só no title/aria-label de uma `<span>` sem papel |
| ATD-ITEM-19 | variante | IA resolveu | components/ConversationListItem.jsx:174 | "Resolvido pela IA" | — |
| ATD-ITEM-20 | variante | tem dono | components/ConversationListItem.jsx:176 | "{nome do atendente}" (ficha sem borda) | — |
| ATD-ITEM-21 | variante | sem local/setor/IA/dono | components/ConversationListItem.jsx:163 | (3ª linha some) | — |
| ATD-ITEM-22 | variante | botão "Finalizar sem motivo" só em Espera e Automação (`onQuickClose`) | components/ConversationListItem.jsx:190 | ícone ✓ (aria-label/title "Finalizar sem motivo") | — (sempre visível, não depende de hover) |
| ATD-ITEM-23 | confirmação | clicar em "Finalizar sem motivo" | components/ConversationListItem.jsx:90 | "Finalizar esse atendimento sem informar o motivo?" — Cancelar / Finalizar (perigo) | — |
| ATD-ITEM-24 | salvando | confirmou "Finalizar" | pages/DashboardPage.jsx:91 | AUSENTE (nada muda até o socket tirar o item) | sem indicação de envio; dá para confirmar de novo |
| ATD-ITEM-25 | erro | finalizar direto da fila falha | pages/DashboardPage.jsx:91 | AUSENTE (`.catch(() => {})`) | erro silencioso: item continua na fila sem explicação |
| ATD-ITEM-26 | sucesso | finalizar deu certo (`queue:removed`) | hooks/useQueue.js:39 | (item some; se era a conversa aberta, volta o painel vazio) | — |

### Item da lista — variante rail — `components/ConversationListItem.jsx`

Como se chega na tela: mesa em modo rail (ATD-LAY-03).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-RAIL-01 | variante | item no rail | components/ConversationListItem.jsx:104 | (só avatar 36px; sem prévia, hora, fichas nem "Finalizar") aria-label = nome | — |
| ATD-RAIL-02 | seleção | item aberto | components/ConversationListItem.jsx:113 · pages/dashboard.css:271 | (fundo selecionado + borda laranja à esquerda; `aria-current`) | — |
| ATD-RAIL-03 | tempo-real | mensagem nova não lida | components/ConversationListItem.jsx:122 | (bolinha no canto do avatar, `aria-hidden`) | não lida não é anunciada: o nome acessível da linha é só o nome |
| ATD-RAIL-04 | interação:tooltip | ponteiro sobre o avatar | components/ConversationListItem.jsx:123 | dica "{nome}" (portal no body) | (suspeita) em toque o nome só aparece ao tocar, e tocar já abre a conversa |
| ATD-RAIL-05 | foco-revela | foco de teclado no avatar | components/DicaFlutuante.jsx:50 | dica "{nome}" | — |
| ATD-RAIL-06 | interação:hover | ponteiro sobre a linha | pages/dashboard.css:270 | (fundo de hover) | — |

### Item da lista — variante padrão (FORA da mesa: popup "Encerrados") — `components/ConversationListItem.jsx`

Como se chega na tela: `ClosedConversationsList` (ícone "Encerrados" do menu lateral). Registrado porque o arquivo é desta parte.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-ITP-01 | seleção | item selecionado | components/ConversationListItem.jsx:208 | (fundo claro; o fio divisor some) | — |
| ATD-ITP-02 | interação:hover | ponteiro sobre o item | components/ConversationListItem.jsx:208 | (fundo de hover) | — |
| ATD-ITP-03 | variante | não lida | components/ConversationListItem.jsx:252 | (bolinha laranja, só title "Mensagem não lida") | sem texto acessível |
| ATD-ITP-04 | variante | fichas local / dono / setor | components/ConversationListItem.jsx:237 | "{local}" "{atendente}" "{setor}" | — |
| ATD-ITP-05 | variante | triagem da IA concluída | components/ConversationListItem.jsx:267 | "Triagem IA · {motivo}" + "confiança baixa" + "resolvido pela IA" | — (texto diferente da variante compacta: "IA · motivo", "⚠", "Resolvido pela IA") |
| ATD-ITP-06 | variante | com `onQuickClose` (não usado no popup) | components/ConversationListItem.jsx:279 | ícone ✓ (title "Finalizar sem motivo") | — |
| ATD-ITP-07 | variante | divisor entre itens (`divided`) | components/ConversationListItem.jsx:292 | (fio de 1px) | — |

### Dica flutuante do rail — `components/DicaFlutuante.jsx`

Como se chega na tela: hover ou foco no avatar do rail e no botão de expandir o rail.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-DICA-01 | interação:tooltip | `mouseenter`/`focus` no gatilho | components/DicaFlutuante.jsx:63 | "{children}" · (caixa em portal, aria-hidden) | — |
| ATD-DICA-02 | interação:rolando | rolar ou redimensionar com a dica aberta | components/DicaFlutuante.jsx:36 | (dica some) | — |

### Aviso de transferência (toast) — `components/TransferNotice.jsx` + `hooks/useTransferNotice.js`

Como se chega na tela: evento `conversation:assigned` COM `transferredBy` (alguém transferiu para mim).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-AVT-01 | tempo-real | transferência recebida | components/TransferNotice.jsx:21 | "{Fulano} transferiu o atendimento de {Cliente} para você." / "Clique para abrir" (role=status) + som se não mudo | — |
| ATD-AVT-02 | tempo-real | 9 s depois | components/TransferNotice.jsx:14 | (some sozinho) | (suspeita) não pausa com ponteiro/foco sobre o aviso; ação clicável com prazo |
| ATD-AVT-03 | interação:abrir | clicar no texto | components/TransferNotice.jsx:30 | aria-label "Abrir o atendimento de {Cliente}" | — |
| ATD-AVT-04 | interação:fechar | clicar no "×" | components/TransferNotice.jsx:42 | aria-label "Fechar aviso" | — |
| ATD-AVT-05 | variante | segunda transferência antes de o primeiro aviso sumir | hooks/useTransferNotice.js:21 | (o novo substitui o anterior) | (suspeita) o primeiro aviso se perde, sem fila |
| ATD-AVT-06 | variante | o próprio atendente assumiu (sem `transferredBy`) | hooks/useTransferNotice.js:20 | (nenhum aviso, nenhum som) | — |

### Cabeçalho da conversa — `components/ConversationView.jsx`

Como se chega na tela: Atendimento → clicar numa conversa da lista (mesa) ou abrir uma conversa pela Supervisão / "Encerrados" (modal).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-CAB-01 | variante | mesa (`workspace`) × modal | components/ConversationView.jsx:554,616,664 | (mesa: histórico/SGP/Cliente vão para a barra de contexto; modal: histórico + SGP dentro do cabeçalho, sem "Cliente") | — |
| CV-CAB-02 | responsivo | botão voltar: mesa abaixo de `lg`, modal abaixo de `md` | components/ConversationView.jsx:566-572 | (seta; aria "Voltar para a lista") | no modal o mesmo rótulo "Voltar para a lista" fecha o diálogo da conversa (suspeita: rótulo não diz o que faz) |
| CV-CAB-03 | interação:abrir modal | clique no bloco nome/avatar abre "Editar cliente" | components/ConversationView.jsx:573-576 | aria "Editar cliente: {nome - cidade}" | o aria-label substitui o conteúdo do botão: status ("Em atendimento"), canal e telefone não chegam ao leitor de tela (suspeita) |
| CV-CAB-04 | variante | título: nome → telefone → fallback | components/ConversationView.jsx:588 | "{nome}" / "{telefone}" / "Conversa" | — |
| CV-CAB-05 | interação:tooltip | hover no nome | components/ConversationView.jsx:588 | title = telefone (se há nome) ou o próprio nome | — |
| CV-CAB-06 | variante | status 'closed' | components/ConversationView.jsx:591 (regra :149) | "Encerrado" (ponto apagado) | — |
| CV-CAB-07 | variante | tem atendente | components/ConversationView.jsx:591 (:150) | "Em atendimento" (ponto verde) | não diz COM QUEM — conversa de outro atendente parece igual à minha |
| CV-CAB-08 | variante | sem atendente e triagem pendente | components/ConversationView.jsx:591 (:151) | "Em automação" (ponto laranja) | — |
| CV-CAB-09 | variante | sem atendente | components/ConversationView.jsx:591 (:152) | "Em espera" (ponto laranja) | — |
| CV-CAB-10 | variante | status 'silent' (conversa de campanha sem resposta) | components/ConversationView.jsx:152,591 | AUSENTE (cai em "Em espera") | sem rótulo próprio: campanha silenciosa aparece como "Em espera" e ganha "Assumir" (isUnassigned só olha 'closed') (suspeita) |
| CV-CAB-11 | variante | 2ª linha com canal | components/ConversationView.jsx:595 (:141) | "WhatsApp · {canal}" | — |
| CV-CAB-12 | variante | 2ª linha sem canal, com nome | components/ConversationView.jsx:595 | "{telefone}" | telefone cru, sem `formatPhone` (formatado só em :599) (suspeita) |
| CV-CAB-13 | vazio | sem canal e sem nome | components/ConversationView.jsx:595 | "clique aqui para ver os dados do contato" | — |
| CV-CAB-14 | variante | telefone ao lado do canal | components/ConversationView.jsx:596-601 | "· {telefone formatado}" | — |
| CV-CAB-15 | responsivo | ficha de protocolo só com cabeçalho ≥ 760px (container) | components/ConversationView.jsx:606 | "#{protocolo}" · "Protocolo {protocolo}" | abaixo de 760px o protocolo some do cabeçalho; na mesa só no painel "Cliente" |
| CV-CAB-16 | responsivo | ficha de cidade só ≥ 880px | components/ConversationView.jsx:608 | "{cidade}" | — |
| CV-CAB-17 | responsivo | ficha de setor só ≥ 620px | components/ConversationView.jsx:609 | "{setor}" | — |
| CV-CAB-18 | interação:tooltip | hover nas fichas | components/ConversationView.jsx:170 | title = texto da ficha | — |
| CV-CAB-19 | responsivo | cabeçalho quebra em 2 linhas (identidade base 240px, ações descem) | components/ConversationView.jsx:556,565 | (ações na 2ª linha) | — |
| CV-CAB-20 | variante | modal: grupo "histórico + SGP" no cabeçalho | components/ConversationView.jsx:616-630 | (ícones; aria/title "Ver atendimentos anteriores", "Consultar SGP") | — |
| CV-CAB-21 | expandido | SGP aberto (modal) | components/ConversationView.jsx:620 | (aria-expanded=true) | aberto só por aria: o botão não muda visualmente (suspeita) |
| CV-CAB-22 | variante | conversa sem atendente → Assumir | components/ConversationView.jsx:632-635 | "Assumir" | — |
| CV-CAB-23 | salvando | clicou "Assumir" | components/ConversationView.jsx:632 | AUSENTE | botão não desabilita nem mostra "Assumindo…"; clique duplo possível; sucesso só aparece quando o socket atualiza a conversa |
| CV-CAB-24 | erro | falha ao assumir | components/ConversationView.jsx:521 (render :993) | Aviso: "Não foi possível assumir este atendimento." ou traduzido (ex. "Este atendimento já foi assumido por outra pessoa ou já foi encerrado.") + "Entendi" | — |
| CV-CAB-25 | variante | Transferir: minha, sem atendente, ou admin/gerente (não encerrada) | components/ConversationView.jsx:637-648 | "Transferir" | — |
| CV-CAB-26 | responsivo | Transferir só ícone abaixo de 400px (container) | components/ConversationView.jsx:644,647 | (ícone; aria/title "Transferir atendimento") | — |
| CV-CAB-27 | interação:abrir modal | Transferir → `onTransferClick` (TransferModal do pai, fora desta parte) | components/ConversationView.jsx:641 | — | — |
| CV-CAB-28 | variante | Encerrar em conversa sem atendente: secundário só ícone | components/ConversationView.jsx:649-658 | (ícone ✓; aria/title "Encerrar atendimento") | — |
| CV-CAB-29 | variante | Encerrar em conversa minha / admin: perigo com texto | components/ConversationView.jsx:654,657 | "Encerrar" | — |
| CV-CAB-30 | variante | admin/gerente vendo conversa de outro atendente | components/ConversationView.jsx:401,637 | Transferir + Encerrar, sem Assumir, sem compositor (o aviso que falta está em CV-ROD-03) | — |
| CV-CAB-31 | variante | conversa encerrada ("Encerrados"/Supervisão) | components/ConversationView.jsx:637 | (nenhum botão de ação; só a ficha "Encerrado") | — |
| CV-CAB-32 | variante | "Editar cliente" abre em qualquer conversa, até encerrada/de outro | components/ConversationView.jsx:574 | (mesmo modal; decisão de produto em aberto, não é bug) | — |

### Barra de contexto (só na mesa) — `components/ConversationView.jsx`

Como se chega na tela: mesa de Atendimento, faixa logo abaixo do cabeçalho.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-CTX-01 | variante | rótulo: setor → 2ª linha → status | components/ConversationView.jsx:665 | "{setor}" / "WhatsApp · {canal}" / "Em espera" | — |
| CV-CTX-02 | interação:abrir modal | Histórico | components/ConversationView.jsx:668-670 | (ícone só; aria/title "Ver atendimentos anteriores") | — |
| CV-CTX-03 | expandido | SGP aberto | components/ConversationView.jsx:671-675 | "SGP" (aria-expanded) | sem estilo visual de ativo (suspeita) |
| CV-CTX-04 | expandido | Cliente aberto | components/ConversationView.jsx:677-685 | "Cliente" (aria-expanded) | sem estilo visual de ativo (suspeita) |
| CV-CTX-05 | interação:alternar painel | abrir Cliente fecha SGP; SGP aberto esconde Cliente | components/ConversationView.jsx:680-681, :994-1010 | — | — |

### Painel lateral — comportamento (SGP / Cliente) — `components/ConversationView.jsx`

Como se chega na tela: botões SGP/Cliente, ou SGP abrindo sozinho.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-PNL-01 | variante | contato já tem documento SGP → SGP abre sozinho ao trocar de conversa e já busca | components/ConversationView.jsx:375; components/SgpLookupPanel.jsx:268-273 | (painel "Consultar SGP" em "Buscando no SGP…") | — |
| CV-PNL-02 | responsivo | coluna de 268px ao lado quando a raiz mede ≥ 688px e a mesa decidiu 'coluna' | components/ConversationView.jsx:315-316, :994-1010 | (painel à direita da conversa) | — |
| CV-PNL-03 | responsivo | alternado: painel substitui a conversa (espaço curto ou mesa pediu) | components/ConversationView.jsx:554, :987-992 | "Voltar à conversa" | — |
| CV-PNL-04 | interação:foco | ao alternar, foco vai para "Voltar à conversa" | components/ConversationView.jsx:344-346 | — | — |
| CV-PNL-05 | interação:teclado ESC | ESC fecha o painel e devolve o foco ao gatilho (se não há diálogo aberto) | components/ConversationView.jsx:330-340 | — | — |
| CV-PNL-06 | interação:fechar painel | "×" do SGP ou do Cliente | components/ConversationView.jsx:1002, :1008 | — | o foco não volta ao gatilho (só ESC e "Voltar à conversa" devolvem) (suspeita) |
| CV-PNL-07 | variante | modal: não há painel "Cliente"; os dados ficam no ConversationInfoPanel | components/ConversationView.jsx:1006 | — | — |

### Painel "Dados do cliente" (CustomerPanel interno) — `components/ConversationView.jsx`

Como se chega na tela: mesa → botão "Cliente" na barra de contexto.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-CLI-01 | expandido | Cliente aberto | components/ConversationView.jsx:209-213 | "Dados do cliente" + "×" (aria "Fechar dados do cliente") | — |
| CV-CLI-02 | variante | identidade: avatar 52 + nome/telefone/"Conversa" + status | components/ConversationView.jsx:216-219 | "Encerrado" / "Em atendimento" / "Em automação" / "Em espera" | 'silent' vira "Em espera" (como CV-CAB-10) |
| CV-CLI-03 | variante | contato com nota interna | components/ConversationView.jsx:222-227 | "Nota interna" + texto | depois de salvar em "Editar cliente" continua mostrando a nota ANTIGA (lê `conversation.contactInternalNote`, não o override) |
| CV-CLI-04 | variante | linhas do atendimento, cada uma só se houver | components/ConversationView.jsx:228-233 | "Telefone" "Cidade" "Setor" "Atendente" "Protocolo" | telefone cru, sem `formatPhone` (suspeita) |
| CV-CLI-05 | vazio | nenhuma linha de atendimento | components/ConversationView.jsx:228 | (seção some) | — |
| CV-CLI-06 | variante | triagem por IA concluída | components/ConversationView.jsx:234-238 | "Triagem por IA" / "Motivo: {motivo}" / resumo | — |
| CV-CLI-07 | variante | triagem com confiança baixa | components/ConversationView.jsx:239 | "Confiança baixa" | — |
| CV-CLI-08 | variante | resolvido pela IA | components/ConversationView.jsx:240 | "Resolvido pela IA" | — |

### Linha do tempo — `components/ConversationView.jsx` + `hooks/useConversationMessages.js`

Como se chega na tela: qualquer conversa aberta.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-TL-01 | variante | aviso fixo no topo | components/ConversationView.jsx:693-698 | "Este atendimento fica registrado no sistema da {empresa}." | enquanto o nome carrega (ou se a rota falhar) diz "da empresa" e depois troca (suspeita) |
| CV-TL-02 | carregando | 1ª carga, lista vazia | components/ConversationView.jsx:718-722 | "Carregando mensagens…" (role=status, sem esqueleto) | — |
| CV-TL-03 | erro-com-retry | falha ao carregar | components/ConversationView.jsx:702-716 | "Não foi possível carregar as mensagens deste atendimento." + "Tentar de novo" (role=alert) | — |
| CV-TL-04 | recarregando | depois de "Tentar de novo" | components/ConversationView.jsx:718 | "Carregando mensagens…" (lista zerada) | — |
| CV-TL-05 | vazio | conversa pronta sem mensagem | components/ConversationView.jsx:741 | AUSENTE | estado vazio ausente: só o aviso fixo do topo; e o 1º quadro é 'ready' com lista vazia (status nasce 'ready', useConversationMessages.js:27) |
| CV-TL-06 | variante | há mais de 50 mensagens | components/ConversationView.jsx:728-738 | "Carregar mensagens anteriores" | — |
| CV-TL-07 | desabilitado-com-motivo | carregando anteriores | components/ConversationView.jsx:733,736 | "Carregando…" | — |
| CV-TL-08 | erro | falha ao carregar anteriores | hooks/useConversationMessages.js:93-96 | AUSENTE | erro silencioso (catch vazio): o botão volta ao normal sem aviso |
| CV-TL-09 | interação:rolagem | depois de carregar anteriores | components/ConversationView.jsx:394-398 | (a linha do tempo pula para o FIM) | defeito: o efeito roda a cada mudança de `messages.length`, inclusive no prepend — quem pediu o passado é jogado para o fim |
| CV-TL-10 | tempo-real | mensagem nova por socket (message:new / queue:new) | hooks/useConversationMessages.js:139-140; components/ConversationView.jsx:394-398 | (bolha nova e rolagem forçada até o fim) | rola mesmo com o atendente lendo mais acima |
| CV-TL-11 | interação:ir para o fim | botão "ir para o fim" / aviso "novas mensagens" | components/ConversationView.jsx:692 | AUSENTE | sem indicador de novas; a rolagem forçada (CV-TL-10) está no lugar |
| CV-TL-12 | tempo-real | recebida com a conversa já aberta (leitor de tela) | components/ConversationView.jsx:691 | "Nova mensagem de {nome - cidade}: {texto \| anexo \| mensagem}" (sr-only, aria-live polite) | — |
| CV-TL-13 | variante | separador: hoje | components/ConversationView.jsx:745-747 (:77) | "Hoje" | — |
| CV-TL-14 | variante | separador: ontem | components/ConversationView.jsx:745-747 (:83) | "Ontem" | — |
| CV-TL-15 | variante | separador: últimos 7 dias | components/ConversationView.jsx:745 | (dia da semana por extenso, ex.: segunda-feira) | — |
| CV-TL-16 | variante | separador: mais antigo | components/ConversationView.jsx:745 | (rótulo do dia no formato dd/mm/aaaa) | — |
| CV-TL-17 | variante | separador: data ilegível | components/ConversationView.jsx:745-747 (:119) | "Data desconhecida" | — |
| CV-TL-18 | tempo-real | cliente digitando | components/ConversationView.jsx:595 | AUSENTE | presença/"digitando…" não existe no front |
| CV-TL-19 | variante | mensagem de sistema (assumido, transferido, encerrado) | components/ConversationView.jsx:741 | AUSENTE | eventos do atendimento não aparecem entre as bolhas |
| CV-TL-20 | variante | mensagem apagada/revogada | components/ConversationView.jsx:792 | AUSENTE | não há variante "apagada" na bolha |
| CV-TL-21 | variante | nota interna na linha do tempo | components/ConversationView.jsx:741 | AUSENTE | nota interna só existe no contato (painel Cliente / Editar cliente) |
| CV-TL-22 | tempo-real | relógio da janela de 24h recalculado a cada 60 s | components/ConversationView.jsx:389-392 | (avisos de janela aparecem/somem sozinhos) | — |

### Bolha de mensagem — `components/ConversationView.jsx`

Como se chega na tela: linha do tempo.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-BOL-01 | variante | entrada × saída | components/ConversationView.jsx:788-800 | (esquerda/direita; na mesa filete lateral e cantos diferentes) | — |
| CV-BOL-02 | variante | enviada pela IA | components/ConversationView.jsx:779-781, :793 | selo "IA" (mesa: chip colorido; modal: fundo branco translúcido) | — |
| CV-BOL-03 | variante | autor na 1ª bolha de saída do grupo (só mesa) | components/ConversationView.jsx:801-805 | "Assistente IA" / "Atendente" | mensagens automáticas (boas-vindas, encerramento, fora do horário, campanha, envios SGP) têm sentBy 'human' e aparecem como "Atendente" (suspeita) |
| CV-BOL-04 | variante | agrupamento por direção | components/ConversationView.jsx:790 | (1ª do grupo mais espaçada) | — |
| CV-BOL-05 | variante | figurinha | components/ConversationView.jsx:757, :794-795 | (sem moldura) | — |
| CV-BOL-06 | variante | imagem/vídeo sem legenda | components/ConversationView.jsx:859 | (hora em pílula escura sobre a mídia) | — |
| CV-BOL-07 | variante | documento / localização / pix | components/ConversationView.jsx:760, :864 | (hora em bloco abaixo) | — |
| CV-BOL-08 | variante | texto ou legenda | components/ConversationView.jsx:856-858 | (hora flutuando no canto) | — |
| CV-BOL-09 | variante | Pix: código nunca como texto solto | components/ConversationView.jsx:756 | (cartão Pix pelo MessageAttachment — C2) | — |
| CV-BOL-10 | variante | resposta a mensagem (citação) | components/ConversationView.jsx:806 | "Você" · "{nome}" · "{telefone}" · "Conversa" · "{trecho}" · "Mídia" | citação de mensagem da IA ou de outro atendente também vira "Você" (qualquer direction outbound, :765-766) (suspeita) |
| CV-BOL-11 | variante | mensagem com texto | components/ConversationView.jsx:837-846 | "{conteúdo}" | — |
| CV-BOL-12 | variante | hora da mensagem | components/ConversationView.jsx:782 (:91-94) | "hh:mm" | data ilegível (não-nula) vira "Invalid Date" em inglês: `clockLabel` não confere NaN, só o separador de dia confere |
| CV-BOL-13 | interação:falha de envio | saída com status 'failed' | components/ConversationView.jsx:848-854 | "Não entregue: {motivo}" / "Não entregue" | sem role/aria-live: a falha chega depois por socket (message:updated) e não é anunciada; motivo desconhecido sai cru (ver CV-FAL-03) |
| CV-BOL-14 | interação:reenviar | reenviar a que falhou | components/ConversationView.jsx:848 | AUSENTE | sem ação na bolha; o atendente precisa redigitar |
| CV-BOL-15 | variante | "enviando/na fila" | components/ConversationView.jsx:783 | AUSENTE | a mensagem nasce 'sent' no backend (src/queue/outbound-queue.js:21), antes de o worker enviar: o tique "Enviado" aparece com a mensagem ainda na fila |
| CV-BOL-16 | hover-revela | Responder na bolha (conversa minha + mensagem com texto) | components/ConversationView.jsx:866-875 | (chevron; aria/title "Responder") | invisível no toque (opacity-0 até hover): no celular não se descobre |
| CV-BOL-17 | foco-revela | Responder pelo teclado | components/ConversationView.jsx:871 | (aparece com focus-visible) | — |
| CV-BOL-18 | interação:citando | clicou Responder | components/ConversationView.jsx:868, :947-948 | (barra de citação no MessageInput — C2) | — |
| CV-BOL-19 | variante | mídia sem texto não tem Responder | components/ConversationView.jsx:866 | — | — |
| CV-BOL-20 | variante | MessageAttachment sempre montado (dark); "Analisar comprovante" só se a conversa é minha; avatar só na entrada | components/ConversationView.jsx:820-835 | (C2) | — |
| CV-BOL-21 | variante | tiques só em mensagens de saída | components/ConversationView.jsx:783 | (ver CV-TCK) | — |

### Rodapé da conversa (avisos + compositor) — `components/ConversationView.jsx`

Como se chega na tela: conversa aberta; o bloco inteiro só existe se `isMine`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-ROD-01 | variante | conversa minha: sugestão IA + avisos de janela + MessageInput | components/ConversationView.jsx:883-953 | — | — |
| CV-ROD-02 | variante | conversa sem atendente (espera/automação) | components/ConversationView.jsx:883 | AUSENTE (rodapé vazio) | compositor some sem explicação ("assuma para responder" não existe; só o botão "Assumir" lá em cima) |
| CV-ROD-03 | variante | conversa de outro atendente (admin/gerente na Supervisão) | components/ConversationView.jsx:883 | AUSENTE | nenhum aviso "em atendimento com {nome}" / "somente leitura" |
| CV-ROD-04 | variante | conversa encerrada | components/ConversationView.jsx:883 | AUSENTE | sem aviso "Atendimento encerrado" (só a ficha do cabeçalho) |
| CV-ROD-05 | variante | IA/automação conduzindo (triagem pendente) | components/ConversationView.jsx:883 | AUSENTE | só a ficha "Em automação"; nada diz que a IA está respondendo |
| CV-ROD-06 | variante | campanha 'silent' | components/ConversationView.jsx:883 | AUSENTE | ver CV-CAB-10 |
| CV-ROD-07 | variante | janela 24h fechada (canal oficial, conversa minha) | components/ConversationView.jsx:894-912 | "Janela de 24h fechada. O WhatsApp só entrega texto livre até 24h… use um template aprovado." + "Enviar template" | sem role: aparece sozinho pelo relógio de 60 s e não é anunciado (suspeita) |
| CV-ROD-08 | variante | "fechada" falsa com lista vazia (carregando ou erro) | components/ConversationView.jsx:266, :894 | mesmo texto de CV-ROD-07 | defeito: com `messages=[]` o cálculo dá FECHADA em todo canal oficial (serviceWindow.js:66) — o aviso pisca a cada abertura e fica fixo se a carga falhar; idem se as 50 mais novas não tiverem mensagem do cliente |
| CV-ROD-09 | variante | janela indeterminada (hora ilegível) | components/ConversationView.jsx:917-925 | "Não foi possível conferir a janela de 24h. … Você pode enviar normalmente — quem decide é o WhatsApp." | — |
| CV-ROD-10 | variante | indeterminada + já houve recusa 131047 | components/ConversationView.jsx:926-938 | "Uma mensagem já foi recusada por estar fora da janela:" + "Enviar template" | — |
| CV-ROD-11 | variante | janela aberta ou canal Baileys | utils/serviceWindow.js:36,67 | (nada) | — |
| CV-ROD-12 | interação:abrir modal | "Enviar template" | components/ConversationView.jsx:905, :932 | (abre SendTemplateModal) | — |
| CV-ROD-13 | variante | MessageInput montado só na conversa minha; recebe rascunho da sugestão editada | components/ConversationView.jsx:942-951 | (C2) | — |

### Compositor — `components/MessageInput.jsx`

Como se chega na tela: Atendimento → abrir uma conversa que é minha e está aberta (`ConversationView.jsx:883`, `isMine`). Se não for minha ou estiver encerrada, o compositor não é renderizado (não existe versão desabilitada).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-CMP-01 | variante | campo vazio, sem anexo | components/MessageInput.jsx:505, :593-601 | placeholder "Digite uma mensagem…"; botão da direita = microfone "Gravar áudio" | — |
| MSG-CMP-02 | variante | há texto ou anexo (`canSend`) | components/MessageInput.jsx:583-591 | o microfone vira o botão laranja "Enviar" (seta) | — |
| MSG-CMP-03 | interação:digitando | texto cresce | components/MessageInput.jsx:499-509 (altura em :30-37, :507) | o campo cresce de 48px até min(320px, 45% da altura da janela) e depois rola por dentro | — |
| MSG-CMP-04 | responsivo | redimensionar, zoom, girar aparelho | components/MessageInput.jsx:219-226, :507 | (teto do campo recalculado) | — |
| MSG-CMP-05 | interação:atalho de teclado | Enter envia; Shift+Enter quebra linha; Enter com campo vazio não faz nada | components/MessageInput.jsx:366-371, :341 | (nenhuma dica visível do atalho) | — |
| MSG-CMP-06 | interação:enviando | aguardando `onSend` | components/MessageInput.jsx:585, :588 | (botão Enviar com 50% de opacidade, sem texto) | Desabilitado sem motivo: nenhum "Enviando…", sem `aria-busy`; campo e "Remover" do anexo continuam ativos durante o upload |
| MSG-CMP-07 | interação:falha de envio | `onSend` rejeita | components/MessageInput.jsx:607-611 | "Falha ao enviar mensagem" ou a tradução do servidor (ex.: "Este canal não está conectado.") com role=alert; o texto e o anexo são mantidos | O erro não é limpo ao trocar de conversa (o efeito de :228-246 não zera `error`) nem ao digitar: a falha do cliente A aparece sob o cliente B |
| MSG-CMP-08 | validação | anexo acima do limite do tipo (servidor, conversations.routes.js:336) | components/MessageInput.jsx:622 | "O arquivo passa do limite de {m[1]} MB para {m[2]}." | Nenhuma checagem no cliente: o arquivo sobe inteiro antes da recusa; o tipo sai em inglês ("image", "video", "document"), via utils/errorMessages.js:128 |
| MSG-CMP-09 | validação | anexo acima de 100 MB (multer) | components/MessageInput.jsx:622 | "O arquivo passa do limite de {m[1]} MB." | Nenhuma checagem no cliente (sobe até 100 MB antes do erro) |
| MSG-CMP-10 | validação | áudio (gravado ou do disco) com texto no campo | components/MessageInput.jsx:608 | "Áudio e figurinha não aceitam legenda. Mande o texto em uma mensagem separada." | O cliente deixa digitar legenda com áudio anexado; só o servidor recusa |
| MSG-CMP-11 | validação | tipo de arquivo não aceito | components/MessageInput.jsx:443 | AUSENTE (input sem `accept`; o servidor trata tipo desconhecido como documento) | — |
| MSG-CMP-12 | validação | contagem e limite de caracteres | components/MessageInput.jsx:499-509 | AUSENTE (sem contador nem `maxLength`) | (suspeita) o texto do WhatsApp tem limite de 4096 caracteres; texto maior só falha depois do envio |
| MSG-CMP-13 | interação:anexo pendente | arquivo escolhido pelo clipe (não imagem) | components/MessageInput.jsx:416 | (ícone de clipe) · "Anexo: {file.name}" · "Remover" | Aparece sem anúncio (sem role=status) |
| MSG-CMP-14 | variante | anexo pendente é imagem (escolhida ou colada) | components/MessageInput.jsx:405-410 | miniatura 40×40 (alt "Pré-visualização do anexo") + "Anexo: nome.png" | — |
| MSG-CMP-15 | variante | anexo pendente é vídeo, áudio ou documento do disco | components/MessageInput.jsx:411-415 | só o ícone de clipe + nome (sem prévia) | — |
| MSG-CMP-16 | variante | arquivo do disco com o nome `gravacao.webm` | components/MessageInput.jsx:430 | "Anexo: {file.name}" · "gravação de áudio ({recordingSeconds}s)" | Ramo morto para a gravação real (ela vai ao RecordingPreview, :412); um arquivo do disco chamado gravacao.webm mostra a duração da última gravação (ou 0s) |
| MSG-CMP-17 | variante | anexo + texto (o texto vira legenda) | components/MessageInput.jsx:499-509 | (o placeholder continua "Digite uma mensagem…") | — |
| MSG-CMP-18 | interação:colando | Ctrl+V com imagem na área de transferência | components/MessageInput.jsx:420 | "Pré-visualização do anexo" · "Anexo: {file.name}" · "imagem-colada-{Date.now()}.{extensao}" · "Remover" | Colar imagem troca o anexo pendente sem aviso, inclusive uma gravação em prévia, que se perde (:279-280 zera fileIsRecording); colar arquivo que não é imagem não faz nada (:270-271) |
| MSG-CMP-19 | interação:arrastando | arrastar um arquivo sobre a conversa ou o compositor | components/MessageInput.jsx:390 | AUSENTE | Sem zona de soltar. (suspeita) Soltar o arquivo cai no comportamento padrão do navegador, que abre o arquivo na aba e sai do app |
| MSG-CMP-20 | interação:citando | botão "Responder" da bolha (ConversationView.jsx:866) | components/MessageInput.jsx:377-396 | barra com filete cobre: "Respondendo" + trecho da mensagem em 1 linha + "✕" ("Cancelar resposta") | — |
| MSG-CMP-21 | variante | citação + envio falha | components/MessageInput.jsx:377 (ConversationView.jsx:474-475) | a barra de citação continua (só é limpa depois do sucesso) | — |
| MSG-CMP-22 | variante | "Editar" numa sugestão da IA (`draftKey` novo) | components/MessageInput.jsx:124-132 | o texto da sugestão entra no campo e o campo recebe o foco | (suspeita) Substitui o que já estava digitado, sem desfazer |
| MSG-CMP-23 | variante | troca de conversa | components/MessageInput.jsx:228-246 | o rascunho de texto é guardado e restaurado por conversa; anexo e gravação são descartados | `error`, `sending` e os popovers abertos não são zerados. (suspeita) Um envio lento que termina depois da troca executa `setContent('')` (:349) e apaga o rascunho que acabou de ser restaurado para o outro cliente |
| MSG-CMP-24 | interação:tooltip | hover nos botões do compositor | components/MessageInput.jsx:72, :389, :454, :587, :597 | title: "Anexar arquivo", "Respostas rápidas", "Emojis", "Enviar", "Gravar áudio", "Parar gravação", "Cancelar resposta" | — |
| MSG-CMP-25 | variante | canal desconectado | components/MessageInput.jsx:84 | AUSENTE | (suspeita) O atendente escreve ou grava e o envio é ACEITO: POST /:id/messages não confere o canal (src/api/conversations.routes.js:291-380; enfileira em src/queue/outbound-queue.js:15); a falha só vem depois, do worker (src/whatsapp-adapters/baileys.manager.js:269), na bolha e não no compositor |
| MSG-CMP-26 | variante | sem permissão de envio (conversa não é minha, encerrada, admin só olhando) | ConversationView.jsx:883 | AUSENTE como estado do componente: não existe prop `disabled`; o compositor inteiro some | — |
| MSG-CMP-27 | variante | janela de 24h fechada | ConversationView.jsx:894-912 | o compositor NÃO é desabilitado (há um aviso acima dele, fora deste componente) | — |
| MSG-CMP-28 | responsivo | modo workspace (tela de Atendimento) | pages/dashboard.css:167-175 | botões encolhem para 30×32 / 35×35; a borda da caixa muda no `:focus-within` | — |
| MSG-CMP-29 | responsivo | abaixo de `md` | components/MessageInput.jsx:378, :403, :428, :608 | (padding lateral px-3 em vez de px-5) | — |

### Respostas rápidas (popover do compositor) — `components/MessageInput.jsx` + `hooks/useQuickReplies.js`

Como se chega na tela: botão "Respostas rápidas" (ícone de raio) no compositor.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-RR-01 | interação:popover aberto | clique no gatilho | components/MessageInput.jsx:542-549, :63 | menu (role=menu) com cabeçalho "Respostas rápidas"; o gatilho fica destacado (bg-white/10, `aria-expanded`); animação wa-pop | — |
| MSG-RR-02 | carregando | `status === 'loading'` | components/MessageInput.jsx:565 | (esqueleto de 2 linhas) · "Carregando…" | O esqueleto e a mensagem de vazio não têm padding horizontal e encostam na borda do popover: :562 só tem py-1.5, e AsyncState.jsx:5 e :31 não têm px |
| MSG-RR-03 | erro | `status === 'error'` | components/MessageInput.jsx:551 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (o padrão, porque a prop `error` não é repassada) | Erro sem "Tentar de novo": `onRetry` não é passado e ConversationView.jsx:269 descarta o `refresh`; o motivo real se perde |
| MSG-RR-04 | sem-permissão | resposta 403 | components/MessageInput.jsx:551 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| MSG-RR-05 | vazio | nenhuma resposta cadastrada | components/MessageInput.jsx:554 | "Nenhuma resposta rápida cadastrada." | — |
| MSG-RR-06 | recarregando | resposta criada ou editada em outra tela | hooks/useQuickReplies.js:7 | AUSENTE (carrega uma vez por token; ninguém chama `refresh`) | (suspeita) A resposta nova só aparece depois de recarregar a página |
| MSG-RR-07 | seleção | item da lista | components/MessageInput.jsx:558-574 | título em negrito + prévia do texto em 1 linha com reticências | — |
| MSG-RR-08 | interação:navegação por teclado | abrir → foco no 1º item; ↑/↓ circulam; Enter escolhe | components/MessageInput.jsx:139-141, :156-165 | (foco visível no item) | — |
| MSG-RR-09 | interação:fechar popover | ESC (devolve o foco ao gatilho), clique fora, abrir Emojis | components/MessageInput.jsx:176-196, :479-480 | — | — |
| MSG-RR-10 | seleção | escolher uma resposta | components/MessageInput.jsx:564-568 | o texto do campo é SUBSTITUÍDO pelo da resposta, o popover fecha e o foco vai ao campo | (suspeita) Apaga o que já estava digitado, sem desfazer |
| MSG-RR-11 | busca-sem-resultado | digitar "/" no campo, ou filtrar | components/MessageInput.jsx:499-504 | AUSENTE: não há atalho "/" nem campo de busca, só o botão e a rolagem (max-h-72) | — |
| MSG-RR-12 | responsivo | tela estreita | components/overlays.css:200; components/MessageInput.jsx:548 | largura 340px (CSS sem camada vence o `w-72`), limitada a 92vw | — |

### Emojis (popover do compositor) — `components/MessageInput.jsx`

Como se chega na tela: botão "Emojis" no compositor.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-EMO-01 | interação:popover aberto | clique no gatilho | components/MessageInput.jsx:528 | "Emojis" · (diálogo não modal com grade 8×7 de 56 emojis; gatilho destacado) | — |
| MSG-EMO-02 | interação:navegação por teclado | abrir → foco no 1º emoji; setas andam na grade (8 por linha) | components/MessageInput.jsx:136-138, :144-154 | — | — |
| MSG-EMO-03 | seleção | clique num emoji | components/MessageInput.jsx:335-338 | o emoji é colado no FIM do texto e o foco volta ao campo; o popover continua aberto | (suspeita) Insere no fim do texto, não na posição do cursor |
| MSG-EMO-04 | interação:fechar popover | ESC, clique fora, abrir Respostas rápidas | components/MessageInput.jsx:181 | — | — |
| MSG-EMO-05 | busca-sem-resultado | procurar emoji | components/MessageInput.jsx:529 | AUSENTE | — |

### Gravação de áudio (dentro do compositor) — `components/MessageInput.jsx`

Como se chega na tela: com o campo vazio e sem anexo, clicar no microfone "Gravar áudio".

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-GRV-01 | interação:pedindo permissão | clique no microfone até o navegador responder | components/MessageInput.jsx:274-277 | AUSENTE: nada muda na tela enquanto o pedido de permissão está aberto | (suspeita) O botão continua clicável: dois cliques criam dois `getUserMedia`, e o primeiro fluxo fica órfão (microfone aceso) |
| MSG-GRV-02 | erro | permissão negada, sem microfone ou navegador sem suporte | components/MessageInput.jsx:299-301 → :607-611 | "Não foi possível acessar o microfone" (role=alert) | A mesma frase serve para as três causas e não ensina a liberar a permissão |
| MSG-GRV-03 | interação:gravando | gravação em curso | components/MessageInput.jsx:441-459 | lixeira "Descartar gravação" + pílula "● Gravando… 12s" (ponto vermelho pulsando) + botão laranja "Parar gravação"; o campo, o clipe, as respostas e os emojis somem | — |
| MSG-GRV-04 | tempo-real | cronômetro da gravação | components/MessageInput.jsx:305 | "Gravando… {recordingSeconds}s" | Sem aria-live; o formato em segundos corridos ("75s") difere do "1:15" da prévia |
| MSG-GRV-05 | interação:descartar gravação | clique na lixeira "Descartar gravação" | components/MessageInput.jsx:443 | (abre a prévia com o áudio gravado) | O rótulo mente: chama `stopRecording`, igual a "Parar", e o áudio NÃO é descartado |
| MSG-GRV-06 | interação:gravação pausada | pausar a gravação | components/MessageInput.jsx:455 | AUSENTE | — |
| MSG-GRV-07 | variante | troca de conversa durante a gravação | components/MessageInput.jsx:239-241, :307-322 | a gravação é encerrada e descartada sem aviso | — |
| MSG-GRV-08 | variante | o componente sai da tela durante a gravação (conversa encerrada ou transferida por socket, `isMine` vira false) | components/MessageInput.jsx:92-104 (não há efeito de limpeza) | (o compositor some) | (suspeita forte) Não há limpeza de MediaRecorder, fluxo e intervalo no unmount: o microfone fica aberto e o timer segue rodando |
| MSG-GRV-09 | variante | popover aberto pelo teclado quando a gravação começa | components/MessageInput.jsx:94-95, :441 | (o popover some durante a gravação e reaparece ao parar) | (suspeita) `showingQuickReplies`/`showingEmojis` não são zerados ao gravar |
| MSG-GRV-10 | responsivo | prefers-reduced-motion | index.css:444-452 | o ponto vermelho para de pulsar | — |

### Prévia da gravação — `components/RecordingPreview.jsx` (+ `recording-preview.css`)

Como se chega na tela: parar uma gravação (MessageInput.jsx:398-401 renderiza quando `!recording && file && fileIsRecording`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-PRV-01 | interação:prévia de áudio | gravação parada | components/RecordingPreview.jsx:49-78 | seção "Prévia da gravação de áudio": ▶, barra de posição, "0:00 / 0:12", lixeira, "Gravar novamente", "Enviar" | — |
| MSG-PRV-02 | variante | pronta, ainda não ouvida | components/RecordingPreview.jsx:56 | "Gravação de áudio · {estado}" · "Pronta para revisar" | — |
| MSG-PRV-03 | interação:tocando | clique em "Ouvir prévia" | components/RecordingPreview.jsx:56 | "Reproduzindo" · "Pausar prévia" | — |
| MSG-PRV-04 | variante | pausada no meio | components/RecordingPreview.jsx:56 | "Pausado" · "Ouvir prévia" | — |
| MSG-PRV-05 | variante | tocou até o fim | components/RecordingPreview.jsx:56 | "Reprodução concluída" | — |
| MSG-PRV-06 | erro | o navegador não toca o blob | components/RecordingPreview.jsx:56 | "Não foi possível ouvir. Tente novamente." | — |
| MSG-PRV-07 | interação:enviando | clique em "Enviar" | components/RecordingPreview.jsx:56 | "Enviando…" | — |
| MSG-PRV-08 | interação:arrastando | arrastar a barra "Posição do áudio" | components/RecordingPreview.jsx:63 | (barra com trecho laranja) · "{clock(position)} / {clock(duration)}" | — |
| MSG-PRV-09 | desabilitado-sem-motivo | duração 0 (gravação de menos de 1 s) | components/RecordingPreview.jsx:64 | (barra desabilitada) · "{clock(position)} / {clock(duration)}" | Nada explica por quê, e a barra nem parece desabilitada: recording-preview.css:11 só esmaece button:disabled e :13 mantém cursor:pointer no range |
| MSG-PRV-10 | interação:regravar | "Gravar novamente" | components/MessageInput.jsx:462 | volta à pílula "Gravando…"; se a permissão falhar, a prévia antiga fica e o erro aparece embaixo | — |
| MSG-PRV-11 | interação:remover | lixeira "Remover gravação" | components/RecordingPreview.jsx:74 | a prévia some e o compositor volta vazio | — |
| MSG-PRV-12 | interação:falha de envio | "Enviar" falha | MessageInput.jsx:351-352, :607-611 | a prévia continua (o arquivo é mantido) e o erro aparece embaixo (role=alert) | — |
| MSG-PRV-13 | variante | compositor durante a prévia | components/MessageInput.jsx:582 | os botões Enviar/microfone do compositor somem; o campo de texto continua visível e editável | Enter no campo (mesmo vazio) envia o áudio; o texto digitado vai como legenda e o servidor recusa (MSG-CMP-10) |
| MSG-PRV-14 | responsivo | contêiner com até 470px | components/recording-preview.css:17 | as ações descem para uma linha própria, alinhadas à direita | — |

### Anexo na bolha (roteador por tipo) — `components/MessageAttachment.jsx`

Como se chega na tela: qualquer mensagem da timeline (ConversationView.jsx:820) ou do histórico do contato (ConversationHistoryModal.jsx:123).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-ANX-01 | variante | `messageType === 'pix'` | components/MessageAttachment.jsx:706-708 | → cartão Pix (MSG-PIX) | — |
| MSG-ANX-02 | variante | `messageType === 'location'` | components/MessageAttachment.jsx:710-733 | → cartão de localização (MSG-LOC) | — |
| MSG-ANX-03 | vazio | a retenção apagou o arquivo (`mediaPath` nulo em image/video/audio/document/sticker) | components/MessageAttachment.jsx:741 | "Arquivo removido (mais de 12 meses)" | — |
| MSG-ANX-04 | carregando | o 1º token de mídia ainda não chegou (`!pronto`) | components/MessageAttachment.jsx:756 | (nada; a bolha mostra só a hora e a legenda) | Esqueleto ausente: a mídia simplesmente não existe até o token chegar |
| MSG-ANX-05 | variante | tipo sem renderizador (text, template, desconhecido) | components/MessageAttachment.jsx:739, :809 | (nada) | — |
| MSG-ANX-06 | variante | contato (vCard) | components/MessageAttachment.jsx:809 | AUSENTE | — |
| MSG-ANX-07 | variante | dentro do histórico do contato | components/ConversationHistoryModal.jsx:123 | (sem foto do contato no áudio e sem o botão de analisar comprovante) | — |
| MSG-ANX-08 | variante | mensagem já montada ganha ou perde `mediaPath` | components/MessageAttachment.jsx:751-752 | — | (suspeita) `useCallback`/`useMediaResourceUrl` são chamados depois de returns condicionais (:706, :710, :738), contra a regra dos hooks: se o dado mudar, o React quebra a timeline ("Rendered more hooks…") |

### Imagem e visualizador — `components/MessageAttachment.jsx` (ImageBubble)

Como se chega na tela: mensagem do tipo imagem → clique na miniatura.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-IMG-01 | variante | miniatura carregada | components/MessageAttachment.jsx:399-414 | imagem de até 330×340 (botão "Abrir imagem em tela cheia"); escurece levemente no hover | — |
| MSG-IMG-02 | carregando | a imagem ainda está baixando | components/MessageAttachment.jsx:407-413 | AUSENTE (sem placeholder: largura mínima 120px e altura 0 até carregar) | Esqueleto ausente. (suspeita) A bolha muda de altura quando a imagem chega e desloca a rolagem |
| MSG-IMG-03 | erro | a miniatura falha (404, rede, token vencido) | components/MessageAttachment.jsx:395 | "Imagem indisponível" | Sem "Tentar de novo"; a miniatura não chama `tentarDeNovo` (só o visualizador chama, em :448), então uma queda de rede ou um token vencido vira "indisponível" para sempre |
| MSG-IMG-04 | variante | imagem com legenda | components/MessageAttachment.jsx:405 (mb-1); ConversationView.jsx:837-845 | margem embaixo; a legenda é renderizada pela bolha | — |
| MSG-IMG-05 | expandido | legenda longa | components/ConversationView.jsx:838 | AUSENTE | — |
| MSG-IMG-06 | interação:visualizador aberto | clique na miniatura | components/MessageAttachment.jsx:415-500 | tela escura, diálogo modal "Visualizar imagem" (portal, Tab preso, foco no "✕") | — |
| MSG-IMG-07 | interação:fechar visualizador | "✕" ("Fechar imagem"), ESC (pilha de diálogos) ou clique no fundo | components/MessageAttachment.jsx:436-443, :328, :423-431 | (o foco volta à miniatura) | — |
| MSG-IMG-08 | interação:zoom | botões +/−, roda do mouse, teclas + = − 0, duplo clique (2× ou volta) | components/MessageAttachment.jsx:475 | "−" · "{percentual}%" · "+" | O percentual não tem aria-live. (suspeita) O cursor mostra "zoom-in" em 100%, mas um clique simples não amplia (só o duplo clique) |
| MSG-IMG-09 | desabilitado-com-motivo | zoom no limite | components/MessageAttachment.jsx:472 | "−" · "{percentual}%" · "+" | — |
| MSG-IMG-10 | interação:arrastando | arrastar com zoom acima de 100% | components/MessageAttachment.jsx:452-457, :371-390, :460 | cursor "grab"; a imagem segue o mouse; soltar fora da imagem não fecha | Só funciona com mouse: não há pan por toque nem por teclado (setas), então no celular e no teclado a imagem ampliada fica presa no centro |
| MSG-IMG-11 | interação:ajustar | "Ajustar" | components/MessageAttachment.jsx:481-487 | volta a 100% e recentraliza | — |
| MSG-IMG-12 | interação:baixar | "Baixar" | components/MessageAttachment.jsx:488-496, :299-305 | link com o token renovado no instante do clique | (suspeita) A API fica em outra origem (onrender.com) e a imagem não tem Content-Disposition (media.routes.js:27): o navegador ignora o `download` e a aba navega para a imagem crua, saindo do app |
| MSG-IMG-13 | erro | a imagem falha dentro do visualizador | components/MessageAttachment.jsx:448 | 1ª falha: refaz a URL com o token novo; 2ª: fecha o visualizador e a miniatura vira "Imagem indisponível" | — |
| MSG-IMG-14 | responsivo | viewport abaixo de ~320px | components/MessageAttachment.jsx:465-470 | a barra de zoom quebra em duas linhas | — |
| MSG-IMG-15 | interação:rodar | girar a imagem | components/MessageAttachment.jsx:465 | AUSENTE | — |
| MSG-IMG-16 | interação:galeria | ir para a imagem anterior ou a próxima | components/MessageAttachment.jsx:416 | AUSENTE | — |

### Análise de comprovante (na bolha da imagem) — `components/MessageAttachment.jsx` (ReceiptAnalysis)

Como se chega na tela: imagem RECEBIDA numa conversa minha (`onAnalyzeReceipt` só vem com `isMine`, ConversationView.jsx:823).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-CPV-01 | variante | imagem recebida + conversa minha (as enviadas nunca mostram) | components/MessageAttachment.jsx:772-774, :677-685 | botão "Analisar comprovante" | — |
| MSG-CPV-02 | carregando | clique | components/MessageAttachment.jsx:680-683 | "Analisando…" (botão desabilitado) | — |
| MSG-CPV-03 | erro | falha na chamada | components/MessageAttachment.jsx:686 | tradução do servidor ou "Não foi possível analisar o comprovante." (o botão volta e dá para tentar de novo) | Sem role="alert" |
| MSG-CPV-04 | sucesso | o comprovante confere | components/MessageAttachment.jsx:687 (texto em utils/receiptVerdict.js:39) | "O comprovante confere." + "Valor: R$ …", "Data: dd/mm/aaaa", "Tipo: …" (verde) | Resultado sem role="status" |
| MSG-CPV-05 | variante | o comprovante já foi usado | utils/receiptVerdict.js:35 → :688 | "Atenção: este comprovante já foi usado antes." (amarelo) | Sem role="status" |
| MSG-CPV-06 | variante | não confere | utils/receiptVerdict.js:40 → :688 | "O comprovante não confere." + motivos (vermelho) | Sem role="status" |
| MSG-CPV-07 | erro | o servidor responde que não analisou | utils/receiptVerdict.js:23-24 → :688 | `r.motivo` do servidor ou "Não foi possível analisar o comprovante." | (suspeita) `motivo` vai para a tela sem tradução |
| MSG-CPV-08 | variante | depois do resultado | components/MessageAttachment.jsx:676 | (o botão de analisar some e fica só o veredito) | Quando o servidor responde analisado=false (ex.: Não foi possível ler a imagem agora, src/ai/receipt-analysis.js:71), o veredito é de erro (utils/receiptVerdict.js:23-24), mas o estado vira done (:661) e o botão some (:676): falha passageira sem Tentar de novo |

### Áudio (nota de voz) — `components/MessageAttachment.jsx` (VoiceNote)

Como se chega na tela: mensagem do tipo áudio.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-AUD-01 | variante | parado | components/MessageAttachment.jsx:137-207 | ▶ ("Reproduzir áudio") + onda de 38 barras + duração "0:12" | — |
| MSG-AUD-02 | carregando | metadados ainda não lidos | components/MessageAttachment.jsx:81, :195 | "0:00" | (suspeita) Nada indica carregamento: "0:00" parece duração real |
| MSG-AUD-03 | interação:tocando | clique em ▶ | components/MessageAttachment.jsx:98-109, :143-147, :169-174 | ⏸ ("Pausar áudio"); as barras tocadas mudam de cor; a bolinha de posição aparece | — |
| MSG-AUD-04 | tempo-real | posição avança (`timeupdate`) | components/MessageAttachment.jsx:80, :195 | "0:05" | — |
| MSG-AUD-05 | variante | pausado no meio (`current > 0`) | components/MessageAttachment.jsx:195-205 | o tempo para; o botão "1x" continua visível | — |
| MSG-AUD-06 | interação:velocidade | clique no chip de velocidade | components/MessageAttachment.jsx:196-205 | "1x" → "1.5x" → "2x" (aria "Velocidade de reprodução: 1.5x") | — |
| MSG-AUD-07 | variante | tocou até o fim | components/MessageAttachment.jsx:82-85 | volta a 0, mostra a duração total e o chip de velocidade some | — |
| MSG-AUD-08 | interação:avançar no áudio | clique na onda | components/MessageAttachment.jsx:150-175, :22-27 | (botão "Avançar no áudio") | Pelo teclado o botão recebe o foco mas não faz nada (o clique sintético é ignorado): não existe forma de avançar pelo teclado |
| MSG-AUD-09 | erro | o arquivo falha, ou `play()` é rejeitado | components/MessageAttachment.jsx:130 | "Áudio indisponível" | Sem Tentar de novo; quando o play() é rejeitado (:103) cai direto em indisponível, sem refazer a URL. (suspeita) Pausar antes de o play() resolver rejeita a promessa com AbortError e também derruba o áudio para indisponível |
| MSG-AUD-10 | variante | direção e avatar | components/MessageAttachment.jsx:177-192 | recebido: foto do contato com selo de microfone (laranja, apagado depois de tocar); enviado: círculo com microfone | — |
| MSG-AUD-11 | variante | tema claro (`dark=false`) | components/MessageAttachment.jsx:211-278 | versão clara, com a bolinha sempre visível | — (não é usada em produção: os dois chamadores passam `dark`) |

### Transcrição do áudio — `components/MessageAttachment.jsx` (TranscriptionBlock)

Como se chega na tela: áudio recebido com transcrição ligada. Atualiza por socket `message:transcription` (hooks/useConversationMessages.js:130-142).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-TRN-01 | variante | sem status (transcrição desligada) | components/MessageAttachment.jsx:626 | (nada) | — |
| MSG-TRN-02 | carregando | `pending` ou `processing` | components/MessageAttachment.jsx:631-633 | "Transcrevendo…" (itálico) | Sem role="status"/aria-live: a troca para o texto, que chega por socket, não é anunciada |
| MSG-TRN-03 | tempo-real | o socket entrega o resultado | components/MessageAttachment.jsx:632 | "Transcrevendo…" vira o texto ou o aviso de falha, sem recarregar | — |
| MSG-TRN-04 | erro | `failed` ou `skipped` | components/MessageAttachment.jsx:637-639 | "Não foi possível transcrever este áudio." | — (o atendente ainda pode ouvir; não há como pedir a transcrição de novo) |
| MSG-TRN-05 | sucesso | transcrição pronta | components/MessageAttachment.jsx:641 | "Transcrição por IA" · "{transcricao}" | — |
| MSG-TRN-06 | expandido | transcrição longa | components/MessageAttachment.jsx:643 | AUSENTE | — |
| MSG-TRN-07 | variante | status desconhecido, ou pronto com texto vazio | components/MessageAttachment.jsx:640-645 | caixa com o rótulo e o corpo vazio | (suspeita) Qualquer status fora dos quatro conhecidos cai no ramo de sucesso |

### Vídeo — `components/MessageAttachment.jsx` (VideoCard)

Como se chega na tela: mensagem do tipo vídeo.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-VID-01 | variante | vídeo disponível | components/MessageAttachment.jsx:562-578 | player nativo (até 340px de altura) + nome do arquivo truncado (title = nome completo) | — |
| MSG-VID-02 | carregando | `preload=metadata` | components/MessageAttachment.jsx:564-571 | (quadro preto do player até os metadados chegarem) | — |
| MSG-VID-03 | erro | o vídeo falha | components/MessageAttachment.jsx:549 | "Vídeo indisponível" · "{filename}" | `onFalha` é recebido mas nunca chamado: um token vencido vira "indisponível" sem a nova tentativa que o áudio e a imagem fazem; sem "Tentar de novo" |
| MSG-VID-04 | variante | moldura: tema escuro, enviado, recebido | components/MessageAttachment.jsx:541-545 | — | — |

### Documento — `components/MessageAttachment.jsx` (DocumentCard)

Como se chega na tela: mensagem do tipo documento.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-DOC-01 | variante | documento | components/MessageAttachment.jsx:587-621 | ícone de folha com o selo da extensão + nome + "PDF" + ícone de baixar; o fundo clareia no hover | — |
| MSG-DOC-02 | variante | cor por extensão | components/MessageAttachment.jsx:55-66, :605 | PDF vermelho, DOC/DOCX azul, XLS/XLSX/CSV verde, PPT/PPTX laranja, ZIP/RAR marrom, as outras cinza | — |
| MSG-DOC-03 | variante | sem nome de arquivo | components/MessageAttachment.jsx:583-584 | "Documento" / "ARQUIVO" | — |
| MSG-DOC-04 | erro | o arquivo sumiu, ou 403 em conversa silenciosa | components/MessageAttachment.jsx:588 (texto em utils/errorMessages.js:57) | AUSENTE na bolha: abre uma nova aba com o JSON `{"error":"Media not found"}` | (suspeita) Texto técnico cru (JSON em inglês) para o usuário |
| MSG-DOC-05 | variante | tamanho do arquivo | components/MessageAttachment.jsx:535-537 | AUSENTE (de propósito: o banco não guarda o tamanho) | — |

### Figurinha — `components/MessageAttachment.jsx`

Como se chega na tela: mensagem do tipo sticker.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-STK-01 | variante | figurinha | components/MessageAttachment.jsx:779-789 | imagem 128×128 sem moldura (alt = nome do arquivo ou "Figurinha") | — |
| MSG-STK-02 | erro | a figurinha falha | components/MessageAttachment.jsx:785 | 1ª falha: refaz a URL; 2ª: ícone de imagem quebrada do navegador | Sem estado "indisponível" (imagem, vídeo e áudio têm): inconsistente |
| MSG-STK-03 | carregando | baixando | components/MessageAttachment.jsx:781-788 | AUSENTE (um quadro vazio de 128×128) | — |

### Localização — `components/MessageAttachment.jsx`

Como se chega na tela: mensagem do tipo localização.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-LOC-01 | variante | localização | components/MessageAttachment.jsx:712-731 | mapa ilustrativo (não é o mapa real) com pino vermelho + "Ver localização no mapa" (abre o Google Maps em nova aba) | — |
| MSG-LOC-02 | variante | tema escuro ou claro | components/MessageAttachment.jsx:717, :725, :727 | — | — |
| MSG-LOC-03 | erro | latitude/longitude ausentes | components/MessageAttachment.jsx:711 | o link vira `?q=null,null` | (suspeita) Sem validação e sem estado de erro |
| MSG-LOC-04 | variante | nome ou endereço do local | components/MessageAttachment.jsx:725 | AUSENTE | — |

### Cartão Pix — `components/PixCardMessage.jsx`

Como se chega na tela: o atendente envia Pix pelo painel do SGP; a bolha enviada é `messageType 'pix'`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-PIX-01 | variante | cartão entregue | components/PixCardMessage.jsx:52-66 | "Pix da fatura" · "Vence 10/10/2026 · R$ 99,90" · código curto · "Cartão com botão Copiar código Pix" | — |
| MSG-PIX-02 | variante | caiu para texto (`fallbackTextoEnviado`) | components/PixCardMessage.jsx:48-49, :55, :65 | "Pix enviado como texto" + rodapé laranja com o motivo | — |
| MSG-PIX-03 | variante | motivo `codigo_sem_chave` | components/PixCardMessage.jsx:27-28 | "O código Pix deste boleto não traz a chave do recebedor, que o WhatsApp oficial exige no cartão: o cliente recebeu o código em texto." | — |
| MSG-PIX-04 | variante | motivo `cartao_recusado` | components/PixCardMessage.jsx:29 | "O WhatsApp oficial recusou o cartão: o cliente recebeu o código em texto." | — |
| MSG-PIX-05 | variante | motivo `cartao_nao_entregue` | components/PixCardMessage.jsx:30 | "O cartão não chegou ao cliente: o código foi reenviado em texto." | — |
| MSG-PIX-06 | variante | motivo desconhecido ou ausente | components/PixCardMessage.jsx:32 | "O cliente recebeu o código em texto." | — |
| MSG-PIX-07 | variante | só vencimento, só valor, ou nenhum dos dois | components/PixCardMessage.jsx:58 | "Vence {vencimento}" · "{valor}" | (suspeita) Valor `null` vira "R$ 0,00" (`Number(null)` é 0, :16-17) |
| MSG-PIX-08 | variante | código Pix | components/PixCardMessage.jsx:37-41, :64 | os 18 primeiros caracteres + "…" | — |
| MSG-PIX-09 | variante | Pix no histórico do contato | ConversationHistoryModal.jsx:122-123 | o código Pix INTEIRO em texto + o cartão embaixo | Contradiz a regra de nunca mostrar o código inteiro: ConversationView.jsx:756 filtra o texto do Pix, o histórico não |

### Token de mídia e URL congelada — `contexts/MediaTokenContext.jsx`, `hooks/useMediaResourceUrl.js`

Como se chega na tela: todo anexo e todo avatar depende disso (efeito indireto na bolha).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| MSG-TOK-01 | carregando | antes do 1º token (`pronto` false) | contexts/MediaTokenContext.jsx:35; components/MessageAttachment.jsx:756 | (nenhuma mídia aparece) | Esqueleto ausente (o mesmo de MSG-ANX-04) |
| MSG-TOK-02 | erro | falha ao buscar o token | contexts/MediaTokenContext.jsx:58-63 | (nada; tenta de novo a cada 1 minuto, em silêncio) | Erro silencioso: sem token inicial, as mídias ficam em branco sem aviso e sem "Tentar de novo" |
| MSG-TOK-03 | tempo-real | renovação a cada 25 min | contexts/MediaTokenContext.jsx:47-57; hooks/useMediaResourceUrl.js:16-37 | (invisível: as URLs montadas não mudam, nada recarrega nem reinicia) | — |
| MSG-TOK-04 | erro | um elemento falha com a URL vencida | hooks/useMediaResourceUrl.js:39-44 | (refaz a URL UMA vez com o token atual) | Só o áudio, o visualizador de imagem e a figurinha usam; a miniatura de imagem e o vídeo não (MSG-IMG-03, MSG-VID-03) |
| MSG-TOK-05 | variante | link aberto muito tempo depois de montado | components/MessageAttachment.jsx:299-305 | (o href é trocado no pointerdown/focus do "Baixar" e do documento) | — |

#### Referências cruzadas (estados de outra parte que tocam o compositor — NÃO contados aqui)
- `ConversationView.jsx:883`: o compositor só existe com `isMine`; fora disso não há compositor desabilitado nem aviso no lugar dele (ver a parte da conversa).
- `ConversationView.jsx:894-912`: aviso "Janela de 24h fechada." + link "Enviar template". Não bloqueia o compositor.
- `ConversationView.jsx:917-941`: aviso "Não foi possível conferir a janela de 24h." (+ "Enviar template" se já houve recusa).
- `ConversationView.jsx:866-875`: botão "Responder" (chevron) que aparece só no hover/foco da bolha e dispara MSG-CMP-20; só existe para mensagem com texto.
- `ConversationView.jsx:806-818`: citação dentro da bolha ("Você"/nome + trecho ou "Mídia").
- `ConversationView.jsx:848-854`: "Não entregue: …" na bolha (falha depois do envio, diferente de MSG-CMP-07).
- `ConversationView.jsx:885-890`: AiSuggestionCard ("Editar" → MSG-CMP-22).

### Sugestão da IA — `components/AiSuggestionCard.jsx` + `hooks/useAiSuggestion.js`

Como se chega na tela: conversa minha com sugestão pendente (GET ao abrir ou socket `ai:suggestion`). Montado em ConversationView.jsx:885.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-IA-01 | variante | sem sugestão | components/AiSuggestionCard.jsx:39 | (nada) | — |
| CV-IA-02 | tempo-real | sugestão chega por socket | hooks/useAiSuggestion.js:25-35 | (cartão aparece acima do compositor) | sem anúncio (sem aria-live) (suspeita) |
| CV-IA-03 | variante | cartão | components/AiSuggestionCard.jsx:43-44, :62 | "Sugestão da IA" + texto | — |
| CV-IA-04 | variante | ações sensíveis já executadas | components/AiSuggestionCard.jsx:46 | "⚠ {rótulo}" · "Atendimento transferido de setor" · "Motivo do atendimento registrado" · "Segunda via de boleto gerada" · "Código PIX gerado" · "Liberação em confiança executada no SGP" | executada fora do catálogo é filtrada e some (ex.: encerrar_atendimento) (suspeita) |
| CV-IA-05 | variante | ações propostas e bloqueadas | components/AiSuggestionCard.jsx:52-61 | "A IA propôs e NÃO executou — depende de você:" + "• Liberar em confiança no SGP" etc. | — |
| CV-IA-06 | variante | proposta sem rótulo no catálogo | components/AiSuggestionCard.jsx:35, :57 | "• Ação proposta: {nome_da_ferramenta}" | nome técnico cru (fallback intencional) |
| CV-IA-07 | interação:enviando | Enviar | components/AiSuggestionCard.jsx:67 | "Enviar" | sem estado de envio: o cartão some antes da resposta (otimista) |
| CV-IA-08 | erro | falha ao enviar | components/ConversationView.jsx:534 (render :993) | Aviso: "Não foi possível enviar a sugestão da IA." | a sugestão já sumiu e não volta (só trocando de conversa/F5) |
| CV-IA-09 | interação:editando | Editar → texto no compositor, cartão some | components/AiSuggestionCard.jsx:68; components/ConversationView.jsx:538-541, :949-950 | (texto no campo) | — |
| CV-IA-10 | erro | envio da sugestão editada falha | components/MessageInput.jsx:621 | (erro sobe ao MessageInput — C2) | o vínculo com a sugestão é limpo antes do envio: a nova tentativa sai como mensagem comum (suspeita) |
| CV-IA-11 | variante | sugestão editada + anexo: descarta a sugestão em silêncio | components/ConversationView.jsx:456-465 | — | falha no descarte engolida (intencional) |
| CV-IA-12 | interação:descartando | Descartar | components/AiSuggestionCard.jsx:69 | "Descartar" | — |
| CV-IA-13 | erro | falha ao descartar | components/ConversationView.jsx:547 (render :993) | Aviso: "Não foi possível descartar a sugestão da IA." | — |
| CV-IA-14 | erro | falha no GET da sugestão | hooks/useAiSuggestion.js:19 | (nada) | erro silencioso (catch vira "sem sugestão") |
| CV-IA-15 | variante | mesa: grade compacta; modal: cartão claro | pages/dashboard.css:176-182; components/AiSuggestionCard.jsx:43 | — | — |
| CV-IA-16 | responsivo | mesa ≤ 700px: cartão em coluna | pages/dashboard.css:197 | — | — |

### Consulta SGP — `components/SgpLookupPanel.jsx` + `hooks/useSgpLookup.js`

Como se chega na tela: "Consultar SGP" (modal) / "SGP" (mesa), ou abre sozinho (CV-PNL-01). Montado em ConversationView.jsx:994-1005 — o painel não recebe `isMine`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-SGP-01 | expandido | painel aberto | components/SgpLookupPanel.jsx:289-305 | "Consultar SGP" + × (aria "Fechar consulta SGP", title "Fechar") | — |
| CV-SGP-02 | vazio | antes de buscar | components/SgpLookupPanel.jsx:345-349 | "Busque pelo documento para ver o contrato e enviar a fatura direto na conversa." | — |
| CV-SGP-03 | validação | Buscar com campo vazio / sem dígitos | components/SgpLookupPanel.jsx:277-281 | AUSENTE | o envio vazio não faz nada e não avisa |
| CV-SGP-04 | variante | campo de documento | components/SgpLookupPanel.jsx:310-317 | placeholder "CPF ou CNPJ" (aria "CPF do cliente") | rótulo acessível diz só CPF (suspeita) |
| CV-SGP-05 | variante | busca por telefone | components/SgpLookupPanel.jsx:309 | AUSENTE | só documento |
| CV-SGP-06 | carregando | buscando | components/SgpLookupPanel.jsx:328-333 | "Buscando no SGP…" (role=status, spinner) | — |
| CV-SGP-07 | busca-sem-resultado | 404 | components/SgpLookupPanel.jsx:334-338 | "Cliente não encontrado. Confira o documento e busque de novo." (role=status) | — |
| CV-SGP-08 | erro | falha da consulta | components/SgpLookupPanel.jsx:339-343 | "{err.message}" ou "Não foi possível consultar o SGP agora." (role=alert) | `err.message` cru, sem `descreverErro`: inglês do backend ("Failed to reach SGP", "SGP integration is not configured") ou "Request failed with status 502" / "Failed to fetch" |
| CV-SGP-09 | variante | cliente encontrado | components/SgpLookupPanel.jsx:353-355 | "{nome}" / "{documento}" | — |
| CV-SGP-10 | seleção | vários contratos | components/SgpLookupPanel.jsx:357-378 | select "Contrato {id}" | opção só com número, sem endereço/plano (suspeita) |
| CV-SGP-11 | vazio | cliente sem contrato | components/SgpLookupPanel.jsx:357, :400 | AUSENTE | só nome/documento; nada diz que não há contrato |
| CV-SGP-12 | variante | plano | components/SgpLookupPanel.jsx:383 | "{plano}" | — |
| CV-SGP-13 | variante | status do contrato | components/SgpLookupPanel.jsx:57-65, :384 | "Ativo" (verde) / outros (cinza) | "Suspenso"/"Cancelado" sem tom de alerta (suspeita) |
| CV-SGP-14 | variante | telefones/e-mails do contrato | components/SgpLookupPanel.jsx:387-395 | "{telefone}" / "{e-mail}" | — |
| CV-SGP-15 | variante | Financeiro inicial | components/SgpLookupPanel.jsx:130-138 | "Consultar fatura em aberto" | — |
| CV-SGP-16 | carregando | consultando fatura | components/SgpLookupPanel.jsx:140-145 | "Consultando o SGP…" (role=status) | — |
| CV-SGP-17 | erro | falha ao consultar fatura | components/SgpLookupPanel.jsx:147-151 | "{err.message}" / "Não foi possível consultar o SGP agora." (role=alert) | erro sem "Tentar de novo" e sem saída: o botão só volta refazendo a busca do cliente (estado preso por contrato); mensagem crua |
| CV-SGP-18 | vazio | sem fatura em aberto | components/SgpLookupPanel.jsx:153-155 | "Nenhuma fatura em aberto para este contrato." | — |
| CV-SGP-19 | variante | fatura em aberto | components/SgpLookupPanel.jsx:159 | (valor em R$, em destaque) · "vence {vencimento}" · "Em aberto" | só a 1ª de duplicates aparece (:124, duplicates[0], na ordem do SGP); as outras faturas em aberto somem sem aviso |
| CV-SGP-20 | vazio | `hasOpenInvoice` true com `duplicates` vazio | components/SgpLookupPanel.jsx:124, :157 | AUSENTE | nada renderizado (suspeita) |
| CV-SGP-21 | variante | ações conforme os dados da fatura | components/SgpLookupPanel.jsx:171-229 | "Cód Pix" "Enviar QR" "Ver QR" (se Pix) / "Cód Barras" / "Link Fatura" "PDF Fatura" (se boleto) | fatura sem nenhum código: bloco sem ações e sem explicação (suspeita) |
| CV-SGP-22 | interação:enviando | ação em andamento | components/SgpLookupPanel.jsx:73, :83 | (spinner no lugar do ícone; só esse botão desabilitado) | spinner sem texto/aria-busy; as outras ações seguem clicáveis |
| CV-SGP-23 | sucesso | enviado | components/SgpLookupPanel.jsx:83, :232-241 | ✓ no botão + "{Cód Pix \| QR Pix \| Cód Barras \| Link Fatura \| PDF Fatura} enviado para o cliente" (role=status) | — |
| CV-SGP-24 | erro | falha no envio | components/SgpLookupPanel.jsx:118, :232-241 | "Não foi possível enviar. Tente de novo." (role=alert) | genérico: esconde o motivo (403, janela, canal); "Tente de novo" engana quando não adianta |
| CV-SGP-25 | variante | quem não é dono vê os botões de envio | components/ConversationView.jsx:996-1004 | (mesmos botões) | o envio sempre falha com 403 (api/sgp-query.routes.js:47) e cai no erro genérico |
| CV-SGP-26 | interação:prévia QR | "Ver QR" (aria-pressed) | components/SgpLookupPanel.jsx:222-228, :244-251 | QR + "Prévia. Use "Enviar QR" para mandar ao cliente." | — |
| CV-SGP-27 | erro | falha ao gerar o QR local | components/SgpLookupPanel.jsx:107 | AUSENTE | promise sem catch: erro silencioso |
| CV-SGP-28 | variante | desbloqueio em confiança | components/SgpLookupPanel.jsx:384 | AUSENTE | não há botão no painel; só a IA executa (o cartão da IA lista como executada/proposta) |
| CV-SGP-29 | responsivo | ações em 2 colunas → 1 com painel ≤ 268px (container) | pages/dashboard.css:230-231 | — | — |
| CV-SGP-30 | seleção | trocar de contrato guarda o estado da fatura por contrato | components/SgpLookupPanel.jsx:402, :409 | — | — |

### Barra "Equipe" no rodapé da lista — `components/TeamPanel.jsx`

Como se chega na tela: sempre no rodapé da lista (escondida no rail).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-EQP-01 | tempo-real | presença muda (`presence:online/offline`) | components/TeamPanel.jsx:61 | "Equipe" + "{n} online" | — |
| ATD-EQP-02 | variante | ninguém online (na prática ocorre só antes da 1ª carga: o próprio usuário conta como online) | components/TeamPanel.jsx:61 | "Equipe" (sem ficha) | — |
| ATD-EQP-03 | carregando | 1ª carga da lista de atendentes | components/TeamPanel.jsx:50 | AUSENTE na barra | (suspeita, baixo impacto) igual a "ninguém online" |
| ATD-EQP-04 | erro | falha em `listAgents` | components/TeamPanel.jsx:50 | AUSENTE na barra (só dentro do popup) | erro só visível ao abrir o popup |
| ATD-EQP-05 | expandido | clicar abre "Nossa equipe" (e dispara recarga) | components/TeamPanel.jsx:70 | (`aria-expanded="true"` enquanto aberto) | — |
| ATD-EQP-06 | tempo-real | `conversation:assigned`/`closed`, `queue:removed`, `dashboard:conversation` | components/TeamPanel.jsx:34 | (lista de atendentes recarrega em silêncio) | — |
| ATD-EQP-07 | interação:hover | ponteiro sobre a barra | components/TeamPanel.jsx:55 | (fundo de hover) | — |
| ATD-EQP-08 | responsivo | mesa em rail | pages/dashboard.css:257 | (barra some) | — |

### Popup "Nossa equipe" — `components/TeamModal.jsx`

Como se chega na tela: clicar na barra "Equipe".

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-EQM-01 | tempo-real | abertura; presença muda com o popup aberto | components/TeamModal.jsx:112 | "Nossa equipe" · "{N} integrantes na equipe · {K} online agora" | — |
| ATD-EQM-02 | carregando | lista ainda não chegou | components/TeamModal.jsx:171 | (esqueleto 3 linhas) | — |
| ATD-EQM-03 | recarregando | abrir o popup com dados já na tela dispara `refresh` | components/TeamModal.jsx:171 | AUSENTE (`reloading` não é exposto pelo AgentsContext) | recarga invisível; mostra dado antigo sem sinal |
| ATD-EQM-04 | erro | falha em `listAgents` | components/TeamModal.jsx:171 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (role=alert) | erro sem "Tentar de novo" (sem `onRetry`; saída = fechar e reabrir); texto genérico (o `error` do hook não é passado) |
| ATD-EQM-05 | sem-permissão | 403 | components/TeamModal.jsx:171 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role |
| ATD-EQM-06 | vazio | nenhum atendente | components/TeamModal.jsx:171 | "Nenhum atendente cadastrado." | — (praticamente inalcançável: o próprio usuário está na lista) |
| ATD-EQM-07 | filtro-ativo | chips Todos / Online / Offline / Em atendimento, com contagem | components/TeamModal.jsx:137 | "Todos {n}" "Online {n}" "Offline {n}" "Em atendimento {n}" (`aria-pressed`) | — |
| ATD-EQM-08 | filtro-ativo | digitar na busca (ignora acentos) | components/TeamModal.jsx:124 | placeholder "Buscar um integrante da equipe…" | — |
| ATD-EQM-09 | busca-sem-resultado | busca não casa ninguém | components/TeamModal.jsx:173 | "Nenhum integrante encontrado com esse filtro." | mesma frase para busca e filtro ("com esse filtro" quando foi a busca) |
| ATD-EQM-10 | vazio-por-filtro | chip de filtro sem ninguém | components/TeamModal.jsx:173 | "Nenhum integrante encontrado com esse filtro." | — |
| ATD-EQM-11 | vazio-por-filtro | grupo vazio com filtro ≠ Todos (ex.: Online sem ninguém ocupado) | components/TeamModal.jsx:70 | "Nenhum integrante neste grupo." | — |
| ATD-EQM-12 | variante | filtro "Todos": grupo vazio some | components/TeamModal.jsx:104 | (grupo não aparece) | — |
| ATD-EQM-13 | variante | grupo "Em atendimento" | components/TeamModal.jsx:177 | "Em atendimento {n}" · "Já estão com conversas ativas" | — |
| ATD-EQM-14 | variante | grupo "Disponíveis" | components/TeamModal.jsx:182 | "Disponíveis {n}" · "Online e sem atendimentos ativos" | — |
| ATD-EQM-15 | variante | grupo "Offline" | components/TeamModal.jsx:187 | "Offline {n}" · "Não disponíveis no momento" | — |
| ATD-EQM-16 | variante | linha de quem está atendendo | components/TeamModal.jsx:44 | "Online · Em atendimento" | — |
| ATD-EQM-17 | variante | linha de quem está livre | components/TeamModal.jsx:44 | "Online · Disponível para atender" | — |
| ATD-EQM-18 | variante | linha offline | components/TeamModal.jsx:44 | "Última: {lastSeen}" · "sem registro" · (ícone de relógio) | — |
| ATD-EQM-19 | interação:tooltip | ponteiro na linha offline | components/TeamModal.jsx:41 | title "Última atividade: {…}" | — (o mesmo dado já está visível) |
| ATD-EQM-20 | interação:tooltip | ponteiro na bolinha de presença | components/TeamModal.jsx:35 | title "Online" / "Offline" | — |
| ATD-EQM-21 | variante | ficha de carga (laranja se ocupado ou offline com ativos; verde se livre; cinza) | components/TeamModal.jsx:48 | "{active} ativo" · "{active} ativos" · "atendimento ativo" · "atendimentos ativos" | — |
| ATD-EQM-22 | interação:fechar | "×", ESC, clique fora ou "Fechar" | components/TeamModal.jsx:199 | "Fechar" | — |
| ATD-EQM-23 | responsivo | popup estreito | components/TeamModal.jsx:120 | (busca com mínimo de 220px quebra para cima dos chips) | — |

### Modal "Transferir atendimento" — `components/TransferModal.jsx`

Como se chega na tela: botão "Transferir" no cabeçalho da conversa (ConversationView:641) → `DashboardPage` monta o modal (também usado na Supervisão).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-TRF-01 | variante | abertura (foco na busca) | components/TransferModal.jsx:183 | "Transferir atendimento" · "Escolha um atendente para transferir esta conversa." | — |
| ATD-TRF-02 | carregando | lista de atendentes carregando | components/TransferModal.jsx:229 | (esqueleto 3 linhas) | — |
| ATD-TRF-03 | erro | falha em `listAgents` | components/TransferModal.jsx:229 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (role=alert) | erro sem "Tentar de novo"; o modal nunca chama `refresh` — fechar e reabrir não recarrega (só abrir "Equipe" ou um evento de socket) |
| ATD-TRF-04 | sem-permissão | 403 | components/TransferModal.jsx:229 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role |
| ATD-TRF-05 | recarregando | lista recarrega por evento com o modal aberto | components/TransferModal.jsx:229 | AUSENTE | — |
| ATD-TRF-06 | vazio | nenhum outro atendente além do próprio | components/TransferModal.jsx:229 | "Nenhum outro atendente disponível." | — |
| ATD-TRF-07 | filtro-ativo | digitar na busca (nome/e-mail, ignora acentos) | components/TransferModal.jsx:197 | placeholder "Buscar atendente por nome…" | — |
| ATD-TRF-08 | busca-sem-resultado | busca não casa ninguém | components/TransferModal.jsx:252 | "Nenhum atendente encontrado com esse nome." | — |
| ATD-TRF-09 | variante | ordenar "Menor carga" (padrão): agrupa | components/TransferModal.jsx:232 | "DISPONÍVEIS {n}" + "OFFLINE {n}" | — |
| ATD-TRF-10 | variante | ordenar "Nome": lista única alfabética, sem grupos | components/TransferModal.jsx:209 | "Ordenar por" "Nome" | — |
| ATD-TRF-11 | seleção | clicar numa linha (`role=radio`, `aria-checked`) | components/TransferModal.jsx:86 | (fundo realçado + marca preenchida) | — |
| ATD-TRF-12 | variante | carga: online sem atendimentos | components/TransferModal.jsx:100 | "Disponível" · "Atendendo normalmente" (verde) | — |
| ATD-TRF-13 | variante | carga: 1–4 | components/TransferModal.jsx:100 | "Em atendimento" · "Atendendo normalmente" (amarelo) | — |
| ATD-TRF-14 | variante | carga: 5–9 | components/TransferModal.jsx:100 | "Movimentado" · "Alto volume no momento" (laranja) | — |
| ATD-TRF-15 | variante | carga: ≥ 10 | components/TransferModal.jsx:113 | "Carga alta" + pílula "Alta carga de atendimentos" (vermelho) | — |
| ATD-TRF-16 | variante | atendente offline (continua escolhível) | components/TransferModal.jsx:100 | "Offline" · "Não está disponível no momento" | (suspeita) transfere para offline sem nenhum aviso extra |
| ATD-TRF-17 | responsivo | modal abaixo de `sm` | components/TransferModal.jsx:105 | (somem "{n} atendimentos" e a dica; fica só a ficha) | — |
| ATD-TRF-18 | interação:tooltip | ponteiro na bolinha de presença | components/TransferModal.jsx:94 | title "Online" / "Offline" | — |
| ATD-TRF-19 | desabilitado-sem-motivo | ninguém escolhido | components/TransferModal.jsx:271 | "Transferir" (cinza) | nada junto do botão diz que falta escolher |
| ATD-TRF-20 | seleção | escolhido some por causa da busca | components/TransferModal.jsx:166 | botão volta a "Transferir" desabilitado | escolha continua guardada mas invisível; botão cinza sem motivo |
| ATD-TRF-21 | variante | alguém escolhido | components/TransferModal.jsx:275 | "Transferir para {primeiro nome}" | — |
| ATD-TRF-22 | interação:enviando | clicou em "Transferir para…" | components/TransferModal.jsx:271 | (botão cinza, mesmo rótulo; sem spinner nem texto) | enviando sem indicação; linhas, "Cancelar", "×" e ESC seguem ativos |
| ATD-TRF-23 | erro | falha em `transferConversation` | components/TransferModal.jsx:255 | "Não foi possível transferir este atendimento." ou frase traduzida (role=alert) | (suspeita) frase do backend sem tradução chega em inglês |
| ATD-TRF-24 | sucesso | transferência ok | components/TransferModal.jsx:173 | (modal fecha sem mensagem; a conversa sai da aba Atendimento e a mesa volta ao painel vazio) | (suspeita) sucesso sem confirmação visível |
| ATD-TRF-25 | interação:fechar no envio | "Cancelar"/"×"/ESC durante o envio | components/TransferModal.jsx:261 | (modal fecha; a requisição continua) | se falhar depois, o erro se perde (setState em componente desmontado); se der certo, transfere mesmo assim |
| ATD-TRF-26 | interação:fechar | "Cancelar", "×" ou ESC (clique fora NÃO fecha) | components/TransferModal.jsx:261 | "Cancelar" · nota "A transferência será registrada no histórico da conversa." | — |

### Modal "Encerrar atendimento" (motivo) — `components/CloseReasonModal.jsx` + `components/closeReasonCatalog.jsx`

Como se chega na tela: botão "Encerrar" no cabeçalho da conversa (ConversationView:651); montado em ConversationView:980. Remonta do zero a cada abertura.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-ENC-01 | variante | abertura | components/CloseReasonModal.jsx:72 | "Encerrar atendimento" · "Selecione o motivo principal deste atendimento." (ícone vermelho) | — |
| ATD-ENC-02 | carregando | motivos carregando | components/CloseReasonModal.jsx:83 | (esqueleto 3 linhas) | — |
| ATD-ENC-03 | erro | falha em `listReasons` | components/CloseReasonModal.jsx:83 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (role=alert) | erro sem "Tentar de novo" (`refresh` existe no hook e não é passado); texto genérico; saída = fechar e reabrir |
| ATD-ENC-04 | sem-permissão | 403 | components/CloseReasonModal.jsx:83 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role |
| ATD-ENC-05 | vazio | nenhum motivo cadastrado | components/CloseReasonModal.jsx:86 | "Nenhum motivo de contato cadastrado ainda. Peça a um administrador para cadastrar ao menos um motivo em Configurações → Motivos antes de encerrar este atendimento." | (suspeita) caminho desatualizado: o menu é "Cadastros auxiliares → Motivos de atendimento"; sem role |
| ATD-ENC-06 | seleção | escolher um cartão (rádio nativo) | components/CloseReasonModal.jsx:15 | (borda laranja + rádio preenchido) | — |
| ATD-ENC-07 | interação:hover | ponteiro sobre cartão não marcado | components/CloseReasonModal.jsx:15 | (borda mais forte) | — |
| ATD-ENC-08 | variante | a IA sugeriu um motivo | components/CloseReasonModal.jsx:94 | (cartão já vem marcado; foco nele) | — |
| ATD-ENC-09 | variante | sugestão da IA aponta motivo que não está na lista (desativado/apagado) | components/CloseReasonModal.jsx:55 | (nenhum cartão marcado, mas "Encerrar atendimento" habilitado) | (suspeita) envia um motivo invisível; backend responde "Esse motivo de contato não existe mais ou foi desativado." |
| ATD-ENC-10 | variante | nome do motivo casa com o catálogo (9 entradas + apelidos) | components/closeReasonCatalog.jsx:156 | ícone + cor + legenda (ex.: "Boletos, pagamentos, faturas") | — |
| ATD-ENC-11 | variante | nome fora do catálogo | components/closeReasonCatalog.jsx:160 | (ícone de etiqueta neutro, sem legenda) | — |
| ATD-ENC-12 | responsivo | modal ≥ `md` | components/CloseReasonModal.jsx:88 | (cartões em 2 colunas; abaixo, 1) | — |
| ATD-ENC-13 | desabilitado-sem-motivo | nenhum motivo marcado | components/CloseReasonModal.jsx:116 | "Encerrar atendimento" (cinza) | nada junto do botão diz o que falta |
| ATD-ENC-14 | interação:enviando | clicou "Encerrar atendimento" | components/CloseReasonModal.jsx:116 | (botão cinza, mesmo rótulo) | enviando sem indicação; "Cancelar", "×" e ESC seguem ativos |
| ATD-ENC-15 | erro | falha em `closeConversation` | components/CloseReasonModal.jsx:100 | "Não foi possível encerrar este atendimento." ou frase traduzida (role=alert) | (suspeita) frase do backend sem tradução chega em inglês |
| ATD-ENC-16 | sucesso | encerramento ok | components/ConversationView.jsx:527 | (modal fecha; `conversation:closed` tira a conversa de "Atendimento"; volta o painel vazio) | (suspeita) sem confirmação visível |
| ATD-ENC-17 | interação:fechar no envio | "Cancelar"/"×"/ESC durante o envio | components/CloseReasonModal.jsx:106 | (modal fecha; a requisição continua) | se falhar, erro perdido; se der certo, encerra mesmo assim |
| ATD-ENC-18 | interação:fechar | "Cancelar", "×" ou ESC (clique fora NÃO fecha) | components/CloseReasonModal.jsx:106 | "Cancelar" · nota "O cliente recebe a mensagem de encerramento e o motivo alimenta o Relatório." | — |

> Deduplicado: a parte C1 também auditou este modal (ids CV-ENC-01…14, descartados). O único ponto que só ela registrou: com o motivo pré-marcado pela IA, **nada na tela diz que foi a IA** que escolheu.


### Modal "Iniciar conversa" — `components/StartConversationModal.jsx`

Como se chega na tela: botão "Nova" no cabeçalho da lista (escondido no rail).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-INI-01 | variante | abertura | components/StartConversationModal.jsx:116 | "Iniciar conversa" (sem descrição) | — |
| ATD-INI-02 | carregando | canais carregando | components/StartConversationModal.jsx:125 | "Carregando canais…" (role=status) + rodapé "Aguarde a lista de canais." | (suspeita) duas regiões role=status anunciando juntas |
| ATD-INI-03 | erro | falha em `listChannelsForAgent` | components/StartConversationModal.jsx:127 | "Não foi possível carregar os canais. Feche e tente novamente." | sem "Tentar de novo" (manda fechar e reabrir); detalhe do erro descartado |
| ATD-INI-04 | vazio | nenhum canal elegível | components/StartConversationModal.jsx:129 | "Nenhum canal conectado no momento." + rodapé "Nenhum canal disponível para iniciar." | — |
| ATD-INI-05 | variante | quais canais entram: Baileys só se conectado; oficial sempre | components/StartConversationModal.jsx:40 | (Baileys desconectado some da lista sem aviso) | — |
| ATD-INI-06 | seleção | escolher canal | components/StartConversationModal.jsx:131 | "Canal" (select; 1º já vem escolhido) | — |
| ATD-INI-07 | seleção | escolher país | components/StartConversationModal.jsx:154 | "País" — "Brasil (+55)" … "Espanha (+34)" | — |
| ATD-INI-08 | variante | campo telefone + ajuda | components/StartConversationModal.jsx:173 | "Digite com DDD. Com ou sem o 9, o sistema confere no WhatsApp qual forma existe." | — |
| ATD-INI-09 | interação:digitando | há dígitos no telefone | components/StartConversationModal.jsx:174 | "Número completo: {ddi}{phoneDigits}" | — |
| ATD-INI-10 | validação | enviar com menos de 8 dígitos | components/StartConversationModal.jsx:176 | "Informe o telefone com DDD." (role=alert, `aria-invalid`) | não some ao corrigir o campo (só no próximo envio); (suspeita) 8 dígitos sem DDD passam |
| ATD-INI-11 | responsivo | espaço do diálogo ≤ 330px (`@container`) / ≥ `sm` | components/overlays.css:129 | (País e Telefone empilham; Canal ao lado do telefone só ≥ sm) | — |
| ATD-INI-12 | variante | canal oficial (Meta Cloud / 360dialog) | components/StartConversationModal.jsx:183 | "Template de abertura" + "Este canal requer o uso de template para iniciar o atendimento!" | — |
| ATD-INI-13 | carregando | templates do canal oficial carregando | components/StartConversationModal.jsx:191 | AUSENTE — mostra "Nenhum template aprovado para este canal." + rodapé "Este canal precisa de um template aprovado para iniciar." | afirma que não há template enquanto ainda carrega |
| ATD-INI-14 | erro | falha em `listTemplatesForChannel` | components/StartConversationModal.jsx:75 | AUSENTE (promise sem `.catch`) → "Nenhum template aprovado para este canal." | erro silencioso disfarçado de "nenhum template" |
| ATD-INI-15 | vazio | canal oficial sem template de atendimento aprovado | components/StartConversationModal.jsx:191 | "Nenhum template aprovado para este canal." | — |
| ATD-INI-16 | seleção | escolher template | components/StartConversationModal.jsx:197 | "Template" (select; 1º já vem escolhido) | — |
| ATD-INI-17 | variante | template com botões de resposta | components/StartConversationModal.jsx:219 | (fichas com o texto dos botões) + "O cliente responde com um toque no botão — e é essa resposta que abre a conversa para você escrever." | — |
| ATD-INI-18 | variante | template sem botões | components/StartConversationModal.jsx:227 | "Este template não tem botões: a conversa só continua depois que o cliente responder." | — |
| ATD-INI-19 | validação | template com variáveis vazias | components/StartConversationModal.jsx:236 | "Variável {index + 1}" · (balão nativo do navegador) | inconsistente com o erro do telefone (texto do navegador, fora do padrão WaError) |
| ATD-INI-20 | variante | canal Baileys | components/StartConversationModal.jsx:244 | "Mensagem inicial" · "Mensagem" (textarea) | — |
| ATD-INI-21 | validação | Baileys com mensagem vazia | components/StartConversationModal.jsx:252 | (balão nativo do navegador por `required`) | idem ATD-INI-19 |
| ATD-INI-22 | desabilitado-com-motivo | "Iniciar conversa" bloqueado | components/StartConversationModal.jsx:266 | motivo no rodapé (role=status): "Aguarde a lista de canais." / "Falha no carregamento impede iniciar." / "Nenhum canal disponível para iniciar." / "Este canal precisa de um template aprovado para iniciar." | — |
| ATD-INI-23 | interação:enviando | enviou o formulário | components/StartConversationModal.jsx:266 | "Iniciando conversa…" (rodapé, cor de aviso) + botão cinza | "Cancelar", "×" e ESC seguem ativos; cor de aviso para estado normal |
| ATD-INI-24 | erro | falha em `startConversation` | components/StartConversationModal.jsx:257 | "Falha ao iniciar conversa" ou traduzida (ex.: "Este número não tem WhatsApp.", "Já existe um atendimento aberto com este cliente neste canal.") (role=alert) | (suspeita) frase do backend sem tradução chega em inglês |
| ATD-INI-25 | sucesso | conversa criada | pages/DashboardPage.jsx:319 | (modal fecha; conversa abre no painel) | — |
| ATD-INI-26 | interação:fechar no envio | "Cancelar"/"×"/ESC durante o envio | components/StartConversationModal.jsx:268 | (modal fecha; a requisição continua) | se der certo, a conversa ABRE mesmo o atendente tendo cancelado (`onCreated` ainda roda); se falhar, erro perdido |
| ATD-INI-27 | variante | trocar de um canal oficial para outro | components/StartConversationModal.jsx:69 | (templates do canal anterior ficam até a nova resposta) | (suspeita) sem cancelamento: resposta antiga pode sobrescrever a nova |
| ATD-INI-28 | interação:fechar | "Cancelar", "×" ou ESC (clique fora NÃO fecha) | components/StartConversationModal.jsx:268 | "Cancelar" | — |

### Modal "Atendimentos anteriores" — `components/ConversationHistoryModal.jsx`

Como se chega na tela: ícone "Ver atendimentos anteriores" (CV:617 / :668).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-HIS-01 | carregando | 1ª carga | components/ConversationHistoryModal.jsx:136 | (esqueleto do AsyncState) | o subtítulo já diz "0 atendimentos encerrados" durante a carga (:93) |
| CV-HIS-02 | sem-permissão | 403 | components/ConversationHistoryModal.jsx:136 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CV-HIS-03 | erro | falha | components/ConversationHistoryModal.jsx:136 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." (role=alert) | AsyncState sem `onRetry`: erro sem "Tentar de novo"; subtítulo segue "0 atendimentos encerrados" |
| CV-HIS-04 | vazio | nenhum encerrado | components/ConversationHistoryModal.jsx:136 | "Nenhum atendimento anterior encontrado." | — |
| CV-HIS-05 | variante | contagem no subtítulo | components/ConversationHistoryModal.jsx:96 | "{n} atendimento encerrado" · "{n} atendimentos encerrados" | — |
| CV-HIS-06 | variante | item da lista | components/ConversationHistoryModal.jsx:140-155 | dia/mês + "{motivo}" ou "Sem motivo registrado" + "dd/mm/aaaa · hh:mm · {atendente} · {canal} · Finalizado" | — |
| CV-HIS-07 | variante | quem atendeu ≠ quem encerrou | components/ConversationHistoryModal.jsx:16 | "Atendido por {atendeu}, encerrado por {encerrou}" · "Encerrado por {encerrou}" | — |
| CV-HIS-08 | variante | data ausente/ilegível | components/ConversationHistoryModal.jsx:22, :48 | "--" / "Início não informado" | — |
| CV-HIS-09 | interação:detalhe | clicar num item (título e subtítulo mudam) | components/ConversationHistoryModal.jsx:96 | "{motivo \| Atendimento} · {data}" / "{quem} · {canal}" | — |
| CV-HIS-10 | carregando | mensagens do detalhe | components/ConversationHistoryModal.jsx:73-77 | AUSENTE | sem indicador; e as mensagens do atendimento visto ANTES ficam na tela até a nova resposta (`setMessages` não zera) |
| CV-HIS-11 | erro | falha nas mensagens do detalhe | components/ConversationHistoryModal.jsx:77 | AUSENTE | catch vazio: erro silencioso (área em branco ou com o atendimento anterior) |
| CV-HIS-12 | vazio | detalhe sem mensagens | components/ConversationHistoryModal.jsx:111-132 | AUSENTE | área em branco |
| CV-HIS-13 | variante | resumo do detalhe | components/ConversationHistoryModal.jsx:105-110 | "Responsável" / "Status" / "Encerrado por" (se diferente) / "Motivo" — "Não informado" | — |
| CV-HIS-14 | variante | bolhas do detalhe | components/ConversationHistoryModal.jsx:112-131 | (entrada/saída, anexo, hora) | sem separador de dia, "Não entregue", citação nem selo IA; Pix mostra o código como texto solto além do cartão (falta a regra de ConversationView.jsx:756) (suspeita) |
| CV-HIS-15 | interação:voltar | "Atendimentos anteriores" (foco vai para ele) | components/ConversationHistoryModal.jsx:100-103 | "Atendimentos anteriores" (aria "Voltar para atendimentos anteriores") | — |
| CV-HIS-16 | variante | rodapé | components/ConversationHistoryModal.jsx:162-169 | "Somente leitura." + "Fechar" | — |
| CV-HIS-17 | variante | fecha por clique no fundo | components/ConversationHistoryModal.jsx:96 | — | — |
| CV-HIS-18 | responsivo | ≤ 680px resumo e registro em 1 coluna | components/overlays.css:207 | — | — |

### Modal "Editar cliente" — `components/EditContactModal.jsx` (+ `hooks/useCities.js` → `usePlaces`)

Como se chega na tela: clique no nome/avatar do cabeçalho (CV-CAB-03).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-EDC-01 | variante | título | components/EditContactModal.jsx:71 | "Editar cliente" | — |
| CV-EDC-02 | carregando | municípios carregando | components/EditContactModal.jsx:94, :96 | select desabilitado com "Carregando…" | — |
| CV-EDC-03 | erro | falha ao carregar municípios | components/EditContactModal.jsx:68, :96 | AUSENTE | erro silencioso: o select mostra só "Nenhum" (usePlaces tem `refresh`, não usado) |
| CV-EDC-04 | desabilitado-sem-motivo | Localidade sem município | components/EditContactModal.jsx:113 | select "Nenhuma" desabilitado | nada diz "escolha um município primeiro" |
| CV-EDC-05 | vazio | município sem localidades | components/EditContactModal.jsx:115-120 | só "Nenhuma" | — |
| CV-EDC-06 | interação:trocar município | zera a localidade | components/EditContactModal.jsx:29-32 | — | — |
| CV-EDC-07 | variante | nota interna | components/EditContactModal.jsx:124-134 | placeholder "Visível só para os atendentes" | — |
| CV-EDC-08 | validação | nome vazio etc. | components/EditContactModal.jsx:78 | AUSENTE | — |
| CV-EDC-09 | salvando | enviando | components/EditContactModal.jsx:142 | "Salvar" desabilitado | sem texto de progresso ("Salvando…") (suspeita) |
| CV-EDC-10 | erro | falha ao salvar | components/EditContactModal.jsx:136 | WaError (role=alert) "{erro traduzido}" ou "Falha ao salvar" | — |
| CV-EDC-11 | sucesso | salvo | components/EditContactModal.jsx:52-60 | (modal fecha; nome/cidade do cabeçalho mudam pelo override) | a nota interna NÃO acompanha: ConversationView.jsx:967-974 não repassa `contactInternalNote` do override → painel Cliente e reabertura mostram a nota antiga, e salvar de novo sobrescreve a nova com a antiga |
| CV-EDC-12 | responsivo | ≤ 600px campos em 1 coluna | components/overlays.css:55 | — | — |

### Modal "Enviar template" — `components/SendTemplateModal.jsx`

Como se chega na tela: "Enviar template" nos avisos de janela (CV-ROD-07 / CV-ROD-10). `hooks/useTemplates.js` NÃO é usado pelo modal (ele chama `listTemplatesForChannel` direto) — sem efeito aqui.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-TPL-01 | variante | cabeçalho | components/SendTemplateModal.jsx:56-64 | "Enviar template" / "A janela de 24h está fechada. Só template aprovado é entregue até o cliente responder." | texto fixo mesmo aberto pelo aviso "indeterminada" (suspeita) |
| CV-TPL-02 | carregando | 1ª carga | components/SendTemplateModal.jsx:67 | "Carregando templates…" (role=status) | conversa sem `channelId`: fica "Carregando…" para sempre (:25 sai sem mudar status); não usa AsyncState como o modal irmão (inconsistência) |
| CV-TPL-03 | erro | falha | components/SendTemplateModal.jsx:68 | "Não foi possível carregar os templates." (role=alert) | sem "Tentar de novo" (só fechando e reabrindo) |
| CV-TPL-04 | vazio | nenhum template de atendimento | components/SendTemplateModal.jsx:69-73 | "Nenhum template de atendimento aprovado neste canal. Cadastre um em Configurações → Templates." | — |
| CV-TPL-05 | seleção | template escolhido | components/SendTemplateModal.jsx:79-91 | (cartão laranja; aria-pressed) | — |
| CV-TPL-06 | variante | template com variáveis | components/SendTemplateModal.jsx:98 | "Variável {n}" | — |
| CV-TPL-07 | variante | prévia | components/SendTemplateModal.jsx:118-122 | (texto com as variáveis) | — |
| CV-TPL-08 | variante | template com botões | components/SendTemplateModal.jsx:126-138 | "{botão}" + "Se o cliente tocar num botão, a resposta chega no chat e reabre a janela de 24h." | — |
| CV-TPL-09 | desabilitado-sem-motivo | nenhum template ou variável vazia | components/SendTemplateModal.jsx:157 | "Enviar" desabilitado | nada diz o que falta |
| CV-TPL-10 | salvando | enviando | components/SendTemplateModal.jsx:160 | "Enviando…" | — |
| CV-TPL-11 | erro | falha ao enviar | components/SendTemplateModal.jsx:144 | "{erro traduzido}" / "Não foi possível enviar o template." (role=alert) | — |
| CV-TPL-12 | sucesso | enviado | components/SendTemplateModal.jsx:45 | (modal fecha; a mensagem chega pela linha do tempo) | — |
| CV-TPL-13 | variante | não fecha por clique no fundo | components/SendTemplateModal.jsx:63 | — | — |
| CV-TPL-14 | responsivo | ≤ 680px lista e composição em 1 coluna | components/overlays.css:207 | — | — |

### Avatar do contato — `components/ContactAvatar.jsx`

Como se chega na tela: cabeçalho (40, CV:583), painel Cliente (52, CV:216), anexos de entrada (42, CV:831); também na lista (fora desta parte).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-AVC-01 | carregando | token de mídia ainda não pronto | components/ContactAvatar.jsx:33, :47-63 | (iniciais) | — |
| CV-AVC-02 | variante | foto | components/ContactAvatar.jsx:35-43 | (img; alt nome/telefone/"Contato") | — |
| CV-AVC-03 | erro | foto falhou | components/ContactAvatar.jsx:40 | (refaz 1 vez; depois iniciais) | — |
| CV-AVC-04 | variante | iniciais | components/ContactAvatar.jsx:7-20, :62 | "MC" / "M" / "{1º dígito}" / "?" | — |
| CV-AVC-05 | variante | `dark` (disco laranja→cobre) × claro | components/ContactAvatar.jsx:52-59 | — | — |

### Avatar do atendente — `components/AgentAvatar.jsx`

Como se chega na tela: NÃO é montado pela conversa (usado em TransferModal, ProfileModal, TeamModal, SideNav, AgentsAdminTab). Registrado porque está na lista.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-AVA-01 | variante | foto | components/AgentAvatar.jsx:30-42 | (img; alt nome/"Atendente") | — |
| CV-AVA-02 | erro | foto falhou | components/AgentAvatar.jsx:38 | (refaz 1 vez; depois iniciais) | — |
| CV-AVA-03 | variante | iniciais | components/AgentAvatar.jsx:6-12, :53 | "AO" / "A" / "?" | — |
| CV-AVA-04 | variante | `colorful` (cor por nome) × neutro | components/AgentAvatar.jsx:49-51 | — | — |
| CV-AVA-05 | variante | forma círculo × quadrado | components/AgentAvatar.jsx:28 | — | — |

### Tiques de status — `components/MessageStatusTicks.jsx`

Como se chega na tela: meta de cada bolha de saída (CV:783); também na lista (fora desta parte).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-TCK-01 | variante | failed | components/MessageStatusTicks.jsx:21-32 | "!" em disco vermelho | — |
| CV-TCK-02 | variante | sent | components/MessageStatusTicks.jsx:35-40 | ✓ cinza | — |
| CV-TCK-03 | variante | delivered | components/MessageStatusTicks.jsx:43-53 | ✓✓ cinza | — |
| CV-TCK-04 | variante | read | components/MessageStatusTicks.jsx:43-53 | ✓✓ verde | — |
| CV-TCK-05 | variante | outro status | components/MessageStatusTicks.jsx:56 | (nada) | — |
| CV-TCK-06 | tempo-real | status muda por socket `message:updated` | hooks/useConversationMessages.js:125-128 | (tique troca sozinho) | — |
| CV-TCK-07 | interação:tooltip | hover nos tiques | components/MessageStatusTicks.jsx:24, :37, :49 | "Falha ao enviar" / "Enviado" / "Entregue" / "Lido" | estado só por title e cor: svg aria-hidden, sem texto acessível; no toque não aparece |

### Motivo de falha — `utils/failureReasons.js` (texto exibido na bolha, CV:849-853)

Como se chega na tela: mensagem de saída com status 'failed'.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-FAL-01 | variante | código Meta conhecido (9 códigos) | utils/failureReasons.js:8-18, :38 | "Não entregue: Fora da janela de 24 h: só é possível mandar template aprovado (código 131047)" etc. | — |
| CV-FAL-02 | variante | 360dialog sem pagamento | utils/failureReasons.js:31-33 | "Não entregue: Número bloqueado no 360dialog por falta de pagamento — regularize … ({frase original})" | frase inglesa original anexada (intencional) |
| CV-FAL-03 | variante | código desconhecido ou sem código | utils/failureReasons.js:35 | (motivo do provedor repassado sem tradução, ex.: (131000) Something went wrong) | texto técnico cru em inglês |
| CV-FAL-04 | variante | falha sem motivo | components/ConversationView.jsx:852 | "Não entregue" | — |

### Veredito de comprovante — `utils/receiptVerdict.js` (texto; renderizado pelo MessageAttachment — C2)

Como se chega na tela: "Analisar comprovante" numa imagem, só na conversa minha (CV:823).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CV-CMP-01 | erro | não analisado | utils/receiptVerdict.js:24 | "{motivo do servidor}" ou "Não foi possível analisar o comprovante." | — |
| CV-CMP-02 | variante | já usado | utils/receiptVerdict.js:35-37 | "Atenção: este comprovante já foi usado antes." | — |
| CV-CMP-03 | sucesso | confere | utils/receiptVerdict.js:38-40 | "O comprovante confere." | — |
| CV-CMP-04 | variante | não confere | utils/receiptVerdict.js:41 | "O comprovante não confere." | — |
| CV-CMP-05 | variante | detalhes | utils/receiptVerdict.js:30 | "Valor: {valor}" · "Data: {data}" · "Tipo: {tipo}" · (motivos do servidor, um por item) | o tipo sai cru e minúsculo do servidor (pix, boleto, transferencia sem acento, outro — src/ai/comprovante.js:6, :108); os motivos já vêm em português (comprovante.js:86-104), só começam em minúscula |

### Tempo real e som da mesa — hooks

Como se chega na tela: eventos de socket enquanto a mesa está aberta.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| ATD-RT-01 | tempo-real | `queue:new` | hooks/useQueue.js:29 | (entra ou atualiza item em Espera/Automação) | — |
| ATD-RT-02 | tempo-real | `queue:removed` | hooks/useQueue.js:39 | (item some da fila) | — |
| ATD-RT-03 | tempo-real | `triageState` muda (pending ↔ outro) | pages/DashboardPage.jsx:101 | (item muda entre Automação e Espera) | — |
| ATD-RT-04 | tempo-real | `message:new` | hooks/useQueue.js:51 · hooks/useMyConversations.js:51 | (prévia e hora do item atualizam) | — |
| ATD-RT-05 | tempo-real | `conversation:assigned` | hooks/useMyConversations.js:29 | (item entra ou é atualizado na aba Atendimento; o número da aba sobe) | — |
| ATD-RT-06 | tempo-real | `conversation:removed` / `conversation:closed` | hooks/useMyConversations.js:39 | (item some da aba Atendimento; se era a conversa aberta, a mesa volta ao painel vazio) | — |
| ATD-RT-07 | tempo-real | `message:updated` (mensagem do próprio atendente) | hooks/useMyConversations.js:66 | (prévia + tiques de status) | — |
| ATD-RT-08 | tempo-real | `contact:avatar-updated` | hooks/useQueue.js:43 · hooks/useMyConversations.js:43 | (foto troca) | — |
| ATD-RT-09 | tempo-real | mensagem do cliente em conversa não aberta | hooks/useUnreadMyConversations.js:18 | (marca de não lida no item; o bipe daqui só toca se a conversa é da aba Atendimento) | marca só vive na sessão (sem contagem do servidor) |
| ATD-RT-10 | tempo-real | abrir a conversa | pages/DashboardPage.jsx:76 | (marca de não lida some) | — |
| ATD-RT-11 | tempo-real | som da fila (hook montado no menu lateral) | hooks/useQueueNotificationSound.js:11 | (bipe a cada `queue:new` — inclui cada mensagem de cliente já na fila) | (suspeita) toca por mensagem, não só por atendimento novo |
| ATD-RT-12 | tempo-real | som ao receber transferência | hooks/useTransferNotice.js:28 | (bipe) | — |
| ATD-RT-13 | variante | alternar "Som da fila" no menu lateral | hooks/useNotificationSound.js:25 | (só o som da fila obedece na hora) | cada `useNotificationSound` lê o `localStorage` só ao montar: o som de "Atendimento" e o de transferência continuam no estado antigo até a mesa remontar |
| ATD-RT-14 | tempo-real | `presence:online` / `presence:offline` | hooks/usePresence.js:30 | (bolinhas e contagens de online mudam) | — |
| ATD-RT-15 | recarregando | reconexão do socket | hooks/usePresence.js:42 | (nada avisa na tela; só as bolinhas e a contagem de online se refazem; fila e aba Atendimento não recarregam) | erro da recarga de presença é silencioso (`.catch(() => {})`) |
| ATD-RT-16 | tempo-real | rajada de 2–3 eventos por ação na fila | contexts/AgentsContext.jsx:71 | (1 recarga da equipe por janela de 50 ms; invisível) | — |

## 4. Supervisão


### Supervisão — barra de controle (abas, filtros, busca) — `pages/SupervisionPage.jsx`

Como se chega: menu → `/supervisao` (ProtectedRoute level="admin", App.jsx:147-152; a página NÃO tem checagem de papel própria). Filtros e aba ficam na URL (`?canal=&atendente=&setor=&aba=encerrados`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-BAR-01 | variante | sempre | :445 | "Supervisão" / "Central de operação · equipe, carga e atendimentos" | — |
| SUP-BAR-02 | seleção | aba ativa (aria-selected), guardada em `?aba=encerrados` | :448-458 | "Todos atendimentos" / "Encerrados hoje" | — |
| SUP-BAR-03 | carregando | painel em loading/erro/forbidden → número não confiável | :453 (numero() :187) | "—" na contagem da aba | — |
| SUP-BAR-04 | vazio | total de ativos = 0 | :453 → components/ui/Tabs.jsx:39 | (pastilha some) | `Tabs.Count` faz `if (!value) return null`: o "0 confirmado" que a página diferencia de "—" (comentário :184) nunca aparece na aba |
| SUP-BAR-05 | variante | "Encerrados hoje" sem filtro | :381 | contagem do painel (closedTodayCount) | rótulo diz "hoje", mas o backend conta janela móvel de 24 h (`sinceNow`, src/api/admin-dashboard.routes.js:20) (suspeita) |
| SUP-BAR-06 | erro | filtro ativo + falha na lista de encerrados | :382 | "—" | — |
| SUP-BAR-07 | filtro-ativo | filtro ativo + ainda há páginas | pages/SupervisionPage.jsx:384 | "{closedCount} carregados" | a contagem parcial só existe porque o front não manda os filtros: o endpoint `closed-today` já aceita channelId/agentId/sectorId e devolve `total` (admin-dashboard.routes.js:50-69) |
| SUP-BAR-08 | filtro-ativo | filtro ativo sem mais páginas | :387 | N (total filtrado) | — |
| SUP-BAR-09 | interação:menu aberto | clicar "Canais" / "Atendentes" / "Setores" | :104-117 | lista de checkboxes | — (ESC fecha e devolve foco :77-82; clique fora fecha :70) |
| SUP-BAR-10 | variante | menu aberto: botão muda de cor e chevron gira | supervision.css:100-104, :550 | (chevron 180°) | — |
| SUP-BAR-11 | vazio | dropdown sem opções | :106-107 | "Nenhuma opção" | Canais e Setores ignoram o `status` de useChannels/useSectors: carregando e erro também dizem "Nenhuma opção" |
| SUP-BAR-12 | filtro-ativo | opção marcada | pages/SupervisionPage.jsx:101 | "{label}" · "{selected.length}" (número laranja ao lado) | o número não tem rótulo acessível: o leitor ouve "Canais 2" sem saber que são opções marcadas (suspeita) |
| SUP-BAR-13 | variante | opção sintética de IA no filtro Atendentes | :470 | "IA" | — |
| SUP-BAR-14 | filtro-ativo | qualquer filtro ativo | :484-492 | "Limpar filtros" | — |
| SUP-BAR-15 | validação | Enter com protocolo/telefone vazio | :405-406, :420-421 | (nada acontece) | envio vazio ignorado sem retorno (suspeita) |
| SUP-BAR-16 | carregando | busca por protocolo em andamento | :407-408 | AUSENTE | sem "Buscando…" e o campo não trava; em rede lenta parece que nada aconteceu |
| SUP-BAR-17 | sucesso | protocolo encontrado | :409-410 | (abre o ConversationModal direto) | — |
| SUP-BAR-18 | busca-sem-resultado | protocolo inexistente (404) | :413 → :517 | "Nenhum atendimento encontrado com esse protocolo." | — |
| SUP-BAR-19 | erro | protocolo em formato inválido (ex.: letras) → 400 | pages/SupervisionPage.jsx:517 | (mensagem crua do servidor em inglês: protocolNumber must be a valid protocol number) | texto técnico cru em inglês: a frase do 400 não está em utils/errorMessages.js |
| SUP-BAR-20 | carregando | busca por telefone em andamento | :422-423 | AUSENTE | igual a SUP-BAR-16; o resultado anterior continua na tela até a resposta |
| SUP-BAR-21 | busca-sem-resultado | telefone sem contato (404) | :427 → :517 | "Nenhum cliente encontrado com esse telefone." | — |
| SUP-BAR-22 | erro | faixa única para protocolo, telefone e "finalizar" | :516-518 | (mensagem, role=alert) | mostra só uma das três (ordem protocolo > telefone > ação); o erro de ação nunca some sozinho, só na próxima finalização |
| SUP-BAR-23 | responsivo | ≥1150px a barra fica em linha; abaixo empilha; ≤1080 e ≤700 as buscas esticam | supervision.css:168-171, :643-653 | — | — |

### Supervisão — painel "Equipe e carga" — `pages/SupervisionPage.jsx`

Como se chega: coluna esquerda da Supervisão.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-EQP-01 | variante | sempre | :522-526 | "Equipe e carga" / "Atendimentos ativos por atendente · clique para filtrar" | — |
| SUP-EQP-02 | tempo-real | presença por socket (usePresence) | :524 | "{n} online" | o chip mostra "— online" enquanto o PAINEL carrega ou falha, embora a presença não dependa dele (numero() :187) |
| SUP-EQP-03 | carregando | useAgents em loading | :527 | "Carregando equipe…" (role=status) | — |
| SUP-EQP-04 | erro | useAgents com erro | :528 | "Não foi possível carregar a equipe." (role=alert) | erro sem "Tentar de novo" (o hook expõe `refresh`) |
| SUP-EQP-05 | sem-permissão | useAgents 'forbidden' | :527-528 | AUSENTE | status 'forbidden' não é tratado: painel em branco |
| SUP-EQP-06 | vazio | pronto e sem atendentes | :550 | "Nenhum atendente cadastrado." | — |
| SUP-EQP-07 | seleção | clicar no atendente = liga/desliga filtro | :531 | aria-pressed; fundo de acento + aresta | — |
| SUP-EQP-08 | tempo-real | presença de cada atendente | :539-541 | "Online" / "Offline" | — |
| SUP-EQP-09 | variante | offline | :531, supervision.css:307-310 | (linha a 62% de opacidade; volta a 100% com hover/foco) | — |
| SUP-EQP-10 | variante | online e painel pronto | :544 | "Em atendimento" / "Livre" | — |
| SUP-EQP-11 | variante | carga 0 com painel pronto | :536, :546 | (pastilha apagada, trilho some) | — |
| SUP-EQP-12 | carregando | painel não pronto | :536, :546 | "—" na pastilha, barra 0% | — |
| SUP-EQP-13 | interação:tooltip | nome truncado | :533 | title = nome completo | nome completo só via title, inacessível a toque (suspeita) |
| SUP-EQP-14 | interação:tooltip | pastilha de carga | :536 | title "Atendimentos ativos" | — (tem sr-only " atendimentos ativos") |
| SUP-EQP-15 | tempo-real | carga muda com `dashboard:conversation` | :313-320, :546 | (barra anima a largura) | — |
| SUP-EQP-16 | responsivo | ≤1120 some "Em atendimento/Livre"; ≤700 painel vira faixa de 232px com 2 colunas; ≤480 uma coluna | supervision.css:615, :647-656 | — | — |

### Supervisão — operação, aba "Todos atendimentos" — `pages/SupervisionPage.jsx`

Como se chega: aba padrão da Supervisão.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-OPR-01 | filtro-ativo | sub-filtro de estado (aria-pressed; o ativo usa o tom do estado) | :555-557 | "Visão geral" / "Andamento N" / "Espera N" / "Automação N" | — |
| SUP-OPR-02 | carregando | painel em loading | :589-591 | "Carregando atendimentos…" (role=status) | — (texto, não esqueleto) |
| SUP-OPR-03 | sem-permissão | painel 403 | :592-594 | "Você não tem acesso ao painel de atendimentos." (role=alert) | — |
| SUP-OPR-04 | erro-com-retry | painel falhou | :595-606 | "Não foi possível carregar os atendimentos." + "Tentar de novo" | — |
| SUP-OPR-05 | recarregando | "Tentar de novo" | pages/SupervisionPage.jsx:590 | (volta para "Carregando atendimentos…") | — (só é chamado depois de erro, quando não há dado na tela) |
| SUP-OPR-06 | variante | rótulos de coluna só quando há linha visível | :610-612 | "Cliente / última mensagem · Cidade / setor · Responsável · Horário" | — |
| SUP-OPR-07 | responsivo | rolagem: rótulos grudam no topo; cabeçalho de grupo gruda abaixo deles (top 33px só com rótulos, via :has) | supervision.css:382-386, :403-438 | — | — |
| SUP-OPR-08 | variante | grupo "Em andamento" (tom laranja) | :613-620, :126 | "Em andamento" + contagem | — |
| SUP-OPR-09 | vazio | Em andamento vazio | :127 | "Nenhum atendimento em andamento." | — |
| SUP-OPR-10 | vazio-por-filtro | Em andamento vazio com filtro | :370, :127 | "Nenhum atendimento em andamento com os filtros atuais." | — |
| SUP-OPR-11 | variante | grupo "Em espera" (tom âmbar) | :621-629 | "Em espera" + contagem | — |
| SUP-OPR-12 | vazio | Em espera vazio | :127 | "Nenhum atendimento em espera." | — |
| SUP-OPR-13 | vazio-por-filtro | Em espera vazio com filtro | :127 | "Nenhum atendimento em espera com os filtros atuais." | — |
| SUP-OPR-14 | variante | grupo "Em automação" (tom roxo) | :630-638 | "Em automação" + contagem | — |
| SUP-OPR-15 | vazio | Em automação vazio | :127 | "Nenhum atendimento em automação." | — |
| SUP-OPR-16 | vazio-por-filtro | Em automação vazio com filtro | :127 | "Nenhum atendimento em automação com os filtros atuais." | — |
| SUP-OPR-17 | tempo-real | socket `dashboard:conversation` insere, move ou remove linhas | hooks/useAttendanceDashboard.js:55-67 | (linhas entram e saem) | — |
| SUP-OPR-18 | tempo-real | reconexão do socket | hooks/useAttendanceDashboard.js:52-81 | AUSENTE | sem nova busca na reconexão (usePresence tem): eventos perdidos na queda deixam o painel desatualizado, sem aviso (suspeita) |
| SUP-OPR-19 | tempo-real | foto do contato atualizada | hooks/useAttendanceDashboard.js:69-73 | (avatar troca) | — |
| SUP-OPR-20 | responsivo | ≤1300 e ≤1120 as colunas encolhem; ≤1080 a grade vira bloco, rótulos somem, grupo gruda em top 0 | supervision.css:606-645 | — | — |

### Supervisão — linha de atendimento (SupervisionRow + ConversationListItem compacto) — `pages/SupervisionPage.jsx`

Como se chega: cada linha dos grupos, dos encerrados e da busca por telefone.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-LIN-01 | variante | tom do grupo ou do estado | :149 | (aresta esquerda de 3px colorida) | — |
| SUP-LIN-02 | hover-revela | hover na linha | supervision.css:458-459, :516-522 | (aresta acende; "Abrir" ganha acento) | — ("Abrir" fica sempre visível) |
| SUP-LIN-03 | variante | sem cidade | :152-153 | "Cidade não informada" (itálico) | — |
| SUP-LIN-04 | variante | sem setor | :155 | "Sem setor" | — |
| SUP-LIN-05 | variante | com responsável | :159 | inicial + primeiro nome (title = nome completo) | nome completo só via title (suspeita) |
| SUP-LIN-06 | variante | sem responsável | :160 | "Sem responsável" | — |
| SUP-LIN-07 | variante | encerrado pela própria IA | :350 | "IA" no lugar do atendente | — |
| SUP-LIN-08 | variante | pastilha de estado só fora de grupo (encerrados, busca) | :166 | "Encerrado" / "Em atendimento" / "Em automação" / "Em espera" | "Em atendimento" aqui e "Em andamento" no cabeçalho do grupo (:614) e no painel lateral (ConversationInfoPanel.jsx:26): um estado com dois nomes |
| SUP-LIN-09 | variante | sem horário | :167 | "Horário não informado" | — |
| SUP-LIN-10 | variante | origem do horário | :148, :168 | "Encerramento" / "Última mensagem" / "Abertura" | — (some ≤1080, supervision.css:641) |
| SUP-LIN-11 | variante | chips de contexto de IA do item compacto | components/ConversationListItem.jsx:163-177 | "IA em triagem" / "IA · <motivo>" / "Resolvido pela IA" | — |
| SUP-LIN-12 | interação:tooltip | triagem com confiança baixa | components/ConversationListItem.jsx:173 | "⚠" · "A triagem da IA ficou com confiança baixa" · "Triagem com confiança baixa" | a explicação só aparece por hover (tem aria-label para leitor) |
| SUP-LIN-13 | variante | última mensagem de saída | components/ConversationListItem.jsx:156 | (ticks de entrega) | — |
| SUP-LIN-14 | variante | botão ✓ só em Espera e Automação | components/ConversationListItem.jsx:190 | (ícone de check IconCheckCircle) · "Finalizar sem motivo" | — |
| SUP-LIN-15 | confirmação | clicar ✓ | components/ConversationListItem.jsx:90 | "Finalizar esse atendimento sem informar o motivo?" (danger, botão "Finalizar") | — |
| SUP-LIN-16 | interação:enviando | finalização em andamento | :394-400 | AUSENTE | sem indicador; a linha só some quando o socket chega |
| SUP-LIN-17 | erro | falha ao finalizar | :398 → :517 | "Não foi possível finalizar este atendimento." (ou erro traduzido) | — |
| SUP-LIN-18 | sucesso | finalizou | pages/SupervisionPage.jsx:397 | AUSENTE | sem confirmação, e o item não entra em "Encerrados hoje" (lista não é tempo real, ver SUP-ENC-11) |
| SUP-LIN-19 | interação:abrir conversa | "Abrir" ou clique/Enter na linha | pages/SupervisionPage.jsx:170 | "Abrir" · "Abrir conversa de {nome}" | — |
| SUP-LIN-20 | responsivo | ≤1120 "Abrir" compacto; ≤1080 linha vira bloco | supervision.css:618, :627-642 | — | — |

### Supervisão — resultado da busca por telefone — `pages/SupervisionPage.jsx`

Como se chega: Enter no campo "Buscar por telefone do cliente".

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-TEL-01 | variante | resultado presente toma o lugar de qualquer aba e esconde os sub-filtros | :555, :558-586 | "{n} atendimento(s) de {nome ou telefone}" | trocar de aba não tem efeito visível enquanto houver resultado; o painel tem role=tabpanel sem id/aria-labelledby e a aba ativa aponta aria-controls para um painel que não existe (suspeita) |
| SUP-TEL-02 | sucesso | resposta chegou | :561-564 | (texto da contagem) | sem role=status/aria-live: o leitor de tela não sabe que a busca terminou (suspeita) |
| SUP-TEL-03 | interação:limpar busca | "Limpar busca" | :565-571 | "Limpar busca" | — |
| SUP-TEL-04 | vazio | contato sem atendimentos | :573-574 | "Esse cliente ainda não teve nenhum atendimento." | — |
| SUP-TEL-05 | variante | linhas de qualquer status, com pastilha | :576-584 | (pastilha de estado) | os filtros de canal/atendente/setor continuam marcados mas não se aplicam a este resultado (suspeita) |

### Supervisão — aba "Encerrados hoje" — `pages/SupervisionPage.jsx`

Como se chega: aba "Encerrados hoje" (`?aba=encerrados`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-ENC-01 | carregando | 1ª carga e "Tentar de novo" (escopo inicial) | :256-270, :661-665 | AUSENTE → aparece "Nenhum atendimento encerrado hoje." | o vazio se passa por carregando: não existe estado de loading para a carga inicial nem para a nova tentativa |
| SUP-ENC-02 | erro-com-retry | falha na carga inicial | :645-650 | "Não foi possível carregar os atendimentos encerrados hoje." + "Tentar de novo" | — |
| SUP-ENC-03 | erro-com-retry | falha no "Carregar mais" (a lista já carregada fica) | :645-650 | "Não foi possível carregar mais atendimentos encerrados." + "Tentar de novo" | — |
| SUP-ENC-04 | filtro-ativo | filtro ativo + há mais páginas | :653-654 | "N correspondências entre M encerrados carregados. Há mais resultados disponíveis — use “Carregar mais”." | — |
| SUP-ENC-05 | filtro-ativo | filtro ativo sem mais páginas | pages/SupervisionPage.jsx:655 | "{filteredClosed.length} de {closedItems.length} encerrados de hoje correspondem aos filtros." | — |
| SUP-ENC-06 | variante | rótulos de coluna com linhas | pages/SupervisionPage.jsx:659 | "Cliente / última mensagem" · "Cidade / setor" · "Responsável" · "Estado / horário" | — |
| SUP-ENC-07 | vazio | nenhum encerrado | :664 | "Nenhum atendimento encerrado hoje." | — |
| SUP-ENC-08 | vazio-por-filtro | filtro sem correspondência | :664 | "Nenhum atendimento encerrado hoje com os filtros atuais." | — |
| SUP-ENC-09 | variante | há mais páginas | :678-687 | "Carregar mais" | — |
| SUP-ENC-10 | carregando | "Carregar mais" em andamento | :682, :685 | "Carregando…" (desabilitado) | — |
| SUP-ENC-11 | tempo-real | encerramento chega pelo socket | hooks/useAttendanceDashboard.js:64-66 | (só a contagem da aba sobe) | a lista não recebe o item: contagem (sem filtro) e lista divergem até recarregar a página |

### Supervisão — modais e permissão — `pages/SupervisionPage.jsx`

Como se chega: a partir das linhas e das buscas.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| SUP-MOD-01 | interação:modal aberto | "Abrir", clique na linha ou protocolo encontrado | :692-698 | ConversationModal (ver CVM-MOD) | — |
| SUP-MOD-02 | variante | a conversa aberta sai de todas as listas (encerrada no próprio modal ou por outro atendente) | pages/SupervisionPage.jsx:692 | (o modal fecha sozinho) | desmonta sem aviso: a conversa é buscada em inProgress/waiting/inAutomation/closedItems, e closedItems não é tempo real (suspeita forte) |
| SUP-MOD-03 | interação:modal aberto | "Transferir" dentro do modal | :699 | TransferModal (outra parte) | — |
| SUP-MOD-04 | sem-permissão | papel sem acesso | — (App.jsx:147-152) | depende só do ProtectedRoute | a página não tem checagem própria; o 403 do painel é tratado (SUP-OPR-03), o de encerrados cai no erro genérico (SUP-ENC-02) e o da busca vira "Sua conta não tem permissão para esta ação." |

### Modal de conversa (moldura) — `components/ConversationModal.jsx`

Como se chega: Supervisão ("Abrir", protocolo, telefone, encerrados) e popup "Encerrados" do atendente.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CVM-MOD-01 | interação:modal aberto | abrir | :11-26 | (aria-label "Conversa"; botão "Fechar conversa") | — |
| CVM-MOD-02 | variante | não fecha pelo fundo; ESC pela pilha (fecha só o de cima) | :24 | — | — |
| CVM-MOD-03 | responsivo | painel lateral some abaixo de md | components/ConversationInfoPanel.jsx:70 | — | abaixo de 768px, protocolo, nota interna e triagem da IA não aparecem no modal (suspeita) |
| CVM-MOD-04 | variante | admin/gerente em conversa ativa de outro | components/ConversationView.jsx:401, :637-660 | "Transferir" / "Encerrar" | — |
| CVM-MOD-05 | variante | conversa sem dono | components/ConversationView.jsx:631-658 | "Assumir" + "Transferir" + ✓ (só ícone, "Encerrar atendimento") | — |
| CVM-MOD-06 | variante | conversa encerrada ou alheia = somente leitura | components/ConversationView.jsx:401, :883 | (sem ações e sem caixa de mensagem) | nenhum aviso de "somente leitura" nem de por que não dá para responder: a conversa simplesmente acaba (suspeita) |
| CVM-MOD-07 | variante | conversa do próprio admin | components/ConversationView.jsx:883-951 | (caixa de mensagem) | — |
| CVM-MOD-08 | variante | "Consultar SGP" também em conversa encerrada ou alheia | components/ConversationView.jsx:620-623, :994-1004 | (painel SGP com botões de envio) | botões de envio (link/PDF/Pix) aparecem onde o backend recusa envio (só o dono envia) (suspeita; conferir na parte do Atendimento) |
| CVM-MOD-09 | variante | aberto de "Encerrados": `onTransferClick` vazio | components/ClosedConversationsModal.jsx:30 | — | — (Transferir não aparece em conversa encerrada) |

### Painel lateral do modal — `components/ConversationInfoPanel.jsx`

Como se chega: lado direito do ConversationModal (≥ md).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CVM-INF-01 | variante | status | :85 (getStatusMeta :15-29) | "Encerrado" / "Em automação" / "Em espera" / "Em andamento" / "Conversa" | "Em automação" e "Em andamento" com a mesma cor (wa-link), destoando dos tons da Supervisão (roxo x laranja) |
| CVM-INF-02 | variante | telefone só se existir | :82-84 | (telefone) | — |
| CVM-INF-03 | variante | nota interna | :88-95 | "Nota interna" | — |
| CVM-INF-04 | variante | sem cidade | :100 | "Não informada" | — |
| CVM-INF-05 | variante | sem setor | :101 | "Não definido" | — |
| CVM-INF-06 | variante | seletor de setor (admin, gerente ou dono) | :102-119 | "Alterar setor" (sr-only) / "Selecione um setor" | aparece também em conversa ENCERRADA (`canEditSector` não olha o status) (suspeita) |
| CVM-INF-07 | carregando | setores ainda carregando | :42, :111-116 | (select só com "Selecione um setor") | o `status` de useSectors é ignorado |
| CVM-INF-08 | salvando | trocar setor | :57-61 | AUSENTE | sem indicador |
| CVM-INF-09 | erro | falha ao trocar setor | :60 | AUSENTE | `.catch(() => {})`: erro silencioso, e o select fica com o valor novo que não foi salvo (sem desfazer) |
| CVM-INF-10 | variante | linha "Setor" depois de trocar | :101 | (nome antigo) | continua com o nome antigo até o objeto da conversa mudar (no popup Encerrados, nunca) (suspeita) |
| CVM-INF-11 | variante | atendente | :120 | nome / "IA" / "Não atribuído" | — |
| CVM-INF-12 | variante | protocolo | :121 | "Protocolo" | — |
| CVM-INF-13 | variante | encerrada | :122 | "Encerrado em" dd/mm/aa hh:mm | — |
| CVM-INF-14 | variante | triagem por IA concluída | :125-137 | "Triagem por IA": "Setor da IA" ("Não definido"), "Motivo" ("não definido"), "Identificação" ("memória"/"telefone"/"CPF"/"não identificado"), "Confiança" ("NN%"/"—") + resumo | "não definido" minúsculo ao lado de "Não definido"; `<pre>` vazio quando não há resumo |

## 5. Relatórios


### Relatórios — `pages/ReportsPage.jsx`

Como se chega: menu → `/relatorios` (SEM ProtectedRoute, App.jsx:145: qualquer papel entra; o escopo vem do dado, `data.scope` 'admin' = equipe, 'agent' = só os próprios números). Período na URL (`?periodo=today|7d|30d|custom&dias=N`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| REL-PG-01 | variante | escopo admin (inclui gerente) | :384, :386 | chip "Equipe" / "Compare o desempenho da equipe no período selecionado." | — |
| REL-PG-02 | variante | escopo atendente | :384, :386 | chip "Meus resultados" / "Seus números no período selecionado." | — |
| REL-PG-03 | carregando | antes da 1ª resposta | :384, :386 | (sem chip) "Seus números no período selecionado." | o admin lê o subtítulo de atendente até a resposta chegar (isAdmin depende de `data`) |
| REL-PG-04 | filtro-ativo | período selecionado (aria-pressed) | :389-393 | "Últimas 24 horas" / "Últimos 7 dias" / "Últimos 30 dias" / "Personalizado" | — |
| REL-PG-05 | expandido | "Personalizado" (aria-expanded) | pages/ReportsPage.jsx:396 | "Últimos" · "dias" · "Aplicar" · "De 1 a 365 dias" | — |
| REL-PG-06 | desabilitado-com-motivo | número de dias inválido | pages/ReportsPage.jsx:396 | "Aplicar" · "De 1 a 365 dias" | a dica De 1 a 365 dias não está ligada ao botão por aria-describedby (confirmado) |
| REL-PG-07 | validação | URL `periodo=custom` sem `dias` válido | :284 | (cai para "Últimas 24 horas") | — |
| REL-PG-08 | desabilitado-sem-motivo | ainda sem dados | :394 | "Exportar CSV" cinza | nada diz por quê |
| REL-PG-09 | sucesso | exportar CSV | :343-358 | (download do navegador) | — (síncrono, sem estado de envio) |
| REL-PG-10 | carregando | 1ª carga | :402 | "Carregando indicadores…" (role=status) | — (texto, não esqueleto) |
| REL-PG-11 | recarregando | troca de período com dados na tela | :398, :406 | conteúdo a 72% + "Atualizando…" (role=status) | — |
| REL-PG-12 | erro-com-retry | falha na consulta | :401 | "Falha ao carregar métricas" + "Tentar de novo" | "métricas" é o nome antigo da tela (hoje "Relatórios") |
| REL-PG-13 | erro | falha com dados antigos na tela | :401 + :404-434 | faixa de erro por cima dos números antigos | — (a legenda do instantâneo continua honesta) |
| REL-PG-14 | sem-permissão | getMetrics 403 | :324-327 | "Falha ao carregar métricas" | 403 e falha de rede dizem a mesma coisa; a página não tem checagem própria |
| REL-PG-15 | variante | legenda do instantâneo | pages/ReportsPage.jsx:405 | "{rotuloDoPeriodo(resposta)}" · "Atualizado às {HH:MM}" | — |
| REL-PG-16 | recarregando | atualizar sem mudar o período | :391 | AUSENTE | não existe "Atualizar": clicar no período já ativo não refaz a consulta (mesma URL); os números só se renovam trocando de período ou recarregando a página (suspeita) |
| REL-PG-17 | variante | KPIs: admin 4, atendente 3 | :429-434 | "Atendimentos encerrados" / "Tempo médio de atendimento" / "Tempo médio de primeira resposta" / "Atendentes no período" (só admin) | — |
| REL-PG-18 | variante | nota do 1º KPI conforme o escopo | :430 | "Encerrados por atendentes" / "Encerrados por você" | — |
| REL-PG-19 | variante | tempo sem dado | :127, :431-432 (utils/formatDuration.js:3) | "—" | — |
| REL-PG-20 | vazio | atendente sem encerramento no período | :429-434 | "0", "—", "—" | não há frase de vazio para o atendente (o admin tem REL-PG-21) (suspeita) |
| REL-PG-21 | vazio | admin sem nenhum dado no período | :436 | "Nenhum atendimento fechado nesse período." + "Os indicadores por atendente, setor, motivo e tempo aparecem quando houver atendimentos encerrados no período selecionado." | — |
| REL-PG-22 | vazio | tabela da equipe sem linha (setor/motivo com dados) | :453 | "Nenhum atendimento fechado nesse período." | — |
| REL-PG-23 | variante | "Ordenar por" só com mais de 1 atendente | :446-451 | "Ordenar por" [Atendimentos / Tempo médio / Primeira resposta / Nome] | — |
| REL-PG-24 | variante | pódio só com ordem por volume | :461, :468 | (discos 1/2/3 e barras laranja) | — |
| REL-PG-25 | expandido | mais de 10 atendentes | pages/ReportsPage.jsx:474 | "Ver todos os atendentes ({linhasDaEquipe.length})" · "Mostrar só os {TEAM_PREVIEW} primeiros" | — |
| REL-PG-26 | variante | nota fixa da tabela | :479 | "Os tempos são médias. “—” indica ausência de dados para o cálculo." | — |
| REL-PG-27 | hover-revela | hover na linha da tabela | reports.css:368 | (realce da linha) | — |
| REL-PG-28 | vazio | Setor ou Motivos sem linhas | :198-199 | "Nenhum atendimento fechado nesse período." | — |
| REL-PG-29 | variante | "Sem setor" / "Sem motivo" em cor neutra + nota | pages/ReportsPage.jsx:482 | "Sem setor" · "Sem motivo" · "\"Sem setor\" são conversas encerradas sem setor definido na triagem ou pelo atendente." · "\"Sem motivo\" são conversas finalizadas direto da fila, sem motivo." | — |
| REL-PG-30 | variante | % só com total > 0; da 7ª categoria em diante a barra é neutra | :207, :163-172 | "NN%" | — |
| REL-PG-31 | expandido | mais de 8 linhas em Setor/Motivos | pages/ReportsPage.jsx:215 | "Ver todos ({ordenadas.length})" · "Mostrar menos" | — |
| REL-PG-32 | responsivo | ≤1250 análise em 1 coluna; ≤1100 KPIs 2×2; ≤860 cartões 1 coluna; ≤600 KPIs 1 coluna e tabela vira cartão com data-label | reports.css:519-559 | — | — |
| REL-PG-33 | erro | exceção ao montar o CSV | :343-358 | AUSENTE | sem try/catch; uma falha seria silenciosa (suspeita) |

### Relatórios — ajuda "O que é isso?" — `components/SectionHelp.jsx`

Como se chega: legenda do resumo, só quando já existe resposta (ReportsPage.jsx:404, :409).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| REL-AJ-01 | interação:ajuda aberta | botão (aria-label "O que é isso: Como os tempos são calculados") | :8-15 | "O que é isso?" | — |
| REL-AJ-02 | interação:ajuda aberta | modal WaDialog "help" (fecha pelo fundo) | :16 (texto em pages/ReportsPage.jsx:409) | "Como os tempos são calculados" + 4 parágrafos + "Entendi" | — |
| REL-AJ-03 | variante | sem resposta (1ª carga ou erro sem dados) | ReportsPage.jsx:404 | (a ajuda some) | a explicação fica indisponível justamente sem dados (suspeita, leve) |

### Relatórios — arquivo CSV — `utils/exportMetricsCsv.js`

Como se chega: botão "Exportar CSV".

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| REL-CSV-01 | variante | escopo atendente e escopo admin | :18-45, :78-84 | "Período do relatório" / "Gerado em" + seções por atendente, setor e motivo | — |
| REL-CSV-02 | variante | nome do arquivo pelo instantâneo | utils/exportMetricsCsv.js:73 | "relatorio-{trecho}-{AAAA-MM-DD}.csv" · "ultimas-24-horas" · "ultimos-7-dias" · "ultimos-30-dias" · "ultimos-{customDays}-dias" | — |

## 6. Campanhas


### Campanhas — lista — `pages/CampaignsPage.jsx`

Como se chega: menu → `/campanhas` (ProtectedRoute level="admin", App.jsx:126-133; backend `requireRole('admin')`; a página não tem checagem própria).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CAM-LST-01 | variante | sempre | :105-121 | "Campanhas" / "Disparo em massa para uma lista de clientes" / "Atualizar" / "Nova campanha" | — |
| CAM-LST-02 | carregando | 1ª carga (AsyncState, onRetry passado) | :124 | (esqueleto de 3 linhas) | — |
| CAM-LST-03 | erro-com-retry | falha na 1ª carga | :124 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | mensagem genérica (sem `error`) |
| CAM-LST-04 | sem-permissão | 403 | :67 (texto em components/ui/AsyncState.jsx:22) | (vira 'error': "Não foi possível carregar.") | 403 nunca vira 'forbidden' |
| CAM-LST-05 | recarregando | "Atualizar" | :111-114, :60-71 | AUSENTE | sem indicador de atualização, e a falha é engolida (`silencioso`): o botão não dá retorno nenhum |
| CAM-LST-06 | tempo-real | consulta a cada 10 s enquanto alguma campanha processa (pausa com a aba do navegador oculta) | :79-88 | (números mudam) | falha da consulta silenciosa, sem aviso de dado velho (suspeita) |
| CAM-LST-07 | vazio | nenhuma campanha | :125-128 | "COMECE PELO PRIMEIRO ENVIO" / "Nenhuma campanha criada ainda" / "Use “Nova campanha” para escolher o canal…" | — |
| CAM-LST-08 | variante | resumo do topo | :130-133 | "Campanhas listadas" / "Destinatários" / "Enviados" / "Falharam" / "Pulados" | — |
| CAM-LST-09 | filtro-ativo | busca ativa | pages/CampaignsPage.jsx:134 | "{campaigns.length} campanhas" · "{visiveis.length} de {campaigns.length} campanhas" | sem singular: com 1 campanha aparece 1 campanhas (confirmado) |
| CAM-LST-10 | busca-sem-resultado | busca sem correspondência | :142 | "Nenhuma campanha corresponde a “{termo}”." | — |
| CAM-LST-11 | filtro-ativo | ordenação | :137-140 | "Mais recentes" / "Mais antigas" / "Nome (A–Z)" / "Mais destinatários" / "Mais falhas" | — |
| CAM-LST-12 | variante | campanha sem nome | :150 | "Sem nome" | — |
| CAM-LST-13 | variante | canal Meta Cloud | :150 | (selo Meta, role=img "Meta Cloud") | usa `maskImage: url(meta.svg)`; o SVG tem 1,3 KB e o Vite o inlineia — é exatamente o padrão que virou quadrado sólido em produção nos Canais (memória project_channel_brand_marks); 360dialog não ganha selo nenhum (suspeita forte) |
| CAM-LST-14 | variante | canal desconhecido ou não carregado | :150 | "—" | o `status` de useAgentChannels é ignorado: erro ao carregar canais também vira "—" |
| CAM-LST-15 | variante | data ausente ou inválida | :15 | "Data não informada" | — |
| CAM-LST-16 | variante | falhas > 0 | :153 | (número em vermelho) | — |
| CAM-LST-17 | variante | situação | :155 (utils/campaignStatus.js:13-19) | "Processando" / "Todos processados" (verde) / "Sem destinatários" | — |
| CAM-LST-18 | hover-revela | hover ou foco na linha | campaigns.css:13 | (aresta laranja) | — |
| CAM-LST-19 | responsivo | @container ≤800: cabeçalho de colunas some e os rótulos aparecem; ≤480 resumo quebra e a contagem some | campaigns.css:24-27 | — | — |
| CAM-LST-20 | interação:modal aberto | "Nova campanha" | :163-171 | CreateCampaignModal | — |
| CAM-LST-21 | sucesso | campanha criada | :166-169 | (modal fecha; lista volta ao esqueleto) | sem mensagem de sucesso; o `refresh()` não-silencioso troca a lista inteira por esqueleto (suspeita) |

### Campanhas — detalhe — `pages/CampaignDetailPage.jsx`

Como se chega: clicar numa linha → `/campanhas/:id`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CAM-DET-01 | carregando | 1ª carga | :107, :122 | título "Campanha" + (esqueleto) | — |
| CAM-DET-02 | erro-com-retry | falha | :122 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | mensagem genérica |
| CAM-DET-03 | erro | 404 | :106-107, :119-120 | título e migalha "Campanha não encontrada" + "Esta campanha não existe ou foi removida." (role=alert) | — |
| CAM-DET-04 | sem-permissão | 403 | :60 | (vira 'error' genérico) | igual a CAM-LST-04 |
| CAM-DET-05 | variante | título e descrição | :107, :114 | nome ou "Sem nome" / "Acompanhe o andamento e o resultado de cada destinatário." | — |
| CAM-DET-06 | variante | canal | :125 | nome ou "Canal não informado" | falha ao carregar canais também vira "Canal não informado" |
| CAM-DET-07 | tempo-real | consulta a cada 5 s até terminar | :73-80 | (números e lista mudam) | falha silenciosa, sem aviso de dado velho (suspeita) |
| CAM-DET-08 | variante | progresso (role=progressbar) | pages/CampaignDetailPage.jsx:128 | "{processedCount} de {campaign.totalRecipients} processados" · "Destinatários processados" · "{situacaoDaCampanha(campaign)}" (barra role=progressbar) | N e M sem separador de milhar, o resumo logo acima tem |
| CAM-DET-09 | vazio | campanha sem destinatários | :133 | "Nenhum destinatário nesta campanha." | — |
| CAM-DET-10 | filtro-ativo | filtro por resultado (aria-pressed) | pages/CampaignDetailPage.jsx:135 | "{f.label}{porResultado[f.value]}" · "Todos" · "Enviados" · "Falharam" · "Pulados" · "Pendentes" | — |
| CAM-DET-11 | vazio-por-filtro | filtro sem destinatários | :137 | "Nenhum destinatário com esse resultado." | — |
| CAM-DET-12 | variante | contagem do cabeçalho | pages/CampaignDetailPage.jsx:132 | "{campaign.recipients.length} registros" · "{filtrados.length} de {campaign.recipients.length} registros" | sem singular: com 1 destinatário aparece 1 registros |
| CAM-DET-13 | variante | resultado de cada destinatário | :141 | "Pendente" / "Enviado" / "Falhou" / "Pulado" (cores) | status desconhecido aparece cru (código em inglês) |
| CAM-DET-14 | variante | detalhe do envio | pages/CampaignDetailPage.jsx:144 | "{explicacao} (código {codigo})" · "Número bloqueado no 360dialog por falta de pagamento — regularize a cobrança no Hub do 360dialog ({motivo})" · "—" · (ou o motivo cru do servidor) | motivo sem mapeamento passa cru (texto do provedor, em inglês) |
| CAM-DET-15 | variante | linha inválida sem nome | :140 | AUSENTE → célula de identidade vazia | o backend grava `rawPhoneNumber` e `phoneNumber: ''` (campaigns.routes.js:50), mas o front só mostra `displayName \|\| phoneNumber`: a linha "Número inválido" não diz qual linha era |
| CAM-DET-16 | expandido | mais de 200 destinatários | pages/CampaignDetailPage.jsx:147 | "Mostrar mais ({filtrados.length - limite} restantes)" | — |
| CAM-DET-17 | responsivo | @container ≤800 | campaigns.css:24 | — | — |

### Campanhas — "Nova campanha" — `components/CreateCampaignModal.jsx`

Como se chega: botão "Nova campanha" em `/campanhas`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CAM-NOV-01 | variante | passo formulário (não fecha pelo fundo) | :181 | "Nova campanha" / "Nome (opcional)" | — |
| CAM-NOV-02 | carregando | canais | :195 | "Carregando canais…" (role=status) | — |
| CAM-NOV-03 | erro | canais falharam | :197 | "Não foi possível carregar os canais. Feche e tente novamente." | sem role=alert e sem "Tentar de novo" |
| CAM-NOV-04 | vazio | nenhum canal elegível (Baileys desconectado é filtrado) | :199 | "Nenhum canal conectado no momento." | — |
| CAM-NOV-05 | desabilitado-com-motivo | "Revisar" travado por carregando, erro, sem canal ou sem template | :325 | "Revisar" cinza (o motivo aparece no campo acima) | — |
| CAM-NOV-06 | variante | canal oficial | :225-227 | "Este canal requer o uso de template para a campanha!" | — |
| CAM-NOV-07 | carregando | templates do canal | :53-56 | AUSENTE | durante a busca aparece "Nenhum template aprovado para este canal." e "Revisar" trava |
| CAM-NOV-08 | erro | templates falharam | :53-56 | AUSENTE | sem `.catch`: a falha vira "Nenhum template…" (erro silencioso); ao trocar de canal oficial, os templates do canal anterior ficam até a resposta chegar |
| CAM-NOV-09 | vazio | sem template de disparo | :233 | "Nenhum template aprovado para este canal." | a lista é filtrada pela finalidade 'disparo', mas o texto só fala em "aprovado": não orienta a marcar a finalidade (memória project_template_purpose) |
| CAM-NOV-10 | variante | template com variáveis | components/CreateCampaignModal.jsx:260 | "Variável {index + 1}" | — |
| CAM-NOV-11 | variante | canal Baileys | :279-296 | "Mensagem" | — |
| CAM-NOV-12 | validação | sem canal | :216-220 | "Selecione um canal para a campanha." | — |
| CAM-NOV-13 | validação | sem template | :251-255 | "Selecione um template aprovado." | — |
| CAM-NOV-14 | validação | variável vazia | components/CreateCampaignModal.jsx:271 | "Preencha a variável {index + 1}." | — |
| CAM-NOV-15 | validação | mensagem vazia | :291-295 | "Escreva a mensagem que será enviada." | — |
| CAM-NOV-16 | validação | destinatários vazios | :311-315 | "Informe ao menos um destinatário." | — |
| CAM-NOV-17 | resumo↔formulário | "Revisar" → passo de revisão / "Voltar" | :87-91, :111-178, :163 | "Revisar campanha" / "Voltar" | — |
| CAM-NOV-18 | variante | canal na revisão | :121 | "{nome} · {tipo do canal}" | — |
| CAM-NOV-19 | variante | destinatários válidos | components/CreateCampaignModal.jsx:127 | "{summary.valid.length} destinatário válido" · "{summary.valid.length} destinatários válidos" | — |
| CAM-NOV-20 | variante | duplicados | components/CreateCampaignModal.jsx:130 | "{summary.duplicates} duplicado ignorado" · "{summary.duplicates} duplicados ignorados" | — |
| CAM-NOV-21 | variante | linhas inválidas | components/CreateCampaignModal.jsx:135 | "{summary.invalid} linha inválida" · "{summary.invalid} linhas inválidas" · "(vão aparecer como \"falhou\")" | — |
| CAM-NOV-22 | validação | zero válidos (só linhas inválidas) | components/CreateCampaignModal.jsx:160 | "Nenhum destinatário válido na lista." | validação só no servidor: com 0 válidos o botão "Confirmar e disparar" continua habilitado e o aviso só chega depois do POST |
| CAM-NOV-23 | desabilitado-com-motivo | mais de 2000 | components/CreateCampaignModal.jsx:140 | "O limite é de {RECIPIENT_LIMIT} destinatários por campanha." | — |
| CAM-NOV-24 | variante | conteúdo na revisão, canal oficial | :147-153 | "Template: {nome}" + "Variável N: {valor}" | prévia do texto do template AUSENTE: dispara sem ver a mensagem montada |
| CAM-NOV-25 | variante | conteúdo na revisão, Baileys | :155 | (texto da mensagem) | — |
| CAM-NOV-26 | salvando | disparando | :166-173 | "Confirmar e disparar" cinza | o rótulo não muda ("Disparando…") e nada indica envio; o modal continua fechável no meio do POST |
| CAM-NOV-27 | erro | falha ao criar (revisão) | :160 | "Falha ao criar campanha" ou erro traduzido (role=alert) | — |
| CAM-NOV-28 | erro | mesma falha vista depois de "Voltar" | :317 | idem | — |
| CAM-NOV-29 | sucesso | criada | :103 | (modal fecha; ver CAM-LST-21) | — |

## 7. Configurações


#### 7.0 Moldura de Configurações


### Menu lateral de Configurações — `pages/settings/SettingsLayout.jsx`

Como se chega na tela: qualquer rota `/configuracoes/*` (ProtectedRoute nível `admin` em `App.jsx:154-160`). É a moldura de todas as páginas desta parte.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-NAV-01 | variante | grupo com 1 item de mesmo nome vira link solo (hoje só "Empresa") | pages/settings/SettingsLayout.jsx:88 | "Empresa" | — |
| CFG-NAV-02 | expandido | grupo da página ativa abre sozinho ao chegar (openGroup volta a null a cada troca de rota) | pages/settings/SettingsLayout.jsx:32-33,114 | (sublista visível, "›" girado 90°, contagem ao lado) | — |
| CFG-NAV-03 | interação:recolher grupo | clique no grupo aberto → `openGroup=''`, todos fechados (atributo `hidden`) | pages/settings/SettingsLayout.jsx:102,114 | (só os títulos dos grupos + contagem) | — |
| CFG-NAV-04 | interação:abrir outro grupo | clique noutro grupo → abre ele e fecha o ativo (um aberto por vez) | pages/settings/SettingsLayout.jsx:114 | "{group.group}" · "{group.items.length}" · "›" | — |
| CFG-NAV-05 | seleção | item da rota atual (`aria-current=page`) | pages/settings/SettingsLayout.jsx:124-132; settings.css:16-17 | (fundo cobre + traço interno à esquerda; o marcador laranja do JSX é escondido pelo CSS) | — |
| CFG-NAV-06 | variante | papel: gerente sem "Canais e Integrações" vê os 3 itens de nível `integrations` (SGP consultas, SGP Pix e boleto, OpenAI) — NÃO somem: ficam a 70%, `aria-disabled`, com cadeado | pages/settings/SettingsLayout.jsx:121,127,134 | (cadeado) | Continua sendo link clicável: leva à página "Sem acesso a …" em vez de ficar inerte |
| CFG-NAV-07 | hover-revela | motivo do cadeado dos itens restritos | pages/settings/SettingsLayout.jsx:122 | "Requer permissão de Canais e Integrações" (title) | Motivo só no `title` (hover): toque e teclado não veem |
| CFG-NAV-08 | hover-revela | descrição de cada item no `title` do link | pages/settings/SettingsLayout.jsx:88 (texto em navigation/navItems.js:35) | (ex.: "Conexão, status e atendimento de cada número de WhatsApp.") | — (a descrição reaparece no cabeçalho da página de destino) |
| CFG-NAV-09 | variante | item solo sem permissão | pages/settings/SettingsLayout.jsx:88,91 | "Acesso restrito" (title) + cadeado | — (inalcançável hoje: o único solo, Empresa, é nível admin) |
| CFG-NAV-10 | variante | cor do ícone do grupo por categoria (canais verde, automação lilás, integrações azul, demais cinza) | settings.css:19-22 | (ícone colorido) | — |
| CFG-NAV-11 | interação:hover | hover de grupo/item | pages/settings/SettingsLayout.jsx:88,103,126 | (fundo branco 5–6%) | — |
| CFG-NAV-12 | filtro-ativo | texto digitado em "Buscar configuração" troca a árvore por lista plana de resultados (rótulo + grupo embaixo) | pages/settings/SettingsLayout.jsx:48,69-81 | "Buscar configuração"; (rótulo + "WhatsApp e canais" em miúdo) | — |
| CFG-NAV-13 | busca-sem-resultado | nenhum item casa com o termo | pages/settings/SettingsLayout.jsx:71 | "Nenhuma configuração encontrada." | — |
| CFG-NAV-14 | variante | termo de 1–2 letras só casa PALAVRA inteira (`matchesTerm`) — ex.: "ca" não acha "Canais" | pages/settings/SettingsLayout.jsx:15-16,71 | "Nenhuma configuração encontrada." | (suspeita) Sem-resultado enganoso nas 2 primeiras letras de um prefixo |
| CFG-NAV-15 | variante | resultado de busca restrito | pages/settings/SettingsLayout.jsx:75,77 | "Acesso restrito" (title) + cadeado | Motivo só no `title`; e o link continua navegando |
| CFG-NAV-16 | interação:limpar busca | clicar num resultado navega e zera a busca | pages/settings/SettingsLayout.jsx:75 | — | — |
| CFG-NAV-17 | responsivo | < 1024px: árvore escondida (`hidden lg:block`), vira `<select>` "Seção" com optgroups (não há gaveta) | pages/settings/SettingsLayout.jsx:51-68,82 | "Seção" (sr-only) + nomes das seções | No select os itens restritos aparecem iguais aos outros — sem cadeado nem aviso; escolher um cai em "Sem acesso a …" |
| CFG-NAV-18 | variante | rota que não casa com nenhum item → opção desabilitada | pages/settings/SettingsLayout.jsx:59 | "Seção" | — |
| CFG-NAV-19 | responsivo | < 1024px com busca ativa: painel do menu limitado a 40vh | pages/settings/SettingsLayout.jsx:41 | — | — |
| CFG-NAV-20 | responsivo | ≤1023px: aside vira faixa de largura total com borda embaixo; ≥1024px coluna de 258px (a folha sem @layer vence o `lg:w-[264px]`) | pages/settings/settings.css:207 | — | — |
| CFG-NAV-21 | responsivo | ≥1024px: respiro lateral maior no cabeçalho e no corpo das páginas | settings.css:316-319 | — | — |

### Índice de Configurações — `pages/settings/SettingsIndex.jsx` (+ carregamento sob demanda das subpáginas)

Como se chega na tela: `/configuracoes` (rota index) ou qualquer troca de seção no menu.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-IDX-01 | interação:redirecionamento | `/configuracoes` → primeira seção permitida (na prática sempre "Números conectados") | pages/settings/SettingsIndex.jsx:10 | (sem tela) | — |
| CFG-IDX-02 | sem-permissão | nenhuma seção permitida | pages/settings/SettingsIndex.jsx:9 | "Sem acesso a {areaLabel}" | — (inalcançável: a rota-mãe já exige admin) |
| CFG-IDX-03 | carregando | trecho da subpágina ainda baixando (RotaLazy por rota; menu continua na tela) | components/RotaLazy.jsx:61 | (esqueleto de 4 linhas, sem texto visível) | — |
| CFG-IDX-04 | erro-com-retry | trecho não baixou (ex.: deploy novo) | components/RotaLazy.jsx:54 | "Não foi possível carregar esta parte do sistema. Recarregue a página para tentar de novo." | — |

### Casca das páginas — `pages/settings/SettingsShell.jsx` (+ `SettingsPage.jsx`, `SettingsVisuals.jsx`)

Como se chega na tela: toda página desta parte (lista de canais, detalhe de canal, Empresa) é embrulhada por ela.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-SHL-01 | sem-permissão | usuário abaixo do `level` da página (ProtectedRoute dentro da casca) | pages/settings/SettingsShell.jsx:56 (texto em pages/AccessDeniedPage.jsx:22) | "Sem acesso a {área}" + "Ir para o Atendimento" | — |
| CFG-SHL-02 | variante | texto do AccessDenied por nível `integrations` | pages/AccessDeniedPage.jsx:6-7,17 | "Esta área é liberada para administradores e para gerentes com a permissão "Pode gerenciar Canais e Integrações"…" | — |
| CFG-SHL-03 | variante | trilha: "Configurações › {grupo}"; `crumb={null}` → só "Configurações" | pages/settings/SettingsShell.jsx:60 | "Configurações" · "{segundo}" | — |
| CFG-SHL-04 | variante | `scope` presente → selo ao lado da ação | pages/settings/SettingsShell.jsx:64 (texto em components/ui/ScopeBadge.jsx:2) | "Toda a operação" / "Este canal" | — |
| CFG-SHL-05 | variante | título/descrição/ícone caem para o que `navItems` declara quando a página não passa | pages/settings/SettingsShell.jsx:61 | "{tituloFinal}" · "{descricaoFinal}" · "Configurações" | — |
| CFG-SHL-06 | variante | ícone do título por grupo (cores de canais/automação/integrações); nome desconhecido cai para `IconRules` | pages/settings/SettingsVisuals.jsx:18-24; settings.css:29-32 | (ícone 34×34) | — |
| CFG-SHL-07 | variante | páginas de canais: marca do WhatsApp no título desenhada por `mask:url(whatsapp.svg)` (esconde o ícone funcional) | pages/settings/channels/channels-polish.css:21-23 | (glifo WhatsApp 19px) | (suspeita) Mesmo mecanismo `mask`+`url()` que o próprio `ChannelVisuals.jsx:8-16` registra ter virado quadrado sólido no build de produção |
| CFG-SHL-08 | responsivo | largura do conteúdo por natureza: form 760 / wide 1024 / table 1280 (`data-width`) | pages/settings/SettingsShell.jsx:23-27,76 | — | — |

#### 7.1 WhatsApp e canais


### Números conectados (lista de canais) — `pages/settings/channels/ChannelsListPage.jsx` + `ChannelsTable.jsx`

Como se chega na tela: `/configuracoes/canais` (menu "WhatsApp e canais › Números conectados"; também o destino de `/configuracoes` e de `/admin/channels`). Nível da página: `admin`; ações de gestão: `integrations`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAN-01 | carregando | 1ª carga de `useChannels` (AsyncState) | pages/settings/channels/ChannelsListPage.jsx:65 | (esqueleto de 3 linhas, sem texto visível) | — |
| CFG-CAN-02 | erro-com-retry | falha em `listChannels` (AsyncState com `onRetry={refresh}`) | pages/settings/channels/ChannelsListPage.jsx:65 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | (leve) prop `error` não é passada: o motivo real do hook é descartado |
| CFG-CAN-03 | sem-permissão | API responde 403 | pages/settings/channels/ChannelsListPage.jsx:65 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-CAN-04 | recarregando | refresh após ação, após criar canal ou ao marcar "Mostrar ocultos" | hooks/useChannels.js:12 | AUSENTE | Recarga invisível: `useChannels` descarta `reloading`; a lista velha fica sem sinal até a nova chegar |
| CFG-CAN-05 | variante | papel com nível `integrations` → botão no cabeçalho | pages/settings/channels/ChannelsListPage.jsx:54-59 | "Adicionar canal" | Sem a permissão o botão SOME sem explicação (no detalhe o mesmo papel vê botões desabilitados com motivo) |
| CFG-CAN-06 | erro | falha de Reconectar/Ocultar/Reexibir/Excluir disparado pelo menu da linha (`errors.action`) | pages/settings/channels/ChannelsListPage.jsx:63 | "{actions.errors.action}" | Sem `role="alert"`; fica no topo até a próxima ação |
| CFG-CAN-07 | variante | faixa de resumo do parque | pages/settings/channels/ChannelsTable.jsx:280 | "Números" · "API oficial" · "Baileys" · "Neste filtro" | — |
| CFG-CAN-08 | filtro-ativo | texto em "Buscar por nome ou número" | pages/settings/channels/ChannelsTable.jsx:293-300 | "Buscar por nome ou número" | — |
| CFG-CAN-09 | filtro-ativo | select de tipo diferente de "Todos os tipos" | pages/settings/channels/ChannelsTable.jsx:302 | "Todos os tipos" · "Baileys" · "Meta Cloud" · "360dialog" | — |
| CFG-CAN-10 | filtro-ativo | checkbox "Mostrar ocultos" (grava `?ocultos=1` na URL e refaz a busca no servidor) | pages/settings/channels/ChannelsListPage.jsx:72-81 | "Mostrar ocultos" | (ver CFG-CAN-04: a troca não mostra que está recarregando) |
| CFG-CAN-11 | variante | contador da lista; com filtro mostra "de T" | pages/settings/channels/ChannelsTable.jsx:314 | "{visible.length} canal" · "{visible.length} canais" · "de {channels.length}" | — |
| CFG-CAN-12 | vazio | nenhum canal devolvido | pages/settings/channels/ChannelsTable.jsx:319 | "Nenhum canal cadastrado ainda." | Com todos os canais ocultos e "Mostrar ocultos" desligado a frase é falsa ("cadastrado ainda") e não aponta o "Mostrar ocultos" |
| CFG-CAN-13 | vazio-por-filtro | busca/tipo sem resultado (há canais) | pages/settings/channels/ChannelsTable.jsx:319 | "Nenhum canal com esse filtro." | — |
| CFG-CAN-14 | seleção | linha selecionada (`selectedId` → fundo cobre + traço) | pages/settings/channels/ChannelsTable.jsx:179-182; channels-polish.css:27 | AUSENTE (código morto: ninguém passa `selectedId`) | Todo `<li>` sai com `aria-selected="false"` — ARIA inválido em item de lista sem papel de opção |
| CFG-CAN-15 | variante | "detalhe embaixo" da tabela | pages/settings/channels/ChannelsListPage.jsx:66 | AUSENTE | — |
| CFG-CAN-16 | variante | tipo Baileys: marca do WhatsApp sem selo; linha de provedor | pages/settings/channels/ChannelsTable.jsx:197 | "{providerLabel(channel.type)}" · "{conexaoLabel(channel.type)}" | — |
| CFG-CAN-17 | variante | tipo Meta Cloud: marca + selo Meta azul | pages/settings/channels/ChannelsTable.jsx:197 | "{providerLabel(channel.type)}" · "{conexaoLabel(channel.type)}" | — |
| CFG-CAN-18 | variante | tipo 360dialog: marca + selo `<img>` 360dialog | pages/settings/channels/ChannelsTable.jsx:197 | "{providerLabel(channel.type)}" · "{conexaoLabel(channel.type)}" | — |
| CFG-CAN-19 | variante | tipo desconhecido: `IconServer`, rótulo cru do tipo | pages/settings/channels/ChannelVisuals.jsx:48-50; ChannelsTable.jsx:43-45 | (valor cru de `type`) | — (teórico) |
| CFG-CAN-20 | variante | Baileys `connected` | pages/settings/channels/ChannelsTable.jsx:116-119; channels-polish.css:34 | "Conectado" (ícone ✓ verde) | — |
| CFG-CAN-21 | variante | Baileys `awaiting_qr` | pages/settings/channels/ChannelsTable.jsx:116 (texto em pages/settings/channels/channelStatus.js:5) | "Aguardando QR code" (ícone QR âmbar) | — |
| CFG-CAN-22 | variante | Baileys `disconnected` | pages/settings/channels/ChannelsTable.jsx:116-119; channels-polish.css:36 | "Desconectado" (ícone alerta vermelho) | — |
| CFG-CAN-23 | variante | status fora de `STATUS_LABELS` → texto cru | pages/settings/channels/ChannelsTable.jsx:119 | (valor cru) | — (teórico: a migração só permite 3 valores) |
| CFG-CAN-24 | variante | oficial sem `connection` ou `state:'unknown'` (Meta sem resposta; 360dialog SEMPRE) | pages/settings/channels/ChannelsTable.jsx:70-77,86-88 | "Não verificada" (relógio) | — |
| CFG-CAN-25 | variante | oficial `connected` + qualidade (GREEN/YELLOW/RED; UNKNOWN sem chip) | pages/settings/channels/ChannelsTable.jsx:89-102 | "Conectado" + "Qualidade alta" / "Qualidade média" / "Qualidade baixa" | — |
| CFG-CAN-26 | variante | oficial `disconnected` | pages/settings/channels/ChannelsTable.jsx:104-110 | "Desconectado" | — |
| CFG-CAN-27 | erro | oficial `state:'error'` com o motivo da Meta | pages/settings/channels/ChannelsTable.jsx:109 | (motivo do servidor: código entre parênteses + texto da Meta, sem tradução no frontend) | Texto técnico cru (código + inglês) direto do backend (`src/channels/channel-connection.js:16`) |
| CFG-CAN-28 | variante | chips de atendimento (sem nenhum → "Humano") | pages/settings/channels/ChannelsTable.jsx:219 | "{label}" · "Humano" | — |
| CFG-CAN-29 | variante | avisos da linha (`channelSummary`) | pages/settings/channels/ChannelsTable.jsx:223 (texto em pages/settings/channels/channelSummary.js:6) | "Triagem por menu ligada sem opções cadastradas" / "IA ligada sem OpenAI configurada" / "Noturno ligado sem janela definida" | Calculados com os valores INICIAIS de `useTriage`/`useAiConfig`: aparecem falsamente enquanto esses hooks carregam e ficam para sempre se eles falharem (erro silencioso) |
| CFG-CAN-30 | variante | canal oculto (só com "Mostrar ocultos") | pages/settings/channels/ChannelsTable.jsx:182,195 | "… · oculto" (linha a 70%) | — |
| CFG-CAN-31 | interação:menu aberto | botão "⋯" da linha (RowMenu LOCAL, não o do DataTable) | pages/settings/channels/ChannelsTable.jsx:147-165,240-253 | "Mais ações para {nome}" → "Reconectar" (só Baileys) · "Ocultar"/"Reexibir" · "Excluir" | Menu próprio: sem `role="menu"`, sem foco no 1º item nem setas; `absolute` dentro da área rolável (suspeita: no último canal obriga a rolar) |
| CFG-CAN-32 | interação:menu aberto | "⋯" aberto (`aria-expanded=true`) e hover/foco do gatilho | pages/settings/channels/channels-polish.css:53-55 | (fundo branco 12%) | — |
| CFG-CAN-33 | desabilitado-sem-motivo | itens do menu enquanto a ação do canal roda (`busyChannelId`) | pages/settings/channels/ChannelsTable.jsx:242,246,250 | (itens a 50%) | Desabilitado sem motivo e sem "Excluindo…/Ocultando…" |
| CFG-CAN-34 | interação:tooltip | `title` do "⋯" | pages/settings/channels/ChannelsTable.jsx:150 | "Mais ações para {nome}" | — (repete o aria-label) |
| CFG-CAN-35 | interação:hover | hover/foco dentro da linha | pages/settings/channels/channels-polish.css:25-26 | (fundo da linha) | — |
| CFG-CAN-36 | confirmação | Reconectar canal Baileys que está `connected` | pages/settings/channels/useChannelActions.js:49-52 | "O canal "{nome}" está conectado. Reconectar vai derrubar a sessão atual e pedir um QR code novo. Continuar?" [Continuar, perigo] | — |
| CFG-CAN-37 | variante | Reconectar canal NÃO conectado → sem confirmação | pages/settings/channels/useChannelActions.js:48,55 | — | — |
| CFG-CAN-38 | confirmação | Ocultar | pages/settings/channels/useChannelActions.js:60-63 | "Ocultar o canal "{nome}"? Ele sai da lista e a sessão do WhatsApp é encerrada. O histórico é preservado." [Ocultar, perigo] | — |
| CFG-CAN-39 | confirmação | Reexibir | pages/settings/channels/useChannelActions.js:62-63 | "Reexibir o canal "{nome}"?" [Reexibir] | Ação não destrutiva sai com `danger:true` (ícone de alerta + botão vermelho) |
| CFG-CAN-40 | confirmação | Excluir | pages/settings/channels/useChannelActions.js:69-72 | "Excluir o canal "{nome}" definitivamente? Só é possível se ele nunca teve conversas." [Excluir, perigo] | — |
| CFG-CAN-41 | sucesso | ação da linha concluída | pages/settings/channels/useChannelActions.js:38-39 | AUSENTE (só o dado muda; canal ocultado simplesmente some da lista) | (leve) Sem retorno de sucesso |
| CFG-CAN-42 | confirmação | "Desconectar" | pages/settings/channels/ChannelsTable.jsx:240 | AUSENTE | — |
| CFG-CAN-43 | tempo-real | queda/conexão de um número enquanto a lista está aberta | pages/settings/channels/ChannelsListPage.jsx:33 | AUSENTE (sem socket nem polling na lista) | (suspeita) Status da lista fica velho até recarregar |
| CFG-CAN-44 | responsivo | container ≥860px: 3 colunas (identidade / atendimento / ações); ≤650px: 1 coluna, ações na 4ª linha | settings.css:158-167,208,210-216 | — | — (as classes `sm:`/`lg:grid-cols` do JSX `ChannelsTable.jsx:180` são vencidas pela folha sem @layer) |
| CFG-CAN-45 | interação:abrir modal | "Adicionar canal" | pages/settings/channels/ChannelsListPage.jsx:88 | "Adicionar canal" | — |

### Criar canal (modal) — `components/CreateChannelModal.jsx` + `components/CreateChannelForm.jsx`

Como se chega na tela: botão "Adicionar canal" em Números conectados (só nível `integrations`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-NOVO-01 | variante | passo 1: escolha do tipo | components/CreateChannelModal.jsx:29-43 | "Criar canal" / "Escolha a conexão. Depois, preencha os dados do número." + 3 cartões | — |
| CFG-NOVO-02 | variante | cartões do passo 1 por tipo | components/CreateChannelModal.jsx:6-22,38-40 | "Baileys (não oficial)" / "Meta Cloud (oficial)" / "360dialog (oficial via BSP)" + descrição | — |
| CFG-NOVO-03 | interação:hover | hover no cartão | components/overlays.css:39 | (borda cobre) | — |
| CFG-NOVO-04 | variante | passo 2 por tipo: título e lateral | components/CreateChannelModal.jsx:51 | "Criar canal — {selected.label}" · "{selected.label}" · "{selected.description}" | — |
| CFG-NOVO-05 | interação:voltar | "← Voltar" volta ao passo 1 (desmonta o formulário) | components/CreateChannelModal.jsx:57-63 | "← Voltar" | (leve) Descarta o que foi digitado sem aviso |
| CFG-NOVO-06 | interação:fechar | "×"/Esc (Dialog `dismissible`; clique fora não fecha) | components/ui/Dialog.jsx:304-315 | "Fechar" (aria-label/title) | (leve, suspeita) Fecha com o formulário preenchido sem confirmar |
| CFG-NOVO-07 | variante | Baileys: só Nome e Telefone | components/CreateChannelForm.jsx:50-68 | "Nome" / "Telefone" (placeholder "+5511999998888") | — |
| CFG-NOVO-08 | variante | Meta Cloud: + Phone Number ID, WABA ID, Access Token | components/CreateChannelForm.jsx:69-102 | "Phone Number ID" / "WABA ID" / "Access Token" | — |
| CFG-NOVO-09 | variante | 360dialog: + API Key e WABA ID | components/CreateChannelForm.jsx:103-118 | "API Key (D360-API-KEY)" / "WABA ID" | — |
| CFG-NOVO-10 | interação:campo secreto | Access Token / API Key mascarado e "revelar" | components/CreateChannelForm.jsx:93-99,109 | AUSENTE (input de texto comum) | Segredo aparece em claro enquanto é digitado; sem `type=password` nem botão revelar |
| CFG-NOVO-11 | validação | campos `required` vazios | components/CreateChannelForm.jsx:54,66,80,87,98,109,115 | (balão nativo do navegador) | (leve) Só validação nativa; nada de mensagem própria nem `aria-invalid` |
| CFG-NOVO-12 | salvando | envio em curso (`Button loading`) | components/CreateChannelForm.jsx:126 | "Cadastrar" (a 50%, `aria-busy`) | Sem texto/indicador de progresso; "Cancelar" segue ativo |
| CFG-NOVO-13 | erro | `createChannel` falha (ex.: telefone repetido, Meta desmente os dados) | components/CreateChannelForm.jsx:119 | (mensagem da API) / "Falha ao cadastrar canal" | Sem `role="alert"` |
| CFG-NOVO-14 | sucesso | canal criado → modal fecha e lista recarrega | pages/settings/channels/ChannelsListPage.jsx:90-93 | AUSENTE (nenhuma mensagem) | (suspeita) No Baileys não leva ao QR: o canal só aparece na lista e é preciso abrir "Configurar" |
| CFG-NOVO-15 | responsivo | ≤600px: cartões em coluna única; lateral vai para cima do formulário; formulário em 2 colunas com token/API key em linha inteira | components/overlays.css:46-55 | — | — |

### Detalhe do canal (moldura) — `pages/settings/channels/ChannelDetailPage.jsx`

Como se chega na tela: "Configurar" ou nome do canal na lista → `/configuracoes/canais/:id` (redireciona para `/conexao`, `App.jsx:165`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-DET-01 | carregando | 1ª carga de `useChannels(true, true)` | pages/settings/channels/ChannelDetailPage.jsx:42 | (esqueleto 3 linhas) | — |
| CFG-DET-02 | erro-com-retry | falha em `listChannels` | pages/settings/channels/ChannelDetailPage.jsx:42 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | Qualquer recarga que falhe (polling de 5 s, refresh pós-ação) põe status `error` mesmo com dados e troca a página INTEIRA — inclusive o QR — pelo erro; motivo real descartado |
| CFG-DET-03 | sem-permissão | API 403 | pages/settings/channels/ChannelDetailPage.jsx:42 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | (leve) Fala em "lista" numa página de detalhe |
| CFG-DET-04 | recarregando | polling / refresh pós-ação | hooks/useChannels.js:12 | AUSENTE | — (ver CFG-ATE-13 para o efeito nos toggles) |
| CFG-DET-05 | variante | barra "← Todos os canais" + seletor "Trocar de canal (N)" | pages/settings/channels/ChannelDetailPage.jsx:46 | "← Todos os canais" · "Trocar de canal ({channels.length})" | (leve) Canais ocultos entram no seletor sem marca de oculto |
| CFG-DET-06 | interação:trocar de canal | escolher outro no seletor (mantém a aba; nada remonta) | pages/settings/channels/ChannelDetailPage.jsx:50 | — | Erros de `useChannelActions`, o `<details>` "Ações avançadas" aberto e o formulário de credenciais (com tokens digitados) passam para o canal seguinte |
| CFG-DET-07 | vazio | id da URL não existe | pages/settings/channels/ChannelDetailPage.jsx:60 | "Canal não encontrado." · "Voltar para a lista" | O seletor acima mostra o 1º canal como se fosse o atual (React marca a 1ª opção quando o value não casa) |
| CFG-DET-08 | sucesso | "Excluir" confirmado com sucesso na própria página → refresh → o canal some | pages/settings/channels/ChannelDetailPage.jsx:60 | "Canal não encontrado." · "Voltar para a lista" | Sucesso da exclusão aparece como "não encontrado": sem confirmação e sem voltar à lista |
| CFG-DET-09 | variante | cabeçalho do canal: ícone, nome, selo, "telefone · provedor", status | pages/settings/channels/ChannelDetailPage.jsx:70 | "{channel.name}" · "{formatPhone(channel.phoneNumber)}" · "{providerLabel(channel.type)}" | (leve) `ChannelIcon` sem `type`: ícone genérico em vez da marca do provedor que a lista mostra |
| CFG-DET-10 | variante | canal oculto aberto no detalhe | pages/settings/channels/ChannelDetailPage.jsx:70-82 | AUSENTE (nenhuma sinalização) | Só o rótulo "Reexibir" dentro de "Ações avançadas" (fechado) denuncia que está oculto |
| CFG-DET-11 | variante | status no cabeçalho: mesmas variantes CFG-CAN-20…27 | pages/settings/channels/ChannelDetailPage.jsx:81 | "Conectado" / "Aguardando QR code" / "Desconectado" / "Não verificada" / qualidade | — |
| CFG-DET-12 | hover-revela | oficial com erro: motivo cortado em 22ch (fora de `.settings-channel-center` o `max-w-[22ch] truncate` vale); inteiro só no `title` | pages/settings/channels/ChannelsTable.jsx:106 | (motivo do servidor cortado em 22ch; inteiro só no title) | Motivo completo só por hover, e é texto técnico cru |
| CFG-DET-13 | seleção | abas de rota "Conexão" / "Atendimento" (`aria-current`, traço laranja) | pages/settings/channels/ChannelDetailPage.jsx:84-91 | "Conexão" / "Atendimento" | — |
| CFG-DET-14 | tempo-real | `awaiting_qr` → refresh a cada 5 s até virar "Conectado" | pages/settings/channels/ChannelDetailPage.jsx:27-31 | (status muda sozinho) | — |
| CFG-DET-15 | tempo-real | canal conectado/oficial que cai com a página aberta | pages/settings/channels/ChannelDetailPage.jsx:28 | AUSENTE (polling só em `awaiting_qr`) | (suspeita) Queda não aparece até recarregar |
| CFG-DET-16 | variante | título da casca | pages/settings/channels/ChannelDetailPage.jsx:34-40 | "Canais WhatsApp" (trilha só "Configurações") | (leve) Na lista a mesma área se chama "Números conectados" com trilha "WhatsApp e canais" |
| CFG-DET-17 | sem-permissão | gerente sem `integrations` abre o detalhe (página é nível `admin`) → modo leitura nas abas | pages/settings/channels/ChannelDetailPage.jsx:19 | (ver CFG-CON-01 / CFG-ATE-01) | — |
| CFG-DET-18 | responsivo | barra de troca quebra linha; cabeçalho `sm:px-5` | pages/settings/channels/ChannelDetailPage.jsx:43,70,93 | — | — |

### Aba Conexão — `pages/settings/channels/ChannelConnectionTab.jsx` + `components/QrCodeView.jsx`

Como se chega na tela: `/configuracoes/canais/:id/conexao` (aba padrão do detalhe).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CON-01 | variante | papel sem `integrations` | pages/settings/channels/ChannelConnectionTab.jsx:190-192 | "Requer permissão de Canais e Integrações" (faixa âmbar) | — |
| CFG-CON-02 | variante | texto "Estado da conexão" — oficial (Meta e 360dialog) | pages/settings/channels/ChannelConnectionTab.jsx:204-205 | "API oficial identifica o tipo de conexão. O status operacional é confirmado pelo provedor, não por este sistema." | (suspeita) Desatualizado para Meta Cloud, que hoje É verificado pelo sistema (o cabeçalho mostra "Conectado"/qualidade) |
| CFG-CON-03 | variante | texto — Baileys `awaiting_qr` | pages/settings/channels/ChannelConnectionTab.jsx:206-207 | "Leia o QR code abaixo no WhatsApp do número deste canal. A situação muda para "Conectado" sozinha…" | — |
| CFG-CON-04 | variante | texto — Baileys `connected` | pages/settings/channels/ChannelConnectionTab.jsx:208-209 | "O WhatsApp deste número está ligado a este sistema. Se cair, use "Reconectar" em Ações avançadas." | — |
| CFG-CON-05 | variante | texto — Baileys `disconnected` | pages/settings/channels/ChannelConnectionTab.jsx:210 | "O WhatsApp deste número não está ligado. Use "Reconectar" em Ações avançadas para gerar um novo QR code." | — |
| CFG-CON-06 | variante | QR só existe em `awaiting_qr`; nos demais o bloco some | components/QrCodeView.jsx:49 | — | — |
| CFG-CON-07 | carregando | buscando o QR | components/QrCodeView.jsx:57-58,75-76 | "Gerando QR code…" (role=status) + "Buscando o código no servidor." | — |
| CFG-CON-08 | variante | QR pronto | components/QrCodeView.jsx:54-55,69-70,81 | (imagem, alt "QR code para conectar {nome}") + "Abra o WhatsApp no celular deste número, vá em Aparelhos conectados e leia o código…" + "Atualizar código" | — |
| CFG-CON-09 | vazio | 404: canal aguardando mas sem QR | components/QrCodeView.jsx:59,71-72,81 | "Nenhum QR code disponível agora." + "O canal está aguardando leitura, mas o código ainda não chegou. Gere um novo pelo "Reconectar", em Ações avançadas." + "Tentar de novo" | — |
| CFG-CON-10 | sem-permissão | 401/403 no QR | components/QrCodeView.jsx:60,73-74,79 | "Sua conta não tem acesso às credenciais deste canal." + "Peça a um administrador com acesso a Canais e Integrações." (sem botão) | — |
| CFG-CON-11 | erro-com-retry | resposta sem data URI de imagem | components/QrCodeView.jsx:61,77,81 | "O servidor respondeu num formato que esta tela não reconhece." + "Tentar de novo" | (leve) Erro anunciado com `role="status"` (educado), não `alert` |
| CFG-CON-12 | erro-com-retry | falha de rede ou HTTP ≠ 404/401/403 | components/QrCodeView.jsx:62,77,81 | "Não foi possível buscar o QR code." + "Tente de novo. Se continuar, gere um novo código pelo "Reconectar", em Ações avançadas." + "Tentar de novo" | (leve) Erro anunciado com `role="status"` (educado), não `alert` |
| CFG-CON-13 | variante | QR expirado | components/QrCodeView.jsx:16-18 | AUSENTE (decisão registrada: backend não expõe validade) | (suspeita) A imagem não se renova sozinha: o polling de 5 s recarrega o canal mas não o QR (efeito depende só de id/status/token/tentativa); o Baileys troca o código e o da tela envelhece sem aviso até clicar "Atualizar código" |
| CFG-CON-14 | interação:atualizar QR | "Atualizar código"/"Tentar de novo" refaz o QR e recarrega o canal | components/QrCodeView.jsx:80 | "Atualizar código" / "Tentar de novo" | — |
| CFG-CON-15 | tempo-real | celular leu o QR → polling troca status: QR some, texto vira o de conectado, cabeçalho "Conectado" | pages/settings/channels/ChannelDetailPage.jsx:27-31; components/QrCodeView.jsx:49 | "Conectado" | — (sucesso só implícito) |
| CFG-CON-16 | responsivo | container ≤520px: QR empilhado e centralizado | pages/settings/channels/channels-polish.css:72 | — | — |
| CFG-CON-17 | variante | linhas de identificação (Nome, Provedor, Tipo, Número) | pages/settings/channels/ChannelConnectionTab.jsx:221-241 | "Nome" / "Provedor" / "Tipo" / "Número" | — |
| CFG-CON-18 | variante | linha "Tipo" | pages/settings/channels/ChannelConnectionTab.jsx:240 | "API oficial" / "Não oficial" | (leve) 360dialog aparece "API oficial" aqui e "BSP oficial" na lista |
| CFG-CON-19 | variante | linha WABA só em oficial; vazia | pages/settings/channels/ChannelConnectionTab.jsx:242-259 | "Identificador da conta (WABA)" / "não informado" | — |
| CFG-CON-20 | desabilitado-com-motivo | "Editar nome" / "Editar" (WABA) sem `integrations` | pages/settings/channels/ChannelConnectionTab.jsx:229-230,250-251 | "Requer permissão de Canais e Integrações" (title + faixa CFG-CON-01) | — |
| CFG-CON-21 | edição-inline | "Editar nome" → campo no lugar | pages/settings/channels/ChannelConnectionTab.jsx:262-288 | "Nome do canal" + "Cancelar" / "Salvar nome" | — |
| CFG-CON-22 | desabilitado-sem-motivo | "Salvar nome" com o campo vazio | pages/settings/channels/ChannelConnectionTab.jsx:283 | "Salvar nome" (a 50%) | Sem dizer que o nome não pode ficar vazio |
| CFG-CON-23 | salvando | salvando o nome | pages/settings/channels/ChannelConnectionTab.jsx:180-183 | AUSENTE | Botão segue ativo durante a chamada (duplo envio), sem indicador |
| CFG-CON-24 | erro | renomear falha (`errors.name`) | pages/settings/channels/ChannelConnectionTab.jsx:290 (texto em pages/settings/channels/useChannelActions.js:136) | (mensagem da API) / "Falha ao renomear o canal" | Sem `role="alert"`; e o editor FECHA mesmo no erro (`saveChannelName` engole a exceção e `setEditingName(false)` sempre roda) — erro e sucesso parecem iguais |
| CFG-CON-25 | edição-inline | "Editar" WABA → campo no lugar | pages/settings/channels/ChannelConnectionTab.jsx:292-315 | "Identificador da conta (WABA ID)" + "Cancelar" / "Salvar WABA ID" | — |
| CFG-CON-26 | salvando | salvando WABA ID | pages/settings/channels/ChannelConnectionTab.jsx:175-178 | AUSENTE | "Salvar WABA ID" segue ativo durante a chamada (duplo envio), sem indicador |
| CFG-CON-27 | erro | WABA falha (`errors.wabaId`) | pages/settings/channels/ChannelConnectionTab.jsx:316 (texto em pages/settings/channels/useChannelActions.js:146) | (mensagem da API) / "Falha ao atualizar o WABA ID" | Sem `role="alert"`; editor fecha mesmo no erro |
| CFG-CON-28 | sucesso | nome/WABA salvos → editor fecha, dado recarrega | pages/settings/channels/ChannelConnectionTab.jsx:176-182 | AUSENTE (nenhuma mensagem) | — (ver CFG-CON-24) |
| CFG-CON-29 | variante | bloco "Configurações relacionadas" | pages/settings/channels/ChannelConnectionTab.jsx:321-331 | "Quem atende neste canal — humano, triagem por menu, IA e atendimento noturno — fica na aba Atendimento." + "Abrir Atendimento deste canal →" | — |
| CFG-CON-30 | expandido | `<details>` "Ações avançadas" (fechado por padrão; chevron gira) | pages/settings/channels/ChannelConnectionTab.jsx:334-343 | "Ações avançadas" | — |
| CFG-CON-31 | variante | resumo do `<summary>` por tipo | pages/settings/channels/ChannelConnectionTab.jsx:342 | "{advancedActions(channel.type).summary}" | — |
| CFG-CON-32 | variante | DangerZone "Ações com cuidado" + descrição por tipo | pages/settings/channels/ChannelConnectionTab.jsx:345 (texto em components/ui/DangerZone.jsx:3) | "Ações com cuidado" + ex. Baileys "Migrar troca o provedor deste número sem perder o histórico; reconectar gera um novo QR code; ocultar tira o canal da lista sem apagar nada; excluir só é possível se o canal nunca teve conversas." | — |
| CFG-CON-33 | resumo↔formulário | botão de credenciais abre o formulário no lugar | pages/settings/channels/ChannelConnectionTab.jsx:48-59,61-104 | "Atualizar credenciais" (Meta) / "Migrar para Meta Cloud" (Baileys, 360dialog) | — |
| CFG-CON-34 | desabilitado-com-motivo | esse botão sem `integrations` | pages/settings/channels/ChannelConnectionTab.jsx:53-54 | "Requer permissão de Canais e Integrações" (title) | — |
| CFG-CON-35 | variante | nota do formulário: atualizar x migrar | pages/settings/channels/ChannelConnectionTab.jsx:63-67 | "Use isto quando o Access Token for rotacionado ou revogado…" / "O número {tel} precisa estar no Cloud API da Meta antes disso…" | — |
| CFG-CON-36 | interação:campo secreto | Access Token mascarado/"revelar" | pages/settings/channels/ChannelConnectionTab.jsx:77-85 | AUSENTE (input de texto comum) | Token em claro na tela enquanto é digitado |
| CFG-CON-37 | variante | credencial já salva exibida mascarada (ex. "••••1234") | pages/settings/channels/ChannelConnectionTab.jsx:242 | AUSENTE | — (não há como ver se há token salvo) |
| CFG-CON-38 | validação | Phone Number ID / Access Token / WABA ID vazios (`required`) | pages/settings/channels/ChannelConnectionTab.jsx:74,83,92 | (balão nativo do navegador) | (leve) Só validação nativa |
| CFG-CON-39 | salvando | conferindo credenciais com a Meta | pages/settings/channels/ChannelConnectionTab.jsx:97,100 | "Cancelar" e "Salvar"/"Migrar" a 50% | Desabilitados sem texto de progresso (a conferência com a Meta pode demorar) |
| CFG-CON-40 | erro | Meta recusa/erro de rede | pages/settings/channels/ChannelConnectionTab.jsx:95 | ex.: "Nenhum app está inscrito no webhook dessa WABA, então as mensagens não chegariam." / "Não foi possível salvar as credenciais deste canal" | Sem `role="alert"` |
| CFG-CON-41 | sucesso | credenciais salvas → formulário fecha e recarrega; na migração a página inteira muda de variante (Reconectar some, resumo vira o de Meta) | pages/settings/channels/ChannelConnectionTab.jsx:39-40 | AUSENTE (nenhuma mensagem) | (leve) Sem retorno de sucesso numa troca de provedor |
| CFG-CON-42 | variante | "Reconectar" só em Baileys | pages/settings/channels/ChannelConnectionTab.jsx:351-360 | "Reconectar" | — |
| CFG-CON-43 | variante | Ocultar x Reexibir | pages/settings/channels/ChannelConnectionTab.jsx:361-368 | "Ocultar" / "Reexibir" | — |
| CFG-CON-44 | desabilitado-com-motivo | Reconectar/Ocultar/Excluir sem `integrations` | pages/settings/channels/ChannelConnectionTab.jsx:356,365,373 | "Requer permissão de Canais e Integrações" (title) | — |
| CFG-CON-45 | desabilitado-sem-motivo | Reconectar/Ocultar/Excluir com a ação em curso (`busy`) | pages/settings/channels/ChannelConnectionTab.jsx:355,364,372 | (botões a 50%) | Sem motivo nem texto de progresso |
| CFG-CON-46 | confirmação | as 4 confirmações de CFG-CAN-36/38/39/40 disparadas daqui (mesmos textos; ConfirmDialog em `ChannelDetailPage.jsx:99`) | pages/settings/channels/useChannelActions.js:49-72 | (ver CFG-CAN-36…40) | (ver CFG-CAN-39: Reexibir com `danger`) |
| CFG-CON-47 | erro | ação avançada falha (`errors.action`) | pages/settings/channels/ChannelConnectionTab.jsx:379 | "{actions.errors.action}" | Sem `role="alert"` |
| CFG-CON-48 | interação:copiar webhook | URL do webhook + "copiado" | pages/settings/channels/ChannelConnectionTab.jsx:205 | AUSENTE | (suspeita) Meta Cloud: a URL do webhook não aparece na tela do canal (só a menção sem URL na :66) nem há ação de copiar; no 360dialog não faz falta, o webhook é registrado sozinho no cadastro |
| CFG-CON-49 | interação:trocar de canal | seletor de canal com o formulário de credenciais aberto | pages/settings/channels/ChannelConnectionTab.jsx:25-32 | — | `MetaCloudCredentialsForm` não zera `open`/campos/erro ao mudar `channel.id`: o token digitado para o canal A fica pronto para enviar no canal B |

### Aba Atendimento — `pages/settings/channels/ChannelBehaviorTab.jsx`

Como se chega na tela: aba "Atendimento" do detalhe, ou link "Abrir Atendimento deste canal →" → `/configuracoes/canais/:id/atendimento`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-ATE-01 | variante | papel sem `integrations` | pages/settings/channels/ChannelBehaviorTab.jsx:61-63 | "Requer permissão de Canais e Integrações" | — |
| CFG-ATE-02 | erro | falha em Triagem por menu | pages/settings/channels/ChannelBehaviorTab.jsx:64 | "{actions.errors.triage}" | Sem `role="alert"`; aparece no topo, longe do toggle; persiste na troca de canal |
| CFG-ATE-03 | erro | falha em Atendimento com IA | pages/settings/channels/ChannelBehaviorTab.jsx:65 (texto em pages/settings/channels/useChannelActions.js:104) | "Falha ao atualizar a IA deste canal" | Sem `role="alert"`; no topo, longe do toggle; persiste na troca de canal |
| CFG-ATE-04 | erro | falha em Triagem com IA | pages/settings/channels/ChannelBehaviorTab.jsx:66 | "{actions.errors.aiTriage}" | Sem `role="alert"`; no topo, longe do toggle; persiste na troca de canal |
| CFG-ATE-05 | erro | falha em Atendimento noturno | pages/settings/channels/ChannelBehaviorTab.jsx:67 (texto em pages/settings/channels/useChannelActions.js:126) | "Falha ao atualizar o atendimento noturno deste canal" | Sem `role="alert"`; no topo, longe do toggle; persiste na troca de canal |
| CFG-ATE-06 | variante | toggle "Triagem por menu" | pages/settings/channels/ChannelBehaviorTab.jsx:72-79 | "Triagem por menu" | — |
| CFG-ATE-07 | variante | toggle "Atendimento com IA" com descrição | pages/settings/channels/ChannelBehaviorTab.jsx:80-88 | "Atendimento com IA" / "Ligar a IA desliga a triagem por menu neste canal: só um robô responde por vez." | — |
| CFG-ATE-08 | variante | ligar a IA também desliga a triagem (2 chamadas; refresh sempre) | pages/settings/channels/useChannelActions.js:96-108 | (Triagem por menu desmarca sozinha) | — |
| CFG-ATE-09 | desabilitado-com-motivo | qualquer toggle sem `integrations` | pages/settings/channels/ChannelBehaviorTab.jsx:76-77,84-85; components/ui/Toggle.jsx:25-29 | "Requer permissão de Canais e Integrações" (texto âmbar abaixo, aria-describedby) | — |
| CFG-ATE-10 | desabilitado-com-motivo | "Triagem com IA" com a IA desligada | pages/settings/channels/ChannelBehaviorTab.jsx:43-44,93-94 | "Precisa de Atendimento com IA ligado" | — |
| CFG-ATE-11 | desabilitado-com-motivo | "Atendimento noturno" sem Triagem com IA | pages/settings/channels/ChannelBehaviorTab.jsx:49-50,101-102 | "Precisa de Triagem com IA ligada" | — |
| CFG-ATE-12 | desabilitado-com-motivo | "Atendimento noturno" sem janela noturna | pages/settings/channels/ChannelBehaviorTab.jsx:51-56,101-102 | "Defina a janela em Automação e IA › Atendimento noturno" (link) | Enquanto `useAiConfig` carrega (ou se falhar) a janela conta como indefinida: toggle desabilitado com motivo FALSO |
| CFG-ATE-13 | salvando | clique em qualquer um dos 4 toggles | pages/settings/channels/ChannelBehaviorTab.jsx:75,83,91,99 | AUSENTE | Checkbox é controlado pelo dado do canal: o clique não muda nada até o refresh voltar, sem indicador; permite cliques repetidos |
| CFG-ATE-14 | variante | noturno já ligado sem pré-requisitos continua clicável (só para desligar) | pages/settings/channels/ChannelBehaviorTab.jsx:101 | "Atendimento noturno" | — |
| CFG-ATE-15 | sucesso | toggle salvo → marca vira após o refresh | pages/settings/channels/useChannelActions.js:81,113,123 | AUSENTE (nenhuma mensagem) | — |
| CFG-ATE-16 | variante | resumo "Configurações globais que valem para este canal" (links) | pages/settings/channels/ChannelBehaviorTab.jsx:108 | "Configurações globais que valem para este canal" · "Triagem por menu" · "Boas-vindas" · "Horário de atendimento" · "Janela noturna" · "OpenAI" | (leve) Horário cadastrado mas desligado aparece como "não configurado" (:38); "Erro" nunca aparece (hasError:false fixo, :33) |
| CFG-ATE-17 | carregando | `useTriage`/`useAiConfig`/`useBusinessHoursConfig` ainda carregando | pages/settings/channels/ChannelBehaviorTab.jsx:28-39 | AUSENTE — mostra "sem opções", "não configurado", "não definida", "Desativada" | Valores falsos durante a carga; se algum hook falhar ficam para sempre (erro silencioso) |
| CFG-ATE-18 | variante | Boas-vindas mostra a mensagem inteira na linha | pages/settings/channels/ChannelBehaviorTab.jsx:37,112 | "{mensagem de boas-vindas completa}" | (leve, suspeita) Mensagem longa estica a linha do resumo (sem truncar) |
| CFG-ATE-19 | responsivo | toggles e resumo em 2 colunas a partir de `md`; bloco em 2 colunas em container ≥860px | pages/settings/channels/ChannelBehaviorTab.jsx:71,110; settings.css:187 | — | — |

#### 7.2 Atendimento (horário, boas-vindas, abertura e encerramento)


### Horário de atendimento — `pages/settings/rules/BusinessHoursPage.jsx` + `components/messages/BusinessHoursSection.jsx`

Como se chega na tela: Configurações › Atendimento › Horário de atendimento (`/configuracoes/regras/horario`). É uma configuração única. Os dias são fixos no backend: sábado e domingo são sempre fora do horário.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-HOR-01 | variante | `scope="global"` → selo no cabeçalho | pages/settings/rules/BusinessHoursPage.jsx:7 (texto em components/ui/ScopeBadge.jsx:2) | "Toda a operação" | — |
| CFG-HOR-02 | sem-permissão | abaixo de admin/gerente | App.jsx:157 | "Sem acesso a {areaLabel}" | — |
| CFG-HOR-03 | responsivo | grid de 220px + conteúdo; com contêiner ≤650px vira 1 coluna | pages/settings/settings.css:208 | (intro à esquerda) | — |
| CFG-HOR-04 | carregando | 1ª carga | components/messages/BusinessHoursSection.jsx:119 | (esqueleto de 2 linhas) | — |
| CFG-HOR-05 | erro | falha ao carregar (sem `onRetry`) | components/messages/BusinessHoursSection.jsx:119 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | sem "Tentar de novo" e sem saída (o Editar fica dentro do AsyncState); `error` não é passado |
| CFG-HOR-06 | sem-permissão | 403 | components/messages/BusinessHoursSection.jsx:119 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | texto fala em "lista" numa configuração |
| CFG-HOR-07 | vazio | `config.id === null` | components/messages/BusinessHoursSection.jsx:122 | "Horário de atendimento" / "Nenhum horário configurado ainda." + "Criar horário de atendimento" | — |
| CFG-HOR-08 | variante | configurado | components/messages/BusinessHoursSection.jsx:129 | "Das {início} às {fim}, segunda a sexta" | — (a mensagem fora do expediente não aparece no resumo) |
| CFG-HOR-09 | variante | ativo ou inativo | components/messages/BusinessHoursSection.jsx:133 | "Ativo" / "Inativo" | — |
| CFG-HOR-10 | resumo↔formulário | "Editar" ou "Criar horário…" | components/messages/BusinessHoursSection.jsx:58 | "Editar horário de atendimento" / "Disponibilidade humana e aviso fora do expediente." | — (o título diz "Editar" também ao criar) |
| CFG-HOR-11 | variante | criar: vem 08:00–18:00 com "Ativo" desmarcado (EMPTY_CONFIG) | components/messages/BusinessHoursSection.jsx:67 | (checkbox "Ativo" desmarcado) | (suspeita) horário recém-criado nasce Inativo sem aviso |
| CFG-HOR-12 | variante | o formulário não fala dos dias da semana (fixos em seg–sex) | components/messages/BusinessHoursSection.jsx:71 | AUSENTE ("segunda a sexta" só aparece no resumo) | — |
| CFG-HOR-13 | validação | hora vazia (`type=time required`) | components/messages/BusinessHoursSection.jsx:75 | (balão nativo) | — |
| CFG-HOR-14 | validação | fim ≤ início (inclui janela que vira a meia-noite) | components/messages/BusinessHoursSection.jsx:104 | (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js) | sem checagem no formulário; inglês cru; não explica que janela noturna é impossível |
| CFG-HOR-15 | validação | formato inválido (navegador sem suporte a `type=time`) | components/messages/BusinessHoursSection.jsx:104 | (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js) | (suspeita) inglês cru |
| CFG-HOR-16 | validação | mensagem só com espaços | components/messages/BusinessHoursSection.jsx:104 | "O campo \"{m[1]}\" é obrigatório." | nome técnico do campo em inglês |
| CFG-HOR-17 | validação | erro por campo (Field aceita `error`, mas não é usado) | components/messages/BusinessHoursSection.jsx:72 | AUSENTE | — (todos os erros vão para a faixa geral) |
| CFG-HOR-18 | salvando | salvando | components/messages/BusinessHoursSection.jsx:109 | ("Salvar" esmaecido) | — |
| CFG-HOR-19 | erro | falha ao salvar | components/messages/BusinessHoursSection.jsx:104 | "Falha ao salvar" | `<p>` sem role="alert" |
| CFG-HOR-20 | sucesso | salvou → `savedConfig` | components/messages/BusinessHoursSection.jsx:46 | (resumo novo; nenhum "Salvo") | — |
| CFG-HOR-21 | recarregando | `refresh()` depois de salvar | components/messages/BusinessHoursSection.jsx:48 | AUSENTE | se a recarga falhar, o resumo é trocado pelo erro sem retry |

### Casca de Mensagens e peça compartilhada — `pages/settings/messages/MessagesLayout.jsx`, `components/messages/StatusDot.jsx`

Como se chega na tela: menu Configurações. As rotas `/configuracoes/mensagens/*` ficam em dois grupos do menu: "Atendimento" (Boas-vindas, Abertura e encerramento) e "Mensagens" (Avisos por cidade, Respostas rápidas, Templates WhatsApp). O índice redireciona para `boas-vindas`, e `/configuracoes/regras/atribuicao` redireciona para `abertura-encerramento`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-01 | variante | rota `boas-vindas` ou `abertura-encerramento` → trilha "Atendimento"; demais → "Mensagens" | pages/settings/messages/MessagesLayout.jsx:16 | "Atendimento" · "Mensagens" | — |
| CFG-MSG-02 | variante | item da navegação sem `description` | pages/settings/messages/MessagesLayout.jsx:17 | "Organize os textos usados pela equipe e pelas automações." | — |
| CFG-MSG-03 | sem-permissão | usuário abaixo de admin/gerente (ProtectedRoute da casca) | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-MSG-04 | responsivo | casca `width="wide"` | pages/settings/messages/MessagesLayout.jsx:18 | (conteúdo limitado a 1024px) | — |
| CFG-MSG-05 | variante | `enabled=true` (usado em avisos por cidade, abertura/encerramento e horário) | components/messages/StatusDot.jsx:4 | "Ativo" (ponto verde) | — |
| CFG-MSG-06 | variante | `enabled=false` | components/messages/StatusDot.jsx:4 | "Inativo" (ponto cinza) | — |

### Boas-vindas — `pages/settings/messages/WelcomePage.jsx` + `components/messages/ChannelWelcomeMessageRow.jsx`

Como se chega na tela: Configurações › Atendimento › Boas-vindas (`/configuracoes/mensagens/boas-vindas`, também o índice de `/mensagens`). Uma linha por canal (canais ocultos não entram: `useChannels(true)` sem `includeHidden`). Não existe flag de ativo/inativo: a mensagem existe ou não existe.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-BV-01 | expandido | clicar em "Ver exemplo" (`<details>`) | pages/settings/messages/WelcomePage.jsx:15 | "Ver exemplo" → "“Olá! Bem-vindo à nossa empresa. Em instantes…”" | — |
| CFG-MSG-BV-02 | carregando | 1ª carga dos canais | pages/settings/messages/WelcomePage.jsx:21 | (esqueleto de 3 linhas pulsando; sr-only Carregando… do primitivo) | — |
| CFG-MSG-BV-03 | erro-com-retry | falha em listar canais (`onRetry=refresh`) | pages/settings/messages/WelcomePage.jsx:21 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | `error` do hook não é passado: sempre o texto genérico |
| CFG-MSG-BV-04 | sem-permissão | listar canais devolve 403 | pages/settings/messages/WelcomePage.jsx:21 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-MSG-BV-05 | vazio | nenhum canal | pages/settings/messages/WelcomePage.jsx:21 | "Nenhum canal cadastrado. Crie um em Canais WhatsApp." | nome antigo: o menu hoje diz "Números conectados"; e sem link (Avisos por cidade tem link) |
| CFG-MSG-BV-06 | recarregando | `refresh()` depois de salvar ou excluir | pages/settings/messages/WelcomePage.jsx:24 | AUSENTE | `useChannels` não expõe `reloading`: nada indica a recarga; se ela falhar, a lista inteira vira o bloco de erro |
| CFG-MSG-BV-07 | sem-permissão | gerente sem "Canais e Integrações" (`canEdit=false`) → descrição do cartão | pages/settings/messages/WelcomePage.jsx:20 | "Salvar boas-vindas exige a permissão de Canais e Integrações." | — |
| CFG-MSG-BV-08 | responsivo | contêiner ≥820px: a introdução vira coluna de 200px à esquerda | pages/settings/settings.css:125 | (intro à esquerda, lista à direita) | — |
| CFG-MSG-BV-09 | variante | canal sem mensagem, pode editar | components/messages/ChannelWelcomeMessageRow.jsx:88 | "{channel.name}" · "Criar boas-vindas" | — |
| CFG-MSG-BV-10 | sem-permissão | canal sem mensagem, `readOnly` | components/messages/ChannelWelcomeMessageRow.jsx:91 | "Requer permissão de Canais e Integrações" (amarelo, no lugar do botão) | — |
| CFG-MSG-BV-11 | variante | canal com mensagem | components/messages/ChannelWelcomeMessageRow.jsx:105 | "{canal}" + "{texto da boas-vindas}" (quebra linha: settings.css:123 anula o `truncate`) | — |
| CFG-MSG-BV-12 | sem-permissão | canal com mensagem, `readOnly` | components/messages/ChannelWelcomeMessageRow.jsx:109 | "Requer permissão de Canais e Integrações" (substitui Editar/Excluir) | — |
| CFG-MSG-BV-13 | edição-inline | "Editar" ou "Criar boas-vindas" → formulário na própria linha | components/messages/ChannelWelcomeMessageRow.jsx:62 | "{channel.name}" · "Cancelar" · "Salvar" | textarea sem rótulo acessível (o nome do canal é um `<p>` solto, sem placeholder nem aria-label) |
| CFG-MSG-BV-14 | validação | textarea vazia (`required`) | components/messages/ChannelWelcomeMessageRow.jsx:70 | (balão nativo do navegador) | — |
| CFG-MSG-BV-15 | validação | texto > 4096 caracteres (só o backend confere) | components/messages/ChannelWelcomeMessageRow.jsx:72 | "{error}" (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js: welcomeMessage must be 4096 characters or fewer) | sem contador nem maxLength; texto técnico em inglês na tela |
| CFG-MSG-BV-16 | salvando | enviando o texto | components/messages/ChannelWelcomeMessageRow.jsx:77 | "Salvar" (esmaecido, aria-busy, sem spinner) · "Cancelar" (continua ativo) | — |
| CFG-MSG-BV-17 | erro | falha ao salvar | components/messages/ChannelWelcomeMessageRow.jsx:72 | "Falha ao salvar" (ou a mensagem do backend) | `<p>` sem role="alert" |
| CFG-MSG-BV-18 | sucesso | salvou → `setEditing(false)` + `onSaved()` | components/messages/ChannelWelcomeMessageRow.jsx:36 | (volta ao resumo; nenhum "Salvo") | o resumo mostra o texto ANTIGO até a recarga terminar (o estado da linha não guarda o que foi salvo) |
| CFG-MSG-BV-19 | confirmação | "Excluir" | components/messages/ChannelWelcomeMessageRow.jsx:46 | "Remover a boas-vindas do canal "{canal}"?" (danger, botão "Remover") | — |
| CFG-MSG-BV-20 | salvando | excluindo (`deleting`) | components/messages/ChannelWelcomeMessageRow.jsx:115 | ("Excluir" esmaecido, aria-busy) | BUG: `deleting` só volta a false no erro; a linha não desmonta (mesma key). Se você remove e depois recria a boas-vindas, "Excluir" fica travado até recarregar a página |
| CFG-MSG-BV-21 | erro | falha ao excluir | components/messages/ChannelWelcomeMessageRow.jsx:121 | "Falha ao excluir" | `<p>` sem role="alert" |

### Abertura e encerramento — `pages/settings/rules/AssignmentPage.jsx` + `components/messages/AssignmentMessageSection.jsx`

Como se chega na tela: Configurações › Atendimento › Abertura e encerramento (`/configuracoes/mensagens/abertura-encerramento`; `/regras/atribuicao` redireciona para cá). É uma configuração única com resumo e formulário.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-AE-01 | expandido | "Ver variáveis e exemplo" (`<details>`) | pages/settings/rules/AssignmentPage.jsx:8 | "Ver variáveis e exemplo" · "@chat_saudacao_maiusculo" · "— Bom dia / Boa tarde / Boa noite, automático" · "@chat_atendente" · "— primeiro nome de quem assumiu" · "@chat_protocolo" · "— número do protocolo do atendimento" · "Exemplo: “Bom dia, meu nome é Geovanna" | — |
| CFG-MSG-AE-02 | responsivo | contêiner ≥820px: intro (com as variáveis) em coluna à esquerda | pages/settings/settings.css:125 | (2 colunas) | — |
| CFG-MSG-AE-03 | carregando | 1ª carga da config | components/messages/AssignmentMessageSection.jsx:163 | (esqueleto de 2 linhas) | — |
| CFG-MSG-AE-04 | erro | falha ao carregar (AsyncState sem `onRetry`) | components/messages/AssignmentMessageSection.jsx:163 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | sem "Tentar de novo" e sem outra saída (o botão Editar fica dentro do AsyncState); `error` não é passado |
| CFG-MSG-AE-05 | sem-permissão | 403 | components/messages/AssignmentMessageSection.jsx:163 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | texto fala em "lista" numa tela de configuração |
| CFG-MSG-AE-06 | vazio | `config.id === null` | components/messages/AssignmentMessageSection.jsx:166 | "Nenhuma mensagem configurada ainda." + "Configurar mensagens" | — |
| CFG-MSG-AE-07 | variante | resumo configurado | components/messages/AssignmentMessageSection.jsx:174 | "{n} atendentes, {m} canais" | plural fixo ("1 atendentes, 1 canais"); não diz QUAIS |
| CFG-MSG-AE-08 | variante | abertura ou encerramento vazios | components/messages/AssignmentMessageSection.jsx:175 | "Não informada" | — |
| CFG-MSG-AE-09 | variante | ativo ou inativo | components/messages/AssignmentMessageSection.jsx:178 | "Ativo" / "Inativo" (StatusDot) | — |
| CFG-MSG-AE-10 | responsivo | par Abertura/Encerramento: 2 colunas, e 1 coluna com contêiner ≤650px | pages/settings/settings.css:208 | (colunas empilham) | — |
| CFG-MSG-AE-11 | resumo↔formulário | "Editar" ou "Configurar mensagens" → formulário substitui o resumo | components/messages/AssignmentMessageSection.jsx:76 | "Ativo", "Mensagem de abertura", "Mensagem de encerramento", "Atendentes", "Canais", "Cancelar" / "Salvar" | — (diferente do horário, o formulário não tem título) |
| CFG-MSG-AE-12 | variante | textarea vazia mostra o placeholder com as variáveis | components/messages/AssignmentMessageSection.jsx:93 | "@chat_saudacao_maiusculo, meu nome é @chat_atendente…" | — (com texto preenchido, as variáveis só ficam no `<details>` da intro) |
| CFG-MSG-AE-13 | responsivo | ≥lg: textareas lado a lado; Atendentes e Canais lado a lado | components/messages/AssignmentMessageSection.jsx:84 | (grid 2 colunas) | — |
| CFG-MSG-AE-14 | validação | textarea vazia (`required`) | components/messages/AssignmentMessageSection.jsx:96 | (balão nativo) | — |
| CFG-MSG-AE-15 | validação | só espaços (o backend recusa) | components/messages/AssignmentMessageSection.jsx:148 | "{error}" (montado em utils/errorMessages.js:133 a partir de openingMessage is required / closingMessage is required: O campo «openingMessage» é obrigatório.) | nome técnico do campo em inglês |
| CFG-MSG-AE-16 | validação | variável com erro de digitação (ex.: @chat_atendent) | components/messages/AssignmentMessageSection.jsx:89 | AUSENTE | o backend só troca as 3 conhecidas (split/join); o erro vai literal ao cliente sem aviso |
| CFG-MSG-AE-17 | validação | "Ativo" marcado com 0 atendentes ou 0 canais | components/messages/AssignmentMessageSection.jsx:80 | AUSENTE | o backend retorna cedo (`!agentIds.includes`) e nada é enviado, mas o resumo mostra "Ativo" |
| CFG-MSG-AE-18 | vazio | lista de atendentes vazia, carregando ou com erro (`useAgentsAdmin`, status ignorado) | components/messages/AssignmentMessageSection.jsx:118 | AUSENTE (título "Atendentes" sem nada embaixo) | erro silencioso / estado vazio ausente |
| CFG-MSG-AE-19 | vazio | lista de canais vazia, carregando ou com erro (`useChannels`, status ignorado) | components/messages/AssignmentMessageSection.jsx:134 | AUSENTE (título "Canais" sem nada embaixo) | erro silencioso / estado vazio ausente |
| CFG-MSG-AE-20 | variante | prévia do texto com as variáveis resolvidas | components/messages/AssignmentMessageSection.jsx:84 | AUSENTE (recurso inexistente) | — |
| CFG-MSG-AE-21 | salvando | salvando | components/messages/AssignmentMessageSection.jsx:153 | ("Salvar" esmaecido, aria-busy) | — |
| CFG-MSG-AE-22 | erro | falha ao salvar | components/messages/AssignmentMessageSection.jsx:148 | "Falha ao salvar" | `<p>` sem role="alert" |
| CFG-MSG-AE-23 | sucesso | salvou → `savedConfig` atualiza o resumo na hora | components/messages/AssignmentMessageSection.jsx:64 | (resumo novo; nenhum "Salvo") | — |
| CFG-MSG-AE-24 | recarregando | `refresh()` depois de salvar | components/messages/AssignmentMessageSection.jsx:66 | AUSENTE | se a recarga falhar, o resumo recém-salvo é trocado pelo erro SEM retry (AE-04) |

#### 7.3 IA e automação


### Triagem por menu — `pages/settings/automation/MenuTriagePage.jsx` (+ `components/TriageAdminTab.jsx`, `components/TriageConfigForm.jsx`, `components/CreateTriageOptionForm.jsx`, `hooks/useTriage.js`)

Como se chega na tela: `/configuracoes/automacao/triagem-menu` (Configurações › IA e automação › Triagem por menu). Nível admin.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-AUT-MENU-01 | sem-permissão | atendente abre a rota | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-AUT-MENU-02 | variante | selo de escopo do cabeçalho (fixo) | pages/settings/automation/MenuTriagePage.jsx:14 | "Este canal" | selo "Este canal" numa página sem canal escolhido: pergunta e opções do menu são globais, só o interruptor é por canal |
| CFG-AUT-MENU-03 | variante | `creating` = true | pages/settings/automation/MenuTriagePage.jsx:15 | botão "Criar opção" some do cabeçalho | — |
| CFG-AUT-MENU-04 | interação:criando | clicar "Criar opção" enquanto a carga está em erro | pages/settings/automation/MenuTriagePage.jsx:15 + components/TriageAdminTab.jsx:203 | (botão some; formulário não aparece porque está dentro do AsyncState em erro) | (suspeita) usuário fica sem botão e sem formulário até recarregar a página |
| CFG-AUT-MENU-05 | carregando | 1ª carga de GET triage | components/TriageAdminTab.jsx:169 | (esqueleto 4 linhas) | — |
| CFG-AUT-MENU-06 | erro | falha em GET triage | components/TriageAdminTab.jsx:169 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado ao AsyncState (mensagem real some) |
| CFG-AUT-MENU-07 | sem-permissão | API responde 403 | components/TriageAdminTab.jsx:169 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-AUT-MENU-08 | vazio | `options.length === 0` | components/TriageAdminTab.jsx:173 | "Nenhuma opção cadastrada: a triagem por menu não roda em nenhum canal, mesmo com o interruptor ligado." | aviso fica acima do formulário da Pergunta, longe da lista; a seção "Opções do menu" abaixo renderiza só o cabeçalho |
| CFG-AUT-MENU-09 | recarregando | `refresh()` após salvar/criar/editar/excluir | components/TriageAdminTab.jsx:169 | AUSENTE | `useTriage` não expõe `reloading`; nada indica a recarga |
| CFG-AUT-MENU-10 | interação:popover aberto | clicar "O que é isso?" (SectionHelp → WaDialog variant help) | components/TriageAdminTab.jsx:190 (components/SectionHelp.jsx:17) | "Triagem" / "Cada opção é um item do menu automático…" / "Exemplo: opção 1 → Financeiro…" / "Entendi" | — |
| CFG-AUT-MENU-11 | responsivo | largura ≥ lg | components/TriageAdminTab.jsx:212 | (opções em 2 colunas) | — |
| CFG-AUT-MENU-12 | interação:arrastando | reordenar opções | components/TriageAdminTab.jsx:213 | AUSENTE: não há arrastar; a ordem é o "Número da opção", mudado editando a linha | — |
| CFG-AUT-MENU-13 | validação | pergunta/confirmação vazias ou tentativas < 1 | components/TriageConfigForm.jsx:59, :72, :86 (required, min=1) | (balão nativo do navegador) | — |
| CFG-AUT-MENU-14 | salvando | enviar "Salvar" da Pergunta de triagem | components/TriageConfigForm.jsx:90 | "Salvar" (esmaecido, aria-busy) | — |
| CFG-AUT-MENU-15 | sucesso | PUT triage/config ok | components/TriageConfigForm.jsx:95-99 | "Configuração salva." | sem role=status; fica na tela indefinidamente, mesmo depois de editar de novo |
| CFG-AUT-MENU-16 | erro | PUT triage/config falha | components/TriageConfigForm.jsx:94 | (erro traduzido ou "Falha ao salvar") | sem role=alert |
| CFG-AUT-MENU-17 | responsivo | largura ≥ lg | components/TriageConfigForm.jsx:48 | (Pergunta e Confirmação lado a lado) | — |
| CFG-AUT-MENU-18 | expandido | "Criar opção" (cabeçalho) | components/TriageAdminTab.jsx:204 (texto em components/CreateTriageOptionForm.jsx:44) | "Cadastrar nova opção" + Número / Setor / Frases-gatilho + "Cadastrar" / "Cancelar" | — |
| CFG-AUT-MENU-19 | validação | número ou setor vazios | components/CreateTriageOptionForm.jsx:54, :63 (required) | (balão nativo do navegador) | — |
| CFG-AUT-MENU-20 | vazio | nenhum setor cadastrado ou falha em `useSectors` | components/CreateTriageOptionForm.jsx:65 | AUSENTE: select só com "Selecione um setor" | não explica que não há setor; falha de carga silenciosa; o formulário vira um beco sem saída |
| CFG-AUT-MENU-21 | salvando | "Cadastrar" | components/CreateTriageOptionForm.jsx:85 | "Cadastrar" (esmaecido, aria-busy) | — |
| CFG-AUT-MENU-22 | erro | POST falha (ex.: número repetido) | components/CreateTriageOptionForm.jsx:83 (texto em utils/errorMessages.js:116) | "Já existe uma opção com este número." / "Falha ao cadastrar opção" | sem role=alert |
| CFG-AUT-MENU-23 | sucesso | opção criada | components/TriageAdminTab.jsx:205-208 | AUSENTE (formulário fecha e a lista recarrega) | nada confirma nem anuncia a criação |
| CFG-AUT-MENU-24 | variante | opção sem palavras-chave | components/TriageAdminTab.jsx:142 | "Sem frases-gatilho" | — |
| CFG-AUT-MENU-25 | edição-inline | "Editar" na linha | components/TriageAdminTab.jsx:79 | "Editar opção {option.optionNumber}" · "Número da opção" · "Setor" · "Frases-gatilho" | — |
| CFG-AUT-MENU-26 | salvando | "Salvar" da edição | components/TriageAdminTab.jsx:127 | "Salvar" (esmaecido, aria-busy) | — |
| CFG-AUT-MENU-27 | erro | PATCH falha | components/TriageAdminTab.jsx:122 (texto em utils/errorMessages.js:116) | "Já existe uma opção com este número." / "Falha ao salvar" | sem role=alert |
| CFG-AUT-MENU-28 | confirmação | "Excluir" na linha | components/TriageAdminTab.jsx:62 (diálogo em :156) | "Excluir a opção {n} ({setor})?" [Cancelar / Excluir, danger] | — |
| CFG-AUT-MENU-29 | salvando | exclusão em andamento | components/TriageAdminTab.jsx:148 | "Excluir" (esmaecido, aria-busy) | — |
| CFG-AUT-MENU-30 | erro | DELETE falha | components/TriageAdminTab.jsx:153-155 | (erro traduzido ou "Falha ao excluir") | sem role=alert |

### Atendimento e triagem com IA — `pages/settings/automation/AiTriagePage.jsx` (+ `useAiTriageForm.js`)

Como se chega na tela: `/configuracoes/automacao/ia` (o menu chama de "Atendimento com IA", o título diz "Atendimento e triagem com IA"). Nível admin.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-AUT-IA-01 | sem-permissão | atendente abre a rota | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-AUT-IA-02 | carregando | 1ª carga de `useAiConfig` (toggle fica fora do AsyncState) | pages/settings/automation/AiTriagePage.jsx:47 | (caixa "Sugerir respostas ao atendente" desmarcada e clicável) | toggle aparece desmarcado durante a carga e no erro, e aceita clique: grava sem ter lido o valor atual |
| CFG-AUT-IA-03 | salvando | marcar/desmarcar "Sugerir respostas ao atendente" (salva na hora) | pages/settings/automation/AiTriagePage.jsx:50-53 | AUSENTE (nenhum estado pendente; a caixa só muda depois do refresh) | sem feedback de envio; dá para clicar de novo no meio |
| CFG-AUT-IA-04 | erro | PUT assistant-suggestions falha | pages/settings/automation/AiTriagePage.jsx:50-53 | AUSENTE | erro silencioso: sem try/catch (promessa rejeitada sem tratamento); a caixa volta sem aviso |
| CFG-AUT-IA-05 | variante | papel: gerente SEM "Pode gerenciar Canais e Integrações" | pages/settings/automation/AiTriagePage.jsx:47 | (caixa visível e ativa) | backend exige requireIntegrationsAccess → 403 silencioso; deveria vir desabilitado com motivo |
| CFG-AUT-IA-06 | variante | selo da OpenAI em "Situação" (mode/configured) | pages/settings/automation/AiTriagePage.jsx:64 | "Desativada" / "Não configurada" / "Conectada" | mostra "Desativada" enquanto carrega e se a carga falhar (usa EMPTY_CONFIG sem checar status); "Erro" nunca aparece aqui (hasError:false); o formulário continua editável com a OpenAI desligada |
| CFG-AUT-IA-07 | variante | papel: gerente sem permissão de integrações clica no link "OpenAI" | pages/settings/automation/AiTriagePage.jsx:63 | "OpenAI" | link oferecido a quem não pode abrir o destino |
| CFG-AUT-IA-08 | carregando | 1ª carga de canais | pages/settings/automation/AiTriagePage.jsx:68 | (esqueleto 3 linhas) | — |
| CFG-AUT-IA-09 | erro | falha em listar canais | pages/settings/automation/AiTriagePage.jsx:68 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-IA-10 | vazio | nenhum canal com `aiEnabled` | pages/settings/automation/AiTriagePage.jsx:71-76 | "Nenhum canal com IA ligada. Ligue em Canais." | — |
| CFG-AUT-IA-11 | variante | há canais com IA | pages/settings/automation/AiTriagePage.jsx:78-82 | (chips com o nome de cada canal) | — |
| CFG-AUT-IA-12 | carregando | 1ª carga do formulário | pages/settings/automation/AiTriagePage.jsx:87 | (esqueleto 5 linhas) | — |
| CFG-AUT-IA-13 | erro | falha em carregar a configuração da IA | pages/settings/automation/AiTriagePage.jsx:87 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-IA-14 | validação | número fora da faixa (0–100, 0–5, 1–60) | pages/settings/automation/AiTriagePage.jsx:102-132 | (balão nativo do navegador) | campo vazio passa: "Confiança mínima" e "Máximo de perguntas" vazios gravam 0 sem aviso; "Tempo limite" vazio volta erro em inglês "triageTimeoutMinutes must be an integer from 1 to 60" |
| CFG-AUT-IA-15 | validação | motivo salvo está inativo ou foi apagado | pages/settings/automation/AiTriagePage.jsx:140 (Field.jsx:35, role=alert) | "O motivo escolhido está inativo ou não existe mais" | — |
| CFG-AUT-IA-16 | erro | falha em `useReasons` | pages/settings/automation/AiTriagePage.jsx:142-152 | AUSENTE (select só com a opção padrão) | erro silencioso; o aviso de motivo inativo também deixa de funcionar |
| CFG-AUT-IA-17 | variante | select "Encerrar sozinha depois de entregar boleto/PIX" | pages/settings/automation/AiTriagePage.jsx:148-151 | "Não encerrar: encaminhar ao setor (padrão)" + motivos | — |
| CFG-AUT-IA-18 | desabilitado-sem-motivo | motivo escolhido com a ferramenta "Encerrar atendimento sozinha" desligada | pages/settings/automation/AiTriagePage.jsx:136-153 | AUSENTE aqui | o aviso só existe em Ações permitidas (AiToolsPage.jsx:70); aqui a configuração parece valer |
| CFG-AUT-IA-19 | salvando | "Salvar triagem com IA" | pages/settings/automation/AiTriagePage.jsx:170 | "Salvar triagem com IA" (esmaecido, aria-busy) | — |
| CFG-AUT-IA-20 | erro | PATCH ai/triage falha | pages/settings/automation/AiTriagePage.jsx:165 | "{form.error}" | texto técnico em inglês nos erros de validação do backend (nenhum está mapeado em errorMessages.js) |
| CFG-AUT-IA-21 | sucesso | PATCH ok | pages/settings/automation/AiTriagePage.jsx:170 | AUSENTE | nenhuma mensagem de salvo |
| CFG-AUT-IA-22 | recarregando | refresh depois de salvar | pages/settings/automation/AiTriagePage.jsx:87 | AUSENTE | `reloading` não exposto |
| CFG-AUT-IA-23 | responsivo | container ≥ 760 / ≥ 600 | pages/settings/automation/AiTriagePage.jsx:41, :95, :135 | (Durante/Situação lado a lado; 3 números numa linha; motivo e instruções lado a lado) | — |

### Identificação e comprovantes — `pages/settings/automation/IdentificationPage.jsx`

Como se chega na tela: `/configuracoes/automacao/identificacao`. Nível admin.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-AUT-ID-01 | sem-permissão | atendente abre a rota | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-AUT-ID-02 | carregando | 1ª carga | pages/settings/automation/IdentificationPage.jsx:37 | (esqueleto 4 linhas) | — |
| CFG-AUT-ID-03 | erro | falha em carregar a configuração da IA | pages/settings/automation/IdentificationPage.jsx:37 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-ID-04 | variante | selo de dependência do cartão "Identificação do cliente" | pages/settings/automation/IdentificationPage.jsx:42 | "Triagem com IA" | — |
| CFG-AUT-ID-05 | variante | `triagemLigada` (chip de dependência) | pages/settings/automation/IdentificationPage.jsx:46 | "Triagem com IA ativa" / "Triagem com IA desligada" | BUG: compara `mode` com 'triage'/'full', valores que o backend nunca devolve (só disabled/assistant/automatic) → em produção aparece SEMPRE "Triagem com IA desligada" (o teste mocka 'triage') |
| CFG-AUT-ID-06 | variante | Toggle "Ler comprovantes também de dia (sem desbloqueio)" | pages/settings/automation/IdentificationPage.jsx:61-67 | "Ler comprovantes também de dia (sem desbloqueio)" + descrição | o mesmo Toggle salva na hora em Atendimento com IA e em Ações permitidas; aqui só grava com "Salvar identificação", e nada indica alteração pendente |
| CFG-AUT-ID-07 | variante | selo do cartão "Favorecidos aceitos" | pages/settings/automation/IdentificationPage.jsx:73 | "Empresa" | — |
| CFG-AUT-ID-08 | variante | quantidade de favorecidos da Empresa | pages/settings/automation/IdentificationPage.jsx:77 | "{favorecidos} nome cadastrado" · "{favorecidos} nomes cadastrados" · "Nenhum nome cadastrado" | chip mostra "Nenhum nome cadastrado" enquanto a Empresa carrega e se a carga falhar (não checa `statusEmpresa`) |
| CFG-AUT-ID-09 | vazio | Empresa pronta e sem favorecidos | pages/settings/automation/IdentificationPage.jsx:90-92 | "Sem nenhum nome cadastrado, nenhum comprovante confere." (senão "A lista fica no cadastro da empresa.") | — |
| CFG-AUT-ID-10 | erro | falha em `useCompanyConfig` | pages/settings/automation/IdentificationPage.jsx:77-92 | AUSENTE | erro silencioso: texto neutro + chip "Nenhum nome cadastrado" |
| CFG-AUT-ID-11 | salvando | "Salvar identificação" | pages/settings/automation/IdentificationPage.jsx:103 | "Salvar identificação" (esmaecido, aria-busy) | — |
| CFG-AUT-ID-12 | erro | PATCH falha | pages/settings/automation/IdentificationPage.jsx:97 | "{form.error}" | — |
| CFG-AUT-ID-13 | sucesso | PATCH ok | pages/settings/automation/IdentificationPage.jsx:103 | AUSENTE | nenhuma mensagem de salvo |

### Transcrição de áudio — `pages/settings/automation/TranscriptionPage.jsx` (+ `components/AudioTranscriptionConfigCard.jsx`)

Como se chega na tela: `/configuracoes/automacao/transcricao`; também pelo link da página OpenAI ("Usa esta conexão"). Nível admin.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-AUT-TRS-01 | sem-permissão | atendente abre a rota | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-AUT-TRS-02 | variante | selo de dependência do cabeçalho (fixo) | pages/settings/automation/TranscriptionPage.jsx:10 | "OpenAI conectada" | selo fixo: não muda com o estado real da OpenAI |
| CFG-AUT-TRS-03 | carregando | 1ª carga (o texto de introdução fica fora) | components/AudioTranscriptionConfigCard.jsx:104 | (esqueleto 4 linhas) | — |
| CFG-AUT-TRS-04 | erro | falha em carregar a configuração da IA | components/AudioTranscriptionConfigCard.jsx:104 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-TRS-05 | variante | caixa "Transcrever áudios automaticamente" ligada ou desligada | components/AudioTranscriptionConfigCard.jsx:107-110 | "Transcrever áudios automaticamente" / "Áudios recebidos serão convertidos em texto…" | desligada, os campos seguem iguais e editáveis (nada muda na tela); usa um `<input>` cru, e não o Toggle das páginas irmãs |
| CFG-AUT-TRS-06 | desabilitado-sem-motivo | OpenAI sem chave e transcrição marcada | components/AudioTranscriptionConfigCard.jsx:107-130 | AUSENTE (nenhum aviso junto do controle) | ligar sem chave não avisa; só o selo do cabeçalho e o title de "Buscar modelos" |
| CFG-AUT-TRS-07 | desabilitado-com-motivo | `!config.configured` | components/AudioTranscriptionConfigCard.jsx:156-164 | "Buscar modelos" com title "Salve a chave da OpenAI primeiro" | motivo só no title de um botão desabilitado (ele não recebe foco): invisível para teclado e toque |
| CFG-AUT-TRS-08 | variante | select "Modelo" | components/AudioTranscriptionConfigCard.jsx:126-129 | "Selecione um modelo" + salvo + testados | sem chave e sem modelo salvo, só existe "Selecione um modelo": marcar a transcrição termina em "Modelo é obrigatório" sem saída |
| CFG-AUT-TRS-09 | interação:testando | "Buscar modelos" em andamento | components/AudioTranscriptionConfigCard.jsx:159 | "Buscar modelos" (esmaecido, aria-busy) | — |
| CFG-AUT-TRS-10 | sucesso | busca de modelos ok | components/AudioTranscriptionConfigCard.jsx:127-129 | AUSENTE (só aparecem mais opções no select) | nenhum aviso de sucesso nem de quantos modelos vieram |
| CFG-AUT-TRS-11 | erro | teste devolve `ok:false` | components/AudioTranscriptionConfigCard.jsx:190 (texto em utils/errorMessages.js:100) | "No API key configured" / "OpenAI rejected the API key" / "Failed to reach OpenAI at /models" | inglês cru (`result.error` não passa por descreverErro, embora "No API key configured" tenha tradução); sem role=alert |
| CFG-AUT-TRS-12 | variante | papel: gerente sem permissão de integrações clica "Buscar modelos" | components/AudioTranscriptionConfigCard.jsx:156 (texto em utils/errorMessages.js:21) | "Sua conta não tem permissão para esta ação." | botão ativo para quem não pode usá-lo (test-connection exige requireIntegrationsAccess) |
| CFG-AUT-TRS-13 | validação | transcrição ligada sem modelo | components/AudioTranscriptionConfigCard.jsx:66 → :190 | "Modelo é obrigatório" | sem role=alert; campo não fica marcado |
| CFG-AUT-TRS-14 | validação | duração ou tamanho vazios, zero ou fracionados | components/AudioTranscriptionConfigCard.jsx:74 → :190 | "Duração e tamanho máximos devem ser números inteiros maiores que zero" | sem role=alert |
| CFG-AUT-TRS-15 | salvando | "Salvar transcrição" | components/AudioTranscriptionConfigCard.jsx:195 | "Salvar transcrição" (esmaecido, aria-busy) | — |
| CFG-AUT-TRS-16 | erro | PUT transcription falha | components/AudioTranscriptionConfigCard.jsx:190-192 | (erro traduzido ou "Falha ao salvar") | sem role=alert; ocupa a mesma caixa do erro de "Buscar modelos" |
| CFG-AUT-TRS-17 | sucesso | PUT ok | components/AudioTranscriptionConfigCard.jsx:195 | AUSENTE | nenhuma mensagem de salvo |
| CFG-AUT-TRS-18 | responsivo | largura ≥ lg | components/AudioTranscriptionConfigCard.jsx:105 | (Processamento e Uso pela IA em 2 colunas) | — |

### Atendimento noturno — `pages/settings/automation/NightModePage.jsx`

Como se chega na tela: `/configuracoes/automacao/noturno`; também pela página OpenAI. Nível admin.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-AUT-NOT-01 | sem-permissão | atendente abre a rota | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-AUT-NOT-02 | carregando | 1ª carga | pages/settings/automation/NightModePage.jsx:17 | (esqueleto 4 linhas) | — |
| CFG-AUT-NOT-03 | erro | falha em carregar a configuração da IA | pages/settings/automation/NightModePage.jsx:17 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-NOT-04 | vazio | janela sem início/fim salvos | pages/settings/automation/NightModePage.jsx:22 | AUSENTE | nada diz "janela não definida: o noturno nunca liga" |
| CFG-AUT-NOT-05 | validação | só um dos horários preenchido | pages/settings/automation/useAiTriageForm.js:73 → NightModePage.jsx:29 | "Informe início e fim do atendimento noturno, ou deixe os dois vazios" (role=alert) | — |
| CFG-AUT-NOT-06 | salvando | "Salvar janela noturna" | pages/settings/automation/NightModePage.jsx:19 | "Salvar janela noturna" (esmaecido, aria-busy) | — |
| CFG-AUT-NOT-07 | erro | PATCH falha | pages/settings/automation/NightModePage.jsx:29 | "{form.error}" | — |
| CFG-AUT-NOT-08 | sucesso | PATCH ok | pages/settings/automation/NightModePage.jsx:19 | AUSENTE | nenhuma mensagem de salvo |
| CFG-AUT-NOT-09 | confirmação | apagar a janela com canais que têm o noturno ligado | pages/settings/automation/NightModePage.jsx:18 | AUSENTE | (suspeita) desligar a janela de fato não avisa nem pede confirmação, e a lista abaixo continua mostrando os canais "ligados" |
| CFG-AUT-NOT-10 | desabilitado-sem-motivo | OpenAI desligada ou sem chave | pages/settings/automation/NightModePage.jsx:13 | AUSENTE | a página não mostra a dependência da OpenAI (a página OpenAI lista "Atendimento noturno" como dependente); o selo diz "Toda a operação" |
| CFG-AUT-NOT-11 | carregando | 1ª carga de canais | pages/settings/automation/NightModePage.jsx:34 | (esqueleto 3 linhas) | — |
| CFG-AUT-NOT-12 | erro | falha em listar canais | pages/settings/automation/NightModePage.jsx:34 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-NOT-13 | vazio | nenhum canal com `aiNightModeEnabled` | pages/settings/automation/NightModePage.jsx:34 | "Nenhum canal com o noturno ligado. Ligue no detalhe do canal, aba Atendimento." | — |
| CFG-AUT-NOT-14 | variante | há canais com o noturno | pages/settings/automation/NightModePage.jsx:36 | (links com o nome do canal → aba Atendimento dele) | — |
| CFG-AUT-NOT-15 | variante | selo do cartão da lista (fixo) | pages/settings/automation/NightModePage.jsx:33 | "Este canal" | (suspeita) selo "Este canal" numa lista de vários canais |
| CFG-AUT-NOT-16 | responsivo | largura ≥ sm | pages/settings/automation/NightModePage.jsx:20 | (Início e Fim lado a lado) | — |

### Ações permitidas à IA — `pages/settings/automation/AiToolsPage.jsx` (+ `aiToolLabels.js`, `hooks/useAiTools.js`)

Como se chega na tela: `/configuracoes/automacao/ferramentas`; também pelo link "Ver ações permitidas →" em SGP: consultas. Nível admin.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-AUT-FER-01 | sem-permissão | atendente abre a rota | App.jsx:157 | "Sem acesso a {areaLabel}" · "Esta área é liberada para administradores e gerentes." | — |
| CFG-AUT-FER-02 | variante | motivo de encerramento configurado e ferramenta `encerrar_atendimento` desligada | pages/settings/automation/AiToolsPage.jsx:70-76 | "Encerrar sozinha está configurado, mas a ferramenta Encerrar atendimento sozinha está desligada." | — |
| CFG-AUT-FER-03 | carregando | 1ª carga | pages/settings/automation/AiToolsPage.jsx:77 | (esqueleto 3 linhas) | — |
| CFG-AUT-FER-04 | erro | falha em listar as ferramentas | pages/settings/automation/AiToolsPage.jsx:77 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-AUT-FER-05 | vazio | nenhuma ferramenta | pages/settings/automation/AiToolsPage.jsx:77 | "Nenhuma ferramenta cadastrada." | — |
| CFG-AUT-FER-06 | variante | contadores | pages/settings/automation/AiToolsPage.jsx:79-83 | "{n} ações · {n} ativas · {n} desativadas" | — |
| CFG-AUT-FER-07 | variante | grupo com contador | pages/settings/automation/AiToolsPage.jsx:91-92 | "Consultas" / "Financeiro" / "Atendimento" / "Transferência e encerramento" + (n) | — |
| CFG-AUT-FER-08 | variante | ferramenta fora dos grupos | pages/settings/automation/AiToolsPage.jsx:53 (aiToolLabels.js:25) | "Outras ações" | `consultar_planos` e `verificar_cobertura` (que têm rótulo) caem aqui; ferramenta sem rótulo mostra o identificador cru (ex.: `nome_tecnico`) |
| CFG-AUT-FER-09 | variante | categoria ACAO_SENSIVEL | pages/settings/automation/AiToolsPage.jsx:104 | "Ação sensível" | — |
| CFG-AUT-FER-10 | expandido | `<details>` "Quando usar" em cada ferramenta | pages/settings/automation/AiToolsPage.jsx:108-114 | descrição + "Identificador técnico: {nome}" | — |
| CFG-AUT-FER-11 | salvando | marcar/desmarcar uma ferramenta (salva na hora) | pages/settings/automation/AiToolsPage.jsx:97-100 (handler :43-46) | AUSENTE (a caixa só muda depois do refresh) | sem estado pendente; dá para clicar de novo no meio |
| CFG-AUT-FER-12 | erro | PUT ai/tools/:nome falha | pages/settings/automation/AiToolsPage.jsx:43-46 | AUSENTE | erro silencioso: sem try/catch; a caixa volta sem aviso |
| CFG-AUT-FER-13 | confirmação | ligar uma ação sensível (ex.: "Liberar em confiança") | pages/settings/automation/AiToolsPage.jsx:100 | AUSENTE | (suspeita) ação sensível liga num clique, sem confirmação |
| CFG-AUT-FER-14 | desabilitado-sem-motivo | Consulta ao SGP não configurada ou desligada | pages/settings/automation/AiToolsPage.jsx:77 | AUSENTE | a página "O que a IA pode consultar e fazer no SGP" não mostra se o SGP está de pé; tudo parece funcional |
| CFG-AUT-FER-15 | responsivo | container ≥ 760 | pages/settings/automation/AiToolsPage.jsx:85 | (grupos em 2 colunas) | — |

#### 7.4 Mensagens


### Avisos por cidade — `pages/settings/messages/CityNoticesPage.jsx` + `components/messages/CityNoticeRow.jsx`

Como se chega na tela: Configurações › Mensagens › Avisos por cidade (`/configuracoes/mensagens/avisos-cidade`). Uma linha por cidade cadastrada.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-AC-01 | expandido | "Ver exemplo" (`<details>`) | pages/settings/messages/CityNoticesPage.jsx:12 | "“Nossa rede está passando por uma instabilidade…”" | — |
| CFG-MSG-AC-02 | carregando | 1ª carga | pages/settings/messages/CityNoticesPage.jsx:18 | (esqueleto de 3 linhas) | — |
| CFG-MSG-AC-03 | erro-com-retry | falha em listar (`onRetry=refresh`) | pages/settings/messages/CityNoticesPage.jsx:18 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | `error` do hook não é passado: sempre o texto genérico |
| CFG-MSG-AC-04 | sem-permissão | 403 | pages/settings/messages/CityNoticesPage.jsx:18 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-MSG-AC-05 | vazio | nenhuma cidade cadastrada | pages/settings/messages/CityNoticesPage.jsx:22 | "Nenhuma cidade cadastrada ainda. Cadastre cidades em Cidades." (link) | — |
| CFG-MSG-AC-06 | recarregando | `refresh()` depois de salvar ou excluir | pages/settings/messages/CityNoticesPage.jsx:34 | AUSENTE | `useCityNotices` não expõe `reloading`; se a recarga falhar, a lista some e vira o erro |
| CFG-MSG-AC-07 | responsivo | contêiner ≥820px: intro em coluna à esquerda | pages/settings/settings.css:125 | (2 colunas) | — |
| CFG-MSG-AC-08 | variante | cidade sem aviso | components/messages/CityNoticeRow.jsx:101 | "{cidade}" + "Criar aviso" | — |
| CFG-MSG-AC-09 | variante | cidade com aviso | components/messages/CityNoticeRow.jsx:111 | "{city.name}" · "{city.notice.message}" · "Editar" · "Excluir" | — |
| CFG-MSG-AC-10 | variante | aviso ativo ou inativo | components/messages/CityNoticeRow.jsx:118 | "Ativo" / "Inativo" (StatusDot) | — |
| CFG-MSG-AC-11 | edição-inline | "Editar" ou "Criar aviso" | components/messages/CityNoticeRow.jsx:66 | "{city.name}" · "Ativo" · "Cancelar" · "Salvar" | textarea sem rótulo acessível (sem label, placeholder nem aria-label) |
| CFG-MSG-AC-12 | variante | criar aviso novo: "Ativo" vem desmarcado (`Boolean(undefined)`) | components/messages/CityNoticeRow.jsx:80 | (checkbox "Ativo" desmarcado) | (suspeita) aviso recém-criado nasce Inativo sem nenhum aviso na tela |
| CFG-MSG-AC-13 | validação | textarea vazia (`required`) | components/messages/CityNoticeRow.jsx:74 | (balão nativo do navegador) | — |
| CFG-MSG-AC-14 | validação | só espaços (passa pelo `required`, o backend recusa) | components/messages/CityNoticeRow.jsx:85 | "{error}" (montado em utils/errorMessages.js:133 a partir de message is required: O campo «message» é obrigatório.) | nome técnico do campo em inglês na frase |
| CFG-MSG-AC-15 | validação | > 4096 caracteres (só o backend confere) | components/messages/CityNoticeRow.jsx:85 | "{error}" (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js: message must be 4096 characters or fewer) | sem contador nem maxLength; texto em inglês cru |
| CFG-MSG-AC-16 | salvando | enviando | components/messages/CityNoticeRow.jsx:90 | ("Salvar" esmaecido, aria-busy) | — |
| CFG-MSG-AC-17 | erro | falha ao salvar | components/messages/CityNoticeRow.jsx:85 | "Falha ao salvar" | `<p>` sem role="alert" |
| CFG-MSG-AC-18 | sucesso | salvou → fecha o formulário + `onSaved()` | components/messages/CityNoticeRow.jsx:40 | (volta ao resumo; nenhum "Salvo") | o resumo mostra o texto e o status ANTIGOS até a recarga terminar |
| CFG-MSG-AC-19 | confirmação | "Excluir" | components/messages/CityNoticeRow.jsx:50 | "Remover o aviso da cidade "{cidade}"?" (danger, "Remover") | — |
| CFG-MSG-AC-20 | salvando | excluindo | components/messages/CityNoticeRow.jsx:122 | ("Excluir" esmaecido, aria-busy) | BUG: `deleting` não é zerado no sucesso; remover e recriar o aviso deixa "Excluir" travado até recarregar a página |
| CFG-MSG-AC-21 | erro | falha ao excluir | components/messages/CityNoticeRow.jsx:127 | "Falha ao excluir" | `<p>` sem role="alert" |

### Respostas rápidas — `pages/settings/messages/QuickRepliesPage.jsx` + `components/CreateQuickReplyForm.jsx` + `components/messages/QuickReplyRow.jsx`

Como se chega na tela: Configurações › Mensagens › Respostas rápidas (`/configuracoes/mensagens/respostas-rapidas`). A resposta rápida tem só título e conteúdo, sem atalho. Não há, portanto, validação de atalho.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-RR-01 | expandido | "Ver exemplo" (`<details>`) | pages/settings/messages/QuickRepliesPage.jsx:14 | "“Olá! Para agilizar seu atendimento, poderia me informar seu CPF…”" | — |
| CFG-MSG-RR-02 | variante | contador da barra: `status==='ready'` ou não | pages/settings/messages/QuickRepliesPage.jsx:19 | "{n} respostas cadastradas" / "Respostas da equipe" | plural fixo: "1 respostas cadastradas" |
| CFG-MSG-RR-03 | resumo↔formulário | "Criar resposta rápida" → o botão some e o formulário abre entre a barra e a lista | pages/settings/messages/QuickRepliesPage.jsx:20 (texto em components/CreateQuickReplyForm.jsx:39) | "Cadastrar nova resposta rápida" (Título, Mensagem) | — |
| CFG-MSG-RR-04 | carregando | 1ª carga | pages/settings/messages/QuickRepliesPage.jsx:33 | (esqueleto de 3 linhas) | — |
| CFG-MSG-RR-05 | erro-com-retry | falha em listar | pages/settings/messages/QuickRepliesPage.jsx:33 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | `error` não é passado: sempre o texto genérico |
| CFG-MSG-RR-06 | sem-permissão | 403 | pages/settings/messages/QuickRepliesPage.jsx:33 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-MSG-RR-07 | vazio | nenhuma resposta | pages/settings/messages/QuickRepliesPage.jsx:33 | "Nenhuma resposta rápida cadastrada ainda." | — |
| CFG-MSG-RR-08 | recarregando | `refresh()` depois de criar, salvar ou excluir | pages/settings/messages/QuickRepliesPage.jsx:36 | AUSENTE | `useQuickReplies` não expõe `reloading`; ao criar, o formulário fecha e o item novo só aparece quando a recarga termina |
| CFG-MSG-RR-09 | responsivo | contêiner ≥820px: intro à esquerda | pages/settings/settings.css:125 | (2 colunas) | — |
| CFG-MSG-RR-10 | responsivo | ≥md: Título estreito e Mensagem larga lado a lado | components/CreateQuickReplyForm.jsx:40 | (grid 0,7fr / 1,3fr) | — |
| CFG-MSG-RR-11 | validação | título ou mensagem vazios (`required`) | components/CreateQuickReplyForm.jsx:50 | (balão nativo) | — |
| CFG-MSG-RR-12 | validação | só espaços (o backend faz trim e recusa) | components/CreateQuickReplyForm.jsx:67 | "{error}" (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js: title and content are required) | texto técnico em inglês cru |
| CFG-MSG-RR-13 | validação | título repetido | components/CreateQuickReplyForm.jsx:23 | AUSENTE | (suspeita) dois títulos iguais são aceitos sem aviso |
| CFG-MSG-RR-14 | salvando | cadastrando | components/CreateQuickReplyForm.jsx:69 | ("Cadastrar" esmaecido, aria-busy) | — |
| CFG-MSG-RR-15 | erro | falha ao cadastrar | components/CreateQuickReplyForm.jsx:67 | "Falha ao cadastrar resposta rápida" | `<p>` sem role="alert" |
| CFG-MSG-RR-16 | sucesso | cadastrou → limpa os campos, fecha, `refresh()` | components/CreateQuickReplyForm.jsx:24 | (formulário some; nenhum "Salvo") | — |
| CFG-MSG-RR-17 | variante | "Cancelar" só existe se `onCancel` vier (aqui sempre vem); ordem Cadastrar→Cancelar, o inverso dos templates | components/CreateQuickReplyForm.jsx:72 | "Cadastrar" / "Cancelar" | — |
| CFG-MSG-RR-18 | variante | linha em resumo | components/messages/QuickReplyRow.jsx:95 | "{título}" + "{conteúdo}" + "Editar" / "Excluir" | — |
| CFG-MSG-RR-19 | edição-inline | "Editar" | components/messages/QuickReplyRow.jsx:65 | input + textarea (moldura laranja) + "Cancelar" / "Salvar" | os 2 campos não têm rótulo, placeholder nem aria-label |
| CFG-MSG-RR-20 | validação | campo vazio (`required`) | components/messages/QuickReplyRow.jsx:73 | (balão nativo) | — |
| CFG-MSG-RR-21 | validação | só espaços | components/messages/QuickReplyRow.jsx:81 | "{error}" (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js: title and content are required) | inglês cru |
| CFG-MSG-RR-22 | salvando | salvando a edição | components/messages/QuickReplyRow.jsx:86 | ("Salvar" esmaecido) | — |
| CFG-MSG-RR-23 | erro | falha ao salvar | components/messages/QuickReplyRow.jsx:81 | "Falha ao salvar" | `<p>` sem role="alert" |
| CFG-MSG-RR-24 | sucesso | salvou → volta ao resumo | components/messages/QuickReplyRow.jsx:25 | (resumo; nenhum "Salvo") | o resumo mostra título e conteúdo ANTIGOS até a recarga terminar |
| CFG-MSG-RR-25 | confirmação | "Excluir" | components/messages/QuickReplyRow.jsx:49 | "Excluir a resposta rápida "{título}"?" (danger, "Excluir") | — |
| CFG-MSG-RR-26 | salvando | excluindo | components/messages/QuickReplyRow.jsx:105 | ("Excluir" esmaecido) | — |
| CFG-MSG-RR-27 | erro | falha ao excluir | components/messages/QuickReplyRow.jsx:110 | "Falha ao excluir" | `<p>` sem role="alert" |
| CFG-MSG-RR-28 | responsivo | tela estreita ou conteúdo longo | components/messages/QuickReplyRow.jsx:96 | (flex sem gap, sem wrap e sem min-w-0) | (suspeita) conteúdo longo sem espaço (URL) empurra os botões para fora |

### Templates WhatsApp (página) — `pages/settings/messages/TemplatesPage.jsx`

Como se chega na tela: Configurações › Mensagens › Templates WhatsApp (`/configuracoes/mensagens/templates`). A página busca os canais uma vez e o `TemplatesAdminTab` busca de novo.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-TPL-01 | variante | canais prontos e nenhum oficial | pages/settings/messages/TemplatesPage.jsx:15 | "Templates só existem em canais oficiais (Meta Cloud ou 360dialog). Nenhum canal oficial cadastrado." (cartão amarelo) | — |
| CFG-MSG-TPL-02 | erro | falha ao carregar canais | pages/settings/messages/TemplatesPage.jsx:14 | AUSENTE | erro silencioso: o aviso só aparece com `status==='ready'` e o erro não é mostrado |

### Templates — barra, lista, linha — `components/TemplatesAdminTab.jsx`

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-TPL-03 | filtro-ativo | digitar na busca (filtra por nome) | components/TemplatesAdminTab.jsx:619 | placeholder "Buscar template" | — |
| CFG-MSG-TPL-04 | filtro-ativo | trocar o canal (filtra por WABA e limpa a seleção) | components/TemplatesAdminTab.jsx:628 | "Canal: {nome}" | — |
| CFG-MSG-TPL-05 | variante | nenhum canal oficial na lista | components/TemplatesAdminTab.jsx:637 | "Nenhum canal oficial" | também aparece ENQUANTO os canais carregam e se a carga falhar (status de `useChannels()` ignorado) |
| CFG-MSG-TPL-06 | filtro-ativo | filtro de status | components/TemplatesAdminTab.jsx:644 | "Todos os status" / "Aprovado" / "Em análise" / "Rejeitado" | não oferece "Pausado" nem "Desativado", que existem no STATUS_META |
| CFG-MSG-TPL-07 | desabilitado-com-motivo | canal sem WABA (ou nenhum canal) | components/TemplatesAdminTab.jsx:661 | "Sincronizar" + title "O canal selecionado não tem WABA ID" | motivo só no `title` (botão desabilitado não recebe foco nem toque); texto errado quando nem há canal |
| CFG-MSG-TPL-08 | interação:tooltip | passar o mouse em "Sincronizar" habilitado | components/TemplatesAdminTab.jsx:662 | "Buscar na Meta os templates da conta {wabaId}" | — |
| CFG-MSG-TPL-09 | salvando | sincronizando | components/TemplatesAdminTab.jsx:660 | ("Sincronizar" esmaecido, aria-busy) | — |
| CFG-MSG-TPL-10 | erro | falha ao sincronizar | components/TemplatesAdminTab.jsx:674 | "Falha ao sincronizar" / "A Meta recusou: …" (WaError, role=alert) | (suspeita) textos do backend em inglês: "No channel found for this WABA", "wabaId is required" |
| CFG-MSG-TPL-11 | sucesso | sincronizou → só `refresh()` | components/TemplatesAdminTab.jsx:602 | AUSENTE | nenhuma confirmação; se nada mudou, a tela não reage |
| CFG-MSG-TPL-12 | desabilitado-sem-motivo | "Novo template" e "Registrar existente" SEMPRE habilitados, mesmo sem canal oficial | components/TemplatesAdminTab.jsx:668 | "Novo template" / "Registrar existente" (741) | deveriam desabilitar com motivo: abrem um formulário com o select de Canal vazio, barrado só pelo balão nativo |
| CFG-MSG-TPL-13 | variante | contador no título do cartão | components/TemplatesAdminTab.jsx:683 | "Templates do canal" + "{n}" | mostra "0" durante carregamento e erro; conta só os filtrados, sem o total |
| CFG-MSG-TPL-14 | carregando | 1ª carga | components/TemplatesAdminTab.jsx:688 | (esqueleto de 3 linhas) | — |
| CFG-MSG-TPL-15 | erro-com-retry | falha em listar | components/TemplatesAdminTab.jsx:688 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." + "Tentar de novo" | `error` não é passado: sempre o texto genérico |
| CFG-MSG-TPL-16 | sem-permissão | 403 | components/TemplatesAdminTab.jsx:688 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-MSG-TPL-17 | vazio | nenhum template em lugar nenhum | components/TemplatesAdminTab.jsx:688 | "Nenhum template cadastrado ainda." | — |
| CFG-MSG-TPL-18 | vazio-por-filtro | canal selecionado sem templates, ou filtro de status sem resultado | components/TemplatesAdminTab.jsx:713 | "Nenhum template neste canal com esse filtro." | uma frase só para 3 causas; sem ação "Limpar filtros" |
| CFG-MSG-TPL-19 | busca-sem-resultado | busca sem resultado | components/TemplatesAdminTab.jsx:713 | "Nenhum template neste canal com esse filtro." (a mesma frase) | a frase não menciona a busca |
| CFG-MSG-TPL-20 | recarregando | `refresh()` depois de criar, registrar, excluir, trocar finalidade ou sincronizar | components/TemplatesAdminTab.jsx:688 | AUSENTE | `useTemplates` não expõe `reloading`; recarga que falha troca a tabela pelo erro |
| CFG-MSG-TPL-21 | responsivo | tabela com min-w 480px → rolagem horizontal em tela estreita | components/TemplatesAdminTab.jsx:689 | (rolagem lateral) | — |
| CFG-MSG-TPL-22 | responsivo | contêiner ≥960px: a prévia vira coluna de 280px, sticky | pages/settings/settings.css:136 | (lista e prévia lado a lado; abaixo disso a prévia vai para baixo da lista) | — (o `xl:grid-cols-[…]` da linha 676 provavelmente é anulado pela folha sem @layer) |
| CFG-MSG-TPL-23 | seleção | clicar na linha; o 1º visível é selecionado se nada foi escolhido | components/TemplatesAdminTab.jsx:115 | (fundo laranja + barra à esquerda) | (suspeita) `aria-selected` em `<tr>` de tabela comum (sem role=grid) não é anunciado |
| CFG-MSG-TPL-24 | variante | o selecionado sai do filtro → cai no 1º visível | components/TemplatesAdminTab.jsx:594 | (seleção pula sozinha) | — |
| CFG-MSG-TPL-25 | interação:tooltip | nome cortado em 260px | components/TemplatesAdminTab.jsx:124 | title "{nome completo}" | (suspeita) nome completo só por hover (a prévia também corta) |
| CFG-MSG-TPL-26 | variante | template com `rejectionReason` | components/TemplatesAdminTab.jsx:128 | "{motivo}" em vermelho sob o nome | código cru da Meta (ex.: INVALID_FORMAT), sem tradução; (suspeita) "NONE" aparece em aprovados, porque a sincronização grava `rejected_reason` sem filtrar |
| CFG-MSG-TPL-27 | variante | categoria | components/TemplatesAdminTab.jsx:131 | "Utilidade" / "Marketing" / "Autenticação" / código cru / "—" | — |
| CFG-MSG-TPL-28 | variante | finalidade | components/TemplatesAdminTab.jsx:133 | "Atendimento" (verde) / "Disparo" (azul) | — |
| CFG-MSG-TPL-29 | variante | status Meta | components/TemplatesAdminTab.jsx:136 | "Aprovado" / "Em análise" / "Rejeitado" / "Pausado" / "Desativado" | — |
| CFG-MSG-TPL-30 | variante | status que não está no mapa (ex.: IN_APPEAL, PENDING_DELETION) | components/TemplatesAdminTab.jsx:31 | "{STATUS_CRU}" | texto técnico cru em inglês |
| CFG-MSG-TPL-31 | interação:menu aberto | "⋯" da linha (RowMenu "Mais ações para {nome}") | components/TemplatesAdminTab.jsx:140 | "Usar para disparo" ou "Usar para atendimento" · "Excluir" (vermelho) | — (o clique no ⋯ e nos itens também seleciona a linha, porque o evento sobe pelo portal) |
| CFG-MSG-TPL-32 | variante | o item do menu muda pela finalidade atual | components/TemplatesAdminTab.jsx:142 | "Usar para atendimento" / "Usar para disparo" | — |
| CFG-MSG-TPL-33 | salvando | trocando a finalidade (`switching`) | components/TemplatesAdminTab.jsx:141 | AUSENTE | sem indicação: o menu fecha no clique; o único sinal é o chip mudar quando a recarga terminar |
| CFG-MSG-TPL-34 | desabilitado-sem-motivo | reabrir o menu com troca ou exclusão em andamento | components/TemplatesAdminTab.jsx:144 | (item esmaecido, sem explicação) | desabilitado sem motivo |
| CFG-MSG-TPL-35 | erro | falha ao trocar a finalidade | components/TemplatesAdminTab.jsx:129 | "Falha ao trocar a finalidade" (WaError na célula do nome) | — |
| CFG-MSG-TPL-36 | confirmação | "Excluir" no menu | components/TemplatesAdminTab.jsx:84 | "Excluir o template "{nome}"?" (danger, "Excluir") | — |
| CFG-MSG-TPL-37 | salvando | excluindo (`deleting`) | components/TemplatesAdminTab.jsx:144 | AUSENTE | sem indicação: o menu já fechou; nada na linha mostra progresso |
| CFG-MSG-TPL-38 | erro | falha ao excluir | components/TemplatesAdminTab.jsx:129 | "Falha ao excluir" (WaError) | — |
| CFG-MSG-TPL-39 | sucesso | excluiu ou trocou → `onDeleted()` (refresh) | components/TemplatesAdminTab.jsx:91 | (a linha some ou o chip muda depois da recarga; nenhuma mensagem) | — |

### Templates — prévia — `components/TemplatesAdminTab.jsx` (`TemplatePreview`)

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-TPL-40 | vazio | nenhum template visível | components/TemplatesAdminTab.jsx:523 | "Nenhum template selecionado" / "Selecione um template na lista para ver a prévia." | aparece também durante o carregamento e no erro (a prévia não conhece o status) |
| CFG-MSG-TPL-41 | variante | template selecionado | components/TemplatesAdminTab.jsx:503 | balão com o corpo + hora atual + chip de idioma ("Português (Brasil)"…) | — |
| CFG-MSG-TPL-42 | variante | corpo vazio | components/TemplatesAdminTab.jsx:508 | "Corpo do template não informado." | — |
| CFG-MSG-TPL-43 | variante | template com botões de resposta rápida | components/TemplatesAdminTab.jsx:513 | balão sem os cantos de baixo + botões azuis empilhados | — |
| CFG-MSG-TPL-44 | variante | corpo com variáveis | components/TemplatesAdminTab.jsx:508 | "{{1}}", "{{2}}" crus no balão | — (`substituirVariaveis` existe, mas não é usado aqui) |
| CFG-MSG-TPL-45 | variante | template com cabeçalho (documento, imagem ou vídeo) | components/TemplatesAdminTab.jsx:501 | AUSENTE | a prévia omite o cabeçalho de mídia (`headerType` vem na API) |
| CFG-MSG-TPL-46 | variante | cabeçalho do canal: iniciais do canal; sem canal → "?" e "Canal" | components/TemplatesAdminTab.jsx:490 | "{XY}" / "Conta comercial" | — |
| CFG-MSG-TPL-47 | variante | ficha abaixo da prévia | components/TemplatesAdminTab.jsx:530 | "Categoria" / "Status" (ponto colorido) / "Canal" ("—" sem canal) | — |

### Templates — "Novo template" (diálogo) — `components/TemplatesAdminTab.jsx` (`CreateTemplateForm`)

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-TPL-48 | interação:diálogo aberto | "Novo template" | components/TemplatesAdminTab.jsx:752 | "Novo template" (X "Fechar"; Esc fecha; clique no fundo não fecha) | — (fechar descarta o preenchido sem perguntar) |
| CFG-MSG-TPL-49 | variante | Canal pré-preenchido com o canal do filtro ou o 1º oficial (useEffect); select sem placeholder | components/TemplatesAdminTab.jsx:226 | "{canal}" | — |
| CFG-MSG-TPL-50 | validação | sem canal oficial → select vazio `required` | components/TemplatesAdminTab.jsx:226 | "Canal" (select sem nenhuma opção; balão nativo do navegador pede para selecionar um item) | select vazio sem explicação (ver TPL-12) |
| CFG-MSG-TPL-51 | variante | Finalidade com explicação em cada opção | components/TemplatesAdminTab.jsx:238 | "Atendimento — o atendente escolhe…" / "Disparo — campanha e envios automáticos do SGP" | — |
| CFG-MSG-TPL-52 | validação | nome fora do padrão (dica sem `pattern`) | components/TemplatesAdminTab.jsx:254 | dica "Só letras minúsculas, números e _ (ex.: saudacao_inicial)"; erro "Template name must contain only lowercase letters, numbers, and underscores" | nada confere no cliente; o erro do backend chega em inglês cru |
| CFG-MSG-TPL-53 | variante | Categoria só Utilidade ou Marketing (Autenticação não entra) | components/TemplatesAdminTab.jsx:262 | "Utilidade" / "Marketing" | — |
| CFG-MSG-TPL-54 | interação:digitando | cada `{{n}}` no corpo faz nascer um campo "Exemplo para {{n}}" | components/TemplatesAdminTab.jsx:297 | "Exemplos das variáveis" + "A Meta exige um exemplo por variável…" | — |
| CFG-MSG-TPL-55 | validação | variáveis fora de sequência ({{1}} e {{3}}) | components/TemplatesAdminTab.jsx:357 | pede exemplo até {{3}}; o backend recusa: "Template variables must be sequential starting at {{1}} with no gaps" | o formulário pede exemplo de variável inexistente; o erro chega em inglês cru |
| CFG-MSG-TPL-56 | validação | exemplo só com espaços (passa pelo `required`; o cliente faz trim) | components/TemplatesAdminTab.jsx:357 | "{error}" (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js: Each example must be a non-empty string) | inglês cru |
| CFG-MSG-TPL-57 | validação | botão com mais de 25 caracteres | components/TemplatesAdminTab.jsx:336 | (maxLength=25: para de aceitar; o texto explica "Até 3 botões, de 25 caracteres cada") | — (sem contador) |
| CFG-MSG-TPL-58 | variante | prévia dos botões preenchidos (chips) | components/TemplatesAdminTab.jsx:343 | "{texto do botão}" em chips azuis | — |
| CFG-MSG-TPL-59 | validação | botões repetidos, ou botão com {{n}} | components/TemplatesAdminTab.jsx:357 | "{error}" (mensagem do servidor em português sem acentos: Os botoes nao podem ter textos repetidos / O texto do botao nao aceita variaveis) | sem checagem no formulário; mensagem do backend sem acentos; chips com key repetida |
| CFG-MSG-TPL-60 | validação | nome e idioma já existem na WABA (409) | components/TemplatesAdminTab.jsx:357 (texto em utils/errorMessages.js:78) | "Já existe um template com este nome e idioma nesta WABA." | — |
| CFG-MSG-TPL-61 | erro | a Meta recusou (502) | components/TemplatesAdminTab.jsx:357 | "A Meta recusou: {detalhe}" | (suspeita) o detalhe da Meta pode vir em inglês |
| CFG-MSG-TPL-62 | erro | canal sem WABA configurada | components/TemplatesAdminTab.jsx:357 | "{error}" (mensagem do servidor em inglês, sem tradução em utils/errorMessages.js: This channel has no WABA configured yet) | inglês cru |
| CFG-MSG-TPL-63 | erro | outra falha | components/TemplatesAdminTab.jsx:357 | "Falha ao criar template" (WaError) | — |
| CFG-MSG-TPL-64 | salvando | cadastrando | components/TemplatesAdminTab.jsx:362 | ("Cadastrar" esmaecido, aria-busy) | — |
| CFG-MSG-TPL-65 | sucesso | criou → fecha o diálogo + `refresh()` | components/TemplatesAdminTab.jsx:757 | (o template novo aparece na lista, em geral "Em análise"; nenhuma mensagem) | — |
| CFG-MSG-TPL-66 | variante | prévia do corpo do rascunho | components/TemplatesAdminTab.jsx:281 | AUSENTE (só os botões têm prévia) | — |
| CFG-MSG-TPL-67 | responsivo | ≥sm: Categoria e Idioma lado a lado; diálogo max-w-4xl com rolagem interna | components/TemplatesAdminTab.jsx:256 | (2 colunas) | — |

### Templates — "Registrar template existente" (diálogo) — `components/TemplatesAdminTab.jsx` (`RegisterExistingTemplateForm`)

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-MSG-TPL-68 | interação:diálogo aberto | "Registrar existente" (bloco "Já tem um template cadastrado?") | components/TemplatesAdminTab.jsx:767 | "Registrar template existente" + "Para um template já aprovado pela Meta fora deste sistema…" | — |
| CFG-MSG-TPL-69 | validação | canal não escolhido (placeholder + `required`) | components/TemplatesAdminTab.jsx:402 | "Selecione um canal" (balão nativo) | — (diferente do Novo template, este não se preenche sozinho se os canais chegarem depois) |
| CFG-MSG-TPL-70 | validação | nome e idioma não encontrados na WABA | components/TemplatesAdminTab.jsx:445 | "No template with this name and language was found for this WABA" | inglês cru, e é o erro mais provável desta tela (nome digitado errado) |
| CFG-MSG-TPL-71 | validação | nome inválido, template sem corpo ou canal sem WABA | components/TemplatesAdminTab.jsx:445 | "{error}" (mensagens do servidor em inglês, sem tradução em utils/errorMessages.js: Template name must contain only lowercase letters, numbers, and underscores / The matched template has no body text to register / This channel has no WABA configured yet) | inglês cru |
| CFG-MSG-TPL-72 | validação | já registrado (409) | components/TemplatesAdminTab.jsx:445 (texto em utils/errorMessages.js:78) | "Já existe um template com este nome e idioma nesta WABA." | — |
| CFG-MSG-TPL-73 | erro | outra falha | components/TemplatesAdminTab.jsx:445 | "Falha ao registrar template" / "A Meta recusou: …" (WaError) | — |
| CFG-MSG-TPL-74 | salvando | registrando | components/TemplatesAdminTab.jsx:450 | ("Registrar" esmaecido) | — |
| CFG-MSG-TPL-75 | sucesso | registrou → fecha + `refresh()` | components/TemplatesAdminTab.jsx:772 | (nenhuma mensagem) | — |
| CFG-MSG-TPL-76 | responsivo | ≥sm: Idioma e Cabeçalho lado a lado | components/TemplatesAdminTab.jsx:416 | "Idioma" · "Cabeçalho" · "Nenhum" · "Documento" · "Imagem" · "Vídeo" | — |

#### 7.5 Equipe e permissões


### Equipe e permissões (moldura) — `pages/settings/team/TeamLayout.jsx`

Como se chega na tela: Configurações → grupo "Equipe e permissões" (`/configuracoes/equipe/*`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EQP-LAY-01 | sem-permissão | atendente abre qualquer `/configuracoes/equipe/*` | App.jsx:157 | "Sem acesso a {areaLabel}" | — (o ProtectedRoute do SettingsShell, `pages/settings/SettingsShell.jsx:56`, com "Equipe e permissões", nunca chega a aparecer: o de fora bloqueia antes) |
| CFG-EQP-LAY-02 | variante | subpágina ativa | pages/settings/team/TeamLayout.jsx:12 (texto em navigation/navItems.js:68) | "Contas e status dos atendentes." / "Filas e times de atendimento." / "Acesso a páginas e ações por perfil." | — |
| CFG-EQP-LAY-03 | variante | URL `/configuracoes/equipe` sem subrota | App.jsx:170 | (redireciona para `usuarios`) | — |

### Usuários (tabela) — `components/AgentsAdminTab.jsx`

Como se chega na tela: `/configuracoes/equipe/usuarios` (`pages/settings/team/UsersPage.jsx` renderiza `<AgentsAdminTab />` sem props → modo não controlado do "Adicionar usuário").

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EQP-USR-01 | carregando | 1ª carga de GET /api/admin/agents | components/AgentsAdminTab.jsx:320 | (esqueleto de 3 linhas do AsyncState) | — |
| CFG-EQP-USR-02 | carregando | durante carga/erro/sem-permissão | components/AgentsAdminTab.jsx:316 | "{n} usuários" · "{n} usuário" | contador "0 usuários" contradiz o carregando/erro |
| CFG-EQP-USR-03 | recarregando | refresh() após criar, salvar setores ou desativar | components/AgentsAdminTab.jsx:320 | (não exibido: hook não expõe `reloading`) | — |
| CFG-EQP-USR-04 | erro | GET falha (1ª carga ou recarga depois de uma ação) | components/AgentsAdminTab.jsx:320 (texto em components/ui/AsyncState.jsx:22) | role=alert "Não foi possível carregar." | erro sem "Tentar de novo" (sem `onRetry`); `error` do hook não é passado → mensagem genérica; recarga que falha apaga a tabela inteira |
| CFG-EQP-USR-05 | sem-permissão | GET devolve 403 (ex.: conta rebaixada com sessão aberta) | components/AgentsAdminTab.jsx:320 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role (primitivo) |
| CFG-EQP-USR-06 | vazio | `agents.length === 0` | components/AgentsAdminTab.jsx:320 | "Nenhum usuário cadastrado ainda." | — (na prática inalcançável: quem vê a tela está na lista) |
| CFG-EQP-USR-07 | filtro-ativo | busca, "Perfil" ou "Situação" diferente de "todos" | components/AgentsAdminTab.jsx:316 | "{visíveis} de {total} usuários" | — |
| CFG-EQP-USR-08 | vazio-por-filtro | nenhum usuário casa com busca+filtros | components/AgentsAdminTab.jsx:345 | "Nenhum usuário com esse filtro." | — (não há atalho "Limpar filtros") |
| CFG-EQP-USR-09 | variante | conta ativa × inativa | components/AgentsAdminTab.jsx:39 | "Ativo" · "Inativo" · (linha inativa esmaecida e no fim da lista) | — |
| CFG-EQP-USR-10 | variante | papel da conta | components/AgentsAdminTab.jsx:121 | "Administrador" / "Gerente" / "Atendente" (texto simples; papel desconhecido cai em "Atendente") | — |
| CFG-EQP-USR-11 | variante | gerente COM "Pode gerenciar Canais e Integrações" | components/AgentsAdminTab.jsx:121 | AUSENTE — mostra só "Gerente" | `canManageIntegrations` vem na resposta (src/api/admin-agents.routes.js:19) mas não aparece: não dá para saber quem tem a permissão de credenciais |
| CFG-EQP-USR-12 | variante | setores da conta | components/AgentsAdminTab.jsx:123 | "Nenhum setor" · (nomes dos setores unidos por vírgula) | — |
| CFG-EQP-USR-13 | hover-revela | lista de setores maior que 220px | components/AgentsAdminTab.jsx:122 | (reticências; lista completa só no `title`) | conteúdo completo só por hover (title), inacessível a toque/teclado |
| CFG-EQP-USR-14 | variante | foto × iniciais | components/AgentsAdminTab.jsx:114 | (sempre iniciais cinza) | foto nunca aparece: GET /api/admin/agents não devolve `avatarPath` (src/api/admin-agents.routes.js:12-22) |
| CFG-EQP-USR-15 | variante | linha da própria conta (`isSelf`) | components/AgentsAdminTab.jsx:139 | (só "Editar"; sem "⋯") | chip "você" AUSENTE; o menu some sem explicação |
| CFG-EQP-USR-16 | variante | gerente logado vendo linha de admin ou de outro gerente | components/AgentsAdminTab.jsx:130-148 | ("Editar" e "⋯" iguais aos de atendente) | ações oferecidas que o backend recusa (403 "Managers can only manage attendant accounts"); nada desabilitado nem explicado |
| CFG-EQP-USR-17 | interação:menu aberto | clique no "⋯" | components/AgentsAdminTab.jsx:140-147 | itens "Gerar nova senha" · "Desativar" (ou "Reativar") | — |
| CFG-EQP-USR-18 | interação:tooltip | hover no "⋯" | components/ui/DataTable.jsx:114 | "Mais ações para {nome}" | — |
| CFG-EQP-USR-19 | confirmação | "Desativar"/"Reativar" | components/AgentsAdminTab.jsx:144 | AUSENTE — age na hora | desativar conta sem confirmação (irmãos Setores/Cidades/Planos confirmam exclusão) |
| CFG-EQP-USR-20 | salvando | desativação em andamento | components/AgentsAdminTab.jsx:238-240 | AUSENTE (menu já fechou; nada indica) | sem indicação de andamento |
| CFG-EQP-USR-21 | erro | desativar falha (ex.: gerente em conta de admin → 403; rede) | components/AgentsAdminTab.jsx:238-241 | AUSENTE (nada aparece) | erro silencioso: `handleToggleActive` sem try/catch → rejeição não tratada |
| CFG-EQP-USR-22 | sucesso | desativar/reativar ok | components/AgentsAdminTab.jsx:126 | (badge muda; linha pula para o fim/início da lista) | — |
| CFG-EQP-USR-23 | confirmação | "Gerar nova senha" | components/AgentsAdminTab.jsx:141 | AUSENTE — troca a senha na hora | ação destrutiva (invalida a senha atual da pessoa) sem confirmação |
| CFG-EQP-USR-24 | salvando | gerando senha | components/AgentsAdminTab.jsx:141 | (item `disabled`, mas o menu fecha no clique → invisível) | sem indicação de andamento |
| CFG-EQP-USR-25 | erro | falha ao gerar senha | components/AgentsAdminTab.jsx:156 | WaError (role=alert) em linha extra: "Falha ao gerar senha" / "Gerentes só podem gerenciar contas de atendente." / "Troque a sua própria senha pelo \"Meu perfil\"." | erro fica preso na linha até nova tentativa (não há como dispensar) |
| CFG-EQP-USR-26 | sucesso | senha gerada → modal | components/AgentsAdminTab.jsx:193-212 | título "Nova senha gerada"; "Copie e repasse essa senha pro atendente — ela só aparece essa vez."; senha em `<code>`; "Copiar"; "Fechar" (+ "×" Fechar) | fecha com clique no fundo (`closeOnBackdrop`) e a senha "que só aparece essa vez" se perde; texto diz "atendente" mesmo para gerente/admin |
| CFG-EQP-USR-27 | variante | clique em "Copiar" | components/AgentsAdminTab.jsx:203 | "Copiar" → "Copiado!" | troca não anunciada (sem aria-live) (suspeita) |
| CFG-EQP-USR-28 | erro | `navigator.clipboard` falha (sem permissão/contexto inseguro) | components/AgentsAdminTab.jsx:71-74 | AUSENTE | erro silencioso (writeText sem try/catch) |
| CFG-EQP-USR-29 | edição-inline | botão "Editar" (aria-label "Editar setores de {nome}", aria-expanded) | components/AgentsAdminTab.jsx:159 | "Setores de {nome}" · "Salvar" · "Cancelar" · (caixa de seleção por setor) | — (o botão diz só "Editar", mas só edita setores) |
| CFG-EQP-USR-30 | seleção | marcar/desmarcar setor | components/AgentsAdminTab.jsx:165-173 | (checkbox por setor) | — |
| CFG-EQP-USR-31 | vazio | editor aberto sem setores | components/AgentsAdminTab.jsx:161 | "Nenhum setor cadastrado. Cadastre um na aba Setores." | aparece também enquanto `useSectors` carrega ou quando falhou (carregando/erro disfarçados de vazio); "aba Setores" não existe (é item do menu) |
| CFG-EQP-USR-32 | salvando | "Salvar" setores | components/AgentsAdminTab.jsx:179 | (botão esmaece, aria-busy) | — |
| CFG-EQP-USR-33 | erro | falha ao salvar setores | components/AgentsAdminTab.jsx:177 | WaError "Falha ao salvar setores" / "Gerentes só podem gerenciar contas de atendente." | — |
| CFG-EQP-USR-34 | sucesso | setores salvos | components/AgentsAdminTab.jsx:97-98 → :123 | (editor fecha; coluna Setores atualiza após recarga) | — |
| CFG-EQP-USR-35 | edição-inline | editar nome, e-mail, perfil ou "Pode gerenciar Canais e Integrações" de conta existente | components/AgentsAdminTab.jsx:137 | AUSENTE | não existe; mas pages/AccessDeniedPage.jsx:7 manda pedir a permissão "marcada na conta pelo administrador" — hoje só dá para marcar ao criar |
| CFG-EQP-USR-36 | variante | texto fixo do resumo | components/AgentsAdminTab.jsx:317 | "A situação da conta é diferente do status online." | — |
| CFG-EQP-USR-37 | responsivo | tela estreita | components/AgentsAdminTab.jsx:321 (min-w-[720px]), :273 (flex-wrap); components/overlays.css:228 | tabela rola na horizontal; barra de busca/filtros quebra linha; editor de setores vira 1 coluna ≤680px | — |

### Modal "Adicionar usuário" — `components/CreateAgentForm.jsx` (aberto por `components/AgentsAdminTab.jsx`)

Como se chega na tela: botão "Adicionar usuário" (AgentsAdminTab.jsx:267).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EQP-ADD-01 | interação:modal aberto | clique em "Adicionar usuário" | components/AgentsAdminTab.jsx:369 | título "Adicionar usuário"; campos "Nome", "E-mail", "Senha temporária", "Tipo"; "Cancelar" / "Cadastrar"; "×" Fechar | — (o campo chama "Tipo", a tabela e o filtro chamam "Perfil") |
| CFG-EQP-ADD-02 | validação | campo vazio / e-mail malformado | components/CreateAgentForm.jsx:60, :73, :86 | (balão nativo do navegador: `required`, `type=email`) | — |
| CFG-EQP-ADD-03 | variante | "Tipo" = Gerente | components/CreateAgentForm.jsx:104-114 | checkbox "Pode gerenciar Canais e Integrações" | — |
| CFG-EQP-ADD-04 | variante | gerente logado abre o modal | components/CreateAgentForm.jsx:99-101 | opções "Gerente" e "Administrador" disponíveis | oferece o que o backend recusa (vira "Gerentes só podem criar contas de atendente."); não há desabilitado nem motivo — contradiz a regra listada em Perfis (RolesPage.jsx:19) |
| CFG-EQP-ADD-05 | variante | "Senha temporária" | components/CreateAgentForm.jsx:80-87 | (senha em texto claro, `type="text"`, sem mínimo indicado) | — |
| CFG-EQP-ADD-06 | salvando | "Cadastrar" | components/CreateAgentForm.jsx:122 | (botão esmaece, aria-busy) | — |
| CFG-EQP-ADD-07 | erro | POST falha | components/CreateAgentForm.jsx:115 | "Falha ao cadastrar atendente" / "Já existe um atendente com este e-mail." / "Gerentes só podem criar contas de atendente." | `<p>` montado à mão sem role="alert" (o resto da área usa WaError) |
| CFG-EQP-ADD-08 | sucesso | conta criada | components/AgentsAdminTab.jsx:373-376 | (modal fecha, lista recarrega; sem mensagem) | — |
| CFG-EQP-ADD-09 | responsivo | ≤680px | components/overlays.css:207 (e :152-155) | grade de 2 colunas do formulário vira 1 | — |
| CFG-EQP-ADD-10 | variante | modo não embutido | components/CreateAgentForm.jsx:48-50 | "Cadastrar novo usuário" (h3 + moldura) | — (código sem uso: só é montado `embedded`) |

### Setores (tabela) — `components/SectorsAdminTab.jsx`

Como se chega na tela: `/configuracoes/equipe/setores` (`pages/settings/team/SectorsPage.jsx` passa `creating`/`onCreatingChange` → modo controlado).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EQP-SET-01 | carregando | 1ª carga de setores | components/SectorsAdminTab.jsx:172 | (esqueleto de 3 linhas do AsyncState) | — |
| CFG-EQP-SET-02 | carregando | durante carga/erro/sem-permissão | components/SectorsAdminTab.jsx:197 | "{n} setores" · "{n} setor" | contador "0 setores" contradiz o carregando/erro |
| CFG-EQP-SET-03 | recarregando | refresh() após criar/editar/excluir | components/SectorsAdminTab.jsx:172 | (não exibido) | — |
| CFG-EQP-SET-04 | erro | GET falha | components/SectorsAdminTab.jsx:172 (texto em components/ui/AsyncState.jsx:22) | role=alert "Não foi possível carregar." | erro sem "Tentar de novo"; mensagem genérica; recarga que falha apaga a tabela |
| CFG-EQP-SET-05 | sem-permissão | GET 403 | components/SectorsAdminTab.jsx:172 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role (primitivo) |
| CFG-EQP-SET-06 | vazio | nenhum setor | components/SectorsAdminTab.jsx:172 | "Nenhum setor cadastrado ainda." | — |
| CFG-EQP-SET-07 | variante | setor sem orientação para a IA | components/SectorsAdminTab.jsx:121 | "Sem orientação" | — |
| CFG-EQP-SET-08 | hover-revela | orientação maior que 380px | components/SectorsAdminTab.jsx:120 | (reticências; texto completo só no `title`) | conteúdo completo só por hover (title) |
| CFG-EQP-SET-09 | edição-inline | "Editar" | components/SectorsAdminTab.jsx:73-112 | a LINHA vira formulário: "Nome", "Orientação para a IA" (textarea), "Salvar" / "Cancelar" | — ("Editar"/"Excluir" sem o nome do setor no rótulo acessível, ao contrário de Cidades/Planos) |
| CFG-EQP-SET-10 | validação | "Nome" vazio | components/SectorsAdminTab.jsx:86 | (balão nativo `required`) | nome só com espaços passa e volta do backend como 'O campo "name" é obrigatório.' (nome de campo em inglês) |
| CFG-EQP-SET-11 | salvando | "Salvar" | components/SectorsAdminTab.jsx:103 | (botão esmaece, aria-busy) | — |
| CFG-EQP-SET-12 | erro | PATCH falha | components/SectorsAdminTab.jsx:101 | WaError "Falha ao salvar" / "Setor não encontrado." / 'O campo "name" é obrigatório.' | texto técnico parcial ("name") |
| CFG-EQP-SET-13 | sucesso | salvo | components/SectorsAdminTab.jsx:32-33 | (linha volta ao resumo com os dados novos) | — |
| CFG-EQP-SET-14 | confirmação | "Excluir" | components/SectorsAdminTab.jsx:57 | "Excluir o setor \"{nome}\"?" · "Excluir" | não diz o que acontece: o setor sai dos atendentes e das opções da triagem por menu (CASCADE) e as conversas ficam sem setor (SET NULL); um setor já escolhido pela triagem da IA não pode ser excluído (FK sem ON DELETE) e a falha chega como erro genérico do servidor |
| CFG-EQP-SET-15 | salvando | excluindo | components/SectorsAdminTab.jsx:130 | ("Excluir" esmaece, aria-busy) | — |
| CFG-EQP-SET-16 | erro | DELETE falha | components/SectorsAdminTab.jsx:123 | WaError na célula da orientação: "Falha ao excluir" / "Setor não encontrado." / "O servidor encontrou um erro. Tente de novo em instantes." | erro fica preso até nova tentativa |
| CFG-EQP-SET-17 | sucesso | excluído | components/SectorsAdminTab.jsx:65 | (linha some após recarga) | — |
| CFG-EQP-SET-18 | responsivo | tela estreita | components/SectorsAdminTab.jsx:173; pages/settings/settings.css:57 (min-width 560px) | tabela rola na horizontal | — |
| CFG-EQP-SET-19 | variante | modo não controlado | components/SectorsAdminTab.jsx:215 (texto em components/CreateSectorForm.jsx:38) | formulário inline "Cadastrar novo setor" | — (código sem uso: a rota sempre controla) |

### Modal "Adicionar setor" — `components/CreateSectorForm.jsx`

Como se chega na tela: botão "Adicionar setor" (SectorsAdminTab.jsx:165).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EQP-SETN-01 | interação:modal aberto | "Adicionar setor" | components/SectorsAdminTab.jsx:202 | título "Adicionar setor"; campo "Nome"; "Cancelar" / "Cadastrar"; "×" | — (a orientação para a IA só pode ser preenchida depois, editando) |
| CFG-EQP-SETN-02 | validação | "Nome" vazio | components/CreateSectorForm.jsx:41 | (balão nativo) | só espaços → 'O campo "name" é obrigatório.' (inglês no texto) |
| CFG-EQP-SETN-03 | salvando | "Cadastrar" | components/CreateSectorForm.jsx:51 | (botão esmaece) | — |
| CFG-EQP-SETN-04 | erro | POST falha | components/CreateSectorForm.jsx:44 | "Falha ao cadastrar setor" | `<p>` sem role="alert" |
| CFG-EQP-SETN-05 | sucesso | criado | components/SectorsAdminTab.jsx:206-209 | (modal fecha, lista recarrega) | — |

### Perfis e permissões — `pages/settings/team/RolesPage.jsx`

Como se chega na tela: `/configuracoes/equipe/perfis`. Página estática (sem carregamento; derivada de `navigation/navItems.js`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EQP-PER-01 | variante | colunas de perfil | pages/settings/team/RolesPage.jsx:40 | "Atendente" · "Gerente" · "Gerente com credenciais" · "Administrador" | — |
| CFG-EQP-PER-02 | variante | cabeçalho de grupo | pages/settings/team/RolesPage.jsx:45 | "Navegação principal", grupos de Configurações, "Ações com credenciais" | — |
| CFG-EQP-PER-03 | variante | permitido × negado (hasLevel) | pages/settings/team/RolesPage.jsx:52 | "Sim" · "Não" | — |
| CFG-EQP-PER-04 | variante | cartão de regras fixas | pages/settings/team/RolesPage.jsx:59-62 | "Regras que não dependem de página" + 6 regras (ex.: "Gerente só cria e edita contas de atendente; nunca de outro gerente ou administrador.") | a tela Usuários contradiz a regra 1 na interface (CFG-EQP-ADD-04, CFG-EQP-USR-16) |
| CFG-EQP-PER-05 | responsivo | largura do contêiner | pages/settings/settings.css:196-198; RolesPage.jsx:36 (min-w-[560px]) | ≥1050px: regras viram coluna lateral de 230px; cabeçalho da tabela fixo (sticky); abaixo disso a tabela rola na horizontal | — |

#### 7.6 Integrações


### Integrações (casca comum) — `pages/settings/integrations/IntegrationsLayout.jsx`

Como se chega na tela: `/configuracoes/integracoes` (redireciona para `sgp/consultas`). Nível integrations.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-INT-HUB-01 | sem-permissão | atendente, ou gerente sem "Pode gerenciar Canais e Integrações" | pages/settings/integrations/IntegrationsLayout.jsx:47 | "Sem acesso a {areaLabel}" | — |
| CFG-INT-HUB-02 | variante | selo do SGP: consultas | pages/settings/integrations/IntegrationsLayout.jsx:34-41 | (nada enquanto carrega) / "Não configurado" / "Ativo" / "Inativo" | se a carga falhar o selo some sem aviso |
| CFG-INT-HUB-03 | variante | selo da OpenAI | pages/settings/integrations/IntegrationsLayout.jsx:43 | "Conectada" · "Desativada" · "Não configurada" | se a carga falhar (erro ou 403) o selo some sem aviso, como no HUB-02 |
| CFG-INT-HUB-04 | variante | subtítulo do SGP: Pix e boleto | pages/settings/integrations/IntegrationsLayout.jsx:57 | "1 integração por canal" / "{n} integrações por canal" | mostra "0 integrações por canal" durante a carga e se ela falhar |
| CFG-INT-HUB-05 | seleção | rota atual | pages/settings/integrations/IntegrationsLayout.jsx:55-57 | (link da página atual com aria-current) | — |

### SGP: consultas — `pages/settings/integrations/SgpQueryPage.jsx` (+ `components/SgpQueryConfigCard.jsx`, `hooks/useSgpQueryConfig.js`)

Como se chega na tela: `/configuracoes/integracoes/sgp/consultas`; também pelo link "Consulta ao SGP" do aviso em SGP: Pix e boleto. Nível integrations.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-INT-SGPC-01 | sem-permissão | mesma regra (portão repetido dentro da casca) | pages/settings/integrations/SgpQueryPage.jsx:14 | "Sem acesso a {areaLabel}" | — |
| CFG-INT-SGPC-02 | carregando | 1ª carga | components/SgpQueryConfigCard.jsx:97 | (esqueleto 2 linhas) | — |
| CFG-INT-SGPC-03 | erro | falha em GET sgp-query-config | components/SgpQueryConfigCard.jsx:97 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado |
| CFG-INT-SGPC-04 | vazio | `!config.configured` | components/SgpQueryConfigCard.jsx:98-107 | "O chat ainda não consulta o SGP. Informe o endereço, o app e o token…" + "Criar integração" | — |
| CFG-INT-SGPC-05 | variante | configurada (resumo) | components/SgpQueryConfigCard.jsx:110-139 | "Endereço do SGP" / "App" / "Situação" / "Credencial" + "Editar conexão" | — |
| CFG-INT-SGPC-06 | variante | `enabled` | components/SgpQueryConfigCard.jsx:123-126 | (bolinha) "Ativa" / "Inativa" | o rótulo não bate com o selo do topo ("Ativo"/"Inativo") |
| CFG-INT-SGPC-07 | variante | credencial mascarada | components/SgpQueryConfigCard.jsx:130-134 | "••••••••••{4 últimos}" + "Configurada" | — |
| CFG-INT-SGPC-08 | hover-revela | URL longa truncada | components/SgpQueryConfigCard.jsx:113 | (title com a URL completa) | a URL completa só aparece passando o mouse (sem acesso por toque ou teclado) |
| CFG-INT-SGPC-09 | resumo↔formulário | "Criar integração" / "Editar conexão" | components/SgpQueryConfigCard.jsx:148-186 | "Conexão para consultas" com URL / App / Token / Ativo + "Cancelar" / "Salvar consulta ao SGP" | — |
| CFG-INT-SGPC-10 | variante | token salvo, sem trocar | components/SgpQueryConfigCard.jsx:160-166 | "Token terminando em ...{4}" + "Trocar token" | — |
| CFG-INT-SGPC-11 | variante | 1ª configuração ou "Trocar token" | components/SgpQueryConfigCard.jsx:168-170 | "Token" (campo) | o token fica visível enquanto é digitado (sem type=password), ao contrário da chave da OpenAI |
| CFG-INT-SGPC-12 | variante | caixa "Ativo" desmarcada | components/SgpQueryConfigCard.jsx:173-176 | "Ativo" | (suspeita) desligar não explica o efeito (o painel e a IA param de consultar) e não pede confirmação; o aviso só existe na página de envios |
| CFG-INT-SGPC-13 | validação | URL, app ou token (na 1ª vez) vazios | components/SgpQueryConfigCard.jsx:59-70 → :177 | "URL é obrigatória" / "App é obrigatório" / "Token é obrigatório" | sem role=alert; campo não fica marcado |
| CFG-INT-SGPC-14 | salvando | "Salvar consulta ao SGP" | components/SgpQueryConfigCard.jsx:182 | "Salvar consulta ao SGP" (esmaecido, aria-busy) | — |
| CFG-INT-SGPC-15 | erro | PUT falha | components/SgpQueryConfigCard.jsx:177 | (erro traduzido ou "Falha ao salvar") | sem role=alert |
| CFG-INT-SGPC-16 | sucesso | PUT ok | components/SgpQueryConfigCard.jsx:93 (volta ao resumo) | AUSENTE | volta ao resumo sem mensagem de salvo |
| CFG-INT-SGPC-17 | interação:testando | testar a conexão com o SGP | components/SgpQueryConfigCard.jsx:178 (texto em components/OpenAiConfigCard.jsx:158) | AUSENTE: não existe "Testar conexão" | URL, app ou token errados só aparecem quando o atendimento ou a IA tentam consultar |
| CFG-INT-SGPC-18 | responsivo | largura ≥ lg | pages/settings/integrations/SgpQueryPage.jsx:15 | (cartão + coluna "Onde esta integração é usada") | — |

### SGP: Pix e boleto (integrações por canal) — `pages/settings/integrations/SgpChannelPage.jsx` (+ `components/integrations/CreateSgpIntegrationForm.jsx`, `components/integrations/SgpIntegrationCard.jsx`, `hooks/useSgpIntegrations.js`)

Como se chega na tela: `/configuracoes/integracoes/sgp/envios`. Nível integrations.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-INT-SGPE-01 | sem-permissão | mesma regra (portão repetido) | pages/settings/integrations/SgpChannelPage.jsx:23 | "Sem acesso a {areaLabel}" | — |
| CFG-INT-SGPE-02 | variante | Consulta ao SGP configurada e desligada | pages/settings/integrations/SgpChannelPage.jsx:35-45 | "A Consulta ao SGP está desativada" / "O painel na conversa e a IA não consultam o SGP enquanto ela estiver desligada. Ative em Consulta ao SGP." | (suspeita) não aparece quando a Consulta nem foi configurada |
| CFG-INT-SGPE-03 | variante | `creating` = true | pages/settings/integrations/SgpChannelPage.jsx:29-33 | botão "Nova integração SGP" some | — |
| CFG-INT-SGPE-04 | carregando | 1ª carga | pages/settings/integrations/SgpChannelPage.jsx:58 | (esqueleto 3 linhas) | — |
| CFG-INT-SGPE-05 | erro-com-retry | falha em listar | pages/settings/integrations/SgpChannelPage.jsx:58 | (mensagem traduzida do erro e botão Tentar de novo, ambos do AsyncState) | — |
| CFG-INT-SGPE-06 | sem-permissão | API 403 (permissão tirada no meio da sessão) | pages/settings/integrations/SgpChannelPage.jsx:58 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | — |
| CFG-INT-SGPE-07 | vazio | nenhuma integração | pages/settings/integrations/SgpChannelPage.jsx:62-63 | "Nenhuma integração SGP por canal ainda." | — |
| CFG-INT-SGPE-08 | recarregando | refresh depois de criar, editar, ativar ou gerar chave | pages/settings/integrations/SgpChannelPage.jsx:58 | AUSENTE | `reloading` não exposto |
| CFG-INT-SGPE-09 | expandido | "Nova integração SGP" | pages/settings/integrations/SgpChannelPage.jsx:46-57 → components/integrations/CreateSgpIntegrationForm.jsx:72 | "Nova integração SGP" + Descrição / Canal / Ativo + "Cadastrar" / "Cancelar" | — |
| CFG-INT-SGPE-10 | vazio | nenhum canal elegível (todos já integrados, ou nenhum Baileys/oficial) | components/integrations/CreateSgpIntegrationForm.jsx:82-85 | AUSENTE (select só com "Selecione um canal") | não explica por que não há canal; o formulário termina em "Escolha um canal" |
| CFG-INT-SGPE-11 | variante | canal escolhido é oficial (Meta Cloud/360dialog) | components/integrations/CreateSgpIntegrationForm.jsx:89-99 | "Template padrão (opcional)" + "Nenhum" + aprovados | sem template aprovado só existe "Nenhum", sem explicação |
| CFG-INT-SGPE-12 | validação | descrição vazia ou canal não escolhido | components/integrations/CreateSgpIntegrationForm.jsx:35-42 → :104 | "Descrição é obrigatória" / "Escolha um canal" | sem role=alert |
| CFG-INT-SGPE-13 | salvando | "Cadastrar" | components/integrations/CreateSgpIntegrationForm.jsx:106 | "Cadastrar" (esmaecido) | usa `disabled` em vez de `loading`: sem aria-busy |
| CFG-INT-SGPE-14 | erro | POST falha | components/integrations/CreateSgpIntegrationForm.jsx:104 | (erro traduzido ou "Falha ao cadastrar a integração") | sem role=alert |
| CFG-INT-SGPE-15 | sucesso | criada | pages/settings/integrations/SgpChannelPage.jsx:51-54 | AUSENTE (formulário fecha) | sem confirmação; nenhuma chave é mostrada (a 1ª só sai por "Gerar nova chave" na zona de perigo) |
| CFG-INT-SGPE-16 | variante | cabeçalho do cartão por tipo de canal | components/integrations/SgpIntegrationCard.jsx:109 | "{descrição}" · "{canal} — {modo}" | — |
| CFG-INT-SGPE-17 | variante | canal não encontrado | components/integrations/SgpIntegrationCard.jsx:109 | "Canal removido" | também aparece em TODOS os cartões enquanto os canais carregam ou se a carga falhar (`useChannels` sem status; erro silencioso) |
| CFG-INT-SGPE-18 | variante | caixa "Ativo" (salva na hora) | components/integrations/SgpIntegrationCard.jsx:112-121 | "Ativo" | — |
| CFG-INT-SGPE-19 | salvando | marcar/desmarcar "Ativo" | components/integrations/SgpIntegrationCard.jsx:75-87 | AUSENTE (sem estado pendente) | dá para clicar de novo no meio; a caixa só muda depois do refresh |
| CFG-INT-SGPE-20 | variante | `hasApiKey` | components/integrations/SgpIntegrationCard.jsx:123 | "Uma chave já foi gerada." / "Nenhuma chave foi gerada ainda." | — |
| CFG-INT-SGPE-21 | edição-inline | "Editar" | components/integrations/SgpIntegrationCard.jsx:126 → :130-180 | Descrição / Canal (+ Template padrão se oficial) + "Salvar" / "Cancelar" | — |
| CFG-INT-SGPE-22 | salvando | "Salvar" da edição | components/integrations/SgpIntegrationCard.jsx:177 | "Salvar" (esmaecido) | usa `disabled`: sem aria-busy |
| CFG-INT-SGPE-23 | erro | edição, ativação ou geração de chave falham | components/integrations/SgpIntegrationCard.jsx:188 | (erro traduzido ou "Falha ao atualizar" / "Falha ao gerar a chave") | sem role=alert; sem validação local na edição: descrição vazia ou canal apagado voltam como texto técnico 'O campo "description" é obrigatório.' / 'O campo "channelId" é obrigatório.' |
| CFG-INT-SGPE-24 | variante | zona de perigo (sempre visível) | components/integrations/SgpIntegrationCard.jsx:189-193 | "Gerar nova chave" / "A chave atual deixa de funcionar assim que uma nova for gerada." | sem chave ainda ("Nenhuma chave foi gerada ainda."), a 1ª chave só sai por este botão vermelho, que fala em trocar uma chave que não existe |
| CFG-INT-SGPE-25 | confirmação | "Gerar nova chave" | components/integrations/SgpIntegrationCard.jsx:190 | AUSENTE | ação destrutiva (derruba a chave em uso pelo SGP) executa num clique, sem confirmação |
| CFG-INT-SGPE-26 | salvando | geração em andamento | components/integrations/SgpIntegrationCard.jsx:190 | "Gerar nova chave" (esmaecido) | usa `disabled`: sem aria-busy |
| CFG-INT-SGPE-27 | sucesso | chave gerada | components/integrations/SgpIntegrationCard.jsx:182-187 | "Copie agora — esta chave não será mostrada novamente:" + chave | sem role=status; sem botão "Copiar"; fica na tela até sair da página |

### OpenAI — `pages/settings/integrations/OpenAiPage.jsx` (+ `components/OpenAiConfigCard.jsx`, `hooks/useAiConfig.js`)

Como se chega na tela: `/configuracoes/integracoes/openai`; também pelo link "OpenAI" em Atendimento com IA. Nível integrations.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-INT-OAI-01 | sem-permissão | mesma regra (portão repetido) | pages/settings/integrations/OpenAiPage.jsx:14 | "Sem acesso a {areaLabel}" | — |
| CFG-INT-OAI-02 | variante | fixo | pages/settings/integrations/OpenAiPage.jsx:16 | "Acesso a credenciais restrito" | — |
| CFG-INT-OAI-03 | carregando | 1ª carga (selo escondido) | components/OpenAiConfigCard.jsx:110, :114 | (esqueleto 3 linhas; título "Conexão e modelo" sem selo) | — |
| CFG-INT-OAI-04 | erro | falha em GET ai/config | components/OpenAiConfigCard.jsx:114 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | erro sem "Tentar de novo"; `error` não é passado; o selo também some |
| CFG-INT-OAI-05 | variante | selo de situação | components/OpenAiConfigCard.jsx:110-112 | "Desativada" / "Não configurada" / "Erro" / "Conectada" | reflete o "Modo" ainda NÃO salvo e o último teste que falhou nesta visita: pode dizer "Conectada" sem nada salvo |
| CFG-INT-OAI-06 | variante | chave salva (mascarada) | components/OpenAiConfigCard.jsx:117-122 | "Chave terminando em ...{4}" + "Trocar chave" | — |
| CFG-INT-OAI-07 | resumo↔formulário | sem chave, ou "Trocar chave" | components/OpenAiConfigCard.jsx:125-133 | "Chave da API" (campo password) | depois de "Trocar chave" não há como desistir (sem "Cancelar"): só salvando ou saindo da página |
| CFG-INT-OAI-08 | variante | select "Modo" | components/OpenAiConfigCard.jsx:147-151 | "Desativado" / "Assistente" | — |
| CFG-INT-OAI-09 | variante | modo "Desativado" sem chave (sai inerte) | components/OpenAiConfigCard.jsx:85 | selo "Desativada" | — |
| CFG-INT-OAI-10 | interação:testando | "Testar conexão" | components/OpenAiConfigCard.jsx:157 | "Testar conexão" (esmaecido, aria-busy) | — |
| CFG-INT-OAI-11 | sucesso | teste ok | components/OpenAiConfigCard.jsx:141-143 | AUSENTE (só entram modelos no select "Modelo") | nenhum "Conexão OK"; o selo só sai de "Erro" se estava nele, sem dizer que o teste passou |
| CFG-INT-OAI-12 | erro | teste com `ok:false`, ou sem chave nenhuma | components/OpenAiConfigCard.jsx:154 (texto em utils/errorMessages.js:100) | "No API key configured" / "OpenAI rejected the API key" / "Failed to reach OpenAI at /models" | inglês cru (`result.error` não passa por descreverErro); sem role=alert; o selo vira "Erro"; o botão fica ativo mesmo sem chave |
| CFG-INT-OAI-13 | validação | modelo vazio, ou 1ª configuração sem chave e modo ≠ Desativado | components/OpenAiConfigCard.jsx:81-88 → :155 | "Modelo é obrigatório" / "Chave da API é obrigatória" | sem role=alert; campo não fica marcado |
| CFG-INT-OAI-14 | salvando | "Salvar OpenAI" | components/OpenAiConfigCard.jsx:160 | "Salvar OpenAI" (esmaecido, aria-busy) | — |
| CFG-INT-OAI-15 | erro | PUT ai/config falha | components/OpenAiConfigCard.jsx:155 | (erro traduzido ou "Falha ao salvar") | sem role=alert |
| CFG-INT-OAI-16 | sucesso | PUT ok | components/OpenAiConfigCard.jsx:116 | AUSENTE (o campo da chave volta a "Chave terminando em…") | nenhuma mensagem de salvo |
| CFG-INT-OAI-17 | variante | coluna "Usa esta conexão" (fixa) | pages/settings/integrations/OpenAiPage.jsx:19-31 | "Estas automações só funcionam com a OpenAI conectada." + 3 links | — |
| CFG-INT-OAI-18 | responsivo | largura ≥ lg | pages/settings/integrations/OpenAiPage.jsx:17 | (cartão + coluna "Usa esta conexão") | — |

#### 7.7 Cadastros auxiliares


### Cadastros auxiliares (moldura) — `pages/settings/registers/RegistersLayout.jsx`

Como se chega na tela: Configurações → grupo "Cadastros auxiliares" (`/configuracoes/cadastros/*`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-LAY-01 | sem-permissão | atendente abre `/configuracoes/cadastros/*` | App.jsx:157 | "Sem acesso a {areaLabel}" | — |
| CFG-CAD-LAY-02 | variante | subpágina ativa | pages/settings/registers/RegistersLayout.jsx:12 (texto em navigation/navItems.js:84) | "Motivos usados ao finalizar conversas e nos relatórios." / "Cidades usadas no cadastro e nos avisos." / "Planos comerciais: velocidade, mensalidade e instalação." | — |
| CFG-CAD-LAY-03 | variante | URL `/configuracoes/cadastros` sem subrota | App.jsx:176 | (redireciona para `motivos`) | — |

### Motivos de atendimento (tabela) — `components/ReasonsAdminTab.jsx`

Como se chega na tela: `/configuracoes/cadastros/motivos` (`pages/settings/registers/ReasonsPage.jsx` passa `creating` e `aiResolvedReasonId` vindo de `useAiConfig`).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-MOT-01 | carregando | 1ª carga | components/ReasonsAdminTab.jsx:228 | (esqueleto de 3 linhas do AsyncState) | — |
| CFG-CAD-MOT-02 | carregando | durante carga/erro/sem-permissão | components/ReasonsAdminTab.jsx:224 | "{n} motivos" · "{n} motivo" | contador "0 motivos" contradiz o carregando/erro |
| CFG-CAD-MOT-03 | recarregando | refresh() após criar/editar/ativar | components/ReasonsAdminTab.jsx:228 | (não exibido) | — |
| CFG-CAD-MOT-04 | erro | GET falha | components/ReasonsAdminTab.jsx:228 (texto em components/ui/AsyncState.jsx:22) | role=alert "Não foi possível carregar." | erro sem "Tentar de novo"; mensagem genérica; recarga que falha apaga a tabela |
| CFG-CAD-MOT-05 | sem-permissão | GET 403 | components/ReasonsAdminTab.jsx:228 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role (primitivo) |
| CFG-CAD-MOT-06 | vazio | nenhum motivo | components/ReasonsAdminTab.jsx:228 | "Nenhum motivo cadastrado ainda." | não avisa que sem motivo ativo ninguém consegue encerrar atendimento (suspeita, regra do produto) |
| CFG-CAD-MOT-07 | filtro-ativo | busca ou "Status" ≠ todos | components/ReasonsAdminTab.jsx:224 | "{visíveis} de {total} motivos" | — |
| CFG-CAD-MOT-08 | vazio-por-filtro | nada casa | components/ReasonsAdminTab.jsx:250 | "Nenhum motivo com esse filtro." | — |
| CFG-CAD-MOT-09 | variante | ativo × inativo | components/ReasonsAdminTab.jsx:31 | "Ativo" · "Inativo" · (linha inativa esmaecida) | badge com estilo próprio, diferente do "Ativo" de Usuários (inconsistência) |
| CFG-CAD-MOT-10 | variante | motivo escolhido para o encerramento pela IA | components/ReasonsAdminTab.jsx:105-111, :96 | chip "Encerramento pela IA" + linha tingida de laranja; os demais: "Encerramento" | chip depende de 2ª requisição (`useAiConfig`): enquanto carrega ou se falhar, some sem aviso e a confirmação CFG-CAD-MOT-17 deixa de disparar (suspeita) |
| CFG-CAD-MOT-11 | edição-inline | "Editar" (aria-expanded) | components/ReasonsAdminTab.jsx:128-148 | linha extra "Nome do motivo" + "Salvar" / "Cancelar" | 2º clique em "Editar" não fecha (aria-expanded sem alternância) |
| CFG-CAD-MOT-12 | validação | nome vazio | components/ReasonsAdminTab.jsx:136 | (balão nativo) | só espaços → backend responde "name must be a non-empty string" (inglês cru, sem tradução) |
| CFG-CAD-MOT-13 | salvando | "Salvar" | components/ReasonsAdminTab.jsx:138 | (botão esmaece) | — |
| CFG-CAD-MOT-14 | erro | PATCH nome falha | components/ReasonsAdminTab.jsx:144 | WaError "Falha ao salvar" / "Motivo não encontrado." / "name must be a non-empty string" | texto técnico cru em inglês possível |
| CFG-CAD-MOT-15 | sucesso | nome salvo | components/ReasonsAdminTab.jsx:53-54 | (linha extra fecha; nome atualiza) | — |
| CFG-CAD-MOT-16 | interação:menu aberto | "⋯" ("Mais ações para {nome}") | components/ReasonsAdminTab.jsx:119-123 | item único "Desativar" (ou "Ativar") | — |
| CFG-CAD-MOT-17 | confirmação | "Desativar" no motivo usado pela IA | components/ReasonsAdminTab.jsx:76 | "A IA vai parar de encerrar sozinha até outro motivo ser escolhido. Desativar mesmo assim?" · "Desativar mesmo assim" | — |
| CFG-CAD-MOT-18 | confirmação | "Desativar" em motivo comum (inclusive o último ativo) | components/ReasonsAdminTab.jsx:120 | AUSENTE | sem confirmação; nada avisa quando é o último ativo (suspeita: trava encerramentos) |
| CFG-CAD-MOT-19 | salvando | ativando/desativando | components/ReasonsAdminTab.jsx:120 | (item `disabled`, invisível: o menu já fechou) | sem indicação de andamento |
| CFG-CAD-MOT-20 | erro | PATCH active falha | components/ReasonsAdminTab.jsx:99 | WaError abaixo do nome: "Falha ao atualizar o motivo" / "Motivo não encontrado." | erro fica preso até nova tentativa |
| CFG-CAD-MOT-21 | sucesso | ativado/desativado | components/ReasonsAdminTab.jsx:102 | (badge troca; linha esmaece/acende) | — |
| CFG-CAD-MOT-22 | responsivo | tela estreita | components/ReasonsAdminTab.jsx:229; pages/settings/settings.css:57 | tabela (mín. 560px) rola na horizontal; busca+select quebram linha | — |

### Modal "Novo motivo" — `components/CreateReasonForm.jsx`

Como se chega na tela: botão "Novo motivo" (ReasonsAdminTab.jsx:187).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-MOTN-01 | interação:modal aberto | "Novo motivo" | components/ReasonsAdminTab.jsx:267 | título "Novo motivo"; campo "Nome"; "Cancelar" / "Cadastrar"; "×" | — |
| CFG-CAD-MOTN-02 | validação | nome vazio | components/CreateReasonForm.jsx:41 | (balão nativo) | só espaços → 'O campo "name" é obrigatório.' (inglês no texto) |
| CFG-CAD-MOTN-03 | salvando | "Cadastrar" | components/CreateReasonForm.jsx:51 | (botão esmaece) | — |
| CFG-CAD-MOTN-04 | erro | POST falha | components/CreateReasonForm.jsx:44 | "Falha ao cadastrar motivo" | `<p>` sem role="alert" |
| CFG-CAD-MOTN-05 | sucesso | criado | components/ReasonsAdminTab.jsx:271-274 | (modal fecha, lista recarrega) | — |

### Cidades e localidades (tabela) — `components/CitiesAdminTab.jsx`

Como se chega na tela: `/configuracoes/cadastros/cidades` (`pages/settings/registers/CitiesPage.jsx`, modo controlado). Lista vem de `usePlaces()` (hierarquia completa).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-CID-01 | carregando | 1ª carga | components/CitiesAdminTab.jsx:179 | (esqueleto de 3 linhas do AsyncState) | — |
| CFG-CAD-CID-02 | carregando | durante carga/erro/sem-permissão | components/CitiesAdminTab.jsx:177 | "{n} cadastros" · "{n} cadastro" | contador "0 cadastros" contradiz o carregando/erro |
| CFG-CAD-CID-03 | recarregando | refresh() após salvar/excluir | components/CitiesAdminTab.jsx:179 | (não exibido) | — |
| CFG-CAD-CID-04 | erro | GET falha | components/CitiesAdminTab.jsx:179 (texto em components/ui/AsyncState.jsx:22) | role=alert "Não foi possível carregar." | erro sem "Tentar de novo"; mensagem genérica; recarga que falha apaga a tabela |
| CFG-CAD-CID-05 | sem-permissão | GET 403 | components/CitiesAdminTab.jsx:179 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role (primitivo) |
| CFG-CAD-CID-06 | vazio | nenhum lugar | components/CitiesAdminTab.jsx:179 | "Nenhuma cidade cadastrada ainda." | — |
| CFG-CAD-CID-07 | filtro-ativo | busca | components/CitiesAdminTab.jsx:177 | "{X} de {Y} cadastros" | — |
| CFG-CAD-CID-08 | busca-sem-resultado | busca não casa | components/CitiesAdminTab.jsx:196 | "Nenhum cadastro com esse nome." | — (a busca também casa município e POP; o texto fala só de "nome") |
| CFG-CAD-CID-09 | variante | tipo do lugar | components/CitiesAdminTab.jsx:63 | "Cidade / Município" / "Povoado / Localidade" / "Não classificado" (tipo desconhecido: valor cru de `kind`) | "Não classificado" sem destaque: o legado só se revela ao abrir "Editar" (suspeita) |
| CFG-CAD-CID-10 | variante | município-pai | components/CitiesAdminTab.jsx:65 | nome do município / "—" | — |
| CFG-CAD-CID-11 | variante | POP do SGP | components/CitiesAdminTab.jsx:66 | POP / "—" | — |
| CFG-CAD-CID-12 | variante | ativa × inativa | components/CitiesAdminTab.jsx:68 | "Ativa" / "Inativa" (texto simples) | sem badge e linha inativa não esmaece, ao contrário de Usuários/Motivos (inconsistência) |
| CFG-CAD-CID-13 | variante | cobertura | components/CitiesAdminTab.jsx:71 | "Atendida" / "A verificar" | — |
| CFG-CAD-CID-14 | interação:tooltip | hover em "Editar"/"Excluir" | components/CitiesAdminTab.jsx:80, :90 | "Editar {nome}" / "Excluir {nome}" | — |
| CFG-CAD-CID-15 | confirmação | "Excluir" | components/CitiesAdminTab.jsx:44 | "Excluir \"{nome}\"?" · "Excluir" | — |
| CFG-CAD-CID-16 | salvando | excluindo | components/CitiesAdminTab.jsx:88 | ("Excluir" esmaece) | — |
| CFG-CAD-CID-17 | erro | DELETE falha | components/CitiesAdminTab.jsx:214-218 (texto em :32, :34) | "Não dá para excluir: {N} localidades dependem deste município. Trate-as primeiro." / "Falha ao excluir" / "Cidade não encontrada." | aparece no rodapé da lista, longe da linha e sem dizer qual cadastro; nunca some (só se excluir de novo o mesmo item); "1 localidades" (plural fixo) |
| CFG-CAD-CID-18 | sucesso | excluído | components/CitiesAdminTab.jsx:52 | (linha some após recarga) | — |
| CFG-CAD-CID-19 | responsivo | tela estreita | components/CitiesAdminTab.jsx:180 (min-w-[760px]) | tabela rola na horizontal | — |
| CFG-CAD-CID-20 | variante | modo não controlado | components/CitiesAdminTab.jsx:256 (texto em components/CityForm.jsx:112) | formulário inline "Cadastrar nova cidade ou localidade" | — (código sem uso) |

### Modal "Nova cidade ou localidade" / "Editar cadastro" — `components/CityForm.jsx`

Como se chega na tela: "Nova cidade" (CitiesAdminTab.jsx:152) ou "Editar" numa linha (CitiesAdminTab.jsx:75).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-CIDF-01 | interação:modal aberto | "Nova cidade" | components/CitiesAdminTab.jsx:223 | título "Nova cidade ou localidade"; "Nome", "Tipo" (padrão "Cidade / Município"), "POP do SGP", "Observação", "Ativa" (marcada), "Atendida" (desmarcada); "Cancelar" / "Salvar" | — |
| CFG-CAD-CIDF-02 | interação:modal aberto | "Editar" | components/CitiesAdminTab.jsx:240 | título "Editar cadastro", campos preenchidos | — |
| CFG-CAD-CIDF-03 | expandido | "Tipo" = Povoado / Localidade | components/CityForm.jsx:152-167 | aparece select "Município" com "Selecione…" | — |
| CFG-CAD-CIDF-04 | vazio | localidade sem nenhum município cadastrado | components/CityForm.jsx:161-164 | (só "Selecione…") | AUSENTE aviso "cadastre um município primeiro" |
| CFG-CAD-CIDF-05 | variante | cadastro legado `unclassified` | components/CityForm.jsx:141, :145-149 | opção "Não classificado" + "Cadastro antigo, ainda não classificado. Escolha o tipo para continuar." | — |
| CFG-CAD-CIDF-06 | desabilitado-com-motivo | tipo ainda não escolhido (legado) | components/CityForm.jsx:228 | "Salvar" desabilitado; motivo no texto de CFG-CAD-CIDF-05 | — (motivo não ligado ao botão por aria-describedby) |
| CFG-CAD-CIDF-07 | validação | localidade sem município | components/CityForm.jsx:77 → :233 | "Uma localidade precisa pertencer a um município." | — |
| CFG-CAD-CIDF-08 | validação | tipo vazio no envio | components/CityForm.jsx:73 → :233 | "Escolha se este cadastro é uma cidade ou uma localidade." | — (inalcançável: o "Salvar" já fica desabilitado) |
| CFG-CAD-CIDF-09 | validação | "Nome" vazio | components/CityForm.jsx:124 | (balão nativo) | só espaços → 'O campo "name" é obrigatório.' (inglês no texto) |
| CFG-CAD-CIDF-10 | salvando | "Salvar" | components/CityForm.jsx:228 | (botão esmaece) | — |
| CFG-CAD-CIDF-11 | erro | 409 mudança de estrutura | components/CityForm.jsx:36 → :233 | "Não dá para mudar a estrutura agora: {N} contatos usam este povoado; {N} localidades dependem dele… Trate esses vínculos primeiro." | "1 contatos usam…" (plural fixo) |
| CFG-CAD-CIDF-12 | erro | 409 POP repetido | components/CityForm.jsx:233 | "Esse POP do SGP já está em uso por outro lugar. Cada POP pertence a um único cadastro." | — |
| CFG-CAD-CIDF-13 | erro | outra falha | components/CityForm.jsx:47 → :233 | "Falha ao salvar" / "Falha ao cadastrar" / "Cidade não encontrada." / "parentId not found" | "parentId not found" chega cru em inglês (sem tradução) se o município sumir |
| CFG-CAD-CIDF-14 | sucesso | salvo | components/CitiesAdminTab.jsx:229-232, :246-249 | (modal fecha, lista recarrega) | — |

### Planos (tabela) — `components/PlansAdminTab.jsx`

Como se chega na tela: `/configuracoes/cadastros/planos` (`pages/settings/registers/PlansPage.jsx`, modo controlado).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-PLA-01 | carregando | 1ª carga | components/PlansAdminTab.jsx:153 | (esqueleto de 3 linhas do AsyncState) | — |
| CFG-CAD-PLA-02 | carregando | durante carga/erro/sem-permissão | components/PlansAdminTab.jsx:151 | "{n} planos" · "{n} plano" | contador "0 planos" contradiz o carregando/erro |
| CFG-CAD-PLA-03 | recarregando | refresh() após salvar/excluir | components/PlansAdminTab.jsx:153 | (não exibido) | — |
| CFG-CAD-PLA-04 | erro | GET falha | components/PlansAdminTab.jsx:153 (texto em components/ui/AsyncState.jsx:22) | role=alert "Não foi possível carregar." | erro sem "Tentar de novo"; mensagem genérica; recarga que falha apaga a tabela |
| CFG-CAD-PLA-05 | sem-permissão | GET 403 | components/PlansAdminTab.jsx:153 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | sem role (primitivo) |
| CFG-CAD-PLA-06 | vazio | nenhum plano | components/PlansAdminTab.jsx:153 | "Nenhum plano cadastrado ainda." | — |
| CFG-CAD-PLA-07 | filtro-ativo | busca | components/PlansAdminTab.jsx:151 | "{X} de {Y} planos" | — |
| CFG-CAD-PLA-08 | busca-sem-resultado | busca não casa | components/PlansAdminTab.jsx:169 | "Nenhum plano com esse nome." | — |
| CFG-CAD-PLA-09 | variante | velocidade | components/PlansAdminTab.jsx:52 | "{N} Mbps" / "—" (sem velocidade) | — |
| CFG-CAD-PLA-10 | variante | mensalidade | components/PlansAdminTab.jsx:53 | (mensalidade formatada em reais no padrão pt-BR) | — |
| CFG-CAD-PLA-11 | variante | condição de instalação | components/PlansAdminTab.jsx:54 | texto / "—" | — |
| CFG-CAD-PLA-12 | variante | ativo × inativo | components/PlansAdminTab.jsx:56 | "Ativo" / "Inativo" (texto simples) | sem badge e linha inativa não esmaece (inconsistência com Usuários/Motivos) |
| CFG-CAD-PLA-13 | interação:tooltip | hover em "Editar"/"Excluir" | components/PlansAdminTab.jsx:65, :75 | "Editar {nome}" / "Excluir {nome}" | — |
| CFG-CAD-PLA-14 | confirmação | "Excluir" | components/PlansAdminTab.jsx:34 | "Excluir o plano \"{nome}\"?" · "Excluir" | — |
| CFG-CAD-PLA-15 | salvando | excluindo | components/PlansAdminTab.jsx:73 | ("Excluir" esmaece) | — |
| CFG-CAD-PLA-16 | erro | DELETE falha | components/PlansAdminTab.jsx:186-190 | "Falha ao excluir" / "Plan not found" | "Plan not found" chega em inglês cru (sem tradução em utils/errorMessages.js); erro no rodapé, longe da linha, sem dizer qual plano, nunca some |
| CFG-CAD-PLA-17 | sucesso | excluído | components/PlansAdminTab.jsx:42 | (linha some após recarga) | — |
| CFG-CAD-PLA-18 | responsivo | tela estreita | components/PlansAdminTab.jsx:154 (min-w-[640px]) | tabela rola na horizontal | — |
| CFG-CAD-PLA-19 | variante | modo não controlado | components/PlansAdminTab.jsx:226 (texto em components/PlanForm.jsx:101) | formulário inline "Cadastrar novo plano" | — (código sem uso) |

### Modal "Novo plano" / "Editar plano" — `components/PlanForm.jsx`

Como se chega na tela: "Novo plano" (PlansAdminTab.jsx:126) ou "Editar" numa linha (PlansAdminTab.jsx:60).

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-CAD-PLAF-01 | interação:modal aberto | "Novo plano" | components/PlansAdminTab.jsx:195 | título "Novo plano"; "Nome", "Velocidade (Mbps)", "Mensalidade (R$)", "Condição de instalação", "Ordem de exibição" (0), "Observação interna", "Plano ativo" (marcado); "Cancelar" / "Salvar" | — |
| CFG-CAD-PLAF-02 | interação:modal aberto | "Editar" | components/PlansAdminTab.jsx:211 | título "Editar plano"; preço vem como "100,00" | — |
| CFG-CAD-PLAF-03 | responsivo | viewport baixo | components/PlansAdminTab.jsx:195, :211 | (modal sem `variant` → sem a rolagem interna de components/overlays.css:234; `.dw-dialog` corta em 100dvh−40px) | fim do formulário ("Salvar" e o erro, que fica abaixo dos botões) pode ficar cortado e inalcançável em tela baixa (suspeita) |
| CFG-CAD-PLAF-04 | validação | mensalidade vazia/inválida | components/PlanForm.jsx:58 → :206 | "Informe a mensalidade em reais, por exemplo 100,00." | — (erro no rodapé, campo não marcado `aria-invalid`) |
| CFG-CAD-PLAF-05 | validação | velocidade não inteira | components/PlanForm.jsx:63 → :206 | "A velocidade deve ser um número inteiro de megabits, ou ficar em branco." | — |
| CFG-CAD-PLAF-06 | validação | ordem não inteira | components/PlanForm.jsx:68 → :206 | "A ordem de exibição deve ser um número inteiro." | — |
| CFG-CAD-PLAF-07 | validação | "Nome" vazio | components/PlanForm.jsx:113 | (balão nativo) | só espaços → 'O campo "name" é obrigatório.' (inglês no texto) |
| CFG-CAD-PLAF-08 | salvando | "Salvar" | components/PlanForm.jsx:201 | (botão esmaece) | — |
| CFG-CAD-PLAF-09 | erro | POST/PATCH falha | components/PlanForm.jsx:206 | "Falha ao salvar o plano" / "Falha ao cadastrar o plano" / "Plan not found" | "Plan not found" em inglês cru |
| CFG-CAD-PLAF-10 | sucesso | salvo | components/PlansAdminTab.jsx:200-203, :216-219 | (modal fecha, lista recarrega) | — |

#### 7.8 Empresa


### Empresa — `pages/settings/CompanyPage.jsx` + `components/CompanyConfigCard.jsx`

Como se chega na tela: menu "Empresa" (link solo) → `/configuracoes/empresa`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido (literal, curto) | defeito hoje |
|----|------|---------|----------------------|--------------------------------|--------------|
| CFG-EMP-01 | variante | selo de escopo | pages/settings/CompanyPage.jsx:10 (texto em components/ui/ScopeBadge.jsx:2) | "Toda a operação" | — |
| CFG-EMP-02 | variante | aviso: carregado e sem nomes aceitos | pages/settings/CompanyPage.jsx:8,11-15 | "Sem nomes aceitos, nenhum comprovante confere" / "A IA compara o favorecido do comprovante com esta lista. Cadastre pelo menos a razão social e o nome fantasia." | Vem de uma 2ª instância de `useCompanyConfig` que o salvar não recarrega: o aviso continua depois de cadastrar os nomes (e não aparece ao apagá-los) até recarregar a página |
| CFG-EMP-03 | carregando | 1ª carga (AsyncState, 2 linhas) | components/CompanyConfigCard.jsx:67 | (esqueleto 2 linhas) | — |
| CFG-EMP-04 | erro | falha em `getCompanyConfig` | components/CompanyConfigCard.jsx:67 (texto em components/ui/AsyncState.jsx:22) | "Não foi possível carregar." | Erro sem "Tentar de novo" (AsyncState sem `onRetry`); motivo real descartado |
| CFG-EMP-05 | sem-permissão | 403 | components/CompanyConfigCard.jsx:67 (texto em components/ui/AsyncState.jsx:17) | "Você não tem permissão para ver esta lista." | (leve) Fala em "lista" |
| CFG-EMP-06 | vazio | sem nome cadastrado | components/CompanyConfigCard.jsx:69 | "Empresa não cadastrada" | — |
| CFG-EMP-07 | vazio | sem nomes aceitos | components/CompanyConfigCard.jsx:71 | "nenhum" | — |
| CFG-EMP-08 | variante | resumo preenchido | components/CompanyConfigCard.jsx:68-72 | "Empresa" / "{nome}" / "Nomes aceitos no comprovante" + lista | — |
| CFG-EMP-09 | resumo↔formulário | "Editar" troca o resumo pelo formulário | components/CompanyConfigCard.jsx:84 | "Editar" · "Editar dados da empresa" · "Cancelar" · "Salvar" | — |
| CFG-EMP-10 | variante | campos do formulário com ajuda | components/CompanyConfigCard.jsx:86-106 | "Nome da empresa" / "Como aparece para o cliente: na tela de login, no chat e nas mensagens da IA." / "Nomes aceitos como favorecido no comprovante" / "Um por linha…" | — |
| CFG-EMP-11 | validação | nome vazio / lista vazia | components/CompanyConfigCard.jsx:54 | AUSENTE | (suspeita) Aceita salvar nome vazio sem aviso no cliente |
| CFG-EMP-12 | salvando | envio em curso (`Button loading`) | components/CompanyConfigCard.jsx:113 | "Salvar" (a 50%, `aria-busy`) | (leve) Sem texto de progresso; "Cancelar" segue ativo |
| CFG-EMP-13 | erro | `updateCompanyConfig` falha | components/CompanyConfigCard.jsx:108 | (mensagem da API) / "Falha ao salvar" | Sem `role="alert"` |
| CFG-EMP-14 | sucesso | salvo → volta ao resumo | components/CompanyConfigCard.jsx:55-56 | AUSENTE (nenhuma mensagem) | O resumo volta mostrando os dados ANTIGOS até a recarga terminar (`refresh` não aguardado; `reloading` invisível) |
| CFG-EMP-15 | sucesso | efeito fora da página: nome novo | components/CompanyConfigCard.jsx:54-55; contexts/CompanyContext.jsx:18-25 | AUSENTE | O `CompanyContext` (título da aba, menu, Atendimento) não é recarregado: o nome antigo continua até recarregar a página |
| CFG-EMP-16 | recarregando | refresh pós-salvar | hooks/useCompanyConfig.js:10 | AUSENTE | (ver CFG-EMP-14) |
| CFG-EMP-17 | responsivo | resumo 2 colunas → 1 coluna em container ≤650px; formulário 2 colunas só em `lg` (viewport) | settings.css:199-205,208; components/CompanyConfigCard.jsx:11 | — | — |

## 8. Perfil


### Meu perfil — `components/ProfileModal.jsx`

Como se chega: Menu da conta → "Meu perfil".

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| PRF-01 | carregando | abrir o modal | components/ProfileModal.jsx:112-117 | "Carregando…" (texto, role=status) | Não usa o esqueleto padrão; o modal nasce `max-w-md` e salta para `max-w-4xl` ao carregar |
| PRF-02 | erro | `getMyProfile` falhou | components/ProfileModal.jsx:116-121 | "Falha ao carregar perfil" · "Fechar" | **Sem "Tentar de novo"** |
| PRF-03 | variante | com foto × sem foto | components/ProfileModal.jsx:131,141-145 | "Remover foto" só com foto | — |
| PRF-04 | salvando | enviando/removendo foto | components/ProfileModal.jsx:139,142 (`avatarBusy`) | (nenhum texto) | **Envio de foto invisível**: `disabled` está no input `sr-only`; o rótulo "Alterar foto" não muda nem esmaece |
| PRF-05 | erro | foto inválida/grande/falha | components/ProfileModal.jsx:148 (texto em utils/errorMessages.js:56) | "O arquivo precisa ser uma imagem (JPG, PNG, WEBP ou GIF)." / "Falha ao enviar foto" / "Falha ao remover foto" | — |
| PRF-06 | validação | nome vazio | components/ProfileModal.jsx:157 (`required`) | (balão nativo) | Validação nativa fora do tema |
| PRF-07 | salvando | "Salvar alterações" | components/ProfileModal.jsx:201 | "Salvar alterações" desabilitado | Rótulo não muda (sem "Salvando…") |
| PRF-08 | erro | salvar perfil falhou | components/ProfileModal.jsx:168 | "Falha ao salvar perfil" | — |
| PRF-09 | sucesso | perfil salvo | components/ProfileModal.jsx:169 | "Perfil atualizado." (role=status) | Cor neutra (`text-wa-muted`), não lê como sucesso; nunca some |
| PRF-10 | expandido | abrir `<details>` | components/ProfileModal.jsx:172 | "Trocar senha" · "Atualize sua senha de acesso." | — |
| PRF-11 | validação | nova ≠ confirmação | components/ProfileModal.jsx:94-96,190 | "As senhas não coincidem" | — |
| PRF-12 | erro | senha atual errada/falha | components/ProfileModal.jsx:190 (texto em utils/errorMessages.js:17) | "A senha atual está incorreta." / "Falha ao trocar senha" | — |
| PRF-13 | salvando | trocando senha | components/ProfileModal.jsx:193 | "Trocar senha" desabilitado | Rótulo não muda |
| PRF-14 | sucesso | senha trocada | components/ProfileModal.jsx:191 | "Senha alterada com sucesso." | — |
| PRF-15 | responsivo | sm / lg | components/ProfileModal.jsx:154,177 | (1 → 2 → 3 colunas) | — |
| PRF-16 | variante | e-mail somente leitura | components/ProfileModal.jsx:163-166 | "E-mail" (campo travado) | Sem explicar por que não edita |
| PRF-17 | interação:fechar com edição | "Cancelar"/X/ESC com nome alterado | components/ProfileModal.jsx:200 | (fecha sem perguntar) | (suspeita) perde edição sem aviso |

## Apêndice — Primitivos compartilhados (estados desenhados uma vez, usados em dezenas de telas)


### Primitivos compartilhados — `components/ui/*`, `components/WaDialog.jsx`

(Estes estados aparecem em dezenas de telas; o redesenho precisa desenhá-los uma vez.)

| id | tipo | gatilho | onde | texto | defeito hoje |
|----|------|---------|------|-------|--------------|
| PRM-ASY-01 | carregando | `status==='loading'` | components/ui/AsyncState.jsx:3-12,15 | (N barras pulsantes) + sr-only "Carregando…" | Barras `bg-white/[0.08]`: só visíveis sobre fundo escuro |
| PRM-ASY-02 | sem-permissão | `status==='forbidden'` (HTTP 403) | components/ui/AsyncState.jsx:16-18 | "Você não tem permissão para ver esta lista." | Sem `role`; diz "lista" mesmo em cartões de configuração |
| PRM-ASY-03 | erro / erro-com-retry | `status==='error'` | components/ui/AsyncState.jsx:19-29 | mensagem + "Tentar de novo" SÓ com `onRetry` | **27 de 37 usos não passam `onRetry`** (inclui QueueList.jsx:6 e MyConversationsList.jsx:6) |
| PRM-ASY-04 | vazio | `isEmpty` | components/ui/AsyncState.jsx:31 | padrão "Nada por aqui ainda." | Sem `role`; sem ação sugerida |
| PRM-ASY-05 | recarregando | `useAsyncResource` com dados → `reloading=true` | hooks/useAsyncResource.js:15 | (nada) | **`reloading` não é consumido em nenhum arquivo**: toda recarga em segundo plano é invisível |
| PRM-BTN-01 | salvando | `<Button loading>` | components/ui/Button.jsx:28-31 | (só esmaece: `disabled` + `opacity-50` + `aria-busy`) | **Sem spinner nem troca de texto**: ~20 usos mantêm "Salvar"/"Cadastrar"/"Excluir" enquanto salvam |
| PRM-BTN-02 | desabilitado-sem-motivo | `disabled` | components/ui/Button.jsx:4 | (opacity-50) | Primitivo não tem slot de motivo |
| PRM-FLD-01 | validação | `<Field error>` | components/ui/Field.jsx:35-39 | erro do campo (role=alert, `aria-invalid`) | — |
| PRM-FLD-02 | variante | `<Field help>` / largura xs/sm/md/full | components/ui/Field.jsx:8-13,30-34 | texto de ajuda | — |
| PRM-TGL-01 | desabilitado-com-motivo | `<Toggle disabled disabledReason>` | components/ui/Toggle.jsx:25-29 | motivo em âmbar | — (só 4 usos, todos em ChannelBehaviorTab) |
| PRM-TGL-02 | desabilitado-sem-motivo | `<Toggle disabled>` sem motivo | components/ui/Toggle.jsx:17 | (rótulo cinza) | — (depende do chamador) |
| PRM-TAB-01 | seleção | aba ativa: `pills` / `underline` md·lg / `segmented` | components/ui/Tabs.jsx:10-31,70-72 | (pílula laranja / sublinhado / segmento cheio) | — |
| PRM-TAB-02 | variante | contador da aba (some se 0) | components/ui/Tabs.jsx:37-67 | número em bolha | — |
| PRM-TAB-03 | foco-revela | setas ← → nas abas | components/ui/Tabs.jsx:100-108 | (move foco e seleção) | — |
| PRM-DLG-01 | interação:modal empilhado | diálogo aberto sobre outro | components/ui/Dialog.jsx:283-288; ui/dialogStack.js | (camada de baixo `inert`, sem blur na 2ª) | — |
| PRM-DLG-02 | variante | com/sem "X" (`dismissible`), ícone tonal (`tone`), `description`, `orientation=row` | components/ui/Dialog.jsx:304-334 | "Fechar" (X) | — |
| PRM-DLG-03 | interação:clique no fundo | `closeOnBackdrop` (padrão false; arrasto/seleção não fecham) | components/ui/Dialog.jsx:258-277 | — | — |
| PRM-CNF-01 | confirmação | `useConfirm()` normal × `danger` | components/ui/ConfirmDialog.jsx:36 | "Confirmar" · "Cancelar" | — |
| PRM-ALR-01 | erro | `useAlert().avisar()` | components/ui/AlertDialog.jsx:29 | "Aviso" · (mensagem) · "Entendi" | — |
| PRM-ROW-01 | interação:menu aberto | "⋯" da linha | components/ui/DataTable.jsx:108-136 | (menu em portal; ESC, clique fora, rolagem ou resize fecham) | — |
| PRM-ROW-02 | variante | menu perto da borda inferior | components/ui/DataTable.jsx:69-76 | (abre para CIMA) | — |
| PRM-TBL-01 | responsivo | tabela mais larga que o cartão | components/ui/DataTable.jsx:22 | (rolagem horizontal) | O comentário (:10) diz que "o vazio" mora aqui, mas **DataTable não tem estado vazio** — cada tela improvisa |
| PRM-PGH-01 | variante | título `padrao` × `destaque`; com migalhas/descrição/ação | components/ui/PageHeader.jsx:14-44 | — | — |
| PRM-CRD-01 | variante | `Card tone` default × warn; `ScopeBadge` | components/ui/Card.jsx:4 (texto em components/ui/ScopeBadge.jsx:2) | "Toda a operação" · "Este canal" · "Herdado de X" · "Depende de X" | — |
| PRM-DGZ-01 | variante | zona de perigo | components/ui/DangerZone.jsx:3-13 | "Ações com cuidado" | — |
| PRM-WAE-01 | erro / sucesso | `WaError` / `WaSuccess` | components/WaDialog.jsx:29-35 | faixa vermelha (alert) / texto neutro (status) | Sucesso em cor neutra: não lê como sucesso |

## Estados acrescentados na verificação de 24/09/2026 (base `e5236da`)

Achados pela correção verificada do inventário; não estavam nas 1.672 linhas originais. Caminhos relativos a `frontend/src`.

| id | tipo | gatilho | onde (arquivo:linha) | texto exibido | defeito hoje |
|----|------|---------|----------------------|---------------|--------------|
| CV-ROD-14 | variante | sair de uma conversa minha para uma que não é minha e voltar | components/ConversationView.jsx:883 | (o campo de mensagem volta vazio) | rascunho perdido: MessageInput só existe com isMine (:883/:942) e guarda os rascunhos num draftsRef interno (MessageInput.jsx:126) |
| MSG-PRV-15 | interação:anexo pendente | com a prévia da gravação aberta, escolher arquivo no clipe ou colar imagem | components/MessageInput.jsx:446 | (a prévia vira o chip "Anexo: {file.name}") | a gravação é descartada sem aviso (onChange :446-449; colar :279-280) |
| MSG-CMP-30 | interação:enviando | voltar para A com o envio de A ainda em curso (situação criada pela E1) | components/MessageInput.jsx:597 | (o texto em envio reaparece como rascunho; Enviar desabilitado; sem o anexo) | (suspeita) o que for editado ali some quando o envio termina (:361-363) |
| MSG-CMP-31 | interação:falha de envio | envio com anexo falha depois da troca para B (situação criada pela E1) | components/MessageInput.jsx:622 | AUSENTE em B · ao voltar para A: "{erro}" + texto restaurado, sem o anexo | nada avisa em B; o anexo foi descartado na troca (:247), reenviar manda só o texto |
| CV-SGP-31 | interação:enviando | enviar Pix/boleto pelo painel SGP e trocar de conversa antes da resposta | components/ConversationView.jsx:999 | AUSENTE (o resultado do envio de A some) | (suspeita) desde a E1 o painel remonta por conversa (key :999); uma falha fica silenciosa |
| MSG-GRV-11 | variante | trocar de conversa enquanto o getUserMedia (:286) não respondeu | components/MessageInput.jsx:303 | "Gravando… {recordingSeconds}s" na conversa nova | (suspeita) a troca só descarta se recording já era true (:244): o áudio pode ir ao cliente errado — membro da CLASSE-01 |
| ATD-TRF-27 | sucesso | admin/gerente transfere a própria conversa pela mesa | components/TransferModal.jsx:173 | (a conversa continua na aba Atendimento, aberta e com compositor, até o F5) | (suspeita) o backend só emite conversation:removed para não admin (src/api/conversations.routes.js:509) |
| ATD-AVT-07 | variante | transferência com transferredBy null | hooks/useTransferNotice.js:20 | (nenhum aviso nem som) | (suspeita, raro) o backend prevê aviso genérico (conversations.routes.js:515); o frontend descarta |
| MSG-AUD-12 | carregando | ▶ clicado com o áudio ainda baixando | components/MessageAttachment.jsx:104 | AUSENTE (o ícone vira pausa na hora) | (suspeita) sem indicador; ninguém ouve waiting/playing |
| MSG-AUD-13 | interação:tooltip | hover no botão de tocar | components/MessageAttachment.jsx:144 | "Reproduzir" · "Pausar" | — |
| MSG-IMG-17 | interação:tooltip | hover nos botões de zoom | components/MessageAttachment.jsx:512 | "Diminuir zoom" · "Aumentar zoom" | — |
| CFG-MSG-BV-22 | validação | boas-vindas só com espaços | components/messages/ChannelWelcomeMessageRow.jsx:65 | AUSENTE | o backend grava null (admin-channels.routes.js:253): "Salvar" apaga a boas-vindas sem a confirmação que "Excluir" pede |
| CFG-AUT-MENU-31 | vazio | setores não carregaram ao editar uma opção | components/TriageAdminTab.jsx:98 | AUSENTE (select "Setor" vazio) | falha silenciosa; o required (:103) barra o Salvar com balão nativo |
| CFG-AUT-MENU-32 | validação | número vazio ou menor que 1 na edição | components/TriageAdminTab.jsx:94 | (balão nativo) | — |
| CFG-INT-HUB-06 | sucesso | salvar em Consulta SGP/OpenAI ou mexer em integração por canal | pages/settings/integrations/IntegrationsLayout.jsx:30 | AUSENTE | os selos do topo vêm de outras instâncias dos hooks (:30-32) que ninguém recarrega; ficam velhos até o F5 |
| CFG-CAN-46 | variante | gerente sem "Canais e Integrações" na lista de canais | pages/settings/channels/ChannelsTable.jsx:239 | (só "Configurar", sem "⋯") | some sem explicação; no detalhe os botões aparecem desabilitados com motivo |
| CFG-DET-19 | interação:voltar à lista | "← Todos os canais" | pages/settings/channels/ChannelDetailPage.jsx:44 | "← Todos os canais" | (leve) perde ?ocultos=1, a busca e o filtro de tipo |
