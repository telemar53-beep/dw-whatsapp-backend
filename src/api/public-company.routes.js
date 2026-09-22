const express = require('express');
const { getCompanyConfig } = require('../company/company-config.repository');

const router = express.Router();

// A ÚNICA rota de configuração sem autenticação: a tela de login precisa
// mostrar a identidade da empresa antes de existir token. Devolve só o que é
// mesmo público — nome e os três campos visuais. Os nomes aceitos no
// comprovante são informação de conferência e continuam atrás do
// requireRole('admin'), junto com o id da linha.
router.get('/', async (req, res) => {
  const config = await getCompanyConfig();
  res.json({
    name: config.name,
    logoUrl: config.logoUrl,
    symbolUrl: config.symbolUrl,
    brandColor: config.brandColor,
  });
});

module.exports = router;
