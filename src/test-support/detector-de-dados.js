// Detector de dados por hash, para os testes (D9, 06/10/2026). NÃO guarda nenhum dado: a lista vem de quem chama (sintética
// nos testes) ou, opcionalmente, de um arquivo LOCAL fora do repositório (variável DADOS_PROIBIDOS_ARQUIVO, JSON com
// { palavras: [hash...], numeros: [hash...] }). Os hashes de dados pessoais saíram dos arquivos do repositório público:
// hash de nome se inverte por dicionário, e de número por força bruta — no repositório, o hash funcionava como o dado.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** As palavras de um texto, normalizadas, incluindo os pedaços de identificadores camelCase/SNAKE_CASE. */
function palavrasDe(texto) {
  const separado = String(texto || '').replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2');
  return new Set(normalizar(separado).match(/[a-z]+/g) || []);
}

// As formas de um trecho de dígitos que podem estar na lista: toda janela de 8 a 13 dígitos e, para o celular escrito sem
// o nono dígito (55 DD 8 dígitos, ou DD 8 dígitos, começando de 6 a 9), também a forma com o 9.
function formasDoNumero(digitos) {
  const bases = [digitos];
  if (/^55\d{2}[6-9]\d{7}$/.test(digitos)) bases.push(`${digitos.slice(0, 4)}9${digitos.slice(4)}`);
  if (/^\d{2}[6-9]\d{7}$/.test(digitos)) bases.push(`${digitos.slice(0, 2)}9${digitos.slice(2)}`);
  const formas = new Set();
  for (const b of bases) {
    for (let tam = 8; tam <= Math.min(13, b.length); tam += 1) {
      for (let i = 0; i + tam <= b.length; i += 1) formas.add(b.slice(i, i + tam));
    }
  }
  return formas;
}

/** Os detectores para uma lista de hashes de palavras e de números. */
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
        for (const n of formasDoNumero(trecho.replace(/\D/g, ''))) if (N.has(hash(n))) return true;
      }
      return false;
    },
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
/**
 * A lista local (fora do repositório), ou null quando a variável não está definida. Definida e quebrada é erro, não
 * pulo: arquivo ausente, dentro do repositório, sem nenhum hash ou com entrada que não é hash SHA-256.
 */
function listaLocal() {
  const arquivo = process.env.DADOS_PROIBIDOS_ARQUIVO;
  if (!arquivo) return null;
  const absoluto = path.resolve(arquivo);
  const dentro = path.relative(RAIZ, absoluto);
  if (!dentro.startsWith('..') && !path.isAbsolute(dentro)) {
    throw new Error('DADOS_PROIBIDOS_ARQUIVO aponta para dentro do repositório: a lista local fica fora dele');
  }
  if (!fs.existsSync(absoluto)) throw new Error('DADOS_PROIBIDOS_ARQUIVO definida, mas o arquivo não existe');
  const dados = JSON.parse(fs.readFileSync(absoluto, 'utf8'));
  const palavras = Array.isArray(dados.palavras) ? dados.palavras : [];
  const numeros = Array.isArray(dados.numeros) ? dados.numeros : [];
  if (palavras.length + numeros.length === 0) throw new Error('a lista local não tem nenhum hash');
  if (![...palavras, ...numeros].every((h) => HEX64.test(h))) throw new Error('a lista local tem entrada que não é hash SHA-256');
  return { palavras, numeros };
}

// Guarda estrutural dos textos do prompt (sem dado nenhum): modelo de frase com um nome próprio no lugar do marcador
// "[nome]" — na saudação, na despedida, no exemplo de pedido de fatura de outra pessoa ou no "em nome de". Pega QUALQUER
// nome, real ou não, com ou sem vírgula, capitalizado ou em maiúsculas. As palavras comuns que podem vir logo depois de
// uma saudação ("Claro Vou…") ou em ênfase ("boleto do MESMO contrato") ficam de fora.
const NOME = '([A-ZÀ-Ý][a-zà-ÿ]+|[A-ZÀ-Ý]{2,})';
const SAUDACAO = '(?:[Bb]om dia|[Bb]oa tarde|[Bb]oa noite|[Oo]l[áa]|[Oo]i|[Ii]magina|[Oo]brigad[oa]|[Pp]rontinho|[Cc]laro|[Tt]chau|'
  + '[Dd]isponha|[Dd]e nada|[Aa]t[ée] logo|[Aa]t[ée] mais|[Cc]erto|[Pp]erfeito|[Cc]ombinado)';
const OBJETO = '(?:[Ff]aturas?|[Bb]oletos?|[Cc]ontratos?|[Cc]ontas?|PIX|[Pp]ix|[Ss]egunda via|2ª via)';
// O fim do nome: o \b do JavaScript é ASCII e cortaria "Você" em "Voc" (e "Simeão" em "Sime").
const FIM = '(?![A-Za-zÀ-ÿ])';
const MODELOS = [
  new RegExp(`\\b${SAUDACAO}\\s*,?\\s+(?!\\[)${NOME}${FIM}`, 'g'),
  new RegExp(`\\b${OBJETO} d[aoe]s? (?:cliente |titular |senhora? |sra?\\.? )?(?!\\[)${NOME}${FIM}`, 'g'),
  new RegExp(`\\bem nome d[aoe] (?!\\[)${NOME}${FIM}`, 'g'),
];
const NAO_SAO_NOMES = new Set([
  'Vou', 'Posso', 'Pode', 'Tudo', 'Como', 'Em', 'Seu', 'Sua', 'Você', 'Voce', 'Que', 'Já', 'Aqui', 'Estou', 'Eu', 'Me', 'Se',
  'Para', 'Por', 'Qualquer', 'Estamos', 'Fico', 'Seja', 'Tenha', 'Sim', 'Não', 'Nao', 'Ok', 'Entendi', 'Obrigado', 'Obrigada',
  'Bom', 'Boa', 'Certo', 'Claro', 'Perfeito', 'Prontinho', 'Agradeço', 'Rua', 'Avenida', 'Travessa',
  'MESMO', 'MESMA', 'OUTRO', 'OUTRA', 'TODOS', 'TODAS', 'TERCEIRO', 'TITULAR', 'CLIENTE', 'SGP', 'PIX', 'CPF', 'DW',
  'NÃO', 'NUNCA', 'SEMPRE', 'NADA', 'SEU', 'SUA',
]);
function nomesEmModelosDeFrase(texto) {
  const s = String(texto || '');
  return MODELOS.flatMap((re) => [...s.matchAll(re)]).map((m) => m[1]).filter((n) => !NAO_SAO_NOMES.has(n));
}

module.exports = { RAIZ, hash, palavrasDe, formasDoNumero, criarDetector, listaLocal, nomesEmModelosDeFrase };
