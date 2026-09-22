const { apresentarConversa, apresentarConversas, podeVerNotaInterna } = require('./conversation.presenter');

// A nota interna e texto que a EQUIPE escreve sobre o cliente. Ela existe no
// mesmo objeto que a tela usa para tudo, entao quem decide se ela sai precisa
// ser um lugar so, no caminho da interface -- nunca a query, que tambem
// alimenta IA, SGP e workers (ADR-008).
const CONVERSA = {
  id: 'conv-1',
  assignedAgentId: 'agent-1',
  protocolNumber: '20260922-0007',
  assignedAgentName: 'Maria',
  contactInternalNote: 'Ja reclamou 3x no Procon',
};

describe('apresentarConversa', () => {
  test('o responsavel pela conversa ve a nota interna', () => {
    const saida = apresentarConversa(CONVERSA, { agentId: 'agent-1', role: 'agent' });

    expect(saida.contactInternalNote).toBe('Ja reclamou 3x no Procon');
  });

  test('admin e gerente veem, mesmo sem ser o responsavel', () => {
    for (const role of ['admin', 'manager']) {
      const saida = apresentarConversa(CONVERSA, { agentId: 'outro', role });
      expect(saida.contactInternalNote).toBe('Ja reclamou 3x no Procon');
    }
  });

  // A CHAVE some, nao vira null: quem nao pode ver nao deve conseguir
  // distinguir "sem acesso" de "nao ha nota escrita".
  test('atendente que nao e o responsavel nao recebe a nota, e a chave nem existe', () => {
    const saida = apresentarConversa(CONVERSA, { agentId: 'agent-9', role: 'agent' });

    expect(saida.contactInternalNote).toBeUndefined();
    expect('contactInternalNote' in saida).toBe(false);
    expect(JSON.stringify(saida)).not.toContain('Procon');
  });

  test('sem agente nenhum, nao sai nota', () => {
    expect('contactInternalNote' in apresentarConversa(CONVERSA, null)).toBe(false);
    expect('contactInternalNote' in apresentarConversa(CONVERSA, undefined)).toBe(false);
  });

  // Conversa da fila nao tem dono: assignedAgentId null nao pode casar com
  // um agentId ausente e liberar a nota para qualquer um.
  test('conversa sem responsavel nao libera a nota para atendente comum', () => {
    const daFila = { ...CONVERSA, assignedAgentId: null };

    expect('contactInternalNote' in apresentarConversa(daFila, { agentId: 'agent-1', role: 'agent' })).toBe(false);
    expect('contactInternalNote' in apresentarConversa(daFila, { agentId: null, role: 'agent' })).toBe(false);
    expect('contactInternalNote' in apresentarConversa(daFila, { agentId: undefined, role: 'agent' })).toBe(false);
  });

  test('protocolo e responsavel nao passam pelo filtro: saem para todo mundo', () => {
    const saida = apresentarConversa(CONVERSA, { agentId: 'agent-9', role: 'agent' });

    expect(saida.protocolNumber).toBe('20260922-0007');
    expect(saida.assignedAgentName).toBe('Maria');
    expect(saida.assignedAgentId).toBe('agent-1');
  });

  test('nao inventa a chave quando a consulta nao trouxe nota', () => {
    const semNota = { id: 'conv-2', assignedAgentId: 'agent-1' };

    const saida = apresentarConversa(semNota, { agentId: 'agent-1', role: 'agent' });

    expect(saida).toEqual(semNota);
  });
});

describe('apresentarConversas', () => {
  test('filtra item a item: a minha traz nota, a do colega nao', () => {
    const lista = [
      { id: 'a', assignedAgentId: 'agent-1', contactInternalNote: 'minha' },
      { id: 'b', assignedAgentId: 'agent-2', contactInternalNote: 'do colega' },
    ];

    const saida = apresentarConversas(lista, { agentId: 'agent-1', role: 'agent' });

    expect(saida[0].contactInternalNote).toBe('minha');
    expect('contactInternalNote' in saida[1]).toBe(false);
    expect(JSON.stringify(saida)).not.toContain('do colega');
  });

  test('lista vazia e ausente nao quebram', () => {
    expect(apresentarConversas([], { agentId: 'a', role: 'agent' })).toEqual([]);
    expect(apresentarConversas(null, { agentId: 'a', role: 'agent' })).toEqual([]);
  });
});

describe('podeVerNotaInterna', () => {
  test('resume a regra', () => {
    expect(podeVerNotaInterna(CONVERSA, { agentId: 'agent-1', role: 'agent' })).toBe(true);
    expect(podeVerNotaInterna(CONVERSA, { agentId: 'x', role: 'admin' })).toBe(true);
    expect(podeVerNotaInterna(CONVERSA, { agentId: 'x', role: 'manager' })).toBe(true);
    expect(podeVerNotaInterna(CONVERSA, { agentId: 'x', role: 'agent' })).toBe(false);
  });
});
