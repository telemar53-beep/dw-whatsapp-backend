// REGRA DO PACOTE, não recomendação (decisão do proprietário, 24/09/2026):
// medida de TEMPO só com a máquina ociosa, e sempre mediana de pelo menos 3
// rodadas. O medir.mjs recusa as etapas de tempo (m7, m9) quando a CPU está
// ocupada; o comparar.mjs só compara tempo entre duas rodadas que passaram
// por esta checagem.
//
// Por que existe: numa rodada feita com outros processos pesados rodando, o
// boot com CPU 4x mediu 1.087 ms contra 874 ms da linha de base (+24%) sem
// nenhuma mudança de código. Bytes, contagens e cores não variaram; só tempo.
import os from 'node:os';

export const LIMITE_OCUPACAO_PCT = 15;
export const RODADAS_MINIMAS = 3;
export const ETAPAS_DE_TEMPO = new Set(['m7', 'm9']);

function amostra() {
  return os.cpus().map((c) => c.times);
}

// Ocupação média de todos os núcleos numa janela de `ms`, em porcentagem.
export async function ocupacaoDaCpu(ms = 3000) {
  const a = amostra();
  await new Promise((ok) => setTimeout(ok, ms));
  const b = amostra();
  let ocupado = 0;
  let total = 0;
  b.forEach((t, i) => {
    const d = (k) => t[k] - a[i][k];
    const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
    total += tot;
    ocupado += tot - d('idle');
  });
  return total ? Math.round((ocupado / total) * 1000) / 10 : 0;
}
