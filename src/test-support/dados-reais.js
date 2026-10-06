// Dados reais — nomes de clientes e do proprietário, e um telefone — que já apareceram em fontes, testes ou documentos
// deste repositório público. Aqui ficam só os HASHES SHA-256 (o dado nunca aparece). Usado pela varredura dos fontes
// (src/sem-nomes-reais.test.js) e pelas guardas dos textos do prompt. Comportamento da IA (05/10/2026): os nomes e o
// telefone saíram dos arquivos atuais; o histórico público não foi reescrito (decisão do proprietário).
const crypto = require('crypto');

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Palavras (minúsculas, sem acento). As duas primeiras são de 25/09/2026 (P1-3 da auditoria final).
const PALAVRAS_PROIBIDAS = new Set([
  'b23d3ffb1d24fdb42b68b0010fb3769010270f9aeb876e0d5be25ffad8d74192',
  '1b1dd21d63046036df6c5556ca557cd2cda6b97394f7af0d7809acdaf2d5a128',
  '2cdb3b12d7905671d670ae67818e4b435e33078ffd992c6eb4f91b9ae3bae4bd',
  'e58b0318c8b20bc9c8c38f5e6e51bc66a58d2e6b90f78555b857de3b65ee310e',
  'aacb89fb2a5c097f2942b4934f0f4100bb1d8e406739e489aa2a007ec0bbe83a',
  '2b212f2754a86bc730158967273dad34d74b0cf19c9f1b49686f648c1ac72751',
]);
// Telefone: com DDI e DDD, só com DDD, e só o número (os dígitos, sem separadores).
const NUMEROS_PROIBIDOS = new Set([
  'ebdc82dfa524a9348fb19f7cdf14d6e3cf98f31694870ec24de88827b3ef3547',
  'c5e955934ea643aab738dc901e7ef36727ac5cc50c8cd4dd66f637661feb4ab8',
  '974095757ca820af6eb11f1b9d2e70fb268afa5b725434f1551f9bd74d157295',
]);

/** As palavras de um texto, normalizadas, incluindo os pedaços de identificadores camelCase/SNAKE_CASE. */
function palavrasDe(texto) {
  const separado = String(texto || '').replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2');
  return new Set(normalizar(separado).match(/[a-z]+/g) || []);
}

/** Os detectores para uma lista de hashes de palavras e de números (a lista real abaixo; o teste usa uma sintética). */
function criarDetector(palavras, numeros) {
  const P = new Set(palavras);
  const N = new Set(numeros);
  return {
    contemNome(texto) {
      for (const palavra of palavrasDe(texto)) if (P.has(hash(palavra))) return true;
      return false;
    },
    contemNumero(texto) {
      for (const trecho of String(texto || '').match(/\d[\d\s().-]{6,}\d/g) || []) {
        const digitos = trecho.replace(/\D/g, '');
        for (const n of [digitos, digitos.slice(-11), digitos.slice(-9)]) if (N.has(hash(n))) return true;
      }
      return false;
    },
  };
}

const REAL = criarDetector(PALAVRAS_PROIBIDAS, NUMEROS_PROIBIDOS);
const contemNomeReal = REAL.contemNome;
const contemNumeroReal = REAL.contemNumero;

module.exports = { contemNomeReal, contemNumeroReal, palavrasDe, hash, criarDetector };
