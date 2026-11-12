import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, Eye, LogOut, MessageCircle, Send, Swords, Users } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/session.css";

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function SessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const membership = useMemo(
    () => session?.members?.find((member) => member.userId === user?.id) ?? null,
    [session?.members, user?.id],
  );
  const isObserver = membership?.role === "observer";
  const isGm = membership?.role === "gm";

  const loadSession = useCallback(async () => {
    if (!supabase || !user?.id || !sessionId) {
      setLoading(false);
      setError("Não foi possível carregar esta sessão.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [{ data: sessionData, error: sessionError }, { data: messageData, error: messageError }] = await Promise.all([
        supabase.functions.invoke("realm-sessions", { body: { action: "info", sessionId } }),
        supabase.from("session_messages")
          .select("id, session_id, author_id, content, created_at")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .limit(100),
      ]);
      if (sessionError) throw sessionError;
      if (sessionData?.error) throw new Error(sessionData.error);
      if (messageError) throw messageError;
      setSession(sessionData.session);
      setMessages(messageData ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a sessão.");
    } finally {
      setLoading(false);
    }
  }, [sessionId, user?.id]);

  useEffect(() => { loadSession(); }, [loadSession]);

  useEffect(() => {
    if (!supabase || !user?.id || !sessionId) return undefined;

    let active = true;
    const channel = supabase.channel(`realm-session:${sessionId}`, {
      config: { private: true, presence: { key: user.id } },
    });

    channel
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "session_messages",
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        if (!active) return;
        const next = payload.new;
        setMessages((current) => current.some((message) => message.id === next.id) ? current : [...current, next]);
      })
      .on("presence", { event: "sync" }, () => {
        if (!active) return;
        const entries = Object.values(channel.presenceState()).flat();
        const ids = entries.map((entry) => entry.userId).filter(Boolean);
        setOnlineIds([...new Set(ids)]);
        setSession((current) => {
          if (!current) return current;
          const knownMembers = new Map((current.members ?? []).map((member) => [member.userId, member]));
          for (const entry of entries) {
            if (entry.userId && !knownMembers.has(entry.userId)) {
              knownMembers.set(entry.userId, {
                userId: entry.userId,
                displayName: entry.displayName ?? "Aventureiro",
                role: entry.role === "observer" ? "observer" : "player",
                joinedAt: entry.joinedAt ?? new Date().toISOString(),
              });
            }
          }
          return { ...current, members: [...knownMembers.values()] };
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && active) {
          const trackStatus = await channel.track({
            userId: user.id,
            displayName: profile?.display_name ?? "Aventureiro",
            role: membership?.role ?? (profile?.preferred_role === "observer" ? "observer" : "player"),
            joinedAt: new Date().toISOString(),
          });
          if (trackStatus !== "ok" && active) setError("A conexão em tempo real não foi estabelecida.");
        } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && active) {
          setError("A conexão em tempo real foi interrompida. Atualize a página para reconectar.");
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [sessionId, user?.id, profile?.display_name, profile?.preferred_role, membership?.role]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const memberNames = useMemo(
    () => new Map((session?.members ?? []).map((member) => [member.userId, member.displayName])),
    [session?.members],
  );

  async function handleSend(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || content.length > 2000 || !supabase || !user?.id || isObserver || session?.status !== "active") return;
    setSending(true);
    setError("");
    try {
      const { data, error: sendError } = await supabase.from("session_messages")
        .insert({ session_id: sessionId, author_id: user.id, content })
        .select("id, session_id, author_id, content, created_at")
        .single();
      if (sendError) throw sendError;
      setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data]);
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function handleCopyPin() {
    if (!session?.pin) return;
    try {
      await navigator.clipboard.writeText(session.pin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Não foi possível copiar o PIN neste navegador.");
    }
  }

  async function handleLeaveSession() {
    if (!supabase) return;
    if (!window.confirm("Sair desta mesa? O PIN continuará ativo e você poderá entrar novamente quando quiser.")) return;
    setBusyAction("leave");
    setError("");
    try {
      const { data, error: actionError } = await supabase.functions.invoke("realm-sessions", {
        body: { action: "leave", sessionId },
      });
      if (actionError) throw actionError;
      if (data?.error) throw new Error(data.error);
      navigate("/campaigns", { replace: true });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Não foi possível sair da mesa.");
    } finally {
      setBusyAction("");
    }
  }

  if (loading) return <section className="session-page"><div className="session-loading panel">Carregando mesa...</div></section>;
  if (!session) return <section className="session-page"><Link className="session-back-link" to="/campaigns"><ArrowLeft size={15} /> Voltar às campanhas</Link><div className="session-error panel" role="alert">{error || "Sessão não encontrada."}</div></section>;

  return (
    <section className="session-page">
      <Link className="session-back-link" to="/campaigns"><ArrowLeft size={15} /> Campanhas</Link>
      <header className="session-heading">
        <div className="session-heading-icon"><Swords size={25} /></div>
        <div className="session-heading-copy">
          <p className="eyebrow">MESA VIRTUAL · {session.status === "active" ? "AO VIVO" : "ENCERRADA"}</p>
          <h1>{session.campaignTitle}</h1>
          <p className="page-lead">Mesa permanente da campanha · PIN ativo até a exclusão</p>
        </div>
        <span className={session.status === "active" ? "session-status-pill active" : "session-status-pill"}>{session.status === "active" ? "Em andamento" : "Encerrada"}</span>
      </header>

      {session.pin && session.status === "active" && (
        <div className="session-pin-panel panel">
          <div><span className="eyebrow">PIN PARA CONVIDAR PARTICIPANTES</span><strong>{session.pin}</strong><p>Este PIN permanece válido enquanto a campanha existir.</p></div>
          <button className="button button-secondary" type="button" onClick={handleCopyPin}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copiado" : "Copiar PIN"}</button>
        </div>
      )}

      {error && <p className="session-inline-error" role="alert">{error}</p>}

      <div className="session-layout">
        <section className="session-chat panel" aria-label="Chat da sessão">
          <div className="session-panel-heading"><div><span className="eyebrow">COMUNICAÇÃO DO GRUPO</span><h2><MessageCircle size={18} /> Chat da sessão</h2></div><span className="session-message-count">{messages.length} mensagens</span></div>
          <div className="session-messages" aria-live="polite">
            {messages.length ? messages.map((message) => {
              const mine = message.author_id === user?.id;
              return <article className={mine ? "session-message mine" : "session-message"} key={message.id}>
                <div className="session-message-meta"><strong>{mine ? "Você" : memberNames.get(message.author_id) ?? "Aventureiro"}</strong><time dateTime={message.created_at}>{formatTime(message.created_at)}</time></div>
                <p>{message.content}</p>
              </article>;
            }) : <div className="session-chat-empty"><MessageCircle size={25} /><p>O chat está vazio. Comece a conversa com seu grupo.</p></div>}
            <div ref={bottomRef} />
          </div>
          {isObserver ? <div className="session-readonly-note"><Eye size={15} /> Você está acompanhando como observador e não pode enviar mensagens.</div>
            : session.status === "active" ? <form className="session-compose" onSubmit={handleSend}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Escreva uma mensagem..." aria-label="Mensagem" /><button className="button button-primary" type="submit" disabled={sending || !draft.trim()} aria-label="Enviar mensagem">{sending ? "..." : <Send size={16} />}</button></form>
              : <div className="session-readonly-note">Esta sessão foi encerrada. O histórico continua disponível.</div>}
        </section>

        <aside className="session-sidebar">
          <section className="session-members panel">
            <div className="session-panel-heading"><div><span className="eyebrow">AVENTUREIROS</span><h2><Users size={18} /> Participantes</h2></div><span className="session-message-count">{session.members?.length ?? 0}</span></div>
            <ul>{(session.members ?? []).map((member) => <li key={member.userId}><span className="session-member-avatar">{member.displayName?.trim()?.charAt(0)?.toUpperCase() || "?"}</span><span className="session-member-copy"><strong>{member.displayName}</strong><small>{member.role === "gm" ? "Mestre" : member.role === "observer" ? "Observador" : "Jogador"}</small></span>{onlineIds.includes(member.userId) && <span className="session-online-dot" title="Online" />}</li>)}</ul>
            <p className="session-presence-caption">{onlineIds.length} online agora</p>
          </section>

          <section className="session-controls panel">
            <span className="eyebrow">CONTROLES DA SESSÃO</span>
            <p>{isGm ? "Você está conduzindo esta sessão." : isObserver ? "Você está assistindo à aventura." : "Você está participando desta aventura."}</p>
            
            {session.status === "active" && <button className="session-leave-button" type="button" onClick={handleLeaveSession}} disabled={Boolean(busyAction)}><LogOut size={15} />{busyAction === "leave" ? "Saindo..." : "Sair da sessão"}</button>}
            {session.status === "ended" && <Link className="button button-secondary session-back-button" to="/campaigns">Voltar às campanhas</Link>}
          </section>
        </aside>
      </div>
    </section>
  );
}
