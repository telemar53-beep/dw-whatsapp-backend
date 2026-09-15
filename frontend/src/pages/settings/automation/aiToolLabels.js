export const TOOL_LABELS = {
  buscar_cliente: 'Localizar cliente por CPF/CNPJ',
  consultar_status_contrato: 'Consultar situação do contrato',
  consultar_status_conexao: 'Consultar conexão de internet',
  consultar_plano: 'Consultar plano contratado',
  consultar_financeiro: 'Consultar resumo financeiro',
  consultar_faturas: 'Consultar faturas do contrato',
  consultar_faturas_todos_contratos: 'Consultar faturas de todos os contratos',
  consultar_status_todos_contratos: 'Consultar situação de todos os contratos',
  analisar_comprovante: 'Analisar comprovante de pagamento',
  confirmar_nascimento: 'Confirmar data de nascimento',
  definir_motivo_atendimento: 'Registrar motivo do atendimento',
  transferir_atendimento: 'Transferir para um setor',
  esquecer_identificacao: 'Esquecer identificação atual',
  concluir_triagem: 'Concluir triagem',
  encerrar_atendimento: 'Encerrar atendimento sozinha',
  gerar_segunda_via: 'Gerar segunda via do boleto',
  gerar_pix: 'Gerar código PIX',
  desbloqueio_confianca: 'Liberar em confiança',
  enviar_boleto: 'Enviar boleto em PDF',
};

export function toolLabel(nome) {
  return TOOL_LABELS[nome] || nome;
}
