import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadMyAvatar, deleteMyAvatar, changePassword } from '../services/api';
import AgentAvatar from './AgentAvatar';
import WaDialog, { waInputClass, waLabelClass, waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';
import { descreverErro } from '../utils/errorMessages';

function ProfileModal({ onClose, onProfileUpdated }) {
  const { token, updateAgent } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  useEffect(() => {
    getMyProfile(token)
      .then((data) => {
        setProfile(data);
        setName(data.name);
        setPhone(data.phone || '');
      })
      .catch((err) => {
        setLoadError(descreverErro(err, 'Falha ao carregar perfil'));
      });
  }, [token]);

  async function handleSaveProfile(event) {
    event.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);
    setSavingProfile(true);
    try {
      const updated = await updateMyProfile({ name, phone }, token);
      setProfile(updated);
      updateAgent({ name: updated.name });
      setProfileSuccess(true);
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setProfileError(descreverErro(err, 'Falha ao salvar perfil'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const result = await uploadMyAvatar(file, token);
      setProfile((prev) => ({ ...prev, avatarPath: result.avatarPath }));
      updateAgent({ avatarPath: result.avatarPath });
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError(descreverErro(err, 'Falha ao enviar foto'));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await deleteMyAvatar(token);
      setProfile((prev) => ({ ...prev, avatarPath: null }));
      updateAgent({ avatarPath: null });
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError(descreverErro(err, 'Falha ao remover foto'));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem');
      return;
    }
    setSubmittingPassword(true);
    try {
      await changePassword(currentPassword, newPassword, token);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(descreverErro(err, 'Falha ao trocar senha'));
    } finally {
      setSubmittingPassword(false);
    }
  }

  if (!profile) {
    return (
      <WaDialog variant="profile" title="Meu perfil" onClose={onClose} size="max-w-md">
        <div className="px-6 py-4">
          <p className="text-[14.5px] text-wa-muted">{loadError || 'Carregando…'}</p>
        </div>
        <div className="flex shrink-0 justify-end px-4 py-3">
          <button type="button" onClick={onClose} className={waGhostButtonClass}>
            Fechar
          </button>
        </div>
      </WaDialog>
    );
  }

  return (
    <WaDialog variant="profile" title="Meu perfil" onClose={onClose} size="max-w-4xl">
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-4 rounded-[16px] border border-wa-border bg-wa-panel-header px-4 py-4 sm:px-5">
          <AgentAvatar agentId={profile.id} avatarPath={profile.avatarPath} name={profile.name} size={68} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-wa-text">{profile.name}</p>
            <p className="truncate text-[13.5px] text-wa-muted">E-mail · {profile.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${waGhostButtonClass} cursor-pointer border border-wa-border bg-wa-panel text-wa-text`}>
              Alterar foto
              <input type="file" aria-label="Alterar foto" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarChange} disabled={avatarBusy} className="sr-only" />
            </label>
            {profile.avatarPath && (
              <button type="button" onClick={handleRemoveAvatar} disabled={avatarBusy} className="px-2 text-[13px] text-wa-error-text hover:underline">
                Remover foto
              </button>
            )}
          </div>
        </div>
        {avatarError && <p className={`mt-3 ${waErrorClass}`}>{avatarError}</p>}

        <div className="mt-5 space-y-5">
          <section aria-labelledby="profile-personal-title">
            <h3 id="profile-personal-title" className="text-[15px] font-semibold text-wa-text">Dados pessoais</h3>
            <p className="mt-1 text-[13px] text-wa-muted">Informações exibidas no seu perfil de atendimento.</p>
            <form id="profile-info-form" onSubmit={handleSaveProfile} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.15fr_0.9fr_1.15fr]">
              <div>
                <label htmlFor="profile-name" className={waLabelClass}>Nome completo</label>
                <input id="profile-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={waInputClass} required />
              </div>
              <div>
                <label htmlFor="profile-phone" className={waLabelClass}>Telefone</label>
                <input id="profile-phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={waInputClass} />
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <span className={waLabelClass}>E-mail</span>
                <p className="rounded-[10px] border border-wa-border bg-wa-panel-header px-3.5 py-2.5 text-[14px] text-wa-text">{profile.email}</p>
              </div>
            </form>
            {profileError && <p className={`mt-3 ${waErrorClass}`}>{profileError}</p>}
            {profileSuccess && <p className="mt-3 text-[13.5px] text-wa-muted">Perfil atualizado.</p>}
          </section>

          <details className="group rounded-[12px] border border-wa-border bg-wa-panel-header">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[14px] font-medium text-wa-text [&::-webkit-details-marker]:hidden">
              <span>Trocar senha <span className="ml-2 text-[12.5px] font-normal text-wa-muted">Atualize sua senha de acesso.</span></span>
              <span aria-hidden="true" className="text-wa-muted transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <form onSubmit={handleChangePassword} className="grid gap-3 border-t border-wa-border px-4 pb-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="current-password" className={waLabelClass}>Senha atual</label>
                <input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={waInputClass} required />
              </div>
              <div>
                <label htmlFor="new-password" className={waLabelClass}>Nova senha</label>
                <input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={waInputClass} required />
              </div>
              <div>
                <label htmlFor="confirm-password" className={waLabelClass}>Confirmar nova senha</label>
                <input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={waInputClass} required />
              </div>
              {passwordError && <p className={`sm:col-span-2 lg:col-span-3 ${waErrorClass}`}>{passwordError}</p>}
              {passwordSuccess && <p className="text-[13.5px] text-wa-muted sm:col-span-2 lg:col-span-3">Senha alterada com sucesso.</p>}
              <div className="flex justify-end pt-1 sm:col-span-2 lg:col-span-3">
                <button type="submit" disabled={submittingPassword} className={waGhostButtonClass}>Trocar senha</button>
              </div>
            </form>
          </details>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-wa-border bg-wa-panel-header px-5 py-3 sm:px-6">
        <button type="button" onClick={onClose} className={waGhostButtonClass}>Cancelar</button>
        <button type="submit" form="profile-info-form" disabled={savingProfile} className={waPrimaryButtonClass}>Salvar alterações</button>
      </div>
    </WaDialog>
  );
}

export default ProfileModal;
