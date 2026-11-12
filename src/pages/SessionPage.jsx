import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BookOpen, Check, Copy, Dice5, Eye, ImagePlus, LogOut,
  Map, Menu, MessageCircle, Send, Shield, Swords, Trash2,
  UserRound, Users, X,
} from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import PresenceTracker from "../components/PresenceTracker.jsx";
import DicePage from "./DicePage.jsx";
import "../styles/session.css";

const MAX_MAP_SIZE = 15 * 1024 * 1024;
const ALLOWED_MAP_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function SessionMapCard({ item, isGm, onVisibility, onDelete }) {
  const [url, setUrl] = useState("");
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    let active = true;
    supabase.storage.from("campaign-assets").createSignedUrl(item.storage_path, 3600)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setImageError("Não foi possível carregar este mapa.");
        else setUrl(data?.signedUrl ?? "");
      })
      .catch(() => {
        if (active) setImageError("Não foi possível carregar este mapa.");
      });
    return () => { active = false; };
  }, [item.storage_path]);

  return (
    <article className="panel room-map-card">
      {url ? <a className="room-map-image" href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={"Mapa: " + item.title} loading="lazy" />
        <span><Eye size={14} /> Abrir imagem</span>
      </a> : <div className="room-map-image room-map-image--empty">{imageError || "Carregando mapa..."}</div>}
      <div className="room-map-card-body">
        <div><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div>
        {isGm && <div className="room-map-actions">
          <button className="button button-secondary" type="button" onClick={onVisibility}>
            <Eye size={14} /> {item.is_visible ? "Ocultar" : "Disponibilizar"}
          </button>
          <button className="icon-button" type="button" onClick={onDelete} aria-label={"Excluir mapa " + item.title} title="Excluir mapa">
            <Trash2 size={15} />
          </button>
        </div>}
      </div>
    </article>
  );
}

function CharacterEditDialog({ character, saving, error, onClose, onSave, onChange }) {
  if (!character) return null;
  return (
    <div className="room-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <form className="panel room-character-dialog" role="dialog" aria-modal="true" aria-labelledby="room-character-title" onSubmit={onSave}>
        <div className="room-dialog-heading">
          <div><span className="eyebrow">FICHA DA CAMPANHA</span><h2 id="room-character-title">Editar personagem</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Fechar"><X size={17} /></button>
        </div>
        <label className="room-field"><span>Nome</span><input value={character.name} onChange={(event) => onChange("name", event.target.value)} maxLength={80} required /></label>
        <label className="room-field"><span>Descrição / conceito</span><textarea value={character.concept} onChange={(event) => onChange("concept", event.target.value)} maxLength={1000} rows={4} /></label>
        {character.character_type === "npc" && <label className="room-field"><span>Tipo de NPC</span><select value={character.npc_role || "neutral"} onChange={(event) => onChange("npc_role", event.target.value)}><option value="ally">Aliado</option><option value="enemy">Inimigo</option><option value="neutral">Neutro</option></select></label>}
        <label className="room-field"><span>Status</span><select value={character.status} onChange={(event) => onChange("status", event.target.value)}><option value="active">Ativo</option><option value="retired">Aposentado</option><option value="deceased">Morto</option></select></label>
        {error && <p className="room-error" role="alert">{error}</p>}
        <div className="room-dialog-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</button></div>
      </form>
    </div>
  );
}

const sections = [
  { id: "overview", label: "Visão geral", icon: BookOpen },
  { id: "maps", label: "Mapas", icon: Map },
  { id: "characters", label: "Personagens", icon: UserRound },
  { id: "dice", label: "Rolagem de dados", icon: Dice5 },
  { id: "chat", label: "Chat da sessão", icon: MessageCircle },
  { id: "members", label: "Participantes", icon: Users },
];

