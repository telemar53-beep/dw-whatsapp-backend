// Escreve o Apêndice A (inventário de estados) em docs/superpowers/specs/.
// Uso: node gerar-apendice-a.cjs
const fs = require('fs');
const path = require('path');
const m = require('./finalizar-apendice-a.cjs');

const SAIDA = 'D:/dw-whatsapp-backend/docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md';
const fmt = (n) => n.toLocaleString('pt-BR');

const tiposBase = Object.entries(m.porTipo).filter(([t]) => !t.startsWith('interação:')).sort((a, b) => b[1] - a[1]);
const interacoes = Object.entries(m.porTipo).filter(([t]) => t.startsWith('interação:'));
const totalInteracoes = interacoes.reduce((s, [, n]) => s + n, 0);

const cabecalho = `# Apêndice A — Inventário de telas e estados

> Parte do spec \`2026-09-24-redesenho-simplicidade-design.md\`. **Base: \`e5236da\`** (produção em 24/09/2026).
> Critério de pronto, fixado pelo proprietário: nenhuma linha sem conferência. **Cumprido** — ver A.2.

## A.1 Para que serve

Cada tela, modal, popover, aba e estado (vazio, erro, carregando, interação) do frontend, com o
lugar do código que o desenha, o texto que a pessoa vê e o defeito de hoje. É a lista que cada
etapa visual percorre: um item só está feito quando o estado dele foi revisto na etapa dona. A
ferramenta anterior "só pintava" e esquecia popups, sub-abas e estados de interação; este
inventário existe para que isso não se repita.

**Números:** ${fmt(m.total)} estados · ${fmt(m.comDefeito.length)} com defeito anotado (${fmt(m.suspeitas.length)} marcados "(suspeita)") ·
${fmt(m.ausentes.length)} estados AUSENTES (deveriam existir e não existem).

| Seção | Estados | Etapa dona |
|---|---|---|
${m.porSecao.map((s) => `| ${s.nome.replace(/\|/g, '\\|')} | ${s.n} | ${
    s.nome.startsWith('1.') ? 'E3 / E7 (por subseção)' :
    s.nome.startsWith('2.') ? 'E2 (+ E3)' :
    s.nome.startsWith('3.') ? 'E2' :
    s.nome.startsWith('4.') || s.nome.startsWith('5.') ? 'E5' :
    s.nome.startsWith('6.') || s.nome.startsWith('7.') ? 'E6' :
    s.nome.startsWith('8.') ? 'E2' : 'E2'
  } |`).join('\n')}

## A.2 Como foi verificado (e por que dá para confiar)

Regra do projeto desde 24/09: saída de subagente não vira requisito sem conferência contra o código.

1. **Primeira versão:** 1.672 linhas, escritas por auditoria em paralelo.
2. **Verificador por script** (literal do texto a até ±10 linhas do endereço, ou na origem anotada
   "(texto em arquivo:linha)"): achou **238 linhas com problema**. Das 98 que um script "corrigia
   sozinho", 95 estavam certas e 3 precisavam de correção — o conserto automático foi descartado
   e as correções foram feitas à mão. Resultado: v2, com 350 correções e 17 estados novos.
3. **Conferência humana das 1.055 linhas que o script não prova** (sem texto literal, AUSENTE,
   falha): 422 conferem, 581 corrigidas, 18 erradas no mérito (o que a linha afirmava sobre o
   sistema era falso), 34 duplicatas removidas (A.4) e 34 estados novos.
4. **Conferência independente por amostra** (sorteio com semente fixa): todas as 18 "erradas no
   mérito", 25 corrigidas, 10 conferidas e 5 duplicatas — **58 linhas, 0 erro**, dentro do teto
   de 2% combinado: lote aceito. Ao conferir ATD-INI-24 achei um defeito que ninguém tinha
   registrado (ATD-INI-29). **Registro de um erro meu:** por algumas horas marquei ATD-INI-24 como
   erro do auditor, afirmando que uma frase do backend chegava sem tradução; o meu script cortava
   a frase no apóstrofo de "channel's". A auditoria dos overlays (grupo A) pegou; a linha voltou
   ao que o auditor tinha escrito.
5. **Conferência própria de tudo que era novo:** os 34 estados novos, os 3 endereços com
   intervalo largo demais para a checagem valer (estreitados) e 2 correções pontuais.
6. **Verificador final** contra uma cópia de \`e5236da\` (nunca contra o disco, que pode estar em
   outra branch): **${fmt(m.total)} estados, 0 falhas, 0 linhas sem prova por script e sem
   conferência humana.** Intervalo "arq:n-m" vale inteiro; ":n" sem arquivo herda o último
   arquivo citado na mesma célula.

**Deslocamento esperado:** a E1.1 (branch \`fix/e1-1-rolagem-ao-carregar-anteriores\`) acrescenta
linhas em \`components/ConversationView.jsx\` e \`hooks/useConversationMessages.js\`. Quando ela
entrar na main, os endereços desses dois arquivos são remapeados pelo diff e o verificador roda
de novo — antes de a E2 começar.

## A.3 Convenções

- **onde** = a linha que DESENHA o estado (não o handler nem o useState). "(texto em arq:linha)"
  aponta a origem do texto quando ele vem de um primitivo, constante ou tradução.
- **texto**: literal entre aspas; \`{variável}\` para o que muda; descrição entre parênteses para o
  que não é texto (cor, forma, rolagem).
- **AUSENTE** = o estado deveria existir e não existe (ex.: falha sem aviso).
- **(suspeita)** = o defeito foi deduzido do código e não reproduzido na tela.
- **Tipos:** ${tiposBase.length} tipos de estado (${tiposBase.slice(0, 12).map(([t, n]) => `${t} ${n}`).join(', ')}…) e
  ${fmt(totalInteracoes)} estados de interação, escritos "interação:<gesto>" (${interacoes.length} gestos distintos).

## A.4 Duplicatas removidas

Removidas na conferência; cada uma aponta para a linha que ficou (cadeias já resolvidas).

| Removida | Linha que ficou |
|---|---|
${[...m.dup.keys()].map((id) => `| \`${id}\` | \`${m.resolver(id)}\` |`).join('\n')}

## A.5 Inventário

`;

const corpo = m.final.join('\n').replace(/^\n+/, '');
fs.writeFileSync(SAIDA, cabecalho + corpo.replace(/^## /gm, '### A.5 · ').replace(/^### (?!A\.5)/gm, '#### ') + '\n', 'utf8');
console.log('escrito', SAIDA, fs.statSync(SAIDA).size, 'bytes');
