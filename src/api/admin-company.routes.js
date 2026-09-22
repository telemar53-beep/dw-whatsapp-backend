const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getCompanyConfig, upsertCompanyConfig } = require('../company/company-config.repository');

const router = express.Router();

const TAMANHO_MAXIMO_NOME = 80;
const MAXIMO_DE_NOMES = 20;
const TAMANHO_MAXIMO_URL = 500;

// Estes tres campos sao os unicos do sistema que saem numa rota PUBLICA e
// viram atributo de imagem e valor de CSS numa pagina sem autenticacao. Por
// isso a validacao e por formato, e nao so por tipo: URL precisa ser http(s)
// -- `javascript:` e `data:` ficam de fora -- e a cor precisa ser hex, para
// nao virar um pedaco de folha de estilo.
const URL_DE_IMAGEM = /^https?:\/\/[^\s"'<>]+$/;
const COR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Ausente = nao mexe (ADR-011). Vazio = tira a marca, e e um valor legitimo.
function validarUrlOpcional(valor, campo) {
  if (valor === undefined) return null;
  if (typeof valor !== 'string' || valor.length > TAMANHO_MAXIMO_URL) {
    return `${campo} must be a string with at most ${TAMANHO_MAXIMO_URL} characters`;
  }
  if (valor.trim() !== '' && !URL_DE_IMAGEM.test(valor.trim())) {
    return `${campo} must be an http(s) URL or empty`;
  }
  return null;
}

function toResponse(config) {
  return {
    id: config.id,
    name: config.name,
    acceptedPayeeNames: config.acceptedPayeeNames,
    logoUrl: config.logoUrl,
    symbolUrl: config.symbolUrl,
    brandColor: config.brandColor,
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getCompanyConfig();
  res.json(toResponse(config));
});

router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, acceptedPayeeNames, logoUrl, symbolUrl, brandColor } = req.body || {};
  // Nome vazio é válido (o sistema sai sem empresa cadastrada e os textos caem
  // no genérico); o que não vale é outro tipo ou um nome que não caberia na tela.
  if (typeof name !== 'string' || name.length > TAMANHO_MAXIMO_NOME) {
    return res.status(400).json({ error: `name must be a string with at most ${TAMANHO_MAXIMO_NOME} characters` });
  }
  if (!Array.isArray(acceptedPayeeNames) || acceptedPayeeNames.length > MAXIMO_DE_NOMES) {
    return res.status(400).json({ error: `acceptedPayeeNames must be an array with at most ${MAXIMO_DE_NOMES} items` });
  }
  if (acceptedPayeeNames.some((n) => typeof n !== 'string' || n.length > TAMANHO_MAXIMO_NOME)) {
    return res.status(400).json({ error: `each accepted payee name must be a string with at most ${TAMANHO_MAXIMO_NOME} characters` });
  }
  const erroDeUrl = validarUrlOpcional(logoUrl, 'logoUrl') || validarUrlOpcional(symbolUrl, 'symbolUrl');
  if (erroDeUrl) {
    return res.status(400).json({ error: erroDeUrl });
  }
  if (brandColor !== undefined) {
    const cor = typeof brandColor === 'string' ? brandColor.trim() : null;
    if (cor === null || (cor !== '' && !COR_HEX.test(cor))) {
      return res.status(400).json({ error: 'brandColor must be a hex color like #1a73e8, or empty' });
    }
  }
  const config = await upsertCompanyConfig({ name, acceptedPayeeNames, logoUrl, symbolUrl, brandColor });
  res.json(toResponse(config));
});

module.exports = router;
