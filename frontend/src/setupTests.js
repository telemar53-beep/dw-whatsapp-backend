import '@testing-library/jest-dom/vitest';

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
