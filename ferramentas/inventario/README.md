# Verificador do inventário de estados

Confere cada linha do inventário de telas e estados (Apêndice A do spec do redesenho,
`docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md`) contra o código de uma base
fixa. Existe porque o inventário foi escrito por subagentes em paralelo e **238 linhas** vieram
erradas (endereço inválido, "texto literal" que era paráfrase) — um relatório "pronto" esconderia
isso.

## Regra de ouro

**Nunca rode contra o disco.** O diretório de trabalho pode estar em outra branch. Extraia a base
com `git archive` e aponte o verificador para a cópia:

```bash
git archive <commit> frontend/src frontend/index.html src | tar -x -C /tmp/base-<commit>
node ferramentas/inventario/verificar.cjs \
  docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md \
  /tmp/base-<commit> \
  ferramentas/inventario/conferencias/2026-09-24-conferencia-auditor.tsv \
  ferramentas/inventario/conferencias/2026-09-24-conferencia-propria.tsv
```

Grava `_verificacao5.tsv` ao lado do script (uma linha por estado) e imprime o resumo.

## O que ele prova e o que não prova

- **Prova por script:** o arquivo existe; a linha (ou o fim do intervalo "arq:n-m") existe; cada
  trecho literal de 6+ caracteres do texto aparece a até ±10 linhas do endereço (o intervalo vale
  inteiro) ou na origem anotada "(texto em arquivo:linha)". ":n" sem arquivo herda o último
  arquivo citado na mesma célula; sem nenhum, o arquivo da seção.
- **Não prova:** estado sem texto literal (`sem-literal`), estado AUSENTE (só a linha existe) e
  intervalo com mais de 60 linhas (`intervalo-largo`). Esses precisam de **conferência humana** —
  os arquivos em `conferencias/` dizem quem conferiu cada id e com que resultado.

## Critério de pronto

`"falha": 0` e `"semProvaESemConferencia": 0`. Em 24/09/2026, na base `e5236da`: 1.690 estados,
0 falhas, 0 sem prova e sem conferência.

## Conferências (trilha de auditoria)

| Arquivo | O que é |
|---|---|
| `2026-09-24-conferencia-auditor.tsv` | Conferência humana (por subagente) das 1.055 linhas que o script não provava: 422 conferem, 581 corrigidas, 18 erradas no mérito, 34 duplicatas |
| `2026-09-24-amostra-independente.tsv` | Minha conferência por amostra desse lote (sorteio com semente fixa, todas as erradas no mérito): 58 linhas, 0 erro — lote aceito (a 1ª versão deste registro dizia 1 erro: era defeito do meu script, que cortava a frase no apóstrofo) |
| `2026-09-24-conferencia-propria.tsv` | Minha conferência de tudo que o subagente escreveu de novo (34 estados), dos intervalos largos e das correções pontuais |

## Quando rodar de novo

Sempre que a base mudar antes de uma etapa usar o inventário (ex.: a E1.1 desloca linhas em
`ConversationView.jsx` e `useConversationMessages.js`): remapeie os endereços pelo diff, extraia a
base nova e rode até o critério de pronto voltar a valer.
