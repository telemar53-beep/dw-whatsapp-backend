# Montagem do inventário v3 e dos apêndices A e C (24/09/2026)

Registro de como o Apêndice A (inventário) e o Apêndice C (achados) foram montados, para que a
montagem possa ser refeita e auditada. **O Apêndice A publicado em `docs/` é a fonte**; para manter o
inventário daqui em diante, edite o Apêndice A e rode `../verificar.cjs` — não remonte do zero.

## Insumos

| Arquivo | O que é |
|---|---|
| `_corpo-v2.md` | Inventário v2: 1.689 linhas depois das 350 correções da verificação por script |
| `conferencia-v2.tsv` | Conferência humana (subagente) das 1.055 linhas que o script não provava (igual a `../conferencias/2026-09-24-conferencia-auditor.tsv`) |
| `rasc-novos.md` | Os 34 estados novos achados nessa conferência |

## Passos

```bash
node montar-v3.cjs          # v2 + conferência + 34 novos → _corpo-v3.md, _v3-duplicatas.tsv
node proprias-v3.cjs        # minhas correções depois da amostra independente (idempotente)
node verificar5.cjs _corpo-v3.md <copia-da-base> conferencia-v2.tsv ../conferencias/2026-09-24-conferencia-propria.tsv
node gerar-apendice-a.cjs   # → docs/superpowers/specs/2026-09-24-redesenho-apendice-A-inventario.md
node gerar-apendice-c.cjs   # → docs/superpowers/specs/2026-09-24-redesenho-apendice-C-achados.md
```

`<copia-da-base>` é uma extração de `e5236da` por `git archive` (ver `../README.md`). Os dois
geradores escrevem no caminho absoluto do repositório (`D:/dw-whatsapp-backend/docs/...`); ajuste
`SAIDA` no topo de cada um se o repositório estiver em outro lugar. `familias-defeito.cjs` lista os
defeitos de comportamento por família (base do Apêndice C).
