import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadMyAvatar, deleteMyAvatar, changePassword } from '../services/api';
import AgentAvatar from './AgentAvatar';
import WaDialog, { waInputClass, waLabelClass, waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';

function ProfileModal({ onClose, onProfileUpdated }) {
  const { token } = useAuth();
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
        setLoadError((err.body && err.body.error) || 'Falha ao carregar perfil');
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
      setProfileSuccess(true);
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setProfileError((err.body && err.body.error) || 'Falha ao salvar perfil');
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
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError((err.body && err.body.error) || 'Falha ao enviar foto');
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
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError((err.body && err.body.error) || 'Falha ao remover foto');
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
      setPasswordError((err.body && err.body.error) || 'Falha ao trocar senha');
    } finally {
      setSubmittingPassword(false);
    }
  }

  if (!profile) {
    return (
      <WaDialog title="Meu perfil" onClose={onClose} size="max-w-md">
        <div className="px-6 py-4">
          <p className="text-[14.5px] text-wa-muted">{loadError || 'Carregando...'}</p>
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
    <WaDialog title="Meu perfil" onClose={onClose} size="max-w-md">
      <div className="wa-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
        <div className="flex items-center gap-4">
          <AgentAvatar agentId={profile.id} avatarPath={profile.avatarPath} name={profile.name} size={64} />
          <div className="flex flex-col items-start gap-1.5">
            <label className={`${waGhostButtonClass} cursor-pointer`}>
              Alterar foto
              <input
                type="file"
                aria-label="Alterar foto"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarChange}
                disabled={avatarBusy}
                className="sr-only"
              />
            </label>
            {profile.avatarPath && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarBusy}
                className="px-2 text-[13px] text-[#b3261e] hover:underline"
              >
                Remover foto
              </button>
            )}
          </div>
        </div>
        {avatarError && <p className={waErrorClass}>{avatarError}</p>}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className={waLabelClass}>
              Nome completo
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={waInputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="profile-phone" className={waLabelClass}>
              Telefone
            </label>
            <input
              id="profile-phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={waInputClass}
            />
          </div>
          <div>
            <label className={waLabelClass}>E-mail</label>
            <p className="text-[14.5px] text-wa-text">{profile.email}</p>
          </div>
          {profileError && <p className={waErrorClass}>{profileError}</p>}
          {profileSuccess && <p className="text-[13.5px] text-wa-muted">Perfil atualizado.</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={savingProfile} className={waPrimaryButtonClass}>
              Salvar
            </button>
          </div>
        </form>

        <div className="border-t border-wa-border pt-4">
          <h3 className="mb-3 text-[15px] font-medium text-wa-text">Trocar senha</h3>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label htmlFor="current-password" className={waLabelClass}>
                Senha atual
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="new-password" className={waLabelClass}>
                Nova senha
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className={waLabelClass}>
                Confirmar nova senha
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            {passwordError && <p className={waErrorClass}>{passwordError}</p>}
            {passwordSuccess && <p className="text-[13.5px] text-wa-muted">Senha alterada com sucesso.</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={submittingPassword} className={waPrimaryButtonClass}>
                Trocar senha
              </button>
            </div>
          </form>
        </div>
      </div>
      <div className="flex shrink-0 justify-end px-4 py-3">
        <button type="button" onClick={onClose} className={waGhostButtonClass}>
          Fechar
        </button>
      </div>
    </WaDialog>
  );
}

export default ProfileModal;
