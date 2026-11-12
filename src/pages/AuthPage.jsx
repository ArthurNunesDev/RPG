import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, Swords, UserRound } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

function readableError(message = "") {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(message)) return "Este e-mail já possui uma conta.";
  if (/password should be at least/i.test(message)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar.";
  return message || "Não foi possível concluir a operação.";
}

export default function AuthPage() {
  const { configured } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!supabase || !configured) {
      setError("Configure as variáveis do Supabase no arquivo .env.local.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (authError) throw authError;
        if (data.session) navigate("/choose-role", { replace: true });
        else setNotice("Conta criada. Verifique seu e-mail para confirmar o cadastro e depois entre.");
      } else if (mode === "reset") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + "/auth",
        });
        if (authError) throw authError;
        setNotice("Se o endereço estiver cadastrado, você receberá um e-mail com as instruções de recuperação.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        const destination = location.state?.from?.pathname || "/";
        navigate(destination === "/auth" ? "/" : destination, { replace: true });
      }
    } catch (authError) {
      setError(readableError(authError instanceof Error ? authError.message : ""));
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";
  const isReset = mode === "reset";

  return (
    <main className="auth-screen">
      <div className="auth-backdrop" aria-hidden="true" />
      <section className="auth-card">
        <Link to="/" className="auth-brand" aria-label="REALMS">
          <span className="auth-brand-mark"><Swords size={25} /></span>
          <span><strong>REALMS</strong><small>YOUR WORLD. YOUR STORY.</small></span>
        </Link>
        <div className="auth-heading">
          <p className="eyebrow">{isReset ? "RECUPERAR ACESSO" : isSignup ? "SUA JORNADA COMEÇA" : "BEM-VINDO DE VOLTA"}</p>
          <h1>{isReset ? "Recupere sua senha" : isSignup ? "Crie sua conta" : "Entre no seu reino"}</h1>
          <p>{isReset ? "Informe seu e-mail para receber as instruções." : isSignup ? "Prepare-se para construir histórias memoráveis." : "A próxima aventura está esperando por você."}</p>
        </div>

        {!configured && <p className="auth-alert" role="alert">Supabase não configurado. Copie .env.example para .env.local e reinicie o Vite.</p>}
        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup && (
            <label className="auth-field">
              <span>Nome de exibição</span>
              <span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required placeholder="Como quer ser chamado?" /></span>
            </label>
          )}
          <label className="auth-field">
            <span>E-mail</span>
            <span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@exemplo.com" /></span>
          </label>
          {!isReset && (
            <label className="auth-field">
              <span>Senha</span>
              <span className="auth-input-wrap"><KeyRound size={17} /><input type={showPassword ? "text" : "password"} autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required placeholder="Mínimo de 6 caracteres" /><button className="auth-visibility" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            </label>
          )}
          {mode === "login" && <button className="auth-text-button auth-forgot" type="button" onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Esqueci minha senha</button>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy || !configured}>
            {busy ? "Aguarde..." : isReset ? "Enviar instruções" : isSignup ? "Criar conta" : "Entrar"}
          </button>
        </form>

        <div className="auth-switch">
          {isReset ? <button type="button" className="auth-text-button" onClick={() => setMode("login")}><ArrowLeft size={14} /> Voltar para o login</button> : isSignup ? <>Já possui uma conta? <button type="button" className="auth-text-button" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>Entrar</button></> : <>Ainda não tem uma conta? <button type="button" className="auth-text-button" onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>Criar conta</button></>}
        </div>
      </section>
      <p className="auth-footnote">UM UNIVERSO DE POSSIBILIDADES</p>
    </main>
  );
}
