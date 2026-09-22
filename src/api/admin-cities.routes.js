const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { createPlace, updatePlace, deleteCity, findCityById } = require('../cities/city.repository');
const { dependenciasDoLugar } = require('../cities/place-dependencies');

const router = express.Router();

// 'unclassified' e valor de MIGRACAO, nao opcao de cadastro: representa um
// registro legado ainda nao classificado. So a conversao autorizada o remove,
// e a rota recusa em vez de ignorar em silencio.
const KINDS_ACEITOS = ['city', 'locality'];

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

async function validarEstrutura({ kind, parentId }) {
  if (!KINDS_ACEITOS.includes(kind)) return 'kind is invalid';
  if (kind === 'city') return parentId ? 'city cannot have parentId' : null;
  if (!parentId) return 'parentId is required for locality';
  const pai = await findCityById(parentId);
  if (!pai) return 'parentId not found';
  // Hierarquia de dois niveis: nenhum CHECK alcanca outra linha, entao e aqui.
  if (pai.kind === 'locality') return 'parentId must be a city';
  return null;
}

function popEmUso(err) {
  return Boolean(err) && err.code === '23505' && String(err.constraint) === 'cities_sgp_pop_key_unico';
}

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const corpo = req.body || {};
  const name = texto(corpo.name);
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const kind = corpo.kind === undefined ? 'city' : corpo.kind;
  const parentId = corpo.parentId === undefined ? null : corpo.parentId;
  const erro = await validarEstrutura({ kind, parentId });
  if (erro) {
    return res.status(400).json({ error: erro });
  }

  try {
    const lugar = await createPlace({
      name,
      kind,
      parentId,
      sgpPop: corpo.sgpPop === undefined ? null : corpo.sgpPop,
      active: typeof corpo.active === 'boolean' ? corpo.active : true,
      served: typeof corpo.served === 'boolean' ? corpo.served : false,
      note: texto(corpo.note),
    });
    return res.status(201).json(lugar);
  } catch (err) {
    if (popEmUso(err)) return res.status(409).json({ error: 'sgpPop already in use' });
    throw err;
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const atual = await findCityById(req.params.id);
  if (!atual) {
    return res.status(404).json({ error: 'City not found' });
  }

  const corpo = req.body || {};
  const patch = {};

  if ('name' in corpo) {
    const name = texto(corpo.name);
    if (!name) return res.status(400).json({ error: 'name is required' });
    patch.name = name;
  }
  for (const campo of ['active', 'served']) {
    if (campo in corpo) {
      if (typeof corpo[campo] !== 'boolean') return res.status(400).json({ error: `${campo} must be a boolean` });
      patch[campo] = corpo[campo];
    }
  }
  if ('note' in corpo) patch.note = texto(corpo.note);
  if ('sgpPop' in corpo) patch.sgpPop = corpo.sgpPop;

  // kind e parent_id mudam o SIGNIFICADO do registro dentro da hierarquia e
  // podem invalidar vinculos que ja existem. Nao corrigir registros em massa em
  // silencio, nao mover clientes automaticamente: 409 e tratamento explicito.
  //
  // A guarda compara VALORES, nao a presenca das chaves. O formulario manda o
  // registro inteiro a cada salvamento, entao olhar so a presenca fazia toda
  // edicao comum parecer mudanca estrutural: marcar "Atendida" em Barao de
  // Tromai devolvia 409 dizendo que 24 contatos usavam o povoado (relato de
  // 2026-09-22). Mandar kind e parentId IGUAIS aos atuais nao e mudanca.
  const kind = 'kind' in corpo ? corpo.kind : atual.kind;
  const parentId = ('parentId' in corpo ? corpo.parentId : atual.parentId) || null;
  const mudaEstrutura = kind !== atual.kind || parentId !== (atual.parentId || null);

  if (mudaEstrutura) {
    const erro = await validarEstrutura({ kind, parentId });
    if (erro) return res.status(400).json({ error: erro });

    const dependencies = await dependenciasDoLugar(atual.id);
    // Classificar um registro legado COMO MUNICIPIO nao invalida nada: os
    // contatos dele ja o usam como municipio. O que invalida e transforma-lo em
    // localidade tendo contatos que o usam como municipio, mexer num registro
    // que ja e pai, ou trocar o pai de uma localidade que ja tem contatos.
    const impede =
      dependencies.filhas > 0
      || dependencies.contatosComoLocalidade > 0
      || (kind === 'locality' && dependencies.contatosComoMunicipio > 0);
    if (impede) {
      return res.status(409).json({ error: 'structural change blocked', dependencies });
    }
    patch.kind = kind;
    patch.parentId = parentId;
  }

  try {
    const lugar = await updatePlace(atual.id, patch);
    return res.json(lugar);
  } catch (err) {
    if (popEmUso(err)) return res.status(409).json({ error: 'sgpPop already in use' });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  // Sem esta checagem o DELETE bateria na FK de parent_id e viraria 500. O
  // municipio com filha realmente nao pode sair, mas quem administra precisa
  // saber o motivo.
  const dependencies = await dependenciasDoLugar(req.params.id);
  if (dependencies.filhas > 0) {
    return res.status(409).json({ error: 'place has localities', dependencies });
  }

  const deleted = await deleteCity(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'City not found' });
  }
  return res.status(204).send();
});

module.exports = router;
