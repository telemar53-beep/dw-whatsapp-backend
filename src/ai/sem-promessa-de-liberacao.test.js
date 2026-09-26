const fs = require('fs');
const path = require('path');

// Ajuste de 25/09/2026 (regra financeira 0/1/2+): a promessa de que o acesso volta sozinho depois
// do pagamento saiu de todo texto que a IA recebe ou repassa ao cliente — com duas ou mais vencidas,
// pagar uma não libera. A IA só afirma liberação com o contrato relido em status 1 ou com o
// desbloqueio em confiança liberado; a formulação segura é "assim que o pagamento constar no
// sistema, vou verificar a situação do contrato". Esta varredura impede a frase de voltar por cópia.
const PROMESSA = /(libera[çc][ãa]o|desbloqueio)\s+(é|será)\s+autom[aá]tic|liberad[oa]\s+automaticamente|(volta|libera)\s+automaticamente/i;

function fontes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) return fontes(caminho);
    return e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [caminho] : [];
  });
}

const ARQUIVOS = [
  path.join(__dirname, 'tool-registry.js'),
  path.join(__dirname, 'ai-orchestrator.js'),
  path.join(__dirname, '..', 'queue', 'ai-worker.js'),
  ...fontes(path.join(__dirname, 'prompt')),
].map((f) => [path.relative(path.join(__dirname, '..'), f), f]);

test('a varredura cobre o prompt inteiro, as ferramentas, o orquestrador e o worker', () => {
  expect(ARQUIVOS.length).toBeGreaterThan(10);
});

test.each(ARQUIVOS)('%s não promete liberação automática', (_nome, arquivo) => {
  expect(fs.readFileSync(arquivo, 'utf8')).not.toMatch(PROMESSA);
});
