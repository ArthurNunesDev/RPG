import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck, Swords } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import "../styles/tabletop.css";

export default function TabletopPage() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  async function handleJoin(event) {
    event.preventDefault();
    const normalizedPin = pin.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalizedPin) || !/[A-Z]/.test(normalizedPin) || !/[0-9]/.test(normalizedPin)) {
      setError("Digite o PIN de 8 letras e números.");
      return;
    }
    if (!supabase) {
      setError("O serviço de sessões não está configurado.");
      return;
    }

    setJoining(true);
    setError("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("realm-sessions", {
        body: { action: "join", pin: normalizedPin },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      if (!data?.session?.id) throw new Error("Não foi possível abrir a sessão.");
      navigate(`/tabletop/${data.session.id}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Não foi possível entrar na sessão.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <section className="tabletop-page">
      <div className="tabletop-hero">
        <div className="tabletop-hero-icon"><Swords size={30} /></div>
        <p className="eyebrow">SUA MESA DE RPG</p>
        <h1>Entre na aventura.</h1>
        <p>Digite o PIN compartilhado pelo mestre para entrar na sessão da campanha.</p>
      </div>
      <form className="tabletop-join panel" onSubmit={handleJoin}>
        <div className="tabletop-join-icon"><KeyRound size={22} /></div>
        <h2>Entrar com PIN</h2>
        <p>O código tem 8 caracteres, combinando letras e números.</p>
        <label htmlFor="session-pin">PIN da sessão</label>
        <input
          id="session-pin"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          maxLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())}
          placeholder="EX: A7K9P2Q4"
          aria-describedby={error ? "session-pin-error" : "session-pin-hint"}
        />
        <span className="tabletop-hint" id="session-pin-hint"><ShieldCheck size={13} /> Apenas quem possui o PIN pode entrar.</span>
        {error && <p className="tabletop-error" id="session-pin-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit" disabled={joining || pin.length !== 8}>{joining ? "Verificando PIN..." : "Entrar na sessão"}</button>
      </form>
    </section>
  );
}