export default function SessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [session, setSession] = useState(null);
  const [campaignId, setCampaignId] = useState("");
  const [maps, setMaps] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [messages, setMessages] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]);
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [mapTitle, setMapTitle] = useState("");
  const [mapDescription, setMapDescription] = useState("");
  const [mapFile, setMapFile] = useState(null);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [characterError, setCharacterError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingMap, setUploadingMap] = useState(false);
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const bottomRef = useRef(null);

  const membership = useMemo(
    () => session?.members?.find((member) => member.userId === user?.id) ?? null,
    [session?.members, user?.id],
  );
  const isGm = membership?.role === "gm";
  const isObserver = membership?.role === "observer";
  const memberNames = useMemo(
    () => new Map((session?.members ?? []).map((member) => [member.userId, member.displayName])),
    [session?.members],
  );
  const visibleMaps = maps.filter((item) => isGm || item.is_visible);

  const loadSession = useCallback(async (silent = false) => {
    if (!supabase || !user?.id || !sessionId) {
      if (!silent) setLoading(false);
      setError("Não foi possível carregar esta sessão.");
      return;
    }
    if (!silent) {
      setLoading(true);
      setError("");
    }
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
      const currentSession = sessionData?.session;
      if (!currentSession) throw new Error("Sessão não encontrada.");
      const currentCampaignId = currentSession.campaignId || currentSession.campaign_id || "";
      setSession(currentSession);
      setCampaignId(currentCampaignId);
      setMessages(messageData ?? []);

      if (currentCampaignId) {
        const [mapResult, characterResult] = await Promise.all([
          supabase.from("campaign_maps")
            .select("id, campaign_id, title, description, storage_path, is_visible, sort_order, created_at")
            .eq("campaign_id", currentCampaignId)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true }),
          supabase.from("characters")
            .select("id, owner_id, campaign_id, game_system_id, name, concept, character_type, npc_role, status, avatar_url, sheet, created_at, updated_at")
            .eq("campaign_id", currentCampaignId)
            .order("updated_at", { ascending: false }),
        ]);
        if (mapResult.error) throw mapResult.error;
        if (characterResult.error) throw characterResult.error;
        setMaps(mapResult.data ?? []);
        setCharacters(characterResult.data ?? []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a sessão.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sessionId, user?.id]);

  useEffect(() => { loadSession(false); }, [loadSession]);

  useEffect(() => {
    if (!supabase || !campaignId) return undefined;
    const channel = supabase.channel("room-resources:" + campaignId)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_maps", filter: "campaign_id=eq." + campaignId }, () => loadSession(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "characters", filter: "campaign_id=eq." + campaignId }, () => loadSession(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [campaignId, loadSession]);

  useEffect(() => {
    if (!supabase || !user?.id || !sessionId) return undefined;
    let active = true;
    const channel = supabase.channel("realm-session:" + sessionId, {
      config: { private: true, presence: { key: user.id } },
    });
    channel
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "session_messages", filter: "session_id=eq." + sessionId,
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
                displayName: entry.displayName || "Aventureiro",
                role: entry.role === "observer" ? "observer" : "player",
                joinedAt: entry.joinedAt || new Date().toISOString(),
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
            displayName: profile?.username ? "@" + profile.username : "Aventureiro",
            role: membership?.role || (profile?.preferred_role === "observer" ? "observer" : "player"),
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
  }, [sessionId, user?.id, profile?.username, profile?.preferred_role, membership?.role]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function handleSend(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || content.length > 2000 || !supabase || !user?.id || isObserver || session?.status !== "active" || sending) return;
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
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Não foi possível copiar o PIN neste navegador.");
    }
  }

  async function handleLeaveSession() {
    if (!supabase || busyAction) return;
    if (!window.confirm("Sair desta mesa? O PIN continuará ativo e você poderá entrar novamente quando quiser.")) return;
    setBusyAction("leave");
    setError("");
    try {
      const { data, error: actionError } = await supabase.functions.invoke("realm-sessions", { body: { action: "leave", sessionId } });
      if (actionError) throw actionError;
      if (data?.error) throw new Error(data.error);
      navigate("/campaigns", { replace: true });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Não foi possível sair da mesa.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleUploadMap(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!supabase || !campaignId || !user?.id || !isGm || uploadingMap) return;
    const title = mapTitle.trim();
    if (!title || title.length > 100 || !mapFile) {
      setError("Informe um nome e selecione a imagem do mapa.");
      return;
    }
    if (!ALLOWED_MAP_TYPES.includes(mapFile.type) || mapFile.size > MAX_MAP_SIZE) {
      setError("Use JPG, PNG, WebP ou GIF com até 15 MB.");
      return;
    }
    setUploadingMap(true);
    setError("");
    setNotice("");
    const safeName = mapFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = campaignId + "/maps/" + crypto.randomUUID() + "-" + safeName;
    try {
      const { error: uploadError } = await supabase.storage.from("campaign-assets")
        .upload(storagePath, mapFile, { contentType: mapFile.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("campaign_maps").insert({
        campaign_id: campaignId,
        created_by: user.id,
        title,
        description: mapDescription.trim(),
        storage_path: storagePath,
      });
      if (insertError) {
        await supabase.storage.from("campaign-assets").remove([storagePath]);
        throw insertError;
      }
      setMapTitle("");
      setMapDescription("");
      setMapFile(null);
      formElement.reset();
      setNotice("Mapa adicionado à sala da sessão.");
      await loadSession(true);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível adicionar o mapa.");
    } finally {
      setUploadingMap(false);
    }
  }

  async function handleMapVisibility(item) {
    if (!supabase || !isGm || !campaignId) return;
    setError("");
    if (item.is_visible) {
      const { error: hideError } = await supabase.from("campaign_maps")
        .update({ is_visible: false }).eq("id", item.id).eq("campaign_id", campaignId);
      if (hideError) setError(hideError.message);
      else await loadSession(true);
      return;
    }

    const { error: hideOthersError } = await supabase.from("campaign_maps")
      .update({ is_visible: false }).eq("campaign_id", campaignId);
    if (hideOthersError) {
      setError(hideOthersError.message);
      return;
    }
    const { error: showError } = await supabase.from("campaign_maps")
      .update({ is_visible: true }).eq("id", item.id).eq("campaign_id", campaignId);
    if (showError) setError(showError.message);
    await loadSession(true);
  }

  async function handleDeleteMap(item) {
    if (!supabase || !isGm) return;
    if (!window.confirm('Excluir o mapa "' + item.title + '" da campanha?')) return;
    const { error: deleteError } = await supabase.from("campaign_maps")
      .delete().eq("id", item.id).eq("campaign_id", campaignId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    const { error: storageError } = await supabase.storage.from("campaign-assets").remove([item.storage_path]);
    if (storageError) setError("O mapa foi removido, mas o arquivo não pôde ser excluído: " + storageError.message);
    else setNotice("Mapa removido.");
    await loadSession(true);
  }

  function openCharacterEditor(character) {
    if (isObserver || (!isGm && character.owner_id !== user?.id)) return;
    setCharacterError("");
    setEditingCharacter({ ...character });
  }

  function changeCharacter(field, value) {
    setEditingCharacter((current) => current ? { ...current, [field]: value } : current);
  }

  async function handleSaveCharacter(event) {
    event.preventDefault();
    if (!supabase || !editingCharacter || savingCharacter) return;
    const name = editingCharacter.name.trim();
    const concept = editingCharacter.concept.trim();
    if (!name || name.length > 80 || concept.length > 1000) {
      setCharacterError("Confira o nome e a descrição do personagem.");
      return;
    }
    setSavingCharacter(true);
    setCharacterError("");
    try {
      const payload = {
        name,
        concept,
        status: editingCharacter.status,
        npc_role: editingCharacter.character_type === "npc" ? editingCharacter.npc_role : null,
      };
      const { error: updateError } = await supabase.from("characters").update(payload)
        .eq("id", editingCharacter.id).eq("campaign_id", campaignId);
      if (updateError) throw updateError;
      setEditingCharacter(null);
      setNotice("Ficha de personagem atualizada.");
      await loadSession(true);
    } catch (saveError) {
      setCharacterError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a ficha.");
    } finally {
      setSavingCharacter(false);
    }
  }

  function selectSection(sectionId) {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    setError("");
    setNotice("");
  }

  if (loading) return <main className="session-room"><div className="room-loading panel">Preparando a sala da sessão...</div></main>;
  if (!session) return <main className="session-room"><div className="room-unavailable panel"><Swords size={25} /><h1>Sessão indisponível</h1><p>{error || "Não foi possível encontrar esta sessão."}</p><Link className="button button-secondary" to="/campaigns"><ArrowLeft size={15} /> Voltar às campanhas</Link></div></main>;

  const currentSection = sections.find((section) => section.id === activeSection) || sections[0];

  return (
    <main className="session-room">
      <PresenceTracker />
      {mobileMenuOpen && <button className="room-sidebar-backdrop" type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={"room-sidebar" + (mobileMenuOpen ? " room-sidebar--open" : "")}>
        <div className="room-brand">
          <Link to="/campaigns" className="room-brand-mark" aria-label="Voltar às campanhas"><Swords size={21} /></Link>
          <div><strong>REALMS</strong><span>SALA DE AVENTURA</span></div>
          <button className="icon-button room-mobile-close" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu"><X size={17} /></button>
        </div>
        <div className="room-campaign-identity">
          <span className="eyebrow">CAMPANHA ATUAL</span>
          <strong>{session.campaignTitle || "Aventura"}</strong>
          <span className="room-role-tag">{isGm ? "Mestre" : isObserver ? "Observador" : "Jogador"}</span>
        </div>
        <nav className="room-navigation" aria-label="Seções da sala">
          <span className="room-nav-caption">MESA DE JOGO</span>
          {sections.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} className={"room-nav-item" + (activeSection === id ? " active" : "")} onClick={() => selectSection(id)} aria-current={activeSection === id ? "page" : undefined}>
              <Icon size={17} /><span>{label}</span>{id === "chat" && messages.length > 0 && <small>{messages.length}</small>}
            </button>
          ))}
        </nav>
        <div className="room-sidebar-bottom">
          <div className="room-online-summary"><span className="room-online-indicator" />{onlineIds.length} online agora</div>
          <button className="room-leave-button" type="button" onClick={handleLeaveSession} disabled={Boolean(busyAction)}>
            <LogOut size={15} />{busyAction === "leave" ? "Saindo..." : "Sair da sessão"}
          </button>
          <Link to={"/campaigns/" + (campaignId || "")} className="room-back-campaign"><ArrowLeft size={14} /> Voltar à campanha</Link>
        </div>
      </aside>

      <section className="room-main">
        <header className="room-topbar">
          <div className="room-topbar-title">
            <button className="icon-button room-mobile-menu" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu"><Menu size={19} /></button>
            <div><span className="eyebrow">MESA VIRTUAL · {session.status === "active" ? "AO VIVO" : "ENCERRADA"}</span><h1>{currentSection.label}</h1></div>
          </div>
          <div className="room-topbar-meta">
            <span className={session.status === "active" ? "room-status active" : "room-status"}><i />{session.status === "active" ? "Sessão ativa" : "Sessão encerrada"}</span>
            {session.pin && <button className="room-pin-button" type="button" onClick={handleCopyPin}><span>PIN <strong>{session.pin}</strong></span>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}
            <span className="room-user-chip"><span>{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : (profile?.username?.charAt(0)?.toUpperCase() || "A")}</span>@{profile?.username || "aventureiro"}</span>
          </div>
        </header>

        <div className="room-content">
          {error && <p className="room-feedback error" role="alert">{error}</p>}
          {notice && <p className="room-feedback success" role="status">{notice}</p>}

          {activeSection === "overview" && <section className="room-overview">
            <div className="room-welcome panel">
              <div><span className="eyebrow">SUA AVENTURA ACONTECE AQUI</span><h2>{session.campaignTitle || "Mesa de jogo"}</h2><p>{isGm ? "Prepare o cenário, organize os personagens e conduza a aventura." : isObserver ? "Acompanhe o desenrolar da aventura em tempo real." : "Acompanhe o cenário, consulte sua ficha e participe da aventura."}</p></div>
              <div className="room-welcome-emblem"><Swords size={48} /></div>
            </div>
            <div className="room-summary-grid">
              <button className="panel room-summary-card" type="button" onClick={() => selectSection("maps")}><span><Map size={18} /></span><strong>{visibleMaps.length}</strong><small>Mapas disponíveis</small><b>Abrir mapas</b></button>
              <button className="panel room-summary-card" type="button" onClick={() => selectSection("characters")}><span><UserRound size={18} /></span><strong>{characters.length}</strong><small>Personagens</small><b>Ver fichas</b></button>
              <button className="panel room-summary-card" type="button" onClick={() => selectSection("members")}><span><Users size={18} /></span><strong>{session.members?.length || 0}</strong><small>Participantes</small><b>Ver grupo</b></button>
              <button className="panel room-summary-card" type="button" onClick={() => selectSection("dice")}><span><Dice5 size={18} /></span><strong>D20</strong><small>Mesa de rolagem</small><b>Rolar dados</b></button>
            </div>
            <div className="room-overview-bottom">
              <section className="panel room-overview-info"><span className="eyebrow">INFORMAÇÕES DA MESA</span><h3>Uma campanha, uma sala</h3><p>O PIN continua vinculado à campanha. Os participantes podem sair e retornar sem perder o acesso enquanto a campanha existir.</p><div><span>Sistema</span><strong>{session.gameSystemName || "Sistema da campanha"}</strong></div><div><span>Seu papel</span><strong>{isGm ? "Mestre" : isObserver ? "Observador" : "Jogador"}</strong></div></section>
              <section className="panel room-overview-info"><span className="eyebrow">PARTICIPANTES</span><h3>Seu grupo</h3>{(session.members || []).slice(0, 5).map((member) => <div className="room-mini-member" key={member.userId}><span>{member.displayName?.trim()?.charAt(0)?.toUpperCase() || "?"}</span><strong>{member.displayName || "Aventureiro"}</strong><small>{member.role === "gm" ? "Mestre" : member.role === "observer" ? "Observador" : "Jogador"}</small></div>)}<button className="room-text-action" type="button" onClick={() => selectSection("members")}>Ver todos os participantes <ArrowLeft size={13} /></button></section>
            </div>
          </section>}

          {activeSection === "maps" && <section className="room-section">
            <div className="room-section-heading"><div><span className="eyebrow">CENÁRIOS E CARTOGRAFIA</span><h2>Mapas da aventura</h2><p>{isGm ? "Adicione mapas e escolha qual cenário ficará disponível para os jogadores." : "Visualize o mapa que o mestre disponibilizou para a sessão."}</p></div><span className="room-count">{visibleMaps.length} {visibleMaps.length === 1 ? "mapa" : "mapas"}</span></div>
            {isGm && <form className="panel room-map-upload" onSubmit={handleUploadMap}>
              <div className="room-upload-intro"><ImagePlus size={19} /><div><strong>Adicionar mapa</strong><span>JPG, PNG, WebP ou GIF · até 15 MB</span></div></div>
              <label className="room-field"><span>Nome do mapa</span><input value={mapTitle} onChange={(event) => setMapTitle(event.target.value)} maxLength={100} placeholder="Ex.: Ruínas de Valdora" required /></label>
              <label className="room-field"><span>Descrição <small>(opcional)</small></span><input value={mapDescription} onChange={(event) => setMapDescription(event.target.value)} maxLength={1000} placeholder="Uma breve descrição do local" /></label>
              <label className="room-file-picker"><ImagePlus size={16} /><span>{mapFile?.name || "Selecionar imagem do mapa"}</span><input type="file" accept={ALLOWED_MAP_TYPES.join(",")} onChange={(event) => setMapFile(event.target.files?.[0] || null)} required /></label>
              <button className="button button-primary" type="submit" disabled={uploadingMap}>{uploadingMap ? "Enviando..." : "Adicionar mapa"}</button>
            </form>}
            {visibleMaps.length ? <div className="room-map-grid">{visibleMaps.map((item) => <SessionMapCard key={item.id} item={item} isGm={isGm} onVisibility={() => handleMapVisibility(item)} onDelete={() => handleDeleteMap(item)} />)}</div>
              : <div className="panel room-empty"><Map size={28} /><strong>{isGm ? "Nenhum mapa cadastrado" : "O mestre ainda não disponibilizou mapas"}</strong><p>{isGm ? "Adicione o primeiro mapa para preparar o cenário da sessão." : "Quando um mapa for liberado, ele aparecerá nesta seção."}</p></div>}
          </section>}

          {activeSection === "characters" && <section className="room-section">
            <div className="room-section-heading"><div><span className="eyebrow">HERÓIS E FIGURAS DO CENÁRIO</span><h2>Personagens da campanha</h2><p>{isGm ? "Consulte e atualize as fichas dos personagens e NPCs." : "Consulte os personagens e NPCs vinculados a esta campanha."}</p></div><span className="room-count">{characters.length} registros</span></div>
            {characters.length ? <div className="room-character-grid">{characters.map((character) => {
              const npc = character.character_type === "npc";
              const canEdit = !isObserver && (isGm || character.owner_id === user?.id);
              const roleLabel = npc ? (character.npc_role === "ally" ? "Aliado" : character.npc_role === "enemy" ? "Inimigo" : "Neutro") : "Personagem";
              return <article className="panel room-character-card" key={character.id}>
                <div className={npc ? "room-character-symbol npc" : "room-character-symbol"}>{npc ? <Shield size={22} /> : <UserRound size={22} />}</div>
                <div className="room-character-copy"><div><span>{roleLabel}</span><small>{character.status === "active" ? "Ativo" : character.status === "retired" ? "Aposentado" : "Morto"}</small></div><h3>{character.name}</h3><p>{character.concept || "Nenhuma descrição cadastrada."}</p><small>{character.owner_id === user?.id ? "Seu personagem" : npc ? "NPC da campanha" : "Personagem de jogador"}</small></div>
                {canEdit && <button className="button button-secondary room-edit-character" type="button" onClick={() => openCharacterEditor(character)}><Eye size={14} /> Editar ficha</button>}
              </article>;
            })}</div> : <div className="panel room-empty"><UserRound size={28} /><strong>Nenhum personagem vinculado</strong><p>Os personagens e NPCs adicionados à campanha aparecerão aqui.</p></div>}
            {isObserver && <p className="room-readonly-note"><Eye size={14} /> Como observador, você pode consultar as fichas, mas não alterá-las.</p>}
          </section>}

          {activeSection === "dice" && <section className="room-section"><div className="room-section-heading"><div><span className="eyebrow">SORTE E DESTINO</span><h2>Mesa de rolagem</h2><p>Role dados e consulte os registros pessoais ou compartilhados da campanha.</p></div></div><DicePage campaignIdProp={campaignId} embedded readOnly={isObserver} /></section>}

          {activeSection === "chat" && <section className="panel room-chat">
            <div className="room-panel-heading"><div><span className="eyebrow">COMUNICAÇÃO DO GRUPO</span><h2><MessageCircle size={18} /> Chat da sessão</h2></div><span>{messages.length} mensagens</span></div>
            <div className="room-messages" aria-live="polite">{messages.length ? messages.map((message) => {
              const mine = message.author_id === user?.id;
              return <article className={mine ? "room-message mine" : "room-message"} key={message.id}><div><strong>{mine ? "Você" : memberNames.get(message.author_id) || "Aventureiro"}</strong><time dateTime={message.created_at}>{formatTime(message.created_at)}</time></div><p>{message.content}</p></article>;
            }) : <div className="room-empty"><MessageCircle size={25} /><strong>O chat está vazio</strong><p>Comece a conversa com seu grupo.</p></div>}<div ref={bottomRef} /></div>
            {isObserver ? <div className="room-readonly-note"><Eye size={14} /> Você está acompanhando como observador e não pode enviar mensagens.</div>
              : session.status === "active" ? <form className="room-compose" onSubmit={handleSend}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Escreva uma mensagem..." aria-label="Mensagem" /><button className="button button-primary" type="submit" disabled={sending || !draft.trim()}>{sending ? "..." : <Send size={16} />}</button></form>
                : <div className="room-readonly-note">Esta sessão foi encerrada. O histórico continua disponível.</div>}
          </section>}

          {activeSection === "members" && <section className="room-section">
            <div className="room-section-heading"><div><span className="eyebrow">AVENTUREIROS</span><h2>Participantes da sessão</h2><p>Veja quem faz parte desta mesa e quem está conectado agora.</p></div><span className="room-count">{session.members?.length || 0} participantes</span></div>
            <div className="panel room-member-list">{(session.members || []).map((member) => <article key={member.userId} className="room-member-row"><span className="room-member-avatar">{member.displayName?.trim()?.charAt(0)?.toUpperCase() || "?"}</span><div><strong>{member.displayName || "Aventureiro"}</strong><small>{member.role === "gm" ? "Mestre" : member.role === "observer" ? "Observador" : "Jogador"}</small></div><span className={onlineIds.includes(member.userId) ? "room-member-presence online" : "room-member-presence"}><i />{onlineIds.includes(member.userId) ? "Online" : "Offline"}</span></article>)}</div>
          </section>}
        </div>
      </section>

      <CharacterEditDialog character={editingCharacter} saving={savingCharacter} error={characterError} onClose={() => setEditingCharacter(null)} onSave={handleSaveCharacter} onChange={changeCharacter} />
    </main>
  );
}
