const express = require('express');
const { getCompanyConfig } = require('../company/company-config.repository');

const router = express.Router();

// A ÚNICA rota de configuração sem autenticação: a tela de login precisa
// mostrar o nome da empresa antes de existir token. Devolve só o nome —
// os nomes aceitos no comprovante são informação de conferência e ficam
// atrás do requireRole('admin').
router.get('/', async (req, res) => {
  const config = await getCompanyConfig();
  res.json({ name: config.name });
});

module.exports = router;
