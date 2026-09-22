#!/usr/bin/env node
// Converte UM registro legado de `cities` em localidade, repontando os contatos
// dele. SIMULA POR PADRAO: so escreve com --confirmar.
//
//   node scripts/converter-localidade.js --listar
//   node scripts/converter-localidade.js --place <uuid> --parent <uuid>
//   node scripts/converter-localidade.js --place <uuid> --parent <uuid> --confirmar
//
// Um registro por execucao, de proposito: a conversao e decisao por registro.
// O script NUNCA adivinha o municipio e NUNCA altera o registro do municipio —
// nem o nome, nem o tipo.
//
// Mapeamentos confirmados pela operacao em 2026-09-22:
//
//   Aurizona          -> Godofredo Viana
//   Barao de Tromai   -> Candido Mendes
//   Chega tudo        -> Centro Novo do Maranhao, que no cadastro atual esta
//                        como "Centro Novo". REUTILIZAR o registro existente:
//                        nao criar outro municipio nem renomear este agora.
//
// Antes de converter, o municipio precisa estar classificado como Cidade na
// tela de Cadastros auxiliares. Isso e edicao comum, nao devolve 409, e este
// script recusa enquanto nao tiver sido feito.
const {
  converterEmLocalidade, listarLugaresParaConversao,
} = require('../src/cities/converter-localidade');
const { closePool } = require('../src/db/pool');

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? null : process.argv[i + 1];
}

const ROTULO_DE_TIPO = { city: 'Cidade', locality: 'Localidade', unclassified: 'Nao classificado' };

const MOTIVOS = {
  faltam_ids: 'Informe --place e --parent. Use --listar para ver os ids.',
  pai_igual_ao_filho: 'O municipio e o povoado sao o mesmo registro.',
  place_nao_encontrado: 'O registro informado em --place nao existe.',
  parent_nao_encontrado: 'O registro informado em --parent nao existe.',
  tem_filhas: 'Esse registro tem localidades filhas e nao pode virar localidade. Trate as filhas primeiro.',
  parent_nao_e_municipio:
    'O municipio precisa estar classificado como Cidade ANTES. Faca isso em '
    + 'Configuracoes > Cadastros auxiliares > Cidades e localidades, e rode de novo.',
};

async function listar() {
  const lugares = await listarLugaresParaConversao();
  console.log(`${lugares.length} registros em cities:\n`);
  const cabecalho = ['ID', 'NOME', 'TIPO', 'MUNICIPIO', 'CONTATOS', 'FILHAS', 'AVISOS'];
  console.log(cabecalho.join(' | '));
  for (const l of lugares) {
    console.log([
      l.id,
      l.name,
      ROTULO_DE_TIPO[l.kind] || l.kind,
      l.parentName || '-',
      `${l.contatosComoMunicipio} como municipio, ${l.contatosComoLocalidade} como localidade`,
      l.filhas,
      l.avisos,
    ].join(' | '));
  }
  console.log('\nA conversao usa --place <id do povoado> --parent <id do municipio>.');
}

(async () => {
  try {
    if (process.argv.includes('--listar')) {
      await listar();
      return;
    }

    const confirmar = process.argv.includes('--confirmar');
    const r = await converterEmLocalidade({
      placeId: argumento('place'),
      parentId: argumento('parent'),
      confirmar,
    });

    if (!r.ok) {
      // Ja convertido NAO e erro: e a segunda execucao do mesmo comando, e ela
      // nao alterou nada. Sai com sucesso para nao assustar quem repetir.
      if (r.motivo === 'ja_e_localidade') {
        const nome = r.place ? `"${r.place.name}" ` : '';
        console.log(`NADA A FAZER: o registro ${nome}ja e uma localidade. Nenhum dado foi alterado.`);
        return;
      }
      console.error(`RECUSADO (${r.motivo}): ${MOTIVOS[r.motivo] || 'motivo desconhecido'}`);
      process.exitCode = 1;
      return;
    }

    console.log(r.simulacao ? '--- PREVIA: nada foi gravado ---' : '--- CONVERTIDO ---');
    console.log(`  registro:  ${r.place.name} (${r.place.id})`);
    console.log(`  municipio: ${r.parent.name} (${r.parent.id})`);
    console.log(`  contatos que passam a ter esta localidade: ${r.contatosMovidos}`);
    console.log(`  avisos preservados no mesmo registro:      ${r.avisosPreservados}`);
    if (r.simulacao) {
      console.log('\nConfira os numeros acima. Para gravar, repita o comando com --confirmar.');
    }
  } finally {
    await closePool();
  }
})().catch((err) => {
  console.error('FALHOU, e nada foi gravado:', err.message);
  process.exitCode = 1;
});
