const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listCities, listPlaces } = require('../cities/city.repository');

const router = express.Router();

// Compatibilidade segura por padrao: sem a flag, devolve exatamente o conjunto
// que os consumidores antigos sempre enxergaram (municipio e legado). Quem
// precisa de localidade pede explicitamente.
//
// Assim, esquecer de atualizar um consumidor causa AUSENCIA DE RECURSO, nunca
// um povoado aparecendo como municipio — e a direcao correta do erro.
router.get('/', requireAuth, async (req, res) => {
  const completo = req.query.includeLocalities === 'true';
  const lugares = completo ? await listPlaces() : await listCities();
  res.json(lugares);
});

module.exports = router;
