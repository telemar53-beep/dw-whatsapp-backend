// Aviso de cidade — falha regional ativa: cita o aviso e suprime o roteiro
// normal de diagnóstico (nada de pedir para reiniciar equipamento nem
// prometer previsão) enquanto ele durar. Migração de ai-orchestrator.js —
// âncora "AVISO ATIVO NA CIDADE DO CLIENTE", hoje linhas 328-329 (o brief e o
// plano citavam ":387-390", desatualizado — mesmo padrão avisado pelas Tasks
// 13-16; localizado por grep de texto-âncora).
//
// entra() é Boolean(estado.avisoCidade): no original este bloco fica fora e
// ANTES de todo o if/else de identidade (linha 326, logo depois da lista de
// ferramentas de comprovante) — não depende de o cliente estar identificado.
// Faz sentido: uma falha regional afeta quem liga reclamando de internet
// mesmo antes de qualquer identificação.
//
// Nomes de setor (Restrição Global — mesmo idioma de fatos.js/financeiro.js/
// noturno.js/suporte-*.js): "conclua para o Suporte" virou "conclua para o
// setor da lista acima que cuidar de suporte".
//
// Cruza com suporte-diagnostico.js (Task 15): a linha "JÁ NORMALIZOU?" de lá
// já cita "se houver aviso ativo na cidade dele, use o aviso" — é só uma
// REFERÊNCIA cruzada ao aviso (não repete o conteúdo deste módulo), sem
// duplicação: quando os dois módulos entram juntos (cliente identificado com
// aviso ativo), o texto real do aviso só aparece uma vez, aqui.
module.exports = {
  nome: 'aviso-cidade',
  entra(estado) {
    return Boolean(estado.avisoCidade);
  },
  linhas(estado) {
    const aviso = estado.avisoCidade;
    return [
      '',
      `AVISO ATIVO NA CIDADE DO CLIENTE (${aviso.cidade}): ${aviso.mensagem}`,
      'Se ele reclamar de internet lenta, caindo ou sem acesso: informe que há uma falha regional em andamento nessa cidade (use o aviso acima), NÃO peça verificações de equipamento, NÃO prometa previsão, e conclua para o setor da lista acima que cuidar de suporte na mesma resposta com "falha regional" no resumo. Se o assunto for outro, atenda normalmente.',
    ];
  },
};
