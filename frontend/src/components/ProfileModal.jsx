import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadMyAvatar, deleteMyAvatar, changePassword } from '../services/api';
import AgentAvatar from './AgentAvatar';
import { DialogoClaro, useCelular } from './ui/DialogoClaro';
import { IconeRecolher } from './icones/conversa';
import { descreverErro } from '../utils/errorMessages';
import { useConfirm } from '../hooks/useConfirm';
import './dialogo-perfil.css';

// "Meu perfil", claro (Bloco 1). Chega sob demanda pela casca (AppShell): a
// página nenhuma baixa este formulário antes de alguém abrir o perfil.
//
// Só o que existe: foto, nome e telefone editáveis; e-mail só de leitura;
// troca de senha recolhida. Setor, e-mail e papel não viram edição aqui, e
// "Sair" continua no menu da conta — não é parte do formulário.

function ProfileModal({ onClose, onProfileUpdated }) {
  const { token, updateAgent } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const celular = useCelular();
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  // 'enviando' | 'removendo' | null: o envio da foto era invisível (PRF-04).
  const [avatarAcao, setAvatarAcao] = useState(null);
  const avatarBusy = avatarAcao !== null;
  const [avatarError, setAvatarError] = useState(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  // A mensagem do servidor fica ("Sessão expirada" diz ao atendente o que
  // fazer) e o erro ganha "Tentar de novo" — decisão do proprietário, 24/09.
  const carregar = useCallback(() => {
    setLoadError(null);
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

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleSaveProfile(event) {
    event.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);
    // Nome só com espaços passava pelo `required` e voltava com o nome técnico
    // do campo (PRF-06/08).
    const nomeLimpo = name.trim();
    if (!nomeLimpo) {
      setProfileError('Informe o nome.');
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await updateMyProfile({ name: nomeLimpo, phone }, token);
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
    setAvatarAcao('enviando');
    try {
      const result = await uploadMyAvatar(file, token);
      setProfile((prev) => ({ ...prev, avatarPath: result.avatarPath }));
      updateAgent({ avatarPath: result.avatarPath });
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError(descreverErro(err, 'Falha ao enviar foto'));
    } finally {
      setAvatarAcao(null);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarAcao('removendo');
    try {
      await deleteMyAvatar(token);
      setProfile((prev) => ({ ...prev, avatarPath: null }));
      updateAgent({ avatarPath: null });
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError(descreverErro(err, 'Falha ao remover foto'));
    } finally {
      setAvatarAcao(null);
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

  // Fechar com edição perdia tudo sem perguntar (PRF-17).
  const editado = Boolean(profile) && (name !== profile.name || phone !== (profile.phone || ''));
  const senhaPreenchida = Boolean(currentPassword || newPassword || confirmPassword);
  async function fechar() {
    if (editado || senhaPreenchida) {
      const ok = await confirm('O que você digitou será perdido.', {
        title: 'Descartar alterações?', danger: true, confirmLabel: 'Descartar', cancelLabel: 'Continuar editando',
      });
      if (!ok) return;
    }
    onClose();
  }

  if (!profile) {
    return (
      <DialogoClaro variant="profile" titulo="Meu perfil" onClose={onClose} celular={celular} className="pf-dialogo">
        <div className="mc-corpo pf-estado">
          {loadError ? (
            <div role="alert" className="mc-falha">
              <span>{loadError}</span>
              <button type="button" className="mc-botao" onClick={carregar}>Tentar de novo</button>
            </div>
          ) : (
            <p role="status" className="mc-carregando">Carregando o seu perfil…</p>
          )}
        </div>
      </DialogoClaro>
    );
  }

  const campo = (evento, definir, limparSucesso) => { definir(evento.target.value); limparSucesso(false); };

  return (
    <>
      <DialogoClaro variant="profile" titulo="Meu perfil" onClose={fechar} celular={celular} className="pf-dialogo">
        <div className="mc-corpo pf-corpo">
          <section className="pf-identidade">
            <span className="pf-avatar" aria-hidden="true">
              <AgentAvatar agentId={profile.id} avatarPath={profile.avatarPath} name={profile.name} size={celular ? 56 : 64} />
            </span>
            <div className="pf-quem">
              <p className="pf-nome" title={profile.name}>{profile.name}</p>
              <p className="pf-email" title={profile.email}>{profile.email}</p>
              <div className="pf-foto-acoes">
                <label className="mc-botao pf-foto" data-ocupado={avatarAcao === 'enviando' ? 'true' : undefined}>
                  {avatarAcao === 'enviando' ? 'Enviando foto…' : 'Alterar foto'}
                  <input type="file" aria-label="Alterar foto" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarChange} disabled={avatarBusy} className="sr-only" />
                </label>
                {profile.avatarPath && (
                  <button type="button" onClick={handleRemoveAvatar} disabled={avatarBusy} className="mc-link pf-remover">
                    {avatarAcao === 'removendo' ? 'Removendo…' : 'Remover foto'}
                  </button>
                )}
              </div>
            </div>
          </section>
          {avatarError && <p role="alert" className="pf-aviso-erro">{avatarError}</p>}

          <section className="pf-secao" aria-labelledby="profile-personal-title">
            <h3 id="profile-personal-title" className="pf-secao-titulo">Dados pessoais</h3>
            <form id="profile-info-form" onSubmit={handleSaveProfile} noValidate className="pf-campos">
              <div className="mc-campo">
                <label htmlFor="profile-name" className="mc-rotulo">Nome completo</label>
                <input id="profile-name" type="text" autoComplete="name" value={name} onChange={(e) => campo(e, setName, setProfileSuccess)} className="mc-entrada" aria-invalid={profileError === 'Informe o nome.' ? 'true' : 'false'} />
              </div>
              <div className="mc-campo">
                <label htmlFor="profile-phone" className="mc-rotulo">Telefone</label>
                <input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => campo(e, setPhone, setProfileSuccess)} className="mc-entrada" />
              </div>
            </form>
          </section>

          <details className="pf-senha">
            <summary>
              <span className="pf-senha-titulo">
                Trocar senha
                <span className="pf-senha-dica">Atualize sua senha de acesso.</span>
              </span>
              <IconeRecolher tamanho={18} className="pf-senha-seta" />
            </summary>
            <form onSubmit={handleChangePassword} className="pf-senha-campos">
              <div className="mc-campo">
                <label htmlFor="current-password" className="mc-rotulo">Senha atual</label>
                <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => campo(e, setCurrentPassword, setPasswordSuccess)} className="mc-entrada" required />
              </div>
              <div className="mc-campo">
                <label htmlFor="new-password" className="mc-rotulo">Nova senha</label>
                <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => campo(e, setNewPassword, setPasswordSuccess)} className="mc-entrada" required />
              </div>
              <div className="mc-campo">
                <label htmlFor="confirm-password" className="mc-rotulo">Confirmar nova senha</label>
                <input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => campo(e, setConfirmPassword, setPasswordSuccess)} className="mc-entrada" required />
              </div>
              {passwordError && <p role="alert" className="pf-aviso-erro">{passwordError}</p>}
              {passwordSuccess && <p role="status" className="pf-aviso-ok">Senha alterada com sucesso.</p>}
              <div className="pf-senha-acao">
                <button type="submit" disabled={submittingPassword} className="mc-botao">{submittingPassword ? 'Trocando…' : 'Trocar senha'}</button>
              </div>
            </form>
          </details>
        </div>

        {/* Fora do corpo que rola: o erro do "Salvar" fica logo acima dele. */}
        {profileError && <p role="alert" className="mc-erro">{profileError}</p>}
        <div className="mc-rodape">
          <p role="status" className="mc-nota pf-salvo">{profileSuccess ? 'Perfil atualizado.' : ''}</p>
          <div className="mc-acoes">
            <button type="button" onClick={fechar} className="mc-botao">Cancelar</button>
            <button type="submit" form="profile-info-form" disabled={savingProfile} className="mc-botao is-principal">{savingProfile ? 'Salvando…' : 'Salvar alterações'}</button>
          </div>
        </div>
      </DialogoClaro>
      {confirmDialog}
    </>
  );
}

export default ProfileModal;
