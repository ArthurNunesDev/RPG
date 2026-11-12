import { useEffect, useState } from "react";
import { AudioLines, CheckCircle2, Dice5, Monitor, Save, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/settings.css";

const defaults = { soundEffects: false, animations: true, compactMode: false, defaultDie: 20 };

export default function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [preferences, setPreferences] = useState({ ...defaults, ...(profile?.preferences ?? {}) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setPreferences({ ...defaults, ...(profile?.preferences ?? {}) });
  }, [profile?.preferences]);

  function updatePreference(key, value) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!supabase || !user) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { error: updateError } = await supabase.from("profiles")
        .update({ preferences }).eq("id", user.id);
      if (updateError) throw updateError;
      await refreshProfile();
      setNotice("Preferências salvas.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar as configurações.");
    } finally { setSaving(false); }
  }

  return (
    <section className="module-page settings-page">
      <div className="module-heading">
        <div className="module-icon"><Monitor size={25} /></div>
        <div><p className="eyebrow">PREFERÊNCIAS DO APLICATIVO</p><h1>Configurações</h1><p className="page-lead">Ajuste a interface e os comportamentos padrão da sua experiência.</p></div>
      </div>

      {notice && <p className="settings-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}

      <form onSubmit={saveSettings} className="settings-sections">
        <section className="panel settings-card">
          <div className="settings-card-heading"><div className="settings-icon"><Sparkles size={19} /></div><div><h2>Aparência e interface</h2><p>Controle o movimento e a densidade dos elementos.</p></div></div>
          <label className="setting-row"><span><strong>Animações</strong><small>Ativa transições e efeitos visuais da interface e dos dados.</small></span><input type="checkbox" checked={preferences.animations} onChange={(event) => updatePreference("animations", event.target.checked)} /></label>
          <label className="setting-row"><span><strong>Interface compacta</strong><small>Reduz espaçamentos para exibir mais conteúdo na tela.</small></span><input type="checkbox" checked={preferences.compactMode} onChange={(event) => updatePreference("compactMode", event.target.checked)} /></label>
        </section>

        <section className="panel settings-card">
          <div className="settings-card-heading"><div className="settings-icon"><AudioLines size={19} /></div><div><h2>Áudio</h2><p>Preferências de efeitos sonoros do REALMS.</p></div></div>
          <label className="setting-row"><span><strong>Efeitos sonoros</strong><small>Permite sons de interação e rolagem quando disponíveis.</small></span><input type="checkbox" checked={preferences.soundEffects} onChange={(event) => updatePreference("soundEffects", event.target.checked)} /></label>
          <p className="settings-hint">Os efeitos sonoros serão usados apenas nas interações que oferecerem áudio.</p>
        </section>

        <section className="panel settings-card">
          <div className="settings-card-heading"><div className="settings-icon"><Dice5 size={19} /></div><div><h2>Rolagem de dados</h2><p>Defina o dado selecionado ao abrir a ferramenta.</p></div></div>
          <label className="setting-select"><span>Dado padrão</span><select value={preferences.defaultDie} onChange={(event) => updatePreference("defaultDie", Number(event.target.value))}>{[4,6,8,10,12,20,100].map((die) => <option value={die} key={die}>d{die}</option>)}</select></label>
        </section>

        <div className="settings-actions"><button className="button button-primary" type="submit" disabled={saving}><Save size={15} />{saving ? "Salvando..." : "Salvar configurações"}</button></div>
      </form>
    </section>
  );
}
