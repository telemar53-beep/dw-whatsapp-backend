# Anexos do Apêndice D — entrega Tabler e gerador

- `entrega-tabler/` — os três módulos de ícones **conferidos** (84 exports, 0 falhas de pixel contra o
  pacote `@tabler/icons` 3.48.0), a licença MIT, a marca Pix da Simple Icons 16.0.0 (CC0), o
  mapeamento completo e as pranchas. `SHA256SUMS` fixa os bytes que a E2.1 copia para
  `frontend/src/components/icons/`: a tarefa confere o hash antes de copiar.
- `gerador/` — os scripts que produziram a entrega, guardados pela procedência. **Não rodam como
  estão:** `familias.mjs` aponta `SP` para o scratchpad da sessão de 24/09 e os pacotes
  (`@tabler/icons` 3.48.0, `simple-icons` 16.0.0) foram baixados lá. Para regenerar: baixar os dois
  pacotes, apontar `SP` para uma pasta de trabalho fora de `frontend/` e rodar
  `gerar-entrega-tabler.mjs`, depois `verif-tabler.mjs` (tem de dar 0 falhas). A E2.1 leva o
  gerador para `ferramentas/icones/` com caminhos relativos.

Os módulos gerados **não se editam à mão**: ícone novo ou troca de desenho passa pelo gerador e pela
verificação de pixels.
