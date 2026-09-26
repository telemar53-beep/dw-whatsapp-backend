const { listSectors } = require('./sector.repository');

// Regra financeira 0/1/2+ (25/09/2026): contrato cancelado e inadimplência múltipla vão para o setor
// de Reativação que JÁ EXISTE no painel. Os setores são dados (o nome vem do banco); o código só
// reconhece qual deles é o de reativação pelo radical do nome, sem hardcodar o nome inteiro.
const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function ehSetorDeReativacao(setor) {
  return Boolean(setor && /reativ/.test(normalizar(setor.name)));
}

/** O setor de reativação cadastrado, ou null se não houver. */
async function setorDeReativacao() {
  const setores = await listSectors();
  return (setores || []).find(ehSetorDeReativacao) || null;
}

module.exports = { ehSetorDeReativacao, setorDeReativacao };
