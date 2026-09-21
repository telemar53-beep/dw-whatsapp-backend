import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useSectors } from '../hooks/useSectors';
import { setAgentActive, setAgentSectors, resetAgentPassword } from '../services/api';
import CreateAgentForm from './CreateAgentForm';
import AgentAvatar from './AgentAvatar';
import WaDialog, { waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';
import { AsyncState, Button, CABECALHO, CELULA, DataTable, ITEM_DE_MENU, RowMenu } from './ui';
import { IconSearch, IconUserPlus, IconMore } from './icons/WaIcons';
import { descreverErro } from '../utils/errorMessages';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', agent: 'Atendente' };
const ROLE_OPTIONS = [
  ['all', 'Todos os perfis'],
  ['agent', 'Atendente'],
  ['manager', 'Gerente'],
  ['admin', 'Administrador'],
];
const STATUS_OPTIONS = [
  ['all', 'Todas as situações'],
  ['active', 'Ativos'],
  ['inactive', 'Inativos'],
];

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10 > item de menu 8.
const SMALL_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center rounded-[10px] border border-wa-border bg-wa-field px-3 text-[13px] font-medium text-wa-text transition hover:bg-wa-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50';
const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-focus-ring/40';

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex items-center rounded-[8px] px-2.5 py-[3px] text-[12.5px] font-medium ${
        active ? 'border border-chat-online/20 bg-chat-online/[0.14] text-chat-online' : 'border border-white/[0.08] bg-white/[0.08] text-wa-muted'
      }`}
    >
      {active ? 'Ativo' : 'Inativo'}
    </span>
  );
}

// Botão de reticências com um pop-up de ações; fecha ao clicar fora, no Esc ou ao escolher.
function AgentRow({ agentRow, currentAgent, sectors, onToggleActive, onSectorsSaved }) {
  const { token } = useAuth();
  const [editingSectors, setEditingSectors] = useState(false);
  const [selectedIds, setSelectedIds] = useState(agentRow.sectors.map((s) => s.id));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState(null);
  const [generatingPassword, setGeneratingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [copied, setCopied] = useState(false);
  const isSelf = agentRow.id === currentAgent?.id;

  async function handleGeneratePassword() {
    setPasswordError(null);
    setGeneratingPassword(true);
    try {
      const { newPassword } = await resetAgentPassword(agentRow.id, token);
      setGeneratedPassword(newPassword);
      setCopied(false);
    } catch (err) {
      setPasswordError(descreverErro(err, 'Falha ao gerar senha'));
    } finally {
      setGeneratingPassword(false);
    }
  }

  async function handleCopyPassword() {
    await navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
  }

  function handleEditSectorsClick() {
    setSelectedIds(agentRow.sectors.map((s) => s.id));
    setError(null);
    setEditingSectors((prev) => !prev);
  }

  function handleCancel() {
    setSelectedIds(agentRow.sectors.map((s) => s.id));
    setError(null);
    setEditingSectors(false);
  }

  function toggleSector(sectorId) {
    setSelectedIds((prev) => (prev.includes(sectorId) ? prev.filter((id) => id !== sectorId) : [...prev, sectorId]));
  }

  async function handleSaveSectors() {
    setError(null);
    setSubmitting(true);
    try {
      await setAgentSectors(agentRow.id, selectedIds, token);
      setEditingSectors(false);
      onSectorsSaved();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao salvar setores'));
    } finally {
      setSubmitting(false);
    }
  }

  const sectorsText = agentRow.sectors.length > 0 ? agentRow.sectors.map((s) => s.name).join(', ') : 'Nenhum setor';
  const roleLabel = ROLE_LABELS[agentRow.role] || ROLE_LABELS.agent;

  return (
    <>
      <tr className={`border-t border-wa-border ${agentRow.active ? '' : 'opacity-80'}`}>
        <td className={CELULA}>
          <div className="flex items-center gap-3">
            <AgentAvatar agentId={agentRow.id} avatarPath={agentRow.avatarPath} name={agentRow.name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-wa-text">{agentRow.name}</p>
              <p className="truncate text-[12.5px] text-wa-muted">{agentRow.email}</p>
            </div>
          </div>
        </td>
        <td className={`${CELULA} whitespace-nowrap text-wa-text`}>{roleLabel}</td>
        <td className={`${CELULA} max-w-[220px] truncate text-wa-text`} title={sectorsText}>
          {sectorsText}
        </td>
        <td className={`${CELULA} whitespace-nowrap`}>
          <StatusBadge active={agentRow.active} />
        </td>
        <td className={`${CELULA} whitespace-nowrap`}>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleEditSectorsClick}
              aria-label={`Editar setores de ${agentRow.name}`}
              aria-expanded={editingSectors}
            >
              Editar
            </Button>
            {!isSelf && (
              <RowMenu label={`Mais ações para ${agentRow.name}`}>
                <button type="button" onClick={handleGeneratePassword} disabled={generatingPassword} className={ITEM_DE_MENU}>
                  Gerar nova senha
                </button>
                <button type="button" onClick={() => onToggleActive(agentRow)} className={ITEM_DE_MENU}>
                  {agentRow.active ? 'Desativar' : 'Reativar'}
                </button>
              </RowMenu>
            )}
          </div>
        </td>
      </tr>

      {(editingSectors || passwordError) && (
        <tr className="bg-black/[0.12]">
          <td colSpan={5} className="px-4 pb-4 pt-3">
            {passwordError && <p className={`mb-3 ${waErrorClass}`}>{passwordError}</p>}
            {editingSectors && (
              <div className="dialog-sector-assignment space-y-3">
                <p className="text-[13px] font-medium text-wa-muted">Setores de {agentRow.name}</p>
                {sectors.length === 0 ? (
                  <p className="text-[13px] text-wa-muted">Nenhum setor cadastrado. Cadastre um na aba Setores.</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {sectors.map((sector) => (
                      <label key={sector.id} className="flex items-center gap-1.5 text-[13px] text-wa-text">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(sector.id)}
                          onChange={() => toggleSector(sector.id)}
                          className="h-4 w-4 accent-accent"
                        />
                        {sector.name}
                      </label>
                    ))}
                  </div>
                )}
                {error && <p className={waErrorClass}>{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={handleSaveSectors} loading={submitting} className="!py-1.5">
                    Salvar
                  </Button>
                  <Button variant="secondary" onClick={handleCancel} className="!py-1.5">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}

      {generatedPassword && (
        <WaDialog variant="users" title="Nova senha gerada" onClose={() => setGeneratedPassword(null)} closeOnBackdrop size="max-w-sm">
          <div className="space-y-3 px-6 py-4">
            <p className="text-sm text-wa-muted">
              Copie e repasse essa senha pro atendente — ela só aparece essa vez.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm text-wa-text">
                {generatedPassword}
              </code>
              <button type="button" onClick={handleCopyPassword} className={waPrimaryButtonClass}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
          <div className="flex shrink-0 justify-end px-4 py-3">
            <button type="button" onClick={() => setGeneratedPassword(null)} className={waGhostButtonClass}>
              Fechar
            </button>
          </div>
        </WaDialog>
      )}
    </>
  );
}

function matches(agentRow, term, role, situation) {
  if (role !== 'all' && agentRow.role !== role) return false;
  if (situation === 'active' && !agentRow.active) return false;
  if (situation === 'inactive' && agentRow.active) return false;
  if (!term) return true;
  return [agentRow.name, agentRow.email].some((field) => String(field || '').toLowerCase().includes(term));
}

function AgentsAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { token, agent: currentAgent } = useAuth();
  const { agents, status, refresh } = useAgentsAdmin();
  const { sectors } = useSectors();
  const [internalCreating, setInternalCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [situation, setSituation] = useState('all');
  const controlled = creatingProp !== undefined;
  const creatingAgent = controlled ? creatingProp : internalCreating;
  const setCreatingAgent = controlled ? onCreatingChange : setInternalCreating;

  async function handleToggleActive(agentToToggle) {
    await setAgentActive(agentToToggle.id, !agentToToggle.active, token);
    refresh();
  }

  const term = search.trim().toLowerCase();
  // Ativos primeiro, depois por nome: quem está fora da operação vai para o fim.
  const visible = useMemo(
    () =>
      agents
        .filter((row) => matches(row, term, role, situation))
        .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1)),
    [agents, term, role, situation]
  );
  const filtered = visible.length !== agents.length;
  const countLabel = filtered
    ? `${visible.length} de ${agents.length} usuários`
    : `${agents.length} ${agents.length === 1 ? 'usuário' : 'usuários'}`;

  return (
    <>
      <section
        aria-labelledby="users-card-title"
        className="overflow-clip"
      >
        <div className="settings-register-head flex flex-wrap items-center justify-between gap-3 pb-4 pt-1">
          <h2 id="users-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
            Usuários
          </h2>
          <Button onClick={() => setCreatingAgent(true)} className="!py-2">
            <IconUserPlus size={18} />
            Adicionar usuário
          </Button>
        </div>

        <div className="settings-register-toolbar flex flex-wrap items-center gap-3 pb-4">
          <label
            className={`${CONTROL} flex min-w-[220px] flex-1 items-center gap-2.5 px-3.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/25`}
          >
            <span className="shrink-0 text-wa-muted">
              <IconSearch size={17} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou e-mail"
              aria-label="Buscar por nome ou e-mail"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
            />
          </label>
          <select
            aria-label="Perfil"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={`${CONTROL} px-3 pr-8`}
          >
            {ROLE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Situação"
            value={situation}
            onChange={(event) => setSituation(event.target.value)}
            className={`${CONTROL} px-3 pr-8`}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-register-summary flex flex-wrap items-center justify-between gap-2 px-1 py-3 text-[12.5px] text-wa-muted">
          <span>{countLabel}</span>
          <span>A situação da conta é diferente do status online.</span>
        </div>
        <div className="settings-register-list overflow-hidden rounded-[15px] border border-wa-surface-line bg-wa-surface">
          <AsyncState status={status} isEmpty={agents.length === 0} emptyMessage="Nenhum usuário cadastrado ainda.">
            <DataTable className="min-w-[720px]">
                <thead>
                  <tr className="bg-black/[0.16]">
                    <th scope="col" className={CABECALHO}>
                      Nome
                    </th>
                    <th scope="col" className={CABECALHO}>
                      Perfil
                    </th>
                    <th scope="col" className={CABECALHO}>
                      Setores
                    </th>
                    <th scope="col" className={CABECALHO}>
                      Situação
                    </th>
                    <th scope="col" className={`${CABECALHO} text-right`}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr className="border-t border-wa-border">
                      <td colSpan={5} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                        Nenhum usuário com esse filtro.
                      </td>
                    </tr>
                  ) : (
                    visible.map((agentRow) => (
                      <AgentRow
                        key={agentRow.id}
                        agentRow={agentRow}
                        currentAgent={currentAgent}
                        sectors={sectors}
                        onToggleActive={handleToggleActive}
                        onSectorsSaved={refresh}
                      />
                    ))
                  )}
                </tbody>
              </DataTable>
          </AsyncState>
        </div>


      </section>

      {creatingAgent && (
        <WaDialog variant="users" title="Adicionar usuário" onClose={() => setCreatingAgent(false)} size="max-w-2xl">
          <div className="px-6 pb-5 pt-2">
            <CreateAgentForm
              embedded
              onCreated={() => {
                refresh();
                setCreatingAgent(false);
              }}
              onCancel={() => setCreatingAgent(false)}
            />
          </div>
        </WaDialog>
      )}
    </>
  );
}

export default AgentsAdminTab;
