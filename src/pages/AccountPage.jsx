import { useRef, useState } from "react";
import { Camera, CheckCircle2, Crown, Eye, KeyRound, Mail, Save, ShieldCheck, Swords, Trash2, UserRound } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/account.css";

const roles = [
  { value: "gm", label: "Mestre", icon: Crown },
  { value: "player", label: "Jogador", icon: Swords },
  { value: "observer", label: "Observador", icon: Eye },
];

function getAvatarPath(url) {
  if (!url) return null;
  const marker = "/profile-avatars/";
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length).split("?")[0]) : null;
}

export default function AccountPage() {
  const { user, profile, refreshProfile } = useAuth();
  const fileInput = useRef(null);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [role, setRole] = useState(profile?.preferred_role ?? "player");
  const [email, setEmail] = useState(user?.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    if (!supabase || !user) return;
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalized)) {
      setError("O nome de usuário deve ter de 3 a 24 caracteres: letras minúsculas, números e _.");
      return;
    }
    setBusy("profile"); setError(""); setNotice("");
    try {
      const { error: updateError } = await supabase.from("profiles")
        .update({ username: normalized, preferred_role: role })
        .eq("id", user.id);
      if (updateError) {
        if (updateError.code === "23505") throw new Error("Esse nome de usuário já está em uso.");
        throw updateError;
      }
      await refreshProfile();
      setUsername(normalized);
      setNotice("Dados da conta atualizados.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível atualizar sua conta.");
    } finally { setBusy(""); }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase || !user) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) { setError("Use uma imagem JPG, PNG ou WebP."); return; }
    if (file.size > 2 * 1024 * 1024) { setError("A imagem deve ter no máximo 2 MB."); return; }

    setBusy("avatar"); setError(""); setNotice("");
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    try {
      const { error: uploadError } = await supabase.storage.from("profile-avatars").upload(path, file, {
        cacheControl: "3600", contentType: file.type, upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("profile-avatars").getPublicUrl(path);
      const { error: profileError } = await supabase.from("profiles")
        .update({ avatar_url: data.publicUrl }).eq("id", user.id);
      if (profileError) {
        await supabase.storage.from("profile-avatars").remove([path]);
        throw profileError;
      }
      const oldPath = getAvatarPath(profile?.avatar_url);
      if (oldPath) await supabase.storage.from("profile-avatars").remove([oldPath]);
      await refreshProfile();
      setNotice("Foto de perfil atualizada.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a foto.");
    } finally { setBusy(""); }
  }

  async function removeAvatar() {
    if (!supabase || !user || !profile?.avatar_url) return;
    setBusy("avatar"); setError(""); setNotice("");
    try {
      const oldPath = getAvatarPath(profile.avatar_url);
      const { error: updateError } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
      if (updateError) throw updateError;
      if (oldPath) {
        const { error: removeError } = await supabase.storage.from("profile-avatars").remove([oldPath]);
        if (removeError) throw removeError;
      }
      await refreshProfile();
      setNotice("Foto de perfil removida.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Não foi possível remover a foto.");
    } finally { setBusy(""); }
  }

  async function updateEmail(event) {
    event.preventDefault();
    if (!supabase || !email.trim() || email.trim().toLowerCase() === user?.email?.toLowerCase()) return;
    setBusy("email"); setError(""); setNotice("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: email.trim() });
      if (updateError) throw updateError;
      setNotice("Enviamos uma confirmação para o novo endereço de e-mail.");
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Não foi possível alterar o e-mail.");
    } finally { setBusy(""); }
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 8) { setError("A senha precisa ter pelo menos 8 caracteres."); return; }
    if (newPassword !== confirmPassword) { setError("As senhas não coincidem."); return; }
    setBusy("password"); setError(""); setNotice("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword(""); setConfirmPassword("");
      setNotice("Senha alterada com sucesso.");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Não foi possível alterar a senha.");
    } finally { setBusy(""); }
  }

  return (
    <section className="module-page account-page">
      <div className="module-heading">
        <div className="module-icon"><UserRound size={25} /></div>
        <div><p className="eyebrow">SEU PERFIL</p><h1>Minha conta</h1><p className="page-lead">Gerencie sua identidade e os dados de acesso ao REALMS.</p></div>
      </div>

      {notice && <p className="account-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}
      {error && <p className="account-error" role="alert">{error}</p>}

      <div className="account-grid">
        <section className="panel account-card account-profile-card">
          <div className="account-card-heading"><div><p className="eyebrow">IDENTIDADE</p><h2>Perfil público</h2></div><ShieldCheck size={19} /></div>
          <div className="avatar-editor">
            <div className="avatar-preview">
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="Foto de perfil" /> : <UserRound size={36} />}
            </div>
            <div className="avatar-editor-actions">
              <strong>@{profile?.username ?? "aventureiro"}</strong>
              <span>JPG, PNG ou WebP · até 2 MB</span>
              <div className="avatar-buttons">
                <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy === "avatar"}><Camera size={15} />{busy === "avatar" ? "Enviando..." : "Alterar foto"}</button>
                {profile?.avatar_url && <button className="icon-button" type="button" onClick={removeAvatar} disabled={busy === "avatar"} aria-label="Remover foto"><Trash2 size={15} /></button>}
              </div>
              <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} />
            </div>
          </div>
          <form onSubmit={saveProfile} className="account-form">
            <label className="account-field"><span>Nome de usuário</span><div className="username-input"><span>@</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} minLength={3} maxLength={24} autoComplete="username" required /></div><small>Esse nome será exibido para os outros participantes.</small></label>
            <fieldset className="account-role-field"><legend>Experiência padrão</legend><div className="account-role-options">{roles.map(({ value, label, icon: Icon }) => <button type="button" key={value} className={role === value ? "account-role-option account-role-option--active" : "account-role-option"} onClick={() => setRole(value)} aria-pressed={role === value}><Icon size={16} />{label}</button>)}</div><small>O papel e as permissões em cada campanha continuam sendo definidos pela própria campanha.</small></fieldset>
            <button className="button button-primary" type="submit" disabled={busy === "profile"}><Save size={15} />{busy === "profile" ? "Salvando..." : "Salvar perfil"}</button>
          </form>
        </section>

        <div className="account-security-column">
          <section className="panel account-card">
            <div className="account-card-heading"><div><p className="eyebrow">ACESSO</p><h2>E-mail</h2></div><Mail size={19} /></div>
            <form className="account-form" onSubmit={updateEmail}>
              <label className="account-field"><span>Endereço atual</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
              <small className="account-muted">A alteração só será concluída após a confirmação enviada ao novo endereço.</small>
              <button className="button button-secondary" type="submit" disabled={busy === "email" || email.trim().toLowerCase() === user?.email?.toLowerCase()}><Mail size={15} />{busy === "email" ? "Enviando..." : "Alterar e-mail"}</button>
            </form>
          </section>

          <section className="panel account-card">
            <div className="account-card-heading"><div><p className="eyebrow">SEGURANÇA</p><h2>Senha</h2></div><KeyRound size={19} /></div>
            <form className="account-form" onSubmit={updatePassword}>
              <label className="account-field"><span>Nova senha</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
              <label className="account-field"><span>Confirmar nova senha</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
              <button className="button button-secondary" type="submit" disabled={busy === "password"}><KeyRound size={15} />{busy === "password" ? "Atualizando..." : "Alterar senha"}</button>
            </form>
          </section>
          <p className="account-muted account-email-note">Conta autenticada como <strong>{user?.email}</strong>.</p>
        </div>
      </div>
    </section>
  );
}
