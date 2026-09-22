import { describe, test, expect } from 'vitest';
import { hasLevel, NAV_ITEMS, SETTINGS_SECTIONS, LEGACY_REDIRECTS, firstAllowedSettingsPath } from './navItems';

const agent = { role: 'agent' };
const manager = { role: 'manager', canManageIntegrations: false };
const managerFlag = { role: 'manager', canManageIntegrations: true };
const admin = { role: 'admin' };

describe('hasLevel', () => {
  test('auth aceita qualquer perfil com conta', () => {
    expect(hasLevel(agent, 'auth')).toBe(true);
    expect(hasLevel(null, 'auth')).toBe(false);
  });
  test('admin aceita admin e gerente, não atendente', () => {
    expect(hasLevel(agent, 'admin')).toBe(false);
    expect(hasLevel(manager, 'admin')).toBe(true);
    expect(hasLevel(admin, 'admin')).toBe(true);
  });
  test('integrations aceita admin e gerente com a flag', () => {
    expect(hasLevel(manager, 'integrations')).toBe(false);
    expect(hasLevel(managerFlag, 'integrations')).toBe(true);
    expect(hasLevel(admin, 'integrations')).toBe(true);
  });
});

describe('NAV_ITEMS', () => {
  test('tem os cinco itens na ordem do menu', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Atendimento', 'Supervisão', 'Campanhas', 'Relatórios', 'Configurações']);
  });
  test('Supervisão, Campanhas e Configurações exigem nível admin', () => {
    expect(NAV_ITEMS.find((i) => i.key === 'supervisao').level).toBe('admin');
    expect(NAV_ITEMS.find((i) => i.key === 'configuracoes').level).toBe('admin');
    expect(NAV_ITEMS.find((i) => i.key === 'campanhas').level).toBe('admin');
  });

  test('o nível de Campanhas vale para administrador e gerente, e não para atendente', () => {
    const campanhas = NAV_ITEMS.find((i) => i.key === 'campanhas');
    expect(hasLevel({ role: 'admin' }, campanhas.level)).toBe(true);
    expect(hasLevel({ role: 'manager' }, campanhas.level)).toBe(true);
    expect(hasLevel({ role: 'agent' }, campanhas.level)).toBe(false);
  });
});

describe('SETTINGS_SECTIONS', () => {
  test('cada página tem rota sob /configuracoes e um nível válido', () => {
    const items = SETTINGS_SECTIONS.flatMap((g) => g.items);
    // 23 desde 2026-09-22, com a entrada de Planos em Cadastros auxiliares.
    // A contagem existe para uma pagina nova nao entrar sem ninguem perceber:
    // quando ela quebrar, conferir se o item novo era intencional antes de
    // ajustar o numero.
    expect(items.length).toBe(23);
    expect(new Set(items.map((item) => item.to)).size).toBe(items.length);
    items.forEach((item) => {
      expect(item.to.startsWith('/configuracoes/')).toBe(true);
      expect(['admin', 'integrations']).toContain(item.level);
    });
  });
  test('as três páginas de Integrações exigem credenciais', () => {
    const integracoes = SETTINGS_SECTIONS.find((g) => g.groupKey === 'integracoes');
    expect(integracoes.items.every((i) => i.level === 'integrations')).toBe(true);
  });
});

describe('firstAllowedSettingsPath', () => {
  test('admin cai na lista de canais', () => {
    expect(firstAllowedSettingsPath(admin)).toBe('/configuracoes/canais');
  });
  test('gerente sem flag também cai em canais (lista é nível admin)', () => {
    expect(firstAllowedSettingsPath(manager)).toBe('/configuracoes/canais');
  });
  test('atendente não tem página permitida', () => {
    expect(firstAllowedSettingsPath(agent)).toBe(null);
  });
});

describe('LEGACY_REDIRECTS', () => {
  test('cobre as oito rotas antigas', () => {
    expect(LEGACY_REDIRECTS.map((r) => r.from).sort()).toEqual(
      ['/admin/channels', '/admin/dashboard', '/campaigns', '/campaigns/:id', '/metrics', '/configuracoes/regras/atribuicao', '/configuracoes/integracoes/sgp-consulta', '/configuracoes/integracoes/sgp-canal'].sort()
    );
  });
});
