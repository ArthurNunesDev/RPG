import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, Copy, UserPlus, Users, X, Search, ShieldCheck, Wifi, WifiOff, Moon } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/friends.css";

function statusLabel(status) {
  if (status === "online") return "Online";
  if (status === "inactive") return "Inativo";
  return "Offline";
}
function statusIcon(status) {
  if (status === "online") return <Wifi size={13} />;
  if (status === "inactive") return <Moon size={13} />;
  return <WifiOff size={13} />;
}
function presenceFor(record) {
  if (!record) return "offline";
  const lastSeen = new Date(record.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60_000) return "offline";
  return record.status;
}
function timeAgo(value) {
  if (!value) return "Nunca esteve online";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Visto agora";
  if (minutes < 60) return `Visto há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Visto há ${hours} h`;
  return `Visto há ${Math.floor(hours / 24)} dias`;
}

export default function FriendsPage() {
  const { user } = useAuth();
  const [friendCode, setFriendCode] = useState("");
  const [lookup, setLookup] = useState("");
  const [friendships, setFriendships] = useState([]);
  const [presence, setPresence] = useState({});
  const [ownCode, setOwnCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !user?.id) return;
    setLoading(true); setError("");
    try {
      const [profileResult, friendResult] = await Promise.all([
        supabase.from("profiles").select("friend_code").eq("id", user.id).single(),
        supabase.from("friendships").select("id, requester_id, addressee_id, status, created_at, requester:profiles!friendships_requester_id_fkey(id, username, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url)").order("created_at", { ascending: false }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (friendResult.error) throw friendResult.error;
      setOwnCode(profileResult.data.friend_code);
      setFriendships(friendResult.data ?? []);
      const ids = [...new Set((friendResult.data ?? []).flatMap((item) => [item.requester_id, item.addressee_id]).filter((id) => id !== user.id))];
      if (ids.length) {
        const { data, error: presenceError } = await supabase.from("user_presence").select("user_id,status,last_seen_at").in("user_id", ids);
        if (presenceError) throw presenceError;
        setPresence(Object.fromEntries((data ?? []).map((item) => [item.user_id, item])));
      } else setPresence({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar seus amigos.");
    } finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    let alive = true;
    const channel = supabase.channel(`friends-presence:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, (payload) => {
        if (!alive || !payload.new?.user_id) return;
        setPresence((current) => ({ ...current, [payload.new.user_id]: payload.new }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => { if (alive) load(); })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [user?.id, load]);

  async function sendRequest(event) {
    event.preventDefault();
    const code = friendCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) { setError("Digite um ID de amigo válido com 8 caracteres."); return; }
    setSubmitting(true); setError(""); setNotice("");
    try {
      const { data: target, error: lookupError } = await supabase.from("profiles").select("id").eq("friend_code", code).maybeSingle();
      if (lookupError) throw lookupError;
      if (!target) throw new Error("Nenhuma conta foi encontrada com esse ID.");
      if (target.id === user.id) throw new Error("Você não pode adicionar a si mesmo.");
      const already = friendships.find((item) => [item.requester_id,item.addressee_id].includes(target.id));
      if (already) throw new Error("Já existe uma solicitação ou amizade com essa conta.");
      const { error: insertError } = await supabase.from("friendships").insert({ requester_id: user.id, addressee_id: target.id });
      if (insertError) throw insertError;
      setFriendCode(""); setNotice("Solicitação enviada."); await load();
    } catch (sendError) { setError(sendError instanceof Error ? sendError.message : "Não foi possível enviar a solicitação."); }
    finally { setSubmitting(false); }
  }

  async function respondRequest(item, status) {
    setError(""); setNotice("");
    const { error: updateError } = await supabase.from("friendships").update({ status, updated_at: new Date().toISOString() }).eq("id", item.id).eq("addressee_id", user.id);
    if (updateError) setError(updateError.message);
    else { setNotice(status === "accepted" ? "Amizade adicionada." : "Solicitação recusada."); await load(); }
  }

  async function removeFriend(item) {
    const other = item.requester_id === user.id ? item.addressee : item.requester;
    if (!window.confirm(`Remover @${other?.username ?? "usuário"} dos amigos?`)) return;
    const { error: deleteError } = await supabase.from("friendships").delete().eq("id", item.id);
    if (deleteError) setError(deleteError.message); else { setNotice("Amizade removida."); await load(); }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(ownCode); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { setError("Não foi possível copiar seu ID."); }
  }

  const incoming = friendships.filter((item) => item.status === "pending" && item.addressee_id === user?.id);
  const outgoing = friendships.filter((item) => item.status === "pending" && item.requester_id === user?.id);
  const friends = friendships.filter((item) => item.status === "accepted");
  const filtered = friends.filter((item) => {
    const person = item.requester_id === user?.id ? item.addressee : item.requester;
    return !lookup || (person?.username ?? "").toLowerCase().includes(lookup.toLowerCase());
  });
  const sorted = [...filtered].sort((a,b) => {
    const personA = a.requester_id === user?.id ? a.addressee_id : a.requester_id;
    const personB = b.requester_id === user?.id ? b.addressee_id : b.requester_id;
    const order = { online: 0, inactive: 1, offline: 2 };
    return order[presenceFor(presence[personA])] - order[presenceFor(presence[personB])];
  });

  return <section className="friends-page">
    <header className="friends-heading"><div className="friends-heading-icon"><Users size={26}/></div><div><p className="eyebrow">SUA COMUNIDADE</p><h1>Amigos</h1><p className="page-lead">Encontre seus companheiros de aventura pelo ID e acompanhe a presença deles.</p></div></header>
    <section className="friends-id-card panel"><div><p className="eyebrow">SEU ID DE AMIGO</p><strong>{ownCode || "--------"}</strong><span>Compartilhe esse código para receber solicitações.</span></div><button className="button button-secondary" type="button" onClick={copyCode} disabled={!ownCode}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? "Copiado" : "Copiar ID"}</button></section>
    <form className="friends-add panel" onSubmit={sendRequest}><div className="friends-add-copy"><UserPlus size={19}/><div><strong>Adicionar amigo</strong><span>Digite o ID de 8 caracteres da outra pessoa.</span></div></div><input value={friendCode} onChange={(event) => setFriendCode(event.target.value.replace(/[^a-z0-9]/gi,"").toUpperCase())} maxLength={8} placeholder="ID DO AMIGO" aria-label="ID do amigo"/><button className="button button-primary" type="submit" disabled={submitting || friendCode.length !== 8}>{submitting ? "Enviando..." : "Enviar solicitação"}</button></form>
    {notice && <p className="friends-notice" role="status">{notice}</p>}{error && <p className="friends-error" role="alert">{error}</p>}
    {incoming.length > 0 && <section className="friends-section"><div className="friends-section-heading"><h2>Solicitações recebidas</h2><span>{incoming.length}</span></div>{incoming.map((item) => <div className="friend-row panel" key={item.id}><div className="friend-avatar">{item.requester?.username?.[0]?.toUpperCase() ?? "?"}</div><div className="friend-copy"><strong>@{item.requester?.username ?? "aventureiro"}</strong><small>Quer adicionar você</small></div><button className="button button-primary" onClick={() => respondRequest(item,"accepted")}><Check size={14}/> Aceitar</button><button className="icon-button" aria-label="Recusar solicitação" onClick={() => respondRequest(item,"declined")}><X size={15}/></button></div>)}</section>}
    {outgoing.length > 0 && <section className="friends-section"><div className="friends-section-heading"><h2>Solicitações enviadas</h2><span>{outgoing.length}</span></div>{outgoing.map((item) => <div className="friend-row panel" key={item.id}><div className="friend-avatar">{item.addressee?.username?.[0]?.toUpperCase() ?? "?"}</div><div className="friend-copy"><strong>@{item.addressee?.username ?? "aventureiro"}</strong><small>Aguardando resposta</small></div><Clock3 size={15}/></div>)}</section>}
    <section className="friends-section"><div className="friends-section-heading"><h2>Meus amigos</h2><span>{friends.length}</span></div><div className="friends-toolbar"><label><Search size={15}/><input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Buscar amigos..." aria-label="Buscar amigos"/></label></div>
      {loading ? <div className="friends-empty panel">Carregando amigos...</div> : sorted.length ? <div className="friends-list">{sorted.map((item) => {
        const isRequester = item.requester_id === user.id; const person = isRequester ? item.addressee : item.requester; const id = isRequester ? item.addressee_id : item.requester_id; const record = presence[id]; const status = presenceFor(record);
        return <article className="friend-row panel" key={item.id}><div className="friend-avatar">{person?.username?.[0]?.toUpperCase() ?? "?"}</div><div className="friend-copy"><strong>@{person?.username ?? "aventureiro"}</strong><small>{statusIcon(status)} <span className={`friend-status friend-status--${status}`}>{statusLabel(status)}</span> · {status === "offline" ? timeAgo(record?.last_seen_at) : status === "inactive" ? "Sem atividade recente" : "Ativo agora"}</small></div><button className="icon-button friend-remove" type="button" aria-label={`Remover @${person?.username ?? "amigo"}`} onClick={() => removeFriend(item)}><X size={15}/></button></article>;
      })}</div> : <div className="friends-empty panel"><Users size={24}/><strong>{lookup ? "Nenhum amigo encontrado" : "Sua lista ainda está vazia"}</strong><span>Adicione alguém usando o ID de amigo.</span></div>}
    </section>
  </section>;
}
