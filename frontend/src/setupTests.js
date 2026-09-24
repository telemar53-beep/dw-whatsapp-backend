import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Desde o code splitting, TODA rota chega por `import()`: renderizar uma
// página deixou de ser síncrono e passou a depender de uma promessa resolver.
// O padrão de 1 s das utilidades `findBy*` foi escrito para o app anterior, e
// com várias suítes disputando a mesma máquina ele estoura de vez em quando —
// o mesmo teste passava sozinho em 677 ms e falhava em 1098 ms na suíte cheia.
//
// Teste intermitente é pior que teste falhando: um vermelho estável aponta um
// defeito, um que pisca ensina a ignorar a suíte.
//
// Isto NÃO afrouxa asserção nenhuma: nenhum teste passa a aceitar algo que
// antes recusava, só se dá mais tempo ao relógio. O custo é que um teste
// genuinamente quebrado leva até 5 s para falhar, em vez de 1 s.
configure({ asyncUtilTimeout: 5000 });

// O jsdom não implementa URL.createObjectURL/revokeObjectURL, que o navegador
// tem. Sem estes, qualquer componente que gere prévia de arquivo (a miniatura
// do anexo no chat, por exemplo) quebra no teste por um motivo que não existe
// em produção. Um teste que queira checar a URL gerada sobrescreve isto.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:jsdom';
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {};
}
