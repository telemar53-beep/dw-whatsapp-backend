const {
  markAgentOnline,
  markAgentOffline,
  isAgentOnline,
  getOnlineAgentIds,
  resetPresence,
} = require('./presence');

describe('presence', () => {
  beforeEach(() => {
    resetPresence();
  });

  test('markAgentOnline returns true on the first connection for an agent', () => {
    expect(markAgentOnline('agent-1')).toBe(true);
  });

  test('markAgentOnline returns false for a second simultaneous connection from the same agent', () => {
    markAgentOnline('agent-1');
    expect(markAgentOnline('agent-1')).toBe(false);
  });

  test('markAgentOffline returns true when the last connection for an agent closes', () => {
    markAgentOnline('agent-1');
    expect(markAgentOffline('agent-1')).toBe(true);
  });

  test('markAgentOffline returns false while other connections for the same agent remain open', () => {
    markAgentOnline('agent-1');
    markAgentOnline('agent-1');
    expect(markAgentOffline('agent-1')).toBe(false);
  });

  test('isAgentOnline reflects the current connection count', () => {
    expect(isAgentOnline('agent-1')).toBe(false);
    markAgentOnline('agent-1');
    expect(isAgentOnline('agent-1')).toBe(true);
    markAgentOffline('agent-1');
    expect(isAgentOnline('agent-1')).toBe(false);
  });

  test('getOnlineAgentIds lists every agent with at least one open connection', () => {
    markAgentOnline('agent-1');
    markAgentOnline('agent-2');
    expect(getOnlineAgentIds().sort()).toEqual(['agent-1', 'agent-2']);
    markAgentOffline('agent-1');
    expect(getOnlineAgentIds()).toEqual(['agent-2']);
  });

  test('markAgentOffline is a safe no-op for an agent with no tracked connections', () => {
    expect(markAgentOffline('agent-unknown')).toBe(false);
    expect(isAgentOnline('agent-unknown')).toBe(false);
  });
});
