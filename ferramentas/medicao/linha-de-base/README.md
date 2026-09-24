# Linhas de base

Só os JSON de cada rodada (o `comparar.mjs` lê o `RESUMO.json`); prints e brutos ficam fora do Git e se regeneram com o `medir.mjs`.

| Pasta | Build | Tipo | Observação |
|---|---|---|---|
| `ac334af-estrutural/` | `ac334af` (produção até 24/09) | estrutural (sem tempo) | harness final |
| `e5236da-estrutural/` | `e5236da` (E1 publicada) | estrutural (sem tempo) | 0 de 456 métricas mudaram contra `ac334af`: a E1 não mexeu em estrutura |

A linha de base **com tempo** (máquina ociosa, mediana de 3) é a Task 9 do plano da E0.
