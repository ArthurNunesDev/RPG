import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Crown, Swords, ArrowRight, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const roles = [
  { id: "gm", title: "Mestre", subtitle: "Conduza a aventura", description: "Crie campanhas, prepare cenários e conduza as sessões com ferramentas de controle.", icon: Crown, tone: "gold", features: ["Gerenciar campanhas e participantes", "Controlar a sessão e seus acontecimentos", "Acessar ferramentas de mestre"] },
  { id: "player", title: "Jogador", subtitle: "Viva a aventura", description: "Crie seus personagens, participe das campanhas e tome decisões dentro do mundo.", icon: Swords, tone: "blue", features: ["Gerenciar suas fichas e inventário", "Participar das sessões", "Interagir com o grupo"] },
  { id: "observer", title: "Observador", subtitle: "Assista à aventura", description: "Acompanhe as sessões como espectador, sem controlar personagens ou interferir.", icon: Eye, tone: "violet", features: ["Assistir às sessões autorizadas", "Acompanhar o que estiver visível", "Sem ações que alterem a campanha"] },
];

export default function RoleSelectionPage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(profile?.preferred_role ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmRole() {
    if (!selected || !user || !supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.from("profiles")
        .update({ preferred_role: selected })
        .eq("id", user.id);
      if (updateError) throw updateError;
      await refreshProfile();
      navigate("/", { replace: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar sua escolha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="role-screen">
      <header className="role-topbar">
        <div className="auth-brand"><span className="auth-brand-mark"><Swords size={23} /></span><span><strong>REALMS</strong><small>YOUR WORLD. YOUR STORY.</small></span></div>
        <button className="auth-text-button" type="button" onClick={async () => { await signOut(); navigate("/auth", { replace: true }); }}>Sair da conta</button>
      </header>
      <section className="role-content">
        <p className="eyebrow">DEFINA SUA JORNADA</p>
        <h1>O que você será?</h1>
        <p className="role-lead">Escolha como deseja começar no REALMS. Essa preferência personaliza seu espaço; o papel e as permissões em cada campanha serão definidos separadamente.</p>
        <div className="role-grid">
          {roles.map(({ id, title, subtitle, description, icon: Icon, tone, features }) => (
            <button type="button" key={id} className={`role-card role-card--${tone} ${selected === id ? "role-card--selected" : ""}`} onClick={() => setSelected(id)} aria-pressed={selected === id}>
              <span className="role-card-icon"><Icon size={25} strokeWidth={1.7} /></span>
              <span className="role-card-title">{title}</span>
              <span className="role-card-subtitle">{subtitle}</span>
              <span className="role-card-description">{description}</span>
              <span className="role-feature-list">{features.map((feature) => <span key={feature}><ShieldCheck size={14} />{feature}</span>)}</span>
              <span className="role-radio" aria-hidden="true">{selected === id ? "✓" : ""}</span>
            </button>
          ))}
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary role-confirm" type="button" onClick={confirmRole} disabled={!selected || busy}>{busy ? "Salvando..." : "Confirmar escolha"} <ArrowRight size={17} /></button>
        <p className="role-footnote">Você poderá alterar essa preferência nas configurações futuramente.</p>
      </section>
    </main>
  );
}
